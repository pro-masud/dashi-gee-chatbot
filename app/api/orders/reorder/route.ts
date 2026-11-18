import { NextResponse } from 'next/server';
import { buildVerifiedReorderPayload } from '../../../../src/lib/chatbot/firestoreRest';
import { normalizeBangladeshPhone } from '../../../../src/lib/chatbot/orderToken';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json({ ok: false, error: 'Invalid request origin header.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const res = await buildVerifiedReorderPayload(
    String(body.orderNumber || ''),
    normalizeBangladeshPhone(String(body.phone || ''))
  );

  const statusCode = res.ok
    ? 200
    : res.code === 'order_not_found'
      ? 404
      : res.code === 'out_of_stock'
        ? 409
        : 400;

  return NextResponse.json(res, {
    status: statusCode,
    headers: { 'Cache-Control': 'no-store' },
  });
}
