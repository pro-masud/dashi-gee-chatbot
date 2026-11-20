import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { ALL_64_BANGLADESH_DISTRICTS } from '../../data/deshiGeeData';
import type {
  CouponRecord,
  DeliveryZone,
  OrderRiskReviewStatus,
  PaymentMethod,
  StoreSettingsDoc,
  WeightKey,
} from '../storeTypes';
import { CHATBOT_BUILD_CONFIG } from './build-config';
import { convertBanglaDigitsToEnglish } from './domain-guard';

export interface VariantQuantities {
  '250g': number;
  '500g': number;
  '1kg': number;
}

export interface VariantLineItem {
  weight: WeightKey;
  qty: number;
  unitPriceBdt: number;
  lineSubtotalBdt: number;
}

export interface OrderDraftInput {
  weight: WeightKey;
  qty: number;
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  customerName: string;
  phone: string;
  district: string;
  area: string;
  address: string;
  deliveryZone: DeliveryZone;
  paymentMethod: PaymentMethod;
  txnId: string;
  couponCode: string;
  note: string;
}

export interface SignedOrderTokenPayload extends OrderDraftInput {
  tokenId: string;
  sessionId: string;
  qty250g: number;
  qty500g: number;
  qty1kg: number;
  itemsSummary: string;
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

export const ALL_BD_DISTRICTS: string[] = [...ALL_64_BANGLADESH_DISTRICTS];

export const DHAKA_SUBURBAN_DISTRICTS = new Set(['Gazipur', 'Narayanganj', 'Manikganj', 'Munshiganj', 'Narsingdi']);

export const DHAKA_SUBURBAN_AREA_KEYWORDS = [
  'savar',
  'সাভার',
  'ashulia',
  'আশুলিয়া',
  'আশুলিয়া',
  'keraniganj',
  'কেরানীগঞ্জ',
  'tongi',
  'টঙ্গী',
  'gazipur',
  'গাজীপুর',
  'narayanganj',
  'নারায়ণগঞ্জ',
  'নারায়ণগঞ্জ',
  'dhamrai',
  'ধামরাই',
  'dohar',
  'দোহার',
  'nawabganj',
  'নবাবগঞ্জ',
  'fatullah',
  'ফতুল্লা',
  'siddhirganj',
  'সিদ্ধিরগঞ্জ',
  'zindabazar', // no, only Dhaka outskirts:
  'demra',
  'ডেমরা',
  'rupganj',
  'রূপগঞ্জ',
  'sonargaon',
  'সোনারগাঁও',
].filter((k) => k !== 'zindabazar');

export const REMOTE_DISTRICTS = new Set([
  'Bandarban',
  'Rangamati',
  'Khagrachhari',
  'Cox’s Bazar',
  'Bhola',
]);

const DISTRICT_ALIASES: Record<string, { district: string; suburbanArea?: boolean }> = {
  // Dhaka Metro & famous areas
  ঢাকা: { district: 'Dhaka' },
  dhaka: { district: 'Dhaka' },
  dacca: { district: 'Dhaka' },
  uttara: { district: 'Dhaka' },
  উত্তরা: { district: 'Dhaka' },
  mirpur: { district: 'Dhaka' },
  মিরপুর: { district: 'Dhaka' },
  dhanmondi: { district: 'Dhaka' },
  ধানমন্ডি: { district: 'Dhaka' },
  gulshan: { district: 'Dhaka' },
  গুলশান: { district: 'Dhaka' },
  banani: { district: 'Dhaka' },
  বনানী: { district: 'Dhaka' },
  mohammadpur: { district: 'Dhaka' },
  মোহাম্মদপুর: { district: 'Dhaka' },
  badda: { district: 'Dhaka' },
  বাড্ডা: { district: 'Dhaka' },
  motijheel: { district: 'Dhaka' },
  মতিঝিল: { district: 'Dhaka' },
  bashundhara: { district: 'Dhaka' },
  বসুন্ধরা: { district: 'Dhaka' },
  rampura: { district: 'Dhaka' },
  khilgaon: { district: 'Dhaka' },
  farmgate: { district: 'Dhaka' },
  tejgaon: { district: 'Dhaka' },
  jatrabari: { district: 'Dhaka' },
  lalbagh: { district: 'Dhaka' },
  moghbazar: { district: 'Dhaka' },
  shahbagh: { district: 'Dhaka' },
  // Dhaka Suburbs -> Canonical District + Suburban Flag
  সাভার: { district: 'Dhaka', suburbanArea: true },
  savar: { district: 'Dhaka', suburbanArea: true },
  ashulia: { district: 'Dhaka', suburbanArea: true },
  আশুলিয়া: { district: 'Dhaka', suburbanArea: true },
  আশুলিয়া: { district: 'Dhaka', suburbanArea: true },
  keraniganj: { district: 'Dhaka', suburbanArea: true },
  কেরানীগঞ্জ: { district: 'Dhaka', suburbanArea: true },
  dhamrai: { district: 'Dhaka', suburbanArea: true },
  dohar: { district: 'Dhaka', suburbanArea: true },
  টঙ্গী: { district: 'Gazipur', suburbanArea: true },
  tongi: { district: 'Gazipur', suburbanArea: true },
  গাজীপুর: { district: 'Gazipur', suburbanArea: true },
  gazipur: { district: 'Gazipur', suburbanArea: true },
  নারায়ণগঞ্জ: { district: 'Narayanganj', suburbanArea: true },
  নারায়ণগঞ্জ: { district: 'Narayanganj', suburbanArea: true },
  narayanganj: { district: 'Narayanganj', suburbanArea: true },
  manikganj: { district: 'Manikganj', suburbanArea: true },
  মানিকগঞ্জ: { district: 'Manikganj', suburbanArea: true },
  munshiganj: { district: 'Munshiganj', suburbanArea: true },
  মুন্সীগঞ্জ: { district: 'Munshiganj', suburbanArea: true },
  narsingdi: { district: 'Narsingdi', suburbanArea: true },
  নরসিংদী: { district: 'Narsingdi', suburbanArea: true },
  // Major & All Other 64 Districts (English + Bangla + legacy spellings)
  চট্টগ্রাম: { district: 'Chattogram' },
  chittagong: { district: 'Chattogram' },
  chattogram: { district: 'Chattogram' },
  ctg: { district: 'Chattogram' },
  সিলেট: { district: 'Sylhet' },
  sylhet: { district: 'Sylhet' },
  রাজশাহী: { district: 'Rajshahi' },
  rajshahi: { district: 'Rajshahi' },
  খুলনা: { district: 'Khulna' },
  khulna: { district: 'Khulna' },
  বরিশাল: { district: 'Barishal' },
  barisal: { district: 'Barishal' },
  barishal: { district: 'Barishal' },
  রংপুর: { district: 'Rangpur' },
  rangpur: { district: 'Rangpur' },
  ময়মনসিংহ: { district: 'Mymensingh' },
  ময়মনসিংহ: { district: 'Mymensingh' },
  mymensingh: { district: 'Mymensingh' },
  কুমিল্লা: { district: 'Cumilla' },
  comilla: { district: 'Cumilla' },
  cumilla: { district: 'Cumilla' },
  বগুড়া: { district: 'Bogura' },
  বগুড়া: { district: 'Bogura' },
  bogra: { district: 'Bogura' },
  bogura: { district: 'Bogura' },
  পাবনা: { district: 'Pabna' },
  pabna: { district: 'Pabna' },
  সিরাজগঞ্জ: { district: 'Sirajganj' },
  sirajganj: { district: 'Sirajganj' },
  যশোর: { district: 'Jashore' },
  jessore: { district: 'Jashore' },
  jashore: { district: 'Jashore' },
  কক্সবাজার: { district: 'Cox’s Bazar' },
  "cox's bazar": { district: 'Cox’s Bazar' },
  'cox’s bazar': { district: 'Cox’s Bazar' },
  coxsbazar: { district: 'Cox’s Bazar' },
  টাঙ্গাইল: { district: 'Tangail' },
  tangail: { district: 'Tangail' },
  ফরিদপুর: { district: 'Faridpur' },
  faridpur: { district: 'Faridpur' },
  দিনাজপুর: { district: 'Dinajpur' },
  dinajpur: { district: 'Dinajpur' },
  নোয়াখালী: { district: 'Noakhali' },
  নোয়াখালী: { district: 'Noakhali' },
  noakhali: { district: 'Noakhali' },
  ফেনী: { district: 'Feni' },
  feni: { district: 'Feni' },
  কুষ্টিয়া: { district: 'Kushtia' },
  কুষ্টিয়া: { district: 'Kushtia' },
  kushtia: { district: 'Kushtia' },
  ব্রাহ্মণবাড়িয়া: { district: 'Brahmanbaria' },
  ব্রাহ্মণবাড়িয়া: { district: 'Brahmanbaria' },
  brahmanbaria: { district: 'Brahmanbaria' },
  bagerhat: { district: 'Bagerhat' },
  বাগেরহাট: { district: 'Bagerhat' },
  bandarban: { district: 'Bandarban' },
  বান্দরবান: { district: 'Bandarban' },
  barguna: { district: 'Barguna' },
  বরগুনা: { district: 'Barguna' },
  bhola: { district: 'Bhola' },
  ভোলা: { district: 'Bhola' },
  chandpur: { district: 'Chandpur' },
  চাঁদপুর: { district: 'Chandpur' },
  chapainawabganj: { district: 'Chapainawabganj' },
  chapai: { district: 'Chapainawabganj' },
  চাঁপাইনবাবগঞ্জ: { district: 'Chapainawabganj' },
  chuadanga: { district: 'Chuadanga' },
  চুয়াডাঙ্গা: { district: 'Chuadanga' },
  gaibandha: { district: 'Gaibandha' },
  গাইবান্ধা: { district: 'Gaibandha' },
  gopalganj: { district: 'Gopalganj' },
  গোপালগঞ্জ: { district: 'Gopalganj' },
  habiganj: { district: 'Habiganj' },
  হবিগঞ্জ: { district: 'Habiganj' },
  jamalpur: { district: 'Jamalpur' },
  জামালপুর: { district: 'Jamalpur' },
  jhalokati: { district: 'Jhalokati' },
  jhalakathi: { district: 'Jhalokati' },
  ঝালকাঠি: { district: 'Jhalokati' },
  jhenaidah: { district: 'Jhenaidah' },
  ঝিনাইদহ: { district: 'Jhenaidah' },
  joypurhat: { district: 'Joypurhat' },
  জয়পুরহাট: { district: 'Joypurhat' },
  khagrachhari: { district: 'Khagrachhari' },
  khagrachari: { district: 'Khagrachhari' },
  খাগড়াছড়ি: { district: 'Khagrachhari' },
  kishoreganj: { district: 'Kishoreganj' },
  কিশোরগঞ্জ: { district: 'Kishoreganj' },
  kurigram: { district: 'Kurigram' },
  কুড়িগ্রাম: { district: 'Kurigram' },
  lakshmipur: { district: 'Lakshmipur' },
  laxmipur: { district: 'Lakshmipur' },
  লক্ষ্মীপুর: { district: 'Lakshmipur' },
  lalmonirhat: { district: 'Lalmonirhat' },
  লালমনিরহাট: { district: 'Lalmonirhat' },
  madaripur: { district: 'Madaripur' },
  মাদারীপুর: { district: 'Madaripur' },
  magura: { district: 'Magura' },
  মাগুরা: { district: 'Magura' },
  meherpur: { district: 'Meherpur' },
  মেহেরপুর: { district: 'Meherpur' },
  moulvibazar: { district: 'Moulvibazar' },
  মৌলভীবাজার: { district: 'Moulvibazar' },
  naogaon: { district: 'Naogaon' },
  নওগাঁ: { district: 'Naogaon' },
  narail: { district: 'Narail' },
  নড়াইল: { district: 'Narail' },
  natore: { district: 'Natore' },
  নাটোর: { district: 'Natore' },
  netrokona: { district: 'Netrokona' },
  নেত্রকোণা: { district: 'Netrokona' },
  nilphamari: { district: 'Nilphamari' },
  নীলফামারী: { district: 'Nilphamari' },
  panchagarh: { district: 'Panchagarh' },
  পঞ্চগড়: { district: 'Panchagarh' },
  patuakhali: { district: 'Patuakhali' },
  পটুয়াখালী: { district: 'Patuakhali' },
  pirojpur: { district: 'Pirojpur' },
  পিরোজপুর: { district: 'Pirojpur' },
  rajbari: { district: 'Rajbari' },
  রাজবাড়ী: { district: 'Rajbari' },
  rangamati: { district: 'Rangamati' },
  রাঙ্গামাটি: { district: 'Rangamati' },
  satkhira: { district: 'Satkhira' },
  সাতক্ষীরা: { district: 'Satkhira' },
  shariatpur: { district: 'Shariatpur' },
  শরীয়তপুর: { district: 'Shariatpur' },
  sherpur: { district: 'Sherpur' },
  শেরপুর: { district: 'Sherpur' },
  sunamganj: { district: 'Sunamganj' },
  সুনামগঞ্জ: { district: 'Sunamganj' },
  thakurgaon: { district: 'Thakurgaon' },
  ঠাকুরগাঁও: { district: 'Thakurgaon' },
};

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export class OrderTokenSecretError extends Error {
  readonly code = 'order_secret_missing';
  constructor(message = 'ORDER_TOKEN_SECRET is missing or shorter than 32 characters.') {
    super(message);
    this.name = 'OrderTokenSecretError';
  }
}

const globalDevSecretHolder = globalThis as unknown as {
  __deshiGeeDevOrderSecret?: string;
  __deshiGeeDevOrderSecretWarned?: boolean;
};

export function resetDevOrderTokenSecretForTests(): void {
  if (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') {
    delete globalDevSecretHolder.__deshiGeeDevOrderSecret;
    delete globalDevSecretHolder.__deshiGeeDevOrderSecretWarned;
  }
}

function resolveOrderTokenSecretKey():
  | { ok: true; key: Buffer; mode: 'configured' | 'ephemeral_dev' }
  | { ok: false; errorCode: 'order_secret_missing' } {
  const configured = (process.env.ORDER_TOKEN_SECRET || '').trim();
  if (configured.length >= 32) {
    return {
      ok: true,
      key: createHash('sha256').update(`deshi-gee-order-v2:${configured}`).digest(),
      mode: 'configured',
    };
  }

  if (process.env.NODE_ENV === 'production') {
    return { ok: false, errorCode: 'order_secret_missing' };
  }

  if (!globalDevSecretHolder.__deshiGeeDevOrderSecret) {
    globalDevSecretHolder.__deshiGeeDevOrderSecret = randomBytes(32).toString('hex');
    if (!globalDevSecretHolder.__deshiGeeDevOrderSecretWarned) {
      globalDevSecretHolder.__deshiGeeDevOrderSecretWarned = true;
      console.warn(
        '[ORDER_TOKEN_SECRET] Dedicated ORDER_TOKEN_SECRET (32+ chars) not set; using ephemeral in-memory dev secret. Production fails closed.'
      );
    }
  }

  return {
    ok: true,
    key: createHash('sha256')
      .update(`deshi-gee-order-dev:${globalDevSecretHolder.__deshiGeeDevOrderSecret}`)
      .digest(),
    mode: 'ephemeral_dev',
  };
}

function getTokenSecretKey(): Buffer {
  const resolved = resolveOrderTokenSecretKey();
  if (!resolved.ok) {
    throw new OrderTokenSecretError();
  }
  return resolved.key;
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
  deliveryZoneInput?: string,
  areaOrAddressInput?: string
): {
  valid: boolean;
  canonicalDistrict: string;
  deliveryZone: DeliveryZone;
  matchedBy?: 'exact' | 'alias' | 'fuzzy';
  needsClarification?: boolean;
  suggestedDistrict?: string;
} {
  const clean = convertBanglaDigitsToEnglish(districtInput || '')
    .replace(/['’`]/g, "'")
    .trim();
  if (!clean || clean.length < 2) {
    return {
      valid: false,
      canonicalDistrict: '',
      deliveryZone: 'nationwide',
      needsClarification: false,
    };
  }
  const lower = clean.toLowerCase();
  const areaLower = convertBanglaDigitsToEnglish(areaOrAddressInput || '').toLowerCase();

  let canonical = '';
  let suburbanFromAlias = false;
  let matchedBy: 'exact' | 'alias' | 'fuzzy' = 'exact';

  const aliasHit = DISTRICT_ALIASES[lower];
  if (aliasHit) {
    canonical = aliasHit.district;
    suburbanFromAlias = Boolean(aliasHit.suburbanArea);
    matchedBy = canonical.toLowerCase() === lower ? 'exact' : 'alias';
  }

  if (!canonical) {
    const directMatch = ALL_BD_DISTRICTS.find(
      (d) =>
        d.toLowerCase().replace(/’/g, "'") === lower ||
        lower.includes(d.toLowerCase().replace(/’/g, "'"))
    );
    if (directMatch) {
      canonical = directMatch;
      matchedBy = 'exact';
    }
  }

  // Case #60: Fuzzy Levenshtein (<= 2 edits) for typos like "Daka", "Chitagong", "Shylet"
  // MUST ask for confirmation ("Did you mean Chattogram?") instead of silently accepting/pricing.
  let suggestedDistrict: string | undefined;
  if (!canonical && /^[a-z'\s-]+$/.test(lower)) {
    let bestDist = 99;
    let bestDistrict = '';
    const candidates: Array<{ key: string; target: string }> = [
      ...ALL_BD_DISTRICTS.map((d) => ({ key: d.toLowerCase().replace(/’/g, "'"), target: d })),
      { key: 'chittagong', target: 'Chattogram' },
      { key: 'comilla', target: 'Cumilla' },
      { key: 'jessore', target: 'Jashore' },
      { key: 'bogra', target: 'Bogura' },
      { key: 'barisal', target: 'Barishal' },
      { key: 'savar', target: 'Dhaka' },
      { key: 'syhlet', target: 'Sylhet' },
      { key: 'shylet', target: 'Sylhet' },
    ];
    for (const c of candidates) {
      const dist = levenshteinDistance(lower, c.key);
      if (dist < bestDist) {
        bestDist = dist;
        bestDistrict = c.target;
      }
    }
    const maxAllowed = lower.length <= 5 ? 1 : 2;
    if (bestDistrict && bestDist <= maxAllowed) {
      suggestedDistrict = bestDistrict;
      return {
        valid: false,
        canonicalDistrict: '',
        deliveryZone: 'nationwide',
        matchedBy: 'fuzzy',
        needsClarification: true,
        suggestedDistrict,
      };
    }
  }

  if (!canonical) {
    return {
      valid: false,
      canonicalDistrict: '',
      deliveryZone: 'nationwide',
      needsClarification: false,
    };
  }

  const areaSaysSuburb = DHAKA_SUBURBAN_AREA_KEYWORDS.some((kw) => areaLower.includes(kw));
  const zoneHint = String(deliveryZoneInput || '').toLowerCase() as DeliveryZone | '';

  let deliveryZone: DeliveryZone;
  if (REMOTE_DISTRICTS.has(canonical)) {
    deliveryZone = 'remote';
  } else if (
    suburbanFromAlias ||
    areaSaysSuburb ||
    DHAKA_SUBURBAN_DISTRICTS.has(canonical) ||
    zoneHint === 'suburban'
  ) {
    deliveryZone = 'suburban';
  } else if (canonical === 'Dhaka') {
    deliveryZone = 'dhaka';
  } else if (zoneHint === 'remote') {
    deliveryZone = 'remote';
  } else {
    deliveryZone = 'nationwide';
  }

  return {
    valid: true,
    canonicalDistrict: canonical,
    deliveryZone,
    matchedBy,
  };
}

export function assessAddressCompleteness(
  address: string,
  area = '',
  district = ''
): {
  complete: boolean;
  reason?: string;
  suggestionEn?: string;
  suggestionBn?: string;
} {
  const clean = convertBanglaDigitsToEnglish(address || '').trim();
  const cleanArea = convertBanglaDigitsToEnglish(area || '').trim().toLowerCase();
  const cleanDist = convertBanglaDigitsToEnglish(district || '').trim().toLowerCase();

  if (clean.length < 8) {
    return {
      complete: false,
      reason: 'too_short',
      suggestionEn: 'Please include your house/holding number, road/lane, or village & thana details so the courier can deliver smoothly.',
      suggestionBn: 'কুরিয়ার যেন সহজে ডেলিভারি করতে পারে সেজন্য বাসা/হোল্ডিং নম্বর, রোড বা গ্রাম ও থানার নাম বিস্তারিত লিখুন।',
    };
  }

  const lower = clean.toLowerCase();
  const stripped = lower.replace(/[,.\s-]+/g, '');
  if (
    stripped === cleanDist.replace(/[,.\s-]+/g, '') ||
    stripped === cleanArea.replace(/[,.\s-]+/g, '') ||
    /^(dhaka|mirpur|uttara|savar|gazipur|chattogram|sylhet|pabna|home|office|address|test|na|n\/a|none)$/i.test(clean)
  ) {
    return {
      complete: false,
      reason: 'generic_placeholder',
      suggestionEn: 'Just an area or district name is not enough for courier delivery. Please share House/Road/Block or Village/Upazila details.',
      suggestionBn: 'শুধু জেলার বা এলাকার নাম দিলে কুরিয়ার পৌঁছাতে পারবে না। অনুগ্রহ করে বাসা/রোড নম্বর বা গ্রাম/থানার বিস্তারিত ঠিকানা দিন।',
    };
  }

  const hasDigit = /\d/.test(clean);
  const hasAddressCue =
    /(house|holding|road|rd|street|st|lane|avenue|block|sec|sector|flat|floor|bazar|para|gram|village|union|upazila|thana|tower|plaza|bus stand|basstand|বাসা|বাড়ি|বাড়ি|হোল্ডিং|রোড|রাস্তা|লেন|ব্লক|সেক্টর|ফ্ল্যাট|তলা|গ্রাম|পাড়া|পাড়া|বাজার|থানা|উপজেলা|ইউনিয়ন)/i.test(
      clean
    );

  if (!hasDigit && !hasAddressCue && clean.length < 18) {
    return {
      complete: false,
      reason: 'missing_landmark_or_number',
      suggestionEn: 'Could you add a house/road number or nearby landmark (e.g., House 12, Road 4 or local Bazar/Village) for accurate courier drop-off?',
      suggestionBn: 'সঠিক ডেলিভারির জন্য অনুগ্রহ করে বাসা/রোড নম্বর অথবা কাছের পরিচিত কোনো ল্যান্ডমার্ক (যেমন বাসা ১২, রোড ৪ বা বাজার/গ্রাম) যোগ করুন।',
    };
  }

  return { complete: true };
}

export function normalizeVariantQuantities(params: {
  weight?: WeightKey;
  qty?: number;
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  maxTotalQty?: number;
}): {
  qty250g: number;
  qty500g: number;
  qty1kg: number;
  totalQty: number;
  primaryWeight: WeightKey;
  itemsSummary: string;
} {
  const maxCap = Math.max(1, params.maxTotalQty || CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER);
  let q250 = Math.max(0, Math.round(Number(params.qty250g || 0)));
  let q500 = Math.max(0, Math.round(Number(params.qty500g || 0)));
  let q1k = Math.max(0, Math.round(Number(params.qty1kg || 0)));

  if (q250 + q500 + q1k === 0) {
    const w: WeightKey = params.weight === '250g' || params.weight === '1kg' ? params.weight : '500g';
    const q = Math.max(1, Math.min(maxCap, Math.round(Number(params.qty || 1))));
    if (w === '250g') q250 = q;
    else if (w === '1kg') q1k = q;
    else q500 = q;
  }

  // Enforce cap while preserving proportions
  let totalQty = q250 + q500 + q1k;
  if (totalQty > maxCap) {
    let remaining = maxCap;
    const take1k = Math.min(q1k, remaining);
    remaining -= take1k;
    const take500 = Math.min(q500, remaining);
    remaining -= take500;
    const take250 = Math.min(q250, remaining);
    q1k = take1k;
    q500 = take500;
    q250 = take250;
    totalQty = q250 + q500 + q1k;
  }

  const parts: string[] = [];
  if (q250 > 0) parts.push(`${q250}x 250g`);
  if (q500 > 0) parts.push(`${q500}x 500g`);
  if (q1k > 0) parts.push(`${q1k}x 1kg`);

  const primaryWeight: WeightKey = q500 > 0 ? '500g' : q1k > 0 ? '1kg' : '250g';
  return {
    qty250g: q250,
    qty500g: q500,
    qty1kg: q1k,
    totalQty: Math.max(1, totalQty),
    primaryWeight,
    itemsSummary: parts.join(', ') || `1x ${primaryWeight}`,
  };
}

export type CouponEligibilityReason =
  | 'applied'
  | 'none'
  | 'not_found'
  | 'inactive'
  | 'expired'
  | 'usage_limit_reached'
  | 'below_min_subtotal';

export function evaluateCouponEligibility(
  coupon: CouponRecord | null,
  subtotalBdt: number,
  paymentMethod: PaymentMethod,
  todayIso = new Date().toISOString().slice(0, 10)
): {
  valid: boolean;
  reason: CouponEligibilityReason;
  discountPct: number;
  stackableWithAdvance: boolean;
  messageEn: string;
  messageBn: string;
} {
  if (!coupon) {
    return {
      valid: false,
      reason: 'not_found',
      discountPct: 0,
      stackableWithAdvance: true,
      messageEn: 'Coupon code not found.',
      messageBn: 'প্রদত্ত কুপন কোডটি পাওয়া যায়নি।',
    };
  }
  if (!coupon.active) {
    return {
      valid: false,
      reason: 'inactive',
      discountPct: 0,
      stackableWithAdvance: coupon.stackableWithAdvance ?? true,
      messageEn: `Coupon ${coupon.code} is currently inactive.`,
      messageBn: `কুপন ${coupon.code} বর্তমানে নিষ্ক্রিয় রয়েছে।`,
    };
  }
  if (coupon.expiresAt && coupon.expiresAt < todayIso) {
    return {
      valid: false,
      reason: 'expired',
      discountPct: 0,
      stackableWithAdvance: coupon.stackableWithAdvance ?? true,
      messageEn: `Coupon ${coupon.code} expired on ${coupon.expiresAt}.`,
      messageBn: `কুপন ${coupon.code}-এর মেয়াদ ${coupon.expiresAt} তারিখে শেষ হয়েছে।`,
    };
  }
  if (
    typeof coupon.maxUses === 'number' &&
    coupon.maxUses > 0 &&
    Number(coupon.usedCount || 0) >= coupon.maxUses
  ) {
    return {
      valid: false,
      reason: 'usage_limit_reached',
      discountPct: 0,
      stackableWithAdvance: coupon.stackableWithAdvance ?? true,
      messageEn: `Coupon ${coupon.code} has reached its maximum usage limit.`,
      messageBn: `কুপন ${coupon.code}-এর ব্যবহারের সর্বোচ্চ সীমা পূর্ণ হয়েছে।`,
    };
  }
  if (subtotalBdt < Number(coupon.minSubtotalBdt || 0)) {
    return {
      valid: false,
      reason: 'below_min_subtotal',
      discountPct: 0,
      stackableWithAdvance: coupon.stackableWithAdvance ?? true,
      messageEn: `Coupon ${coupon.code} requires a minimum subtotal of ৳${Math.round(coupon.minSubtotalBdt)}.`,
      messageBn: `কুপন ${coupon.code} ব্যবহার করতে সর্বনিম্ন ৳${Math.round(coupon.minSubtotalBdt)}-এর অর্ডার প্রয়োজন।`,
    };
  }

  const stackableWithAdvance = coupon.stackableWithAdvance !== false;
  const pct = Math.min(40, Math.max(0, Math.round(coupon.discountPct)));
  return {
    valid: true,
    reason: 'applied',
    discountPct: pct,
    stackableWithAdvance,
    messageEn:
      paymentMethod !== 'cod' && !stackableWithAdvance
        ? `Coupon ${coupon.code} (${pct}% off) applied (replaces advance payment discount).`
        : `Coupon ${coupon.code} (${pct}% off) applied.`,
    messageBn: `কুপন ${coupon.code} (${pct}% ছাড়) সফলভাবে প্রয়োগ হয়েছে।`,
  };
}

export function resolveZoneDeliveryFeeAndEta(
  settings: StoreSettingsDoc,
  deliveryZone: DeliveryZone
): { feeBdt: number; etaText: string } {
  if (deliveryZone === 'dhaka') {
    return {
      feeBdt: Math.max(0, Math.round(Number(settings.insideDhakaFee) || 0)),
      etaText: (settings.estimatedDhakaDays || '').trim(),
    };
  }
  if (deliveryZone === 'suburban') {
    return {
      feeBdt: Math.max(0, Math.round(Number(settings.dhakaSuburbanFee) || 0)),
      etaText: (settings.estimatedSuburbanDays || '').trim(),
    };
  }
  if (deliveryZone === 'remote') {
    return {
      feeBdt: Math.max(0, Math.round(Number(settings.remoteDistrictFee) || 0)),
      etaText: (settings.estimatedRemoteDays || '').trim(),
    };
  }
  return {
    feeBdt: Math.max(0, Math.round(Number(settings.outsideDhakaFee) || 0)),
    etaText: (settings.estimatedOutsideDays || '').trim(),
  };
}

export function computeOrderPricingInPoisha(params: {
  settings: StoreSettingsDoc;
  weight?: WeightKey;
  qty?: number;
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  deliveryZone: DeliveryZone;
  paymentMethod: PaymentMethod;
  coupon: CouponRecord | null;
  maxTotalQty?: number;
  todayIso?: string;
}): {
  primaryWeight: WeightKey;
  totalQty: number;
  qty250g: number;
  qty500g: number;
  qty1kg: number;
  itemsSummary: string;
  variantBreakdown: VariantLineItem[];
  unitPriceBdt: number;
  subtotalBdt: number;
  deliveryFeeBdt: number;
  discountBdt: number;
  totalBdt: number;
  freeDeliveryApplied: boolean;
  availableStock: number;
  stockSufficient: boolean;
  insufficientWeights: WeightKey[];
  estimatedDelivery: string;
  couponEvaluation: ReturnType<typeof evaluateCouponEligibility> | null;
} {
  const { settings, deliveryZone, paymentMethod, coupon } = params;
  const norm = normalizeVariantQuantities({
    weight: params.weight,
    qty: params.qty,
    qty250g: params.qty250g,
    qty500g: params.qty500g,
    qty1kg: params.qty1kg,
    maxTotalQty: params.maxTotalQty,
  });

  const p250 = Math.round(settings.price250g);
  const p500 = Math.round(settings.price500g);
  const p1k = Math.round(settings.price1kg);

  const variantBreakdown: VariantLineItem[] = [];
  if (norm.qty250g > 0) {
    variantBreakdown.push({
      weight: '250g',
      qty: norm.qty250g,
      unitPriceBdt: p250,
      lineSubtotalBdt: norm.qty250g * p250,
    });
  }
  if (norm.qty500g > 0) {
    variantBreakdown.push({
      weight: '500g',
      qty: norm.qty500g,
      unitPriceBdt: p500,
      lineSubtotalBdt: norm.qty500g * p500,
    });
  }
  if (norm.qty1kg > 0) {
    variantBreakdown.push({
      weight: '1kg',
      qty: norm.qty1kg,
      unitPriceBdt: p1k,
      lineSubtotalBdt: norm.qty1kg * p1k,
    });
  }

  // Primary unit price must match primaryWeight so Firestore canonical price checks match cleanly
  const unitPriceBdt =
    norm.primaryWeight === '250g' ? p250 : norm.primaryWeight === '1kg' ? p1k : p500;

  const subtotalPoisha =
    (norm.qty250g * p250 + norm.qty500g * p500 + norm.qty1kg * p1k) * 100;
  const subtotalBdt = Math.round(subtotalPoisha / 100);

  const insufficientWeights: WeightKey[] = [];
  if (norm.qty250g > Math.round(settings.stock250g)) insufficientWeights.push('250g');
  if (norm.qty500g > Math.round(settings.stock500g)) insufficientWeights.push('500g');
  if (norm.qty1kg > Math.round(settings.stock1kg)) insufficientWeights.push('1kg');

  const availableStock =
    norm.primaryWeight === '250g'
      ? Math.round(settings.stock250g)
      : norm.primaryWeight === '1kg'
        ? Math.round(settings.stock1kg)
        : Math.round(settings.stock500g);

  const zoneInfo = resolveZoneDeliveryFeeAndEta(settings, deliveryZone);
  const freeThreshold = Math.round(Number(settings.freeDeliveryThreshold) || 0);
  const freeDeliveryApplied = freeThreshold > 0 && subtotalBdt >= freeThreshold;
  const deliveryFeeBdt = freeDeliveryApplied ? 0 : zoneInfo.feeBdt;
  const deliveryPoisha = deliveryFeeBdt * 100;

  const couponEval = coupon
    ? evaluateCouponEligibility(coupon, subtotalBdt, paymentMethod, params.todayIso)
    : null;
  const couponPct = couponEval?.valid ? couponEval.discountPct : 0;

  const allowAdvanceStack = couponEval?.valid ? couponEval.stackableWithAdvance : true;
  const advancePct =
    paymentMethod !== 'cod' && settings.advanceDiscountPct > 0 && allowAdvanceStack
      ? Math.min(25, Math.max(0, Math.round(settings.advanceDiscountPct)))
      : 0;

  const totalPct = Math.min(50, couponPct + advancePct);
  const discountPoisha = Math.round((subtotalPoisha * totalPct) / 100);
  const totalPoisha = Math.max(100, subtotalPoisha - discountPoisha + deliveryPoisha);

  return {
    primaryWeight: norm.primaryWeight,
    totalQty: norm.totalQty,
    qty250g: norm.qty250g,
    qty500g: norm.qty500g,
    qty1kg: norm.qty1kg,
    itemsSummary: norm.itemsSummary,
    variantBreakdown,
    unitPriceBdt,
    subtotalBdt,
    deliveryFeeBdt,
    discountBdt: Math.round(discountPoisha / 100),
    totalBdt: Math.round(totalPoisha / 100),
    freeDeliveryApplied,
    availableStock,
    stockSufficient: insufficientWeights.length === 0,
    insufficientWeights,
    estimatedDelivery: zoneInfo.etaText,
    couponEvaluation: couponEval,
  };
}

export function buildOrderPreviewHash(
  sessionId: string,
  draft: OrderDraftInput & {
    qty250g?: number;
    qty500g?: number;
    qty1kg?: number;
    unitPriceBdt: number;
    subtotalBdt: number;
    deliveryFeeBdt: number;
    discountBdt: number;
    totalBdt: number;
  }
): string {
  const norm = normalizeVariantQuantities({
    weight: draft.weight,
    qty: draft.qty,
    qty250g: draft.qty250g,
    qty500g: draft.qty500g,
    qty1kg: draft.qty1kg,
  });
  const canonical = JSON.stringify({
    sessionId,
    qty250g: norm.qty250g,
    qty500g: norm.qty500g,
    qty1kg: norm.qty1kg,
    subtotalBdt: draft.subtotalBdt,
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
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  totalBdt: number;
  deliveryArea: string;
}): string {
  const norm = normalizeVariantQuantities({
    weight: params.weight,
    qty: params.qty,
    qty250g: params.qty250g,
    qty500g: params.qty500g,
    qty1kg: params.qty1kg,
  });
  const canonical = `${params.sessionId}|${params.phone}|250:${norm.qty250g},500:${norm.qty500g},1k:${norm.qty1kg}|${params.totalBdt}|${params.deliveryArea.toLowerCase()}`;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 40);
}

export function buildDuplicateFingerprintHash(params: {
  phone: string;
  district: string;
  address: string;
  qty250g: number;
  qty500g: number;
  qty1kg: number;
}): string {
  const cleanPhone = normalizeBangladeshPhone(params.phone);
  const cleanAddress = convertBanglaDigitsToEnglish(params.address || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const cleanDist = (params.district || '').toLowerCase().trim();
  const canonical = `${cleanPhone}|${cleanDist}|${cleanAddress}|${params.qty250g},${params.qty500g},${params.qty1kg}`;
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export function getDispatchWindowInfo(settings: StoreSettingsDoc, now = new Date()): {
  beforeCutoff: boolean;
  cutoffHourBst: number;
  currentBstHour: number;
  noticeEn: string;
  noticeBn: string;
} {
  const rawCutoff = Number(settings.dispatchCutoffHourBst || 0);
  const bstHour = (now.getUTCHours() + 6) % 24;
  const customNoticeEn = (settings.cutoffNoticeEn || '').trim();
  const customNoticeBn = (settings.cutoffNoticeBn || '').trim();

  if (!Number.isFinite(rawCutoff) || rawCutoff <= 0) {
    return {
      beforeCutoff: true,
      cutoffHourBst: 0,
      currentBstHour: bstHour,
      noticeEn: customNoticeEn,
      noticeBn: customNoticeBn,
    };
  }

  const cutoff = Math.max(1, Math.min(23, Math.round(rawCutoff)));
  const beforeCutoff = bstHour < cutoff;

  const noticeEn = beforeCutoff
    ? customNoticeEn || `Orders confirmed before ${cutoff}:00 BST dispatch same day.`
    : `Confirmed after ${cutoff}:00 BST cutoff — queued for next business morning dispatch.`;

  const noticeBn = beforeCutoff
    ? customNoticeBn || `দুপুর ${cutoff}:00 (BST)-এর আগে কনফার্ম হলে আজই ডিসপ্যাচ করা হবে।`
    : `${cutoff}:00 (BST) কাট-অফের পরের অর্ডার পরবর্তী কর্মদিবস সকালে ডিসপ্যাচ হবে।`;

  return {
    beforeCutoff,
    cutoffHourBst: cutoff,
    currentBstHour: bstHour,
    noticeEn,
    noticeBn,
  };
}

export function assessOrderRiskSignals(params: {
  phone: string;
  addressComplete: boolean;
  duplicateRecentCount: number;
  recentOrdersLastHour: number;
  paymentMethod: PaymentMethod;
  totalBdt: number;
  codHighValueThresholdBdt?: number;
  codRiskThresholdScore?: number;
}): {
  riskScore: number;
  riskSignals: string[];
  reviewStatus: OrderRiskReviewStatus;
  noticeEn?: string;
  noticeBn?: string;
} {
  const cleanPhone = normalizeBangladeshPhone(params.phone);
  const signals: string[] = [];
  let score = 0;

  // Synthetic repeating digits check (e.g., 01700000000 or 01711111111)
  if (/^01\d(\d)\1{7}$/.test(cleanPhone) || /(\d)\1{5,}/.test(cleanPhone)) {
    signals.push('synthetic_phone_pattern');
    score += 35;
  }

  if (!params.addressComplete) {
    signals.push('incomplete_address');
    score += 20;
  }

  if (params.duplicateRecentCount > 0) {
    signals.push('recent_duplicate_fingerprint');
    score += 30;
  }

  if (params.recentOrdersLastHour >= 2) {
    signals.push('high_hourly_velocity');
    score += 25;
  }

  const rawCodLimit = Number(params.codHighValueThresholdBdt ?? 0);
  if (params.paymentMethod === 'cod' && rawCodLimit > 0 && params.totalBdt >= Math.round(rawCodLimit)) {
    signals.push('high_value_cod');
    score += 25;
  }

  const riskThreshold = Math.max(20, Math.min(95, Math.round(params.codRiskThresholdScore ?? 45)));
  const reviewStatus: OrderRiskReviewStatus = score >= riskThreshold ? 'manual_review' : 'none';
  if (reviewStatus === 'manual_review') {
    return {
      riskScore: Math.min(100, score),
      riskSignals: signals,
      reviewStatus,
      noticeEn:
        'Your order has been received and flagged for quick team verification before dispatch.',
      noticeBn:
        'আপনার অর্ডারটি গৃহীত হয়েছে; ডিসপ্যাচের আগে আমাদের টিম দ্রুত ফোন বা তথ্যের সত্যতা যাচাই করে নেবে।',
    };
  }

  return {
    riskScore: Math.min(100, score),
    riskSignals: signals,
    reviewStatus: 'none',
  };
}

export interface CodVerificationProvider {
  readonly providerConfigured: boolean;
  readonly providerName: string;
  initiateVerification(params: {
    orderNumber: string;
    phone: string;
  }): Promise<{
    ok: boolean;
    status: 'not_configured' | 'pending' | 'verified';
    messageEn: string;
    messageBn: string;
  }>;
  confirmVerificationCode(params: {
    orderNumber: string;
    phone: string;
    code: string;
  }): Promise<{
    ok: boolean;
    status: 'not_configured' | 'verified' | 'rejected';
    messageEn: string;
    messageBn: string;
  }>;
}

export class UnconfiguredCodVerificationProvider implements CodVerificationProvider {
  readonly providerConfigured = false;
  readonly providerName = 'Not configured';

  async initiateVerification(): Promise<{
    ok: boolean;
    status: 'not_configured';
    messageEn: string;
    messageBn: string;
  }> {
    return {
      ok: false,
      status: 'not_configured',
      messageEn: 'Automated COD verification SMS/call provider is Not configured. Manual team verification applies.',
      messageBn: 'অটোমেটেড COD ভেরিফিকেশন SMS/কল প্রোভাইডার সেটআপ করা নেই (Not configured)। টিম ম্যানুয়ালি যাচাই করবে।',
    };
  }

  async confirmVerificationCode(): Promise<{
    ok: boolean;
    status: 'not_configured';
    messageEn: string;
    messageBn: string;
  }> {
    return {
      ok: false,
      status: 'not_configured',
      messageEn: 'Automated COD verification provider is Not configured.',
      messageBn: 'অটোমেটেড COD ভেরিফিকেশন প্রোভাইডার সেটআপ করা নেই।',
    };
  }
}

export function getCodVerificationProvider(): CodVerificationProvider {
  return new UnconfiguredCodVerificationProvider();
}

export function tryCreateSignedOrderToken(params: {
  sessionId: string;
  draft: OrderDraftInput;
  pricing: {
    qty250g?: number;
    qty500g?: number;
    qty1kg?: number;
    itemsSummary?: string;
    unitPriceBdt: number;
    subtotalBdt: number;
    deliveryFeeBdt: number;
    discountBdt: number;
    totalBdt: number;
  };
}):
  | { ok: true; token: string; payload: SignedOrderTokenPayload }
  | { ok: false; errorCode: 'order_secret_missing'; message: string } {
  const resolvedKey = resolveOrderTokenSecretKey();
  if (!resolvedKey.ok) {
    return {
      ok: false,
      errorCode: 'order_secret_missing',
      message: 'ORDER_TOKEN_SECRET is required in production to sign order tokens.',
    };
  }

  const norm = normalizeVariantQuantities({
    weight: params.draft.weight,
    qty: params.draft.qty,
    qty250g: params.pricing.qty250g ?? params.draft.qty250g,
    qty500g: params.pricing.qty500g ?? params.draft.qty500g,
    qty1kg: params.pricing.qty1kg ?? params.draft.qty1kg,
  });

  const now = Date.now();
  const previewHash = buildOrderPreviewHash(params.sessionId, {
    ...params.draft,
    qty250g: norm.qty250g,
    qty500g: norm.qty500g,
    qty1kg: norm.qty1kg,
    unitPriceBdt: params.pricing.unitPriceBdt,
    subtotalBdt: params.pricing.subtotalBdt,
    deliveryFeeBdt: params.pricing.deliveryFeeBdt,
    discountBdt: params.pricing.discountBdt,
    totalBdt: params.pricing.totalBdt,
  });

  const idempotencyKey = buildOrderIdempotencyKey({
    sessionId: params.sessionId,
    phone: params.draft.phone,
    weight: norm.primaryWeight,
    qty: norm.totalQty,
    qty250g: norm.qty250g,
    qty500g: norm.qty500g,
    qty1kg: norm.qty1kg,
    totalBdt: params.pricing.totalBdt,
    deliveryArea: `${params.draft.deliveryZone}:${params.draft.district}:${params.draft.area}`,
  });

  const payload: SignedOrderTokenPayload = {
    tokenId: randomUUID(),
    sessionId: params.sessionId,
    ...params.draft,
    weight: norm.primaryWeight,
    qty: norm.totalQty,
    qty250g: norm.qty250g,
    qty500g: norm.qty500g,
    qty1kg: norm.qty1kg,
    itemsSummary: params.pricing.itemsSummary || norm.itemsSummary,
    unitPriceBdt: params.pricing.unitPriceBdt,
    subtotalBdt: params.pricing.subtotalBdt,
    deliveryFeeBdt: params.pricing.deliveryFeeBdt,
    discountBdt: params.pricing.discountBdt,
    totalBdt: params.pricing.totalBdt,
    previewHash,
    idempotencyKey,
    iat: now,
    exp: now + CHATBOT_BUILD_CONFIG.CONFIRM_TOKEN_TTL_MS,
  };

  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', resolvedKey.key).update(encoded).digest('base64url');
  return { ok: true, token: `${encoded}.${sig}`, payload };
}

export function createSignedOrderToken(params: {
  sessionId: string;
  draft: OrderDraftInput;
  pricing: {
    qty250g?: number;
    qty500g?: number;
    qty1kg?: number;
    itemsSummary?: string;
    unitPriceBdt: number;
    subtotalBdt: number;
    deliveryFeeBdt: number;
    discountBdt: number;
    totalBdt: number;
  };
}): { token: string; payload: SignedOrderTokenPayload } {
  const res = tryCreateSignedOrderToken(params);
  if (!res.ok) {
    throw new OrderTokenSecretError(res.message);
  }
  return { token: res.token, payload: res.payload };
}

export function verifySignedOrderToken(
  token: string
):
  | { ok: true; payload: SignedOrderTokenPayload }
  | { ok: false; reason: 'invalid_token' | 'expired_token' | 'order_secret_missing' } {
  const resolvedKey = resolveOrderTokenSecretKey();
  if (!resolvedKey.ok) {
    return { ok: false, reason: 'order_secret_missing' };
  }

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

// ---------------------------------------------------------------------------
// S0-08: Signed HMAC Speech Token for /api/chat/tts (prevents arbitrary text TTS abuse)
// ---------------------------------------------------------------------------

export interface SignedTtsTokenPayload {
  kind: 'tts_v1';
  sessionId: string;
  textHash: string;
  iat: number;
  exp: number;
}

export function normalizeTextForTtsHash(raw: string): string {
  return String(raw || '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

export function computeTtsTextHash(text: string): string {
  return createHash('sha256').update(normalizeTextForTtsHash(text), 'utf8').digest('hex').slice(0, 32);
}

export function tryCreateSignedTtsToken(params: {
  sessionId: string;
  text: string;
  ttlMs?: number;
}): { ok: true; token: string; expiresAt: number } | { ok: false; errorCode: 'order_secret_missing' } {
  const resolvedKey = resolveOrderTokenSecretKey();
  if (!resolvedKey.ok) {
    return { ok: false, errorCode: 'order_secret_missing' };
  }
  const now = Date.now();
  const ttl = Math.max(60_000, Math.min(2 * 60 * 60_000, params.ttlMs ?? 30 * 60_000));
  const payload: SignedTtsTokenPayload = {
    kind: 'tts_v1',
    sessionId: String(params.sessionId || '').trim().slice(0, 80),
    textHash: computeTtsTextHash(params.text),
    iat: now,
    exp: now + ttl,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', resolvedKey.key).update(`tts:${encoded}`).digest('base64url');
  return { ok: true, token: `${encoded}.${sig}`, expiresAt: payload.exp };
}

export function verifySignedTtsToken(params: {
  token: string;
  text: string;
  sessionId?: string;
}):
  | { ok: true; payload: SignedTtsTokenPayload }
  | {
      ok: false;
      reason: 'invalid_token' | 'expired_token' | 'text_mismatch' | 'session_mismatch' | 'order_secret_missing';
    } {
  const resolvedKey = resolveOrderTokenSecretKey();
  if (!resolvedKey.ok) {
    return { ok: false, reason: 'order_secret_missing' };
  }
  if (!params.token || typeof params.token !== 'string' || !params.token.includes('.')) {
    return { ok: false, reason: 'invalid_token' };
  }
  const parts = params.token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'invalid_token' };
  }
  const [encoded, sig] = parts;
  try {
    const expectedSig = createHmac('sha256', resolvedKey.key)
      .update(`tts:${encoded}`)
      .digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'invalid_token' };
    }
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as SignedTtsTokenPayload;
    if (!parsed || parsed.kind !== 'tts_v1' || !parsed.textHash || !parsed.sessionId) {
      return { ok: false, reason: 'invalid_token' };
    }
    if (Date.now() > Number(parsed.exp || 0)) {
      return { ok: false, reason: 'expired_token' };
    }
    if (params.sessionId && parsed.sessionId !== params.sessionId.trim()) {
      return { ok: false, reason: 'session_mismatch' };
    }
    if (computeTtsTextHash(params.text) !== parsed.textHash) {
      return { ok: false, reason: 'text_mismatch' };
    }
    return { ok: true, payload: parsed };
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }
}

// ---------------------------------------------------------------------------
// Item 5: Signed Single-Use HMAC Action Token for Chat Cancel & Address-Edit Confirm Card
// ---------------------------------------------------------------------------

export interface SignedOrderManageActionPayload {
  kind: 'order_manage_v1';
  tokenId: string;
  sessionId: string;
  action: 'cancel' | 'edit_address';
  orderNumber: string;
  phone: string;
  district?: string;
  area?: string;
  address?: string;
  reason?: string;
  iat: number;
  exp: number;
}

const usedManageActionTokenHolder = globalThis as unknown as {
  __deshiGeeUsedManageActionTokens?: Map<string, number>;
};

function getUsedManageActionTokenMap(): Map<string, number> {
  if (!usedManageActionTokenHolder.__deshiGeeUsedManageActionTokens) {
    usedManageActionTokenHolder.__deshiGeeUsedManageActionTokens = new Map();
  }
  const map = usedManageActionTokenHolder.__deshiGeeUsedManageActionTokens;
  if (map.size > 500) {
    const now = Date.now();
    for (const [k, exp] of map.entries()) {
      if (exp < now) map.delete(k);
    }
  }
  return map;
}

export function resetUsedOrderManageTokensForTests(): void {
  if (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') {
    usedManageActionTokenHolder.__deshiGeeUsedManageActionTokens?.clear();
  }
}

export function tryCreateSignedOrderManageToken(params: {
  sessionId: string;
  action: 'cancel' | 'edit_address';
  orderNumber: string;
  phone: string;
  district?: string;
  area?: string;
  address?: string;
  reason?: string;
  ttlMs?: number;
}):
  | { ok: true; token: string; payload: SignedOrderManageActionPayload }
  | { ok: false; errorCode: 'order_secret_missing' } {
  const resolvedKey = resolveOrderTokenSecretKey();
  if (!resolvedKey.ok) {
    return { ok: false, errorCode: 'order_secret_missing' };
  }
  const now = Date.now();
  const ttl = Math.max(60_000, Math.min(15 * 60_000, params.ttlMs ?? 10 * 60_000));
  const payload: SignedOrderManageActionPayload = {
    kind: 'order_manage_v1',
    tokenId: randomUUID(),
    sessionId: String(params.sessionId || '').trim().slice(0, 80),
    action: params.action,
    orderNumber: String(params.orderNumber || '').trim().toUpperCase(),
    phone: normalizeBangladeshPhone(params.phone),
    ...(params.district ? { district: String(params.district).trim().slice(0, 60) } : {}),
    ...(params.area ? { area: String(params.area).trim().slice(0, 80) } : {}),
    ...(params.address ? { address: String(params.address).trim().slice(0, 220) } : {}),
    ...(params.reason ? { reason: String(params.reason).trim().slice(0, 220) } : {}),
    iat: now,
    exp: now + ttl,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', resolvedKey.key)
    .update(`manage:${encoded}`)
    .digest('base64url');
  return { ok: true, token: `${encoded}.${sig}`, payload };
}

export function verifySignedOrderManageToken(params: {
  token: string;
  sessionId?: string;
}):
  | { ok: true; payload: SignedOrderManageActionPayload }
  | {
      ok: false;
      reason:
        | 'invalid_token'
        | 'expired_token'
        | 'session_mismatch'
        | 'token_already_used'
        | 'order_secret_missing';
    } {
  const resolvedKey = resolveOrderTokenSecretKey();
  if (!resolvedKey.ok) {
    return { ok: false, reason: 'order_secret_missing' };
  }
  if (!params.token || typeof params.token !== 'string' || !params.token.includes('.')) {
    return { ok: false, reason: 'invalid_token' };
  }
  const parts = params.token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'invalid_token' };
  }
  const [encoded, sig] = parts;
  try {
    const expectedSig = createHmac('sha256', resolvedKey.key)
      .update(`manage:${encoded}`)
      .digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'invalid_token' };
    }
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as SignedOrderManageActionPayload;
    if (
      !parsed ||
      parsed.kind !== 'order_manage_v1' ||
      !parsed.tokenId ||
      !parsed.sessionId ||
      !parsed.orderNumber ||
      !parsed.phone ||
      (parsed.action !== 'cancel' && parsed.action !== 'edit_address')
    ) {
      return { ok: false, reason: 'invalid_token' };
    }
    if (Date.now() > Number(parsed.exp || 0)) {
      return { ok: false, reason: 'expired_token' };
    }
    if (params.sessionId && parsed.sessionId !== params.sessionId.trim()) {
      return { ok: false, reason: 'session_mismatch' };
    }
    if (getUsedManageActionTokenMap().has(parsed.tokenId)) {
      return { ok: false, reason: 'token_already_used' };
    }
    return { ok: true, payload: parsed };
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }
}

export function consumeSignedOrderManageToken(payload: SignedOrderManageActionPayload): boolean {
  const map = getUsedManageActionTokenMap();
  if (map.has(payload.tokenId)) {
    return false;
  }
  map.set(payload.tokenId, payload.exp + 60_000);
  return true;
}

