import { isStorefrontOrderingReady, type StoreSettingsDoc, type WeightKey } from '../storeTypes';
import { convertBanglaDigitsToEnglish, normalizeWeight } from './domain-guard';
import type { OrderDraftDoc, ProductCardItem, TurnIntent } from './types';

export interface IntentClassificationResult {
  intent: TurnIntent;
  confidence: number;
  allowedToolNames: string[];
  canStreamSafely: boolean;
  needsProductCards: boolean;
}

const READ_INFO_TOOLS = [
  'get_product_information',
  'get_current_price',
  'get_variant_options',
  'calculate_cart_quote',
  'get_product_stock',
  'get_current_offers',
  'validate_coupon',
  'get_delivery_information',
  'quote_delivery',
  'get_business_contact',
  'get_business_hours',
  'get_payment_methods',
  'get_return_policy',
  'get_faq_information',
  'recommend_jar_variant',
];

export function classifyTurnIntent(
  rawMessage: string,
  activeDraft?: OrderDraftDoc | null
): IntentClassificationResult {
  const clean = convertBanglaDigitsToEnglish(rawMessage || '').normalize('NFC').toLowerCase().trim();

  // 1a. Pre-dispatch Order Management (cancel / address change on existing DG- order)
  if (
    /(cancel\s*(my\s*)?order|change\s*(my\s*)?(delivery\s*)?address|edit\s*(my\s*)?address|অর্ডার\s*বাতিল|অর্ডার\s*ক্যানসেল|ঠিকানা\s*পরিবর্তন|ঠিকানা\s*বদল)/i.test(
      clean
    )
  ) {
    return {
      intent: 'order_manage',
      confidence: 0.94,
      allowedToolNames: [
        'get_order_status',
        'request_cancel',
        'request_address_change',
        'quote_delivery',
        'get_business_contact',
        'submit_support_handover',
      ],
      canStreamSafely: false,
      needsProductCards: false,
    };
  }

  // 1b. Payment Verification Dispute
  if (
    /(pending_verification|unverified|double\s*charged|deducted|money\s*cut|payment\s*(issue|problem|dispute|failed|not\s*verified|verify)|টাকা\s*কেটে|ভেরিফাই\s*হয়নি|ভেরিফাই\s*হয়নি|পেমেন্ট\s*(সমস্যা|যাচাই|ডিসপিউট))/i.test(
      clean
    )
  ) {
    return {
      intent: 'payment_dispute',
      confidence: 0.94,
      allowedToolNames: [
        'get_order_status',
        'check_payment_verification',
        'get_payment_methods',
        'get_business_contact',
        'submit_support_handover',
      ],
      canStreamSafely: false,
      needsProductCards: false,
    };
  }

  // 1c. Late Delivery / Delay Follow-up
  if (
    /(late\s*delivery|\bis\s+late\b|\brunning\s+late\b|\bdays?\s+late\b|delay|delayed|not\s*delivered|haven'?t\s*received|still\s*not\s*received|overdue|এখনো\s*পাইনি|দেরি|আসেনি|দেরী)/i.test(
      clean
    )
  ) {
    return {
      intent: 'late_delivery',
      confidence: 0.93,
      allowedToolNames: [
        'get_order_status',
        'inspect_delivery_delay',
        'get_delivery_information',
        'get_business_contact',
        'submit_support_handover',
      ],
      canStreamSafely: false,
      needsProductCards: false,
    };
  }

  // 1d. Reorder / Refill Reminder
  if (
    /(reorder|order\s*again|buy\s*again|same\s*as\s*last|refill\s*reminder|আবার\s*অর্ডার|রিঅর্ডার|আগের\s*মত|আগের\s*মতো|রিফিল\s*রিমাইন্ডার)/i.test(
      clean
    )
  ) {
    return {
      intent: 'reorder',
      confidence: 0.93,
      allowedToolNames: [
        'get_order_status',
        'get_reorder_summary',
        'register_refill_reminder',
        'get_current_price',
        'get_product_stock',
      ],
      canStreamSafely: false,
      needsProductCards: false,
    };
  }

  // 1e. Order Tracking
  if (/(dg-\d+|track|ট্র্যাক|অবস্থা|অর্ডার কোথায়|কবে পাব|status)/i.test(clean)) {
    return {
      intent: 'tracking',
      confidence: 0.94,
      allowedToolNames: [
        'get_order_status',
        'check_payment_verification',
        'inspect_delivery_delay',
        'get_reorder_summary',
        'register_refill_reminder',
        'request_cancel',
        'request_address_change',
        'get_delivery_information',
        'get_business_contact',
      ],
      canStreamSafely: false,
      needsProductCards: false,
    };
  }

  // 2. Complaint / Damaged / Return
  if (
    /(broken|damaged|leak|leaking|cracked|bad smell|refund|complaint|replace|return|ভাঙা|নষ্ট|ফাঁটা|অভিযোগ|রিটার্ন|রিফান্ড|বদলে)/i.test(
      clean
    )
  ) {
    return {
      intent: 'complaint',
      confidence: 0.92,
      allowedToolNames: [
        'get_order_status',
        'get_return_policy',
        'get_business_contact',
        'submit_damage_or_return_claim',
        'submit_support_handover',
      ],
      canStreamSafely: false,
      needsProductCards: false,
    };
  }

  // 3. Human Support Handover & Contact / Office Location
  if (
    /(human|real agent|agent|call me|talk to someone|contact|phone|whatsapp|address|location|office|google\s*map|directions|where\s*(are|is)\s*(you|your)|হোয়াটসঅ্যাপ|হোয়াটসঅ্যাপ|ফোন|মানুষ|সাপোর্ট|কথা বলতে চাই|ঠিকানা|লোকেশন|অফিস|যোগাযোগ|ম্যাপ)/i.test(
      clean
    ) &&
    !/\b(price|dam|daam|order)\b/i.test(clean) &&
    !/(অর্ডার|ঠিকানা\s*পরিবর্তন|ঠিকানা\s*বদল)/i.test(clean)
  ) {
    return {
      intent: 'human_help',
      confidence: 0.9,
      allowedToolNames: [
        'get_business_contact',
        'get_business_hours',
        'submit_support_handover',
        'submit_damage_or_return_claim',
      ],
      canStreamSafely: false,
      needsProductCards: false,
    };
  }

  // 4. Size Recommendation / Comparison
  if (
    /(recommend|suggest|which\s*(size|jar|one)|best\s*for|compare|comparison|family|trial|first\s*time|gift|কোনটা|কোন\s*সাইজ|ভাল\s*হবে|ভালো\s*হবে|সাজেস্ট|তুলনা|পরিবার|গিফট)/i.test(
      clean
    )
  ) {
    return {
      intent: 'recommendation',
      confidence: 0.93,
      allowedToolNames: [
        'recommend_jar_variant',
        'get_current_price',
        'get_product_stock',
        'get_current_offers',
      ],
      canStreamSafely: false,
      needsProductCards: true,
    };
  }

  // 5. Guided Order Flow or Active Draft Continuation
  const isExplicitOrderStart =
    /(\border\b|অর্ডার|কিনব|কিনতে|নিব|নিবো|lagbe|লাগবে|buy|purchase|checkout|কনফার্ম)/i.test(clean);
  const looksLikeOrderSlotContinuation =
    Boolean(activeDraft && activeDraft.state === 'collecting_details') &&
    !/(dam|daam|price|দাম|কত|delivery|ডেলিভারি|khanti|খাঁটি|store|সংরক্ষণ|মেয়াদ)/i.test(clean);

  if (isExplicitOrderStart || looksLikeOrderSlotContinuation) {
    return {
      intent: 'order',
      confidence: 0.91,
      allowedToolNames: [
        'get_current_price',
        'get_variant_options',
        'calculate_cart_quote',
        'get_product_stock',
        'get_delivery_information',
        'quote_delivery',
        'get_payment_methods',
        'get_current_offers',
        'validate_coupon',
        'prepare_order_summary',
        'recalculate_order',
        'submit_support_handover',
      ],
      canStreamSafely: false,
      needsProductCards: Boolean(
        isExplicitOrderStart &&
          !activeDraft?.weight &&
          !activeDraft?.qty250g &&
          !activeDraft?.qty500g &&
          !activeDraft?.qty1kg
      ),
    };
  }

  // 6. Pricing & Sizes
  if (/(how\s+much|price|cost|rate|dam|daam|koto|taka|tka|tk|দাম|মূল্য|কত|সাইজ|size|weight|ওজন)/i.test(clean)) {
    return {
      intent: 'pricing',
      confidence: 0.95,
      allowedToolNames: [
        'get_current_price',
        'get_variant_options',
        'calculate_cart_quote',
        'get_product_stock',
        'get_current_offers',
        'recommend_jar_variant',
      ],
      canStreamSafely: false,
      needsProductCards: true,
    };
  }

  // 7. Stock
  if (/(stock|available|মজুদ|স্টক|পাওয়া যাবে|পাওয়া যাবে|আছে নাকি|ase naki|ache naki)/i.test(clean)) {
    return {
      intent: 'stock',
      confidence: 0.92,
      allowedToolNames: ['get_product_stock', 'get_variant_options', 'get_current_price', 'recommend_jar_variant'],
      canStreamSafely: false,
      needsProductCards: true,
    };
  }

  // 8. Offers & Coupons
  if (/(offer|discount|coupon|promo|free delivery|ছাড়|ছাড়|অফার|কুপন|ডিসকাউন্ট)/i.test(clean)) {
    return {
      intent: 'offers',
      confidence: 0.91,
      allowedToolNames: [
        'get_current_offers',
        'validate_coupon',
        'calculate_cart_quote',
        'get_delivery_information',
        'get_current_price',
      ],
      canStreamSafely: false,
      needsProductCards: false,
    };
  }

  // 9. Delivery
  if (/(delivery|shipping|courier|dhaka|district|savar|gazipur|narayanganj|ডেলিভারি|কুরিয়ার|কুরিয়ার|চার্জ|পৌঁছাবে)/i.test(clean)) {
    return {
      intent: 'delivery',
      confidence: 0.93,
      allowedToolNames: ['get_delivery_information', 'quote_delivery', 'get_business_hours', 'get_current_offers'],
      canStreamSafely: false,
      needsProductCards: false,
    };
  }

  // 10. Payment
  if (/(payment|bkash|nagad|cod|cash on|পেমেন্ট|বিকাশ|নগদ|ক্যাশ অন)/i.test(clean)) {
    return {
      intent: 'payment',
      confidence: 0.94,
      allowedToolNames: ['get_payment_methods', 'get_current_offers'],
      canStreamSafely: false,
      needsProductCards: false,
    };
  }

  // 11. Policy (Return / Business Hours)
  if (/(policy|return|refund|hours|open|closed|friday|সময়|খোলা|বন্ধ|নীতি|পলিসি)/i.test(clean)) {
    return {
      intent: 'policy',
      confidence: 0.9,
      allowedToolNames: ['get_return_policy', 'get_business_hours', 'get_business_contact'],
      canStreamSafely: true,
      needsProductCards: false,
    };
  }

  // 12. Pure Greeting
  if (/^(hi|hello|hey|assalamu\s*alaikum|salam|সালাম|হ্যালো|হাই|কেমন আছেন)$/i.test(clean)) {
    return {
      intent: 'greeting',
      confidence: 0.97,
      allowedToolNames: ['get_current_price', 'get_product_information'],
      canStreamSafely: true,
      needsProductCards: false,
    };
  }

  // 13. Product Craft / Ingredients / Usage / Storage / Cooking (Tool-free explanation safe for guarded streaming!)
  if (
    /(bilona|বিলোনা|pabna|পাবনা|curd|dahi|doi|দই|makkhan|মাখন|danadar|দানা|cooking|halua|polao|paratha|khichuri|bhaat|রান্না|সংরক্ষণ|store|storage|shelf|মেয়াদ|মেয়াদ|glass jar|কাঁচের|উপাদান|বানান|তৈরি)/i.test(
      clean
    )
  ) {
    return {
      intent: 'product_question',
      confidence: 0.9,
      allowedToolNames: ['get_product_information', 'get_faq_information', 'recommend_jar_variant'],
      canStreamSafely: true,
      needsProductCards: false,
    };
  }

  return {
    intent: 'product_question',
    confidence: 0.72,
    allowedToolNames: READ_INFO_TOOLS,
    canStreamSafely: false,
    needsProductCards: false,
  };
}

