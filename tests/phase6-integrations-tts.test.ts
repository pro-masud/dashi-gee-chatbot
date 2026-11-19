import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { POST as chatTtsPost } from '../app/api/chat/tts/route';
import { POST as courierBookPost } from '../app/api/courier/book/route';
import { POST as courierWebhookPost } from '../app/api/courier/webhook/route';
import { GET as integrationsStatusGet } from '../app/api/integrations/status/route';
import { POST as ordersNotifyPost } from '../app/api/orders/notify/route';
import { POST as paymentCallbackPost } from '../app/api/payments/callback/route';
import { POST as paymentInitiatePost } from '../app/api/payments/initiate/route';
import {
  clearMemoryGatewayEventsForTests,
  getOrderStorageMemoryStateForTests,
  setAdminAuthOverrideForTests,
  setOrderStorageMemoryModeForTests,
  setRateLimitMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import { setGeminiClientFactoryForTests } from '../src/lib/gemini/client';
import {
  bookCourierParcel,
  mapCourierRawStatusToOrderStatus,
  verifyCourierWebhookAuth,
} from '../src/lib/integrations/courierApi';
import { sendDirectEmail, sendDirectSms } from '../src/lib/integrations/messagingGateway';
import {
  computeSslCommerzIpnSignature,
  executeBkashCheckout,
  initiateBkashCheckout,
  initiateSslCommerzPayment,
  validateSslCommerzPayment,
} from '../src/lib/integrations/paymentGateway';

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'SSLCOMMERZ_STORE_ID',
  'SSLCOMMERZ_STORE_PASSWD',
  'SSLCOMMERZ_IS_LIVE',
  'BKASH_APP_KEY',
  'BKASH_APP_SECRET',
  'BKASH_USERNAME',
  'BKASH_PASSWORD',
  'BKASH_IS_LIVE',
  'STEADFAST_API_KEY',
  'STEADFAST_SECRET_KEY',
  'PATHAO_CLIENT_ID',
  'PATHAO_CLIENT_SECRET',
  'PATHAO_USERNAME',
  'PATHAO_PASSWORD',
  'PATHAO_STORE_ID',
  'REDX_API_TOKEN',
  'COURIER_WEBHOOK_SECRET',
  'BULKSMSBD_API_KEY',
  'BULKSMSBD_SENDER_ID',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'OWNER_NOTIFICATION_EMAIL',
  'OWNER_WEBHOOK_URL',
];

const savedEnv: Record<string, string | undefined> = {};

