import { NextResponse } from 'next/server';
import {
  buildVerifiedReorderPayload,
  checkAndIncrementFirestoreRateLimit,
} from '../../../../src/lib/chatbot/firestoreRest';
import { normalizeBangladeshPhone } from '../../../../src/lib/chatbot/orderToken';
import { extractClientIp, hashIdentifier } from '../../../../src/lib/chatbot/rateLimit';

export const dynamic = 'force-dynamic';

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

  const ipHash = hashIdentifier(`reorder_ip:${extractClientIp(request)}`);
  const rl = await checkAndIncrementFirestoreRateLimit(`ord_reord_${ipHash}`, 15, 300_000);
  if (!rl.allowed) {
    const messageEn = 'Too many reorder attempts. Please wait a few minutes.';
    const messageBn = 'অনেকবার রিঅর্ডার চেষ্টা করা হয়েছে। কয়েক মিনিট পর আবার চেষ্টা করুন।';
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
