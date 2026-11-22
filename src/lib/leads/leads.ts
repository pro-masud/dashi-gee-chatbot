
/**
 * This module is imported by browser code (admin Leads panel), so it must stay dependency-free:
 * no server-only imports. Phone helpers mirror chatbot/orderToken (covered by a test).
 */
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

export function normalizeBangladeshPhone(raw: string): string {
  const ascii = String(raw || '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
  return ascii.replace(/[\s\-+()]/g, '').replace(/^880/, '0').replace(/^88(?=01)/, '');
}

export function isValidBangladeshPhone(phone: string): boolean {
  return /^01[3-9]\d{8}$/.test(phone);
}

/**
 * Incomplete-order lead capture — pure rules (no I/O).
 *
 * Privacy principles:
 *  - capture starts only after a valid phone number AND an on-screen notice (client sends consent=true)
 *  - only what follow-up needs: phone, optional name/district, package quantities, attribution
 *  - one record per phone number (document id = normalised phone) → no duplicates
 *  - raw IP addresses are never stored
 */

export const LEAD_STATUSES = [
  'new_lead',
  'not_contacted',
  'contact_attempted',
  'interested',
  'follow_up',
  'converted',
  'not_interested',
  'invalid_number',
  'closed',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new_lead: 'New lead',
  not_contacted: 'Not contacted',
  contact_attempted: 'Contact attempted',
  interested: 'Customer interested',
  follow_up: 'Follow-up required',
  converted: 'Converted to order',
  not_interested: 'Not interested',
  invalid_number: 'Invalid number',
  closed: 'Closed',
};

/** Terminal statuses a later automatic capture must not overwrite. */
export const LEAD_FINAL_STATUSES: LeadStatus[] = ['converted', 'not_interested', 'invalid_number', 'closed'];

export const CONSENT_TEXT_VERSION = 'v1';

export interface LeadCapture {
  phone: string;
  name: string;
  district: string;
  qty250g: number;
  qty500g: number;
  qty1kg: number;
  /** Landing path, e.g. "/" */
  sourcePath: string;
  utmSource: string;
  utmCampaign: string;
  utmMedium: string;
  /** true when the visitor arrived with a Facebook click id (the id itself is not stored) */
  fromFacebookClick: boolean;
}

export interface LeadDoc extends LeadCapture {
  id: string;
  status: LeadStatus;
  touchCount: number;
  consentAtIso: string;
  consentTextVersion: string;
  createdAtIso: string;
  updatedAtIso: string;
  lastCapturedAtIso: string;
  convertedOrderNumber?: string;
  followUpDate?: string;
  assignedTo?: string;
  ipHash?: string;
}

const clean = (v: unknown, max: number): string =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);

const qty = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 0;
};

export function validateLeadCapture(
  raw: unknown
): { ok: true; value: LeadCapture } | { ok: false; error: string; code: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid payload.', code: 'invalid' };
  const b = raw as Record<string, unknown>;

  if (b.consent !== true) {
    return { ok: false, error: 'Consent notice must be shown and accepted before capture.', code: 'no_consent' };
  }
  // Honeypot: real visitors never fill this hidden field.
  if (typeof b.website === 'string' && b.website.trim()) {
    return { ok: false, error: 'Rejected.', code: 'bot' };
  }

  const phone = normalizeBangladeshPhone(String(b.phone || ''));
  if (!isValidBangladeshPhone(phone)) {
    return { ok: false, error: 'Enter a valid Bangladesh mobile number.', code: 'invalid_phone' };
  }

  const q250 = qty(b.qty250g);
  const q500 = qty(b.qty500g);
  const q1k = qty(b.qty1kg);
  if (q250 + q500 + q1k === 0) {
    return { ok: false, error: 'Select a package first.', code: 'no_items' };
  }

  const src = (b.source && typeof b.source === 'object' ? b.source : {}) as Record<string, unknown>;
  return {
    ok: true,
    value: {
      phone,
      name: clean(b.name, 80),
      district: clean(b.district, 40),
      qty250g: q250,
      qty500g: q500,
      qty1kg: q1k,
      sourcePath: clean(src.path, 120) || '/',
      utmSource: clean(src.utmSource, 60),
      utmCampaign: clean(src.utmCampaign, 80),
      utmMedium: clean(src.utmMedium, 60),
      fromFacebookClick: src.fbclid === true,
    },
  };
}

