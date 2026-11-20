import type { PaymentMethod, PaymentStatus, StoreSettingsDoc } from '../storeTypes';
import { getBusinessHoursStatus } from './security';
import type { ChatbotConfigDoc, SupportPriority } from './types';

export const ALLOWED_EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedEvidenceMime = (typeof ALLOWED_EVIDENCE_MIME_TYPES)[number];

export const MAX_EVIDENCE_BINARY_BYTES = 550_000;
export const MAX_EVIDENCE_BASE64_CHARS = 720_000;

export interface ValidatedEvidencePayload {
  ok: true;
  mimeType: AllowedEvidenceMime;
  filename: string;
  sizeBytes: number;
  dataBase64: string;
}

export interface InvalidEvidencePayload {
  ok: false;
  error: string;
}

export function sanitizeEvidenceFilename(raw: string, mimeType: AllowedEvidenceMime): string {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const base = String(raw || 'evidence')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return `${base || 'evidence'}.${ext}`;
}

export function detectMagicBytesMime(bytes: Uint8Array): AllowedEvidenceMime | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export function validateEvidenceUpload(input: {
  dataUrl?: string;
  mimeType?: string;
  dataBase64?: string;
  filename?: string;
}): ValidatedEvidencePayload | InvalidEvidencePayload {
  let rawMime = String(input.mimeType || '').trim().toLowerCase();
  let rawB64 = String(input.dataBase64 || '').trim();

  if (input.dataUrl && !rawB64) {
    const match = String(input.dataUrl)
      .trim()
      .match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) {
      return {
        ok: false,
        error: 'Only JPEG, PNG, or WebP image files are accepted as evidence.',
      };
    }
    rawMime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    rawB64 = match[2];
  }

  if (rawMime === 'image/jpg') rawMime = 'image/jpeg';
  if (!(ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(rawMime)) {
    return {
      ok: false,
      error: 'Unsupported image format. Please upload a JPEG, PNG, or WebP photo.',
    };
  }

  const cleanB64 = rawB64.replace(/\s+/g, '');
  if (!cleanB64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanB64)) {
    return { ok: false, error: 'Image encoding is invalid or corrupted.' };
  }

  if (cleanB64.length > MAX_EVIDENCE_BASE64_CHARS) {
    return {
      ok: false,
      error: 'Image size exceeds the 520 KB limit. Please resize or compress the photo.',
    };
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(cleanB64, 'base64');
  } catch {
    return { ok: false, error: 'Unable to decode base64 image payload.' };
  }

  if (decoded.byteLength < 32 || decoded.byteLength > MAX_EVIDENCE_BINARY_BYTES) {
    return {
      ok: false,
      error: 'Image file size must be between 32 bytes and 550 KB.',
    };
  }

  const magicMime = detectMagicBytesMime(decoded);
  if (!magicMime || magicMime !== rawMime) {
    return {
      ok: false,
      error: 'File header does not match declared JPEG/PNG/WebP image format.',
    };
  }

  return {
    ok: true,
    mimeType: magicMime,
    filename: sanitizeEvidenceFilename(input.filename || 'evidence', magicMime),
    sizeBytes: decoded.byteLength,
    dataBase64: cleanB64,
  };
}

export interface SupportSlaTarget {
  slaMinutes: number;
  slaDueAtIso: string;
  isOpenNow: boolean;
  currentTimeBst: string;
  nextOpenLabelEn: string;
  nextOpenLabelBn: string;
  expectationEn: string;
  expectationBn: string;
}

const WEEKDAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_BN: Record<string, string> = {
  Sunday: 'রবিবার',
  Monday: 'সোমবার',
  Tuesday: 'মঙ্গলবার',
  Wednesday: 'বুধবার',
  Thursday: 'বৃহস্পতিবার',
  Friday: 'শুক্রবার',
  Saturday: 'শনিবার',
};

function getBstCalendarParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
} {
  const bstDate = new Date(date.getTime() + 6 * 60 * 60 * 1000);
  const weekday = WEEKDAY_ORDER[bstDate.getUTCDay()] || 'Saturday';
  return {
    year: bstDate.getUTCFullYear(),
    month: bstDate.getUTCMonth(),
    day: bstDate.getUTCDate(),
    hour: bstDate.getUTCHours(),
    minute: bstDate.getUTCMinutes(),
    weekday,
  };
}

