import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import firebaseConfig from '../../../firebase-applet-config.json';
import { BANGLADESH_DISTRICTS } from '../../data/deshiGeeData';
import type { CouponRecord, PaymentMethod, StoreSettingsDoc, WeightKey } from '../storeTypes';
import { CHATBOT_BUILD_CONFIG } from './build-config';
import { convertBanglaDigitsToEnglish } from './domain-guard';

export interface OrderDraftInput {
  weight: WeightKey;
  qty: number;
  customerName: string;
  phone: string;
  district: string;
  area: string;
  address: string;
  deliveryZone: 'dhaka' | 'nationwide';
  paymentMethod: PaymentMethod;
  txnId: string;
  couponCode: string;
  note: string;
}

export interface SignedOrderTokenPayload extends OrderDraftInput {
  tokenId: string;
  sessionId: string;
  unitPriceBdt: number;
  subtotalBdt: number;
  deliveryFeeBdt: number;
  discountBdt: number;
  totalBdt: number;
  previewHash: string;
  idempotencyKey: string;
  iat: number;
  exp: number;
}

const ALL_BD_DISTRICTS: string[] = [
  ...BANGLADESH_DISTRICTS,
  'Bagerhat',
  'Bandarban',
  'Barguna',
  'Bhola',
  'Chandpur',
  'Chapainawabganj',
  'Chuadanga',
  'Gaibandha',
  'Gopalganj',
  'Habiganj',
  'Jamalpur',
  'Jhalokati',
  'Jhenaidah',
  'Joypurhat',
  'Khagrachhari',
  'Kishoreganj',
  'Kurigram',
  'Lakshmipur',
  'Lalmonirhat',
  'Madaripur',
  'Magura',
  'Manikganj',
  'Meherpur',
  'Moulvibazar',
  'Munshiganj',
  'Naogaon',
  'Narail',
  'Natore',
  'Netrokona',
  'Nilphamari',
  'Panchagarh',
  'Patuakhali',
  'Pirojpur',
  'Rajbari',
  'Rangamati',
  'Satkhira',
  'Shariatpur',
  'Sherpur',
  'Sunamganj',
  'Thakurgaon',
  'Keraniganj',
  'Tongi',
  'Uttara',
  'Mirpur',
  'Dhanmondi',
  'Gulshan',
  'Banani',
];

const DISTRICT_ALIASES: Record<string, string> = {
  ঢাকা: 'Dhaka',
  dhaka: 'Dhaka',
  dacca: 'Dhaka',
  uttara: 'Dhaka',
  mirpur: 'Dhaka',
  dhanmondi: 'Dhaka',
  gulshan: 'Dhaka',
  banani: 'Dhaka',
  mohammadpur: 'Dhaka',
  badda: 'Dhaka',
  motijheel: 'Dhaka',
  চট্টগ্রাম: 'Chattogram',
  chittagong: 'Chattogram',
  chattogram: 'Chattogram',
  ctg: 'Chattogram',
  গাজীপুর: 'Gazipur',
  gazipur: 'Gazipur',
  টঙ্গী: 'Gazipur',
  tongi: 'Gazipur',
  নারায়ণগঞ্জ: 'Narayanganj',
  narayanganj: 'Narayanganj',
  সাভার: 'Savar',
  savar: 'Savar',
  সিলেট: 'Sylhet',
  sylhet: 'Sylhet',
  রাজশাহী: 'Rajshahi',
  rajshahi: 'Rajshahi',
  খুলনা: 'Khulna',
  khulna: 'Khulna',
  বরিশাল: 'Barishal',
  barisal: 'Barishal',
  barishal: 'Barishal',
  রংপুর: 'Rangpur',
  rangpur: 'Rangpur',
  ময়মনসিংহ: 'Mymensingh',
  mymensingh: 'Mymensingh',
  কুমিল্লা: 'Cumilla',
  comilla: 'Cumilla',
  cumilla: 'Cumilla',
  বগুড়া: 'Bogura',
  bogra: 'Bogura',
  bogura: 'Bogura',
  পাবনা: 'Pabna',
  pabna: 'Pabna',
  সিরাজগঞ্জ: 'Sirajganj',
  sirajganj: 'Sirajganj',
  যশোর: 'Jashore',
  jessore: 'Jashore',
  jashore: 'Jashore',
  'কক্সবাজার': 'Cox’s Bazar',
  "cox's bazar": 'Cox’s Bazar',
  coxsbazar: 'Cox’s Bazar',
  টাঙ্গাইল: 'Tangail',
  tangail: 'Tangail',
  নরসিংদী: 'Narsingdi',
  narsingdi: 'Narsingdi',
  ফরিদপুর: 'Faridpur',
  faridpur: 'Faridpur',
  দিনাজপুর: 'Dinajpur',
  dinajpur: 'Dinajpur',
  নোয়াখালী: 'Noakhali',
  noakhali: 'Noakhali',
  ফেনী: 'Feni',
  feni: 'Feni',
  কুষ্টিয়া: 'Kushtia',
  kushtia: 'Kushtia',
  ব্রাহ্মণবাড়িয়া: 'Brahmanbaria',
  brahmanbaria: 'Brahmanbaria',
};