export interface VariantRecommendationResult {
  recommendedWeight: WeightKey;
  inStock: boolean;
  priceBdt: number;
  stockJars: number;
  alternativeWeight?: WeightKey;
  qualifiesFreeDelivery: boolean;
  freeDeliveryThresholdBdt: number;
  shortfallForFreeDeliveryBdt: number;
  reasonEn: string;
  reasonBn: string;
}

export function recommendJarVariant(
  args: {
    householdSize?: string;
    usageFrequency?: string;
    isFirstTime?: boolean;
    purpose?: string;
    preferredWeight?: string;
  },
  settings: StoreSettingsDoc
): VariantRecommendationResult {
  const prefWeight = normalizeWeight(args.preferredWeight);
  const purposeLower = String(args.purpose || '').toLowerCase();
  const householdLower = String(args.householdSize || '').toLowerCase();
  const freqLower = String(args.usageFrequency || '').toLowerCase();

  let target: WeightKey = prefWeight || '500g';
  if (!prefWeight) {
    if (
      args.isFirstTime ||
      /(trial|first|try|taste|solo|single|1 person|ছোট|ট্রায়াল|ট্রায়াল|প্রথম|টেস্ট)/i.test(
        `${purposeLower} ${householdLower}`
      )
    ) {
      target = '250g';
    } else if (
      /(gift|bulk|festive|cooking|biryani|polao|halua|large|joint|value|sav|৫\+|5\+|গিফট|উপহার|বেশি|রান্না|সাশ্রয়ী)/i.test(
        `${purposeLower} ${householdLower} ${freqLower}`
      )
    ) {
      target = '1kg';
    } else {
      target = '500g';
    }
  }

  const priceMap: Record<WeightKey, number> = {
    '250g': Math.round(settings.price250g),
    '500g': Math.round(settings.price500g),
    '1kg': Math.round(settings.price1kg),
  };
  const stockMap: Record<WeightKey, number> = {
    '250g': Math.round(settings.stock250g),
    '500g': Math.round(settings.stock500g),
    '1kg': Math.round(settings.stock1kg),
  };

  let alternativeWeight: WeightKey | undefined;
  let effectiveWeight = target;
  if (stockMap[target] <= 0) {
    const order: WeightKey[] = target === '250g' ? ['500g', '1kg'] : target === '500g' ? ['1kg', '250g'] : ['500g', '250g'];
    const found = order.find((w) => stockMap[w] > 0);
    if (found) {
      alternativeWeight = found;
      effectiveWeight = found;
    }
  }

  const priceBdt = priceMap[effectiveWeight];
  const threshold = Math.round(settings.freeDeliveryThreshold);
  const shortfall = Math.max(0, threshold - priceBdt);

  const reasonMapEn: Record<WeightKey, string> = {
    '250g': 'Best first-time trial jar or solo kitchen starter size.',
    '500g': 'Most popular everyday family jar with balanced value and shelf convenience.',
    '1kg': 'Best per-gram value for regular cooking, larger households, or gifting.',
  };
  const reasonMapBn: Record<WeightKey, string> = {
    '250g': 'প্রথমবার স্বাদ পরখ বা ছোট পরিবারের জন্য আদর্শ ট্রায়াল সাইজ।',
    '500g': 'নিয়মিত পারিবারিক ব্যবহারের জন্য সবচেয়ে জনপ্রিয় ও সাশ্রয়ী সাইজ।',
    '1kg': 'বড় পরিবার, নিয়মিত রান্না বা উপহারের জন্য প্রতি গ্রামে সর্বোচ্চ সাশ্রয়ী সাইজ।',
  };

  const outOfStockNoteEn = alternativeWeight
    ? ` (${target} is currently out of stock, so ${alternativeWeight} is the best available option.)`
    : '';
  const outOfStockNoteBn = alternativeWeight
    ? ` (${target} বর্তমানে স্টকে না থাকায় ${alternativeWeight} সাইজটি এখন উপলব্ধ সেরা বিকল্প।)`
    : '';

  return {
    recommendedWeight: effectiveWeight,
    inStock: stockMap[effectiveWeight] > 0,
    priceBdt,
    stockJars: stockMap[effectiveWeight],
    alternativeWeight,
    qualifiesFreeDelivery: shortfall === 0,
    freeDeliveryThresholdBdt: threshold,
    shortfallForFreeDeliveryBdt: shortfall,
    reasonEn: `${reasonMapEn[effectiveWeight]}${outOfStockNoteEn}`,
    reasonBn: `${reasonMapBn[effectiveWeight]}${outOfStockNoteBn}`,
  };
}

