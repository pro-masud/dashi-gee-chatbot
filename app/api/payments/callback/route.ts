import { NextResponse } from 'next/server';
import {
  checkAndIncrementFirestoreRateLimit,
  fetchServerOrderForPaymentValidation,
  markServerOrderPaymentVerified,
  recordPaymentGatewayEvent,
  verifyServerAdminToken,
} from '../../../../src/lib/chatbot/firestoreRest';
import { extractClientIp, hashIdentifier } from '../../../../src/lib/chatbot/rateLimit';
import {
  executeBkashCheckout,
  getPaymentGatewayReadiness,
  validateSslCommerzPayment,
  verifySslCommerzIpnSignature,
  type OnlinePaymentGateway,
} from '../../../../src/lib/integrations/paymentGateway';
import { dispatchWebhookWithRetry, notificationLogs } from '../../../../src/lib/serverState';

export const dynamic = 'force-dynamic';

async function handlePaymentCallback(request: Request) {
  const ipHash = hashIdentifier(`pay_cb_ip:${extractClientIp(request)}`);
  const ipLimit = await checkAndIncrementFirestoreRateLimit(`pay_cb_min_${ipHash}`, 30, 60_000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { ok: false, verified: false, code: 'rate_limited', error: 'Too many callback requests.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(15, ipLimit.retryAfterSec)),
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const url = new URL(request.url);
  const query = url.searchParams;
  const contentType = (request.headers.get('content-type') || '').toLowerCase();

  const formFields: Record<string, string> = {};
  if (request.method === 'POST') {
    if (contentType.includes('application/json')) {
      const json = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      for (const [k, v] of Object.entries(json)) {
        formFields[k] = String(v ?? '');
      }
    } else {
      const text = await request.text().catch(() => '');
      const params = new URLSearchParams(text);
      for (const [k, v] of params.entries()) {
        formFields[k] = v;
      }
    }
  }

  const gatewayRaw = String(query.get('gateway') || formFields.gateway || '')
    .trim()
    .toLowerCase();
  const orderNumber = String(
    query.get('order') || formFields.tran_id || formFields.orderNumber || ''
  )
    .trim()
    .toUpperCase();
  const outcome = String(query.get('outcome') || formFields.status || '')
    .trim()
    .toLowerCase();
  const phone = String(query.get('phone') || formFields.cus_phone || formFields.phone || '').trim();
  const wantsJson =
    request.headers.get('accept')?.includes('application/json') ||
    outcome === 'ipn' ||
    query.get('format') === 'json';

  if ((gatewayRaw !== 'sslcommerz' && gatewayRaw !== 'bkash') || !/^DG-\d{4,8}$/.test(orderNumber)) {
    return NextResponse.json(
      { ok: false, verified: false, error: 'Invalid payment callback parameters.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const gateway: OnlinePaymentGateway = gatewayRaw;

  const readiness = getPaymentGatewayReadiness();
  if (!readiness[gateway].configured) {
    return NextResponse.json(
      {
        ok: false,
        verified: false,
        gateway,
        orderNumber,
        code: 'gateway_not_configured',
        status: 'Not configured',
        error: `Not configured: ${gateway.toUpperCase()} credentials are missing on the server.`,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const orderLimit = await checkAndIncrementFirestoreRateLimit(
    `pay_cb_ord_${hashIdentifier(orderNumber)}`,
    15,
    60_000
  );
  if (!orderLimit.allowed) {
    return NextResponse.json(
      { ok: false, verified: false, code: 'rate_limited', error: 'Too many callback requests for this order.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(15, orderLimit.retryAfterSec)),
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const siteBase =
    (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '') || url.origin;

  // S0-04: Fail / cancel events must be authenticated (valid SSLCommerz IPN hash or Admin)
  // or ignored (safe redirect without mutating DB / spamming payment_gateway_events).
  const isCancel = outcome === 'cancel' || outcome === 'cancelled';
  const isFail = outcome === 'fail' || outcome === 'failed' || outcome === 'failure';
  if (isCancel || isFail) {
    let authenticated = false;
    if (gateway === 'sslcommerz' && formFields.verify_sign && formFields.verify_key) {
      authenticated = verifySslCommerzIpnSignature(formFields).ok;
    }
    if (!authenticated) {
      const authHeader = request.headers.get('authorization');
      if (authHeader) {
        const adminCheck = await verifyServerAdminToken(authHeader);
        authenticated = adminCheck.ok;
      }
    }

    const statusLabel = isCancel ? 'cancelled' : 'failed';
    if (authenticated) {
      const rawRef = String(formFields.val_id || formFields.bank_tran_id || query.get('paymentID') || statusLabel);
      const safeRef = rawRef.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
      await recordPaymentGatewayEvent({
        eventId: `${gateway}_${statusLabel}_${orderNumber}_${safeRef}`,
        provider: gateway,
        eventType: isCancel ? 'payment_cancelled' : 'payment_failed',
        orderNumber,
        externalRef: rawRef,
        rawStatus: statusLabel,
        verified: false,
      }).catch(() => {});
    }

    if (wantsJson) {
      return NextResponse.json(
        {
          ok: true,
          verified: false,
          recorded: authenticated,
          status: statusLabel,
          orderNumber,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.redirect(
      `${siteBase}/track?order=${encodeURIComponent(orderNumber)}&payment=${statusLabel}`,
      303
    );
  }

  // S0-04: Verify SSLCommerz IPN MD5 signature (verify_sign + verify_key) BEFORE calling Validation API.
  if (gateway === 'sslcommerz') {
    const isIpn = outcome === 'ipn';
    const hasSigFields = Boolean(formFields.verify_sign || formFields.verify_key);
    if (isIpn || hasSigFields) {
      const sigCheck = verifySslCommerzIpnSignature(formFields);
      if (!sigCheck.ok) {
        return NextResponse.json(
          {
            ok: false,
            verified: false,
            gateway,
            orderNumber,
            code: 'invalid_ipn_signature',
            error: `Invalid SSLCommerz IPN signature (${sigCheck.reason || 'mismatch'}).`,
          },
          { status: 401, headers: { 'Cache-Control': 'no-store' } }
        );
      }
    }
  }

  // S0-04: Authoritative order amount ALWAYS comes from the server order/tracking record.
  // NEVER fall back to client-supplied amount or `1`.
  const serverOrder = await fetchServerOrderForPaymentValidation(orderNumber, phone);
  if (!serverOrder || !Number.isFinite(serverOrder.totalBdt) || serverOrder.totalBdt <= 0) {
    return NextResponse.json(
      {
        ok: false,
        verified: false,
        gateway,
        orderNumber,
        code: 'order_not_found',
        error: 'Authoritative server order record could not be found for payment validation.',
      },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const expectedAmountBdt = serverOrder.totalBdt;

  const verification =
    gateway === 'sslcommerz'
      ? await validateSslCommerzPayment({
          valId: String(formFields.val_id || query.get('val_id') || ''),
          expectedOrderNumber: orderNumber,
          expectedAmountBdt,
        })
      : await executeBkashCheckout({
          paymentId: String(formFields.paymentID || query.get('paymentID') || ''),
          expectedOrderNumber: orderNumber,
          expectedAmountBdt,
        });

  const externalRef = verification.transactionId || verification.valId || `${gateway}_${orderNumber}`;
  const eventId = `${gateway}_${orderNumber}_${externalRef}`.replace(/[^a-zA-Z0-9_-]/g, '_');

  const recordRes = await recordPaymentGatewayEvent({
    eventId,
    provider: gateway,
    eventType: verification.verified ? 'payment_verified' : 'payment_failed',
    orderNumber,
    externalRef,
    amountBdt: verification.amountBdt,
    rawStatus: verification.rawStatus,
    verified: verification.verified,
    auditAction: verification.verified ? 'payment_gateway_verified' : undefined,
    auditSummary: verification.verified
      ? `${gateway.toUpperCase()} server-verified payment (${verification.amountBdt} BDT, ref: ${externalRef}).`
      : undefined,
  });

  // S0-04: Update order + tracking paymentStatus ONLY after server validation succeeds.
  let orderPaymentUpdated = false;
  if (verification.verified) {
    const updateRes = await markServerOrderPaymentVerified({
      orderNumber,
      phone: serverOrder.phone || phone,
      transactionId: externalRef,
    });
    orderPaymentUpdated = updateRes.ok;
  }

  if (verification.verified && !recordRes.duplicate && process.env.OWNER_WEBHOOK_URL) {
    const log = await dispatchWebhookWithRetry(
      process.env.OWNER_WEBHOOK_URL,
      `${gateway}_payment_verified`,
      {
        event: 'payment_gateway_verified',
        gateway,
        orderNumber,
        amountBdt: verification.amountBdt,
        transactionId: externalRef,
      },
      1
    );
    notificationLogs.unshift(log);
    if (notificationLogs.length > 50) notificationLogs.pop();
  }

  if (wantsJson) {
    return NextResponse.json(
      {
        ok: verification.ok,
        verified: verification.verified,
        duplicate: Boolean(recordRes.duplicate),
        orderPaymentUpdated,
        gateway,
        orderNumber,
        transactionId: externalRef,
        amountBdt: verification.amountBdt,
        rawStatus: verification.rawStatus,
        error: verification.error,
      },
      { status: verification.verified ? 200 : 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const redirectState = verification.verified ? 'verified' : 'failed';
  return NextResponse.redirect(
    `${siteBase}/track?order=${encodeURIComponent(orderNumber)}&payment=${redirectState}&ref=${encodeURIComponent(externalRef)}`,
    303
  );
}

export async function GET(request: Request) {
  return handlePaymentCallback(request);
}

export async function POST(request: Request) {
  return handlePaymentCallback(request);
}
