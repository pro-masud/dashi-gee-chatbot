import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { POST as chatPost } from '../app/api/chat/route';
import { GET as chatSessionGet } from '../app/api/chat/session/route';
import { SESSION_COOKIE_NAME, signSessionCookieValue } from '../src/lib/chatbot/sessionAuth';
import { POST as adminInboxPost } from '../app/api/chatbot/admin/route';
import { POST as refillReminderPost, GET as refillReminderGet } from '../app/api/orders/refill-reminder/route';
import { POST as reorderPost } from '../app/api/orders/reorder/route';
import { POST as reviewPost } from '../app/api/orders/review/route';
import { GET as evidenceGet, POST as evidencePost } from '../app/api/support/evidence/route';
import { POST as ticketPost } from '../app/api/support/ticket/route';
import {
  getOrderStorageMemoryStateForTests,
  getRetentionMemoryStateForTests,
  getSupportInboxMemoryStateForTests,
  setAdminAuthOverrideForTests,
  setChatLogObserverForTests,
  setFirestoreHealthOverrideForTests,
  setInventoryMemoryModeForTests,
  setKnowledgeChunkTestStore,
  setOrderStorageMemoryModeForTests,
  setRateLimitMemoryModeForTests,
  setRetentionMemoryModeForTests,
  setSessionDraftMemoryModeForTests,
  setSupportInboxMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import { classifyTurnIntent } from '../src/lib/chatbot/intentRouter';
import { resetDevOrderTokenSecretForTests } from '../src/lib/chatbot/orderToken';
import { validateChatbotResponse } from '../src/lib/chatbot/responseValidator';
import { buildStoreFactsSnapshot, getSeededVerifiedMonetaryAmounts } from '../src/lib/chatbot/storeFacts';
import {
  computeSupportSlaTarget,
  detectMagicBytesMime,
  evaluateOrderDelayStatus,
  formatPaymentClarification,
  validateEvidenceUpload,
} from '../src/lib/chatbot/supportEngine';
import { DEFAULT_CHATBOT_CONFIG } from '../src/lib/chatbot/types';
import { clearGeminiHealthCacheForTests, setGeminiClientFactoryForTests } from '../src/lib/gemini/client';
import { DEFAULT_ACTIVE_BATCH, DEFAULT_STORE_SETTINGS } from '../src/lib/storeTypes';

const REAL_FETCH = globalThis.fetch;

// Minimal valid PNG (64 bytes, magic header 89 50 4E 47 0D 0A 1A 0A)
const VALID_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
]);
const VALID_PNG_DATA_URL = `data:image/png;base64,${Buffer.from(VALID_PNG_BYTES).toString('base64')}`;