export function buildProductComparisonCards(
  settings: StoreSettingsDoc,
  recommendedWeight?: WeightKey,
  customReason?: { en?: string; bn?: string }
): ProductCardItem[] {
  if (!isStorefrontOrderingReady(settings)) {
    return [];
  }
  const p250 = Math.round(settings.price250g || 0);
  const p500 = Math.round(settings.price500g || 0);
  const p1k = Math.round(settings.price1kg || 0);
  if (p250 <= 0 && p500 <= 0 && p1k <= 0) {
    return [];
  }

  const variants: { weight: WeightKey; labelEn: string; labelBn: string; price: number; stock: number }[] = [
    {
      weight: '250g',
      labelEn: '250g Starter Jar',
      labelBn: '২৫০ গ্রাম ট্রায়াল জার',
      price: Math.round(settings.price250g),
      stock: Math.round(settings.stock250g),
    },
    {
      weight: '500g',
      labelEn: '500g Family Jar',
      labelBn: '৫০০ গ্রাম পারিবারিক জার',
      price: Math.round(settings.price500g),
      stock: Math.round(settings.stock500g),
    },
    {
      weight: '1kg',
      labelEn: '1kg Reserve Jar',
      labelBn: '১ কেজি সাশ্রয়ী জার',
      price: Math.round(settings.price1kg),
      stock: Math.round(settings.stock1kg),
    },
  ];

  return variants.map((v) => {
    const isRec = recommendedWeight === v.weight;
    return {
      weight: v.weight,
      labelEn: v.labelEn,
      labelBn: v.labelBn,
      priceBdt: v.price,
      stockJars: v.stock,
      inStock: v.stock > 0,
      recommended: isRec,
      reasonEn: isRec ? customReason?.en : undefined,
      reasonBn: isRec ? customReason?.bn : undefined,
    };
  });
}

