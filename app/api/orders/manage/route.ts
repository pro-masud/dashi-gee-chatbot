import { NextResponse } from 'next/server';
import {
  fetchServerOrderAuditLogs,
  manageServerOrder,
  verifyServerAdminToken,
} from '../../../../src/lib/chatbot/firestoreRest';
import { normalizeBangladeshPhone } from '../../../../src/lib/chatbot/orderToken';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'audit_logs';
  const orderNumber = String(searchParams.get('orderNumber') || '').trim().toUpperCase();

  if (action === 'audit_logs') {
    const admin = await verifyServerAdminToken(request.headers.get('authorization'));
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: 'Admin authorization required.' }, { status: 403 });
    }
    const authHeader = request.headers.get('authorization') || '';
    const idToken = authHeader.slice(7).trim();
    const logs = await fetchServerOrderAuditLogs(orderNumber, idToken);
    return NextResponse.json({ ok: true, logs });
  }

  return NextResponse.json({ ok: false, error: 'Unsupported action.' }, { status: 400 });
}

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json({ ok: false, error: 'Invalid request origin header.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '').trim();
  const orderNumber = String(body.orderNumber || '').trim().toUpperCase();
  const phone = normalizeBangladeshPhone(String(body.phone || ''));
  const district = String(body.district || '').trim();
  const area = String(body.area || '').trim();
  const address = String(body.address || '').trim();
  const reason = String(body.reason || '').trim();

  const isAdminOp =
    action === 'admin_review_approve' ||
    action === 'admin_review_reject' ||
    action === 'admin_cancel';

  if (isAdminOp) {
    const authHeader = request.headers.get('authorization');
    const admin = await verifyServerAdminToken(authHeader);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: 'Admin authorization required.' }, { status: 403 });
    }
    const idToken = authHeader ? authHeader.slice(7).trim() : '';
    const result = await manageServerOrder({
      action: action as 'admin_review_approve' | 'admin_review_reject' | 'admin_cancel',
      orderNumber,
      reason,
      adminIdToken: idToken,
      actorEmail: admin.email,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (action !== 'check' && action !== 'cancel' && action !== 'edit_address') {
    return NextResponse.json(
      { ok: false, eligible: false, error: 'Unsupported manage order action.' },
      { status: 400 }
    );
  }

  const result = await manageServerOrder({
    action,
    orderNumber,
    phone,
    district,
    area,
    address,
    reason,
  });

  const statusCode = result.ok
    ? 200
    : result.code === 'post_dispatch_locked'
      ? 409
      : result.code === 'order_not_found'
        ? 404
        : 400;

  return NextResponse.json(result, { status: statusCode });
}
