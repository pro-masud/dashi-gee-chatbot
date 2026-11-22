import { NextResponse } from 'next/server';
import { AdminSdkUnavailableError } from '../../../src/lib/firebaseAdmin';
import { checkAndIncrementFirestoreRateLimit } from '../../../src/lib/chatbot/firestoreRest';
import { extractClientIp, hashIdentifier } from '../../../src/lib/chatbot/rateLimit';
import { validateLeadCapture } from '../../../src/lib/leads/leads';
import { upsertLead } from '../../../src/lib/server/leadsRepository';
import { enforcePublicMutationGuards } from '../../../src/lib/server/requestSecurity';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * POST /api/leads — progressive capture of an unfinished checkout.
 * Public, so it is origin-checked, rate limited per IP and per phone, honeypot-protected, and refuses
 * to store anything unless the client confirms the privacy notice was shown (consent: true).
 * It always answers quickly and never reveals whether a phone number was seen before.
 */
export async function POST(request: Request) {
  const guard = await enforcePublicMutationGuards(request);
  if (!guard.ok) {
    return NextResponse.json({ ok: false, code: guard.code, error: guard.error }, { status: guard.status, headers: NO_STORE });
  }

  const raw = await request.text().catch(() => '');
  if (raw.length > 4096) {
    return NextResponse.json({ ok: false, error: 'Payload too large.' }, { status: 413, headers: NO_STORE });
  }
  let body: unknown = null;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed JSON.' }, { status: 400, headers: NO_STORE });
  }

  const parsed = validateLeadCapture(body);
  if (!parsed.ok) {
    // Bots get a silent success so they learn nothing.
    if (parsed.code === 'bot') return NextResponse.json({ ok: true }, { headers: NO_STORE });
    return NextResponse.json({ ok: false, code: parsed.code, error: parsed.error }, { status: 400, headers: NO_STORE });
  }

  const ipHash = hashIdentifier(`lead:${extractClientIp(request)}`);
  const ipLimit = await checkAndIncrementFirestoreRateLimit(`lead_ip_${ipHash}`, 30, 10 * 60 * 1000);
  const phoneLimit = await checkAndIncrementFirestoreRateLimit(`lead_ph_${hashIdentifier(parsed.value.phone)}`, 12, 10 * 60 * 1000);
  if (!ipLimit.allowed || !phoneLimit.allowed) {
    return NextResponse.json({ ok: false, code: 'rate_limited' }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(Math.max(ipLimit.retryAfterSec, phoneLimit.retryAfterSec, 30)) } });
  }

  try {
    await upsertLead(parsed.value, ipHash);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof AdminSdkUnavailableError) {
      // Lead capture is best-effort; never surface an error to the shopper.
      return NextResponse.json({ ok: true, captured: false }, { headers: NO_STORE });
    }
    console.error('[leads] capture failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true, captured: false }, { headers: NO_STORE });
  }
}
