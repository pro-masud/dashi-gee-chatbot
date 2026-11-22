/**
 * Landing-page CMS (lite) — pure rules, browser-safe.
 *
 * The owner edits a DRAFT and then PUBLISHES it. The storefront only ever reads the published copy.
 * Every field is optional: an empty value means "use the built-in default text", so nothing on the
 * live page can be accidentally blanked out.
 */

export interface CmsAnnouncement {
  /** false = hide the bar entirely (only honoured once the owner has configured the bar) */
  enabled: boolean;
  textEn: string;
  textBn: string;
  /** relative path (/#order) or https URL; empty = not clickable */
  linkUrl: string;
  bgColor: string;
  textColor: string;
  /** YYYY-MM-DD in Asia/Dhaka, empty = no limit */
  startDate: string;
  endDate: string;
}

export interface CmsHero {
  titleEn: string;
  accentEn: string;
  titleBn: string;
  accentBn: string;
  subtitleEn: string;
  subtitleBn: string;
  ctaEn: string;
  ctaBn: string;
}

export interface CmsHighlight {
  id: string;
  textEn: string;
  textBn: string;
  visible: boolean;
}

export interface CmsFaq {
  id: string;
  qEn: string;
  aEn: string;
  qBn: string;
  aBn: string;
  visible: boolean;
}

export interface CmsContent {
  announcement: CmsAnnouncement;
  hero: CmsHero;
  highlights: CmsHighlight[];
  faqs: CmsFaq[];
}

export function emptyCms(): CmsContent {
  return {
    announcement: { enabled: true, textEn: '', textBn: '', linkUrl: '', bgColor: '', textColor: '', startDate: '', endDate: '' },
    hero: { titleEn: '', accentEn: '', titleBn: '', accentBn: '', subtitleEn: '', subtitleBn: '', ctaEn: '', ctaBn: '' },
    highlights: [],
    faqs: [],
  };
}

const clean = (v: unknown, max: number): string =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/<[^>]*>/g, '') // plain text only — no markup is ever stored
    .trim()
    .slice(0, max);

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isSafeLink(url: string): boolean {
  if (!url) return true;
  if (url.startsWith('//')) return false; // protocol-relative URLs can point off-site
  if (/^\/[#A-Za-z0-9/_?=&.\-]*$/.test(url)) return true; // site-relative
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

const MAX_HIGHLIGHTS = 12;
const MAX_FAQS = 30;

export function sanitizeCms(raw: unknown): { ok: true; value: CmsContent } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid content.' };
  const b = raw as Record<string, unknown>;
  const out = emptyCms();

  const a = (b.announcement ?? {}) as Record<string, unknown>;
  const link = clean(a.linkUrl, 300);
  if (!isSafeLink(link)) return { ok: false, error: 'Announcement link must be a site path like /#order or an https:// URL.' };
  const bg = clean(a.bgColor, 9);
  const fg = clean(a.textColor, 9);
  if ((bg && !HEX.test(bg)) || (fg && !HEX.test(fg))) return { ok: false, error: 'Colours must be hex values like #1A120B.' };
  const start = clean(a.startDate, 10);
  const end = clean(a.endDate, 10);
  if ((start && !DATE.test(start)) || (end && !DATE.test(end))) return { ok: false, error: 'Dates must be YYYY-MM-DD.' };
  if (start && end && start > end) return { ok: false, error: 'Announcement end date is before the start date.' };
  out.announcement = {
    enabled: a.enabled !== false,
    textEn: clean(a.textEn, 160),
    textBn: clean(a.textBn, 160),
    linkUrl: link,
    bgColor: bg,
    textColor: fg,
    startDate: start,
    endDate: end,
  };

  const h = (b.hero ?? {}) as Record<string, unknown>;
  out.hero = {
    titleEn: clean(h.titleEn, 90),
    accentEn: clean(h.accentEn, 60),
    titleBn: clean(h.titleBn, 90),
    accentBn: clean(h.accentBn, 60),
    subtitleEn: clean(h.subtitleEn, 260),
    subtitleBn: clean(h.subtitleBn, 260),
    ctaEn: clean(h.ctaEn, 30),
    ctaBn: clean(h.ctaBn, 30),
  };

  const seen = new Set<string>();
  const id = (v: unknown, i: number, prefix: string): string => {
    let k = clean(v, 40).replace(/[^A-Za-z0-9_-]/g, '') || `${prefix}${Date.now().toString(36)}${i}`;
    while (seen.has(k)) k = `${k}x`;
    seen.add(k);
    return k;
  };

  const highlights = Array.isArray(b.highlights) ? b.highlights : [];
  if (highlights.length > MAX_HIGHLIGHTS) return { ok: false, error: `At most ${MAX_HIGHLIGHTS} highlights.` };
  out.highlights = highlights
    .map((x, i) => {
      const r = (x ?? {}) as Record<string, unknown>;
      return { id: id(r.id, i, 'h'), textEn: clean(r.textEn, 60), textBn: clean(r.textBn, 60), visible: r.visible !== false };
    })
    .filter((x) => x.textEn || x.textBn);

  const faqs = Array.isArray(b.faqs) ? b.faqs : [];
  if (faqs.length > MAX_FAQS) return { ok: false, error: `At most ${MAX_FAQS} FAQ entries.` };
  out.faqs = faqs
    .map((x, i) => {
      const r = (x ?? {}) as Record<string, unknown>;
      return {
        id: id(r.id, i, 'f'),
        qEn: clean(r.qEn, 200),
        aEn: clean(r.aEn, 900),
        qBn: clean(r.qBn, 200),
        aBn: clean(r.aBn, 900),
        visible: r.visible !== false,
      };
    })
    .filter((x) => x.qEn || x.qBn);

  for (const f of out.faqs) {
    if (!(f.qEn && f.aEn) && !(f.qBn && f.aBn)) {
      return { ok: false, error: `FAQ "${f.qEn || f.qBn}" needs an answer in at least one language.` };
    }
  }
  return { ok: true, value: out };
}

/** Today's date in Asia/Dhaka as YYYY-MM-DD. */
export function dhakaToday(now = new Date()): string {
  return new Date(now.getTime() + 6 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Should the announcement bar show custom content?
 *  - never configured (no text)        → false (storefront keeps its default bar)
 *  - configured but disabled           → handled by `isAnnouncementHidden`
 */
export function isAnnouncementActive(a: CmsAnnouncement, now = new Date()): boolean {
  if (!a.enabled || !(a.textEn || a.textBn)) return false;
  const today = dhakaToday(now);
  if (a.startDate && today < a.startDate) return false;
  if (a.endDate && today > a.endDate) return false;
  return true;
}

/** The owner configured the bar and explicitly turned it off → hide even the default bar. */
export function isAnnouncementHidden(a: CmsAnnouncement): boolean {
  return a.enabled === false && Boolean(a.textEn || a.textBn);
}

export function visibleFaqs(faqs: CmsFaq[]): CmsFaq[] {
  return faqs.filter((f) => f.visible);
}

export function visibleHighlights(items: CmsHighlight[], lang: 'en' | 'bn'): string[] {
  return items
    .filter((h) => h.visible)
    .map((h) => (lang === 'bn' ? h.textBn || h.textEn : h.textEn || h.textBn))
    .filter(Boolean);
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export interface CmsVersionMeta {
  id: string;
  label: string;
  createdAtIso: string;
  createdByEmail: string;
}
