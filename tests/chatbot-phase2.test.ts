import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { POST as chatPost } from '../app/api/chat/route';
import { POST as orderPost } from '../app/api/order/route';
import { POST as codVerifyPost } from '../app/api/orders/cod-verify/route';
import { GET as manageOrderGet, POST as manageOrderPost } from '../app/api/orders/manage/route';
import { POST as prepareOrderPost } from '../app/api/orders/prepare/route';
import { BANGLADESH_DISTRICTS } from '../src/data/deshiGeeData';
import {
  getInventoryMemoryStateForTests,
  getOrderStorageMemoryStateForTests,
  setChatLogObserverForTests,
  setCouponsMemoryForTests,
  setFirestoreHealthOverrideForTests,
  setInventoryMemoryModeForTests,
  setKnowledgeChunkTestStore,
  setOrderStorageMemoryModeForTests,
  setRateLimitMemoryModeForTests,
  setSessionDraftMemoryModeForTests,
  upsertServerOrderDraft,
} from '../src/lib/chatbot/firestoreRest';
import { classifyTurnIntent } from '../src/lib/chatbot/intentRouter';
import {
  assessAddressCompleteness,
  assessOrderRiskSignals,
  computeOrderPricingInPoisha,
  getDispatchWindowInfo,
  resetDevOrderTokenSecretForTests,
  resolveConfiguredDistrictAndZone,
  tryCreateSignedOrderToken,
} from '../src/lib/chatbot/orderToken';
import { buildStoreFactsSnapshot, getSeededVerifiedMonetaryAmounts } from '../src/lib/chatbot/storeFacts';
import { DEFAULT_CHATBOT_CONFIG } from '../src/lib/chatbot/types';
import { clearGeminiHealthCacheForTests, setGeminiClientFactoryForTests } from '../src/lib/gemini/client';
import { CHATBOT_FUNCTION_DECLARATIONS, executeChatbotTool } from '../src/lib/gemini/tools';
import { DEFAULT_ACTIVE_BATCH, DEFAULT_STORE_SETTINGS } from '../src/lib/storeTypes';

const ORIGINAL_ENV = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ORDER_TOKEN_SECRET: process.env.ORDER_TOKEN_SECRET,
};
const REAL_FETCH = globalThis.fetch;

