import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AdminSdkUnavailableError,
  setAdminSdkAvailableForTests,
  setStrictAdminAuthOverrideForTests,
  verifyAdminIdTokenStrict,
} from '../src/lib/firebaseAdmin';
import {
  projectPublicChatbotConfig,
  sanitizePublicTrackingRecord,
} from '../src/lib/server/adminRepository';
import {
  computeKeyedHmacDigest,
  generateTrackingTokenPair,
  hashTrackingToken,
  timingSafeHexEqual,
  verifySameOriginAndCsrf,
} from '../src/lib/server/requestSecurity';
import { buildChannelSessionId } from '../src/lib/chatbot/channelEngine';
import {
  buildDuplicateFingerprintHash,
  tryCreateSignedOrderToken,
} from '../src/lib/chatbot/orderToken';
import {
  setInventoryMemoryModeForTests,
  setOrderStorageMemoryModeForTests,
  setRateLimitMemoryModeForTests,
  setSessionDraftMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import { GET as publicConfigGet } from '../app/api/chatbot/public-config/route';
import { POST as orderTrackPost } from '../app/api/orders/track/route';
import { POST as orderPost } from '../app/api/order/route';
import { POST as storefrontOrderPost } from '../app/api/orders/storefront/route';
import { TEST_CONFIRMED_STORE_SETTINGS } from './helpers/testStoreFixture';

const ROOT = process.cwd();

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      out.push(...collectTsFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('Stage 2 — Admin SDK, Zero Public-Key Writes, D2/D3/D4/D5/D14/D16 Invariants', () => {
  beforeEach(() => {
    process.env.ORDER_TOKEN_SECRET = 'test_stage2_order_secret_0123456789abcdef';
    process.env.CHANNEL_SESSION_SECRET = 'test_stage2_channel_secret_0123456789abcdef';
    process.env.TRACKING_TOKEN_SECRET = 'test_stage2_tracking_secret_0123456789abcdef';
    setAdminSdkAvailableForTests(null);
    setStrictAdminAuthOverrideForTests(null);
    setRateLimitMemoryModeForTests(true);
    setSessionDraftMemoryModeForTests(true);
    setOrderStorageMemoryModeForTests(true);
    setInventoryMemoryModeForTests({ ...TEST_CONFIRMED_STORE_SETTINGS });
  });

  afterEach(() => {
    setAdminSdkAvailableForTests(null);
    setStrictAdminAuthOverrideForTests(null);
    setRateLimitMemoryModeForTests(false);
    setSessionDraftMemoryModeForTests(false);
    setOrderStorageMemoryModeForTests(false);
    setInventoryMemoryModeForTests(null);
  });

  it('zero_public_key_firestore_writes [static]: zero ?key= Firestore or IdentityToolkit REST calls exist in src/ or app/', () => {
    const files = [...collectTsFiles(path.join(ROOT, 'src')), ...collectTsFiles(path.join(ROOT, 'app'))];
    const violations: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      if (
        /firestore\.googleapis\.com[^\n]*[?&]key=/i.test(text) ||
        /identitytoolkit\.googleapis\.com[^\n]*[?&]key=/i.test(text) ||
        /getFirestoreBaseDocUrl\(\)[^\n]*[?&]key=/i.test(text) ||
        /BASE_DOC_URL[^\n]*[?&]key=/i.test(text)
      ) {
        violations.push(path.relative(ROOT, f));
      }
    }
    assert.deepEqual(violations, [], `Found forbidden ?key= Firestore REST calls in: ${violations.join(', ')}`);
  });

  it('d2_minimal_public_chatbot_config [mock]: GET /api/chatbot/public-config returns ONLY safe public fields (no prompts/contacts/secrets)', async () => {
    const projected = projectPublicChatbotConfig({
      enabled: true,
      botName: 'Deshi Gee Assistant',
      welcomeMessageBn: 'Welcome!',
      quickQuestionsBn: ['Q1', 'Q2'],
      customInstructions: 'SECRET_SYSTEM_INSTRUCTIONS_DO_NOT_LEAK',
      brandStory: 'INTERNAL_01799999999',
    });
    assert.deepEqual(Object.keys(projected).sort(), [
      'botName',
      'enableVoiceFeatures',
      'enabled',
      'quickQuestions',
      'welcomeMessage',
    ]);
    assert.equal(JSON.stringify(projected).includes('SECRET_SYSTEM_INSTRUCTIONS'), false);
    assert.equal(JSON.stringify(projected).includes('01799999999'), false);

    // Also invoke live route handler with mocked empty fetch
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 })) as typeof fetch;
    try {
      const res = await publicConfigGet();
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), [
        'botName',
        'enableVoiceFeatures',
        'enabled',
        'quickQuestions',
        'welcomeMessage',
      ]);
      assert.equal(body.enableVoiceFeatures, false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('d3_strict_admin_email_verified [mock]: verifyAdminIdTokenStrict rejects unverified email admin tokens', async () => {
    setStrictAdminAuthOverrideForTests(async () => ({
      ok: true,
      email: 'kinboni.bd@gmail.com',
      uid: 'uid_unverified',
      emailVerified: false,
    }));
    const res = await verifyAdminIdTokenStrict('Bearer fake_token_12345678901234567890');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'email_not_verified');

    setStrictAdminAuthOverrideForTests(async () => ({
      ok: true,
      email: 'kinboni.bd@gmail.com',
      uid: 'uid_verified',
      emailVerified: true,
    }));
    const resOk = await verifyAdminIdTokenStrict('Bearer valid_token_12345678901234567890');
    assert.equal(resOk.ok, true);
    assert.equal(resOk.emailVerified, true);
  });

  it('d5_fail_closed_503_when_admin_sdk_unavailable [mock]: storefront & chat order writes fail closed 503 when Admin SDK/ADC is unavailable', async () => {
    setOrderStorageMemoryModeForTests(false);
    setAdminSdkAvailableForTests(false);
    // Keep inventory confirmed so we hit the Admin SDK write fail-closed path (not unset-prices 503)
    const err = new AdminSdkUnavailableError('ADC missing');
    assert.equal(err.status, 503);
    assert.equal(err.code, 'admin_sdk_unavailable');

    const resStorefront = await storefrontOrderPost(
      new Request('http://localhost:3000/api/orders/storefront', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          customerName: 'Karim Ahmed',
          phone: '01711223344',
          district: 'Dhaka',
          area: 'Dhanmondi',
          address: 'House 12 Road 5 Dhanmondi',
          qty500g: 1,
          paymentMethod: 'cod',
          uiLang: 'en',
        }),
      })
    );
    assert.equal(resStorefront.status, 503);
    const body = (await resStorefront.json()) as { ok: boolean; code?: string };
    assert.equal(body.ok, false);
    assert.equal(body.code, 'admin_sdk_unavailable');

    const tok = tryCreateSignedOrderToken({
      sessionId: 'sess_d5_test',
      draft: {
        weight: '500g',
        qty: 1,
        qty500g: 1,
        customerName: 'Karim Ahmed',
        phone: '01711223344',
        district: 'Dhaka',
        area: 'Dhanmondi',
        address: 'House 12 Road 5 Dhanmondi',
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
    assert.equal(tok.ok, true);
    if (!tok.ok) return;

    const resChatOrder = await orderPost(
      new Request('http://localhost:3000/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          sessionId: 'sess_d5_test',
          confirmationToken: tok.token,
          uiLang: 'en',
        }),
      })
    );
    assert.equal(resChatOrder.status, 503);
    const chatBody = (await resChatOrder.json()) as { ok: boolean; code?: string };
    assert.equal(chatBody.ok, false);
    assert.equal(chatBody.code, 'admin_sdk_unavailable');
  });

  it('d14_tracking_token_192bit_and_uniform_404 [mock]: 192-bit CSPRNG token works on /api/orders/track, masks phone, filters courier URL, and returns uniform 404 on invalid lookups', async () => {
    const pair = generateTrackingTokenPair();
    assert.equal(pair.trackingToken.length, 32, '24 bytes base64url = 32 chars (192 bits)');
    assert.equal(timingSafeHexEqual(hashTrackingToken(pair.trackingToken), pair.trackingTokenHash), true);

    // Create an order via /api/orders/storefront and capture trackingToken
    const createRes = await storefrontOrderPost(
      new Request('http://localhost:3000/api/orders/storefront', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          customerName: 'Rina Begum',
          phone: '01755443322',
          district: 'Dhaka',
          area: 'Banani',
          address: 'House 7 Road 11 Banani',
          qty500g: 1,
          paymentMethod: 'cod',
          uiLang: 'en',
        }),
      })
    );
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as {
      ok: boolean;
      trackingToken: string;
      trackingHref: string;
      order: { orderNumber: string };
    };
    assert.equal(created.ok, true);
    assert.equal(created.trackingToken.length, 32);
    assert.match(created.trackingHref, /^\/track\?token=/);

    // Lookup by 192-bit token -> 200 with maskedPhone & stripped tokenHash
    const trackOk = await orderTrackPost(
      new Request('http://localhost:3000/api/orders/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ trackingToken: created.trackingToken }),
      })
    );
    assert.equal(trackOk.status, 200);
    const trackData = (await trackOk.json()) as {
      ok: boolean;
      tracking: { orderNumber: string; maskedPhone?: string; trackingTokenHash?: string };
    };
    assert.equal(trackData.ok, true);
    assert.equal(trackData.tracking.orderNumber, created.order.orderNumber);
    assert.equal(trackData.tracking.maskedPhone, '017****3322');
    assert.equal(trackData.tracking.trackingTokenHash, undefined);

    // Wrong token vs wrong order+phone both return uniform 404
    const badToken = await orderTrackPost(
      new Request('http://localhost:3000/api/orders/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ trackingToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
      })
    );
    const badCreds = await orderTrackPost(
      new Request('http://localhost:3000/api/orders/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ orderNumber: created.order.orderNumber, phone: '01799999999' }),
      })
    );
    assert.equal(badToken.status, 404);
    assert.equal(badCreds.status, 404);
    const b1 = (await badToken.json()) as { error: string };
    const b2 = (await badCreds.json()) as { error: string };
    assert.equal(b1.error, b2.error, 'Error message must be uniform across invalid token & mismatched order+phone');

    // Sanitizer blocks non-allowlisted courier URLs (4-04)
    const sanitizedBadUrl = sanitizePublicTrackingRecord(
      { orderNumber: 'DG-10001', courierTrackingUrl: 'https://evil-phishing.example/track/123' },
      '01755443322'
    );
    assert.equal(sanitizedBadUrl.courierTrackingUrl, undefined);
  });

  it('d16_keyed_hmac_channel_session_and_fingerprints [mock]: channel session IDs and duplicate fingerprints depend on server HMAC secret', () => {
    process.env.CHANNEL_SESSION_SECRET = 'secret_alpha_0123456789abcdef';
    const sessA = buildChannelSessionId('whatsapp', '8801712345678');
    process.env.CHANNEL_SESSION_SECRET = 'secret_beta__0123456789abcdef';
    const sessB = buildChannelSessionId('whatsapp', '8801712345678');
    assert.notEqual(sessA, sessB, 'Channel session ID must be keyed HMAC (not plain unkeyed sha256)');
    assert.match(sessA, /^ch_wa_[0-9a-f]{24}$/);

    process.env.ORDER_TOKEN_SECRET = 'fp_secret_1_0123456789abcdef';
    const fpA = buildDuplicateFingerprintHash({
      phone: '01712345678',
      district: 'Dhaka',
      address: 'House 1 Road 2',
      qty250g: 0,
      qty500g: 1,
      qty1kg: 0,
    });
    process.env.ORDER_TOKEN_SECRET = 'fp_secret_2_0123456789abcdef';
    const fpB = buildDuplicateFingerprintHash({
      phone: '01712345678',
      district: 'Dhaka',
      address: 'House 1 Road 2',
      qty250g: 0,
      qty500g: 1,
      qty1kg: 0,
    });
    assert.notEqual(fpA, fpB, 'Order duplicate fingerprint must be keyed HMAC');

    // Same-origin CSRF check blocks cross-origin browser requests
    const crossOrigin = verifySameOriginAndCsrf(
      new Request('https://deshigee.com/api/orders/track', {
        method: 'POST',
        headers: {
          'x-requested-with': 'DeshiGeeStorefront',
          origin: 'https://evil-attacker.example',
        },
      })
    );
    assert.equal(crossOrigin.ok, false);
    assert.equal(crossOrigin.reason, 'cross_origin_rejected');

    const digest = computeKeyedHmacDigest('ns', ['a', 'b'], 'ORDER_TOKEN_SECRET');
    assert.equal(digest.length, 64);
  });
});
