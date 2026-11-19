import { NextResponse } from 'next/server';
import {
  fetchServerOrderAuditLogs,
  manageServerOrder,
  verifyServerAdminToken,
} from '../../../../src/lib/chatbot/firestoreRest';
import {
  consumeSignedOrderManageToken,
  normalizeBangladeshPhone,
  verifySignedOrderManageToken,
} from '../../../../src/lib/chatbot/orderToken';

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
  const actionToken = String(body.actionToken || '').trim();
  const sessionId = String(body.sessionId || '').trim();

  // Item 5: Signed single-use HMAC action token path for chat Confirm-button cancel / address-edit.
  if (actionToken) {
    if (!sessionId) {
      return NextResponse.json(
        { ok: false, eligible: false, code: 'session_required', error: 'Session ID is required for confirmed chat actions.' },
        { status: 400 }
      );
    }

    const verified = verifySignedOrderManageToken({
      token: actionToken,
      sessionId,
    });
    if (!verified.ok) {
      const status =
        verified.reason === 'token_already_used'
          ? 409
          : verified.reason === 'session_mismatch'
            ? 403
            : verified.reason === 'order_secret_missing'
              ? 503
              : 400;
      return NextResponse.json(
        {
          ok: false,
          eligible: false,
          code: verified.reason,
          error:
            verified.reason === 'token_already_used'
              ? 'This confirmation token has already been used.'
              : verified.reason === 'expired_token'
                ? 'This confirmation card has expired. Please request a fresh proposal.'
                : verified.reason === 'session_mismatch'
                  ? 'Confirmation token does not match this chat session.'
                  : 'Invalid or tampered order confirmation token.',
        },
        { status }
      );
    }

    const consumed = consumeSignedOrderManageToken(verified.payload);
    if (!consumed) {
      return NextResponse.json(
        { ok: false, eligible: false, code: 'token_already_used', error: 'Confirmation token already consumed.' },
        { status: 409 }
      );
    }

    const p = verified.payload;
    const result = await manageServerOrder({
      action: p.action,
      orderNumber: p.orderNumber,
      phone: p.phone,
      district: p.district,
      area: p.area,
      address: p.address,
      reason: p.reason,
    });

    const statusCode = result.ok
      ? 200
      : result.code === 'post_dispatch_locked'
        ? 409
        : result.code === 'order_not_found'
          ? 404
          : 400;

    return NextResponse.json({ ...result, confirmedViaToken: true }, { status: statusCode });
  }

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
    action === 'admin_cancel' ||
    action === 'admin_update_courier';

  if (isAdminOp) {
    const authHeader = request.headers.get('authorization');
    const admin = await verifyServerAdminToken(authHeader);
    if (!admin.ok) {
      return NextResponse.json({ ok: false, error: 'Admin authorization required.' }, { status: 403 });
    }
    const idToken = authHeader ? authHeader.slice(7).trim() : '';
    const result = await manageServerOrder({
      action: action as
        | 'admin_review_approve'
        | 'admin_review_reject'
        | 'admin_cancel'
        | 'admin_update_courier',
      orderNumber,
      reason,
      courierPartner: body.courierPartner,
      consignmentId: typeof body.consignmentId === 'string' ? body.consignmentId : undefined,
      courierTrackingUrl:
        typeof body.courierTrackingUrl === 'string' ? body.courierTrackingUrl : undefined,
      markShipped: typeof body.markShipped === 'boolean' ? body.markShipped : undefined,
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
