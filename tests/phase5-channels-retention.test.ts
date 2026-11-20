import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { GET as webhookGet, POST as webhookPost } from '../app/api/channels/webhook/route';
import { GET as retentionGet, POST as retentionPost } from '../app/api/retention/campaigns/route';
import { GET as attributionGet } from '../app/api/analytics/attribution/route';
import { POST as orderPost } from '../app/api/order/route';
import {
  buildChannelSessionId,
  checkWhatsAppComplianceWindow,
  computePhase5AttributionAnalytics,
  generateAgentAssistSuggestion,
  isReplayTimestampValid,
  isWithinDhakaQuietHours,
  parseMetaInboundWebhookEvents,
  parseWhatsAppCloudEvents,
  verifyMetaWebhookSignature,
} from '../src/lib/chatbot/channelEngine';
import {
  getChannelMemoryStateForTests,
  getOrderStorageMemoryStateForTests,
  setAdminAuthOverrideForTests,
  setChannelMemoryModeForTests,
  setChatLogObserverForTests,
  setInventoryMemoryModeForTests,
  setOrderStorageMemoryModeForTests,
  setRateLimitMemoryModeForTests,
  setSessionDraftMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import { saveSessionAndDraft } from '../src/lib/chatbot/sessionStore';
import { createSignedUnsubscribeToken } from '../src/lib/chatbot/sessionAuth';
import { tryCreateSignedOrderToken } from '../src/lib/chatbot/orderToken';
import {
  type ChatbotLogRecord,
  type ChatbotSupportRequestRecord,
  type OrderDraftDoc,
} from '../src/lib/chatbot/types';
import type { OrderRecord } from '../src/lib/storeTypes';
import {
  TEST_CONFIRMED_CHATBOT_CONFIG as DEFAULT_CHATBOT_CONFIG,
  TEST_CONFIRMED_STORE_SETTINGS as DEFAULT_STORE_SETTINGS,
} from './helpers/testStoreFixture';

const REAL_FETCH = globalThis.fetch;
const PREV_META_VERIFY = process.env.META_VERIFY_TOKEN;
const PREV_META_SECRET = process.env.META_APP_SECRET;
const PREV_WA_SECRET = process.env.WHATSAPP_APP_SECRET;
const PREV_CRON_SECRET = process.env.CRON_SECRET;
const PREV_ORDER_SECRET = process.env.ORDER_TOKEN_SECRET;
const PREV_WA_WEBHOOK = process.env.WHATSAPP_WEBHOOK_URL;

function signMetaPayload(rawBody: string, secret: string): string {
  const hex = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${hex}`;
}

describe('Phase 5 — Omnichannel Webhooks, Consent Retention, SEO, Dictation, Attribution & Agent Assist', () => {
  beforeEach(() => {
    setOrderStorageMemoryModeForTests(true);
    setChannelMemoryModeForTests(true);
    setSessionDraftMemoryModeForTests(true);
    setRateLimitMemoryModeForTests(true);
    setInventoryMemoryModeForTests({ ...DEFAULT_STORE_SETTINGS });
    setChatLogObserverForTests(() => {});
    setAdminAuthOverrideForTests(async (authHeader) => {
      if (authHeader === 'Bearer admin-valid-token') {
        return { ok: true, email: 'admin@deshigee.com', uid: 'admin-1' };
      }
      return { ok: false, email: '', uid: '' };
    });

    process.env.META_VERIFY_TOKEN = 'deshi-gee-verify-token-phase5';
    process.env.META_APP_SECRET = 'meta-app-secret-key-for-phase5-tests';
    process.env.WHATSAPP_APP_SECRET = 'whatsapp-app-secret-key-for-phase5-tests';
    process.env.CRON_SECRET = 'phase5-cron-secret-key-at-least-32-chars';
    process.env.ORDER_TOKEN_SECRET = 'phase5-order-token-secret-32-characters-min';
    delete process.env.WHATSAPP_WEBHOOK_URL;
  });

  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
    setOrderStorageMemoryModeForTests(false);
    setChannelMemoryModeForTests(false);
    setSessionDraftMemoryModeForTests(false);
    setRateLimitMemoryModeForTests(false);
    setInventoryMemoryModeForTests(null);
    setChatLogObserverForTests(null);
    setAdminAuthOverrideForTests(null);

    if (PREV_META_VERIFY === undefined) delete process.env.META_VERIFY_TOKEN;
    else process.env.META_VERIFY_TOKEN = PREV_META_VERIFY;
    if (PREV_META_SECRET === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = PREV_META_SECRET;
    if (PREV_WA_SECRET === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = PREV_WA_SECRET;
    if (PREV_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = PREV_CRON_SECRET;
    if (PREV_ORDER_SECRET === undefined) delete process.env.ORDER_TOKEN_SECRET;
    else process.env.ORDER_TOKEN_SECRET = PREV_ORDER_SECRET;
    if (PREV_WA_WEBHOOK === undefined) delete process.env.WHATSAPP_WEBHOOK_URL;
    else process.env.WHATSAPP_WEBHOOK_URL = PREV_WA_WEBHOOK;
  });

  it('T5.1/T5.2a: Verifies webhook GET handshake, X-Hub-Signature-256 HMAC validation, replay window, and Meta/WhatsApp payload parsers', async () => {
    // 1. Valid GET challenge handshake
    const okGet = await webhookGet(
      new Request(
        'http://localhost/api/channels/webhook?hub.mode=subscribe&hub.verify_token=deshi-gee-verify-token-phase5&hub.challenge=challenge_9988'
      )
    );
    assert.equal(okGet.status, 200);
    assert.equal(await okGet.text(), 'challenge_9988');

    // 2. Invalid verify_token rejected with 403
    const badGet = await webhookGet(
      new Request(
        'http://localhost/api/channels/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge_9988'
      )
    );
    assert.equal(badGet.status, 403);

    // 3. Forged signature rejected on POST
    const forgedRes = await webhookPost(
      new Request('http://localhost/api/channels/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': 'sha256=' + 'a'.repeat(64),
        },
        body: JSON.stringify({ object: 'page', entry: [] }),
      })
    );
    assert.equal(forgedRes.status, 403);

    // 4. Helper unit assertions: replay timestamps + WA 24h window + parsers
    const nowMs = Date.now();
    assert.equal(isReplayTimestampValid(nowMs - 60_000, nowMs, 300), true);
    assert.equal(isReplayTimestampValid(nowMs - 600_000, nowMs, 300), false);
    assert.equal(
      checkWhatsAppComplianceWindow(new Date(nowMs - 2 * 3600 * 1000).toISOString(), new Date(nowMs)).within24hWindow,
      true
    );
    assert.equal(
      checkWhatsAppComplianceWindow(new Date(nowMs - 26 * 3600 * 1000).toISOString(), new Date(nowMs)).requiresTemplate,
      true
    );

    const parsedMeta = parseMetaInboundWebhookEvents({
      object: 'instagram',
      entry: [
        {
          time: nowMs,
          messaging: [
            { sender: { id: 'ig_user_77' }, message: { mid: 'm_1', text: '500g dam koto?' } },
            { sender: { id: 'page_self' }, message: { mid: 'm_echo', is_echo: true, text: 'echo' } },
          ],
        },
      ],
    });
    assert.equal(parsedMeta.length, 1);
    assert.equal(parsedMeta[0].channel, 'instagram');
    assert.equal(parsedMeta[0].eventId, 'instagram_m_1');

    assert.equal(
      verifyMetaWebhookSignature({
        rawBody: '{"ok":true}',
        signatureHeader: signMetaPayload('{"ok":true}', 'secret-1'),
        appSecret: 'secret-1',
      }),
      true
    );
  });

  it('T5.1/T5.2b: Processes WhatsApp & Messenger inbound turns with idempotency dedupe, replay rejection, phone identity linking, and STOP unsubscribe suppression', async () => {
    const nowSec = Math.floor(Date.now() / 1000);

    // 1. WhatsApp inbound message mentioning verified BD phone
    const waPayloadObj = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: 'Karim Uddin' } }],
                messages: [
                  {
                    from: '8801711223344',
                    id: 'wamid.001',
                    timestamp: String(nowSec),
                    type: 'text',
                    text: { body: '500g Deshi Gee er dam koto? Amar number 01711223344' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const waRaw = JSON.stringify(waPayloadObj);
    const waRes = await webhookPost(
      new Request('http://localhost/api/channels/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signMetaPayload(waRaw, process.env.WHATSAPP_APP_SECRET!),
        },
        body: waRaw,
      })
    );
    assert.equal(waRes.status, 200);
    const waData = (await waRes.json()) as {
      ok: boolean;
      processed: number;
      results: Array<{
        status: string;
        channel: string;
        verifiedPhone?: string;
        replyText?: string;
        sessionId: string;
      }>;
    };
    assert.equal(waData.ok, true);
    assert.equal(waData.processed, 1);
    assert.equal(waData.results[0].channel, 'whatsapp');
    assert.equal(waData.results[0].verifiedPhone, '01711223344');
    assert.match(waData.results[0].replyText || '', /1,290|1290/);

    // 2. Re-delivering exact same webhook event is idempotently deduplicated
    const dupRes = await webhookPost(
      new Request('http://localhost/api/channels/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signMetaPayload(waRaw, process.env.WHATSAPP_APP_SECRET!),
        },
        body: waRaw,
      })
    );
    const dupData = (await dupRes.json()) as { processed: number; results: Array<{ status: string }> };
    assert.equal(dupData.processed, 0);
    assert.equal(dupData.results[0].status, 'duplicate');

    // 3. Stale timestamp (> 5 mins old) rejected as replay
    const staleObj = {
      object: 'page',
      entry: [
        {
          time: Date.now() - 20 * 60 * 1000,
          messaging: [
            {
              sender: { id: 'fb_sender_99' },
              timestamp: Date.now() - 20 * 60 * 1000,
              message: { mid: 'mid.stale.1', text: 'Price please?' },
            },
          ],
        },
      ],
    };
    const staleRaw = JSON.stringify(staleObj);
    const staleRes = await webhookPost(
      new Request('http://localhost/api/channels/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signMetaPayload(staleRaw, process.env.META_APP_SECRET!),
        },
        body: staleRaw,
      })
    );
    const staleData = (await staleRes.json()) as {
      processed: number;
      results: Array<{ status: string }>;
    };
    assert.equal(staleData.processed, 0);
    assert.equal(staleData.results[0].status, 'rejected_replay');

    // 4. WhatsApp "STOP" instantly suppresses marketing consent for that verified BD phone
    const stopObj = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: 'Karim Uddin' } }],
                messages: [
                  {
                    from: '8801711223344',
                    id: 'wamid.stop.002',
                    timestamp: String(nowSec),
                    type: 'text',
                    text: { body: 'STOP updates' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const stopRaw = JSON.stringify(stopObj);
    const stopRes = await webhookPost(
      new Request('http://localhost/api/channels/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signMetaPayload(stopRaw, process.env.WHATSAPP_APP_SECRET!),
        },
        body: stopRaw,
      })
    );
    assert.equal(stopRes.status, 200);
    const chState = getChannelMemoryStateForTests()!;
    const consentDoc = chState.marketingConsents.get('01711223344');
    assert.ok(consentDoc);
    assert.equal(consentDoc.unsubscribed, true);
    assert.equal(consentDoc.optIn, false);
    assert.equal(buildChannelSessionId('whatsapp', '8801711223344'), waData.results[0].sessionId);
    assert.equal(parseWhatsAppCloudEvents(waPayloadObj).length, 1);
  });

  it('T5.3: Enforces customer consent, instant unsubscribe suppression, Asia/Dhaka quiet hours (22:00-08:00), and 72h frequency cap on retention & draft recovery campaigns', async () => {
    // 1. Seed 2 abandoned drafts: one opted-in (01811000501), one later unsubscribed (01811000502)
    await saveSessionAndDraft({
      session: {
        sessionId: 'sess_501',
        language: 'bn',
        lockedLang: '',
        scriptPreference: 'bn_script',
        consent: true,
        currentIntent: 'order',
        orderDraftId: 'draft_sess_501',
        turnCount: 2,
        channel: 'whatsapp',
      },
      draft: {
        draftId: 'draft_sess_501',
        sessionId: 'sess_501',
        weight: '500g',
        qty: 1,
        qty500g: 1,
        customerName: 'Nadia Rahman',
        phone: '01811000501',
        district: 'Dhaka',
        area: 'Banani',
        address: 'Road 11 Banani',
        paymentMethod: 'cod',
        txnId: '',
        couponCode: '',
        note: '',
        state: 'awaiting_confirmation',
        priceQuoteVersion: 1,
        validationErrors: [],
        expiresAt: Date.now() + 3600_000,
        updatedAt: Date.parse('2026-11-18T06:00:00.000Z'),
      },
    });
    await saveSessionAndDraft({
      session: {
        sessionId: 'sess_502',
        language: 'en',
        lockedLang: '',
        scriptPreference: 'en',
        consent: true,
        currentIntent: 'order',
        orderDraftId: 'draft_sess_502',
        turnCount: 2,
        channel: 'whatsapp',
      },
      draft: {
        draftId: 'draft_sess_502',
        sessionId: 'sess_502',
        weight: '1kg',
        qty: 1,
        qty1kg: 1,
        customerName: 'Tariq Hasan',
        phone: '01811000502',
        district: 'Dhaka',
        area: 'Uttara',
        address: 'Sector 7 Uttara',
        paymentMethod: 'cod',
        txnId: '',
        couponCode: '',
        note: '',
        state: 'quote_ready',
        priceQuoteVersion: 1,
        validationErrors: [],
        expiresAt: Date.now() + 3600_000,
        updatedAt: Date.parse('2026-11-18T06:00:00.000Z'),
      },
    });

    // Customer opts in 501 and unsubscribes 502 via storefront API with signed phone ownership tokens (S0-03)
    const optInRes = await retentionPost(
      new Request('http://localhost/api/retention/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          action: 'consent',
          phone: '01811000501',
          consentToken: createSignedUnsubscribeToken('01811000501'),
          customerName: 'Nadia Rahman',
          channel: 'whatsapp',
          source: 'chat',
        }),
      })
    );
    assert.equal(optInRes.status, 200);

    const unsubRes = await retentionPost(
      new Request('http://localhost/api/retention/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          action: 'unsubscribe',
          phone: '01811000502',
          unsubscribeToken: createSignedUnsubscribeToken('01811000502'),
          channel: 'whatsapp',
          source: 'track_order',
        }),
      })
    );
    assert.equal(unsubRes.status, 200);

    // 2. Unauthorized dispatch blocked
    const unauthGet = await retentionGet(new Request('http://localhost/api/retention/campaigns'));
    assert.equal(unauthGet.status, 401);

    // 3. Dhaka quiet hours (23:30 BST = 17:30 UTC) blocks delivery
    const quietUtcIso = '2026-11-18T17:30:00.000Z';
    assert.equal(isWithinDhakaQuietHours(new Date(quietUtcIso)), true);

    const quietDispatchRes = await retentionPost(
      new Request('http://localhost/api/retention/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({
          action: 'dispatch',
          segment: 'abandoned_drafts',
          channel: 'whatsapp',
          dryRun: false,
          nowIso: quietUtcIso,
        }),
      })
    );
    const quietSummary = (await quietDispatchRes.json()) as {
      withinDhakaQuietHours: boolean;
      sentCount: number;
      skippedQuietHours: number;
    };
    assert.equal(quietSummary.withinDhakaQuietHours, true);
    assert.equal(quietSummary.sentCount, 0);
    assert.equal(quietSummary.skippedQuietHours, 1);

    // 4. Dhaka daytime (14:00 BST = 08:00 UTC) dispatches to eligible phone via webhook
    const daytimeUtcIso = '2026-11-18T08:00:00.000Z';
    assert.equal(isWithinDhakaQuietHours(new Date(daytimeUtcIso)), false);
    process.env.WHATSAPP_WEBHOOK_URL = 'https://hooks.example.test/wa-retention';
    const sentPayloads: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('hooks.example.test')) {
        sentPayloads.push(String(init?.body || ''));
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const liveRes = await retentionPost(
      new Request('http://localhost/api/retention/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-valid-token',
        },
        body: JSON.stringify({
          action: 'dispatch',
          segment: 'abandoned_drafts',
          channel: 'whatsapp',
          dryRun: false,
          nowIso: daytimeUtcIso,
        }),
      })
    );
    const liveSummary = (await liveRes.json()) as {
      sentCount: number;
      eligibleCount: number;
      totalCandidates: number;
    };
    assert.equal(liveSummary.totalCandidates, 1); // 01811000502 suppressed at candidate filter
    assert.equal(liveSummary.sentCount, 1);
    assert.equal(sentPayloads.length, 1);

    // 5. Repeat dispatch 24h later is blocked by 72h frequency cooldown
    const nextDayRes = await retentionPost(
      new Request('http://localhost/api/retention/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({
          action: 'dispatch',
          segment: 'abandoned_drafts',
          channel: 'whatsapp',
          dryRun: false,
          nowIso: '2026-11-19T08:00:00.000Z',
        }),
      })
    );
    const nextDaySummary = (await nextDayRes.json()) as {
      sentCount: number;
      skippedFrequencyCap: number;
    };
    assert.equal(nextDaySummary.sentCount, 0);
    assert.equal(nextDaySummary.skippedFrequencyCap, 1);
  });

  it('T5.4/T5.5/T5.6: Computes 6-stage deduplicated funnel & channel attribution, persists sourceChannel on /api/order, and generates grounded Agent-Assist drafts', async () => {
    // 1. Place order via /api/order with explicit sourceChannel='messenger'
    const tokenResult = tryCreateSignedOrderToken({
      sessionId: 'ch_msg_attribution_01',
      draft: {
        weight: '500g',
        qty: 1,
        qty250g: 0,
        qty500g: 1,
        qty1kg: 0,
        customerName: 'Salma Begum',
        phone: '01911000601',
        district: 'Dhaka',
        area: 'Mirpur 10',
        address: 'Block B, Mirpur 10, Dhaka',
        paymentMethod: 'cod',
        txnId: '',
        couponCode: '',
        note: 'Afternoon delivery preferred',
        deliveryZone: 'dhaka',
      },
      pricing: {
        qty250g: 0,
        qty500g: 1,
        qty1kg: 0,
        unitPriceBdt: DEFAULT_STORE_SETTINGS.price500g,
        subtotalBdt: DEFAULT_STORE_SETTINGS.price500g,
        deliveryFeeBdt: DEFAULT_STORE_SETTINGS.insideDhakaFee,
        discountBdt: 0,
        totalBdt: DEFAULT_STORE_SETTINGS.price500g + DEFAULT_STORE_SETTINGS.insideDhakaFee,
      },
    });
    assert.equal(tokenResult.ok, true);
    if (!tokenResult.ok) throw new Error('Expected signed token');
    const token = tokenResult.token;

    const orderRes = await orderPost(
      new Request('http://localhost/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          'x-forwarded-for': '103.50.55.1',
        },
        body: JSON.stringify({
          confirmationToken: token,
          sessionId: 'ch_msg_attribution_01',
          sourceChannel: 'messenger',
          uiLang: 'bn',
          website: '',
        }),
      })
    );
    assert.equal(orderRes.status, 200);
    const orderData = (await orderRes.json()) as { ok: boolean; orderNumber: string };
    assert.equal(orderData.ok, true);

    const savedOrder = getOrderStorageMemoryStateForTests()!.orders.get(orderData.orderNumber)!;
    assert.equal(savedOrder.sourceChannel, 'messenger');
    assert.equal(savedOrder.attributedSessionId, 'ch_msg_attribution_01');

    // 2. Funnel & Multi-Channel attribution deduplication + AOV/conversion check
    const logs: ChatbotLogRecord[] = [
      {
        id: 'l1',
        sessionId: 's_web_1',
        channel: 'web',
        lang: 'en',
        userMessage: '500g price?',
        assistantReply: '৳1290',
        intent: 'product_pricing',
        isUnanswered: false,
        resolved: true,
        handoverRequested: false,
        latencyMs: 50,
        promptTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        errorCode: '',
        isTestPlayground: false,
      },
      {
        id: 'l2',
        sessionId: 's_web_1',
        channel: 'web',
        lang: 'en',
        userMessage: 'order 500g',
        assistantReply: 'Sure',
        intent: 'order_intent',
        isUnanswered: false,
        resolved: true,
        handoverRequested: false,
        latencyMs: 50,
        promptTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        errorCode: '',
        isTestPlayground: false,
      },
      {
        id: 'l3',
        sessionId: 'ch_msg_attribution_01',
        channel: 'messenger',
        lang: 'bn',
        userMessage: '500g nibo',
        assistantReply: 'Ok',
        intent: 'order_creation',
        isUnanswered: false,
        resolved: true,
        handoverRequested: false,
        latencyMs: 50,
        promptTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        errorCode: '',
        isTestPlayground: false,
      },
    ];
    const drafts: OrderDraftDoc[] = [
      {
        draftId: 'draft_ch_msg_attribution_01',
        sessionId: 'ch_msg_attribution_01',
        weight: '500g',
        qty: 1,
        customerName: 'Salma Begum',
        phone: '01911000601',
        district: 'Dhaka',
        area: 'Mirpur',
        address: 'Block B',
        paymentMethod: 'cod',
        txnId: '',
        couponCode: '',
        note: '',
        state: 'confirmed',
        priceQuoteVersion: 1,
        expiresAt: Date.now() + 10000,
      },
    ];
    const orders: OrderRecord[] = [
      {
        ...savedOrder,
        status: 'delivered',
      },
    ];
    const supportRequests: ChatbotSupportRequestRecord[] = [
      {
        id: 't1',
        ticketNumber: 'TKT-901',
        sessionId: 'ch_msg_attribution_01',
        channel: 'messenger',
        customerName: 'Salma Begum',
        phone: '01911000601',
        orderNumber: savedOrder.orderNumber,
        category: 'damaged_jar',
        priority: 'urgent',
        issueSummary: 'Jar lid loose',
        slaWindowLabelBn: '৩০ মিনিটের মধ্যে',
        slaWindowLabelEn: 'within 30 minutes',
        status: 'open',
      },
    ];

    const funnelAnalytics = computePhase5AttributionAnalytics({
      logs,
      drafts,
      orders,
      supportRequests,
    });
    assert.equal(funnelAnalytics.funnel.chatStartedSessions, 2); // s_web_1 + ch_msg_attribution_01 deduplicated
    assert.equal(funnelAnalytics.funnel.productInfoSessions, 1);
    assert.equal(funnelAnalytics.funnel.orderIntentSessions, 2);
    assert.equal(funnelAnalytics.funnel.summaryShownSessions, 1);
    assert.equal(funnelAnalytics.funnel.confirmedOrdersCount, 1);
    assert.equal(funnelAnalytics.funnel.deliveredOrdersCount, 1);
    assert.equal(funnelAnalytics.funnel.attributedRevenueBdt, savedOrder.totalBdt);
    assert.equal(funnelAnalytics.funnel.chatToOrderPct, 50);

    const msgRow = funnelAnalytics.channels.find((c) => c.channel === 'messenger');
    assert.ok(msgRow);
    assert.equal(msgRow.orders, 1);
    assert.equal(msgRow.handoverTickets, 1);

    // 3. Attribution API auth & response check
    const unauthAttr = await attributionGet(new Request('http://localhost/api/analytics/attribution'));
    assert.equal(unauthAttr.status, 401);
    const adminAttr = await attributionGet(
      new Request('http://localhost/api/analytics/attribution', {
        headers: { Authorization: 'Bearer admin-valid-token' },
      })
    );
    assert.equal(adminAttr.status, 200);
    const attrJson = (await adminAttr.json()) as {
      ok: boolean;
      analytics: { funnel: { confirmedOrdersCount: number } };
      channelIntegration: { metaVerifyConfigured: boolean };
    };
    assert.equal(attrJson.ok, true);
    assert.equal(attrJson.analytics.funnel.confirmedOrdersCount, 1);
    assert.equal(attrJson.channelIntegration.metaVerifyConfigured, true);

    // 4. Agent-Assist Bangla & English reply draft safety
    const draftBn = generateAgentAssistSuggestion({
      ticket: supportRequests[0],
      settings: DEFAULT_STORE_SETTINGS,
      lang: 'bn',
    });
    const draftEn = generateAgentAssistSuggestion({
      ticket: supportRequests[0],
      settings: DEFAULT_STORE_SETTINGS,
      lang: 'en',
    });
    assert.match(draftBn, new RegExp(savedOrder.orderNumber));
    assert.match(draftBn, /৩০ মিনিটের মধ্যে/);
    assert.match(draftEn, new RegExp(savedOrder.orderNumber));
    assert.doesNotMatch(draftEn, /refund approved automatically|free gift/i);
    assert.ok(DEFAULT_CHATBOT_CONFIG.botName);
  });
});
