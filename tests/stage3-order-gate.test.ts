import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST as orderPost } from '../app/api/order/route';
import { POST as storefrontOrderPost } from '../app/api/orders/storefront/route';
import { POST as chatPost } from '../app/api/chat/route';
import { POST as managePost } from '../app/api/orders/manage/route';
import {
  getInventoryMemoryStateForTests,
  getOrderStorageMemoryStateForTests,
  setCouponsMemoryForTests,
  setInventoryMemoryModeForTests,
  setOrderStorageMemoryModeForTests,
  setRateLimitMemoryModeForTests,
  setSessionDraftMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import {
  assessOrderRiskSignals,
  resolveConfiguredDistrictAndZone,
  tryCreateSignedOrderToken,
  tryCreateSignedOrderManageToken,
} from '../src/lib/chatbot/orderToken';
import { TEST_CONFIRMED_STORE_SETTINGS } from './helpers/testStoreFixture';

function makeToken(params: {
  sessionId: string;
  phone?: string;
  weight?: '250g' | '500g' | '1kg';
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  subtotalBdt?: number;
  deliveryFeeBdt?: number;
  discountBdt?: number;
  totalBdt?: number;
  couponCode?: string;
  paymentMethod?: 'cod' | 'bkash' | 'nagad';
  txnId?: string;
}) {
  const q250 = params.qty250g ?? 0;
  const q500 = params.qty500g ?? (q250 === 0 && (params.qty1kg ?? 0) === 0 ? 1 : 0);
  const q1k = params.qty1kg ?? 0;
  const totalQty = q250 + q500 + q1k;
  const weight = params.weight || (q1k > 0 ? '1kg' : q500 > 0 ? '500g' : '250g');
  const subtotal = params.subtotalBdt ?? q250 * 680 + q500 * 1290 + q1k * 2480;
  const fee = params.deliveryFeeBdt ?? (subtotal >= 2500 ? 0 : 80);
  const discount = params.discountBdt ?? 0;
  const total = params.totalBdt ?? subtotal + fee - discount;

  const res = tryCreateSignedOrderToken({
    sessionId: params.sessionId,
    draft: {
      weight,
      qty: totalQty,
      qty250g: q250,
      qty500g: q500,
      qty1kg: q1k,
      customerName: 'Stage3 Buyer',
      phone: params.phone || '01711223344',
      district: 'Dhaka',
      area: 'Dhanmondi',
      address: 'House 14 Road 6 Dhanmondi',
      deliveryZone: 'dhaka',
      paymentMethod: params.paymentMethod || 'cod',
      txnId: params.txnId || '',
      couponCode: params.couponCode || '',
      note: '',
    },
    pricing: {
      qty250g: q250,
      qty500g: q500,
      qty1kg: q1k,
      itemsSummary: `${totalQty} × ${weight}`,
      unitPriceBdt: weight === '1kg' ? 2480 : weight === '500g' ? 1290 : 680,
      subtotalBdt: subtotal,
      deliveryFeeBdt: fee,
      discountBdt: discount,
      totalBdt: total,
    },
  });
  assert.equal(res.ok, true);
  if (!res.ok) throw new Error('Token creation failed');
  return res.token;
}

const REAL_FETCH = globalThis.fetch;

describe('Stage 3 — Order & Checkout Integrity Gate Suite [mock]', () => {
  beforeEach(() => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('firestore.googleapis.com')) {
        return new Response(JSON.stringify({ writeResults: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return REAL_FETCH(input);
    }) as typeof fetch;
    process.env.ORDER_TOKEN_SECRET = 'test_stage3_order_gate_secret_0123456789abcdef';
    process.env.TRACKING_TOKEN_SECRET = 'test_stage3_track_secret_0123456789abcdef';
    setRateLimitMemoryModeForTests(true);
    setSessionDraftMemoryModeForTests(true);
    setOrderStorageMemoryModeForTests(true);
    setCouponsMemoryForTests(null);
    setInventoryMemoryModeForTests({ ...TEST_CONFIRMED_STORE_SETTINGS });
  });

  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
    setCouponsMemoryForTests(null);
    setRateLimitMemoryModeForTests(false);
    setSessionDraftMemoryModeForTests(false);
    setOrderStorageMemoryModeForTests(false);
    setInventoryMemoryModeForTests(null);
  });

  it('retry_creates_one_order [mock]: retrying the same Confirm request returns the existing order idempotently with single stock decrement', async () => {
    setInventoryMemoryModeForTests({ ...TEST_CONFIRMED_STORE_SETTINGS, stock500g: 10 });
    const token = makeToken({ sessionId: 'sess_retry_1', phone: '01711110001' });

    const reqInit = () =>
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ sessionId: 'sess_retry_1', confirmationToken: token, uiLang: 'en' }),
      });

    const first = await orderPost(reqInit());
    assert.equal(first.status, 200);
    const firstJson = (await first.json()) as { ok: boolean; orderNumber: string };

    const retry = await orderPost(reqInit());
    assert.equal(retry.status, 200);
    const retryJson = (await retry.json()) as {
      ok: boolean;
      duplicatePrevented: boolean;
      orderNumber: string;
    };

    assert.equal(retryJson.ok, true);
    assert.equal(retryJson.duplicatePrevented, true);
    assert.equal(retryJson.orderNumber, firstJson.orderNumber);
    assert.equal(getOrderStorageMemoryStateForTests()?.orders.size, 1);
    assert.equal(getInventoryMemoryStateForTests()?.stock500g, 9);
  });

  it('double_click_one_order [mock]: concurrent double-click with identical token creates strictly ONE order and ONE stock decrement', async () => {
    setInventoryMemoryModeForTests({ ...TEST_CONFIRMED_STORE_SETTINGS, stock500g: 5 });
    const token = makeToken({ sessionId: 'sess_dbl_click', phone: '01711110002' });

    const fire = () =>
      orderPost(
        new Request('http://localhost:3000/api/order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
          },
          body: JSON.stringify({ sessionId: 'sess_dbl_click', confirmationToken: token, uiLang: 'en' }),
        })
      );

    const [r1, r2] = await Promise.all([fire(), fire()]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const [j1, j2] = await Promise.all([r1.json(), r2.json()]);
    assert.equal(j1.orderNumber, j2.orderNumber);
    assert.equal(getOrderStorageMemoryStateForTests()?.orders.size, 1);
    assert.equal(getInventoryMemoryStateForTests()?.stock500g, 4);
  });

  it('token_replay_rejected [mock]: replaying a consumed token across another session is rejected with 403/409', async () => {
    const token = makeToken({ sessionId: 'sess_replay_owner', phone: '01711110003' });

    const first = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ sessionId: 'sess_replay_owner', confirmationToken: token, uiLang: 'en' }),
      })
    );
    assert.equal(first.status, 200);

    const crossSessionReplay = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ sessionId: 'sess_attacker_999', confirmationToken: token, uiLang: 'en' }),
      })
    );
    assert.equal(crossSessionReplay.status, 403);
    assert.equal(getOrderStorageMemoryStateForTests()?.orders.size, 1);
  });

  it('typed_yes_creates_no_order [mock]: typing yes/confirm/হ্যাঁ/কনফার্ম in /api/chat creates ZERO orders', async () => {
    for (const phrase of ['yes', 'confirm', 'হ্যাঁ', 'কনফার্ম']) {
      const res = await chatPost(
        new Request('http://localhost:3000/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
          },
          body: JSON.stringify({
            sessionId: 'sess_typed_yes_guard',
            uiLang: 'en',
            mode: 'published',
            messages: [{ role: 'user', text: phrase }],
          }),
        })
      );
      assert.equal(res.status, 200);
      await res.text();
    }
    assert.equal(getOrderStorageMemoryStateForTests()?.orders.size, 0);
  });

  it('concurrent_last_unit_one_winner [mock]: true Promise.all race on last 1 jar yields exactly [200, 409] and final stock 0', async () => {
    setInventoryMemoryModeForTests({ ...TEST_CONFIRMED_STORE_SETTINGS, stock1kg: 1 });
    const tokA = makeToken({ sessionId: 'sess_last_a', phone: '01722220001', qty500g: 0, qty1kg: 1 });
    const tokB = makeToken({ sessionId: 'sess_last_b', phone: '01722220002', qty500g: 0, qty1kg: 1 });

    const [resA, resB] = await Promise.all([
      orderPost(
        new Request('http://localhost:3000/api/order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
            'x-forwarded-for': '103.50.30.1',
          },
          body: JSON.stringify({ sessionId: 'sess_last_a', confirmationToken: tokA, uiLang: 'en' }),
        })
      ),
      orderPost(
        new Request('http://localhost:3000/api/order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
            'x-forwarded-for': '103.50.30.2',
          },
          body: JSON.stringify({ sessionId: 'sess_last_b', confirmationToken: tokB, uiLang: 'en' }),
        })
      ),
    ]);

    assert.deepEqual([resA.status, resB.status].sort((a, b) => a - b), [200, 409]);
    const loser = await (resA.status === 409 ? resA : resB).json();
    assert.equal(loser.outOfStock, true);
    assert.equal(getInventoryMemoryStateForTests()?.stock1kg, 0);
    assert.equal(getOrderStorageMemoryStateForTests()?.orders.size, 1);
  });

  it('stale_price_409_with_fresh_token [mock]: live price change returns 409 priceChanged with fresh confirmationToken that succeeds', async () => {
    const oldToken = makeToken({ sessionId: 'sess_stale_px', phone: '01733330001', qty250g: 1, qty500g: 0 });
    // Admin updates 250g price before customer clicks Confirm
    setInventoryMemoryModeForTests({ ...TEST_CONFIRMED_STORE_SETTINGS, price250g: 750, stock250g: 10 });

    const staleRes = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ sessionId: 'sess_stale_px', confirmationToken: oldToken, uiLang: 'en' }),
      })
    );
    assert.equal(staleRes.status, 409);
    const staleBody = (await staleRes.json()) as {
      priceChanged: boolean;
      updatedSummary: { totalBdt: number; confirmationToken: string };
    };
    assert.equal(staleBody.priceChanged, true);
    assert.equal(staleBody.updatedSummary.totalBdt, 830);
    assert.ok(staleBody.updatedSummary.confirmationToken.length > 20);

    const freshRes = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          sessionId: 'sess_stale_px',
          confirmationToken: staleBody.updatedSummary.confirmationToken,
          uiLang: 'en',
        }),
      })
    );
    assert.equal(freshRes.status, 200);
    const freshBody = (await freshRes.json()) as { ok: boolean; totalBdt: number };
    assert.equal(freshBody.ok, true);
    assert.equal(freshBody.totalBdt, 830);
  });

  it('coupon_usage_cap_atomic [mock]: concurrent orders using a 1-use coupon yield 1 winner (200/201) and 1 rejection (409 coupon_usage_limit_reached)', async () => {
    setCouponsMemoryForTests([
      {
        code: 'ONCE10',
        discountPct: 10,
        minSubtotalBdt: 500,
        maxUses: 1,
        usedCount: 0,
        active: true,
        expiresAt: '2030-12-31',
      },
    ]);

    const tok1 = makeToken({
      sessionId: 'sess_cpn_1',
      phone: '01744440001',
      qty500g: 1,
      couponCode: 'ONCE10',
      discountBdt: 129,
      totalBdt: 1241,
    });
    const tok2 = makeToken({
      sessionId: 'sess_cpn_2',
      phone: '01744440002',
      qty500g: 1,
      couponCode: 'ONCE10',
      discountBdt: 129,
      totalBdt: 1241,
    });

    const [r1, r2] = await Promise.all([
      orderPost(
        new Request('http://localhost:3000/api/order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
            'x-forwarded-for': '103.50.31.1',
          },
          body: JSON.stringify({ sessionId: 'sess_cpn_1', confirmationToken: tok1, uiLang: 'en' }),
        })
      ),
      orderPost(
        new Request('http://localhost:3000/api/order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
            'x-forwarded-for': '103.50.31.2',
          },
          body: JSON.stringify({ sessionId: 'sess_cpn_2', confirmationToken: tok2, uiLang: 'en' }),
        })
      ),
    ]);

    assert.deepEqual([r1.status, r2.status].sort((a, b) => a - b), [200, 409]);
    const loser = await (r1.status === 409 ? r1 : r2).json();
    assert.equal(loser.code, 'coupon_usage_limit_reached');
    assert.equal(getOrderStorageMemoryStateForTests()?.orders.size, 1);
  });

  it('stock_decrement_order_token_tracking_atomic [mock]: order, trackingTokenHash, usedToken, idempotency, fingerprint, auditLog, and stock decrement commit together', async () => {
    setInventoryMemoryModeForTests({ ...TEST_CONFIRMED_STORE_SETTINGS, stock250g: 10, stock500g: 8 });
    const tok = makeToken({
      sessionId: 'sess_atomic_all',
      phone: '01755550001',
      qty250g: 1,
      qty500g: 1,
    });

    const res = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ sessionId: 'sess_atomic_all', confirmationToken: tok, uiLang: 'en' }),
      })
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      orderNumber: string;
      trackingToken: string;
      trackingHref: string;
    };
    assert.equal(body.ok, true);
    assert.ok(body.trackingToken.length === 32);
    assert.match(body.trackingHref, /^\/track\?token=/);

    const mem = getOrderStorageMemoryStateForTests()!;
    const savedOrder = mem.orders.get(body.orderNumber);
    const savedTracking = mem.tracking.get(`${body.orderNumber}_01755550001`);
    assert.ok(savedOrder);
    assert.ok(savedTracking);
    assert.ok(savedOrder.trackingTokenHash && savedOrder.trackingTokenHash.length === 64);
    assert.equal(savedTracking.trackingTokenHash, savedOrder.trackingTokenHash);
    assert.equal(mem.usedTokens.size, 1);
    assert.equal(mem.idempotency.size, 1);
    assert.equal(mem.fingerprints.size, 1);
    assert.equal(mem.auditLogs.length >= 1, true);
    assert.equal(getInventoryMemoryStateForTests()?.stock250g, 9);
    assert.equal(getInventoryMemoryStateForTests()?.stock500g, 7);
  });

  it('stage3_extras_max_jars_d13_typo_d12_paid_cancel_cod_threshold [mock]: enforces admin maxJarsPerOrder, D13 district typo confirmation, D12 paid-order human handover, and configurable COD threshold', async () => {
    // 1. Admin maxJarsPerOrder enforcement
    setInventoryMemoryModeForTests({ ...TEST_CONFIRMED_STORE_SETTINGS, maxJarsPerOrder: 3 });
    const overMaxRes = await storefrontOrderPost(
      new Request('http://localhost:3000/api/orders/storefront', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          customerName: 'Bulk Buyer',
          phone: '01766660001',
          district: 'Dhaka',
          area: 'Gulshan',
          address: 'House 2 Road 9 Gulshan',
          qty500g: 4,
          paymentMethod: 'cod',
          uiLang: 'en',
        }),
      })
    );
    assert.equal(overMaxRes.status, 400);
    const overMaxJson = (await overMaxRes.json()) as { code?: string };
    assert.equal(overMaxJson.code, 'max_jars_exceeded');

    // 2. D13 Misspelled district asks "Do you mean ...?" instead of silently rewriting
    const typo = resolveConfiguredDistrictAndZone('Chitagong');
    assert.equal(typo.needsClarification, true);
    assert.equal(typo.valid, false);
    assert.equal(typo.suggestedDistrict, 'Chattogram');

    // 3. Admin-configurable COD risk threshold score
    const customRisk = assessOrderRiskSignals({
      phone: '01711112223',
      addressComplete: false, // +20
      duplicateRecentCount: 0,
      recentOrdersLastHour: 0,
      paymentMethod: 'cod',
      totalBdt: 6000,
      codHighValueThresholdBdt: 5000, // +25 => 45
      codRiskThresholdScore: 40, // custom stricter admin threshold!
    });
    assert.equal(customRisk.reviewStatus, 'manual_review');

    // 4. D12 Cancel paid order via Confirm card restores stock & hands over to human with NO refund promise
    setInventoryMemoryModeForTests({ ...TEST_CONFIRMED_STORE_SETTINGS, stock500g: 10 });
    const paidTok = makeToken({
      sessionId: 'sess_paid_cancel',
      phone: '01777770001',
      qty500g: 1,
      paymentMethod: 'bkash',
      txnId: 'TXN998877',
    });
    const createdPaid = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ sessionId: 'sess_paid_cancel', confirmationToken: paidTok, uiLang: 'en' }),
      })
    );
    assert.equal(createdPaid.status, 200);
    const paidJson = (await createdPaid.json()) as { orderNumber: string };
    assert.equal(getInventoryMemoryStateForTests()?.stock500g, 9);

    const cancelTok = tryCreateSignedOrderManageToken({
      action: 'cancel',
      sessionId: 'sess_paid_cancel',
      orderNumber: paidJson.orderNumber,
      phone: '01777770001',
      reason: 'Ordered by mistake',
    });
    assert.equal(cancelTok.ok, true);
    if (!cancelTok.ok) return;

    const cancelRes = await managePost(
      new Request('http://localhost:3000/api/orders/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          action: 'cancel',
          sessionId: 'sess_paid_cancel',
          actionToken: cancelTok.token,
          uiLang: 'en',
        }),
      })
    );
    assert.equal(cancelRes.status, 200);
    const cancelBody = (await cancelRes.json()) as {
      ok: boolean;
      stockRestored: boolean;
      refundNoticeEn?: string;
    };
    assert.equal(cancelBody.ok, true);
    assert.equal(cancelBody.stockRestored, true);
    assert.equal(getInventoryMemoryStateForTests()?.stock500g, 10);
    // Must mention manual review / support team (not an automatic instant refund promise)
    assert.match(String(cancelBody.refundNoticeEn || ''), /team|manual|verify|support|review/i);
  });
});
