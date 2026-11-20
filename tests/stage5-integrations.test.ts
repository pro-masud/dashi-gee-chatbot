import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PAYMENT_LIFECYCLE_STATES,
  createMockPaymentProvider,
  derivePaymentLifecycleState,
  computeSslCommerzIpnSignature,
  verifySslCommerzIpnSignature,
} from '../src/lib/integrations/paymentGateway';
import {
  createMockCourierProvider,
  sanitizeCourierTrackingUrl,
  mapCourierRawStatusToOrderStatus,
} from '../src/lib/integrations/courierApi';
import { sanitizeGatewayDetail } from '../src/lib/integrations/messagingGateway';
import {
  classifyGeminiError,
  estimateGeminiCostUsd,
  resolveConfiguredChatModels,
  DEFAULT_GEMINI_MODEL,
  FALLBACK_GEMINI_MODEL,
} from '../src/lib/gemini/client';

const ROOT = process.cwd();

describe('Stage 5 — Integrations Audit & Hardening (Payment, Courier, Messaging, Refill, Gemini Failover)', () => {
  it('stage5_1_payment_provider_lifecycle_and_ipn [mock]: PaymentProvider interface, full lifecycle states, mock verification & SSLCommerz IPN HMAC/MD5', async () => {
    assert.deepEqual(
      [...PAYMENT_LIFECYCLE_STATES],
      [
        'unpaid',
        'pending',
        'verification_required',
        'paid',
        'failed',
        'expired',
        'refunded',
        'partially_refunded',
      ]
    );
    assert.equal(derivePaymentLifecycleState({ paymentMethod: 'cod' }), 'unpaid');
    assert.equal(derivePaymentLifecycleState({ paymentStatus: 'pending' }), 'pending');
    assert.equal(
      derivePaymentLifecycleState({ paymentStatus: 'pending_verification' }),
      'verification_required'
    );
    assert.equal(derivePaymentLifecycleState({ paymentStatus: 'verified' }), 'paid');
    assert.equal(derivePaymentLifecycleState({ rawGatewayStatus: 'expired' }), 'expired');
    assert.equal(derivePaymentLifecycleState({ rawGatewayStatus: 'failed' }), 'failed');
    assert.equal(
      derivePaymentLifecycleState({ refundedBdt: 500, totalBdt: 1500 }),
      'partially_refunded'
    );
    assert.equal(
      derivePaymentLifecycleState({ refundedBdt: 1500, totalBdt: 1500 }),
      'refunded'
    );

    const mockOk = createMockPaymentProvider({ gateway: 'sslcommerz', simulateStatus: 'VALID' });
    const init = await mockOk.initiate({
      gateway: 'sslcommerz',
      orderNumber: 'DG-5001',
      amountBdt: 1960,
      customerName: 'Test Buyer',
      customerPhone: '01711111111',
      customerAddress: 'Dhanmondi 27',
      customerDistrict: 'Dhaka',
      itemsSummary: '1kg x1',
      siteBaseUrl: 'https://deshigee.example',
    });
    assert.equal(init.ok, true);
    const verified = await mockOk.verify({
      referenceId: init.sessionKey || 'REF1',
      expectedOrderNumber: 'DG-5001',
      expectedAmountBdt: 1960,
    });
    assert.equal(verified.verified, true);

    const mockMismatch = createMockPaymentProvider({
      gateway: 'bkash',
      simulateStatus: 'AMOUNT_MISMATCH',
    });
    const mismatched = await mockMismatch.verify({
      referenceId: 'REF2',
      expectedOrderNumber: 'DG-5002',
      expectedAmountBdt: 1960,
    });
    assert.equal(mismatched.verified, false);

    // SSLCommerz IPN signature round-trip
    const fields: Record<string, string> = {
      tran_id: 'DG-5001',
      val_id: 'VAL123',
      amount: '1960',
      verify_key: 'tran_id,val_id,amount',
    };
    const sig = computeSslCommerzIpnSignature(fields, 'secret_pass_123');
    assert.ok(sig);
    assert.equal(
      verifySslCommerzIpnSignature({ ...fields, verify_sign: sig! }, 'secret_pass_123').ok,
      true
    );
    assert.equal(
      verifySslCommerzIpnSignature({ ...fields, verify_sign: '0'.repeat(32) }, 'secret_pass_123').ok,
      false
    );
  });

  it('stage5_2_courier_provider_and_4_04_url_allowlist [mock]: CourierProvider mock booking + strict HTTPS domain allowlist rejects javascript: and phishing hosts', async () => {
    const mockSteadfast = createMockCourierProvider('steadfast');
    const booked = await mockSteadfast.book({
      partner: 'steadfast',
      orderNumber: 'DG-5100',
      recipientName: 'Rahim',
      recipientPhone: '01712345678',
      recipientAddress: 'Mirpur 10',
      recipientDistrict: 'Dhaka',
      recipientArea: 'Mirpur',
      codAmountBdt: 1960,
      weightGrams: 1000,
    });
    assert.equal(booked.ok, true);
    assert.match(String(booked.courierTrackingUrl || ''), /^https:\/\/steadfast\.com\.bd\//);

    // 4-04: Disallow javascript:, http:, and unapproved hosts
    assert.equal(sanitizeCourierTrackingUrl('javascript:alert(1)'), '');
    assert.equal(sanitizeCourierTrackingUrl('http://steadfast.com.bd/t/123'), '');
    assert.equal(sanitizeCourierTrackingUrl('https://evil.example.com/track/123'), '');
    assert.equal(
      sanitizeCourierTrackingUrl('https://merchant.pathao.com/tracking?consignment_id=123'),
      'https://merchant.pathao.com/tracking?consignment_id=123'
    );
    assert.equal(mapCourierRawStatusToOrderStatus('delivered'), 'delivered');
    assert.equal(mapCourierRawStatusToOrderStatus('in_transit'), 'shipped');
  });

  it('stage5_3_4_5_messaging_and_refill_guards [static]: BulkSMSBD uses POST form body (no URL secret), gateway detail redacts secrets, and refill route defaults dryRun + CRON_SECRET + quiet hours', () => {
    const msgSrc = fs.readFileSync(
      path.join(ROOT, 'src/lib/integrations/messagingGateway.ts'),
      'utf8'
    );
    assert.match(msgSrc, /fetch\('https:\/\/bulksmsbd\.net\/api\/smsapi',\s*\{\s*method:\s*'POST'/);
    assert.equal(/bulksmsbd\.net\/api\/smsapi\?api_key=/i.test(msgSrc), false);

    const redacted = sanitizeGatewayDetail('Error calling https://api.secret.test?api_key=abc123');
    assert.equal(redacted.includes('abc123'), false);
    assert.match(redacted, /\[redacted-url\]/);

    const refillSrc = fs.readFileSync(
      path.join(ROOT, 'app/api/retention/campaigns/route.ts'),
      'utf8'
    );
    assert.match(refillSrc, /process\.env\.CRON_SECRET/);
    assert.match(refillSrc, /isWithinDhakaQuietHours/);
    assert.match(refillSrc, /verifySignedUnsubscribeToken/);
    assert.match(refillSrc, /const dryRun = body\.dryRun !== false/);
  });

  it('stage5_6_gemini_failover_auth_retirement_cost_table [mock]: 429/5xx/timeout failover, 401/billing-403 never silently hide, 404 flags retirement, and GEMINI_MODEL_COST_RATES_JSON + env rollback work', () => {
    assert.equal(classifyGeminiError({ status: 429, message: 'quota exceeded' }).shouldFailover, true);
    assert.equal(classifyGeminiError({ status: 503, message: 'service unavailable' }).shouldFailover, true);
    assert.equal(classifyGeminiError(new Error('ETIMEDOUT')).shouldFailover, true);

    const auth401 = classifyGeminiError({ status: 401, message: 'API_KEY_INVALID' });
    assert.equal(auth401.shouldFailover, false);
    assert.equal(auth401.adminAlertCode, 'gemini_auth_failed');

    const billing403 = classifyGeminiError({ status: 403, message: 'billing disabled on key' });
    assert.equal(billing403.shouldFailover, false);
    assert.equal(billing403.adminAlertCode, 'gemini_auth_failed');

    const retired404 = classifyGeminiError({ status: 404, message: 'model not found' });
    assert.equal(retired404.code, 'gemini_model_retired');
    assert.equal(retired404.adminAlertCode, 'gemini_model_retired');

    const prevRates = process.env.GEMINI_MODEL_COST_RATES_JSON;
    const prevPrimary = process.env.GEMINI_MODEL;
    const prevFallback = process.env.GEMINI_FALLBACK_MODEL;
    try {
      process.env.GEMINI_MODEL_COST_RATES_JSON = JSON.stringify({
        'gemini-4-hydrogen': { inputPerM: 0.2, outputPerM: 0.8 },
        'gemini-3.1-flash-lite': { inputPerM: 0.05, outputPerM: 0.2 },
      });
      assert.equal(estimateGeminiCostUsd(1_000_000, 1_000_000, 'gemini-4-hydrogen'), 1.0);
      assert.equal(estimateGeminiCostUsd(1_000_000, 1_000_000, 'gemini-3.1-flash-lite'), 0.25);

      // Env-only model rollback overrides admin config
      process.env.GEMINI_MODEL = 'gemini-3.1-flash-lite';
      process.env.GEMINI_FALLBACK_MODEL = 'gemini-4-hydrogen';
      const resolved = resolveConfiguredChatModels({
        primaryModel: DEFAULT_GEMINI_MODEL,
        fallbackModel: FALLBACK_GEMINI_MODEL,
      });
      assert.equal(resolved.primaryModel, 'gemini-3.1-flash-lite');
      assert.equal(resolved.fallbackModel, 'gemini-4-hydrogen');
    } finally {
      if (prevRates === undefined) delete process.env.GEMINI_MODEL_COST_RATES_JSON;
      else process.env.GEMINI_MODEL_COST_RATES_JSON = prevRates;
      if (prevPrimary === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = prevPrimary;
      if (prevFallback === undefined) delete process.env.GEMINI_FALLBACK_MODEL;
      else process.env.GEMINI_FALLBACK_MODEL = prevFallback;
    }
  });
});
