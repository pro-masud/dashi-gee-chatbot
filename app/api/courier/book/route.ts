import { NextResponse } from 'next/server';
import {
  fetchServerOrderForAdmin,
  manageServerOrder,
  verifyServerAdminToken,
} from '../../../../src/lib/chatbot/firestoreRest';
import { bookCourierParcel } from '../../../../src/lib/integrations/courierApi';

export const dynamic = 'force-dynamic';

const inFlightCourierBookings = new Set<string>();

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
    recipientCityId?: number;
    recipientZoneId?: number;
    deliveryAreaId?: number;
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

  // S0-07: Idempotent booking — never call the carrier API a second time if a consignment already exists.
  if (order.consignmentId && String(order.consignmentId).trim().length > 0) {
    const existingPartner = order.courierPartner || partnerRaw;
    return NextResponse.json(
      {
        ok: true,
        idempotentReplay: true,
        partner: existingPartner,
        consignmentId: order.consignmentId,
        courierTrackingUrl: order.courierTrackingUrl || '',
        dispatchedAtIso: order.dispatchedAtIso || '',
        nextStatus: order.status,
        messageEn: `Already booked via ${String(existingPartner).toUpperCase()} · Consignment ${order.consignmentId} (no duplicate parcel created).`,
        messageBn: `${String(existingPartner).toUpperCase()}-এ ইতিমধ্যেই বুক করা আছে · কনসাইনমেন্ট ${order.consignmentId}।`,
      },
      { status: 200 }
    );
  }

  if (inFlightCourierBookings.has(orderNumber)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'booking_in_progress',
        error: `Courier booking for ${orderNumber} is already in progress.`,
      },
      { status: 409 }
    );
  }

  inFlightCourierBookings.add(orderNumber);
  try {
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
      recipientCityId:
        typeof body.recipientCityId === 'number' ? body.recipientCityId : undefined,
      recipientZoneId:
        typeof body.recipientZoneId === 'number' ? body.recipientZoneId : undefined,
      deliveryAreaId:
        typeof body.deliveryAreaId === 'number' ? body.deliveryAreaId : undefined,
    });

    if (!booking.ok || !booking.consignmentId) {
      const errStatus =
        booking.code === 'courier_not_configured'
          ? 503
          : booking.code === 'pathao_location_ids_required' ||
              booking.code === 'redx_area_id_required'
            ? 400
            : 502;
      return NextResponse.json(booking, { status: errStatus });
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
        idempotentReplay: false,
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
  } finally {
    inFlightCourierBookings.delete(orderNumber);
  }
}
