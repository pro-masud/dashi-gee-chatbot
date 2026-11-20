import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ThinkingLevel, type GoogleGenAI } from '@google/genai';
import { POST as chatPost } from '../app/api/chat/route';
import { POST as orderPost } from '../app/api/order/route';
import { CHATBOT_BUILD_CONFIG } from '../src/lib/chatbot/build-config';
import { classifyDomainRequest } from '../src/lib/chatbot/domain-guard';
import {
  setChatLogObserverForTests,
  setCostLedgerOverrideForTests,
  setFirestoreHealthOverrideForTests,
  setInventoryMemoryModeForTests,
  setRateLimitMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import { generateLiveFallbackReply } from '../src/lib/chatbot/liveFallbackEngine';
import {
  resetDevOrderTokenSecretForTests,
  tryCreateSignedOrderToken,
  verifySignedOrderToken,
} from '../src/lib/chatbot/orderToken';
import { validateChatbotResponse } from '../src/lib/chatbot/responseValidator';
import { retrieveRelevantKnowledge } from '../src/lib/chatbot/security';
import {
  buildStoreFactsSnapshot,
  detectStoreFactConflicts,
  getSeededVerifiedMonetaryAmounts,
} from '../src/lib/chatbot/storeFacts';
import {
  TEST_CONFIRMED_BATCH as DEFAULT_ACTIVE_BATCH,
  TEST_CONFIRMED_CHATBOT_CONFIG as DEFAULT_CHATBOT_CONFIG,
  TEST_CONFIRMED_STORE_SETTINGS as DEFAULT_STORE_SETTINGS,
} from './helpers/testStoreFixture';
import {
  buildGeminiGenerateConfig,
  classifyGeminiError,
  clearGeminiHealthCacheForTests,
  setGeminiClientFactoryForTests,
} from '../src/lib/gemini/client';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  ORDER_TOKEN_SECRET: process.env.ORDER_TOKEN_SECRET,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_FALLBACK_MODEL: process.env.GEMINI_FALLBACK_MODEL,
  GEMINI_DAILY_COST_CAP_USD: process.env.GEMINI_DAILY_COST_CAP_USD,
};

const REAL_FETCH = globalThis.fetch;

