import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GET as adminCmsGet, POST as adminCmsPost, PUT as adminCmsPut } from '../app/api/admin/cms/route';
import { GET as publishedGet } from '../app/api/cms/published/route';
import {
  emptyCms,
  isAnnouncementActive,
  isAnnouncementHidden,
  isSafeLink,
  moveItem,
  sanitizeCms,
  visibleFaqs,
  visibleHighlights,
} from '../src/lib/cms/cms';

describe('Landing page CMS (lite)', () => {
  it('an untouched CMS changes nothing: empty values mean "use built-in text"', () => {
    const c = emptyCms();
    assert.equal(isAnnouncementActive(c.announcement), false);
    assert.equal(isAnnouncementHidden(c.announcement), false);
    assert.deepEqual(visibleFaqs(c.faqs), []);
    assert.deepEqual(visibleHighlights(c.highlights, 'en'), []);
  });

  it('strips HTML so only plain text is ever stored', () => {
    const r = sanitizeCms({ hero: { titleEn: 'Pure <script>alert(1)</script>Ghee <b>now</b>' } });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.hero.titleEn, 'Pure alert(1)Ghee now');
  });

  it('accepts only safe links: site paths or https', () => {
    assert.equal(isSafeLink(''), true);
    assert.equal(isSafeLink('/#order'), true);
    assert.equal(isSafeLink('https://example.com/offer?x=1'), true);
    assert.equal(isSafeLink('http://example.com'), false);
    assert.equal(isSafeLink('javascript:alert(1)'), false);
    assert.equal(isSafeLink('//evil.com'), false);
    assert.equal(sanitizeCms({ announcement: { textEn: 'Sale', linkUrl: 'javascript:alert(1)' } }).ok, false);
  });

  it('validates colours and dates', () => {
    assert.equal(sanitizeCms({ announcement: { textEn: 'x', bgColor: 'red' } }).ok, false);
    assert.equal(sanitizeCms({ announcement: { textEn: 'x', bgColor: '#1A120B', textColor: '#fff' } }).ok, true);
    assert.equal(sanitizeCms({ announcement: { textEn: 'x', startDate: '2026-12-31', endDate: '2026-12-01' } }).ok, false);
    assert.equal(sanitizeCms({ announcement: { textEn: 'x', startDate: '31-12-2026' } }).ok, false);
  });

  it('announcement honours enabled flag and Dhaka date window', () => {
    const base = { ...emptyCms().announcement, textEn: 'Winter sale' };
    assert.equal(isAnnouncementActive(base, new Date('2026-11-20T05:00:00Z')), true);
    assert.equal(isAnnouncementActive({ ...base, enabled: false }), false);
    assert.equal(isAnnouncementHidden({ ...base, enabled: false }), true); // owner switched a configured bar off
    const windowed = { ...base, startDate: '2026-11-25', endDate: '2026-11-30' };
    assert.equal(isAnnouncementActive(windowed, new Date('2026-11-24T05:00:00Z')), false); // too early
    assert.equal(isAnnouncementActive(windowed, new Date('2026-11-27T05:00:00Z')), true);
    assert.equal(isAnnouncementActive(windowed, new Date('2026-12-01T05:00:00Z')), false); // expired
    // 23:30 UTC on the 30th is already Dec 1 in Dhaka
    assert.equal(isAnnouncementActive(windowed, new Date('2026-11-30T23:30:00Z')), false);
  });

  it('FAQ entries need an answer, can be hidden and keep their order', () => {
    assert.equal(sanitizeCms({ faqs: [{ qEn: 'Q?', aEn: '' }] }).ok, false);
    const r = sanitizeCms({
      faqs: [
        { id: 'a', qEn: 'First?', aEn: 'One' },
        { id: 'b', qBn: 'দ্বিতীয়?', aBn: 'দুই', visible: false },
        { id: 'c', qEn: 'Third?', aEn: 'Three', qBn: 'তৃতীয়?', aBn: 'তিন' },
      ],
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.value.faqs.map((f) => f.id), ['a', 'b', 'c']);
      assert.deepEqual(visibleFaqs(r.value.faqs).map((f) => f.id), ['a', 'c']);
    }
  });

  it('blank rows are dropped and duplicate ids are made unique', () => {
    const r = sanitizeCms({
      highlights: [
        { id: 'x', textEn: 'One' },
        { id: 'x', textEn: 'Two' },
        { id: 'y', textEn: '', textBn: '' },
      ],
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.highlights.length, 2);
      assert.notEqual(r.value.highlights[0].id, r.value.highlights[1].id);
    }
  });

  it('highlights fall back across languages and respect visibility', () => {
    const list = [
      { id: '1', textEn: 'Pabna', textBn: 'পাবনা', visible: true },
      { id: '2', textEn: 'Hidden', textBn: '', visible: false },
      { id: '3', textEn: 'Only English', textBn: '', visible: true },
    ];
    assert.deepEqual(visibleHighlights(list, 'bn'), ['পাবনা', 'Only English']);
    assert.deepEqual(visibleHighlights(list, 'en'), ['Pabna', 'Only English']);
  });

  it('enforces size limits', () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ id: `f${i}`, qEn: 'Q', aEn: 'A' }));
    assert.equal(sanitizeCms({ faqs: many }).ok, false);
    const tooManyHighlights = Array.from({ length: 13 }, (_, i) => ({ id: `h${i}`, textEn: 'x' }));
    assert.equal(sanitizeCms({ highlights: tooManyHighlights }).ok, false);
    const long = sanitizeCms({ hero: { titleEn: 'x'.repeat(500) } });
    assert.equal(long.ok, true);
    if (long.ok) assert.equal(long.value.hero.titleEn.length, 90);
  });

  it('moveItem reorders safely and ignores out-of-range moves', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 2, 1), ['a', 'c', 'b']);
    assert.deepEqual(moveItem(['a', 'b'], 0, 5), ['a', 'b']);
  });

  it('admin CMS API requires owner authentication and CSRF; public API is safe without a database', async () => {
    assert.equal((await adminCmsGet(new Request('http://localhost:3000/api/admin/cms'))).status, 401);
    const put = await adminCmsPut(
      new Request('http://localhost:3000/api/admin/cms', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify(emptyCms()),
      })
    );
    assert.equal(put.status, 401);
    const noCsrf = await adminCmsPost(new Request('http://localhost:3000/api/admin/cms', { method: 'POST', body: '{}' }));
    assert.equal(noCsrf.status, 403);
    const pub = await publishedGet();
    assert.equal(pub.status, 200);
    const body = (await pub.json()) as { ok: boolean; content: unknown };
    assert.equal(body.ok, true);
    assert.equal(body.content, null);
  });
});