describe('Phase 6 — Gemini TTS, Payment Gateways (SSLCommerz/bKash), Live Courier APIs & Direct SMS/Email', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    setRateLimitMemoryModeForTests(true);
    setOrderStorageMemoryModeForTests(true);
    clearMemoryGatewayEventsForTests();
    setGeminiClientFactoryForTests(null);
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    setGeminiClientFactoryForTests(null);
    setRateLimitMemoryModeForTests(false);
    setOrderStorageMemoryModeForTests(false);
    clearMemoryGatewayEventsForTests();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('Gemini TTS route calls gemini-3.8-flash-lite-tts, returns audio/wav base64, and never fakes audio on missing key', async () => {
    // 1. Rejects missing storefront origin header
    const badOrigin = await chatTtsPost(
      new Request('http://localhost:3000/api/chat/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello Deshi Gee' }),
      })
    );
    assert.equal(badOrigin.status, 403);

    // 2. Returns 503 cleanly when Gemini client is unavailable (no simulated audio)
    setGeminiClientFactoryForTests(() => null);
    const noKey = await chatTtsPost(
      new Request('http://localhost:3000/api/chat/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ text: 'আসসালামু আলাইকুম', lang: 'bn', sessionId: 'tts_s1' }),
      })
    );
    assert.equal(noKey.status, 503);
    const noKeyBody = (await noKey.json()) as { ok: boolean; code?: string };
    assert.equal(noKeyBody.ok, false);
    assert.equal(noKeyBody.code, 'gemini_api_key_missing');

    // 3. Successful unary WAV synthesis with gemini-3.8-flash-lite-tts
    let capturedModel = '';
    let capturedModalities: string[] = [];
    setGeminiClientFactoryForTests(
      () =>
        ({
          models: {
            generateContent: async (args: {
              model: string;
              config?: { responseModalities?: string[] };
            }) => {
              capturedModel = args.model;
              capturedModalities = args.config?.responseModalities || [];
              return {
                candidates: [
                  {
                    content: {
                      parts: [
                        {
                          inlineData: {
                            mimeType: 'audio/wav',
                            data: Buffer.from('RIFF_FAKE_WAV_BYTES').toString('base64'),
                          },
                        },
                      ],
                    },
                  },
                ],
              };
            },
          },
        }) as never
    );

    const okRes = await chatTtsPost(
      new Request('http://localhost:3000/api/chat/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          text: '**দেশী ঘি** ৫০০ গ্রাম জারের দাম ১২৯০ টাকা।',
          lang: 'bn',
          sessionId: 'tts_s2',
        }),
      })
    );
    assert.equal(okRes.status, 200);
    const okData = (await okRes.json()) as {
      ok: boolean;
      model: string;
      mimeType: string;
      audioBase64: string;
    };
    assert.equal(okData.ok, true);
    assert.equal(capturedModel, 'gemini-3.8-flash-lite-tts');
    assert.deepEqual(capturedModalities, ['AUDIO']);
    assert.equal(okData.mimeType, 'audio/wav');
    assert.ok(okData.audioBase64.length > 10);
  });

  it('SSLCommerz & bKash gateways initiate sessions, validate amounts strictly, and record idempotent callbacks', async () => {
    process.env.SSLCOMMERZ_STORE_ID = 'deshigee_test';
    process.env.SSLCOMMERZ_STORE_PASSWD = 'secret_pass_123';
    process.env.BKASH_APP_KEY = 'bk_key_12345';
    process.env.BKASH_APP_SECRET = 'bk_sec_12345';
    process.env.BKASH_USERNAME = 'deshigee';
    process.env.BKASH_PASSWORD = 'bk_password';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('gwprocess/v4/api.php')) {
        return new Response(
          JSON.stringify({
            status: 'SUCCESS',
            GatewayPageURL: 'https://sandbox.sslcommerz.com/EasyCheckOut/test123',
            sessionkey: 'SSL_SESS_001',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('validationserverAPI.php')) {
        const isUnderpaid = url.includes('VAL_UNDERPAID');
        return new Response(
          JSON.stringify({
            status: 'VALID',
            tran_id: 'DG-60001',
            bank_tran_id: isUnderpaid ? 'BANK_LOW' : 'BANK_OK_99',
            val_id: isUnderpaid ? 'VAL_UNDERPAID' : 'VAL_OK_99',
            amount: isUnderpaid ? '500.00' : '1370.00',
            currency: 'BDT',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/tokenized/checkout/token/grant')) {
        return new Response(JSON.stringify({ id_token: 'bk_tok_abc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/tokenized/checkout/create')) {
        return new Response(
          JSON.stringify({
            statusCode: '0000',
            paymentID: 'TR00112233',
            bkashURL: 'https://sandbox.payment.bkash.com/pay/TR00112233',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/tokenized/checkout/execute')) {
        return new Response(
          JSON.stringify({
            statusCode: '0000',
            transactionStatus: 'Completed',
            trxID: 'BKX998877',
            amount: '1370',
            currency: 'BDT',
            merchantInvoiceNumber: 'DG-60001',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const sslInit = await initiateSslCommerzPayment({
      gateway: 'sslcommerz',
      orderNumber: 'DG-60001',
      amountBdt: 1370,
      customerName: 'Rahim',
      customerPhone: '01712345678',
      customerAddress: 'Road 7, Dhanmondi',
      customerDistrict: 'Dhaka',
      itemsSummary: '500g × 1',
      siteBaseUrl: 'https://deshigee.com',
    });
    assert.equal(sslInit.ok, true);
    assert.match(sslInit.gatewayUrl || '', /sslcommerz\.com/);

    // Underpaid amount MUST fail verification
    const badVal = await validateSslCommerzPayment({
      valId: 'VAL_UNDERPAID',
      expectedOrderNumber: 'DG-60001',
      expectedAmountBdt: 1370,
    });
    assert.equal(badVal.verified, false);

    // Valid full amount succeeds
    const goodVal = await validateSslCommerzPayment({
      valId: 'VAL_OK_99',
      expectedOrderNumber: 'DG-60001',
      expectedAmountBdt: 1370,
    });
    assert.equal(goodVal.verified, true);
    assert.equal(goodVal.transactionId, 'BANK_OK_99');

    // bKash tokenized flow
    const bkInit = await initiateBkashCheckout({
      gateway: 'bkash',
      orderNumber: 'DG-60001',
      amountBdt: 1370,
      customerName: 'Rahim',
      customerPhone: '01712345678',
      customerAddress: 'Road 7, Dhanmondi',
      customerDistrict: 'Dhaka',
      itemsSummary: '500g × 1',
      siteBaseUrl: 'https://deshigee.com',
    });
    assert.equal(bkInit.ok, true);
    assert.equal(bkInit.paymentId, 'TR00112233');

    const bkExec = await executeBkashCheckout({
      paymentId: 'TR00112233',
      expectedOrderNumber: 'DG-60001',
      expectedAmountBdt: 1370,
    });
    assert.equal(bkExec.verified, true);
    assert.equal(bkExec.transactionId, 'BKX998877');

    // Seed authoritative server order record so callback validates against server total (no client fallback)
    const mem = getOrderStorageMemoryStateForTests();
    assert.ok(mem);
    mem.tracking.set('DG-60001_01712345678', {
      orderNumber: 'DG-60001',
      weight: '500g',
      qty: 1,
      itemsSummary: '500g × 1',
      totalBdt: 1370,
      status: 'pending',
      paymentMethod: 'bkash',
      paymentStatus: 'pending_verification',
      district: 'Dhaka',
      estimatedDelivery: 'Within 24-48 hours',
      updatedAt: Date.now(),
    });

    const ipnFields: Record<string, string> = {
      val_id: 'VAL_OK_99',
      tran_id: 'DG-60001',
      amount: '1370.00',
      currency: 'BDT',
      status: 'VALID',
      verify_key: 'amount,currency,status,tran_id,val_id',
    };
    const verifySign = computeSslCommerzIpnSignature(
      ipnFields,
      process.env.SSLCOMMERZ_STORE_PASSWD || ''
    );
    assert.ok(verifySign);
    ipnFields.verify_sign = verifySign;

    // Callback API route idempotency check
    const cb1 = await paymentCallbackPost(
      new Request(
        'http://localhost:3000/api/payments/callback?gateway=sslcommerz&order=DG-60001&outcome=ipn&format=json',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(ipnFields),
        }
      )
    );
    assert.equal(cb1.status, 200);
    const cb1Data = (await cb1.json()) as {
      verified: boolean;
      duplicate: boolean;
      orderPaymentUpdated: boolean;
    };
    assert.equal(cb1Data.verified, true);
    assert.equal(cb1Data.duplicate, false);
    assert.equal(cb1Data.orderPaymentUpdated, true);
    assert.equal(mem.tracking.get('DG-60001_01712345678')?.paymentStatus, 'verified');

    const cb2 = await paymentCallbackPost(
      new Request(
        'http://localhost:3000/api/payments/callback?gateway=sslcommerz&order=DG-60001&outcome=ipn&format=json',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(ipnFields),
        }
      )
    );
    const cb2Data = (await cb2.json()) as { verified: boolean; duplicate: boolean };
    assert.equal(cb2Data.duplicate, true);

    // Initiate route guards invalid origin
    const badInit = await paymentInitiatePost(
      new Request('http://localhost:3000/api/payments/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateway: 'sslcommerz', orderNumber: 'DG-60001', phone: '01712345678' }),
      })
    );
    assert.equal(badInit.status, 403);
  });

  it('Live Courier APIs book Steadfast/Pathao/RedX parcels and verify fail-closed courier webhooks', async () => {
    process.env.STEADFAST_API_KEY = 'sf_key_123456';
    process.env.STEADFAST_SECRET_KEY = 'sf_secret_123456';
    process.env.REDX_API_TOKEN = 'redx_token_12345678';
    process.env.COURIER_WEBHOOK_SECRET = 'courier_secret_987654321';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('portal.packzy.com/api/v1/create_order')) {
        return new Response(
          JSON.stringify({
            status: 200,
            consignment: {
              consignment_id: 991122,
              tracking_code: 'SF-DG60002',
              status: 'in_review',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/v1.0.0-beta/parcel')) {
        return new Response(JSON.stringify({ tracking_id: 'RX-DG60002' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const sfBook = await bookCourierParcel({
      partner: 'steadfast',
      orderNumber: 'DG-60002',
      recipientName: 'Karim',
      recipientPhone: '01812345678',
      recipientAddress: 'House 12, Sector 7',
      recipientDistrict: 'Dhaka',
      recipientArea: 'Uttara',
      codAmountBdt: 1290,
      weightGrams: 500,
    });
    assert.equal(sfBook.ok, true);
    assert.equal(sfBook.consignmentId, 'SF-DG60002');
    assert.match(sfBook.courierTrackingUrl || '', /^https:\/\/steadfast\.com\.bd\/t\/SF-DG60002$/);

    const rxBook = await bookCourierParcel({
      partner: 'redx',
      orderNumber: 'DG-60002',
      recipientName: 'Karim',
      recipientPhone: '01812345678',
      recipientAddress: 'House 12, Sector 7',
      recipientDistrict: 'Dhaka',
      recipientArea: 'Uttara',
      codAmountBdt: 1290,
      weightGrams: 500,
    });
    assert.equal(rxBook.ok, true);
    assert.equal(rxBook.consignmentId, 'RX-DG60002');

    // Status mapping
    assert.equal(mapCourierRawStatusToOrderStatus('delivered'), 'delivered');
    assert.equal(mapCourierRawStatusToOrderStatus('in_transit'), 'shipped');
    assert.equal(mapCourierRawStatusToOrderStatus('returned'), 'cancelled');
    assert.equal(mapCourierRawStatusToOrderStatus('in_review'), 'processing');

    // Webhook HMAC verification
    const payloadStr = JSON.stringify({
      invoice: 'DG-60002',
      consignment_id: 'SF-DG60002',
      status: 'delivered',
      tracking_message: 'Delivered to customer',
      updated_at: '2026-11-19T06:00:00Z',
    });
    const badSig = verifyCourierWebhookAuth({
      rawBody: payloadStr,
      signatureHeader: 'sha256=deadbeef',
      bearerOrSecretHeader: null,
    });
    assert.equal(badSig.ok, false);

    const validHmac = createHmac('sha256', process.env.COURIER_WEBHOOK_SECRET)
      .update(payloadStr)
      .digest('hex');
    const webhookRes = await courierWebhookPost(
      new Request('http://localhost:3000/api/courier/webhook?partner=steadfast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-courier-signature': `sha256=${validHmac}`,
        },
        body: payloadStr,
      })
    );
    assert.equal(webhookRes.status, 200);
    const whData = (await webhookRes.json()) as { ok: boolean; mappedOrderStatus: string };
    assert.equal(whData.ok, true);
    assert.equal(whData.mappedOrderStatus, 'delivered');

    // Unauthenticated /api/courier/book rejected
    const unauthBook = await courierBookPost(
      new Request('http://localhost:3000/api/courier/book', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ orderNumber: 'DG-60002', partner: 'steadfast' }),
      })
    );
    assert.equal(unauthBook.status, 403);
  });

  it('Direct BulkSMSBD/Twilio SMS & Resend Email gateways deliver notifications cleanly and status API never leaks secrets', async () => {
    process.env.BULKSMSBD_API_KEY = 'bulk_api_key_secret_999';
    process.env.BULKSMSBD_SENDER_ID = 'DeshiGee';
    process.env.RESEND_API_KEY = 're_test_secret_999';
    process.env.RESEND_FROM_EMAIL = 'orders@deshigee.com';
    process.env.OWNER_NOTIFICATION_EMAIL = 'owner@deshigee.com';

    const hitUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      hitUrls.push(url);
      if (url.includes('bulksmsbd.net/api/smsapi')) {
        return new Response('{"response_code":202,"success_message":"SMS Submitted Successfully"}', {
          status: 200,
        });
      }
      if (url.includes('api.resend.com/emails')) {
        return new Response(JSON.stringify({ id: 'em_001' }), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const smsRes = await sendDirectSms({
      toPhone: '01711223344',
      message: 'Deshi Gee test SMS',
      orderNumber: 'DG-60003',
    });
    assert.equal(smsRes.status, 'sent');
    assert.equal(smsRes.channel, 'bulksmsbd');

    const emailRes = await sendDirectEmail({
      toEmail: 'owner@deshigee.com',
      subject: 'Order DG-60003',
      text: 'New order placed',
      orderNumber: 'DG-60003',
    });
    assert.equal(emailRes.status, 'sent');
    assert.equal(emailRes.channel, 'resend_email');

    setAdminAuthOverrideForTests(async (authHeader) =>
      authHeader === 'Bearer admin-phase6-token'
        ? { ok: true, email: 'admin@deshigee.com', uid: 'admin-p6' }
        : { ok: false, email: '', uid: '' }
    );
    try {
      // S0-05: Static x-requested-with header alone is rejected (401)
      const unauthNotify = await ordersNotifyPost(
        new Request('http://localhost:3000/api/orders/notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
          },
          body: JSON.stringify({ orderNumber: 'DG-60003' }),
        })
      );
      assert.equal(unauthNotify.status, 401);

      const notifyRes = await ordersNotifyPost(
        new Request('http://localhost:3000/api/orders/notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer admin-phase6-token',
          },
          body: JSON.stringify({
            orderNumber: 'DG-60003',
            customerName: 'Nadia',
            phone: '01711223344',
            totalBdt: 1290,
            itemsSummary: '500g × 1',
            paymentMethod: 'cod',
          }),
        })
      );
      assert.equal(notifyRes.status, 200);
      const notifyData = (await notifyRes.json()) as { webhookStatus: string };
      assert.equal(notifyData.webhookStatus, 'delivered');
      assert.ok(hitUrls.some((u) => u.includes('bulksmsbd.net')));
      assert.ok(hitUrls.some((u) => u.includes('api.resend.com/emails')));

      // S0-06: /api/integrations/status requires Admin auth and exposes ONLY booleans (zero raw secrets)
      const unauthStatus = await integrationsStatusGet(
        new Request('http://localhost:3000/api/integrations/status')
      );
      assert.equal(unauthStatus.status, 401);

      const statusRes = await integrationsStatusGet(
        new Request('http://localhost:3000/api/integrations/status', {
          headers: { Authorization: 'Bearer admin-phase6-token' },
        })
      );
      assert.equal(statusRes.status, 200);
      const rawJson = await statusRes.text();
      assert.equal(rawJson.includes('bulk_api_key_secret_999'), false);
      assert.equal(rawJson.includes('re_test_secret_999'), false);
      const parsed = JSON.parse(rawJson) as {
        ok: boolean;
        messaging: { bulksmsbd: boolean; resendEmail: boolean };
      };
      assert.equal(parsed.ok, true);
      assert.equal(parsed.messaging.bulksmsbd, true);
      assert.equal(parsed.messaging.resendEmail, true);
    } finally {
      setAdminAuthOverrideForTests(null);
    }
  });
});
