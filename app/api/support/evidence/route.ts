import { NextResponse } from 'next/server';
import {
  createServerSupportEvidence,
  fetchAdminSupportEvidence,
  verifyServerAdminToken,
} from '../../../../src/lib/chatbot/firestoreRest';
import { validateEvidenceUpload } from '../../../../src/lib/chatbot/supportEngine';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const adminCheck = await verifyServerAdminToken(request.headers.get('authorization'));
  if (!adminCheck.ok) {
    return NextResponse.json({ ok: false, error: 'Admin authorization required.' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const evidenceId = String(searchParams.get('evidenceId') || '').trim();
  if (!/^[a-zA-Z0-9_-]{4,96}$/.test(evidenceId)) {
    return NextResponse.json({ ok: false, error: 'Valid evidenceId is required.' }, { status: 400 });
  }

  const authHeader = request.headers.get('authorization') || '';
  const idToken = authHeader.slice(7).trim();
  const evidence = await fetchAdminSupportEvidence(evidenceId, idToken);
  if (!evidence) {
    return NextResponse.json({ ok: false, error: 'Evidence record not found.' }, { status: 404 });
  }

  return NextResponse.json(
    { ok: true, evidence },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json({ ok: false, error: 'Invalid request origin header.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const validated = validateEvidenceUpload({
    dataUrl: typeof body.dataUrl === 'string' ? body.dataUrl : undefined,
    mimeType: typeof body.mimeType === 'string' ? body.mimeType : undefined,
    dataBase64: typeof body.dataBase64 === 'string' ? body.dataBase64 : undefined,
    filename: typeof body.filename === 'string' ? body.filename : undefined,
  });

  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }

  const purposeRaw = String(body.purpose || 'general').trim();
  const purpose: 'damage_claim' | 'payment_dispute' | 'general' =
    purposeRaw === 'damage_claim' || purposeRaw === 'payment_dispute' ? purposeRaw : 'general';

  const saved = await createServerSupportEvidence({
    sessionId: String(body.sessionId || 'track_anon'),
    orderNumber: typeof body.orderNumber === 'string' ? body.orderNumber : undefined,
    mimeType: validated.mimeType,
    filename: validated.filename,
    sizeBytes: validated.sizeBytes,
    dataBase64: validated.dataBase64,
    purpose,
  });

  if (!saved.ok || !saved.evidenceId) {
    return NextResponse.json(
      { ok: false, error: saved.error || 'Could not store evidence securely.' },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      evidenceId: saved.evidenceId,
      filename: validated.filename,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      purpose,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