function installPhase3FetchStub() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('firestore.googleapis.com')) {
      return new Response(JSON.stringify({ error: { code: 404 } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return REAL_FETCH(input);
  }) as typeof fetch;
}

async function parseNdjson(res: Response) {
  const raw = await res.text();
  let text = '';
  let meta: Record<string, unknown> | null = null;
  for (const line of raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const ev = JSON.parse(line) as Record<string, unknown>;
    if (ev.type === 'delta' && typeof ev.text === 'string') text += ev.text;
    if (ev.type === 'meta') meta = ev;
  }
  return { status: res.status, text, meta };
}

function seedOrder(params: {
  orderNumber: string;
  phone: string;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  paymentMethod?: 'cod' | 'bkash' | 'nagad';
  paymentStatus?: 'cod_due' | 'pending_verification' | 'verified' | 'failed';
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  deliveryZone?: 'dhaka' | 'suburban' | 'nationwide' | 'remote';
  createdAt?: string;
}) {
  const mem = getOrderStorageMemoryStateForTests()!;
  const q250 = params.qty250g ?? 0;
  const q1k = params.qty1kg ?? 0;
  const q500 = params.qty500g ?? (q250 > 0 || q1k > 0 ? 0 : 1);
  const weight = q1k > 0 ? '1kg' : q500 > 0 ? '500g' : '250g';
  const qty = q250 + q500 + q1k || 1;
  const subtotalBdt =
    q250 * DEFAULT_STORE_SETTINGS.price250g +
    q500 * DEFAULT_STORE_SETTINGS.price500g +
    q1k * DEFAULT_STORE_SETTINGS.price1kg;
  const fee = params.deliveryZone === 'dhaka' ? 70 : 120;
  const totalBdt = subtotalBdt + fee;
  const paymentMethod = params.paymentMethod || 'cod';
  const paymentStatus =
    params.paymentStatus || (paymentMethod === 'cod' ? 'cod_due' : 'pending_verification');

  mem.orders.set(params.orderNumber, {
    orderNumber: params.orderNumber,
    customerName: 'Tarek Rahman',
    phone: params.phone,
    district: params.deliveryZone === 'dhaka' ? 'Dhaka' : 'Bogura',
    area: 'Dhanmondi',
    address: 'House 14, Road 6',
    deliveryZone: params.deliveryZone || 'dhaka',
    weight,
    qty,
    qty250g: q250,
    qty500g: q500,
    qty1kg: q1k,
    itemsSummary: `${qty}x ${weight} Jar`,
    unitPriceBdt:
      weight === '1kg'
        ? DEFAULT_STORE_SETTINGS.price1kg
        : weight === '500g'
          ? DEFAULT_STORE_SETTINGS.price500g
          : DEFAULT_STORE_SETTINGS.price250g,
    subtotalBdt,
    deliveryFeeBdt: fee,
    discountBdt: 0,
    totalBdt,
    couponCode: '',
    paymentMethod,
    paymentStatus,
    txnId: paymentMethod === 'cod' ? '' : 'TXN123456',
    paymentProofData: '',
    note: '',
    status: params.status,
    estimatedDelivery: 'Within 24-48 hours',
    webhookStatus: 'skipped',
    createdAt: params.createdAt || new Date().toISOString(),
  });

  mem.tracking.set(`${params.orderNumber}_${params.phone}`, {
    orderNumber: params.orderNumber,
    weight,
    qty,
    qty250g: q250,
    qty500g: q500,
    qty1kg: q1k,
    itemsSummary: `${qty}x ${weight} Jar`,
    district: params.deliveryZone === 'dhaka' ? 'Dhaka' : 'Bogura',
    deliveryZone: params.deliveryZone || 'dhaka',
    subtotalBdt,
    deliveryFeeBdt: fee,
    discountBdt: 0,
    totalBdt,
    paymentMethod,
    paymentStatus,
    status: params.status,
    estimatedDelivery: 'Within 24-48 hours',
    updatedAt: params.createdAt || new Date().toISOString(),
  });
}

describe('Phase 3 (T3.1-T3.3) — Post-Purchase Support, Evidence Privacy, BST SLA, Human Inbox & After-Delivery Retention', () => {
  beforeEach(() => {
    installPhase3FetchStub();
    delete process.env.GEMINI_API_KEY;
    clearGeminiHealthCacheForTests();
    setGeminiClientFactoryForTests(null);
    setChatLogObserverForTests(null);
    setKnowledgeChunkTestStore([]);
    setRateLimitMemoryModeForTests(true);
    setSessionDraftMemoryModeForTests(true);
    setInventoryMemoryModeForTests({});
    setOrderStorageMemoryModeForTests(true);
    setSupportInboxMemoryModeForTests(true);
    setRetentionMemoryModeForTests(true);
    setAdminAuthOverrideForTests(async (authHeader) =>
      authHeader === 'Bearer admin_token_valid'
        ? { ok: true, email: 'kinboni.bd@gmail.com', uid: 'uid_admin_p3' }
        : { ok: false, email: '', uid: '' }
    );
    setFirestoreHealthOverrideForTests(async () => ({
      reachable: true,
      latencyMs: 3,
      detail: 'mock',
    }));
  });

  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
    clearGeminiHealthCacheForTests();
    setGeminiClientFactoryForTests(null);
    setChatLogObserverForTests(null);
    setKnowledgeChunkTestStore(null);
    setRateLimitMemoryModeForTests(false);
    setSessionDraftMemoryModeForTests(false);
    setInventoryMemoryModeForTests(null);
    setOrderStorageMemoryModeForTests(false);
    setSupportInboxMemoryModeForTests(false);
    setRetentionMemoryModeForTests(false);
    setAdminAuthOverrideForTests(null);
    setFirestoreHealthOverrideForTests(null);
    resetDevOrderTokenSecretForTests();
  });

  it('T3.1a: validates magic bytes & size limits on evidence uploads and restricts GET reads to Admin only', async () => {
    assert.equal(detectMagicBytesMime(VALID_PNG_BYTES), 'image/png');

    // Spoofed header claiming image/png with non-PNG payload must fail
    const spoofed = validateEvidenceUpload({
      mimeType: 'image/png',
      dataBase64: Buffer.from('not-actually-a-png-file-just-text-spoofing-1234567890').toString('base64'),
      filename: 'fake.png',
    });
    assert.equal(spoofed.ok, false);

    // Oversized base64 rejected
    const oversized = validateEvidenceUpload({
      mimeType: 'image/png',
      dataBase64: 'A'.repeat(730_000),
      filename: 'huge.png',
    });
    assert.equal(oversized.ok, false);

    // Missing origin header returns 403
    const badOriginRes = await evidencePost(
      new Request('http://localhost/api/support/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: VALID_PNG_DATA_URL }),
      })
    );
    assert.equal(badOriginRes.status, 403);

    // Valid upload creates private evidence record
    const uploadRes = await evidencePost(
      new Request('http://localhost/api/support/evidence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          sessionId: 'sess_ev_1',
          orderNumber: 'DG-30001',
          dataUrl: VALID_PNG_DATA_URL,
          filename: 'broken_jar.png',
          purpose: 'damage_claim',
        }),
      })
    );
    assert.equal(uploadRes.status, 200);
    const uploadJson = (await uploadRes.json()) as { ok: boolean; evidenceId: string };
    assert.equal(uploadJson.ok, true);
    assert.ok(uploadJson.evidenceId.startsWith('ev_'));

    // Unauthenticated GET must fail 401
    const unauthGet = await evidenceGet(
      new Request(`http://localhost/api/support/evidence?evidenceId=${uploadJson.evidenceId}`)
    );
    assert.equal(unauthGet.status, 401);

    // Admin GET returns full base64 evidence payload
    const adminGet = await evidenceGet(
      new Request(`http://localhost/api/support/evidence?evidenceId=${uploadJson.evidenceId}`, {
        headers: { Authorization: 'Bearer admin_token_valid' },
      })
    );
    assert.equal(adminGet.status, 200);
    const adminJson = (await adminGet.json()) as { ok: boolean; evidence: { mimeType: string; filename: string } };
    assert.equal(adminJson.ok, true);
    assert.equal(adminJson.evidence.mimeType, 'image/png');
    assert.equal(adminJson.evidence.filename, 'broken_jar.png');
  });

  it('T3.1b & T3.2b: computes accurate Asia/Dhaka BST SLA targets inside open hours, after closing, and on closed Fridays', () => {
    const cfg = {
      ...DEFAULT_CHATBOT_CONFIG,
      openHourBst: 9,
      closeHourBst: 21,
      closedDays: 'Friday',
      slaStandardMinutes: 120,
      slaUrgentMinutes: 30,
    };

    // Saturday 11:00 AM BST = 05:00 UTC (open now)
    const satMorningUtc = new Date('2026-11-14T05:00:00.000Z');
    const urgentOpen = computeSupportSlaTarget({
      config: cfg,
      priority: 'urgent',
      now: satMorningUtc,
    });
    assert.equal(urgentOpen.isOpenNow, true);
    assert.equal(urgentOpen.slaMinutes, 30);
    assert.equal(urgentOpen.slaDueAtIso, '2026-11-14T05:30:00.000Z');

    // Thursday 10:00 PM BST = 16:00 UTC (after close, and Friday is closed -> skips to Saturday 9:00 AM BST = 03:00 UTC)
    const thuNightUtc = new Date('2026-11-12T16:00:00.000Z');
    const stdAfterClose = computeSupportSlaTarget({ config: cfg, priority: 'standard', now: thuNightUtc });
    assert.equal(stdAfterClose.isOpenNow, false);
    assert.equal(stdAfterClose.slaMinutes, 120);
    assert.match(stdAfterClose.nextOpenLabelEn, /Saturday 9:00 AM BST/);
    // Saturday 09:00 BST (03:00Z) + 120m = 05:00Z
    assert.equal(stdAfterClose.slaDueAtIso, '2026-11-14T05:00:00.000Z');
  });

  it('T3.1c: evaluates delivery delay windows and formats honest payment clarification statuses', () => {
    const oldTs = new Date(Date.now() - 80 * 3_600_000).toISOString();
    const delay = evaluateOrderDelayStatus({
      status: 'shipped',
      estimatedDelivery: 'Within 24-48 hours',
      deliveryZone: 'dhaka',
      createdAt: oldTs,
    });
    assert.equal(delay.isDelayed, true);
    assert.equal(delay.recommendEscalation, true);
    assert.ok(delay.elapsedHours >= 79);

    const pendingPay = formatPaymentClarification('bkash', 'pending_verification', DEFAULT_STORE_SETTINGS, 'en');
    assert.equal(pendingPay.canEscalateDispute, true);
    assert.match(pendingPay.detail, /manually reconciles/i);

    const verifiedPay = formatPaymentClarification('nagad', 'verified', DEFAULT_STORE_SETTINGS, 'bn');
    assert.equal(verifiedPay.canEscalateDispute, false);
    assert.match(verifiedPay.headline, /যাচাইকৃত/);
  });

  it('T3.1d: blocks ungrounded refund/replacement/payment-verified hallucinations in responseValidator', () => {
    const facts = buildStoreFactsSnapshot({
      settings: DEFAULT_STORE_SETTINGS,
      batch: DEFAULT_ACTIVE_BATCH,
      config: DEFAULT_CHATBOT_CONFIG,
    });
    const amounts = Array.from(getSeededVerifiedMonetaryAmounts(facts));

    const ungroundedRefund = validateChatbotResponse({
      replyText: 'Your refund has been approved and will reach your bKash today.',
      replyLang: 'en',
      settings: DEFAULT_STORE_SETTINGS,
      config: DEFAULT_CHATBOT_CONFIG,
      verifiedMonetaryAmounts: amounts,
      hasPreparedOrderSummary: false,
      isMixedQuestion: false,
    });
    assert.equal(ungroundedRefund.passed, false);
    assert.equal(ungroundedRefund.errorCategory, 'unauthorized_order_claim');

    const ungroundedReplacement = validateChatbotResponse({
      replyText: 'We have good news: replacement is dispatched right now.',
      replyLang: 'en',
      settings: DEFAULT_STORE_SETTINGS,
      config: DEFAULT_CHATBOT_CONFIG,
      verifiedMonetaryAmounts: amounts,
      hasPreparedOrderSummary: false,
      isMixedQuestion: false,
    });
    assert.equal(ungroundedReplacement.passed, false);
    assert.equal(ungroundedReplacement.errorCategory, 'unauthorized_order_claim');

    const ungroundedPayment = validateChatbotResponse({
      replyText: 'Your payment is verified successfully.',
      replyLang: 'en',
      settings: DEFAULT_STORE_SETTINGS,
      config: DEFAULT_CHATBOT_CONFIG,
      verifiedMonetaryAmounts: amounts,
      verifiedPaymentStatus: 'pending_verification',
      hasPreparedOrderSummary: false,
      isMixedQuestion: false,
    });
    assert.equal(ungroundedPayment.passed, false);

    // Properly conditional / pending phrasing passes
    const honestPending = validateChatbotResponse({
      replyText:
        'Your bKash payment is still pending_verification until our team reconciles it. Please submit a photo ticket for review.',
      replyLang: 'en',
      settings: DEFAULT_STORE_SETTINGS,
      config: DEFAULT_CHATBOT_CONFIG,
      verifiedMonetaryAmounts: amounts,
      verifiedPaymentStatus: 'pending_verification',
      hasPreparedOrderSummary: false,
      isMixedQuestion: false,
    });
    assert.equal(honestPending.passed, true);

    // Intent classification routes Phase 3 intents accurately
    assert.equal(classifyTurnIntent('My bKash payment failed verification and money got cut').intent, 'payment_dispute');
    assert.equal(classifyTurnIntent('Order DG-30001 delivery is 4 days late').intent, 'late_delivery');
    assert.equal(classifyTurnIntent('I want to reorder my previous ghee jar').intent, 'reorder');
  });

  it('T3.2: enforces ticket consent + order verification, auto-pauses AI on Admin claim, delivers live agent replies, and auto-resumes AI on resolve', async () => {
    seedOrder({ orderNumber: 'DG-30002', phone: '01711112222', status: 'delivered' });

    // 1. Consent missing -> 400
    const noConsentRes = await ticketPost(
      new Request('http://localhost/api/support/ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          sessionId: 'sess_handover_1',
          customerName: 'Tarek Rahman',
          phone: '01711112222',
          orderNumber: 'DG-30002',
          category: 'damaged_jar',
          issueSummary: 'Glass seal cracked during courier drop',
          consentGranted: false,
        }),
      })
    );
    assert.equal(noConsentRes.status, 400);

    // 2. Wrong phone for order -> 404
    const wrongPhoneRes = await ticketPost(
      new Request('http://localhost/api/support/ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          sessionId: 'sess_handover_1',
          customerName: 'Tarek Rahman',
          phone: '01799998888',
          orderNumber: 'DG-30002',
          category: 'damaged_jar',
          issueSummary: 'Glass seal cracked',
          consentGranted: true,
        }),
      })
    );
    assert.equal(wrongPhoneRes.status, 404);

    // 3. Valid consented ticket submission creates Urgent ticket with BST SLA
    const ticketRes = await ticketPost(
      new Request('http://localhost/api/support/ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          sessionId: 'sess_handover_1',
          customerName: 'Tarek Rahman',
          phone: '01711112222',
          orderNumber: 'DG-30002',
          category: 'damaged_jar',
          issueSummary: 'Glass seal cracked on arrival',
          consentGranted: true,
        }),
      })
    );
    assert.equal(ticketRes.status, 200);
    const createdTicket = (await ticketRes.json()) as {
      ok: boolean;
      requestId: string;
      ticketNumber: string;
      priority: string;
      sla: { slaMinutes: number };
    };
    assert.equal(createdTicket.ok, true);
    assert.ok(createdTicket.ticketNumber.startsWith('TK-'));
    assert.equal(createdTicket.priority, 'urgent');
    assert.equal(createdTicket.sla.slaMinutes, 30);

    // 4. Admin claims ticket -> pauses AI for session
    const claimRes = await adminInboxPost(
      new Request('http://localhost/api/chatbot/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin_token_valid',
        },
        body: JSON.stringify({
          action: 'claim_ticket',
          ticketId: createdTicket.requestId,
          sessionId: 'sess_handover_1',
          agentName: 'Deshi Gee Agent',
        }),
      })
    );
    assert.equal(claimRes.status, 200);

    // 5. While AI is paused, customer chat turns short-circuit to human_agent_active
    const pausedChatRes = await chatPost(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          sessionId: 'sess_handover_1',
          uiLang: 'en',
          mode: 'published',
          messages: [{ role: 'user', text: 'Are you looking at my photo?' }],
        }),
      })
    );
    const parsedPaused = await parseNdjson(pausedChatRes);
    assert.equal(parsedPaused.meta?.intent, 'human_agent_active');
    assert.match(parsedPaused.text, /paused/i);

    // 6. Admin posts live agent reply -> customer polls GET /api/chat/session and sees reply
    const replyRes = await adminInboxPost(
      new Request('http://localhost/api/chatbot/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin_token_valid',
        },
        body: JSON.stringify({
          action: 'reply_chat',
          ticketId: createdTicket.requestId,
          sessionId: 'sess_handover_1',
          agentName: 'Deshi Gee Support',
          text: 'Yes, we verified your cracked seal photo and scheduled a replacement dispatch.',
        }),
      })
    );
    assert.equal(replyRes.status, 200);

    const handoverCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(signSessionCookieValue('sess_handover_1'))}`;
    const pollRes = await chatSessionGet(
      new Request('http://localhost/api/chat/session?sessionId=sess_handover_1', {
        headers: { Cookie: handoverCookie },
      })
    );
    assert.equal(pollRes.status, 200);
    const pollData = (await pollRes.json()) as {
      session: { aiPaused: boolean; agentReplies: { text: string; agentName: string }[] };
    };
    assert.equal(pollData.session.aiPaused, true);
    assert.equal(pollData.session.agentReplies.length, 1);
    assert.match(pollData.session.agentReplies[0].text, /verified your cracked seal photo/);

    // 7. Admin resolves ticket -> auto-resumes AI
    const resolveRes = await adminInboxPost(
      new Request('http://localhost/api/chatbot/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin_token_valid',
        },
        body: JSON.stringify({
          action: 'update_ticket',
          ticketId: createdTicket.requestId,
          status: 'resolved',
          resolutionReason: 'Replacement jar arranged',
          resumeAiOnResolve: true,
        }),
      })
    );
    assert.equal(resolveRes.status, 200);

    const pollAfterResolve = await chatSessionGet(
      new Request('http://localhost/api/chat/session?sessionId=sess_handover_1', {
        headers: { Cookie: handoverCookie },
      })
    );
    const afterResolveJson = (await pollAfterResolve.json()) as { session: { aiPaused: boolean } };
    assert.equal(afterResolveJson.session.aiPaused, false);
    assert.equal(
      getSupportInboxMemoryStateForTests()?.tickets.get(createdTicket.requestId)?.status,
      'resolved'
    );
  });

  it('T3.3: gates verified reviews to delivered orders (with duplicate protection), saves opt-in refill reminders, and builds stock-clamped reorder links', async () => {
    seedOrder({ orderNumber: 'DG-30010', phone: '01812345678', status: 'shipped', qty500g: 2 });
    seedOrder({ orderNumber: 'DG-30011', phone: '01812345678', status: 'delivered', qty250g: 1, qty1kg: 2 });

    // 1. Non-delivered order review blocked with 409
    const notDeliveredRes = await reviewPost(
      new Request('http://localhost/api/orders/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          orderNumber: 'DG-30010',
          phone: '01812345678',
          customerName: 'Nadia Islam',
          rating: 5,
          comment: 'Great packaging and aroma so far!',
        }),
      })
    );
    assert.equal(notDeliveredRes.status, 409);

    // 2. Delivered order review succeeds (200)
    const deliveredRes = await reviewPost(
      new Request('http://localhost/api/orders/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          orderNumber: 'DG-30011',
          phone: '01812345678',
          customerName: 'Nadia Islam',
          rating: 5,
          comment: 'Authentic Pabna aroma and rich danadar texture.',
        }),
      })
    );
    assert.equal(deliveredRes.status, 200);
    const revJson = (await deliveredRes.json()) as { ok: boolean; reviewId: string };
    assert.equal(revJson.ok, true);
    assert.equal(revJson.reviewId, 'rev_DG-30011');
    assert.equal(getRetentionMemoryStateForTests()?.reviewClaims.has('DG-30011'), true);

    // Duplicate review for same order blocked with 409
    const dupReviewRes = await reviewPost(
      new Request('http://localhost/api/orders/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          orderNumber: 'DG-30011',
          phone: '01812345678',
          customerName: 'Nadia Islam',
          rating: 4,
          comment: 'Submitting a second review should fail.',
        }),
      })
    );
    assert.equal(dupReviewRes.status, 409);

    // 3. Opt-in refill reminder requires consent on creation, supports update & pause
    const noConsentReminder = await refillReminderPost(
      new Request('http://localhost/api/orders/refill-reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          orderNumber: 'DG-30011',
          phone: '01812345678',
          intervalDays: 45,
          consentGranted: false,
        }),
      })
    );
    assert.equal(noConsentReminder.status, 400);

    const createReminder = await refillReminderPost(
      new Request('http://localhost/api/orders/refill-reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          orderNumber: 'DG-30011',
          phone: '01812345678',
          intervalDays: 45,
          consentGranted: true,
        }),
      })
    );
    assert.equal(createReminder.status, 200);

    const pauseReminder = await refillReminderPost(
      new Request('http://localhost/api/orders/refill-reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          orderNumber: 'DG-30011',
          phone: '01812345678',
          status: 'paused',
        }),
      })
    );
    assert.equal(pauseReminder.status, 200);

    const fetchedReminder = await refillReminderGet(
      new Request('http://localhost/api/orders/refill-reminder?orderNumber=DG-30011&phone=01812345678')
    );
    const reminderJson = (await fetchedReminder.json()) as {
      ok: boolean;
      reminder: { intervalDays: number; status: string };
    };
    assert.equal(reminderJson.ok, true);
    assert.equal(reminderJson.reminder.intervalDays, 45);
    assert.equal(reminderJson.reminder.status, 'paused');

    // 4. Reorder clamps quantities to live stock (e.g., 1kg limited to 1 jar while previous order had 2)
    setInventoryMemoryModeForTests({ stock250g: 5, stock500g: 5, stock1kg: 1 });
    const reorderRes = await reorderPost(
      new Request('http://localhost/api/orders/reorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          orderNumber: 'DG-30011',
          phone: '01812345678',
        }),
      })
    );
    assert.equal(reorderRes.status, 200);
    const reorderJson = (await reorderRes.json()) as {
      ok: boolean;
      qty250g: number;
      qty1kg: number;
      adjustedForStock: boolean;
      reorderUrl: string;
      subtotalBdt: number;
    };
    assert.equal(reorderJson.ok, true);
    assert.equal(reorderJson.qty250g, 1);
    assert.equal(reorderJson.qty1kg, 1);
    assert.equal(reorderJson.adjustedForStock, true);
    assert.equal(reorderJson.subtotalBdt, DEFAULT_STORE_SETTINGS.price250g + DEFAULT_STORE_SETTINGS.price1kg);
    assert.equal(reorderJson.reorderUrl, '/?reorder=250g%3A1%2C1kg%3A1');
  });
});
