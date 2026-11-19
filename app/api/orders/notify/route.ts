import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  checkAndIncrementFirestoreRateLimit,
  verifyServerAdminToken,
} from '../../../../src/lib/chatbot/firestoreRest';
import { extractClientIp, hashIdentifier } from '../../../../src/lib/chatbot/rateLimit';
import { dispatchOrderNotificationsServerSide } from '../../../../src/lib/integrations/orderNotify';

export const dynamic = 'force-dynamic';

function isAuthorizedInternalNotifyCaller(request: Request): boolean {
  const internalSecret = (
    process.env.INTERNAL_NOTIFY_SECRET ||
    process.env.CRON_SECRET ||
    ''
  ).trim();
  if (internalSecret.length < 16) return false;
  const provided = (request.headers.get('x-internal-notify-secret') || '').trim();
  if (!provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(internalSecret).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  // S0-05: Never allow client-supplied static header (`x-requested-with`) to trigger SMS/email/webhooks.
  // Caller must be either a verified Admin (Bearer Firebase ID token) or a server-internal caller.
  const isInternal = isAuthorizedInternalNotifyCaller(request);
  if (!isInternal) {
    const adminCheck = await verifyServerAdminToken(request.headers.get('authorization'));
    if (!adminCheck.ok) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized: admin or server-internal authorization required.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }
  }

  const ipHash = hashIdentifier(`orders_notify_ip:${extractClientIp(request)}`);
  const ipLimit = await checkAndIncrementFirestoreRateLimit(`orders_notify_min_${ipHash}`, 20, 60_000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { ok: false, code: 'rate_limited', error: 'Too many notification requests.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(15, ipLimit.retryAfterSec)),
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const payload = await request.json().catch(() => ({}));
  const dispatched = await dispatchOrderNotificationsServerSide({
    ...payload,
    orderNumber: String(payload.orderNumber || '').trim(),
    customerName: String(payload.customerName || 'Customer').trim(),
    phone: String(payload.phone || '').trim(),
    totalBdt: Number(payload.totalBdt || 0),
    itemsSummary: String(payload.itemsSummary || 'Deshi Gee Pure Cow Ghee').trim(),
    paymentMethod: String(payload.paymentMethod || 'cod'),
  });

  return NextResponse.json(dispatched);
}