function formatHour12(hour24: number): string {
  const h = ((hour24 % 24) + 24) % 24;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${suffix}`;
}

export function computeSupportSlaTarget(params: {
  config: ChatbotConfigDoc;
  priority: SupportPriority;
  now?: Date;
}): SupportSlaTarget {
  const now = params.now || new Date();
  const cfg = params.config;
  const openHour = Math.max(0, Math.min(23, Number(cfg.openHourBst ?? 9)));
  const closeHour = Math.max(0, Math.min(23, Number(cfg.closeHourBst ?? 21)));
  const rawStandard = Number(cfg.slaStandardMinutes ?? 0);
  const rawUrgent = Number(cfg.slaUrgentMinutes ?? 0);
  const standardMins = rawStandard > 0 ? Math.max(15, Math.min(1440, Math.round(rawStandard))) : 0;
  const urgentMins = rawUrgent > 0 ? Math.max(5, Math.min(720, Math.round(rawUrgent))) : 0;
  const slaMinutes = params.priority === 'urgent' ? urgentMins : standardMins;

  if (slaMinutes <= 0) {
    return {
      slaMinutes: 0,
      slaDueAtIso: '',
      isOpenNow: false,
      currentTimeBst: getBusinessHoursStatus(cfg, now).currentTimeBst,
      nextOpenLabelEn: cfg.businessHours || 'Support hours pending confirmation',
      nextOpenLabelBn: cfg.businessHours || 'সাপোর্ট সময়সূচী নিশ্চিতকরণ প্রক্রিয়াধীন',
      expectationEn:
        'Your support request has been logged. Our human team will review it and follow up as soon as possible.',
      expectationBn:
        'আপনার সাপোর্ট অনুরোধটি নথিভুক্ত হয়েছে। আমাদের সাপোর্ট টিম যত দ্রুত সম্ভব আপনার সাথে যোগাযোগ করবে।',
    };
  }

  const hoursStatus = getBusinessHoursStatus(cfg, now);
  const closedLower = String(cfg.closedDays || '').toLowerCase();

  if (hoursStatus.isOpenNow) {
    const due = new Date(now.getTime() + slaMinutes * 60_000);
    const labelTime =
      slaMinutes >= 60 && slaMinutes % 60 === 0
        ? `${slaMinutes / 60} hour${slaMinutes === 60 ? '' : 's'}`
        : `${slaMinutes} minutes`;
    const labelTimeBn =
      slaMinutes >= 60 && slaMinutes % 60 === 0
        ? `${slaMinutes / 60} ঘণ্টা`
        : `${slaMinutes} মিনিট`;

    return {
      slaMinutes,
      slaDueAtIso: due.toISOString(),
      isOpenNow: true,
      currentTimeBst: hoursStatus.currentTimeBst,
      nextOpenLabelEn: 'Currently Open (BST)',
      nextOpenLabelBn: 'এখন অফিস সময় চালু আছে (BST)',
      expectationEn: `Our team target during business hours (${cfg.businessHours}) is ${labelTime} (${params.priority === 'urgent' ? 'Urgent' : 'Standard'}).`,
      expectationBn: `অফিস সময়ে (${cfg.businessHours}) আমাদের সাধারণ লক্ষ্য ${labelTimeBn}-এর মধ্যে সাড়া দেওয়া।`,
    };
  }

  // Compute exact next BST opening UTC timestamp (max 7 days ahead)
  const bstNow = getBstCalendarParts(now);
  let startAnchorUtcMs = now.getTime();
  let nextOpenWeekday = bstNow.weekday;

  for (let offsetDays = 0; offsetDays <= 7; offsetDays++) {
    const candidateBstMidnightUtc =
      Date.UTC(bstNow.year, bstNow.month, bstNow.day + offsetDays, openHour, 0, 0) -
      6 * 60 * 60 * 1000;
    const candidateParts = getBstCalendarParts(new Date(candidateBstMidnightUtc));
    const isClosedDay =
      closedLower.length > 0 && closedLower.includes(candidateParts.weekday.toLowerCase());
    if (isClosedDay) continue;
    if (candidateBstMidnightUtc > now.getTime()) {
      startAnchorUtcMs = candidateBstMidnightUtc;
      nextOpenWeekday = candidateParts.weekday;
      break;
    }
    // Same day and currently before openHour? Already covered by candidate > now check;
    // if after closeHour, loop advances to offsetDays >= 1.
  }

  const dueAt = new Date(startAnchorUtcMs + slaMinutes * 60_000);
  const openTimeLabel = `${formatHour12(openHour)} BST`;
  const nextOpenLabelEn = `${nextOpenWeekday} ${openTimeLabel} (closing ${formatHour12(closeHour)} BST)`;
  const nextOpenLabelBn = `${WEEKDAY_BN[nextOpenWeekday] || nextOpenWeekday} সকাল ${openTimeLabel}`;

  const labelTime =
    slaMinutes >= 60 && slaMinutes % 60 === 0
      ? `${slaMinutes / 60}h`
      : `${slaMinutes}m`;

  return {
    slaMinutes,
    slaDueAtIso: dueAt.toISOString(),
    isOpenNow: false,
    currentTimeBst: hoursStatus.currentTimeBst,
    nextOpenLabelEn,
    nextOpenLabelBn,
    expectationEn: `We are currently outside business hours (${cfg.businessHours}). Your ticket is queued and targeted within ${labelTime} after next opening (${nextOpenLabelEn}).`,
    expectationBn: `এখন অফিস সময়ের বাইরে (${cfg.businessHours})। পরবর্তী অফিস খোলার পর (${nextOpenLabelBn}) ${slaMinutes} মিনিটের মধ্যে আমাদের টিম যোগাযোগ করবে।`,
  };
}

export interface DeliveryDelayDiagnostic {
  isDelayed: boolean;
  elapsedHours: number;
  expectedMaxHours: number;
  statusNoteEn: string;
  statusNoteBn: string;
  recommendEscalation: boolean;
}

export function evaluateOrderDelayStatus(params: {
  status: string;
  estimatedDelivery: string;
  deliveryZone?: string;
  updatedAt?: unknown;
  createdAt?: unknown;
  now?: Date;
}): DeliveryDelayDiagnostic {
  const status = String(params.status || '').toLowerCase();
  if (status === 'delivered' || status === 'cancelled') {
    return {
      isDelayed: false,
      elapsedHours: 0,
      expectedMaxHours: 0,
      recommendEscalation: false,
      statusNoteEn:
        status === 'delivered'
          ? 'This order is marked Delivered.'
          : 'This order is marked Cancelled.',
      statusNoteBn:
        status === 'delivered'
          ? 'এই অর্ডারটি ডেলিভারি সম্পন্ন হয়েছে।'
          : 'এই অর্ডারটি বাতিল করা হয়েছে।',
    };
  }

  const nowMs = (params.now || new Date()).getTime();
  const rawTs = params.createdAt || params.updatedAt;
  let refMs = NaN;
  if (typeof rawTs === 'string') {
    refMs = Date.parse(rawTs);
  } else if (rawTs && typeof rawTs === 'object' && 'seconds' in rawTs) {
    refMs = Number((rawTs as { seconds: number }).seconds) * 1000;
  }

  const zone = String(params.deliveryZone || '').toLowerCase();
  const expectedMaxHours =
    zone === 'dhaka' ? 48 : zone === 'suburban' ? 72 : zone === 'remote' ? 120 : 96;

  if (!Number.isFinite(refMs) || refMs <= 0) {
    return {
      isDelayed: status === 'shipped',
      elapsedHours: 0,
      expectedMaxHours,
      recommendEscalation: true,
      statusNoteEn: `Current stage is "${status}" with expected window "${params.estimatedDelivery}". If it has passed this window, you can submit an urgent delivery follow-up below.`,
      statusNoteBn: `অর্ডারটি বর্তমানে "${status}" ধাপে আছে (সম্ভাব্য সময়: ${params.estimatedDelivery})। নির্ধারিত সময় পেরিয়ে গেলে নিচে জরুরি সাপোর্ট টিকিট খুলতে পারেন।`,
    };
  }

  const elapsedHours = Math.max(0, Math.round((nowMs - refMs) / 3_600_000));
  const isDelayed = elapsedHours > expectedMaxHours;

  return {
    isDelayed,
    elapsedHours,
    expectedMaxHours,
    recommendEscalation: isDelayed || status === 'shipped',
    statusNoteEn: isDelayed
      ? `Elapsed time (~${elapsedHours}h) exceeds the typical ${expectedMaxHours}h courier window (${params.estimatedDelivery}). An Urgent Late Delivery ticket is recommended.`
      : `Elapsed time is ~${elapsedHours}h within the expected ${params.estimatedDelivery} window (${status}).`,
    statusNoteBn: isDelayed
      ? `প্রায় ${elapsedHours} ঘণ্টা পেরিয়ে গেছে, যা সাধারণ ${expectedMaxHours} ঘণ্টার ডেলিভারি সময়ের বেশি। অনুগ্রহ করে Urgent Late Delivery টিকিট খুলুন।`
      : `অর্ডারটি "${status}" অবস্থায় আছে (সম্ভাব্য সময়: ${params.estimatedDelivery})।`,
  };
}

export function formatPaymentClarification(
  paymentMethod: PaymentMethod,
  paymentStatus: PaymentStatus,
  settings: StoreSettingsDoc,
  lang: 'bn' | 'en'
): { headline: string; detail: string; canEscalateDispute: boolean } {
  const bn = lang === 'bn';
  const methodLabel = paymentMethod.toUpperCase();

  if (paymentMethod === 'cod' || paymentStatus === 'cod_due') {
    return {
      headline: bn ? 'ক্যাশ অন ডেলিভারি (COD)' : 'Cash on Delivery (Due at Doorstep)',
      detail: bn
        ? 'এই অর্ডারটি ক্যাশ অন ডেলিভারি। কুরিয়ার রাইডারের হাতে জার বুঝে পেয়ে টাকা পরিশোধ করবেন—আগে কোনো অগ্রিম লাগবে না।'
        : 'This order is Cash on Delivery. You pay the courier rider in cash when receiving the parcel—no advance transfer is needed.',
      canEscalateDispute: false,
    };
  }

  if (paymentStatus === 'verified') {
    return {
      headline: bn ? `${methodLabel} পেমেন্ট যাচাইকৃত` : `${methodLabel} Payment Verified`,
      detail: bn
        ? 'আমাদের টিম আপনার ট্রানজেকশনটি যাচাই করে নিশ্চিত করেছে।'
        : 'Our team has matched and verified your transaction in the backend.',
      canEscalateDispute: false,
    };
  }

  if (paymentStatus === 'failed') {
    return {
      headline: bn ? `${methodLabel} পেমেন্ট যাচাই ব্যর্থ` : `${methodLabel} Verification Failed`,
      detail: bn
        ? `আপনার প্রদত্ত ${methodLabel} TxnID ম্যাচ করা যায়নি। ডেলিভারির আগে দ্রুত সমাধানের জন্য ট্রানজেকশন স্ক্রিনশটসহ পেমেন্ট ডিসপিউট টিকিট খুলুন বা ${settings.supportPhone} নম্বরে কল করুন।`
        : `Your submitted ${methodLabel} TxnID could not be matched. Please open a Payment Dispute ticket with your transfer screenshot for manual verification.`,
      canEscalateDispute: true,
    };
  }

  return {
    headline: bn ? `${methodLabel} যাচাই অপেক্ষমাণ` : `${methodLabel} Pending Manual Verification`,
    detail: bn
      ? `আমাদের সিস্টেমে ${methodLabel} পেমেন্ট ম্যানুয়ালি যাচাই করা হয় (অটো-গেটওয়ে নয়)। টাকা পাঠানো হয়ে থাকলে আমাদের টিম মেসেজ/TxnID মিলিয়ে যাচাই করবে; দেরি হলে স্ক্রিনশটসহ ডিসপিউট টিকিট দিন। কখনোই PIN বা OTP দেবেন না।`
      : `Our team manually reconciles ${methodLabel} transfers (no automatic payment gateway). Once sent, your status stays Pending Verification until matched. If already paid, you can submit your screenshot via a Payment Dispute ticket (never share PIN/OTP).`,
    canEscalateDispute: true,
  };
}

export interface SupportSlaAnalytics {
  totalTickets: number;
  openCount: number;
  resolvedCount: number;
  escalatedCount: number;
  breachedCount: number;
  slaMeasuredCount: number;
  slaMetCount: number;
  slaCompliancePct: number | null;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
  byCategory: Record<string, number>;
}

function parseTimestampMs(raw: unknown): number | null {
  if (typeof raw === 'string' && raw.trim()) {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (raw && typeof raw === 'object') {
    if ('seconds' in raw && typeof (raw as { seconds: unknown }).seconds === 'number') {
      return (raw as { seconds: number }).seconds * 1000;
    }
    if ('toDate' in raw && typeof (raw as { toDate: () => Date }).toDate === 'function') {
      const ms = (raw as { toDate: () => Date }).toDate().getTime();
      return Number.isFinite(ms) ? ms : null;
    }
  }
  return null;
}

export function computeSupportSlaAnalytics(
  tickets: Array<{
    status?: string;
    category?: string;
    slaDueAtIso?: string;
    firstRespondedAtIso?: string;
    resolvedAtIso?: string;
    createdAt?: unknown;
  }>,
  now: Date = new Date()
): SupportSlaAnalytics {
  const nowMs = now.getTime();
  let openCount = 0;
  let resolvedCount = 0;
  let escalatedCount = 0;
  let breachedCount = 0;
  let slaMeasuredCount = 0;
  let slaMetCount = 0;
  const firstRespMinutes: number[] = [];
  const resolutionMinutes: number[] = [];
  const byCategory: Record<string, number> = {};

  for (const t of tickets) {
    const status = String(t.status || 'open').toLowerCase();
    if (status === 'resolved') {
      resolvedCount += 1;
    } else {
      openCount += 1;
    }
    if (status === 'escalated') {
      escalatedCount += 1;
    }

    const cat = String(t.category || 'general');
    byCategory[cat] = (byCategory[cat] || 0) + 1;

    const createdMs = parseTimestampMs(t.createdAt);
    const firstRespMs = parseTimestampMs(t.firstRespondedAtIso);
    const resolvedMs = parseTimestampMs(t.resolvedAtIso);
    const slaDueMs = parseTimestampMs(t.slaDueAtIso);

    if (createdMs !== null && firstRespMs !== null && firstRespMs >= createdMs) {
      firstRespMinutes.push((firstRespMs - createdMs) / 60_000);
    }
    if (createdMs !== null && resolvedMs !== null && resolvedMs >= createdMs) {
      resolutionMinutes.push((resolvedMs - createdMs) / 60_000);
    }

    if (slaDueMs !== null) {
      const outcomeMs = firstRespMs ?? (status === 'resolved' ? resolvedMs : null);
      if (outcomeMs !== null) {
        slaMeasuredCount += 1;
        if (outcomeMs > slaDueMs) {
          breachedCount += 1;
        } else {
          slaMetCount += 1;
        }
      } else if (status !== 'resolved' && nowMs > slaDueMs) {
        slaMeasuredCount += 1;
        breachedCount += 1;
      }
    }
  }

  const avg = (nums: number[]): number | null => {
    if (nums.length === 0) return null;
    const sum = nums.reduce((acc, n) => acc + n, 0);
    return Math.round((sum / nums.length) * 10) / 10;
  };

  return {
    totalTickets: tickets.length,
    openCount,
    resolvedCount,
    escalatedCount,
    breachedCount,
    slaMeasuredCount,
    slaMetCount,
    slaCompliancePct:
      slaMeasuredCount > 0 ? Math.round((slaMetCount / slaMeasuredCount) * 100) : null,
    avgFirstResponseMinutes: avg(firstRespMinutes),
    avgResolutionMinutes: avg(resolutionMinutes),
    byCategory,
  };
}

export function escapeCsvCell(value: unknown): string {
  const raw =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : Array.isArray(value)
            ? value.join('; ')
            : JSON.stringify(value);

  // Neutralize Excel/Google Sheets CSV formula injection (=, +, -, @, \t, \r)
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function formatTimestampIsoForCsv(val: unknown): string {
  const ms = parseTimestampMs(val);
  return ms !== null ? new Date(ms).toISOString() : '';
}

export function buildOrdersCsv(
  orders: Array<{
    orderNumber: string;
    createdAt?: unknown;
    customerName: string;
    phone: string;
    district: string;
    area: string;
    address: string;
    deliveryZone: string;
    itemsSummary: string;
    qty: number;
    subtotalBdt: number;
    deliveryFeeBdt: number;
    discountBdt: number;
    totalBdt: number;
    couponCode?: string;
    paymentMethod: string;
    paymentStatus: string;
    txnId?: string;
    status: string;
    courierPartner?: string;
    consignmentId?: string;
    courierTrackingUrl?: string;
    dispatchedAtIso?: string;
    reviewStatus?: string;
  }>
): string {
  const headers = [
    'orderNumber',
    'createdAt',
    'customerName',
    'phone',
    'district',
    'area',
    'address',
    'deliveryZone',
    'itemsSummary',
    'qty',
    'subtotalBdt',
    'deliveryFeeBdt',
    'discountBdt',
    'totalBdt',
    'couponCode',
    'paymentMethod',
    'paymentStatus',
    'txnId',
    'status',
    'courierPartner',
    'consignmentId',
    'courierTrackingUrl',
    'dispatchedAtIso',
    'reviewStatus',
  ];

  const rows = orders.map((o) =>
    [
      o.orderNumber,
      formatTimestampIsoForCsv(o.createdAt),
      o.customerName,
      o.phone,
      o.district,
      o.area,
      o.address,
      o.deliveryZone,
      o.itemsSummary,
      o.qty,
      o.subtotalBdt,
      o.deliveryFeeBdt,
      o.discountBdt,
      o.totalBdt,
      o.couponCode || '',
      o.paymentMethod,
      o.paymentStatus,
      o.txnId || '',
      o.status,
      o.courierPartner || '',
      o.consignmentId || '',
      o.courierTrackingUrl || '',
      o.dispatchedAtIso || '',
      o.reviewStatus || '',
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return [headers.join(','), ...rows].join('\r\n');
}

export function buildSupportTicketsCsv(
  tickets: Array<{
    id: string;
    ticketNumber?: string;
    createdAt?: unknown;
    status: string;
    priority?: string;
    category?: string;
    customerName: string;
    phone: string;
    orderNumber?: string;
    assignedTo?: string;
    slaMinutes?: number;
    slaDueAtIso?: string;
    firstRespondedAtIso?: string;
    resolvedAtIso?: string;
    resolutionReason?: string;
    tags?: string[];
    issueSummary: string;
    aiPaused?: boolean;
  }>
): string {
  const headers = [
    'ticketNumber',
    'id',
    'createdAt',
    'status',
    'priority',
    'category',
    'customerName',
    'phone',
    'orderNumber',
    'assignedTo',
    'slaMinutes',
    'slaDueAtIso',
    'firstRespondedAtIso',
    'resolvedAtIso',
    'resolutionReason',
    'tags',
    'issueSummary',
    'aiPaused',
  ];

  const rows = tickets.map((t) =>
    [
      t.ticketNumber || '',
      t.id,
      formatTimestampIsoForCsv(t.createdAt),
      t.status,
      t.priority || 'standard',
      t.category || 'general',
      t.customerName,
      t.phone,
      t.orderNumber || '',
      t.assignedTo || '',
      t.slaMinutes ?? '',
      t.slaDueAtIso || '',
      t.firstRespondedAtIso || '',
      t.resolvedAtIso || '',
      t.resolutionReason || '',
      Array.isArray(t.tags) ? t.tags.join('; ') : '',
      t.issueSummary,
      Boolean(t.aiPaused),
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return [headers.join(','), ...rows].join('\r\n');
}
