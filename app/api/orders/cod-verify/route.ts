import { NextResponse } from 'next/server';
import { getCodVerificationProvider, normalizeBangladeshPhone } from '../../../../src/lib/chatbot/orderToken';
import { checkAndIncrementFirestoreRateLimit } from '../../../../src/lib/chatbot/firestoreRest';
import { extractClientIp, hashIdentifier } from '../../../../src/lib/chatbot/rateLimit';
import { enforcePublicMutationGuards } from '../../../../src/lib/server/requestSecurity';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const guard = await enforcePublicMutationGuards(request);
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, code: guard.code, error: guard.error },
      { status: guard.status }
    );
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || 'status').trim();
  const orderNumber = String(body.orderNumber || '').trim().toUpperCase();
  const phone = normalizeBangladeshPhone(String(body.phone || ''));
  const code = String(body.code || '').trim();

  const provider = getCodVerificationProvider();

  if (action === 'status') {
    return NextResponse.json({
      ok: true,
      providerConfigured: provider.providerConfigured,
      providerName: provider.providerName,
      status: provider.providerConfigured ? 'ready' : 'not_configured',
    });
  }

  // Throttle only the actions that can send an SMS/OTP or guess a code.
  if (action === 'initiate' || action === 'confirm') {
    const ipHash = hashIdentifier(`cod_verify:${extractClientIp(request)}`);
    const targetHash = hashIdentifier(`cod_verify_target:${orderNumber}:${phone}`);
    const limits: [string, number, number][] =
      action === 'initiate'
        ? [
            [`codv_ip_${ipHash}`, 10, 10 * 60 * 1000],
            [`codv_init_${targetHash}`, 3, 10 * 60 * 1000],
          ]
        : [
            [`codv_ip_${ipHash}`, 30, 10 * 60 * 1000],
            [`codv_conf_${targetHash}`, 5, 10 * 60 * 1000],
          ];
    for (const [key, max, windowMs] of limits) {
      const rl = await checkAndIncrementFirestoreRateLimit(key, max, windowMs);
      if (!rl.allowed) {
        return NextResponse.json(
          { ok: false, code: 'rate_limited', error: 'Too many verification attempts. Please try again later.' },
          { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
        );
      }
    }
  }

  if (action === 'initiate') {
    const res = await provider.initiateVerification({ orderNumber, phone });
    return NextResponse.json({
      ...res,
      providerConfigured: provider.providerConfigured,
    });
  }

  if (action === 'confirm') {
    const res = await provider.confirmVerificationCode({ orderNumber, phone, code });
    return NextResponse.json({
      ...res,
      providerConfigured: provider.providerConfigured,
    });
  }

  return NextResponse.json({ ok: false, error: 'Unsupported action.' }, { status: 400 });
}