function getTokenSecretKey(): Buffer {
  const seed =
    (process.env.ORDER_TOKEN_SECRET || '').trim() ||
    (process.env.GEMINI_API_KEY || '').trim() ||
    firebaseConfig.apiKey;
  return createHash('sha256').update(`deshi-gee-order-v1:${seed}`).digest();
}

export function normalizeBangladeshPhone(raw: string): string {
  const ascii = convertBanglaDigitsToEnglish(raw || '');
  return ascii.replace(/[\s\-+()]/g, '').replace(/^880/, '0').replace(/^88(?=01)/, '');
}

export function isValidBangladeshPhone(phone: string): boolean {
  return /^01[3-9]\d{8}$/.test(phone);
}

export function resolveConfiguredDistrictAndZone(
  districtInput: string,
  deliveryZoneInput?: string
): { valid: boolean; canonicalDistrict: string; deliveryZone: 'dhaka' | 'nationwide' } {
  const clean = convertBanglaDigitsToEnglish(districtInput || '').trim();
  if (!clean || clean.length < 2) {
    return { valid: false, canonicalDistrict: '', deliveryZone: 'nationwide' };
  }
  const lower = clean.toLowerCase();

  let canonical = DISTRICT_ALIASES[lower] || '';
  if (!canonical) {
    const matched = ALL_BD_DISTRICTS.find(
      (d) => d.toLowerCase() === lower || lower.includes(d.toLowerCase())
    );
    if (matched) canonical = matched;
  }

  if (!canonical) {
    return { valid: false, canonicalDistrict: '', deliveryZone: 'nationwide' };
  }

  const zoneHint = String(deliveryZoneInput || '').toLowerCase();
  const isInsideDhaka =
    canonical === 'Dhaka' ||
    (zoneHint === 'dhaka' && ['Dhaka'].includes(canonical));

  return {
    valid: true,
    canonicalDistrict: canonical,
    deliveryZone: isInsideDhaka ? 'dhaka' : 'nationwide',
  };
}

export function computeOrderPricingInPoisha(params: {
  settings: StoreSettingsDoc;
  weight: WeightKey;
  qty: number;
  deliveryZone: 'dhaka' | 'nationwide';
  paymentMethod: PaymentMethod;
  coupon: CouponRecord | null;
}): {
  unitPriceBdt: number;
  subtotalBdt: number;
  deliveryFeeBdt: number;
  discountBdt: number;
  totalBdt: number;
  freeDeliveryApplied: boolean;
  availableStock: number;
} {
  const { settings, weight, qty, deliveryZone, paymentMethod, coupon } = params;
  const safeQty = Math.max(1, Math.min(CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER, Math.round(qty)));

  const unitPriceBdt =
    weight === '250g'
      ? Math.round(settings.price250g)
      : weight === '500g'
        ? Math.round(settings.price500g)
        : Math.round(settings.price1kg);

  const availableStock =
    weight === '250g'
      ? Math.round(settings.stock250g)
      : weight === '500g'
        ? Math.round(settings.stock500g)
        : Math.round(settings.stock1kg);

  // Integer arithmetic in poisha (1 BDT = 100 poisha)
  const unitPoisha = unitPriceBdt * 100;
  const subtotalPoisha = unitPoisha * safeQty;
  const subtotalBdt = Math.round(subtotalPoisha / 100);

  const freeDeliveryApplied = subtotalBdt >= Math.round(settings.freeDeliveryThreshold);
  const deliveryFeeBdt = freeDeliveryApplied
    ? 0
    : deliveryZone === 'dhaka'
      ? Math.round(settings.insideDhakaFee)
      : Math.round(settings.outsideDhakaFee);
  const deliveryPoisha = deliveryFeeBdt * 100;

  let couponPct = 0;
  if (coupon && coupon.active && subtotalBdt >= coupon.minSubtotalBdt) {
    couponPct = Math.min(40, Math.max(0, Math.round(coupon.discountPct)));
  }

  const advancePct =
    paymentMethod !== 'cod' && settings.advanceDiscountPct > 0
      ? Math.min(25, Math.max(0, Math.round(settings.advanceDiscountPct)))
      : 0;

  const totalPct = Math.min(50, couponPct + advancePct);
  const discountPoisha = Math.round((subtotalPoisha * totalPct) / 100);
  const totalPoisha = Math.max(100, subtotalPoisha - discountPoisha + deliveryPoisha);

  return {
    unitPriceBdt,
    subtotalBdt,
    deliveryFeeBdt,
    discountBdt: Math.round(discountPoisha / 100),
    totalBdt: Math.round(totalPoisha / 100),
    freeDeliveryApplied,
    availableStock,
  };
}

