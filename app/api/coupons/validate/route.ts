import { NextResponse } from 'next/server';
import type { PaymentMethod } from '../../../../src/lib/storeTypes';
import {
  checkAndIncrementFirestoreRateLimit,
  fetchServerCouponByCode,
} from '../../../../src/lib/chatbot/firestoreRest';
import { evaluateCouponEligibility } from '../../../../src/lib/chatbot/orderToken';
import { extractClientIp, hashIdentifier } from '../../../../src/lib/chatbot/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Server-side coupon validation endpoint.
 * Evaluates coupon eligibility using the canonical server pricing helper and
 * returns localized EN/BN explanations so checkout and order submission never diverge.
 */
export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json(
      {
        ok: false,
        valid: false,
        error: 'Invalid request origin header.',
        messageEn: 'Invalid request origin header.',
        messageBn: 'অবৈধ রিকোয়েস্ট হেডার।',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const ipHash = hashIdentifier(`coupon_val_ip:${extractClientIp(request)}`);
  const rl = await checkAndIncrementFirestoreRateLimit(`cpn_val_${ipHash}`, 20, 300_000);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        ok: false,
        valid: false,
        code: 'rate_limited',
        error: 'Too many coupon checks. Please wait a moment.',
        messageEn: 'Too many coupon checks. Please wait a moment.',
        messageBn: 'অনেকবার কুপন যাচাই করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।',
      },
      { status: 429, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const uiLang = body.uiLang === 'bn' ? 'bn' : 'en';
  const code = String(body.code || '').trim().toUpperCase().slice(0, 32);
  const subtotalBdt = Math.max(0, Math.round(Number(body.subtotalBdt || 0)));
  const rawPayment = String(body.paymentMethod || 'cod').trim();
  const paymentMethod: PaymentMethod =
    rawPayment === 'bkash' || rawPayment === 'nagad' ? rawPayment : 'cod';

  if (!code || !/^[A-Z0-9_-]{2,32}$/.test(code)) {
    const messageEn = 'Please enter a valid coupon code.';
    const messageBn = 'অনুগ্রহ করে একটি সঠিক কুপন কোড লিখুন।';
    return NextResponse.json(
      {
        ok: false,
        valid: false,
        reason: 'not_found',
        error: uiLang === 'bn' ? messageBn : messageEn,
        messageEn,
        messageBn,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const coupon = await fetchServerCouponByCode(code);
  const evaluation = evaluateCouponEligibility(coupon, subtotalBdt, paymentMethod);

  if (!evaluation.valid || !coupon) {
    return NextResponse.json(
      {
        ok: true,
        valid: false,
        reason: evaluation.reason,
        coupon: null,
        error: uiLang === 'bn' ? evaluation.messageBn : evaluation.messageEn,
        messageEn: evaluation.messageEn,
        messageBn: evaluation.messageBn,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      valid: true,
      reason: evaluation.reason,
      coupon: {
        code: coupon.code,
        discountPct: evaluation.discountPct,
        minSubtotalBdt: coupon.minSubtotalBdt,
        active: coupon.active,
        stackableWithAdvance: evaluation.stackableWithAdvance,
      },
      message: uiLang === 'bn' ? evaluation.messageBn : evaluation.messageEn,
      messageEn: evaluation.messageEn,
      messageBn: evaluation.messageBn,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
