import { NextResponse } from 'next/server';
import {
  checkAndIncrementFirestoreRateLimit,
  fetchRefillReminder,
  fetchServerOrderTracking,
  upsertRefillReminder,
} from '../../../../src/lib/chatbot/firestoreRest';
import { normalizeBangladeshPhone } from '../../../../src/lib/chatbot/orderToken';
import { extractClientIp, hashIdentifier } from '../../../../src/lib/chatbot/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const uiLang = searchParams.get('uiLang') === 'bn' ? 'bn' : 'en';
  const orderNumber = String(searchParams.get('orderNumber') || '').trim().toUpperCase();
  const phone = normalizeBangladeshPhone(String(searchParams.get('phone') || ''));

  const ipHash = hashIdentifier(`refill_get_ip:${extractClientIp(request)}`);
  const rl = await checkAndIncrementFirestoreRateLimit(`refill_g_${ipHash}`, 20, 300_000);
  if (!rl.allowed) {
    const messageEn = 'Too many lookup requests. Please wait a few minutes.';
    const messageBn = 'অনেকবার অনুরোধ পাঠানো হয়েছে। কয়েক মিনিট পর আবার চেষ্টা করুন।';
    return NextResponse.json(
      {
        ok: false,
        code: 'rate_limited',
        error: uiLang === 'bn' ? messageBn : messageEn,
        messageEn,
        messageBn,
      },
      { status: 429, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (!/^DG-[0-9]{4,8}$/.test(orderNumber) || !/^01[3-9][0-9]{8}$/.test(phone)) {
    const messageEn = 'Valid orderNumber and 11-digit phone are required.';
    const messageBn = 'সঠিক অর্ডার নম্বর ও ১১ সংখ্যার মোবাইল নম্বর দিন।';
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_credentials',
        error: uiLang === 'bn' ? messageBn : messageEn,
        messageEn,
        messageBn,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // 3-01: Verify matching order + phone ownership before reading reminder state.
  const tracking = await fetchServerOrderTracking(orderNumber, phone);
  if (!tracking) {
    const messageEn = 'Order could not be verified.';
    const messageBn = 'অর্ডারটি যাচাই করা যায়নি।';
    return NextResponse.json(
      {
        ok: false,
        code: 'order_not_found',
        error: uiLang === 'bn' ? messageBn : messageEn,
        messageEn,
        messageBn,
      },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const reminder = await fetchRefillReminder(orderNumber, phone);
  return NextResponse.json(
    { ok: true, reminder },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Invalid request origin header.',
        messageEn: 'Invalid request origin header.',
        messageBn: 'অবৈধ রিকোয়েস্ট হেডার।',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const uiLang = body.uiLang === 'bn' ? 'bn' : 'en';

  const ipHash = hashIdentifier(`refill_post_ip:${extractClientIp(request)}`);
  const rl = await checkAndIncrementFirestoreRateLimit(`refill_p_${ipHash}`, 15, 300_000);
  if (!rl.allowed) {
    const messageEn = 'Too many reminder updates. Please wait a few minutes.';
    const messageBn = 'অনেকবার রিমাইন্ডার আপডেট করা হয়েছে। কয়েক মিনিট পর আবার চেষ্টা করুন।';
    return NextResponse.json(
      {
        ok: false,
        code: 'rate_limited',
        error: uiLang === 'bn' ? messageBn : messageEn,
        messageEn,
        messageBn,
      },
      { status: 429, headers: { 'Cache-Control': 'no-store' } }
    );
  }

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
  return NextResponse.json(
    {
      ...res,
      ...(!res.ok ? { error: uiLang === 'bn' ? res.messageBn : res.messageEn } : {}),
    },
    {
      status: statusCode,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
