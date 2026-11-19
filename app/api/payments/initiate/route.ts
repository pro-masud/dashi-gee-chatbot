import { NextResponse } from 'next/server';
import {
  checkAndIncrementFirestoreRateLimit,
  fetchServerOrderTracking,
} from '../../../../src/lib/chatbot/firestoreRest';
import {
  isValidBangladeshPhone,
  normalizeBangladeshPhone,
} from '../../../../src/lib/chatbot/orderToken';
import { extractClientIp, hashIdentifier } from '../../../../src/lib/chatbot/rateLimit';
import {
  getPaymentGatewayReadiness,
  initiateBkashCheckout,
  initiateSslCommerzPayment,
  type OnlinePaymentGateway,
} from '../../../../src/lib/integrations/paymentGateway';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json(
      { ok: false, error: 'Invalid request origin header.' },
      { status: 403 }
    );
  }

  const ipHash = hashIdentifier(`pay_init_ip:${extractClientIp(request)}`);
  const ipLimit = await checkAndIncrementFirestoreRateLimit(`pay_init_min_${ipHash}`, 15, 60_000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { ok: false, code: 'rate_limited', error: 'Too many payment attempts. Please wait a moment.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(15, ipLimit.retryAfterSec)),
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  let body: {
    gateway?: string;
    orderNumber?: string;
    phone?: string;
    customerName?: string;
    address?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed JSON body.' }, { status: 400 });
  }

  const gatewayRaw = String(body.gateway || '').trim().toLowerCase();
  if (gatewayRaw !== 'sslcommerz' && gatewayRaw !== 'bkash') {
    return NextResponse.json(
      { ok: false, error: 'Supported gateways are sslcommerz or bkash.' },
      { status: 400 }
    );
  }
  const gateway: OnlinePaymentGateway = gatewayRaw;

  const readiness = getPaymentGatewayReadiness();
  if (!readiness[gateway].configured) {
    return NextResponse.json(
      {
        ok: false,
        gateway,
        code: 'gateway_not_configured',
        status: 'Not configured',
        error: `Not configured: ${gateway.toUpperCase()} payment gateway is not configured on the server.`,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const orderNumber = String(body.orderNumber || '').trim().toUpperCase();
  const phone = normalizeBangladeshPhone(String(body.phone || ''));
  if (!/^DG-\d{4,8}$/.test(orderNumber) || !isValidBangladeshPhone(phone)) {
    return NextResponse.json(
      { ok: false, error: 'Valid Order ID (DG-XXXXX) and 11-digit BD phone are required.' },
      { status: 400 }
    );
  }

  const orderLimit = await checkAndIncrementFirestoreRateLimit(
    `pay_init_ord_${hashIdentifier(orderNumber)}`,
    8,
    60_000
  );
  if (!orderLimit.allowed) {
    return NextResponse.json(
      { ok: false, code: 'rate_limited', error: 'Too many payment attempts for this order.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(15, orderLimit.retryAfterSec)),
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const tracking = await fetchServerOrderTracking(orderNumber, phone);
  if (!tracking) {
    return NextResponse.json(
      { ok: false, code: 'order_not_found', error: 'Order not found for that phone number.' },
      { status: 404 }
    );
  }

  if (tracking.status === 'cancelled') {
    return NextResponse.json(
      { ok: false, code: 'order_cancelled', error: 'Cancelled orders cannot be paid.' },
      { status: 409 }
    );
  }

  if (tracking.paymentStatus === 'verified') {
    return NextResponse.json(
      { ok: false, code: 'already_paid', error: 'Payment for this order is already verified.' },
      { status: 409 }
    );
  }

  const origin =
    (process.env.NEXT_PUBLIC_SITE_URL || '').trim() ||
    new URL(request.url).origin ||
    'http://localhost:3000';

  const input = {
    gateway,
    orderNumber,
    amountBdt: Number(tracking.totalBdt || 0),
    customerName: String(body.customerName || 'Deshi Gee Customer').trim(),
    customerPhone: phone,
    customerAddress: String(body.address || tracking.district || 'Dhaka').trim(),
    customerDistrict: String(tracking.district || 'Dhaka').trim(),
    itemsSummary: String(tracking.itemsSummary || 'Deshi Gee Pure Cow Ghee'),
    siteBaseUrl: origin,
  };

  const result =
    gateway === 'sslcommerz'
      ? await initiateSslCommerzPayment(input)
      : await initiateBkashCheckout(input);

  const statusCode = result.ok
    ? 200
    : result.code === 'gateway_not_configured'
      ? 503
      : 502;

  return NextResponse.json(result, {
    status: statusCode,
    headers: { 'Cache-Control': 'no-store' },
  });
}
