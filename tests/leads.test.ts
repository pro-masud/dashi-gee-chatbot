import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GET as adminLeadsGet, PATCH as adminLeadsPatch } from '../app/api/admin/leads/route';
import { POST as leadsPost } from '../app/api/leads/route';
import { isValidBangladeshPhone as srvValid, normalizeBangladeshPhone as srvNormalize } from '../src/lib/chatbot/orderToken';
import {
  LEAD_STATUSES,
  isValidBangladeshPhone,
  normalizeBangladeshPhone,
  leadsToCsv,
  mergeLeadCapture,
  validateLeadCapture,
  validateLeadUpdate,
  type LeadCapture,
  type LeadDoc,
} from '../src/lib/leads/leads';

const base = {
  consent: true,
  phone: '+880 1712-345678',
  name: '  Rahim  ',
  district: 'Dhaka',
  qty500g: 2,
  source: { path: '/', utmSource: 'facebook', utmCampaign: 'winter', fbclid: true },
};

const capture = (p: Partial<LeadCapture> = {}): LeadCapture => ({
  phone: '01712345678',
  name: '',
  district: '',
  qty250g: 0,
  qty500g: 1,
  qty1kg: 0,
  sourcePath: '/',
  utmSource: '',
  utmCampaign: '',
  utmMedium: '',
  fromFacebookClick: false,
  ...p,
});

describe('Incomplete lead capture', () => {
  it('requires the privacy notice to have been shown (consent) before anything is stored', () => {
    const r = validateLeadCapture({ ...base, consent: false });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'no_consent');
    assert.equal(validateLeadCapture({ ...base, consent: undefined }).ok, false);
  });

  it('normalises +880 numbers and rejects invalid ones', () => {
    const ok = validateLeadCapture(base);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.value.phone, '01712345678');
      assert.equal(ok.value.name, 'Rahim');
      assert.equal(ok.value.utmSource, 'facebook');
      assert.equal(ok.value.fromFacebookClick, true);
    }
    assert.equal(validateLeadCapture({ ...base, phone: '12345' }).ok, false);
    assert.equal(validateLeadCapture({ ...base, phone: '01212345678' }).ok, false);
  });

  it('browser-safe phone helpers behave exactly like the server ones', () => {
    for (const raw of ['01712345678', '+880 1712-345678', '8801712345678', '০১৭১২৩৪৫৬৭৮', '(017) 12345678', '12345', '']) {
      assert.equal(normalizeBangladeshPhone(raw), srvNormalize(raw), raw);
      assert.equal(isValidBangladeshPhone(normalizeBangladeshPhone(raw)), srvValid(srvNormalize(raw)), raw);
    }
  });

  it('needs a selected package and rejects honeypot bots silently-coded', () => {
    assert.equal(validateLeadCapture({ ...base, qty500g: 0 }).ok, false);
    const bot = validateLeadCapture({ ...base, website: 'http://spam' });
    assert.equal(bot.ok, false);
    if (!bot.ok) assert.equal(bot.code, 'bot');
  });

  it('strips control characters and caps field lengths', () => {
    const r = validateLeadCapture({ ...base, name: 'A\u0000B'.padEnd(200, 'x') });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.ok(r.value.name.length <= 80);
      assert.equal(r.value.name.includes('\u0000'), false);
    }
  });

  it('one record per phone: later captures merge instead of duplicating', () => {
    const first = mergeLeadCapture(null, capture({ qty500g: 1, utmSource: 'facebook' }), '2026-11-20T10:00:00Z', 'iphash');
    assert.equal(first.id, '01712345678');
    assert.equal(first.status, 'new_lead');
    assert.equal(first.touchCount, 1);

    const second = mergeLeadCapture(first, capture({ name: 'Rahim', district: 'Dhaka', qty500g: 3, utmSource: 'google' }), '2026-11-20T10:05:00Z');
    assert.equal(second.id, first.id);
    assert.equal(second.touchCount, 2);
    assert.equal(second.name, 'Rahim');
    assert.equal(second.qty500g, 3); // newest selection wins while open
    assert.equal(second.utmSource, 'facebook'); // first-touch attribution kept
    assert.equal(second.createdAtIso, '2026-11-20T10:00:00Z');
    assert.equal(second.updatedAtIso, '2026-11-20T10:05:00Z');
  });

  it('an empty later value never erases a known name or district', () => {
    const first = mergeLeadCapture(null, capture({ name: 'Rahim', district: 'Dhaka' }), '2026-11-20T10:00:00Z');
    const second = mergeLeadCapture(first, capture({ name: '', district: '' }), '2026-11-20T10:01:00Z');
    assert.equal(second.name, 'Rahim');
    assert.equal(second.district, 'Dhaka');
  });

  it('converted or closed leads are never revived or rewritten by later captures', () => {
    const converted: LeadDoc = { ...mergeLeadCapture(null, capture({ qty500g: 1 }), '2026-11-20T10:00:00Z'), status: 'converted', convertedOrderNumber: 'DG-12345' };
    const after = mergeLeadCapture(converted, capture({ qty500g: 9 }), '2026-11-21T10:00:00Z');
    assert.equal(after.status, 'converted');
    assert.equal(after.qty500g, 1);
    assert.equal(after.convertedOrderNumber, 'DG-12345');
  });

  it('staff cannot manually mark a lead converted; updates are validated', () => {
    assert.equal(validateLeadUpdate({ status: 'converted' }).ok, false);
    assert.equal(validateLeadUpdate({ status: 'follow_up', followUpDate: '2026-11-25', note: ' call after 6pm ' }).ok, true);
    assert.equal(validateLeadUpdate({ status: 'bogus' }).ok, false);
    assert.equal(validateLeadUpdate({ followUpDate: '25/11/2026' }).ok, false);
    assert.equal(validateLeadUpdate({}).ok, false);
    assert.ok(LEAD_STATUSES.includes('converted'));
  });

  it('CSV export escapes quotes and keeps one row per lead', () => {
    const l = mergeLeadCapture(null, capture({ name: 'Ra"him' }), '2026-11-20T10:00:00Z');
    const csv = leadsToCsv([l]);
    assert.equal(csv.split('\n').length, 2);
    assert.ok(csv.includes('"Ra""him"'));
  });

  it('public capture API refuses cross-site posts and requests without consent', async () => {
    const noCsrf = await leadsPost(
      new Request('http://localhost:3000/api/leads', { method: 'POST', body: JSON.stringify(base) })
    );
    assert.equal(noCsrf.status, 403);

    const noConsent = await leadsPost(
      new Request('http://localhost:3000/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify({ ...base, consent: false }),
      })
    );
    assert.equal(noConsent.status, 400);

    const tooBig = await leadsPost(
      new Request('http://localhost:3000/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify({ ...base, name: 'x'.repeat(5000) }),
      })
    );
    assert.equal(tooBig.status, 413);
  });

  it('admin leads API requires authentication and CSRF', async () => {
    assert.equal((await adminLeadsGet(new Request('http://localhost:3000/api/admin/leads'))).status, 401);
    const patch = await adminLeadsPatch(
      new Request('http://localhost:3000/api/admin/leads', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify({ phone: '01712345678', status: 'follow_up' }),
      })
    );
    assert.equal(patch.status, 401);
    const noCsrf = await adminLeadsPatch(
      new Request('http://localhost:3000/api/admin/leads', { method: 'PATCH', body: '{}' })
    );
    assert.equal(noCsrf.status, 403);
  });
});