/**
 * Merge a new capture into an existing lead (or create one).
 * - never overwrites a non-empty name/district with an empty value
 * - never revives a final status (converted / not interested / invalid / closed)
 * - keeps the first-touch attribution; later touches only fill blanks
 */
export function mergeLeadCapture(
  existing: LeadDoc | null,
  incoming: LeadCapture,
  nowIso: string,
  ipHash?: string
): LeadDoc {
  if (!existing) {
    return {
      id: incoming.phone,
      ...incoming,
      status: 'new_lead',
      touchCount: 1,
      consentAtIso: nowIso,
      consentTextVersion: CONSENT_TEXT_VERSION,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      lastCapturedAtIso: nowIso,
      ...(ipHash ? { ipHash } : {}),
    };
  }
  const isFinal = LEAD_FINAL_STATUSES.includes(existing.status);
  return {
    ...existing,
    name: incoming.name || existing.name,
    district: incoming.district || existing.district,
    // newest package selection wins while the lead is still open
    ...(isFinal
      ? {}
      : { qty250g: incoming.qty250g, qty500g: incoming.qty500g, qty1kg: incoming.qty1kg }),
    utmSource: existing.utmSource || incoming.utmSource,
    utmCampaign: existing.utmCampaign || incoming.utmCampaign,
    utmMedium: existing.utmMedium || incoming.utmMedium,
    fromFacebookClick: existing.fromFacebookClick || incoming.fromFacebookClick,
    touchCount: existing.touchCount + 1,
    updatedAtIso: nowIso,
    lastCapturedAtIso: nowIso,
  };
}

export interface LeadUpdateInput {
  status?: LeadStatus;
  note?: string;
  followUpDate?: string;
  assignedTo?: string;
}

export function validateLeadUpdate(
  raw: unknown
): { ok: true; value: LeadUpdateInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid payload.' };
  const b = raw as Record<string, unknown>;
  const out: LeadUpdateInput = {};
  if (b.status !== undefined) {
    if (!(LEAD_STATUSES as readonly string[]).includes(String(b.status))) return { ok: false, error: 'Unknown lead status.' };
    if (b.status === 'converted') {
      return { ok: false, error: 'Leads become “Converted” automatically when the same phone places an order.' };
    }
    out.status = b.status as LeadStatus;
  }
  if (b.note !== undefined) out.note = clean(b.note, 500);
  if (b.followUpDate !== undefined) {
    const d = String(b.followUpDate || '');
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: 'Follow-up date must be YYYY-MM-DD.' };
    out.followUpDate = d;
  }
  if (b.assignedTo !== undefined) out.assignedTo = clean(b.assignedTo, 80);
  if (out.status === undefined && out.note === undefined && out.followUpDate === undefined && out.assignedTo === undefined) {
    return { ok: false, error: 'Nothing to update.' };
  }
  return { ok: true, value: out };
}

export function leadsToCsv(leads: LeadDoc[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['phone', 'name', 'district', 'q250g', 'q500g', 'q1kg', 'status', 'source', 'campaign', 'touches', 'created', 'last_captured', 'follow_up', 'order'];
  const rows = leads.map((l) =>
    [l.phone, l.name, l.district, l.qty250g, l.qty500g, l.qty1kg, l.status, l.utmSource, l.utmCampaign, l.touchCount, l.createdAtIso, l.lastCapturedAtIso, l.followUpDate || '', l.convertedOrderNumber || ''].map(esc).join(',')
  );
  return [head.join(','), ...rows].join('\n');
}