function installPhase2FetchStub() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('identitytoolkit.googleapis.com/v1/accounts:lookup')) {
      return new Response(
        JSON.stringify({
          users: [
            {
              localId: 'uid_admin_p2',
              email: 'kinboni.bd@gmail.com',
              emailVerified: true,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
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
  for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const ev = JSON.parse(line) as Record<string, unknown>;
    if (ev.type === 'delta' && typeof ev.text === 'string') text += ev.text;
    if (ev.type === 'meta') meta = ev;
  }
  return { status: res.status, text, meta };
}

describe('Phase 2 (T2.1-T2.6) — Transactional Safety, 64 Districts, 4-Zone Pricing, Fraud Signals & Pre-Dispatch Self-Serve', () => {
  beforeEach(() => {
    installPhase2FetchStub();
    process.env.ORDER_TOKEN_SECRET = 'phase2_test_order_secret_minimum_32_characters_long';
    delete process.env.GEMINI_API_KEY;
    clearGeminiHealthCacheForTests();
    setGeminiClientFactoryForTests(null);
    setChatLogObserverForTests(null);
    setKnowledgeChunkTestStore([]);
    setRateLimitMemoryModeForTests(true);
    setSessionDraftMemoryModeForTests(true);
    setInventoryMemoryModeForTests({});
    setCouponsMemoryForTests(null);
    setOrderStorageMemoryModeForTests(true);
    setFirestoreHealthOverrideForTests(async () => ({
      reachable: true,
      latencyMs: 4,
      detail: 'mock',
    }));
  });

  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
    process.env.GEMINI_API_KEY = ORIGINAL_ENV.GEMINI_API_KEY;
    process.env.ORDER_TOKEN_SECRET = ORIGINAL_ENV.ORDER_TOKEN_SECRET;
    clearGeminiHealthCacheForTests();
    setGeminiClientFactoryForTests(null);
    setChatLogObserverForTests(null);
    setKnowledgeChunkTestStore(null);
    setRateLimitMemoryModeForTests(false);
    setSessionDraftMemoryModeForTests(false);
    setInventoryMemoryModeForTests(null);
    setCouponsMemoryForTests(null);
    setOrderStorageMemoryModeForTests(false);
    setFirestoreHealthOverrideForTests(null);
    resetDevOrderTokenSecretForTests();
  });

  it('T2.1: Blocks typed "Yes"/"হ্যাঁ"/"OK" when summary card is awaiting_confirmation without creating an order', async () => {
    const sessId = 'sess_typed_yes_guard_01';
    await upsertServerOrderDraft({
      draftId: `draft_${sessId}`,
      sessionId: sessId,
      weight: '500g',
      qty: 1,
      qty500g: 1,
      customerName: 'Nadia Islam',
      phone: '01711002233',
      district: 'Dhaka',
      area: 'Banani',
      address: 'Road 11 House 24 Banani',
      paymentMethod: 'cod',
      state: 'awaiting_confirmation',
      priceQuoteVersion: 1,
      validationErrors: [],
      expiresAt: Date.now() + 20 * 60 * 1000,
    });

    for (const typed of ['Yes', 'হ্যাঁ', 'OK', 'Confirm']) {
      const res = await chatPost(
        new Request('http://localhost:3000/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
            'x-forwarded-for': '103.50.20.1',
          },
          body: JSON.stringify({
            mode: 'published',
            uiLang: typed === 'হ্যাঁ' ? 'bn' : 'en',
            sessionId: sessId,
            messages: [{ role: 'user', text: typed }],
          }),
        })
      );
      const parsed = await parseNdjson(res);
      assert.equal(parsed.status, 200);
      assert.equal(parsed.meta?.model, 'confirmation-button-guard');
      assert.equal(parsed.meta?.errorCode, 'typed_confirmation_requires_button');
    }

    assert.equal(getOrderStorageMemoryStateForTests()?.orders.size, 0);
  });

  it('T2.1 & T2.2: Mixed-variant cart quote & atomic stock race protection (1 jar left -> 1 wins 200, 1 fails 409 outOfStock)', async () => {
    // 1. Mixed-variant quote calculation (1x 250g ৳680 + 1x 500g ৳1290 = ৳1970 + suburban fee ৳100 = ৳2070)
    const facts = buildStoreFactsSnapshot({
      settings: DEFAULT_STORE_SETTINGS,
      batch: DEFAULT_ACTIVE_BATCH,
      config: DEFAULT_CHATBOT_CONFIG,
    });
    const quoteRes = await executeChatbotTool(
      'calculate_cart_quote',
      {
        qty_250g: 1,
        qty_500g: 1,
        qty_1kg: 0,
        district: 'Savar',
        area: 'Ashulia',
        payment_method: 'cod',
      },
      {
        sessionId: 'sess_quote_mixed',
        replyLang: 'en',
        settings: DEFAULT_STORE_SETTINGS,
        config: DEFAULT_CHATBOT_CONFIG,
        batch: DEFAULT_ACTIVE_BATCH,
        facts,
        faqs: [],
        kbDocs: [],
        isTestPlayground: false,
        collectedActions: [],
        orderState: 'collecting_details',
        handoverTriggered: false,
        detectedIntent: 'pricing',
        verifiedMonetaryAmounts: getSeededVerifiedMonetaryAmounts(facts),
      }
    );
    assert.equal(quoteRes.ok, true);
    assert.equal(quoteRes.subtotalBdt, 1970);
    assert.equal(quoteRes.deliveryZone, 'suburban');
    assert.equal(quoteRes.deliveryFeeBdt, 100);
    assert.equal(quoteRes.totalBdt, 2070);

    // 2. Concurrent stock race: only 1 jar of 500g in stock, 2 buyers click Confirm simultaneously
    setInventoryMemoryModeForTests({ stock500g: 1 });
    const tokenA = tryCreateSignedOrderToken({
      sessionId: 'sess_race_a',
      draft: {
        weight: '500g',
        qty: 1,
        qty500g: 1,
        customerName: 'Buyer Alpha',
        phone: '01711112222',
        district: 'Dhaka',
        area: 'Dhanmondi',
        address: 'House 10 Road 4 Dhanmondi',
        deliveryZone: 'dhaka',
        paymentMethod: 'cod',
        txnId: '',
        couponCode: '',
        note: '',
      },
      pricing: {
        qty500g: 1,
        itemsSummary: '1 × 500g',
        unitPriceBdt: 1290,
        subtotalBdt: 1290,
        deliveryFeeBdt: 80,
        discountBdt: 0,
        totalBdt: 1370,
      },
    });
    const tokenB = tryCreateSignedOrderToken({
      sessionId: 'sess_race_b',
      draft: {
        weight: '500g',
        qty: 1,
        qty500g: 1,
        customerName: 'Buyer Beta',
        phone: '01811113333',
        district: 'Dhaka',
        area: 'Uttara',
        address: 'House 20 Sector 7 Uttara',
        deliveryZone: 'dhaka',
        paymentMethod: 'cod',
        txnId: '',
        couponCode: '',
        note: '',
      },
      pricing: {
        qty500g: 1,
        itemsSummary: '1 × 500g',
        unitPriceBdt: 1290,
        subtotalBdt: 1290,
        deliveryFeeBdt: 80,
        discountBdt: 0,
        totalBdt: 1370,
      },
    });
    assert.equal(tokenA.ok, true);
    assert.equal(tokenB.ok, true);
    if (!tokenA.ok || !tokenB.ok) return;

    const [resA, resB] = await Promise.all([
      orderPost(
        new Request('http://localhost:3000/api/order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
            'x-forwarded-for': '103.50.21.1',
          },
          body: JSON.stringify({
            uiLang: 'en',
            sessionId: 'sess_race_a',
            confirmationToken: tokenA.token,
          }),
        })
      ),
      orderPost(
        new Request('http://localhost:3000/api/order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
            'x-forwarded-for': '103.50.21.2',
          },
          body: JSON.stringify({
            uiLang: 'en',
            sessionId: 'sess_race_b',
            confirmationToken: tokenB.token,
          }),
        })
      ),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);
    const bodyFail = await (resA.status === 409 ? resA : resB).json();
    assert.equal(bodyFail.outOfStock, true);
    assert.equal(getInventoryMemoryStateForTests()?.stock500g, 0);
  });

  it('T2.2: Revalidates live price/fee changes (409 priceChanged + fresh token), enforces idempotency & session ownership', async () => {
    const initialToken = tryCreateSignedOrderToken({
      sessionId: 'sess_price_reval',
      draft: {
        weight: '250g',
        qty: 1,
        qty250g: 1,
        customerName: 'Salma Akter',
        phone: '01911223344',
        district: 'Dhaka',
        area: 'Mirpur',
        address: 'House 8 Road 2 Mirpur DOHS',
        deliveryZone: 'dhaka',
        paymentMethod: 'cod',
        txnId: '',
        couponCode: '',
        note: '',
      },
      pricing: {
        qty250g: 1,
        itemsSummary: '1 × 250g',
        unitPriceBdt: 680,
        subtotalBdt: 680,
        deliveryFeeBdt: 80,
        discountBdt: 0,
        totalBdt: 760,
      },
    });
    assert.equal(initialToken.ok, true);
    if (!initialToken.ok) return;

    // Session ownership mismatch returns 403
    const mismatchRes = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          uiLang: 'en',
          sessionId: 'wrong_session_99',
          confirmationToken: initialToken.token,
        }),
      })
    );
    assert.equal(mismatchRes.status, 403);

    // Admin raises 250g price to 720 while summary is open -> 409 priceChanged with updatedSummary & fresh token
    setInventoryMemoryModeForTests({ price250g: 720, stock250g: 10 });
    const staleRes = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          uiLang: 'en',
          sessionId: 'sess_price_reval',
          confirmationToken: initialToken.token,
        }),
      })
    );
    assert.equal(staleRes.status, 409);
    const staleJson = (await staleRes.json()) as {
      priceChanged?: boolean;
      updatedSummary?: { totalBdt: number; confirmationToken: string };
    };
    assert.equal(staleJson.priceChanged, true);
    assert.equal(staleJson.updatedSummary?.totalBdt, 800);

    // Confirming with the refreshed token succeeds and is idempotent on repeat
    const freshToken = staleJson.updatedSummary!.confirmationToken;
    const okRes = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          uiLang: 'en',
          sessionId: 'sess_price_reval',
          confirmationToken: freshToken,
        }),
      })
    );
    assert.equal(okRes.status, 200);
    const okJson = (await okRes.json()) as { orderNumber: string; duplicatePrevented: boolean };
    assert.equal(okJson.duplicatePrevented, false);

    const repeatRes = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          uiLang: 'en',
          sessionId: 'sess_price_reval',
          confirmationToken: freshToken,
        }),
      })
    );
    assert.equal(repeatRes.status, 200);
    const repeatJson = (await repeatRes.json()) as { orderNumber: string; duplicatePrevented: boolean };
    assert.equal(repeatJson.duplicatePrevented, true);
    assert.equal(repeatJson.orderNumber, okJson.orderNumber);
    assert.equal(getInventoryMemoryStateForTests()?.stock250g, 9);
  });

  it('T2.3: Validates canonical 64 Bangladesh districts, Savar->Dhaka suburban mapping, fuzzy typos, address quality & 2h duplicate detection', async () => {
    assert.equal(BANGLADESH_DISTRICTS.length, 64);
    assert.equal(BANGLADESH_DISTRICTS.includes('Savar'), false);

    const savar = resolveConfiguredDistrictAndZone('Savar', '', 'Ashulia');
    assert.equal(savar.valid, true);
    assert.equal(savar.canonicalDistrict, 'Dhaka');
    assert.equal(savar.deliveryZone, 'suburban');

    const ctgTypo = resolveConfiguredDistrictAndZone('Chitagong', '', 'Agrabad');
    assert.equal(ctgTypo.valid, false);
    assert.equal(ctgTypo.needsClarification, true);
    assert.equal(ctgTypo.suggestedDistrict, 'Chattogram');
    assert.equal(ctgTypo.matchedBy, 'fuzzy');

    const sylhetTypo = resolveConfiguredDistrictAndZone('Shylet', '', 'Zindabazar');
    assert.equal(sylhetTypo.valid, false);
    assert.equal(sylhetTypo.needsClarification, true);
    assert.equal(sylhetTypo.suggestedDistrict, 'Sylhet');

    const remoteBandarban = resolveConfiguredDistrictAndZone('Bandarban', '', 'Sadar');
    assert.equal(remoteBandarban.valid, true);
    assert.equal(remoteBandarban.deliveryZone, 'remote');

    // Placeholder / vague street address rejected by both helper and /api/orders/prepare
    const weakAddr = assessAddressCompleteness('Mirpur Dhaka', 'Mirpur', 'Dhaka');
    assert.equal(weakAddr.complete, false);

    const badPrepRes = await prepareOrderPost(
      new Request('http://localhost:3000/api/orders/prepare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          customerName: 'Tareq Mahmud',
          phone: '01722334455',
          district: 'Dhaka',
          area: 'Mirpur',
          address: 'Mirpur',
          qty500g: 1,
          paymentMethod: 'cod',
        }),
      })
    );
    assert.equal(badPrepRes.status, 400);

    // 2-hour duplicate order fingerprint warning triggered on second identical order
    const t1 = tryCreateSignedOrderToken({
      sessionId: 'sess_dup_1',
      draft: {
        weight: '500g',
        qty: 1,
        qty500g: 1,
        customerName: 'Tariq Hasan',
        phone: '01733445566',
        district: 'Dhaka',
        area: 'Banani',
        address: 'House 15 Road 7 Banani',
        deliveryZone: 'dhaka',
        paymentMethod: 'cod',
        txnId: '',
        couponCode: '',
        note: '',
      },
      pricing: {
        qty500g: 1,
        itemsSummary: '1 × 500g',
        unitPriceBdt: 1290,
        subtotalBdt: 1290,
        deliveryFeeBdt: 80,
        discountBdt: 0,
        totalBdt: 1370,
      },
    });
    const t2 = tryCreateSignedOrderToken({
      sessionId: 'sess_dup_2',
      draft: {
        weight: '500g',
        qty: 1,
        qty500g: 1,
        customerName: 'Tariq Hasan',
        phone: '01733445566',
        district: 'Dhaka',
        area: 'Banani',
        address: 'House 15 Road 7 Banani',
        deliveryZone: 'dhaka',
        paymentMethod: 'cod',
        txnId: '',
        couponCode: '',
        note: '',
      },
      pricing: {
        qty500g: 1,
        itemsSummary: '1 × 500g',
        unitPriceBdt: 1290,
        subtotalBdt: 1290,
        deliveryFeeBdt: 80,
        discountBdt: 0,
        totalBdt: 1370,
      },
    });
    assert.equal(t1.ok && t2.ok, true);
    if (!t1.ok || !t2.ok) return;

    await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          uiLang: 'en',
          sessionId: 'sess_dup_1',
          confirmationToken: t1.token,
        }),
      })
    );
    const secondDupRes = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          uiLang: 'en',
          sessionId: 'sess_dup_2',
          confirmationToken: t2.token,
        }),
      })
    );
    assert.equal(secondDupRes.status, 200);
    const dupJson = (await secondDupRes.json()) as {
      duplicateWarning?: string;
      riskSignals?: string[];
    };
    assert.ok(dupJson.duplicateWarning && dupJson.duplicateWarning.includes('DG-'));
    assert.equal(dupJson.riskSignals?.includes('recent_duplicate_fingerprint'), true);
  });

  it('T2.4: Coupon lifecycle rules (expired, usage limit, non-stackable advance) & dispatch cutoff notice', () => {
    const expiredPricing = computeOrderPricingInPoisha({
      settings: DEFAULT_STORE_SETTINGS,
      qty500g: 2,
      deliveryZone: 'nationwide',
      paymentMethod: 'cod',
      coupon: {
        code: 'OLD20',
        discountPct: 20,
        minSubtotalBdt: 1000,
        active: true,
        expiresAt: '2024-01-01',
      },
    });
    assert.equal(expiredPricing.couponEvaluation?.valid, false);
    assert.equal(expiredPricing.couponEvaluation?.reason, 'expired');
    assert.equal(expiredPricing.discountBdt, 0);

    const cappedPricing = computeOrderPricingInPoisha({
      settings: DEFAULT_STORE_SETTINGS,
      qty500g: 2,
      deliveryZone: 'nationwide',
      paymentMethod: 'cod',
      coupon: {
        code: 'CAP10',
        discountPct: 10,
        minSubtotalBdt: 1000,
        active: true,
        maxUses: 5,
        usedCount: 5,
      },
    });
    assert.equal(cappedPricing.couponEvaluation?.valid, false);
    assert.equal(cappedPricing.couponEvaluation?.reason, 'usage_limit_reached');

    const nonStackPricing = computeOrderPricingInPoisha({
      settings: { ...DEFAULT_STORE_SETTINGS, advanceDiscountPct: 5 },
      qty1kg: 1,
      deliveryZone: 'dhaka',
      paymentMethod: 'bkash',
      coupon: {
        code: 'NOSTACK',
        discountPct: 10,
        minSubtotalBdt: 1000,
        active: true,
        stackableWithAdvance: false,
      },
    });
    // Non-stackable chooses better single discount: coupon 10% (248) vs advance 5% (124) -> 248 (not 372)
    assert.equal(nonStackPricing.discountBdt, 248);

    const dispatch = getDispatchWindowInfo(DEFAULT_STORE_SETTINGS);
    assert.ok(dispatch.cutoffHourBst === 14);
    assert.ok(dispatch.noticeEn.length > 10 && dispatch.noticeBn.length > 10);
  });

  it('T2.5: Honest UnconfiguredCodVerificationProvider & transparent fraud signal manual_review queueing', async () => {
    const statusRes = await codVerifyPost(
      new Request('http://localhost:3000/api/orders/cod-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ action: 'status' }),
      })
    );
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as {
      providerConfigured: boolean;
      status: string;
    };
    assert.equal(statusJson.providerConfigured, false);
    assert.equal(statusJson.status, 'not_configured');

    const risk = assessOrderRiskSignals({
      phone: '01700000000',
      addressComplete: true,
      duplicateRecentCount: 1,
      recentOrdersLastHour: 0,
      paymentMethod: 'cod',
      totalBdt: 6200,
      codHighValueThresholdBdt: 5000,
    });
    assert.equal(risk.reviewStatus, 'manual_review');
    assert.equal(risk.riskSignals.includes('synthetic_phone_pattern'), true);
    assert.equal(risk.riskSignals.includes('high_value_cod'), true);
    assert.equal(risk.riskSignals.includes('recent_duplicate_fingerprint'), true);
  });

  it('T2.6: Pre-dispatch customer Edit Address (recalculates fee/ETA), Cancel (restores stock + MFS refund notice), Admin Review & 21+ Gemini tools', async () => {
    assert.ok(CHATBOT_FUNCTION_DECLARATIONS.length >= 21);
    const manageIntent = classifyTurnIntent('Cancel my order DG-55555');
    assert.equal(manageIntent.allowedToolNames.includes('request_cancel'), true);
    assert.equal(manageIntent.allowedToolNames.includes('request_address_change'), true);

    // Create a bKash pre-dispatch order in Dhaka (qty=1x 500g)
    setInventoryMemoryModeForTests({ stock500g: 10 });
    const tok = tryCreateSignedOrderToken({
      sessionId: 'sess_manage_flow',
      draft: {
        weight: '500g',
        qty: 1,
        qty500g: 1,
        customerName: 'Nusrat Jahan',
        phone: '01755667788',
        district: 'Dhaka',
        area: 'Gulshan',
        address: 'House 19 Road 32 Gulshan 2',
        deliveryZone: 'dhaka',
        paymentMethod: 'bkash',
        txnId: 'TXN889922',
        couponCode: '',
        note: '',
      },
      pricing: {
        qty500g: 1,
        itemsSummary: '1 × 500g',
        unitPriceBdt: 1290,
        subtotalBdt: 1290,
        deliveryFeeBdt: 80,
        discountBdt: 0,
        totalBdt: 1370,
      },
    });
    assert.equal(tok.ok, true);
    if (!tok.ok) return;

    const createRes = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          uiLang: 'en',
          sessionId: 'sess_manage_flow',
          confirmationToken: tok.token,
        }),
      })
    );
    const created = (await createRes.json()) as { orderNumber: string };
    assert.equal(getInventoryMemoryStateForTests()?.stock500g, 9);

    // 1. Pre-dispatch Edit Address -> move to remote Cox's Bazar -> fee updates from ৳80 to ৳160 (total ৳1450)
    const editRes = await manageOrderPost(
      new Request('http://localhost:3000/api/orders/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          action: 'edit_address',
          orderNumber: created.orderNumber,
          phone: '01755667788',
          district: "Cox's Bazar",
          area: 'Kolatoli',
          address: 'Hotel Sea Road Block B Plot 14',
        }),
      })
    );
    assert.equal(editRes.status, 200);
    const editJson = (await editRes.json()) as {
      updatedZone: string;
      updatedDeliveryFeeBdt: number;
      updatedTotalBdt: number;
    };
    assert.equal(editJson.updatedZone, 'remote');
    assert.equal(editJson.updatedDeliveryFeeBdt, 160);
    assert.equal(editJson.updatedTotalBdt, 1450);

    // 2. Pre-dispatch Cancel -> restores stock (9 -> 10) and emits bKash advance refund notice
    const cancelRes = await manageOrderPost(
      new Request('http://localhost:3000/api/orders/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          action: 'cancel',
          orderNumber: created.orderNumber,
          phone: '01755667788',
          reason: 'Need to reorder later',
        }),
      })
    );
    assert.equal(cancelRes.status, 200);
    const cancelJson = (await cancelRes.json()) as {
      stockRestored: boolean;
      refundNoticeEn?: string;
    };
    assert.equal(cancelJson.stockRestored, true);
    assert.ok(cancelJson.refundNoticeEn && cancelJson.refundNoticeEn.includes('BKASH'));
    assert.equal(getInventoryMemoryStateForTests()?.stock500g, 10);

    // 3. Admin audit log inspection returns all 3 immutable events (created, address_updated, cancelled)
    const auditRes = await manageOrderGet(
      new Request(
        `http://localhost:3000/api/orders/manage?action=audit_logs&orderNumber=${encodeURIComponent(
          created.orderNumber
        )}`,
        {
          headers: { Authorization: 'Bearer test_valid_admin_token_1234567890' },
        }
      )
    );
    assert.equal(auditRes.status, 200);
    const auditJson = (await auditRes.json()) as { logs: { action: string }[] };
    assert.deepEqual(
      auditJson.logs.map((l) => l.action),
      ['created', 'address_updated', 'cancelled']
    );

    // 4. Post-dispatch lock check: set status to 'shipped' -> customer edit rejected with 409 post_dispatch_locked
    const mem = getOrderStorageMemoryStateForTests()!;
    mem.tracking.get(`${created.orderNumber}_01755667788`)!.status = 'shipped';
    const lockedRes = await manageOrderPost(
      new Request('http://localhost:3000/api/orders/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          action: 'cancel',
          orderNumber: created.orderNumber,
          phone: '01755667788',
        }),
      })
    );
    assert.equal(lockedRes.status, 409);
    const lockedJson = (await lockedRes.json()) as { code: string; supportRequired: boolean };
    assert.equal(lockedJson.code, 'post_dispatch_locked');
    assert.equal(lockedJson.supportRequired, true);
  });
});
