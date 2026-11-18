import type { PaymentMethod, StoreSettingsDoc, WeightKey } from '../storeTypes';
import { CHATBOT_BUILD_CONFIG } from './build-config';
import { convertBanglaDigitsToEnglish, normalizeWeight } from './domain-guard';
import {
  fetchServerOrderDraft,
  fetchServerChatSession,
  upsertServerChatSession,
  upsertServerOrderDraft,
} from './firestoreRest';
import {
  ALL_BD_DISTRICTS,
  assessAddressCompleteness,
  isValidBangladeshPhone,
  normalizeBangladeshPhone,
  normalizeVariantQuantities,
  resolveConfiguredDistrictAndZone,
} from './orderToken';
import type { ChatSessionDoc, OrderDraftDoc, TurnIntent } from './types';

export interface ExtractedOrderSlots {
  weight?: WeightKey;
  qty?: number;
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  customerName?: string;
  phone?: string;
  district?: string;
  area?: string;
  address?: string;
  paymentMethod?: PaymentMethod;
  txnId?: string;
  couponCode?: string;
  note?: string;
  explicitCorrection?: boolean;
  cancelOrderRequested?: boolean;
}

const CORRECTION_TRIGGER_RX =
  /\b(instead|change|actually|update|wrong|edit|make it|switch to|add another)\b|(পরিবর্তন|বদলে|না আসলে|ভুল|এটা না|পাল্টে|চেঞ্জ|সাথে আরও)/i;

const CANCEL_DRAFT_RX =
  /\b(cancel draft|stop order|never mind|forget the order)\b|(অর্ডার বাতিল করতে চাই না|ড্রাফট বাদ|ক্যানসেল করুন না|দরকার নেই)/i;

const TYPED_CONFIRMATION_ONLY_RX =
  /^(yes|yep|yeah|confirm|confirmed|ok|okay|sure|proceed|place order|do it|go ahead|হ্যাঁ|হ্যা|হা|জ্বি|জি|জী|ঠিক আছে|ওকে|কনফার্ম|কনফার্ম করুন|অর্ডার কনফার্ম|অর্ডার করুন|হবে)[\s!.।]*$/i;

export function isTypedConfirmationOnly(rawMessage: string): boolean {
  const clean = convertBanglaDigitsToEnglish(rawMessage || '').trim();
  if (!clean) return false;
  return TYPED_CONFIRMATION_ONLY_RX.test(clean);
}

export function parseVariantQuantitiesFromText(cleanText: string): {
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
} {
  const text = convertBanglaDigitsToEnglish(cleanText || '');
  const out: { qty250g?: number; qty500g?: number; qty1kg?: number } = {};

  // Match patterns like "2 jars 500g", "2x 500g", "500g x2", "1kg 1ta", "১ কেজি ২টা"
  const pairPatterns: Array<{ rx: RegExp; key: 'qty250g' | 'qty500g' | 'qty1kg' }> = [
    {
      key: 'qty250g',
      rx: /(?:([1-9]\d?)\s*(?:x|jars?|pcs|pieces?|bottles?|টি|টা|জার|বোতল)?\s*(?:of\s*)?(?:250\s*g(?:ram|m|ms|s)?|পোয়া|পোয়া|quarter))|(?:(?:250\s*g(?:ram|m|ms|s)?|পোয়া|পোয়া)\s*(?:x|×|[-:])?\s*([1-9]\d?)(?:\s*(?:x|jars?|pcs|টি|টা|জার))?)/gi,
    },
    {
      key: 'qty500g',
      rx: /(?:([1-9]\d?)\s*(?:x|jars?|pcs|pieces?|bottles?|টি|টা|জার|বোতল)?\s*(?:of\s*)?(?:500\s*g(?:ram|m|ms|s)?|আধা\s*কেজি|হাফ\s*কেজি|half\s*kg))|(?:(?:500\s*g(?:ram|m|ms|s)?|আধা\s*কেজি|হাফ\s*কেজি)\s*(?:x|×|[-:])?\s*([1-9]\d?)(?:\s*(?:x|jars?|pcs|টি|টা|জার))?)/gi,
    },
    {
      key: 'qty1kg',
      rx: /(?:([1-9]\d?)\s*(?:x|jars?|pcs|pieces?|bottles?|টি|টা|জার|বোতল)?\s*(?:of\s*)?(?:1\s*kg|1000\s*g(?:m|ram)?|১\s*কেজি|এক\s*কেজি))|(?:(?:1\s*kg|1000\s*g(?:m|ram)?|১\s*কেজি|এক\s*কেজি)\s*(?:x|×|[-:])?\s*([1-9]\d?)(?:\s*(?:x|jars?|pcs|টি|টা|জার))?)/gi,
    },
  ];

  for (const p of pairPatterns) {
    let sum = 0;
    let matchedAny = false;
    for (const m of text.matchAll(p.rx)) {
      const n = Number(m[1] || m[2] || 0);
      if (Number.isInteger(n) && n >= 1 && n <= CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER) {
        sum += n;
        matchedAny = true;
      }
    }
    if (matchedAny && sum >= 1) {
      out[p.key] = Math.min(CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER, sum);
    }
  }

  return out;
}