export function buildContextualSuggestedReplies(
  intent: TurnIntent | string,
  replyLang: 'bn' | 'en',
  activeDraft?: OrderDraftDoc | null
): string[] {
  if (activeDraft && activeDraft.state === 'collecting_details') {
    if (!activeDraft.weight) {
      return replyLang === 'bn'
        ? ['২৫০ গ্রাম নেব', '৫০০ গ্রাম নেব', '১ কেজি নেব']
        : ['Order 250g', 'Order 500g', 'Order 1kg'];
    }
    if (!activeDraft.paymentMethod && activeDraft.address) {
      return replyLang === 'bn'
        ? ['Cash on Delivery (COD)', 'bKash পেমেন্ট', 'Nagad পেমেন্ট']
        : ['Cash on Delivery (COD)', 'Pay via bKash', 'Pay via Nagad'];
    }
  }

  switch (intent) {
    case 'pricing':
    case 'recommendation':
    case 'stock':
      return replyLang === 'bn'
        ? ['৫০০ গ্রাম অর্ডার করব', 'ডেলিভারি চার্জ কত?', 'বিলোনা পদ্ধতি কী?']
        : ['Order 500g jar', 'What is the delivery fee?', 'How is bilona ghee made?'];
    case 'delivery':
      return replyLang === 'bn'
        ? ['ক্যাশ অন ডেলিভারি আছে?', '৫০০ গ্রাম অর্ডার করব', 'অর্ডার ট্র্যাক করব']
        : ['Is Cash on Delivery available?', 'Order 500g jar', 'Track my order'];
    case 'product_question':
      return replyLang === 'bn'
        ? ['দাম কত?', 'কোন সাইজ ভালো হবে?', 'কীভাবে সংরক্ষণ করব?']
        : ['Show prices', 'Which jar size fits my family?', 'How to store it?'];
    case 'tracking':
      return replyLang === 'bn'
        ? ['সাপোর্টে কথা বলব', 'রিটার্ন পলিসি কী?']
        : ['Contact support', 'Return & replacement policy'];
    case 'payment_dispute':
      return replyLang === 'bn'
        ? ['সাপোর্ট টিকিট খুলুন', 'অর্ডার ট্র্যাকার খুলুন']
        : ['Open payment dispute ticket', 'Open Order Tracker'];
    case 'late_delivery':
      return replyLang === 'bn'
        ? ['জরুরি ডেলিভারি টিকিট দিন', 'অর্ডার ট্র্যাক করুন']
        : ['Submit urgent delay ticket', 'Track my order'];
    case 'reorder':
      return replyLang === 'bn'
        ? ['ঘিয়ের দাম কত?', 'রিফিল রিমাইন্ডার সেট করুন']
        : ['Show jar prices', 'Set refill reminder'];
    default:
      return replyLang === 'bn'
        ? ['ঘিয়ের দাম কত?', 'কোন সাইজ নেব?', 'অর্ডার করতে চাই']
        : ['What are the prices?', 'Which size is best?', 'Place an order'];
  }
}
