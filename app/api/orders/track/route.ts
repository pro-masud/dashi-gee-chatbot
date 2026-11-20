import { NextResponse } from 'next/server';
import {
  AdminSdkUnavailableError,
  checkAndIncrementFirestoreRateLimit,
  fetchServerOrderTracking,
  fetchServerOrderTrackingByToken,
} from '../../../../src/lib/chatbot/firestoreRest';
import { normalizeBangladeshPhone } from '../../../../src/lib/chatbot/orderToken';
import { extractClientIp, hashIdentifier } from '../../../../src/lib/chatbot/rateLimit';
import {
  enforcePublicMutationGuards,
} from '../../../../src/lib/server/requestSecurity';
import { sanitizePublicTrackingRecord } from '../../../../src/lib/server/adminRepository';

export const dynamic = 'force-dynamic';

const UNIFORM_NOT_FOUND_EN =
  'Order could not be found. Please check your tracking link, Order ID, and mobile number.';
const UNIFORM_NOT_FOUND_BN =
  'অর্ডারটি খুঁজে পাওয়া যায়নি। অনুগ্রহ করে আপনার ট্র্যাকিং লিংক, অর্ডার আইডি ও মোবাইল নম্বর যাচাই করুন।';

/**
 * Decision D14 (Stage 2.4):
 * Order tracking lookup via:
 * 1) 192-bit CSPRNG `trackingToken` (preferred link flow `/track?token=...`)
 * 2) Rate-limited `orderNumber` + `phone` fallback
 * Always returns uniform 404 on invalid/unmatched credentials to prevent enumeration.
 */
export async function POST(request: Request) {
  const guard = await enforcePublicMutationGuards(request);
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, code: guard.code, error: guard.error },
      { status: guard.status }
    );
  }

  const ipHash = hashIdentifier(`order_track:${extractClientIp(request)}`);
  const rl = await checkAndIncrementFirestoreRateLimit(
    `ord_trk_${ipHash}`,
    20,
    10 * 60 * 1000
  );
  if (!rl.allowed) {
    return NextResponse.json(
      {
        ok: false,
        code: 'rate_limited',
        error: 'Too many tracking lookup attempts. Please wait a few minutes and try again.',
      },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const uiLang = body.uiLang === 'bn' ? 'bn' : 'en';
  const trackingToken = String(body.trackingToken || '').trim();
  const orderNumber = String(body.orderNumber || '').trim().toUpperCase();
  const phone = normalizeBangladeshPhone(String(body.phone || ''));

  try {
    if (trackingToken) {
      const rec = await fetchServerOrderTrackingByToken(trackingToken);
      if (!rec) {
        return NextResponse.json(
          {
            ok: false,
            code: 'not_found',
            error: uiLang === 'bn' ? UNIFORM_NOT_FOUND_BN : UNIFORM_NOT_FOUND_EN,
          },
          { status: 404, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return NextResponse.json(
        { ok: true, tracking: rec },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (!/^DG-[0-9]{4,8}$/.test(orderNumber) || !/^01[3-9][0-9]{8}$/.test(phone)) {
      return NextResponse.json(
        {
          ok: false,
          code: 'not_found',
          error: uiLang === 'bn' ? UNIFORM_NOT_FOUND_BN : UNIFORM_NOT_FOUND_EN,
        },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const found = await fetchServerOrderTracking(orderNumber, phone);
    if (!found) {
      return NextResponse.json(
        {
          ok: false,
          code: 'not_found',
          error: uiLang === 'bn' ? UNIFORM_NOT_FOUND_BN : UNIFORM_NOT_FOUND_EN,
        },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const sanitized = sanitizePublicTrackingRecord(
      found as unknown as Record<string, unknown>,
      phone
    );
    return NextResponse.json(
      { ok: true, tracking: sanitized },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof AdminSdkUnavailableError) {
      return NextResponse.json(
        {
          ok: false,
          code: err.code,
          error: uiLang === 'bn' ? err.customerMessageBn : err.customerMessageEn,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        code: 'not_found',
        error: uiLang === 'bn' ? UNIFORM_NOT_FOUND_BN : UNIFORM_NOT_FOUND_EN,
      },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
