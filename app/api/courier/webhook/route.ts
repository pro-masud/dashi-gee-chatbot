import { NextResponse } from 'next/server';
import {
  applyValidatedCourierStatusToOrder,
  checkAndIncrementFirestoreRateLimit,
  fetchServerOrderForPaymentValidation,
  recordPaymentGatewayEvent,
} from '../../../../src/lib/chatbot/firestoreRest';
import { extractClientIp, hashIdentifier } from '../../../../src/lib/chatbot/rateLimit';
import {
  normalizeCourierWebhookPayload,
  verifyCourierWebhookAuth,
} from '../../../../src/lib/integrations/courierApi';
import { dispatchWebhookWithRetry, notificationLogs } from '../../../../src/lib/serverState';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ipHash = hashIdentifier(`courier_wh_ip:${extractClientIp(request)}`);
  const ipLimit = await checkAndIncrementFirestoreRateLimit(`courier_wh_min_${ipHash}`, 60, 60_000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { ok: false, code: 'rate_limited', error: 'Too many courier webhook requests.' },
      { status: 429, headers: { 'Retry-After': String(Math.max(15, ipLimit.retryAfterSec)) } }
    );
  }

  const rawBody = await request.text().catch(() => '');
  const authCheck = verifyCourierWebhookAuth({
    rawBody,
    signatureHeader:
      request.headers.get('x-courier-signature') ||
      request.headers.get('x-hub-signature-256'),
    bearerOrSecretHeader:
      request.headers.get('x-courier-secret') || request.headers.get('authorization'),
  });

  if (!authCheck.ok) {
    return NextResponse.json(
      { ok: false, error: authCheck.reason || 'Unauthorized courier webhook.' },
      { status: authCheck.reason === 'courier_webhook_secret_unconfigured' ? 503 : 401 }
    );
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody || '{}') as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed JSON body.' }, { status: 400 });
  }

  const url = new URL(request.url);
  const partnerHint = url.searchParams.get('partner') || '';
  const event = normalizeCourierWebhookPayload(partnerHint, payload);
  if (!event || !/^DG-\d{4,8}$/.test(event.orderNumber)) {
    return NextResponse.json(
      { ok: false, error: 'Valid Deshi Gee invoice/orderNumber and status are required.' },
      { status: 400 }
    );
  }

  const provider =
    event.partner === 'pathao' || event.partner === 'redx' ? event.partner : 'steadfast';

  // S0-07: Validate server-side order & consignment match BEFORE applying any status transition.
  const serverOrder = await fetchServerOrderForPaymentValidation(event.orderNumber);
  if (
    serverOrder &&
    serverOrder.consignmentId &&
    event.consignmentId &&
    String(serverOrder.consignmentId).trim() !== String(event.consignmentId).trim()
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: 'consignment_mismatch',
        error: 'Webhook consignment ID does not match the booked consignment for this order.',
      },
      { status: 409 }
    );
  }

  const recorded = await recordPaymentGatewayEvent({
    eventId: `courier_${event.eventId}`,
    provider,
    eventType: 'courier_status',
    orderNumber: event.orderNumber,
    externalRef: event.consignmentId || event.eventId,
    rawStatus: event.rawStatus,
    verified: true,
    auditAction: 'courier_webhook_synced',
    auditSummary: `${provider.toUpperCase()} webhook: ${event.rawStatus}${event.mappedOrderStatus ? ` -> ${event.mappedOrderStatus}` : ''} (${event.trackingMessage})`,
  });

  let orderStatusUpdated = false;
  let statusUpdateDetail = 'no_status_transition_mapped';
  if (!recorded.duplicate && event.mappedOrderStatus && serverOrder) {
    const applied = await applyValidatedCourierStatusToOrder({
      orderNumber: event.orderNumber,
      phone: serverOrder.phone,
      nextStatus: event.mappedOrderStatus,
      courierPartner: provider,
      consignmentId: event.consignmentId || serverOrder.consignmentId || '',
      rawStatus: event.rawStatus,
    });
    orderStatusUpdated = applied.ok;
    statusUpdateDetail = applied.detail;
  } else if (!serverOrder) {
    statusUpdateDetail = 'order_lookup_requires_admin_sdk_or_missing';
  }

  if (!recorded.duplicate && process.env.OWNER_WEBHOOK_URL) {
    const alert = await dispatchWebhookWithRetry(
      process.env.OWNER_WEBHOOK_URL,
      `courier_webhook_${provider}`,
      {
        event: 'courier_status_update',
        partner: provider,
        orderNumber: event.orderNumber,
        consignmentId: event.consignmentId,
        rawStatus: event.rawStatus,
        mappedOrderStatus: event.mappedOrderStatus,
        orderStatusUpdated,
        trackingMessage: event.trackingMessage,
      },
      1
    );
    notificationLogs.unshift(alert);
    if (notificationLogs.length > 50) notificationLogs.pop();
  }

  return NextResponse.json(
    {
      ok: true,
      duplicate: Boolean(recorded.duplicate),
      partner: provider,
      orderNumber: event.orderNumber,
      consignmentId: event.consignmentId,
      rawStatus: event.rawStatus,
      mappedOrderStatus: event.mappedOrderStatus,
      orderStatusUpdated,
      statusUpdateDetail,
    },
    { status: 200 }
  );
}
