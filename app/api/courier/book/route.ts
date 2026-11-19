import { NextResponse } from 'next/server';
import {
  fetchServerOrderForAdmin,
  manageServerOrder,
  verifyServerAdminToken,
} from '../../../../src/lib/chatbot/firestoreRest';
import { bookCourierParcel } from '../../../../src/lib/integrations/courierApi';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json(
      { ok: false, error: 'Invalid request origin header.' },
      { status: 403 }
    );
  }

  const authHeader = request.headers.get('authorization');
  const admin = await verifyServerAdminToken(authHeader);
  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, error: 'Admin authorization required.' },
      { status: 403 }
    );
  }

  let body: {
    orderNumber?: string;
    partner?: string;
    markShipped?: boolean;
    note?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed JSON body.' }, { status: 400 });
  }

  const orderNumber = String(body.orderNumber || '').trim().toUpperCase();
  const partnerRaw = String(body.partner || '').trim().toLowerCase();
  if (partnerRaw !== 'steadfast' && partnerRaw !== 'pathao' && partnerRaw !== 'redx') {
    return NextResponse.json(
      { ok: false, error: 'Live API booking supports steadfast, pathao, or redx.' },
      { status: 400 }
    );
  }

  const adminIdToken = authHeader ? authHeader.slice(7).trim() : '';
  const order = await fetchServerOrderForAdmin(orderNumber, adminIdToken);
  if (!order) {
    return NextResponse.json(
      { ok: false, error: `Order ${orderNumber} not found.` },
      { status: 404 }
    );
  }

  if (order.status === 'cancelled' || order.status === 'delivered') {
    return NextResponse.json(
      { ok: false, error: `Cannot book courier for ${order.status} order.` },
      { status: 409 }
    );
  }

  const weightGrams =
    (Number(order.qty250g || 0) * 250 +
      Number(order.qty500g || 0) * 500 +
      Number(order.qty1kg || 0) * 1000) ||
    500;
  const codAmountBdt = order.paymentStatus === 'verified' ? 0 : Number(order.totalBdt || 0);

  const booking = await bookCourierParcel({
    partner: partnerRaw,
    orderNumber: order.orderNumber,
    recipientName: order.customerName,
    recipientPhone: order.phone,
    recipientAddress: order.address,
    recipientDistrict: order.district,
    recipientArea: order.area,
    codAmountBdt,
    weightGrams,
    note: body.note || order.note,
  });

  if (!booking.ok || !booking.consignmentId) {
    return NextResponse.json(booking, {
      status: booking.code === 'courier_not_configured' ? 503 : 502,
    });
  }

  const persisted = await manageServerOrder({
    action: 'admin_update_courier',
    orderNumber: order.orderNumber,
    courierPartner: partnerRaw,
    consignmentId: booking.consignmentId,
    courierTrackingUrl: booking.courierTrackingUrl,
    markShipped: body.markShipped !== false,
    adminIdToken,
    actorEmail: admin.email,
  });

  return NextResponse.json(
    {
      ok: persisted.ok,
      partner: partnerRaw,
      consignmentId: booking.consignmentId,
      courierTrackingUrl: booking.courierTrackingUrl || persisted.courierTrackingUrl,
      dispatchedAtIso: persisted.dispatchedAtIso,
      nextStatus: persisted.nextStatus,
      rawStatus: booking.rawStatus,
      messageEn: `Booked via ${partnerRaw.toUpperCase()} API · Consignment ${booking.consignmentId}`,
      messageBn: `${partnerRaw.toUpperCase()} API-এ পার্সেল বুক হয়েছে · কনসাইনমেন্ট ${booking.consignmentId}`,
    },
    { status: persisted.ok ? 200 : 500 }
  );
}