export function extractOrderSlotsFromText(
  rawMessage: string,
  currentDraft?: OrderDraftDoc | null
): ExtractedOrderSlots {
  const clean = convertBanglaDigitsToEnglish(rawMessage || '').normalize('NFC').trim();
  const lower = clean.toLowerCase();
  const out: ExtractedOrderSlots = {};

  if (!clean) return out;

  if (CANCEL_DRAFT_RX.test(clean)) {
    out.cancelOrderRequested = true;
    return out;
  }

  out.explicitCorrection = CORRECTION_TRIGGER_RX.test(clean);

  // 1. Mixed-variant & single-variant extraction
  const parsedMix = parseVariantQuantitiesFromText(clean);
  if (parsedMix.qty250g !== undefined) out.qty250g = parsedMix.qty250g;
  if (parsedMix.qty500g !== undefined) out.qty500g = parsedMix.qty500g;
  if (parsedMix.qty1kg !== undefined) out.qty1kg = parsedMix.qty1kg;

  const mixCount =
    (parsedMix.qty250g ? 1 : 0) +
    (parsedMix.qty500g ? 1 : 0) +
    (parsedMix.qty1kg ? 1 : 0);

  if (mixCount >= 2) {
    const norm = normalizeVariantQuantities({
      qty250g: out.qty250g || 0,
      qty500g: out.qty500g || 0,
      qty1kg: out.qty1kg || 0,
    });
    out.weight = norm.primaryWeight;
    out.qty = norm.totalQty;
  } else {
    if (/(250|500|1\s*kg|1000|পোয়া|পোয়া|আধা|হাফ|কেজি|poya|poa|adha|half|quarter)/i.test(clean)) {
      const w = normalizeWeight(clean);
      if (w) out.weight = w;
    }

    const qtyMatch =
      clean.match(/(?:^|\s)([1-9]|10)\s*(?:jars?|pcs|pieces?|bottles?)\b/i) ||
      clean.match(/(?:^|\s)([1-9]|10)\s*(?:টি|টা|জার|বোতল)(?=$|[\s,।.!?;:])/) ||
      clean.match(/\bqty\s*[:=]?\s*([1-9]|10)\b/i) ||
      clean.match(/^([1-9]|10)$/);
    if (qtyMatch && qtyMatch[1]) {
      const q = Number(qtyMatch[1]);
      if (Number.isInteger(q) && q >= 1 && q <= CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER) {
        out.qty = q;
      }
    }
    if (mixCount === 1) {
      if (parsedMix.qty250g) {
        out.weight = '250g';
        out.qty = parsedMix.qty250g;
      } else if (parsedMix.qty500g) {
        out.weight = '500g';
        out.qty = parsedMix.qty500g;
      } else if (parsedMix.qty1kg) {
        out.weight = '1kg';
        out.qty = parsedMix.qty1kg;
      }
    }
  }

  // 3. Phone extraction
  const phoneMatch = clean.match(/(?<!\d)(?:\+?88)?(01[3-9](?:[-\s]?\d){8})(?!\d)/);
  if (phoneMatch) {
    const normalized = normalizeBangladeshPhone(phoneMatch[0]);
    if (isValidBangladeshPhone(normalized)) {
      out.phone = normalized;
    }
  }

  // 4. Payment method extraction
  if (/\b(cod|cash on delivery)\b|ক্যাশ অন ডেলিভারি|ক্যাশঅন/i.test(lower)) {
    out.paymentMethod = 'cod';
  } else if (/\bbkash\b|বিকাশ/i.test(lower)) {
    out.paymentMethod = 'bkash';
  } else if (/\bnagad\b|নগদ/i.test(lower)) {
    out.paymentMethod = 'nagad';
  }

  // 5. Transaction ID extraction
  const txnMatch = clean.match(
    /(?:txnid|trxid|trx|transaction\s*id|ট্রানজেকশন)\s*[:=#-]?\s*([A-Za-z0-9]{4,32})/i
  );
  if (txnMatch && txnMatch[1]) {
    out.txnId = txnMatch[1].trim();
  }

  // 6. Coupon extraction
  const couponMatch = clean.match(/(?:coupon|promo|code|কুপন)\s*[:=#-]?\s*([A-Za-z0-9_-]{3,24})/i);
  if (couponMatch && couponMatch[1]) {
    out.couponCode = couponMatch[1].trim().toUpperCase();
  }

  // 7. District (all 64 + aliases) & Area extraction
  const extraTokens = [
    ...ALL_BD_DISTRICTS.map((d) => d.toLowerCase()),
    'chittagong',
    'ctg',
    'savar',
    'comilla',
    'bogra',
    'jessore',
    'barisal',
    'ঢাকা',
    'চট্টগ্রাম',
    'গাজীপুর',
    'নারায়ণগঞ্জ',
    'সাভার',
    'সিলেট',
    'রাজশাহী',
    'খুলনা',
    'বরিশাল',
    'রংপুর',
    'ময়মনসিংহ',
    'কুমিল্লা',
    'বগুড়া',
    'পাবনা',
  ];
  for (const cand of extraTokens) {
    if (lower.includes(cand)) {
      const resolved = resolveConfiguredDistrictAndZone(cand);
      if (resolved.valid) {
        out.district = resolved.canonicalDistrict;
        break;
      }
    }
  }

  const areaMatch = clean.match(
    /\b(uttara|mirpur(?:\s*\d+)?|dhanmondi|gulshan(?:\s*\d+)?|banani|mohammadpur|badda|bashundhara|motijheel|rampura|khilgaon|wari|jatrabari|keraniganj|tongi|savar|ashulia)\b|(উত্তরা|মিরপুর|ধানমন্ডি|গুলশান|বনানী|মোহাম্মদপুর|বাড্ডা|বসুন্ধরা|মতিঝিল|রামপুরা|খিলগাঁও|সাভার|আশুলিয়া|আশুলিয়া)/i
  );
  if (areaMatch) {
    out.area = areaMatch[0].trim();
    if (!out.district) {
      const r = resolveConfiguredDistrictAndZone(out.area);
      out.district = r.valid ? r.canonicalDistrict : 'Dhaka';
    }
  }

  // 8. Address extraction
  const addressIndicator =
    /\b(house|holding|flat|road|rd|lane|avenue|ave|sector|block|village|bazar|para|upazila|thana)\b|(বাসা|হোল্ডিং|ফ্ল্যাট|রোড|রাস্তা|সেক্টর|ব্লক|পাড়া|বাজার|গ্রাম|থানা|উপজেলা)/i;
  if (addressIndicator.test(clean) && clean.length >= 6) {
    const addrClean = clean
      .replace(/(?:\+?88)?01[3-9](?:[-\s]?\d){8}/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    if (addrClean.length >= 5) {
      out.address = addrClean;
    }
  }

  // 9. Explicit Name extraction
  const nameMatch =
    clean.match(/(?:my\s+name\s+is|name\s*[:=-]|i\s+am|আমার\s+নাম)\s+([^\n,.;0-9]{2,60})/i);
  if (nameMatch && nameMatch[1]) {
    const candidateName = nameMatch[1].trim().slice(0, 100);
    if (candidateName.length >= 2 && !/^(cod|bkash|nagad|dhaka|order)$/i.test(candidateName)) {
      out.customerName = candidateName;
    }
  } else if (
    currentDraft &&
    (currentDraft.weight || (currentDraft.qty250g || 0) + (currentDraft.qty500g || 0) + (currentDraft.qty1kg || 0) > 0) &&
    !currentDraft.customerName &&
    !out.phone &&
    !out.weight &&
    !out.paymentMethod &&
    !addressIndicator.test(clean) &&
    !isTypedConfirmationOnly(clean) &&
    clean.length >= 2 &&
    clean.length <= 48 &&
    !/[0-9?]/.test(clean) &&
    !/\b(price|dam|daam|delivery|order|track|stock|ghee|ghier)\b/i.test(lower)
  ) {
    out.customerName = clean.slice(0, 100);
  }

  return out;
}

export type OrderDraftMissingField =
  | 'weight'
  | 'qty'
  | 'customerName'
  | 'phone'
  | 'district'
  | 'area'
  | 'address'
  | 'paymentMethod'
  | 'txnId';

export function getMissingOrderDraftFields(draft: OrderDraftDoc): OrderDraftMissingField[] {
  const missing: OrderDraftMissingField[] = [];
  const totalMixed =
    (draft.qty250g || 0) + (draft.qty500g || 0) + (draft.qty1kg || 0);
  if (!draft.weight && totalMixed === 0) missing.push('weight');
  if ((!draft.qty || draft.qty < 1) && totalMixed === 0) missing.push('qty');
  if (!draft.customerName || draft.customerName.trim().length < 2) missing.push('customerName');
  if (!draft.phone || !isValidBangladeshPhone(draft.phone)) missing.push('phone');
  if (!draft.district || draft.district.trim().length < 2) missing.push('district');
  if (!draft.area || draft.area.trim().length < 2) missing.push('area');
  if (!draft.address || draft.address.trim().length < 8) missing.push('address');
  if (!draft.paymentMethod) missing.push('paymentMethod');
  if (
    (draft.paymentMethod === 'bkash' || draft.paymentMethod === 'nagad') &&
    (!draft.txnId || draft.txnId.trim().length < 4)
  ) {
    missing.push('txnId');
  }
  return missing;
}

export function getNextOrderSlotQuestion(
  missingField: OrderDraftMissingField | undefined,
  lang: 'bn' | 'en',
  draft: OrderDraftDoc,
  settings: StoreSettingsDoc
): string {
  if (!missingField) {
    return lang === 'bn'
      ? 'সব তথ্য সংগ্রহ হয়েছে! অনুগ্রহ করে নিচের Order Summary কার্ডটি যাচাই করে **অর্ডার কনফার্ম করুন** বাটনে চাপুন।'
      : 'All details look complete! Please review your Order Summary card below and click Confirm Order.';
  }

  switch (missingField) {
    case 'weight':
      return lang === 'bn'
        ? `আপনি কোন সাইজের ঘি নিতে চান? (২৫০ গ্রাম ৳${settings.price250g}, ৫০০ গ্রাম ৳${settings.price500g}, বা ১ কেজি ৳${settings.price1kg})`
        : `Which jar size would you like to order? (250g ৳${settings.price250g}, 500g ৳${settings.price500g}, or 1kg ৳${settings.price1kg})`;
    case 'qty':
      return lang === 'bn'
        ? `আপনার ${draft.weight || ''} ঘিয়ের অর্ডারের জন্য কয়টি জার নিতে চান? (১ থেকে ১০টি)`
        : `How many ${draft.weight || ''} jars would you like for your order? (1 to 10)`;
    case 'customerName':
      return lang === 'bn'
        ? 'শুধুমাত্র ডেলিভারি ও যাচাইয়ের জন্য আপনার পূর্ণ নামটি বলবেন কি?'
        : 'May I have your full name for delivery verification?';
    case 'phone':
      return lang === 'bn'
        ? 'ডেলিভারি যোগাযোগের জন্য আপনার ১১ সংখ্যার মোবাইল নম্বরটি (01XXXXXXXXX) দিন।'
        : 'Please share your 11-digit Bangladesh mobile number (01XXXXXXXXX) for delivery contact.';
    case 'district':
    case 'area':
      return lang === 'bn'
        ? 'কোন জেলা এবং এলাকায় (যেমন: ঢাকা — উত্তরা/সাভার, অথবা চট্টগ্রাম) ডেলিভারি নিতে চান?'
        : 'Which district and area (e.g., Dhaka - Uttara/Savar, or Chattogram) should we deliver to?';
    case 'address':
      return draft.addressQualityNote
        ? draft.addressQualityNote
        : lang === 'bn'
          ? 'আপনার সম্পূর্ণ ডেলিভারি ঠিকানা (বাসা/হোল্ডিং, রোড, সেক্টর/ব্লক বা গ্রাম/থানা) দিন।'
          : 'Please provide your full street/house delivery address (House/Road or Village & Thana).';
    case 'paymentMethod':
      return lang === 'bn'
        ? 'কোন পেমেন্ট পদ্ধতিতে অর্ডার করতে চান? (ক্যাশ অন ডেলিভারি / bKash / Nagad)'
        : 'Which payment method do you prefer? (Cash on Delivery, bKash, or Nagad)';
    case 'txnId':
      return lang === 'bn'
        ? `${draft.paymentMethod === 'nagad' ? 'Nagad' : 'bKash'} পেমেন্টের Transaction ID (TxnID) টি দিন (কখনোই PIN বা OTP দেবেন না)।`
        : `Please enter your ${draft.paymentMethod === 'nagad' ? 'Nagad' : 'bKash'} Transaction ID (never share PIN or OTP).`;
  }
}

export function applySlotsToOrderDraft(params: {
  sessionId: string;
  currentDraft: OrderDraftDoc | null;
  extracted: ExtractedOrderSlots;
  settings: StoreSettingsDoc;
}): { draft: OrderDraftDoc; changedSlots: string[]; quoteInvalidated: boolean } {
  const now = Date.now();
  const base: OrderDraftDoc =
    params.currentDraft &&
    params.currentDraft.state !== 'expired' &&
    params.currentDraft.state !== 'cancelled' &&
    params.currentDraft.expiresAt > now
      ? { ...params.currentDraft }
      : {
          draftId: `draft_${params.sessionId}`,
          sessionId: params.sessionId,
          state: 'collecting_details',
          priceQuoteVersion: 1,
          expiresAt: now + CHATBOT_BUILD_CONFIG.ORDER_DRAFT_TTL_MS,
        };

  if (params.extracted.cancelOrderRequested) {
    return {
      draft: {
        ...base,
        state: 'cancelled',
        lastSummary: undefined,
        expiresAt: now,
      },
      changedSlots: ['state'],
      quoteInvalidated: true,
    };
  }

  const changedSlots: string[] = [];
  const priceSensitiveKeys: (keyof ExtractedOrderSlots)[] = [
    'weight',
    'qty',
    'qty250g',
    'qty500g',
    'qty1kg',
    'district',
    'area',
    'address',
    'paymentMethod',
    'couponCode',
    'txnId',
  ];

  const assignIfChanged = <K extends keyof ExtractedOrderSlots & keyof OrderDraftDoc>(key: K) => {
    const val = params.extracted[key];
    if (val !== undefined && val !== base[key]) {
      (base[key] as unknown) = val;
      changedSlots.push(key);
    }
  };

  assignIfChanged('weight');
  assignIfChanged('qty');
  assignIfChanged('qty250g');
  assignIfChanged('qty500g');
  assignIfChanged('qty1kg');
  assignIfChanged('customerName');
  assignIfChanged('phone');
  assignIfChanged('district');
  assignIfChanged('area');
  assignIfChanged('address');
  assignIfChanged('paymentMethod');
  assignIfChanged('txnId');
  assignIfChanged('couponCode');
  assignIfChanged('note');

  // Synchronize qty250g / qty500g / qty1kg when single weight/qty changes and no multi-variant quantities exist
  const hasExplicitMix =
    params.extracted.qty250g !== undefined ||
    params.extracted.qty500g !== undefined ||
    params.extracted.qty1kg !== undefined;

  if (!hasExplicitMix && (params.extracted.weight || params.extracted.qty)) {
    const w = base.weight || '500g';
    const q = base.qty || 1;
    const isAdditive = /\b(add another|plus)\b|(সাথে আরও|আরো)/i.test('');
    if (!isAdditive && ((base.qty250g || 0) + (base.qty500g || 0) + (base.qty1kg || 0) <= q || params.extracted.explicitCorrection)) {
      base.qty250g = w === '250g' ? q : 0;
      base.qty500g = w === '500g' ? q : 0;
      base.qty1kg = w === '1kg' ? q : 0;
    }
  } else if (hasExplicitMix) {
    const norm = normalizeVariantQuantities({
      qty250g: base.qty250g || 0,
      qty500g: base.qty500g || 0,
      qty1kg: base.qty1kg || 0,
    });
    base.qty250g = norm.qty250g;
    base.qty500g = norm.qty500g;
    base.qty1kg = norm.qty1kg;
    base.weight = norm.primaryWeight;
    base.qty = norm.totalQty;
  }

  if (params.extracted.paymentMethod === 'cod' && base.txnId) {
    base.txnId = undefined;
    changedSlots.push('txnId');
  }

  const quoteInvalidated = changedSlots.some((k) =>
    priceSensitiveKeys.includes(k as keyof ExtractedOrderSlots)
  );

  if (quoteInvalidated) {
    base.priceQuoteVersion = Math.max(1, Number(base.priceQuoteVersion || 1)) + 1;
    base.lastSummary = undefined;
  }

  const validationErrors: string[] = [];
  base.addressQualityNote = undefined;
  if (base.address) {
    const addrCheck = assessAddressCompleteness(base.address, base.area || '', base.district || '');
    if (!addrCheck.complete) {
      base.addressQualityNote = addrCheck.suggestionEn;
      validationErrors.push(addrCheck.suggestionEn || 'Incomplete delivery address.');
    }
  }

  const norm = normalizeVariantQuantities({
    weight: base.weight,
    qty: base.qty,
    qty250g: base.qty250g,
    qty500g: base.qty500g,
    qty1kg: base.qty1kg,
  });
  if (norm.qty250g > params.settings.stock250g) {
    validationErrors.push(`Only ${params.settings.stock250g} jars of 250g available.`);
  }
  if (norm.qty500g > params.settings.stock500g) {
    validationErrors.push(`Only ${params.settings.stock500g} jars of 500g available.`);
  }
  if (norm.qty1kg > params.settings.stock1kg) {
    validationErrors.push(`Only ${params.settings.stock1kg} jars of 1kg available.`);
  }

  const missing = getMissingOrderDraftFields(base);
  base.validationErrors = validationErrors;
  base.state =
    missing.length === 0 && validationErrors.length === 0
      ? 'quote_ready'
      : 'collecting_details';
  base.expiresAt = now + CHATBOT_BUILD_CONFIG.ORDER_DRAFT_TTL_MS;

  return { draft: base, changedSlots, quoteInvalidated };
}

export function buildDraftPromptSummary(draft: OrderDraftDoc | null): string {
  if (!draft || draft.state === 'cancelled' || draft.state === 'expired') {
    return 'No active order draft yet.';
  }
  const collected: string[] = [];
  if ((draft.qty250g || 0) + (draft.qty500g || 0) + (draft.qty1kg || 0) > 0) {
    const norm = normalizeVariantQuantities({
      qty250g: draft.qty250g,
      qty500g: draft.qty500g,
      qty1kg: draft.qty1kg,
    });
    collected.push(`items=${norm.itemsSummary}`);
  } else {
    if (draft.weight) collected.push(`weight=${draft.weight}`);
    if (draft.qty) collected.push(`qty=${draft.qty}`);
  }
  if (draft.customerName) collected.push(`name=${draft.customerName}`);
  if (draft.phone) collected.push(`phone=${draft.phone}`);
  if (draft.district) collected.push(`district=${draft.district}`);
  if (draft.area) collected.push(`area=${draft.area}`);
  if (draft.address) collected.push(`address=${draft.address}`);
  if (draft.paymentMethod) collected.push(`paymentMethod=${draft.paymentMethod}`);
  if (draft.txnId) collected.push(`txnId=${draft.txnId}`);
  if (draft.couponCode) collected.push(`coupon=${draft.couponCode}`);
  const missing = getMissingOrderDraftFields(draft);
  return `Active draft (quote v${draft.priceQuoteVersion}, state=${draft.state}): Collected=[${collected.join(', ') || 'none'}]; Missing=[${missing.join(', ') || 'none — call prepare_order_summary if user wants summary now'}]. NEVER re-ask already collected slots unless the user asks to edit them.`;
}

export async function loadSessionAndDraft(sessionId: string): Promise<{
  session: ChatSessionDoc | null;
  draft: OrderDraftDoc | null;
}> {
  const cleanId = String(sessionId || '').trim().slice(0, 64);
  if (!cleanId) return { session: null, draft: null };
  const [session, draft] = await Promise.all([
    fetchServerChatSession(cleanId),
    fetchServerOrderDraft(`draft_${cleanId}`),
  ]);
  const activeDraft =
    draft && draft.expiresAt > Date.now() && draft.state !== 'cancelled' && draft.state !== 'expired'
      ? draft
      : null;
  return { session, draft: activeDraft };
}

export async function saveSessionAndDraft(params: {
  session: ChatSessionDoc;
  draft: OrderDraftDoc | null;
}): Promise<void> {
  const tasks: Promise<unknown>[] = [upsertServerChatSession(params.session)];
  if (params.draft) {
    tasks.push(upsertServerOrderDraft(params.draft));
  }
  await Promise.all(tasks);
}

export function buildInitialSessionDoc(
  sessionId: string,
  prev: ChatSessionDoc | null,
  opts: {
    replyLang: 'bn' | 'en';
    explicitSwitchRequested: 'bn' | 'en' | null;
    scriptPreference: 'bn_script' | 'banglish_roman' | 'en';
    intent: TurnIntent | string;
    orderDraftId?: string;
  }
): ChatSessionDoc {
  const lockedLang = opts.explicitSwitchRequested || prev?.lockedLang || '';
  return {
    sessionId: sessionId.slice(0, 64),
    language: lockedLang || opts.replyLang,
    lockedLang,
    scriptPreference: opts.scriptPreference,
    consent: prev?.consent ?? true,
    currentIntent: opts.intent,
    orderDraftId: opts.orderDraftId || prev?.orderDraftId || '',
    turnCount: (prev?.turnCount || 0) + 1,
  };
}
