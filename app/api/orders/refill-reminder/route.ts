import { NextResponse } from 'next/server';
import {
  fetchRefillReminder,
  upsertRefillReminder,
} from '../../../../src/lib/chatbot/firestoreRest';
import { normalizeBangladeshPhone } from '../../../../src/lib/chatbot/orderToken';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orderNumber = String(searchParams.get('orderNumber') || '').trim().toUpperCase();
  const phone = normalizeBangladeshPhone(String(searchParams.get('phone') || ''));

  if (!/^DG-[0-9]{4,8}$/.test(orderNumber) || !/^01[3-9][0-9]{8}$/.test(phone)) {
    return NextResponse.json({ ok: false, error: 'Valid orderNumber and phone required.' }, { status: 400 });
  }

  const reminder = await fetchRefillReminder(orderNumber, phone);
  return NextResponse.json(
    { ok: true, reminder },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json({ ok: false, error: 'Invalid request origin header.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const intervalRaw = Number(body.intervalDays);
  const intervalDays: 30 | 45 | 60 | 90 | undefined =
    intervalRaw === 30 || intervalRaw === 45 || intervalRaw === 60 || intervalRaw === 90
      ? intervalRaw
      : undefined;

  const statusRaw = String(body.status || '').trim();
  const status: 'active' | 'paused' | 'opted_out' | undefined =
    statusRaw === 'active' || statusRaw === 'paused' || statusRaw === 'opted_out'
      ? statusRaw
      : undefined;

  const res = await upsertRefillReminder({
    orderNumber: String(body.orderNumber || ''),
    phone: normalizeBangladeshPhone(String(body.phone || '')),
    intervalDays,
    status,
    consentGranted: body.consentGranted === true,
    customerName: typeof body.customerName === 'string' ? body.customerName : undefined,
  });

  const statusCode = res.ok ? 200 : res.code === 'order_not_found' ? 404 : 400;
  return NextResponse.json(res, {
    status: statusCode,
    headers: { 'Cache-Control': 'no-store' },
  });
}
