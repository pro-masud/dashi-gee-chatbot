import { NextResponse } from 'next/server';
import { createVerifiedDeliveryReview } from '../../../../src/lib/chatbot/firestoreRest';
import { normalizeBangladeshPhone } from '../../../../src/lib/chatbot/orderToken';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json({ ok: false, error: 'Invalid request origin header.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const res = await createVerifiedDeliveryReview({
    orderNumber: String(body.orderNumber || ''),
    phone: normalizeBangladeshPhone(String(body.phone || '')),
    customerName: String(body.customerName || ''),
    district: typeof body.district === 'string' ? body.district : undefined,
    rating: Number(body.rating),
    comment: String(body.comment || ''),
    photoData: typeof body.photoData === 'string' ? body.photoData : undefined,
  });

  const statusCode = res.ok
    ? 200
    : res.code === 'already_reviewed' || res.code === 'not_delivered'
      ? 409
      : res.code === 'order_not_found'
        ? 404
        : 400;

  return NextResponse.json(res, {
    status: statusCode,
    headers: { 'Cache-Control': 'no-store' },
  });
}
