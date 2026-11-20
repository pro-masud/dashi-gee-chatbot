import { NextResponse } from 'next/server';
import { AdminSdkUnavailableError } from '../../../src/lib/firebaseAdmin';
import { checkAndIncrementFirestoreRateLimit } from '../../../src/lib/chatbot/firestoreRest';
import { extractClientIp, hashIdentifier } from '../../../src/lib/chatbot/rateLimit';
import { adminSubscribeNewsletter } from '../../../src/lib/server/adminRepository';
import { enforcePublicMutationGuards } from '../../../src/lib/server/requestSecurity';

export const dynamic = 'force-dynamic';

/**
 * Stage 2.3: Server-side newsletter subscription via Admin SDK.
 * Replaces direct unauthenticated client Firestore writes to `subscribers`.
 */
export async function POST(request: Request) {
  const guard = await enforcePublicMutationGuards(request);
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, code: guard.code, error: guard.error },
      { status: guard.status }
    );
  }

  const ipHash = hashIdentifier(`newsletter:${extractClientIp(request)}`);
  const rl = await checkAndIncrementFirestoreRateLimit(
    `news_${ipHash}`,
    8,
    15 * 60 * 1000
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, code: 'rate_limited', error: 'Too many signup requests. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const lang = body.lang === 'bn' ? 'bn' : 'en';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
    return NextResponse.json(
      { ok: false, code: 'invalid_email', error: 'Please enter a valid email address.' },
      { status: 400 }
    );
  }

  try {
    const res = await adminSubscribeNewsletter(email, lang);
    return NextResponse.json(
      { ok: true, id: res.id },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof AdminSdkUnavailableError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: 'Newsletter signup is temporarily unavailable.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Could not subscribe right now.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
