import { NextResponse } from 'next/server';
import { getCodVerificationProvider, normalizeBangladeshPhone } from '../../../../src/lib/chatbot/orderToken';

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json({ ok: false, error: 'Invalid request origin header.' }, { status: 403 });
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
