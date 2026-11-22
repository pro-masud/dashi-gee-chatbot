import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { GET as adminMarketingGet, PUT as adminMarketingPut } from '../app/api/admin/marketing/route';
import { POST as adminMarketingTest } from '../app/api/admin/marketing/test/route';
import { GET as trackingConfigGet } from '../app/api/tracking/config/route';
import {
  buildCapiBody,
  eventIdFor,
  phoneForMeta,
  toPublicTracking,
  validateTrackingSettings,
  EMPTY_TRACKING,
} from '../src/lib/marketing/marketing';
import { postToMeta, sha256 } from '../src/lib/server/metaCapi';
import { SecretsKeyMissingError, decryptSecret, encryptSecret, maskSecret } from '../src/lib/server/secrets';

const KEY = 'unit-test-integration-secret-key-0123456789';

function fakeFetch(status: number, json: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

describe('Marketing & tracking', () => {
  afterEach(() => {
    delete process.env.INTEGRATION_SECRET_KEY;
  });

  it('validates tracking ids strictly so nothing else can be injected into page scripts', () => {
    const ok = validateTrackingSettings({ pixelId: '123456789012345', ga4Id: 'g-abc123xyz9', gtmId: 'gtm-ab12cd3', googleAdsId: 'aw-123456789', capiEnabled: true });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.ga4Id, 'G-ABC123XYZ9');
      assert.equal(ok.value.gtmId, 'GTM-AB12CD3');
    }
    assert.equal(validateTrackingSettings({ pixelId: '12ab' }).ok, false);
    assert.equal(validateTrackingSettings({ pixelId: '123456789', ga4Id: 'UA-1' }).ok, false);
    assert.equal(validateTrackingSettings({ gtmId: "GTM-X');alert(1);//" }).ok, false);
    assert.equal(validateTrackingSettings({ googleAdsId: 'AW-1;2' }).ok, false);
    assert.equal(validateTrackingSettings({ testEventCode: 'hello' }).ok, false);
  });

  it('server events cannot be enabled without a pixel id', () => {
    assert.equal(validateTrackingSettings({ capiEnabled: true }).ok, false);
    assert.equal(validateTrackingSettings({ pixelId: '123456789', capiEnabled: true }).ok, true);
  });

  it('public tracking config contains only public ids — never the test code or server flag', () => {
    const pub = toPublicTracking({ ...EMPTY_TRACKING, pixelId: '123456789', ga4Id: 'G-ABC123XYZ9', capiEnabled: true, testEventCode: 'TEST123' });
    assert.deepEqual(Object.keys(pub).sort(), ['ga4Id', 'googleAdsId', 'gtmId', 'pixelId']);
    assert.equal(JSON.stringify(pub).includes('TEST123'), false);
  });

  it('browser and server use the same, stable event id for an order', () => {
    assert.equal(eventIdFor('Purchase', 'DG-12345'), 'purchase_DG-12345');
    assert.equal(eventIdFor('OrderDelivered', 'DG-12345'), 'orderdelivered_DG-12345');
  });

  it('Meta phone format and hashing', () => {
    assert.equal(phoneForMeta('01712345678'), '8801712345678');
    assert.equal(phoneForMeta('+880 1712-345678'), '8801712345678');
    // known SHA-256 vector for "abc"
    assert.equal(sha256('ABC '), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('CAPI body carries the event id, hashed identity, BDT value and the test code when set', () => {
    const body = buildCapiBody(
      { eventName: 'Purchase', eventId: 'purchase_DG-12345', eventTimeSec: 1_700_000_000, sourceUrl: 'https://shop.example/', hashedPhone: sha256('8801712345678'), valueBdt: 1280, orderNumber: 'DG-12345', numItems: 2, userAgent: 'UA', fbp: 'fb.1.1.2' },
      'TEST123'
    ) as { data: Record<string, unknown>[]; test_event_code?: string };
    assert.equal(body.test_event_code, 'TEST123');
    const e = body.data[0] as { event_id: string; action_source: string; user_data: { ph: string[]; fbp: string }; custom_data: { currency: string; value: number; order_id: string } };
    assert.equal(e.event_id, 'purchase_DG-12345');
    assert.equal(e.action_source, 'website');
    assert.equal(e.user_data.ph[0].length, 64);
    assert.equal(e.custom_data.currency, 'BDT');
    assert.equal(e.custom_data.value, 1280);
    const raw = JSON.stringify(body);
    assert.equal(raw.includes('01712345678'), false); // raw phone never sent
    assert.equal(buildCapiBody({ eventName: 'Purchase', eventId: 'x', eventTimeSec: 1, sourceUrl: 'u' }, '').hasOwnProperty('test_event_code'), false);
  });

  it('encrypts credentials at rest, round-trips, detects tampering and refuses to work without a key', () => {
    assert.throws(() => encryptSecret('EAAB-secret-token-value-123456'), SecretsKeyMissingError);
    process.env.INTEGRATION_SECRET_KEY = KEY;
    const plain = 'EAAB-secret-token-value-123456';
    const enc = encryptSecret(plain);
    assert.ok(enc.startsWith('v1.'));
    assert.equal(enc.includes(plain), false);
    assert.equal(decryptSecret(enc), plain);
    assert.notEqual(encryptSecret(plain), enc); // random IV per encryption
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered-ciphertext').toString('base64url');
    assert.throws(() => decryptSecret(parts.join('.')));
    process.env.INTEGRATION_SECRET_KEY = `${KEY}-other`;
    assert.throws(() => decryptSecret(enc)); // wrong key
    assert.equal(maskSecret(plain), '••••3456');
    assert.equal(maskSecret('short'), '••••');
  });

  it('success is reported only when Meta confirms events_received >= 1', async () => {
    const good = await postToMeta('123456789', 'tok', { data: [] }, fakeFetch(200, { events_received: 1 }));
    assert.equal(good.ok, true);
    const zero = await postToMeta('123456789', 'tok', { data: [] }, fakeFetch(200, { events_received: 0 }));
    assert.equal(zero.ok, false);
    const err = await postToMeta('123456789', 'tok', { data: [] }, fakeFetch(400, { error: { message: 'Invalid OAuth access token' } }));
    assert.equal(err.ok, false);
    assert.match(err.detail, /Invalid OAuth access token/);
  });

  it('network failures and timeouts are reported as failures, never as success', async () => {
    const boom = (async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    const failed = await postToMeta('123456789', 'tok', { data: [] }, boom);
    assert.equal(failed.ok, false);
    assert.equal(failed.httpStatus, 0);

    const never = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    const timedOut = await postToMeta('123456789', 'tok', { data: [] }, never, 50);
    assert.equal(timedOut.ok, false);
  });

  it('the access token is sent in a header, never in the URL', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const spy = (async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenAuth = String((init?.headers as Record<string, string>)?.Authorization || '');
      return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    await postToMeta('123456789', 'SECRET-TOKEN-VALUE-1234567890', { data: [] }, spy);
    assert.equal(seenUrl.includes('SECRET-TOKEN'), false);
    assert.equal(seenAuth, 'Bearer SECRET-TOKEN-VALUE-1234567890');
  });

  it('admin marketing APIs require owner auth + CSRF; public config is safe without a database', async () => {
    assert.equal((await adminMarketingGet(new Request('http://localhost:3000/api/admin/marketing'))).status, 401);
    const put = await adminMarketingPut(
      new Request('http://localhost:3000/api/admin/marketing', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify({ settings: EMPTY_TRACKING }),
      })
    );
    assert.equal(put.status, 401);
    assert.equal((await adminMarketingTest(new Request('http://localhost:3000/api/admin/marketing/test', { method: 'POST' }))).status, 403);
    const pub = await trackingConfigGet();
    assert.equal(pub.status, 200);
    const body = (await pub.json()) as { ok: boolean; tracking: unknown };
    assert.equal(body.tracking, null);
  });
});