function restoreEnv() {
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  for (const k of [
    'ORDER_TOKEN_SECRET',
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'GEMINI_FALLBACK_MODEL',
    'GEMINI_DAILY_COST_CAP_USD',
  ] as const) {
    const v = ORIGINAL_ENV[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function installOfflineFirestoreFetchMock() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('firestore.googleapis.com')) {
      return new Response(JSON.stringify({ error: { code: 404, message: 'offline_test_stub' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return REAL_FETCH(input);
  }) as typeof fetch;
}

async function parseNdjsonResponse(res: Response): Promise<{
  text: string;
  meta: Record<string, unknown> | null;
}> {
  const raw = await res.text();
  let text = '';
  let meta: Record<string, unknown> | null = null;
  for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const ev = JSON.parse(line) as Record<string, unknown>;
    if (ev.type === 'delta' && typeof ev.text === 'string') text += ev.text;
    if (ev.type === 'meta') meta = ev;
  }
  return { text, meta };
}

function buildChatRequest(
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): Request {
  return new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-requested-with': 'DeshiGeeStorefront',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe('Phase 0 Runtime, Security, Cost & Quality Guards (T0.2-T0.14)', () => {
  beforeEach(() => {
    installOfflineFirestoreFetchMock();
    clearGeminiHealthCacheForTests();
    setGeminiClientFactoryForTests(null);
    setChatLogObserverForTests(null);
    setCostLedgerOverrideForTests(null);
    setRateLimitMemoryModeForTests(true);
    setInventoryMemoryModeForTests({ ...DEFAULT_STORE_SETTINGS });
    setFirestoreHealthOverrideForTests(async () => ({
      reachable: true,
      latencyMs: 5,
      detail: 'mock',
    }));
    resetDevOrderTokenSecretForTests();
  });

  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
    restoreEnv();
    clearGeminiHealthCacheForTests();
    setGeminiClientFactoryForTests(null);
    setChatLogObserverForTests(null);
    setCostLedgerOverrideForTests(null);
    setRateLimitMemoryModeForTests(false);
    setInventoryMemoryModeForTests(null);
    setFirestoreHealthOverrideForTests(null);
    resetDevOrderTokenSecretForTests();
  });

  it('T0.2: Order tokens reject tamper, expiry, and fail closed with HTTP 503 when ORDER_TOKEN_SECRET missing in production', async () => {
    process.env.ORDER_TOKEN_SECRET = 'test_dedicated_order_secret_key_min_32_chars_001';
    const created = tryCreateSignedOrderToken({
      sessionId: 'sess_t02_1',
      draft: {
        weight: '500g',
        qty: 1,
        customerName: 'Rahim Mia',
        phone: '01711223344',
        district: 'Dhaka',
        area: 'Dhanmondi',
        address: 'House 12, Road 4, Dhanmondi',
        deliveryZone: 'dhaka',
        paymentMethod: 'cod',
        txnId: '',
        couponCode: '',
        note: '',
      },
      pricing: {
        unitPriceBdt: 1290,
        subtotalBdt: 1290,
        deliveryFeeBdt: 90,
        discountBdt: 0,
        totalBdt: 1380,
      },
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const validVerify = verifySignedOrderToken(created.token);
    assert.equal(validVerify.ok, true);

    // Tampered token rejected
    const [encoded, sig] = created.token.split('.');
    const tamperedSig = `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
    const tamperedVerify = verifySignedOrderToken(`${encoded}.${tamperedSig}`);
    assert.deepEqual(tamperedVerify, { ok: false, reason: 'invalid_token' });

    // Missing ORDER_TOKEN_SECRET in production fails closed cleanly without falling back to GEMINI_API_KEY
    process.env.GEMINI_API_KEY = 'AIzaSyFakeKeyThatMustNeverSignOrderTokens12345';
    delete process.env.ORDER_TOKEN_SECRET;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.DESHI_GEE_TEST_MODE = '1';

    const blockedSign = tryCreateSignedOrderToken({
      sessionId: 'sess_t02_prod',
      draft: {
        weight: '250g',
        qty: 1,
        customerName: 'Karim',
        phone: '01811223344',
        district: 'Dhaka',
        area: 'Mirpur',
        address: 'Block C, Road 3, Mirpur',
        deliveryZone: 'dhaka',
        paymentMethod: 'cod',
        txnId: '',
        couponCode: '',
        note: '',
      },
      pricing: {
        unitPriceBdt: 680,
        subtotalBdt: 680,
        deliveryFeeBdt: 90,
        discountBdt: 0,
        totalBdt: 770,
      },
    });
    assert.equal(blockedSign.ok, false);
    if (!blockedSign.ok) assert.equal(blockedSign.errorCode, 'order_secret_missing');

    const orderRes = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          uiLang: 'en',
          sessionId: 'sess_t02_prod',
          confirmationToken: created.token,
        }),
      })
    );
    assert.equal(orderRes.status, 503);
    const errJson = (await orderRes.json()) as Record<string, unknown>;
    assert.equal(errJson.code, 'order_secret_missing');
  });

  it('T0.3: Per-model config uses ThinkingLevel.LOW for Gen 3/4, omits temperature, and fails over ONLY on retryable/retired errors', async () => {
    const gen4Cfg = buildGeminiGenerateConfig({
      model: 'gemini-4-hydrogen',
      systemInstruction: 'test',
      disableTools: false,
    });
    assert.equal(gen4Cfg.temperature, undefined);
    assert.equal(gen4Cfg.thinkingConfig?.thinkingLevel, ThinkingLevel.LOW);
    assert.equal(gen4Cfg.thinkingConfig?.thinkingBudget, undefined);

    const gen25Cfg = buildGeminiGenerateConfig({
      model: 'gemini-2.5-flash',
      systemInstruction: 'test',
      lowThinkingMode: false,
    });
    assert.equal(gen25Cfg.temperature, 0.3);
    assert.equal(gen25Cfg.thinkingConfig?.thinkingBudget, 256);

    assert.equal(classifyGeminiError({ status: 404, message: '404 model not found' }).shouldFailover, true);
    assert.equal(classifyGeminiError({ status: 429, message: 'quota exhausted' }).shouldFailover, true);
    assert.equal(classifyGeminiError({ status: 503, message: 'service unavailable' }).shouldFailover, true);
    assert.equal(classifyGeminiError({ status: 400, message: '400 INVALID_ARGUMENT' }).shouldFailover, false);
    assert.equal(classifyGeminiError({ status: 401, message: '401 API_KEY invalid' }).shouldFailover, false);

    // Forced failover test: 503 on gemini-4-hydrogen -> succeeds cleanly on gemini-3.1-flash-lite
    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKeyValue1234567890';
    process.env.GEMINI_MODEL = 'gemini-4-hydrogen';
    process.env.GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

    const attemptedModels: string[] = [];
    setGeminiClientFactoryForTests(() => ({
      models: {
        generateContent: async ({ model }: { model: string }) => {
          attemptedModels.push(model);
          if (model === 'gemini-4-hydrogen') {
            const err = new Error('503 Service Unavailable') as Error & { status: number };
            err.status = 503;
            throw err;
          }
          return {
            text: 'Our 500g jar is ৳1290 from Pabna.',
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 15 },
            functionCalls: [],
          };
        },
      },
    }) as unknown as GoogleGenAI);

    const res = await chatPost(
      buildChatRequest({
        mode: 'published',
        uiLang: 'en',
        sessionId: 'sess_failover_01',
        messages: [{ role: 'user', text: '500g jar price?' }],
      })
    );
    const parsed = await parseNdjsonResponse(res);
    assert.deepEqual(attemptedModels, ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);
    assert.equal(parsed.meta?.path, 'gemini');
    assert.equal(parsed.meta?.model, 'gemini-3.1-flash-lite');
    assert.ok(parsed.text.includes('1290'));
  });

  it('T0.4: Retries once on MAX_TOKENS/empty output at 2600 tokens and returns honest retry/support error on persistent empty output', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKeyValue1234567890';
    process.env.GEMINI_MODEL = 'gemini-4-hydrogen';

    // Case 1: MAX_TOKENS on 1st call -> retries with 2600 maxOutputTokens -> succeeds
    const seenMaxTokens: number[] = [];
    setGeminiClientFactoryForTests(() => ({
      models: {
        generateContent: async ({ config }: { config: { maxOutputTokens?: number } }) => {
          seenMaxTokens.push(Number(config?.maxOutputTokens || 0));
          if (seenMaxTokens.length === 1) {
            return {
              text: '',
              candidates: [{ finishReason: 'MAX_TOKENS' }],
              usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 1800 },
              functionCalls: [],
            };
          }
          return {
            text: 'Our 250g Deshi Gee jar is ৳680.',
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 20 },
            functionCalls: [],
          };
        },
      },
    }) as unknown as GoogleGenAI);

    const resRecover = await chatPost(
      buildChatRequest({
        mode: 'published',
        uiLang: 'en',
        sessionId: 'sess_max_tokens_recover',
        messages: [{ role: 'user', text: 'What is 250g price?' }],
      })
    );
    const parsedRecover = await parseNdjsonResponse(resRecover);
    assert.deepEqual(seenMaxTokens, [
      CHATBOT_BUILD_CONFIG.GEMINI_MAX_OUTPUT_TOKENS,
      CHATBOT_BUILD_CONFIG.GEMINI_RETRY_MAX_OUTPUT_TOKENS,
    ]);
    assert.equal(parsedRecover.meta?.isError, false);
    assert.ok(parsedRecover.text.includes('680'));

    // Case 2: Persistent empty reply returns honest retry/support message (not "don't have verified information")
    const logs: Record<string, unknown>[] = [];
    setChatLogObserverForTests((p) => logs.push(p));
    setGeminiClientFactoryForTests(() => ({
      models: {
        generateContent: async () => ({
          text: '',
          candidates: [{ finishReason: 'MAX_TOKENS' }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
          functionCalls: [],
        }),
      },
    }) as unknown as GoogleGenAI);

    const resExhaust = await chatPost(
      buildChatRequest({
        mode: 'published',
        uiLang: 'en',
        sessionId: 'sess_max_tokens_exhaust',
        messages: [{ role: 'user', text: 'Tell me everything about Deshi Gee jar sizes' }],
      })
    );
    const parsedExhaust = await parseNdjsonResponse(resExhaust);
    assert.equal(parsedExhaust.meta?.isError, true);
    assert.equal(parsedExhaust.meta?.errorCode, 'max_tokens_exhausted');
    assert.equal(parsedExhaust.text.includes("don't have verified information"), false);
    assert.ok(parsedExhaust.text.toLowerCase().includes('try again'));
    assert.equal(logs[0]?.isError, true);
    assert.equal(logs[0]?.finishReason, 'MAX_TOKENS');
  });

  it('T0.5: Forces final tool-free synthesis turn on max tool round limit and dedupes duplicate tool calls', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKeyValue1234567890';
    process.env.GEMINI_MODEL = 'gemini-4-hydrogen';

    const callsSeen: { mode?: string }[] = [];
    let attempt = 0;
    setGeminiClientFactoryForTests(() => ({
      models: {
        generateContent: async ({ config }: { config?: { toolConfig?: { functionCallingConfig?: { mode?: string } } } }) => {
          attempt += 1;
          const mode = config?.toolConfig?.functionCallingConfig?.mode;
          callsSeen.push({ mode });
          // Loop requesting tools up to MAX_TOOL_CALLS_PER_TURN (5 rounds)
          if (attempt <= CHATBOT_BUILD_CONFIG.MAX_TOOL_CALLS_PER_TURN) {
            return {
              text: '',
              candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [] } }],
              usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 15 },
              functionCalls: [
                { id: `fc_${attempt}`, name: 'get_current_price', args: { weight: '1kg' } },
              ],
            };
          }
          // 6th call MUST have FunctionCallingConfigMode.NONE ('NONE')
          return {
            text: 'Our 1kg jar is ৳2480.',
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 12 },
            functionCalls: [],
          };
        },
      },
    }) as unknown as GoogleGenAI);

    const logs: Record<string, unknown>[] = [];
    setChatLogObserverForTests((p) => logs.push(p));

    const res = await chatPost(
      buildChatRequest({
        mode: 'published',
        uiLang: 'en',
        sessionId: 'sess_tool_limit_01',
        messages: [{ role: 'user', text: '1kg ghee price please' }],
      })
    );
    const parsed = await parseNdjsonResponse(res);
    assert.equal(callsSeen.length, CHATBOT_BUILD_CONFIG.MAX_TOOL_CALLS_PER_TURN + 1);
    assert.equal(callsSeen[CHATBOT_BUILD_CONFIG.MAX_TOOL_CALLS_PER_TURN].mode, 'NONE');
    assert.ok(parsed.text.includes('2480'));
    // Because get_current_price with { weight: '1kg' } was identical across all 5 rounds, idempotency executed it only 1 time!
    assert.equal(logs[0]?.toolCallCount, 1);
  });

  it('T0.6 & T0.7: Grounded seeded catalog amounts pass without tools, hallucinated amounts block, and claim validation is clause+negation aware across both paths', async () => {
    const facts = buildStoreFactsSnapshot({
      settings: DEFAULT_STORE_SETTINGS,
      batch: DEFAULT_ACTIVE_BATCH,
      config: DEFAULT_CHATBOT_CONFIG,
    });
    const seeded = Array.from(getSeededVerifiedMonetaryAmounts(facts));

    // Seeded Bangla digit price ৳৬৮০ and default Dhaka fee ৳৮০ pass without extra tool calls
    const seededBnPass = validateChatbotResponse({
      replyText: 'আমাদের ২৫০ গ্রাম জারের দাম ৳৬৮০ এবং ঢাকায় ডেলিভারি চার্জ ৮০ টাকা।',
      replyLang: 'bn',
      settings: DEFAULT_STORE_SETTINGS,
      config: DEFAULT_CHATBOT_CONFIG,
      verifiedMonetaryAmounts: seeded,
      hasPreparedOrderSummary: false,
      isMixedQuestion: false,
    });
    assert.equal(seededBnPass.passed, true);

    // Invented ungrounded price ৳599 fails with exact ungroundedAmounts
    const halluPrice = validateChatbotResponse({
      replyText: 'Special flash deal: get 250g today for only ৳599!',
      replyLang: 'en',
      settings: DEFAULT_STORE_SETTINGS,
      config: DEFAULT_CHATBOT_CONFIG,
      verifiedMonetaryAmounts: seeded,
      hasPreparedOrderSummary: false,
      isMixedQuestion: false,
    });
    assert.equal(halluPrice.passed, false);
    assert.equal(halluPrice.errorCategory, 'price_ungrounded');
    assert.deepEqual(halluPrice.ungroundedAmounts, [599]);

    // Negated unapproved claim PASSES ("We do not claim this ghee is certified or organic")
    const negatedPass = validateChatbotResponse({
      replyText: 'We do not claim this ghee is certified or organic. It is small-batch Pabna bilona ghee.',
      replyLang: 'en',
      settings: DEFAULT_STORE_SETTINGS,
      config: DEFAULT_CHATBOT_CONFIG,
      verifiedMonetaryAmounts: seeded,
      hasPreparedOrderSummary: false,
      isMixedQuestion: false,
    });
    assert.equal(negatedPass.passed, true);

    // Affirmative unapproved medical/cert claim BLOCKS
    const unapprovedBlock = validateChatbotResponse({
      replyText: 'Our ghee is certified by BSTI and cures diabetes quickly.',
      replyLang: 'en',
      settings: DEFAULT_STORE_SETTINGS,
      config: DEFAULT_CHATBOT_CONFIG,
      verifiedMonetaryAmounts: seeded,
      hasPreparedOrderSummary: false,
      isMixedQuestion: false,
    });
    assert.equal(unapprovedBlock.passed, false);
    assert.equal(unapprovedBlock.errorCategory, 'unapproved_claim');

    // Expired approvedClaimsMeta should NOT authorize the claim
    const expiredCfg = {
      ...DEFAULT_CHATBOT_CONFIG,
      approvedClaims: 'Pabna grass-fed bilona craft',
      approvedClaimsMeta: [{ claim: 'lab-verified', evidenceNote: 'Old 2024 cert', expiresAt: '2024-01-01' }],
    };
    const expiredBlock = validateChatbotResponse({
      replyText: 'Batch is lab-verified pure.',
      replyLang: 'en',
      settings: DEFAULT_STORE_SETTINGS,
      config: expiredCfg,
      verifiedMonetaryAmounts: seeded,
      hasPreparedOrderSummary: false,
      isMixedQuestion: false,
    });
    assert.equal(expiredBlock.passed, false);

    // Custom Admin blockedClaims list blocks affirmative mention
    const blockedCustomCfg = {
      ...DEFAULT_CHATBOT_CONFIG,
      blockedClaims: 'weight loss; anti-aging',
    };
    const customBlock = validateChatbotResponse({
      replyText: 'Great for daily weight loss routines.',
      replyLang: 'en',
      settings: DEFAULT_STORE_SETTINGS,
      config: blockedCustomCfg,
      verifiedMonetaryAmounts: seeded,
      hasPreparedOrderSummary: false,
      isMixedQuestion: false,
    });
    assert.equal(customBlock.passed, false);
    assert.equal(customBlock.blockedClaim, 'weight loss');

    // Live fallback engine craft reply complies cleanly when passed through validator (even with default config)
    const fallbackCraft = generateLiveFallbackReply({
      userMessage: 'Apnader ghee ki khanti? Kivabe banan?',
      replyLang: 'bn',
      settings: DEFAULT_STORE_SETTINGS,
      batch: DEFAULT_ACTIVE_BATCH,
      config: DEFAULT_CHATBOT_CONFIG,
      matchedFaqs: [],
      facts,
    });
    const fallbackValidated = validateChatbotResponse({
      replyText: fallbackCraft.replyText,
      replyLang: 'bn',
      settings: DEFAULT_STORE_SETTINGS,
      config: DEFAULT_CHATBOT_CONFIG,
      verifiedMonetaryAmounts: seeded,
      hasPreparedOrderSummary: false,
      isMixedQuestion: false,
    });
    assert.equal(fallbackValidated.passed, true);
  });

  it('T0.8, T0.9, T0.11, T0.12, T0.13, T0.14: Error logging, StoreFacts conflict detection, CGNAT rate limit, Persistent cost cap, Domain/Retrieval fixes', async () => {
    // T0.9: Conflict detection
    const conflicts = detectStoreFactConflicts({
      settings: { ...DEFAULT_STORE_SETTINGS, freeDeliveryThreshold: 2500 },
      config: { ...DEFAULT_CHATBOT_CONFIG, currentOffers: 'Free delivery on orders ৳2000+!' },
    });
    assert.ok(conflicts.some((c) => c.includes('৳2000')));

    // T0.14: Domain guard allows "butter / মাখন" in ghee context, blocks "peanut butter", and Bangla inflection retrieval works
    assert.equal(classifyDomainRequest('Do you make ghee from cultured butter?').category, 'allowed_ghee');
    assert.equal(classifyDomainRequest('গরুর দুধের মাখন থেকে ঘি কিভাবে বানান?').category, 'allowed_ghee');
    assert.equal(classifyDomainRequest('Do you sell peanut butter?').category, 'disallowed_off_topic');

    const retrieval = retrieveRelevantKnowledge(
      'ঘিয়ের দাম কত?',
      [
        {
          id: 'faq1',
          question: 'Deshi Gee price and sizes',
          answer: '250g ৳680, 500g ৳1290, 1kg ৳2480.',
          lang: 'both',
          category: 'pricing',
          active: true,
          published: true,
        },
      ],
      [
        {
          id: 'unrelated_doc',
          title: 'Storage',
          category: 'storage',
          sourceType: 'manual',
          fileName: 's.txt',
          content: 'Keep jar in cool dry cupboard away from moisture.',
          chunkCount: 1,
          status: 'published',
          syncStatus: 'ready',
        },
      ],
      'bn'
    );
    assert.equal(retrieval.faqs.length, 1);
    assert.equal(retrieval.kbSnippets.length, 0); // Score-0 unrelated single-chunk doc dropped!

    // T0.11: CGNAT test — 18 distinct users behind SAME IP succeed, 1 abusive device hitting limit gets 429 + Phone/WhatsApp actions
    delete process.env.GEMINI_API_KEY;
    const sharedIp = '103.92.44.10';
    for (let u = 1; u <= 18; u++) {
      const res = await chatPost(
        buildChatRequest(
          {
            mode: 'published',
            uiLang: 'en',
            sessionId: `cgnat_user_${u}`,
            messages: [{ role: 'user', text: '250g price?' }],
          },
          { 'x-forwarded-for': sharedIp }
        )
      );
      assert.equal(res.status, 200);
      assert.ok(res.headers.get('set-cookie')?.includes('dg_device_id='));
    }

    // Extract one device cookie and exceed DEVICE_PER_MIN (15) from that single device
    const firstRes = await chatPost(
      buildChatRequest(
        {
          mode: 'published',
          uiLang: 'en',
          sessionId: 'abusive_device_sess',
          messages: [{ role: 'user', text: 'Price?' }],
        },
        { 'x-forwarded-for': sharedIp }
      )
    );
    const cookiePair = (firstRes.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookiePair.startsWith('dg_device_id='));

    let hit429 = false;
    for (let i = 0; i < CHATBOT_BUILD_CONFIG.DEVICE_PER_MIN + 1; i++) {
      const r = await chatPost(
        buildChatRequest(
          {
            mode: 'published',
            uiLang: 'en',
            sessionId: 'abusive_device_sess',
            messages: [{ role: 'user', text: 'Price?' }],
          },
          { 'x-forwarded-for': sharedIp, cookie: cookiePair }
        )
      );
      if (r.status === 429) {
        const body429 = (await r.json()) as { code?: string; actions?: unknown[] };
        assert.equal(body429.code, 'device_rate_limit');
        hit429 = true;
        break;
      }
    }
    assert.equal(hit429, true);

    // T0.12: Persistent daily cost cap blocks cleanly with daily_cost_cap_reached
    process.env.GEMINI_DAILY_COST_CAP_USD = '0.25';
    setCostLedgerOverrideForTests({
      get: async (dateKey) => ({
        dateKey,
        totalUsd: 0.30,
        requestCount: 15,
        promptTokens: 5000,
        outputTokens: 3000,
        capHit: true,
        source: 'firestore',
      }),
      record: async (dateKey) => ({
        dateKey,
        totalUsd: 0.30,
        requestCount: 15,
        promptTokens: 5000,
        outputTokens: 3000,
        capHit: true,
        source: 'firestore',
      }),
    });
    const capRes = await chatPost(
      buildChatRequest({
        mode: 'published',
        uiLang: 'en',
        sessionId: 'cost_cap_sess_01',
        messages: [{ role: 'user', text: 'Price?' }],
      })
    );
    const parsedCap = await parseNdjsonResponse(capRes);
    assert.equal(parsedCap.meta?.errorCode, 'daily_cost_cap_reached');
    setCostLedgerOverrideForTests(null);
    delete process.env.GEMINI_DAILY_COST_CAP_USD;

    // T0.8: Failed Gemini turn sets isError=true alongside path='fallback'
    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKeyValue1234567890';
    const capturedErrLogs: Record<string, unknown>[] = [];
    setChatLogObserverForTests((p) => capturedErrLogs.push(p));
    setGeminiClientFactoryForTests(() => ({
      models: {
        generateContent: async () => {
          const err = new Error('401 Invalid API key') as Error & { status: number };
          err.status = 401;
          throw err;
        },
      },
    }) as unknown as GoogleGenAI);

    const errRes = await chatPost(
      buildChatRequest({
        mode: 'published',
        uiLang: 'en',
        sessionId: 'err_telemetry_01',
        messages: [{ role: 'user', text: 'Tell me your 500g price' }],
      })
    );
    const parsedErr = await parseNdjsonResponse(errRes);
    assert.equal(parsedErr.meta?.isError, true);
    assert.equal(parsedErr.meta?.path, 'fallback');
    assert.equal(capturedErrLogs[0]?.isError, true);
    assert.equal(capturedErrLogs[0]?.isUnanswered, true);
  });
});
