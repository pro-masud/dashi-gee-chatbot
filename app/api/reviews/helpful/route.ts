import { NextResponse } from 'next/server';
import { AdminSdkUnavailableError } from '../../../../src/lib/firebaseAdmin';
import { checkAndIncrementFirestoreRateLimit } from '../../../../src/lib/chatbot/firestoreRest';
import { extractClientIp, hashIdentifier } from '../../../../src/lib/chatbot/rateLimit';
import { adminIncrementReviewHelpfulAtomic } from '../../../../src/lib/server/adminRepository';
import { enforcePublicMutationGuards } from '../../../../src/lib/server/requestSecurity';

export const dynamic = 'force-dynamic';

/**
 * Stage 2.3: Atomic review helpful counter via Admin SDK (`FieldValue.increment(1)`).
 * Replaces direct unauthenticated client `updateDoc` on `reviews`.
 */
export async function POST(request: Request) {
  const guard = await enforcePublicMutationGuards(request);
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, code: guard.code, error: guard.error },
      { status: guard.status }
    );
  }

  const ipHash = hashIdentifier(`review_helpful:${extractClientIp(request)}`);
  const rl = await checkAndIncrementFirestoreRateLimit(
    `rev_hlp_${ipHash}`,
    20,
    10 * 60 * 1000
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, code: 'rate_limited', error: 'Too many requests.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const reviewId = String(body.reviewId || '').trim();
  if (!/^[a-zA-Z0-9_-]{4,96}$/.test(reviewId)) {
    return NextResponse.json({ ok: false, error: 'Invalid reviewId.' }, { status: 400 });
  }

  try {
    const updated = await adminIncrementReviewHelpfulAtomic(reviewId);
    if (!updated) {
      return NextResponse.json({ ok: false, error: 'Review not found.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof AdminSdkUnavailableError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: 'Service temporarily unavailable.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json({ ok: false, error: 'Update failed.' }, { status: 500 });
  }
}
