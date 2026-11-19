import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  DELETE as chatSessionDelete,
  GET as chatSessionGet,
  POST as chatSessionPost,
} from '../app/api/chat/session/route';
import { POST as paymentCallbackPost } from '../app/api/payments/callback/route';
import { POST as paymentInitiatePost } from '../app/api/payments/initiate/route';
import { POST as retentionCampaignsPost } from '../app/api/retention/campaigns/route';
import {
  clearMemoryGatewayEventsForTests,
  getOrderStorageMemoryStateForTests,
  setOrderStorageMemoryModeForTests,
  setRateLimitMemoryModeForTests,
  setRetentionMemoryModeForTests,
  setSessionDraftMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import {
  SESSION_COOKIE_NAME,
  createSignedUnsubscribeToken,
  isHighEntropySessionId,
  signSessionCookieValue,
} from '../src/lib/chatbot/sessionAuth';
import { saveSessionAndDraft } from '../src/lib/chatbot/sessionStore';
import {
  computeSslCommerzIpnSignature,
  executeBkashCheckout,
} from '../src/lib/integrations/paymentGateway';

const ROOT = process.cwd();

function collectPublicFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      collectPublicFiles(full, acc);
    } else if (ent.isFile()) {
      acc.push(path.relative(ROOT, full));
    }
  }
  return acc;
}

