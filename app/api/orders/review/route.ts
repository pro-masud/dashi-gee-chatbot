import { NextResponse } from 'next/server';
import {
  checkAndIncrementFirestoreRateLimit,
  createVerifiedDeliveryReview,
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

  const ipHash = hashIdentifier(`ord_review_ip:${extractClientIp(request)}`);
  const rl = await checkAndIncrementFirestoreRateLimit(`ord_rev_${ipHash}`, 10, 300_000);
  if (!rl.allowed) {
    const messageEn = 'Too many review submissions. Please wait a few minutes.';
    const messageBn = 'অনেকবার রিভিউ পাঠানোর চেষ্টা করা হয়েছে। কয়েক মিনিট পর আবার চেষ্টা করুন।';
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
