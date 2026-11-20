import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_ACTIVE_BATCH,
  DEFAULT_STORE_SETTINGS,
  getConfirmedDeliveryFeeForZone,
  getConfirmedPriceForWeight,
  hasValidRealContact,
  hasValidRealPhone,
  hasValidRealUrl,
  isPlaceholderContactValue,
  isStorefrontOrderingReady,
} from '../src/lib/storeTypes';
import { DEFAULT_CHATBOT_CONFIG } from '../src/lib/chatbot/types';
import { buildStoreFactsSnapshot } from '../src/lib/chatbot/storeFacts';
import { CURATED_PRODUCT_KNOWLEDGE_PACK } from '../src/lib/chatbot/hybridRag';
import { POST as postStorefrontOrder } from '../app/api/orders/storefront/route';
import { POST as postChatOrder } from '../app/api/order/route';
import {
  setInventoryMemoryModeForTests,
  setRateLimitMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import { tryCreateSignedOrderToken } from '../src/lib/chatbot/orderToken';
import { TEST_CONFIRMED_STORE_SETTINGS } from './helpers/testStoreFixture';

const REPO_ROOT = process.cwd();

test('ui_hides_unset_store_values [mock/static]: default store settings are strictly unset and hidden until owner confirms', () => {
  assert.equal(DEFAULT_STORE_SETTINGS.price250g, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.price500g, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.price1kg, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.stock250g, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.stock500g, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.stock1kg, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.insideDhakaFee, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.dhakaSuburbanFee, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.outsideDhakaFee, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.remoteDistrictFee, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.freeDeliveryThreshold, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.dispatchCutoffHourBst ?? 0, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.advanceDiscountPct, 0);
  assert.equal(DEFAULT_STORE_SETTINGS.activeBatchCode, '');

  // Confirmed helpers return null/false for unset defaults
  assert.equal(getConfirmedPriceForWeight(DEFAULT_STORE_SETTINGS, '250g'), null);
  assert.equal(getConfirmedPriceForWeight(DEFAULT_STORE_SETTINGS, '500g'), null);
  assert.equal(getConfirmedPriceForWeight(DEFAULT_STORE_SETTINGS, '1kg'), null);
  assert.equal(getConfirmedDeliveryFeeForZone(DEFAULT_STORE_SETTINGS, 'dhaka'), null);
  assert.equal(getConfirmedDeliveryFeeForZone(DEFAULT_STORE_SETTINGS, 'outside_dhaka'), null);
  assert.equal(isStorefrontOrderingReady(DEFAULT_STORE_SETTINGS), false);

  // Batch default is empty (no DG-PAB-2026-042)
  assert.equal(DEFAULT_ACTIVE_BATCH.batchCode, '');
  assert.equal(DEFAULT_ACTIVE_BATCH.labReportStatus, '');

  // Chatbot default languageBehavior = bangla_script (D1) and voice OFF (D15)
  assert.equal(DEFAULT_CHATBOT_CONFIG.languageBehavior, 'bangla_script');
  assert.equal(DEFAULT_CHATBOT_CONFIG.enableVoiceFeatures, false);
  assert.equal(DEFAULT_CHATBOT_CONFIG.approvedClaims, '');
  assert.equal(DEFAULT_CHATBOT_CONFIG.shelfLife, '');

  // StoreFacts snapshot reflects orderingReady=false and empty claims/batch
  const facts = buildStoreFactsSnapshot({
    settings: DEFAULT_STORE_SETTINGS,
    batch: null,
    config: DEFAULT_CHATBOT_CONFIG,
  });
  assert.equal(facts.orderingReady, false);
  assert.equal(facts.payments.bkashConfigured, false);
  assert.equal(facts.payments.nagadConfigured, false);
  assert.equal(facts.approvedClaims.length, 0);
  assert.equal(facts.activeBatch.batchCode, '');

  // Starter KB pack entries are strictly DRAFT only (D11)
  for (const item of CURATED_PRODUCT_KNOWLEDGE_PACK) {
    assert.equal(item.published, false);
    assert.equal(item.active, false);
    assert.match(item.draftNotice, /owner review required/i);
    assert.ok(item.sourceRef.length > 5);
  }
});

test('placeholder_contacts_never_render [static]: placeholder phone/WhatsApp/address/Maps values are rejected by validators', () => {
  const placeholders = [
    '',
    '01700-000000',
    '8801700000000',
    '+880 1700-000000',
    '01800-000000',
    '01700000000',
    'Coming Soon',
    'TBD',
    'N/A',
    'https://maps.google.com/?q=placeholder',
  ];

  for (const value of placeholders) {
    assert.equal(
      isPlaceholderContactValue(value),
      true,
      `Expected "${value}" to be classified as placeholder`
    );
    assert.equal(hasValidRealPhone(value), false, `Expected "${value}" to fail real phone check`);
    assert.equal(hasValidRealContact(value), false, `Expected "${value}" to fail real contact check`);
  }

  assert.equal(hasValidRealUrl(''), false);
  assert.equal(hasValidRealUrl('https://example.com/maps'), false);
  assert.equal(hasValidRealPhone('01712345678'), true);
  assert.equal(hasValidRealContact('House 12, Dhanmondi, Dhaka'), true);
  assert.equal(hasValidRealUrl('https://maps.app.goo.gl/deshigee'), true);

  // StorefrontProvider hides WhatsApp / unconfigured contacts and offers Request a Callback (D17/D18)
  const providerSrc = fs.readFileSync(
    path.join(REPO_ROOT, 'src/components/StorefrontProvider.tsx'),
    'utf8'
  );
  assert.match(providerSrc, /whatsappConfigured\s*&&/);
  assert.match(providerSrc, /NEXT_PUBLIC_ENABLE_POLICY_DRAFTS/);
  assert.match(providerSrc, /DRAFT – owner review required/);
  assert.match(providerSrc, /\/api\/support\/ticket/);
});

test('no_unapproved_claims_in_bundle [static]: storefront components and data contain zero unapproved claims or invented batch/coupon literals', () => {
  const filesToScan = [
    'src/components/HomeStorefrontView.tsx',
    'src/components/StorefrontProvider.tsx',
    'src/components/BagCheckoutDrawer.tsx',
    'src/components/BatchVerifyView.tsx',
    'src/components/TrackOrderView.tsx',
    'src/data/deshiGeeData.ts',
    'src/lib/storeTypes.ts',
    'src/lib/chatbot/types.ts',
    'src/lib/chatbot/hybridRag.ts',
  ];

  const forbiddenPatterns: Array<{ label: string; regex: RegExp }> = [
    { label: 'Lab Tested Authenticity', regex: /Lab Tested Authenticity/i },
    { label: '100% Lab Tested Purity', regex: /100%\s*Lab Tested Purity/i },
    { label: '24h Replacement Guarantee', regex: /24h Replacement Guarantee/i },
    { label: 'DG-PAB-2026-042 placeholder batch', regex: /DG-PAB-2026-042/i },
    { label: '18°C / 36°C / 250°C invented temperature', regex: /\b(18°C|36°C|250°C)\b/ },
    { label: 'placeholder phone 01700-000000', regex: /01700-000000|8801700000000/ },
    { label: 'DESHI10 hardcoded promo', regex: /\bDESHI10\b/ },
  ];

  for (const relPath of filesToScan) {
    const content = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
    for (const rule of forbiddenPatterns) {
      assert.equal(
        rule.regex.test(content),
        false,
        `Forbidden unapproved claim "${rule.label}" found in ${relPath}`
      );
    }
  }
});

test('checkout_blocked_when_prices_unset [mock]: /api/orders/storefront and /api/order fail closed (503) when store prices/fees are unset', async () => {
  process.env.DESHI_GEE_TEST_MODE = '1';
  process.env.ORDER_TOKEN_SECRET = 'test-stage1-order-secret-minimum-32-chars-ok';

  try {
    // 1. Storefront checkout blocked when settings are unset
    setRateLimitMemoryModeForTests(true);
    setInventoryMemoryModeForTests({ ...DEFAULT_STORE_SETTINGS });

    const sfReq = new Request('http://localhost:3000/api/orders/storefront', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'DeshiGeeStorefront',
      },
      body: JSON.stringify({
        customerName: 'Masud Test',
        phone: '01712345678',
        district: 'Dhaka',
        area: 'Dhanmondi',
        address: 'House 12, Road 4, Dhanmondi, Dhaka',
        qty500g: 1,
        paymentMethod: 'cod',
      }),
    });

    const sfRes = await postStorefrontOrder(sfReq);
    assert.equal(sfRes.status, 503);
    const sfJson = (await sfRes.json()) as { ok: boolean; code?: string };
    assert.equal(sfJson.ok, false);
    assert.equal(sfJson.code, 'ordering_not_available');

    // 2. Chat /api/order also blocked (503) when settings are unset
    const signed = tryCreateSignedOrderToken({
      sessionId: 'sess_stage1_unset',
      draft: {
        weight: '500g',
        qty: 1,
        qty250g: 0,
        qty500g: 1,
        qty1kg: 0,
        customerName: 'Masud Test',
        phone: '01712345678',
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
        qty250g: 0,
        qty500g: 1,
        qty1kg: 0,
        itemsSummary: '1x 500g',
        unitPriceBdt: 1290,
        subtotalBdt: 1290,
        deliveryFeeBdt: 80,
        discountBdt: 0,
        totalBdt: 1370,
      },
    });
    assert.equal(signed.ok, true);
    if (!signed.ok) return;

    const chatReq = new Request('http://localhost:3000/api/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'DeshiGeeStorefront',
      },
      body: JSON.stringify({
        sessionId: 'sess_stage1_unset',
        confirmationToken: signed.token,
      }),
    });

    const chatRes = await postChatOrder(chatReq);
    assert.equal(chatRes.status, 503);
    const chatJson = (await chatRes.json()) as { ok: boolean; code?: string };
    assert.equal(chatJson.ok, false);
    assert.equal(chatJson.code, 'ordering_not_available');

    // 3. Confirmed test fixture passes readiness check
    assert.equal(isStorefrontOrderingReady(TEST_CONFIRMED_STORE_SETTINGS), true);
  } finally {
    setInventoryMemoryModeForTests(null);
    setRateLimitMemoryModeForTests(false);
  }
});