describe('Stage 1 P0 Security — S0-01..S0-06', () => {
  beforeEach(() => {
    setSessionDraftMemoryModeForTests(true);
    setRateLimitMemoryModeForTests(true);
    setOrderStorageMemoryModeForTests(true);
    setRetentionMemoryModeForTests(true);
  });

  afterEach(() => {
    setSessionDraftMemoryModeForTests(false);
    setRateLimitMemoryModeForTests(false);
    setOrderStorageMemoryModeForTests(false);
    setRetentionMemoryModeForTests(false);
  });

  it('S0-01: public/assets/aistudio does not exist and no internal markdown/spec/backlog docs are inside public/', () => {
    const aistudioDir = path.join(ROOT, 'public', 'assets', 'aistudio');
    assert.equal(fs.existsSync(aistudioDir), false, 'public/assets/aistudio must not exist');

    const publicFiles = collectPublicFiles(path.join(ROOT, 'public'));
    const forbidden = publicFiles.filter((rel) =>
      /(\.md$|PENDING_BACKLOG|CONTINUATION_PROMPT|MASTER_PROMPT|Paste_November)/i.test(rel)
    );
    assert.deepEqual(forbidden, [], `Internal docs must not be under public/: ${forbidden.join(', ')}`);

    assert.equal(fs.existsSync(path.join(ROOT, 'PENDING_BACKLOG.md')), true);
    assert.equal(fs.existsSync(path.join(ROOT, 'docs', 'DESHI_GEE_CONTINUATION_PROMPT_V3.md')), true);
    assert.equal(fs.existsSync(path.join(ROOT, 'docs', 'DESHI_GEE_MASTER_PROMPT_MERGED.md')), true);

    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.match(gitignore, /public\/assets\/aistudio\/?/);
  });

  it('S0-02: /api/chat/session requires signed HttpOnly cookie ownership, mints >=128-bit IDs, rejects foreign/tampered cookies, and firestore.rules forbids anonymous reads', async () => {
    // 1. POST mints a >=128-bit sessionId + HttpOnly cookie
    const bootRes = await chatSessionPost(
      new Request('http://localhost:3000/api/chat/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({}),
      })
    );
    assert.equal(bootRes.status, 200);
    const setCookie = bootRes.headers.get('set-cookie') || '';
    assert.match(setCookie, new RegExp(`${SESSION_COOKIE_NAME}=`));
    assert.match(setCookie, /HttpOnly/i);
    const bootJson = (await bootRes.json()) as { ok: boolean; sessionId: string };
    assert.equal(bootJson.ok, true);
    assert.equal(isHighEntropySessionId(bootJson.sessionId), true);

    const victimId = bootJson.sessionId;
    await saveSessionAndDraft({
      session: {
        sessionId: victimId,
        language: 'bn',
        lockedLang: 'bn',
        scriptPreference: 'bn_script',
        consent: true,
        currentIntent: 'order',
        orderDraftId: `draft_${victimId}`,
        turnCount: 3,
        agentReplies: [
          {
            id: 'r1',
            agentName: 'Support',
            text: 'Private agent reply with phone confirmation',
            createdAtIso: new Date().toISOString(),
          },
        ],
      },
      draft: {
        draftId: `draft_${victimId}`,
        sessionId: victimId,
        weight: '500g',
        qty: 1,
        customerName: 'Victim Customer',
        phone: '01711000999',
        district: 'Dhaka',
        area: 'Banani',
        address: 'Private Road 11',
        paymentMethod: 'cod',
        txnId: '',
        couponCode: '',
        note: '',
        state: 'awaiting_confirmation',
        priceQuoteVersion: 1,
        expiresAt: Date.now() + 600_000,
      },
    });

    // 2. Cookie-less GET to victim's sessionId -> 403, zero PII / draft / agentReplies
    const noCookieRes = await chatSessionGet(
      new Request(`http://localhost:3000/api/chat/session?sessionId=${encodeURIComponent(victimId)}`)
    );
    assert.equal(noCookieRes.status, 403);
    const noCookieText = await noCookieRes.text();
    assert.equal(noCookieText.includes('Victim Customer'), false);
    assert.equal(noCookieText.includes('01711000999'), false);
    assert.equal(noCookieText.includes('Private agent reply'), false);

    // 3. Another user's valid cookie cannot read victim's session -> 403
    const attackerCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(signSessionCookieValue('dg_' + 'a'.repeat(32)))}`;
    const foreignRes = await chatSessionGet(
      new Request(`http://localhost:3000/api/chat/session?sessionId=${encodeURIComponent(victimId)}`, {
        headers: { Cookie: attackerCookie },
      })
    );
    assert.equal(foreignRes.status, 403);

    // 4. Tampered cookie signature rejected -> 403
    const tamperedCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(`${victimId}.tampered_sig_${'x'.repeat(30)}`)}`;
    const tamperedRes = await chatSessionGet(
      new Request(`http://localhost:3000/api/chat/session?sessionId=${encodeURIComponent(victimId)}`, {
        headers: { Cookie: tamperedCookie },
      })
    );
    assert.equal(tamperedRes.status, 403);

    // 5. Foreign DELETE rejected -> 403
    const foreignDel = await chatSessionDelete(
      new Request(`http://localhost:3000/api/chat/session?sessionId=${encodeURIComponent(victimId)}`, {
        method: 'DELETE',
        headers: {
          'x-requested-with': 'DeshiGeeStorefront',
          Cookie: attackerCookie,
        },
      })
    );
    assert.equal(foreignDel.status, 403);

    // 6. Owner's cookie succeeds on GET & DELETE
    const ownerCookie = setCookie.split(';')[0];
    const okGet = await chatSessionGet(
      new Request(`http://localhost:3000/api/chat/session?sessionId=${encodeURIComponent(victimId)}`, {
        headers: { Cookie: ownerCookie },
      })
    );
    assert.equal(okGet.status, 200);
    const okData = (await okGet.json()) as {
      orderDraft: { customerName: string } | null;
      session: { agentReplies?: Array<{ text: string }> } | null;
    };
    assert.equal(okData.orderDraft?.customerName, 'Victim Customer');
    assert.equal(okData.session?.agentReplies?.length, 1);

    // 7. firestore.rules forbids anonymous/client reads on chat_sessions & order_drafts
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    assert.match(rules, /match \/chat_sessions\/\{sessionId\}\s*\{\s*allow get, list: if isAdmin\(\);/);
    assert.match(rules, /match \/order_drafts\/\{draftId\}\s*\{\s*allow get, list: if isAdmin\(\);/);
  });

  it('S0-03: marketing_consents & refill_reminders are server-only in firestore.rules and consent/unsubscribe requires phone ownership proof', async () => {
    const phone = '01711888999';
    const orderNumber = 'DG-771234';
    const mem = getOrderStorageMemoryStateForTests();
    assert.ok(mem, 'memory order state enabled');
    mem.tracking.set(`${orderNumber}_${phone}`, {
      orderNumber,
      weight: '500g',
      qty: 1,
      itemsSummary: '1x 500g',
      totalBdt: 1030,
      status: 'delivered',
      paymentMethod: 'cod',
      paymentStatus: 'verified',
      district: 'Dhaka',
      estimatedDelivery: 'Delivered',
      updatedAt: Date.now() - 86_400_000,
    });

    const headers = {
      'Content-Type': 'application/json',
      'x-requested-with': 'DeshiGeeStorefront',
      'x-forwarded-for': '203.0.113.30',
    };

    // 1. Phone-only consent or unsubscribe -> 403
    const phoneOnlyRes = await retentionCampaignsPost(
      new Request('http://localhost:3000/api/retention/campaigns', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'unsubscribe', phone }),
      })
    );
    assert.equal(phoneOnlyRes.status, 403);

    // 2. Wrong Order ID -> 403
    const wrongOrderRes = await retentionCampaignsPost(
      new Request('http://localhost:3000/api/retention/campaigns', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'consent', phone, orderNumber: 'DG-999999', optIn: true }),
      })
    );
    assert.equal(wrongOrderRes.status, 403);

    // 3. Forged or expired token -> 403
    const forgedTokenRes = await retentionCampaignsPost(
      new Request('http://localhost:3000/api/retention/campaigns', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'unsubscribe',
          phone,
          unsubscribeToken: `${Math.floor(Date.now() / 1000) + 3600}.forged_signature_1234567890abcdef`,
        }),
      })
    );
    assert.equal(forgedTokenRes.status, 403);

    const expiredToken = createSignedUnsubscribeToken(
      phone,
      60,
      Math.floor(Date.now() / 1000) - 3600
    );
    const expiredRes = await retentionCampaignsPost(
      new Request('http://localhost:3000/api/retention/campaigns', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'unsubscribe',
          phone,
          unsubscribeToken: expiredToken,
        }),
      })
    );
    assert.equal(expiredRes.status, 403);

    // 4. Token bound to another phone -> 403
    const otherPhoneToken = createSignedUnsubscribeToken('01811222333', 3600);
    const mismatchTokenRes = await retentionCampaignsPost(
      new Request('http://localhost:3000/api/retention/campaigns', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'unsubscribe',
          phone,
          unsubscribeToken: otherPhoneToken,
        }),
      })
    );
    assert.equal(mismatchTokenRes.status, 403);

    // 5. Valid Order ID + matching phone -> 200
    const orderProofRes = await retentionCampaignsPost(
      new Request('http://localhost:3000/api/retention/campaigns', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'consent',
          phone,
          orderNumber,
          optIn: true,
          channel: 'whatsapp',
        }),
      })
    );
    assert.equal(orderProofRes.status, 200);
    const orderProofJson = (await orderProofRes.json()) as { ok: boolean; unsubscribed: boolean };
    assert.equal(orderProofJson.ok, true);
    assert.equal(orderProofJson.unsubscribed, false);

    // 6. Valid signed unsubscribe token -> 200
    const validToken = createSignedUnsubscribeToken(phone, 3600);
    const tokenProofRes = await retentionCampaignsPost(
      new Request('http://localhost:3000/api/retention/campaigns', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'unsubscribe',
          phone,
          unsubscribeToken: validToken,
        }),
      })
    );
    assert.equal(tokenProofRes.status, 200);
    const tokenProofJson = (await tokenProofRes.json()) as { ok: boolean; unsubscribed: boolean };
    assert.equal(tokenProofJson.ok, true);
    assert.equal(tokenProofJson.unsubscribed, true);

    // 7. firestore.rules forbids anonymous/client get/list/create/update/delete on refill_reminders & marketing_consents
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    assert.match(rules, /match \/refill_reminders\/\{reminderId\}\s*\{\s*allow get, list: if isAdmin\(\);/);
    assert.match(rules, /match \/marketing_consents\/\{phoneKey\}\s*\{\s*allow get, list: if isAdmin\(\);/);
  });

  it('S0-04: payment routes return Not configured when env missing, reject forged IPN hash, never fall back to expectedAmountBdt=1, ignore unauth fail/cancel, and update order paymentStatus only after validation', async () => {
    const origFetch = globalThis.fetch;
    const prevSslId = process.env.SSLCOMMERZ_STORE_ID;
    const prevSslPass = process.env.SSLCOMMERZ_STORE_PASSWD;
    const prevBkKey = process.env.BKASH_APP_KEY;
    const prevBkSec = process.env.BKASH_APP_SECRET;
    const prevBkUser = process.env.BKASH_USERNAME;
    const prevBkPass = process.env.BKASH_PASSWORD;

    try {
      clearMemoryGatewayEventsForTests();
      delete process.env.SSLCOMMERZ_STORE_ID;
      delete process.env.SSLCOMMERZ_STORE_PASSWD;
      delete process.env.BKASH_APP_KEY;
      delete process.env.BKASH_APP_SECRET;
      delete process.env.BKASH_USERNAME;
      delete process.env.BKASH_PASSWORD;

      // 1. Both initiate & callback return 503 Not configured when env missing
      const unconfInit = await paymentInitiatePost(
        new Request('http://localhost:3000/api/payments/initiate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
            'x-forwarded-for': '203.0.113.40',
          },
          body: JSON.stringify({
            gateway: 'sslcommerz',
            orderNumber: 'DG-88001',
            phone: '01711000111',
          }),
        })
      );
      assert.equal(unconfInit.status, 503);
      const unconfInitJson = (await unconfInit.json()) as { status?: string; error?: string };
      assert.match(`${unconfInitJson.status} ${unconfInitJson.error}`, /Not configured/i);

      const unconfCb = await paymentCallbackPost(
        new Request(
          'http://localhost:3000/api/payments/callback?gateway=sslcommerz&order=DG-88001&outcome=ipn&format=json',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.40' },
            body: JSON.stringify({ val_id: 'V1' }),
          }
        )
      );
      assert.equal(unconfCb.status, 503);
      const unconfCbJson = (await unconfCb.json()) as { status?: string; error?: string };
      assert.match(`${unconfCbJson.status} ${unconfCbJson.error}`, /Not configured/i);

      // Configure gateways for validation tests
      process.env.SSLCOMMERZ_STORE_ID = 'store_s004';
      process.env.SSLCOMMERZ_STORE_PASSWD = 'super_secret_passwd';
      process.env.BKASH_APP_KEY = 'bk_key_s004';
      process.env.BKASH_APP_SECRET = 'bk_sec_s004';
      process.env.BKASH_USERNAME = 'bk_user';
      process.env.BKASH_PASSWORD = 'bk_pass';

      let validationApiCalls = 0;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes('validationserverAPI.php')) {
          validationApiCalls += 1;
          const isLow = u.includes('VAL_LOW');
          return new Response(
            JSON.stringify({
              status: 'VALID',
              tran_id: 'DG-88001',
              bank_tran_id: isLow ? 'BTX_LOW' : 'BTX_GOOD',
              val_id: isLow ? 'VAL_LOW' : 'VAL_GOOD',
              amount: isLow ? '10.00' : '1550.00',
              currency: 'BDT',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (u.includes('/tokenized/checkout/token/grant')) {
          return new Response(JSON.stringify({ id_token: 'tok_bk' }), { status: 200 });
        }
        if (u.includes('/tokenized/checkout/execute')) {
          return new Response(
            JSON.stringify({
              statusCode: '0000',
              transactionStatus: 'Completed',
              trxID: 'TRX_NO_INV',
              amount: '1550',
              currency: 'BDT',
              merchantInvoiceNumber: '',
            }),
            { status: 200 }
          );
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      // 2. Forged / missing SSLCommerz IPN signature -> 401 BEFORE Validation API is ever called
      const forgedIpn = await paymentCallbackPost(
        new Request(
          'http://localhost:3000/api/payments/callback?gateway=sslcommerz&order=DG-88001&outcome=ipn&format=json',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.41' },
            body: JSON.stringify({
              val_id: 'VAL_GOOD',
              tran_id: 'DG-88001',
              amount: '1550.00',
              verify_key: 'amount,tran_id,val_id',
              verify_sign: '0'.repeat(32),
            }),
          }
        )
      );
      assert.equal(forgedIpn.status, 401);
      assert.equal(validationApiCalls, 0, 'Validation API must not be called on forged IPN hash');

      // 3. Unknown server order -> 404 (NEVER falls back to expectedAmountBdt = 1!)
      const unknownOrderFields: Record<string, string> = {
        val_id: 'VAL_LOW',
        tran_id: 'DG-88999',
        amount: '10.00',
        verify_key: 'amount,tran_id,val_id',
      };
      unknownOrderFields.verify_sign = computeSslCommerzIpnSignature(
        unknownOrderFields,
        'super_secret_passwd'
      )!;
      const unknownRes = await paymentCallbackPost(
        new Request(
          'http://localhost:3000/api/payments/callback?gateway=sslcommerz&order=DG-88999&outcome=ipn&format=json',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.42' },
            body: JSON.stringify(unknownOrderFields),
          }
        )
      );
      assert.equal(unknownRes.status, 404);
      assert.equal(validationApiCalls, 0);

      // Seed real server order for DG-88001 (1550 BDT)
      const mem = getOrderStorageMemoryStateForTests()!;
      mem.tracking.set('DG-88001_01711000111', {
        orderNumber: 'DG-88001',
        weight: '1kg',
        qty: 1,
        itemsSummary: '1kg × 1',
        totalBdt: 1550,
        status: 'pending',
        paymentMethod: 'bkash',
        paymentStatus: 'pending',
        district: 'Dhaka',
        estimatedDelivery: 'Within 24 hours',
        updatedAt: Date.now(),
      });

      // 4. Unauthenticated fail/cancel must be ignored (recorded: false, no status change)
      const unauthCancel = await paymentCallbackPost(
        new Request(
          'http://localhost:3000/api/payments/callback?gateway=sslcommerz&order=DG-88001&outcome=cancel&format=json',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.43' },
            body: JSON.stringify({}),
          }
        )
      );
      assert.equal(unauthCancel.status, 200);
      const unauthCancelJson = (await unauthCancel.json()) as { recorded: boolean };
      assert.equal(unauthCancelJson.recorded, false);
      assert.equal(mem.tracking.get('DG-88001_01711000111')?.paymentStatus, 'pending');

      // 5. Client spoofs amount=10 with valid IPN hash -> server still checks against 1550 BDT -> rejected (400) & paymentStatus stays pending
      const underpaidFields: Record<string, string> = {
        val_id: 'VAL_LOW',
        tran_id: 'DG-88001',
        amount: '10.00',
        verify_key: 'amount,tran_id,val_id',
      };
      underpaidFields.verify_sign = computeSslCommerzIpnSignature(
        underpaidFields,
        'super_secret_passwd'
      )!;
      const underpaidRes = await paymentCallbackPost(
        new Request(
          'http://localhost:3000/api/payments/callback?gateway=sslcommerz&order=DG-88001&outcome=ipn&format=json',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.44' },
            body: JSON.stringify(underpaidFields),
          }
        )
      );
      assert.equal(underpaidRes.status, 400);
      assert.equal(mem.tracking.get('DG-88001_01711000111')?.paymentStatus, 'pending');

      // 6. bKash execute MUST reject empty merchantInvoiceNumber
      const bkEmptyInv = await executeBkashCheckout({
        paymentId: 'PAY_NO_INV',
        expectedOrderNumber: 'DG-88001',
        expectedAmountBdt: 1550,
      });
      assert.equal(bkEmptyInv.verified, false);

      // 7. Valid IPN hash + full server-validated amount -> 200 + updates order paymentStatus to verified
      const validFields: Record<string, string> = {
        val_id: 'VAL_GOOD',
        tran_id: 'DG-88001',
        amount: '1550.00',
        verify_key: 'amount,tran_id,val_id',
      };
      validFields.verify_sign = computeSslCommerzIpnSignature(validFields, 'super_secret_passwd')!;
      const validRes = await paymentCallbackPost(
        new Request(
          'http://localhost:3000/api/payments/callback?gateway=sslcommerz&order=DG-88001&outcome=ipn&format=json',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.45' },
            body: JSON.stringify(validFields),
          }
        )
      );
      assert.equal(validRes.status, 200);
      assert.equal(mem.tracking.get('DG-88001_01711000111')?.paymentStatus, 'verified');

      // 8. Static check: expectedAmountBdt = 1 fallback is completely removed
      const cbSource = fs.readFileSync(
        path.join(ROOT, 'app', 'api', 'payments', 'callback', 'route.ts'),
        'utf8'
      );
      assert.equal(cbSource.includes('expectedAmountBdt = 1'), false);
    } finally {
      globalThis.fetch = origFetch;
      if (prevSslId === undefined) delete process.env.SSLCOMMERZ_STORE_ID;
      else process.env.SSLCOMMERZ_STORE_ID = prevSslId;
      if (prevSslPass === undefined) delete process.env.SSLCOMMERZ_STORE_PASSWD;
      else process.env.SSLCOMMERZ_STORE_PASSWD = prevSslPass;
      if (prevBkKey === undefined) delete process.env.BKASH_APP_KEY;
      else process.env.BKASH_APP_KEY = prevBkKey;
      if (prevBkSec === undefined) delete process.env.BKASH_APP_SECRET;
      else process.env.BKASH_APP_SECRET = prevBkSec;
      if (prevBkUser === undefined) delete process.env.BKASH_USERNAME;
      else process.env.BKASH_USERNAME = prevBkUser;
      if (prevBkPass === undefined) delete process.env.BKASH_PASSWORD;
      else process.env.BKASH_PASSWORD = prevBkPass;
    }
  });
});
