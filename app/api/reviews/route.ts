import { NextResponse } from 'next/server';
import { AdminSdkUnavailableError } from '../../../src/lib/firebaseAdmin';
import { checkAndIncrementFirestoreRateLimit } from '../../../src/lib/chatbot/firestoreRest';
import { extractClientIp, hashIdentifier } from '../../../src/lib/chatbot/rateLimit';
import { adminCreatePendingReview } from '../../../src/lib/server/adminRepository';
import { enforcePublicMutationGuards } from '../../../src/lib/server/requestSecurity';

export const dynamic = 'force-dynamic';

/**
 * Stage 2.3: Server-side pending review submission via Firebase Admin SDK.
 * Replaces direct unauthenticated client Firestore writes to `reviews`.
 */
export async function POST(request: Request) {
  const guard = await enforcePublicMutationGuards(request);
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, code: guard.code, error: guard.error },
      { status: guard.status }
    );
  }

  const ipHash = hashIdentifier(`public_review:${extractClientIp(request)}`);
  const rl = await checkAndIncrementFirestoreRateLimit(
    `pub_rev_${ipHash}`,
    5,
    15 * 60 * 1000
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, code: 'rate_limited', error: 'Too many review submissions. Please wait a while.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const customerName = String(body.customerName || '').trim();
  const district = String(body.district || '').trim();
  const comment = String(body.comment || '').trim();
  const orderNumber = String(body.orderNumber || '').trim().toUpperCase();
  const rating = Number(body.rating || 0);
  const photoData = typeof body.photoData === 'string' ? body.photoData.slice(0, 180000) : '';

  if (customerName.length < 2 || comment.length < 4 || !Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { ok: false, code: 'invalid_input', error: 'Please provide your name, a 1-5 rating, and review text.' },
      { status: 400 }
    );
  }

  if (photoData && !/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(photoData)) {
    return NextResponse.json(
      { ok: false, code: 'invalid_photo', error: 'Unsupported photo format. Use JPEG, PNG, or WebP.' },
      { status: 400 }
    );
  }

  try {
    const created = await adminCreatePendingReview({
      customerName,
      district: district || 'Bangladesh',
      rating,
      comment,
      orderNumber,
      photoData,
    });
    return NextResponse.json(
      { ok: true, id: created.id, status: 'pending' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof AdminSdkUnavailableError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: 'Review submission is temporarily unavailable.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Could not save review right now.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
