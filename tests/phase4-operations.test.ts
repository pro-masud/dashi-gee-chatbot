import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { POST as manageOrderPost, GET as manageOrderGet } from '../app/api/orders/manage/route';
import {
  GET as refillDispatchGet,
  POST as refillDispatchPost,
} from '../app/api/orders/refill-reminder/dispatch/route';
import {
  getOrderStorageMemoryStateForTests,
  getRetentionMemoryStateForTests,
  setAdminAuthOverrideForTests,
  setOrderStorageMemoryModeForTests,
  setRetentionMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import {
  buildOrdersCsv,
  buildSupportTicketsCsv,
  computeSupportSlaAnalytics,
  escapeCsvCell,
} from '../src/lib/chatbot/supportEngine';
import { DEFAULT_CHATBOT_CONFIG } from '../src/lib/chatbot/types';
import { executeChatbotTool, type ToolRuntimeContext } from '../src/lib/gemini/tools';
import { DEFAULT_ACTIVE_BATCH, DEFAULT_STORE_SETTINGS } from '../src/lib/storeTypes';

const REAL_FETCH = globalThis.fetch;
const PREV_CRON_SECRET = process.env.CRON_SECRET;
const PREV_WA_WEBHOOK = process.env.WHATSAPP_WEBHOOK_URL;

function seedMemoryOrder(orderNumber: string, phone: string, status: 'confirmed' | 'shipped' | 'delivered' = 'confirmed') {
  const mem = getOrderStorageMemoryStateForTests()!;
  const nowIso = new Date().toISOString();
  mem.orders.set(orderNumber, {
    orderNumber,
    customerName: '=CMD|"/C calc"!A0',
    phone,
    district: 'Dhaka',
    area: 'Dhanmondi',
    address: 'House 12, Road 4, Dhanmondi',
    note: '',
    deliveryZone: 'dhaka',
    weight: '500g',
    qty: 1,
    qty250g: 0,
    qty500g: 1,
    qty1kg: 0,
    itemsSummary: '1x 500g Jar',
    unitPriceBdt: DEFAULT_STORE_SETTINGS.price500g,
    subtotalBdt: DEFAULT_STORE_SETTINGS.price500g,
    deliveryFeeBdt: DEFAULT_STORE_SETTINGS.insideDhakaFee,
    discountBdt: 0,
    totalBdt: DEFAULT_STORE_SETTINGS.price500g + DEFAULT_STORE_SETTINGS.insideDhakaFee,
    couponCode: '',
    paymentMethod: 'cod',
    paymentStatus: 'cod_due',
    txnId: '',
    paymentProofData: '',
    status,
    estimatedDelivery: DEFAULT_STORE_SETTINGS.estimatedDhakaDays,
    webhookStatus: 'skipped',
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  mem.tracking.set(`${orderNumber}_${phone}`, {
    orderNumber,
    weight: '500g',
    qty: 1,
    qty250g: 0,
    qty500g: 1,
    qty1kg: 0,
    itemsSummary: '1x 500g Jar',
    subtotalBdt: DEFAULT_STORE_SETTINGS.price500g,
    deliveryFeeBdt: DEFAULT_STORE_SETTINGS.insideDhakaFee,
    discountBdt: 0,
    couponCode: '',
    deliveryZone: 'dhaka',
    district: 'Dhaka',
    totalBdt: DEFAULT_STORE_SETTINGS.price500g + DEFAULT_STORE_SETTINGS.insideDhakaFee,
    paymentMethod: 'cod',
    paymentStatus: 'cod_due',
    status,
    estimatedDelivery: DEFAULT_STORE_SETTINGS.estimatedDhakaDays,
    updatedAt: nowIso,
  });
}

describe('Phase 4 — Courier Consignment, Automated Refill Dispatch, SLA Analytics & Formula-Safe CSV', () => {
  beforeEach(() => {
    setOrderStorageMemoryModeForTests(true);
    setRetentionMemoryModeForTests(true);
    setAdminAuthOverrideForTests(async (authHeader) => {
      if (authHeader === 'Bearer admin-valid-token') {
        return { ok: true, email: 'admin@deshigee.com', uid: 'admin-1' };
      }
      return { ok: false, email: '', uid: '' };
    });
    delete process.env.WHATSAPP_WEBHOOK_URL;
    process.env.CRON_SECRET = 'phase4-cron-secret-key-at-least-32-chars';
  });

  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
    setOrderStorageMemoryModeForTests(false);
    setRetentionMemoryModeForTests(false);
    setAdminAuthOverrideForTests(null);
    if (PREV_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = PREV_CRON_SECRET;
    if (PREV_WA_WEBHOOK === undefined) delete process.env.WHATSAPP_WEBHOOK_URL;
    else process.env.WHATSAPP_WEBHOOK_URL = PREV_WA_WEBHOOK;
  });

  it('T4.1: Rejects unauthorized or unsafe courier updates, persists valid courier assignment + audit log, and exposes it in chatbot get_order_status', async () => {
    seedMemoryOrder('DG-40101', '01711000401', 'confirmed');

    // 1. Unauthenticated caller denied
    const unauthRes = await manageOrderPost(
      new Request('http://localhost/api/orders/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          action: 'admin_update_courier',
          orderNumber: 'DG-40101',
          courierPartner: 'steadfast',
          consignmentId: 'SF-90011',
        }),
      })
    );
    assert.equal(unauthRes.status, 403);

    // 2. Reject javascript: / http:// tracking URL
    const unsafeUrlRes = await manageOrderPost(
      new Request('http://localhost/api/orders/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          Authorization: 'Bearer admin-valid-token',
        },
        body: JSON.stringify({
          action: 'admin_update_courier',
          orderNumber: 'DG-40101',
          courierPartner: 'steadfast',
          consignmentId: 'SF-90011',
          courierTrackingUrl: 'javascript:alert(1)',
        }),
      })
    );
    assert.equal(unsafeUrlRes.status, 400);
    const unsafeJson = await unsafeUrlRes.json();
    assert.equal(unsafeJson.code, 'invalid_tracking_url');

    // 3. Valid courier update auto-builds HTTPS tracking URL, promotes status to shipped, and writes courier_updated audit log
    const okRes = await manageOrderPost(
      new Request('http://localhost/api/orders/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          Authorization: 'Bearer admin-valid-token',
        },
        body: JSON.stringify({
          action: 'admin_update_courier',
          orderNumber: 'DG-40101',
          courierPartner: 'steadfast',
          consignmentId: 'SF-90011',
          markShipped: true,
        }),
      })
    );
    assert.equal(okRes.status, 200);
    const okJson = await okRes.json();
    assert.equal(okJson.ok, true);
    assert.equal(okJson.nextStatus, 'shipped');
    assert.equal(okJson.courierPartner, 'steadfast');
    assert.equal(okJson.consignmentId, 'SF-90011');
    assert.equal(okJson.courierTrackingUrl, 'https://steadfast.com.bd/t/SF-90011');
    assert.ok(okJson.dispatchedAtIso);

    // Verify audit log recorded
    const auditRes = await manageOrderGet(
      new Request('http://localhost/api/orders/manage?action=audit_logs&orderNumber=DG-40101', {
        headers: { Authorization: 'Bearer admin-valid-token' },
      })
    );
    const auditJson = await auditRes.json();
    assert.equal(auditJson.ok, true);
    assert.ok(
      auditJson.logs.some(
        (l: { action: string; nextStatus?: string }) =>
          l.action === 'courier_updated' && l.nextStatus === 'shipped'
      )
    );

    // 4. Chatbot get_order_status populates courier fields on trackingCard and emits open_url action
    const ctx: ToolRuntimeContext = {
      sessionId: 'sess_phase4_courier',
      replyLang: 'en',
      config: DEFAULT_CHATBOT_CONFIG,
      settings: DEFAULT_STORE_SETTINGS,
      batch: DEFAULT_ACTIVE_BATCH,
      faqs: [],
      kbDocs: [],
      isTestPlayground: false,
      collectedActions: [],
      orderState: 'collecting_details',
      handoverTriggered: false,
      detectedIntent: 'order_status',
      verifiedMonetaryAmounts: new Set<number>(),
    };
    const toolRes = await executeChatbotTool(
      'get_order_status',
      { order_id: 'DG-40101', phone: '01711000401' },
      ctx
    );
    assert.equal(toolRes.found, true);
    assert.equal(toolRes.courierPartner, 'steadfast');
    assert.equal(toolRes.consignmentId, 'SF-90011');
    assert.equal(toolRes.courierTrackingUrl, 'https://steadfast.com.bd/t/SF-90011');
    assert.equal(ctx.collectedTrackingCard?.courierPartner, 'steadfast');
    assert.equal(ctx.collectedTrackingCard?.consignmentId, 'SF-90011');
    assert.ok(
      ctx.collectedActions.some(
        (a) =>
          a.type === 'open_url' &&
          a.href === 'https://steadfast.com.bd/t/SF-90011'
      )
    );
  });

  it('T4.2: Authorizes Admin or CRON_SECRET for refill reminder dispatch, supports dryRun, skips paused/future items, and handles webhook success vs failure', async () => {
    const retention = getRetentionMemoryStateForTests()!;
    const now = new Date('2026-11-20T06:00:00.000Z');
    const dueIso = '2026-01-10T06:00:00.000Z';
    const futureIso = '2099-12-15T06:00:00.000Z';

    retention.refillReminders.set('DG-40201_01711000402', {
      id: 'DG-40201_01711000402',
      orderNumber: 'DG-40201',
      phone: '01711000402',
      customerName: 'Nusrat Jahan',
      weight: '500g',
      intervalDays: 30,
      status: 'active',
      consentGranted: true,
      nextReminderAtIso: dueIso,
      reminderCount: 0,
    });
    retention.refillReminders.set('DG-40202_01711000403', {
      id: 'DG-40202_01711000403',
      orderNumber: 'DG-40202',
      phone: '01711000403',
      customerName: 'Kamal Hossain',
      weight: '1kg',
      intervalDays: 60,
      status: 'active',
      consentGranted: true,
      nextReminderAtIso: futureIso,
      reminderCount: 1,
    });
    retention.refillReminders.set('DG-40203_01711000404', {
      id: 'DG-40203_01711000404',
      orderNumber: 'DG-40203',
      phone: '01711000404',
      customerName: 'Sadia Islam',
      weight: '250g',
      intervalDays: 45,
      status: 'paused',
      consentGranted: true,
      nextReminderAtIso: dueIso,
      reminderCount: 0,
    });

    // 1. Unauthorized denied
    const unauthGet = await refillDispatchGet(
      new Request('http://localhost/api/orders/refill-reminder/dispatch')
    );
    assert.equal(unauthGet.status, 403);

    // 2. Authorized Admin GET lists reminders & dueCount=1
    const adminGet = await refillDispatchGet(
      new Request('http://localhost/api/orders/refill-reminder/dispatch', {
        headers: { Authorization: 'Bearer admin-valid-token' },
      })
    );
    assert.equal(adminGet.status, 200);
    const listJson = await adminGet.json();
    assert.equal(listJson.reminders.length, 3);
    assert.equal(listJson.dueCount, 1);

    // 3. Dry run with CRON_SECRET evaluates without mutating state
    const dryRes = await refillDispatchPost(
      new Request('http://localhost/api/orders/refill-reminder/dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'phase4-cron-secret-key-at-least-32-chars',
        },
        body: JSON.stringify({ dryRun: true, nowIso: now.toISOString() }),
      })
    );
    assert.equal(dryRes.status, 200);
    const dryJson = await dryRes.json();
    assert.equal(dryJson.dueCount, 1);
    assert.equal(dryJson.dispatchedCount, 0);
    assert.equal(dryJson.items[0].status, 'dry_run_due');
    assert.equal(
      retention.refillReminders.get('DG-40201_01711000402')?.nextReminderAtIso,
      dueIso
    );

    // 4. Failed webhook prevents schedule advancement so reminder remains retryable
    process.env.WHATSAPP_WEBHOOK_URL = 'https://hooks.example.test/refill';
    globalThis.fetch = (async () => new Response('down', { status: 500 })) as typeof fetch;

    const failRes = await refillDispatchPost(
      new Request('http://localhost/api/orders/refill-reminder/dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'phase4-cron-secret-key-at-least-32-chars',
        },
        body: JSON.stringify({ dryRun: false, nowIso: now.toISOString() }),
      })
    );
    assert.equal(failRes.status, 207);
    const failJson = await failRes.json();
    assert.equal(failJson.failedCount, 1);
    assert.equal(retention.refillReminders.get('DG-40201_01711000402')?.reminderCount, 0);

    // 5. Successful webhook dispatches due reminder and advances nextReminderAtIso + reminderCount
    const webhookPayloads: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      webhookPayloads.push(JSON.parse(String(init?.body || '{}')));
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    const okRes = await refillDispatchPost(
      new Request('http://localhost/api/orders/refill-reminder/dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'phase4-cron-secret-key-at-least-32-chars',
        },
        body: JSON.stringify({ dryRun: false, nowIso: now.toISOString() }),
      })
    );
    assert.equal(okRes.status, 200);
    const okJson = await okRes.json();
    assert.equal(okJson.dispatchedCount, 1);
    assert.equal(okJson.items[0].status, 'dispatched');
    assert.equal(webhookPayloads[0]?.orderNumber, 'DG-40201');
    const updatedDoc = retention.refillReminders.get('DG-40201_01711000402')!;
    assert.equal(updatedDoc.reminderCount, 1);
    assert.equal(updatedDoc.lastNotifiedAtIso, now.toISOString());
    assert.equal(
      updatedDoc.nextReminderAtIso,
      new Date(now.getTime() + 30 * 86_400_000).toISOString()
    );
  });

  it('T4.3: Computes accurate Support SLA analytics and exports formula-injection-safe Orders & Support CSVs', () => {
    const now = new Date('2026-11-20T12:00:00.000Z');
    const analytics = computeSupportSlaAnalytics(
      [
        // Met SLA, resolved in 30m, first reply in 10m
        {
          status: 'resolved',
          category: 'damaged_jar',
          createdAt: '2026-11-20T10:00:00.000Z',
          slaDueAtIso: '2026-11-20T10:30:00.000Z',
          firstRespondedAtIso: '2026-11-20T10:10:00.000Z',
          resolvedAtIso: '2026-11-20T10:30:00.000Z',
        },
        // Open and SLA breached (due at 11:00, now 12:00)
        {
          status: 'escalated',
          category: 'payment_dispute',
          createdAt: '2026-11-20T10:30:00.000Z',
          slaDueAtIso: '2026-11-20T11:00:00.000Z',
        },
        // Replied late (first reply at 11:20 after 11:00 SLA), resolved
        {
          status: 'resolved',
          category: 'late_delivery',
          createdAt: '2026-11-20T09:00:00.000Z',
          slaDueAtIso: '2026-11-20T11:00:00.000Z',
          firstRespondedAtIso: '2026-11-20T11:20:00.000Z',
          resolvedAtIso: '2026-11-20T11:40:00.000Z',
        },
      ],
      now
    );

    assert.equal(analytics.totalTickets, 3);
    assert.equal(analytics.openCount, 1);
    assert.equal(analytics.resolvedCount, 2);
    assert.equal(analytics.escalatedCount, 1);
    assert.equal(analytics.breachedCount, 2);
    assert.equal(analytics.slaMetCount, 1);
    assert.equal(analytics.slaMeasuredCount, 3);
    assert.equal(analytics.slaCompliancePct, 33);
    assert.equal(analytics.avgFirstResponseMinutes, 75);
    assert.equal(analytics.avgResolutionMinutes, 95);

    // Formula injection neutralization checks
    assert.equal(escapeCsvCell('=1+1'), "'=1+1");
    assert.equal(escapeCsvCell('+8801711'), "'+8801711");
    assert.equal(escapeCsvCell('-cmd'), "'-cmd");
    assert.equal(escapeCsvCell('@SUM(A1:A2)'), "'@SUM(A1:A2)");
    assert.equal(escapeCsvCell('\t=2+2'), "'\t=2+2");
    assert.equal(escapeCsvCell('Dhaka, Gulshan'), '"Dhaka, Gulshan"');

    seedMemoryOrder('DG-40301', '01711000405', 'shipped');
    const memOrder = getOrderStorageMemoryStateForTests()!.orders.get('DG-40301')!;
    memOrder.courierPartner = 'redx';
    memOrder.consignmentId = 'RX-7721';
    const ordersCsv = buildOrdersCsv([memOrder]);
    assert.ok(ordersCsv.includes('courierPartner,consignmentId,courierTrackingUrl'));
    assert.ok(ordersCsv.includes("'=CMD|\"\"/C calc\"\"!A0"));
    assert.ok(ordersCsv.includes(',redx,RX-7721,'));

    const ticketsCsv = buildSupportTicketsCsv([
      {
        id: 'sup_1',
        ticketNumber: 'TK-1001',
        status: 'open',
        priority: 'urgent',
        category: 'damaged_jar',
        customerName: '+Malicious',
        phone: '01711000405',
        issueSummary: '=HYPERLINK("https://evil.test","click")',
        tags: ['damaged', 'urgent'],
        aiPaused: true,
      },
    ]);
    assert.ok(ticketsCsv.includes("'+Malicious"));
    assert.ok(ticketsCsv.includes('"\'=HYPERLINK'));
  });
});