export function buildOrderPreviewHash(
  sessionId: string,
  draft: OrderDraftInput & {
    unitPriceBdt: number;
    subtotalBdt: number;
    deliveryFeeBdt: number;
    discountBdt: number;
    totalBdt: number;
  }
): string {
  const canonical = JSON.stringify({
    sessionId,
    weight: draft.weight,
    qty: draft.qty,
    unitPriceBdt: draft.unitPriceBdt,
    deliveryFeeBdt: draft.deliveryFeeBdt,
    discountBdt: draft.discountBdt,
    totalBdt: draft.totalBdt,
    phone: draft.phone,
    district: draft.district,
    area: draft.area,
    address: draft.address,
    deliveryZone: draft.deliveryZone,
    paymentMethod: draft.paymentMethod,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export function buildOrderIdempotencyKey(params: {
  sessionId: string;
  phone: string;
  weight: WeightKey;
  qty: number;
  totalBdt: number;
  deliveryArea: string;
}): string {
  const canonical = `${params.sessionId}|${params.phone}|${params.weight}x${params.qty}|${params.totalBdt}|${params.deliveryArea.toLowerCase()}`;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 40);
}

export function createSignedOrderToken(params: {
  sessionId: string;
  draft: OrderDraftInput;
  pricing: {
    unitPriceBdt: number;
    subtotalBdt: number;
    deliveryFeeBdt: number;
    discountBdt: number;
    totalBdt: number;
  };
}): { token: string; payload: SignedOrderTokenPayload } {
  const now = Date.now();
  const previewHash = buildOrderPreviewHash(params.sessionId, {
    ...params.draft,
    ...params.pricing,
  });
  const idempotencyKey = buildOrderIdempotencyKey({
    sessionId: params.sessionId,
    phone: params.draft.phone,
    weight: params.draft.weight,
    qty: params.draft.qty,
    totalBdt: params.pricing.totalBdt,
    deliveryArea: `${params.draft.deliveryZone}:${params.draft.district}:${params.draft.area}`,
  });

  const payload: SignedOrderTokenPayload = {
    tokenId: randomUUID(),
    sessionId: params.sessionId,
    ...params.draft,
    ...params.pricing,
    previewHash,
    idempotencyKey,
    iat: now,
    exp: now + CHATBOT_BUILD_CONFIG.CONFIRM_TOKEN_TTL_MS,
  };

  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', getTokenSecretKey()).update(encoded).digest('base64url');
  return { token: `${encoded}.${sig}`, payload };
}

export function verifySignedOrderToken(
  token: string
):
  | { ok: true; payload: SignedOrderTokenPayload }
  | { ok: false; reason: 'invalid_token' | 'expired_token' } {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, reason: 'invalid_token' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, reason: 'invalid_token' };
  }
  const [encoded, sig] = parts;
  if (!encoded || !sig) {
    return { ok: false, reason: 'invalid_token' };
  }

  try {
    const expectedSig = createHmac('sha256', getTokenSecretKey())
      .update(encoded)
      .digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'invalid_token' };
    }

    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as SignedOrderTokenPayload;

    if (!parsed || !parsed.tokenId || !parsed.previewHash || !parsed.idempotencyKey) {
      return { ok: false, reason: 'invalid_token' };
    }

    const recomputedHash = buildOrderPreviewHash(parsed.sessionId, parsed);
    if (recomputedHash !== parsed.previewHash) {
      return { ok: false, reason: 'invalid_token' };
    }

    if (Date.now() > Number(parsed.exp || 0)) {
      return { ok: false, reason: 'expired_token' };
    }

    return { ok: true, payload: parsed };
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }
}
