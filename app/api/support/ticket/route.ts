import { NextResponse } from 'next/server';
import {
  createServerSupportRequest,
  fetchServerChatbotConfig,
  fetchServerOrderTracking,
} from '../../../../src/lib/chatbot/firestoreRest';
import { normalizeBangladeshPhone } from '../../../../src/lib/chatbot/orderToken';
import { computeSupportSlaTarget } from '../../../../src/lib/chatbot/supportEngine';
import type { SupportCategory, SupportPriority } from '../../../../src/lib/chatbot/types';
import { publishBusinessEventSafe } from '../../../../src/lib/notifications/engine';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES: readonly SupportCategory[] = [
  'damaged_jar',
  'payment_dispute',
  'late_delivery',
  'refund_return',
  'bulk_order',
  'general',
];

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json({ ok: false, error: 'Invalid request origin header.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const consentGranted = body.consentGranted === true;
  if (!consentGranted) {
    return NextResponse.json(
      {
        ok: false,
        code: 'consent_required',
        error: 'Explicit customer consent is required before creating a human support ticket.',
      },
      { status: 400 }
    );
  }

  const sessionId = String(body.sessionId || `track_${Date.now()}`).trim().slice(0, 64);
  const customerName = String(body.customerName || '').trim();
  const phone = normalizeBangladeshPhone(String(body.phone || ''));
  const issueSummary = String(body.issueSummary || '').trim();
  const orderNumber = String(body.orderNumber || '').trim().toUpperCase();

  if (customerName.length < 2 || issueSummary.length < 4 || !/^01[3-9][0-9]{8}$/.test(phone)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_input',
        error: 'Valid customer name, 11-digit phone (01XXXXXXXXX), and issue summary are required.',
      },
      { status: 400 }
    );
  }

  const categoryRaw = String(body.category || 'general').trim() as SupportCategory;
  const category: SupportCategory = VALID_CATEGORIES.includes(categoryRaw) ? categoryRaw : 'general';
  const priorityRaw = String(body.priority || '').trim();
  const priority: SupportPriority =
    priorityRaw === 'urgent' ||
    category === 'damaged_jar' ||
    category === 'payment_dispute' ||
    category === 'late_delivery'
      ? priorityRaw === 'standard'
        ? 'standard'
        : 'urgent'
      : 'standard';

  let orderStatusSnapshot = '';
  let paymentStatusSnapshot = '';

  if (orderNumber) {
    if (!/^DG-[0-9]{4,8}$/.test(orderNumber)) {
      return NextResponse.json(
        { ok: false, code: 'invalid_order_number', error: 'Invalid order number format (expected DG-XXXXX).' },
        { status: 400 }
      );
    }
    const tracking = await fetchServerOrderTracking(orderNumber, phone);
    if (!tracking) {
      return NextResponse.json(
        {
          ok: false,
          code: 'order_verification_failed',
          error: 'Could not match that Order ID with the provided mobile number.',
        },
        { status: 404 }
      );
    }
    orderStatusSnapshot = tracking.status;
    paymentStatusSnapshot = tracking.paymentStatus;
  }

  const config = await fetchServerChatbotConfig('published');
  const sla = computeSupportSlaTarget({ config, priority });

  const evidenceIds = Array.isArray(body.evidenceIds)
    ? body.evidenceIds
        .map((id: unknown) => String(id || '').trim())
        .filter((id: string) => /^[a-zA-Z0-9_-]{4,96}$/.test(id))
        .slice(0, 6)
    : [];

  const created = await createServerSupportRequest({
    sessionId,
    customerName,
    phone,
    issueSummary,
    orderNumber: orderNumber || undefined,
    category,
    priority,
    contextSummary: typeof body.contextSummary === 'string' ? body.contextSummary : undefined,
    transcriptExcerpt: typeof body.transcriptExcerpt === 'string' ? body.transcriptExcerpt : undefined,
    consentGranted: true,
    evidenceIds,
    paymentStatusSnapshot: paymentStatusSnapshot || undefined,
    orderStatusSnapshot: orderStatusSnapshot || undefined,
    slaMinutes: sla.slaMinutes,
    slaDueAtIso: sla.slaDueAtIso,
    slaWindowLabelEn: sla.expectationEn,
    slaWindowLabelBn: sla.expectationBn,
  });

  if (!created.ok) {
    return NextResponse.json(
      { ok: false, error: created.error || 'Could not create support ticket.' },
      { status: 500 }
    );
  }

  void publishBusinessEventSafe({
    type: 'SUPPORT_REQUESTED',
    idempotencyKey: `support_ticket_${created.ticketNumber || created.requestId}`,
    title: `Support Ticket ${created.ticketNumber || created.requestId}`,
    summary: `[${category.replace(/_/g, ' ')}] ${issueSummary}`,
    ticketId: created.ticketNumber || created.requestId,
    orderNumber: orderNumber || undefined,
    customerName,
    customerPhone: phone,
    priority: priority === 'urgent' ? 'urgent' : 'normal',
    adminPath: '/admin',
  });

  return NextResponse.json(
    {
      ok: true,
      requestId: created.requestId,
      ticketNumber: created.ticketNumber,
      priority,
      category,
      sla,
      orderStatusSnapshot,
      paymentStatusSnapshot,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
