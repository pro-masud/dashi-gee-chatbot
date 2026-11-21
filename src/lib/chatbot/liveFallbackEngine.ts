import type { BatchRecord, StoreSettingsDoc } from '../storeTypes';
import { convertBanglaDigitsToEnglish, normalizeWeight } from './domain-guard';
import {
  buildContextualSuggestedReplies,
  buildProductComparisonCards,
  recommendJarVariant,
} from './intentRouter';
import {
  getMissingOrderDraftFields,
  getNextOrderSlotQuestion,
} from './sessionStore';
import { resolveConfiguredDistrictAndZone } from './orderToken';
import {
  buildStoreFactsSnapshot,
  getActiveApprovedClaimsText,
  type StoreFactsSnapshot,
} from './storeFacts';
import type {
  ChatActionItem,
  ChatbotConfigDoc,
  ChatbotFaqDoc,
  OrderDraftDoc,
  ProductCardItem,
} from './types';

export interface LiveFallbackResult {
  replyText: string;
  intent: string;
  actions: ChatActionItem[];
  productCards?: ProductCardItem[];
  suggestedReplies?: string[];
  extraVerifiedAmounts?: number[];
  noVerifiedInfo?: boolean;
  factsVersion: string;
}

function cleanDigits(phone: string): string {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('01')) return `88${digits}`;
  return digits;
}

function pushAction(list: ChatActionItem[], action: ChatActionItem) {
  if (!list.some((a) => a.type === action.type && a.value === action.value)) {
    list.push(action);
  }
}

export function generateLiveFallbackReply(params: {
  userMessage: string;
  replyLang: 'bn' | 'en';
  settings: StoreSettingsDoc;
  batch: BatchRecord;
  config: ChatbotConfigDoc;
  matchedFaqs: ChatbotFaqDoc[];
  matchedKbSnippets?: { title: string; category: string; snippet: string }[];
  activeDraft?: OrderDraftDoc | null;
  facts?: StoreFactsSnapshot;
}): LiveFallbackResult {
  const { userMessage, replyLang, settings, batch, config, matchedFaqs } = params;
  const facts =
    params.facts || buildStoreFactsSnapshot({ settings, batch, config });
  const isBn = replyLang === 'bn';
  const clean = convertBanglaDigitsToEnglish(userMessage).toLowerCase().trim();
  const actions: ChatActionItem[] = [];

  const displayPhone = facts.contact.phoneConfigured
    ? facts.contact.supportPhone
    : '';
  const displayWhatsApp = facts.contact.whatsappConfigured
    ? facts.contact.whatsappNumber
    : '';
  const displayAddress = facts.contact.businessAddress
    .toLowerCase()
    .includes('configurable')
    ? 'ঢাকা ও পাবনা, বাংলাদেশ'
    : facts.contact.businessAddress;

  const addPhoneAction = () => {
    const digits = cleanDigits(displayPhone);
    if (!digits) return;
    pushAction(actions, {
      type: 'call',
      labelEn: 'Call Support',
      labelBn: 'ফোন করুন',
      value: displayPhone,
      href: `tel:+${digits}`,
    });
  };

  const addWhatsAppAction = () => {
    const digits = cleanDigits(displayWhatsApp);
    if (!digits) return;
    const waText = encodeURIComponent(
      isBn
        ? 'আসসালামু আলাইকুম, দেশী ঘি সম্পর্কে সাহায্য চাই।'
        : 'Hello, I would like assistance with Deshi Gee.'
    );
    pushAction(actions, {
      type: 'whatsapp',
      labelEn: 'Chat on WhatsApp',
      labelBn: 'WhatsApp-এ যোগাযোগ',
      value: displayWhatsApp,
      href: `https://wa.me/${digits}?text=${waText}`,
    });
  };

  const addOrderAction = () => {
    if (!facts.orderingReady) return;
    pushAction(actions, {
      type: 'open_url',
      labelEn: 'Order Online',
      labelBn: 'অনলাইনে অর্ডার করুন',
      value: '#order',
      href: '/#order',
    });
  };

  const addTrackAction = () => {
    pushAction(actions, {
      type: 'open_url',
      labelEn: 'Track Order',
      labelBn: 'অর্ডার ট্র্যাক করুন',
      value: '/track',
      href: '/track',
    });
  };

  const detectedWeight = normalizeWeight(userMessage);

  // 1. Matched verified FAQs or KB snippets from hybrid RAG
  if (matchedFaqs.length > 0) {
    const topFaq = matchedFaqs[0];
    const faqText = topFaq.answer.trim();
    if (faqText.length > 10) {
      addWhatsAppAction();
      addOrderAction();
      return {
        replyText: faqText,
        intent: 'faq_matched',
        actions,
        suggestedReplies: buildContextualSuggestedReplies('product_question', replyLang, params.activeDraft),
        factsVersion: facts.factsVersion,
      };
    }
  }

  if (params.matchedKbSnippets && params.matchedKbSnippets.length > 0) {
    const topKb = params.matchedKbSnippets[0];
    if (topKb.snippet.trim().length > 12) {
      addWhatsAppAction();
      return {
        replyText: topKb.snippet.trim().slice(0, 520),
        intent: 'kb_matched',
        actions,
        suggestedReplies: buildContextualSuggestedReplies('product_question', replyLang, params.activeDraft),
        factsVersion: facts.factsVersion,
      };
    }
  }

  // 2. Active Order Draft Slot Guidance (never re-asks already collected slots)
  if (
    params.activeDraft &&
    params.activeDraft.state === 'collecting_details' &&
    !/(how\s+much|dam|daam|price|cost|koto|taka|দাম|কত|delivery|ডেলিভারি|track|ট্র্যাক)/i.test(clean)
  ) {
    const missing = getMissingOrderDraftFields(params.activeDraft);
    const nextQuestion = getNextOrderSlotQuestion(missing[0], replyLang, params.activeDraft, settings);
    addWhatsAppAction();
    return {
      replyText: nextQuestion,
      intent: 'order',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('order', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 3. Variant Recommendation / Comparison
  if (
    /(recommend|suggest|which\s*(size|jar|one)|best\s*for|compare|comparison|family|trial|first\s*time|gift|কোনটা|কোন\s*সাইজ|ভাল\s*হবে|ভালো\s*হবে|সাজেস্ট|তুলনা|পরিবার|গিফট)/i.test(
      clean
    )
  ) {
    const rec = recommendJarVariant(
      {
        purpose: clean,
        isFirstTime: /(trial|first|try|প্রথম|ট্রায়াল|ট্রায়াল)/i.test(clean),
      },
      settings
    );

    if (!facts.orderingReady || rec.priceBdt <= 0) {
      addWhatsAppAction();
      return {
        replyText: isBn
          ? `পাবনার খাঁটি দেশী গাওয়া ঘিয়ের বর্তমান ব্যাচের মূল্য ও ডেলিভারি চার্জ নির্ধারণের কাজ চলছে। চূড়ান্ত হওয়ার সাথে সাথেই অর্ডার গ্রহণ শুরু হবে। যেকোনো তথ্যের জন্য সরাসরি আমাদের সাথে যোগাযোগ করতে পারেন।`
          : `Prices and availability for our authentic Pabna Deshi Ghee are currently being finalized. Please contact us via WhatsApp for any queries.`,
        intent: 'recommendation',
        actions,
        suggestedReplies: buildContextualSuggestedReplies('recommendation', replyLang, params.activeDraft),
        factsVersion: facts.factsVersion,
      };
    }

    const cards = buildProductComparisonCards(settings, rec.recommendedWeight, {
      en: rec.reasonEn,
      bn: rec.reasonBn,
    });
    addOrderAction();
    addWhatsAppAction();
    const freeNoteBn = rec.qualifiesFreeDelivery
      ? `এবং এটি সরাসরি ফ্রি ডেলিভারি (৳${rec.freeDeliveryThresholdBdt}+) সুবিধা পায়।`
      : `আরো ৳${rec.shortfallForFreeDeliveryBdt} বা তার বেশি যোগ করলে সারা দেশে ডেলিভারি ফ্রি হবে।`;
    const freeNoteEn = rec.qualifiesFreeDelivery
      ? `It also qualifies directly for free nationwide delivery (৳${rec.freeDeliveryThresholdBdt}+).`
      : `Add ৳${rec.shortfallForFreeDeliveryBdt} or more to unlock free nationwide delivery.`;

    return {
      replyText: isBn
        ? `আপনার জন্য **${rec.recommendedWeight}** দেশী ঘিয়ের জার (৳${rec.priceBdt}, স্টকে ${rec.stockJars}টি) সবচেয়ে উপযুক্ত হবে। ${rec.reasonBn} ${freeNoteBn}`
        : `I recommend the **${rec.recommendedWeight}** Deshi Gee glass jar (৳${rec.priceBdt}, ${rec.stockJars} in stock). ${rec.reasonEn} ${freeNoteEn}`,
      intent: 'recommendation',
      actions,
      productCards: cards,
      suggestedReplies: buildContextualSuggestedReplies('recommendation', replyLang, params.activeDraft),
      extraVerifiedAmounts:
        rec.shortfallForFreeDeliveryBdt > 0 ? [rec.shortfallForFreeDeliveryBdt] : [],
      factsVersion: facts.factsVersion,
    };
  }

  // 4. Greetings & Courtesy
  if (
    /(\b(?:assalamu|salam|hello|hi|hey|valo|bhalo)\b|সালাম|হ্যালো|হাই|কেমন আছেন)/i.test(clean) &&
    !/(dam|daam|price|cost|koto|order|delivery|track|দাম|অর্ডার|ডেলিভারি)/i.test(clean)
  ) {
    addOrderAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `ওয়ালাইকুম আসসালাম! Deshi Gee-তে আপনাকে স্বাগতম। আমি আপনার ভার্চুয়াল সহকারী। আমাদের পাবনার ঐতিহ্যবাহী কাঠের বিলোনার গাওয়া ঘি, দাম, সাইজ, ডেলিভারি বা যেকোনো তথ্যে সাহায্য করতে পারি। আপনি কীভাবে সাহায্য চান?`
        : `Assalamu Alaikum! Welcome to Deshi Gee. I am your virtual assistant. How can I help you today with our Pabna bilona cow ghee, jar sizes, prices, or orders?`,
      intent: 'greeting',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('greeting', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 5. Payment methods (COD, bKash, Nagad)
  if (/(payment|cod|cash on delivery|পেমেন্ট|ক্যাশ অন|ক্যাশঅন|বিকাশ|নগদ|bkash|nagad)/i.test(clean)) {
    addWhatsAppAction();
    addOrderAction();
    return {
      replyText: isBn
        ? `পেমেন্ট পদ্ধতিসমূহ:\n১. ক্যাশ অন ডেলিভারি (COD): সারা দেশে পণ্য হাতে পেয়ে ডেলিভারিম্যানের সামনে জার দেখে নিশ্চিন্তে মূল্য পরিশোধ করুন।\n২. বিকাশ ও নগদ: অগ্রিম পেমেন্টে ${facts.payments.advanceDiscountPct}% বিশেষ মূল্যছাড় সুবিধা রয়েছে।\n\nনিরাপত্তার স্বার্থে কখনোই কারো সাথে আপনার বিকাশ বা নগদ পিন (PIN) বা OTP শেয়ার করবেন না।`
        : `Payment options:\n1. Cash on Delivery (COD) across all 64 districts in Bangladesh.\n2. bKash / Nagad advance payment with ${facts.payments.advanceDiscountPct}% special discount.\n\nNever share your PIN or OTP with anyone.`,
      intent: 'payment',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('delivery', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 6. Delivery & Shipping details
  if (
    /(delivery|shipping|courier|ডেলিভারি|কুরিয়ার|কুরিয়ার|পৌঁছাবে|পৌছাবে|pathaben)/i.test(clean) ||
    (clean.includes('চার্জ') && !clean.includes('দাম'))
  ) {
    // Check if the customer mentioned a misspelled district (e.g. "Chitagong")
    const candidateTokens = userMessage
      .replace(/[^A-Za-z\u0980-\u09FF\s'-]/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 4);
    for (const token of candidateTokens) {
      const check = resolveConfiguredDistrictAndZone(token);
      if (check.needsClarification && check.suggestedDistrict) {
        addOrderAction();
        addWhatsAppAction();
        return {
          replyText: isBn
            ? `আপনি কি **${check.suggestedDistrict}** জেলা বোঝাতে চেয়েছেন? সঠিক ডেলিভারি জোন ও চার্জ নিশ্চিত করার আগে অনুগ্রহ করে জেলার নামটি নিশ্চিত করুন।`
            : `Did you mean **${check.suggestedDistrict}**? Please confirm your district name so I can verify the exact delivery zone and fee.`,
          intent: 'delivery_clarification',
          actions,
          suggestedReplies: [
            isBn
              ? `হ্যাঁ, ${check.suggestedDistrict}`
              : `Yes, ${check.suggestedDistrict}`,
            ...(buildContextualSuggestedReplies('delivery', replyLang, params.activeDraft) || []).slice(0, 2),
          ],
          factsVersion: facts.factsVersion,
        };
      }
    }

    addOrderAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `আমাদের ডেলিভারি চার্জ ও সময়সূচী:\n• ঢাকা সিটির ভেতরে: ৳${facts.delivery.insideDhakaFeeBdt} (${facts.delivery.estimatedDhakaDays})\n• ঢাকা উপকণ্ঠ (সাভার, গাজীপুর, নারায়ণগঞ্জ): ৳${facts.delivery.dhakaSuburbanFeeBdt} (${facts.delivery.estimatedSuburbanDays})\n• সারা বাংলাদেশ: ৳${facts.delivery.outsideDhakaFeeBdt} (${facts.delivery.estimatedOutsideDays})\n• পার্বত্য ও উপকূলীয় জেলা: ৳${facts.delivery.remoteDistrictFeeBdt} (${facts.delivery.estimatedRemoteDays})\n• ৳${facts.delivery.freeDeliveryThresholdBdt} বা তার বেশি অর্ডারে ডেলিভারি ফ্রি! ${facts.delivery.cutoffNoticeBn}`
        : `Delivery details:\n• Inside Dhaka: ৳${facts.delivery.insideDhakaFeeBdt} (${facts.delivery.estimatedDhakaDays})\n• Dhaka Suburbs (Savar, Gazipur, Narayanganj): ৳${facts.delivery.dhakaSuburbanFeeBdt} (${facts.delivery.estimatedSuburbanDays})\n• Nationwide: ৳${facts.delivery.outsideDhakaFeeBdt} (${facts.delivery.estimatedOutsideDays})\n• Remote / Hill & Coastal Districts: ৳${facts.delivery.remoteDistrictFeeBdt} (${facts.delivery.estimatedRemoteDays})\n• Free delivery nationwide on orders of ৳${facts.delivery.freeDeliveryThresholdBdt}+! ${facts.delivery.cutoffNoticeEn}`,
      intent: 'delivery',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('delivery', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 6b. Pre-dispatch Order Cancel / Edit Address Guidance
  if (
    /(cancel\s*(my\s*)?order|change\s*(my\s*)?(delivery\s*)?address|edit\s*(my\s*)?address|অর্ডার\s*বাতিল|অর্ডার\s*ক্যানসেল|ঠিকানা\s*পরিবর্তন)/i.test(
      clean
    )
  ) {
    addTrackAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `আপনার অর্ডারটি যদি এখনো প্রসেসিং বা শিপড না হয়ে থাকে (অবস্থা pending বা confirmed থাকে), তবে আপনি Order Tracker-এ গিয়ে Order ID (যেমন DG-10421) ও মোবাইল নম্বর দিয়ে ঠিকানা পরিবর্তন বা অর্ডার বাতিল করতে পারবেন।`
        : `If your order is still pre-dispatch (status pending or confirmed), you can update your delivery address or cancel it directly in the Order Tracker using your Order ID (e.g. DG-10421) and checkout phone number.`,
      intent: 'order_manage',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('tracking', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 7. Price inquiry (specific weight or all weights)
  if (
    /(how\s+much|dam|daam|price|cost|taka|tka|rate|দাম|মূল্য|টাকা|দর|প্রাইস|\btk\b)/i.test(clean) ||
    (detectedWeight && /(koto|কত|দাম|price|how\s+much|cost)/i.test(clean))
  ) {
    addOrderAction();
    addWhatsAppAction();

    const allPricesZero =
      facts.pricesBdt['250g'] <= 0 &&
      facts.pricesBdt['500g'] <= 0 &&
      facts.pricesBdt['1kg'] <= 0;

    if (!facts.orderingReady || allPricesZero) {
      return {
        replyText: isBn
          ? `পাবনার ঐতিহ্যবাহী কাঠের বিলোনার খাঁটি গাওয়া ঘিয়ের বর্তমান ব্যাচের মূল্য ও ডেলিভারি চার্জ নির্ধারণের কাজ চলছে। চূড়ান্ত হওয়ার সাথে সাথেই ওয়েবসাইটে ও চ্যাটে প্রকাশ করা হবে। কোনো প্রশ্ন থাকলে সরাসরি আমাদের সাথে যোগাযোগ করতে পারেন।`
          : `Prices and delivery charges for our authentic Pabna Deshi Ghee are currently being finalized by the owner. They will be updated shortly.`,
        intent: 'pricing',
        actions,
        suggestedReplies: buildContextualSuggestedReplies('pricing', replyLang, params.activeDraft),
        factsVersion: facts.factsVersion,
      };
    }

    const cards = buildProductComparisonCards(settings, detectedWeight || '500g');

    if (detectedWeight === '250g') {
      return {
        replyText: isBn
          ? `আমাদের ২৫০ গ্রাম (250g) দেশী ঘিয়ের জারটির মূল্য ৳${facts.pricesBdt['250g']}। বর্তমান স্টকে ${facts.stockJars['250g']}টি জার উপলব্ধ আছে।\n\n৳${facts.delivery.freeDeliveryThresholdBdt} বা তার বেশি অর্ডারে সারা দেশে ডেলিভারি ফ্রি!`
          : `Our 250g Deshi Gee jar is priced at ৳${facts.pricesBdt['250g']} (${facts.stockJars['250g']} jars in stock).\n\nFree delivery nationwide for orders of ৳${facts.delivery.freeDeliveryThresholdBdt} or more!`,
        intent: 'pricing',
        actions,
        productCards: cards,
        suggestedReplies: buildContextualSuggestedReplies('pricing', replyLang, params.activeDraft),
        factsVersion: facts.factsVersion,
      };
    }
    if (detectedWeight === '500g') {
      return {
        replyText: isBn
          ? `আমাদের ৫০০ গ্রাম (500g) পারিবারিক সাইজের দেশী ঘিয়ের জারটির মূল্য ৳${facts.pricesBdt['500g']}। বর্তমান স্টকে ${facts.stockJars['500g']}টি জার উপলব্ধ আছে।\n\n৳${facts.delivery.freeDeliveryThresholdBdt} বা তার বেশি অর্ডারে সারা দেশে ডেলিভারি ফ্রি!`
          : `Our 500g Family Kitchen Deshi Gee jar is priced at ৳${facts.pricesBdt['500g']} (${facts.stockJars['500g']} jars in stock).\n\nFree delivery nationwide for orders of ৳${facts.delivery.freeDeliveryThresholdBdt} or more!`,
        intent: 'pricing',
        actions,
        productCards: cards,
        suggestedReplies: buildContextualSuggestedReplies('pricing', replyLang, params.activeDraft),
        factsVersion: facts.factsVersion,
      };
    }
    if (detectedWeight === '1kg') {
      return {
        replyText: isBn
          ? `আমাদের ১ কেজি (1kg) দেশী ঘিয়ের জারটির মূল্য ৳${facts.pricesBdt['1kg']}। বর্তমান স্টকে ${facts.stockJars['1kg']}টি জার উপলব্ধ আছে।\n\n৳${facts.delivery.freeDeliveryThresholdBdt} বা তার বেশি অর্ডারে সারা দেশে ডেলিভারি ফ্রি!`
          : `Our 1kg Deshi Gee jar is priced at ৳${facts.pricesBdt['1kg']} (${facts.stockJars['1kg']} jars in stock).\n\nFree delivery nationwide for orders of ৳${facts.delivery.freeDeliveryThresholdBdt} or more!`,
        intent: 'pricing',
        actions,
        productCards: cards,
        suggestedReplies: buildContextualSuggestedReplies('pricing', replyLang, params.activeDraft),
        factsVersion: facts.factsVersion,
      };
    }

    return {
      replyText: isBn
        ? `পাবনার ঐতিহ্যবাহী কাঠের বিলোনার গাওয়া ঘিয়ের বর্তমান মূল্য তালিকা:\n• ২৫০ গ্রাম: ৳${facts.pricesBdt['250g']} (স্টক: ${facts.stockJars['250g']}টি)\n• ৫০০ গ্রাম: ৳${facts.pricesBdt['500g']} (স্টক: ${facts.stockJars['500g']}টি)\n• ১ কেজি: ৳${facts.pricesBdt['1kg']} (স্টক: ${facts.stockJars['1kg']}টি)\n\n৳${facts.delivery.freeDeliveryThresholdBdt} বা তার বেশি অর্ডারে সারা দেশে ডেলিভারি ফ্রি!`
        : `Current prices for Pabna Grass-Fed Bilona Cow Ghee:\n• 250g: ৳${facts.pricesBdt['250g']} (${facts.stockJars['250g']} in stock)\n• 500g: ৳${facts.pricesBdt['500g']} (${facts.stockJars['500g']} in stock)\n• 1kg: ৳${facts.pricesBdt['1kg']} (${facts.stockJars['1kg']} in stock)\n\nFree delivery nationwide on orders of ৳${facts.delivery.freeDeliveryThresholdBdt} or more!`,
      intent: 'pricing',
      actions,
      productCards: cards,
      suggestedReplies: buildContextualSuggestedReplies('pricing', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 8. Size & Packaging inquiry
  if (/(size|sizes|weight|weights|সাইজ|ওজন|বয়াম|বয়াম|boyaam|boyam|জার|প্যাকেট|বোতল|variant)/i.test(clean)) {
    addOrderAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `Deshi Gee ৩টি এয়ারটাইট সিলযুক্ত কাঁচের জারে পাওয়া যায়:\n১. ২৫০ গ্রাম — ছোট ট্রায়াল সাইজ (৳${facts.pricesBdt['250g']})\n২. ৫০০ গ্রাম — নিয়মিত পারিবারিক সাইজ (৳${facts.pricesBdt['500g']})\n৩. ১ কেজি — বড় সাশ্রয়ী সাইজ (৳${facts.pricesBdt['1kg']})\n\nসবগুলো জার পরিষ্কার অ্যাপোথেকারি কাঁচের বয়ামে সিল করা হয়। আপনি কোন সাইজটি নিতে চান?`
        : `Deshi Gee is available in 3 sealed apothecary glass jar sizes:\n1. 250g — Starter Jar (৳${facts.pricesBdt['250g']})\n2. 500g — Family Kitchen Jar (৳${facts.pricesBdt['500g']})\n3. 1kg — Household Reserve Jar (৳${facts.pricesBdt['1kg']})\n\nEach jar is poured warm and sealed with an airtight tamper-evident closure.`,
      intent: 'pricing',
      actions,
      productCards: buildProductComparisonCards(settings, '500g'),
      suggestedReplies: buildContextualSuggestedReplies('pricing', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 9. Stock check
  if (/(stock|স্টক|মজুদ|available|পাওয়া যাবে|পাওয়া যাবে|ase naki|ache naki)/i.test(clean)) {
    addOrderAction();
    return {
      replyText: isBn
        ? `বর্তমান ব্যাচের (${facts.activeBatch.batchCode}) লাইভ স্টক:\n• ২৫০ গ্রাম: ${facts.stockJars['250g']}টি জার উপলব্ধ\n• ৫০০ গ্রাম: ${facts.stockJars['500g']}টি জার উপলব্ধ\n• ১ কেজি: ${facts.stockJars['1kg']}টি জার উপলব্ধ\n\nআপনার প্রয়োজনীয় সাইজ এখনই অর্ডার করে নিশ্চিত করতে পারেন।`
        : `Live stock for Batch ${facts.activeBatch.batchCode}:\n• 250g: ${facts.stockJars['250g']} jars\n• 500g: ${facts.stockJars['500g']} jars\n• 1kg: ${facts.stockJars['1kg']} jars`,
      intent: 'stock',
      actions,
      productCards: buildProductComparisonCards(settings),
      suggestedReplies: buildContextualSuggestedReplies('stock', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 10. Craft, Ingredients & Bilona Process
  if (
    /(pure|purity|khanti|খাঁটি|আসল|ভেজাল|উপাদান|উপকরন|বানান|তৈরি|দই|বিলোনা|গাওয়া|bilona|curd|dahi|doi|danadar|দানা|makkhan|মাখন|butter|ঘি কি|ঘিয়ের সুবাস|cooking|halua|polao|paratha)/i.test(
      clean
    )
  ) {
    addOrderAction();
    addWhatsAppAction();
    const activeApproved = getActiveApprovedClaimsText(config);
    const noPreservativeClauseEn = activeApproved.includes('preservative')
      ? 'No vegetable oils, vanaspati, or preservatives added.'
      : 'Slow-clarified in small batches with full batch traceability.';
    const noPreservativeClauseBn = activeApproved.includes('preservative')
      ? 'কোনো ভেজিটেবল অয়েল, ডালডা বা প্রিজারভেটিভ ছাড়াই তৈরি।'
      : 'ছোট ছোট ব্যাচে মৃদু আঁচে যত্নসহকারে প্রস্তুত ও ব্যাচ-ট্রেসেবল।';

    return {
      replyText: isBn
        ? `Deshi Gee তৈরি ও উপাদান সংক্রান্ত তথ্য (${facts.activeBatch.batchCode}):\n• পাবনার গ্রাস-ফেড দেশী গরুর দুধ মাটির হাঁড়িতে দই পেতে কাঠের বিলোনায় মন্থন করে মাখন তোলা হয়।\n• মৃদু আঁচে জ্বাল দিয়ে তৈরি হয় প্রাকৃতিক দানাদার টেক্সচার ও ঐতিহ্যবাহী সুবাস।\n• ${noPreservativeClauseBn}`
        : `Deshi Gee Craft & Ingredients (Batch ${facts.activeBatch.batchCode}):\n• Single-origin Pabna grass-fed cow milk cultured overnight into whole curd in earthen clay pots and churned by traditional wooden bilona to separate cultured makkhan.\n• Slow-simmered for coarse granular (danadar) texture and rich aroma.\n• ${noPreservativeClauseEn}`,
      intent: 'product_question',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('product_question', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 11. Storage, Shelf Life & Expiry
  if (/(store|storage|সংরক্ষণ|রাখব|নষ্ট|মেয়াদ|মেয়াদ|expiry|expire|shelf)/i.test(clean)) {
    return {
      replyText: isBn
        ? `ঘি সংরক্ষণের নিয়ম:\n• ঘরের স্বাভাবিক তাপমাত্রায় (১৮°C–২৫°C) শুকনো ও ছায়াযুক্ত স্থানে রাখুন।\n• ফ্রিজে রাখার প্রয়োজন নেই। সবসময় শুকনো ও পরিষ্কার চামচ ব্যবহার করুন।\n• বর্তমান ব্যাচ (${facts.activeBatch.batchCode}): ${facts.craft.shelfLife}`
        : `Storage guidelines:\n• ${facts.craft.storageInstructions}\n• Current batch (${facts.activeBatch.batchCode}): ${facts.craft.shelfLife}`,
      intent: 'product_question',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('product_question', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 12. Return / Replacement Policy
  if (/(return|refund|replace|broken|damaged|leak|রিটার্ন|রিফান্ড|ভাঙা|নষ্ট)/i.test(clean)) {
    addPhoneAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `ডেলিভারির সময় কাঁচের জার ভাঙা বা সিল ক্ষতিগ্রস্ত হলে ২৪ ঘণ্টার মধ্যে ছবি সহ আমাদের WhatsApp বা ফোনে জানালে বিনামূল্যে রিপ্লেসমেন্ট বা রিফান্ড করা হয়।`
        : `${facts.policies.returnPolicy} ${facts.policies.replacementPolicy}`.trim(),
      intent: 'policy',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('tracking', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 12b. Payment Dispute / Manual Verification
  if (
    /(pending_verification|unverified|double\s*charged|deducted|money\s*cut|payment\s*(issue|problem|dispute|failed|not\s*verified)|টাকা\s*কেটে|ভেরিফাই\s*হয়নি|ভেরিফাই\s*হয়নি|পেমেন্ট\s*(সমস্যা|যাচাই|ডিসপিউট))/i.test(
      clean
    )
  ) {
    addTrackAction();
    addPhoneAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `bKash ও Nagad পেমেন্ট আমাদের টিম ম্যানুয়ালি যাচাই করে নিশ্চিত করে (তাই ট্রানজেকশন ম্যাচ হওয়ার আগ পর্যন্ত "Pending Verification" দেখাতে পারে)। আপনার Order ID (যেমন DG-10421) ও চেকআউট নম্বর দিলে এখনই অবস্থা দেখতে পারবেন, অথবা /track পেজে ট্রানজেকশন স্ক্রিনশট দিয়ে পেমেন্ট ডিসপিউট টিকিট খুলুন। কখনোই PIN বা OTP দেবেন না।`
        : `bKash and Nagad transfers are reconciled manually by our team (they remain Pending Verification until matched). Share your Order ID (e.g. DG-10421) and checkout phone number to check status, or open a Payment Dispute ticket with your transfer screenshot on Track Order. Never share your PIN or OTP.`,
      intent: 'payment_dispute',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('payment_dispute', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 12c. Late Delivery Follow-up
  if (
    /(late\s*delivery|delay|delayed|not\s*delivered|haven'?t\s*received|still\s*not\s*received|overdue|এখনো\s*পাইনি|দেরি|আসেনি|দেরী)/i.test(
      clean
    )
  ) {
    addTrackAction();
    addPhoneAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `ডেলিভারিতে দেরি হওয়ার জন্য আন্তরিকভাবে দুঃখিত। আপনার Order ID (যেমন DG-10421) এবং চেকআউটের ১১ সংখ্যার মোবাইল নম্বর দিন, আমি ডেলিভারি টাইমলাইন পরীক্ষা করে প্রয়োজনে জরুরি (Urgent) ফলো-আপ টিকিট খুলে দেব অথবা /track পেজ ব্যবহার করুন।`
        : `We apologize for any delivery delay. Please share your Order ID (e.g. DG-10421) and checkout phone number so I can inspect the delivery timeline and open an Urgent Late Delivery follow-up ticket if overdue, or check via Track Order below.`,
      intent: 'late_delivery',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('late_delivery', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 12d. One-Click Reorder & Refill Reminder
  if (
    /(reorder|order\s*again|buy\s*again|same\s*as\s*last|refill\s*reminder|আবার\s*অর্ডার|রিঅর্ডার|আগের\s*মত|আগের\s*মতো|রিফিল\s*রিমাইন্ডার)/i.test(
      clean
    )
  ) {
    addTrackAction();
    addOrderAction();
    return {
      replyText: isBn
        ? `আগের মতোই সহজে রিঅর্ডার করতে বা রিফিল রিমাইন্ডার সেট করতে আপনার আগের Order ID (যেমন DG-10421) এবং চেকআউট মোবাইল নম্বর দিন—আমি লাইভ স্টক ও বর্তমান মূল্য যাচাই করে ওয়ান-ক্লিক রিঅর্ডার লিংক তৈরি করে দেব।`
        : `To prepare a one-click reorder from your previous order or set an opt-in refill reminder, please share your previous Order ID (e.g. DG-10421) and checkout phone number.`,
      intent: 'reorder',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('reorder', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 13. Order Tracking
  if (/(track|ট্র্যাক|অবস্থা|status|কবে আসবে|অর্ডার কোথায়|dg-\d+)/i.test(clean)) {
    addTrackAction();
    return {
      replyText: isBn
        ? `আপনার অর্ডারের বর্তমান অবস্থা জানতে আপনার Order ID (যেমন DG-1042) এবং চেকআউটের ১১ সংখ্যার মোবাইল নম্বর দিন, অথবা নিচের 'অর্ডার ট্র্যাক করুন' বাটন ব্যবহার করুন।`
        : `To check your live order progress, share BOTH your Order ID (e.g. DG-1042) and checkout phone number, or click 'Track Order' below.`,
      intent: 'tracking',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('tracking', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 14. How to place an order
  if (/(order|অর্ডার|কিনব|নিব|কিনি|buy|purchase|নিবো|লাগবে|নেব|নিতে চাই)/i.test(clean)) {
    addOrderAction();
    addWhatsAppAction();

    if (!facts.orderingReady) {
      return {
        replyText: isBn
          ? `দুঃখিত, স্টোরের মূল্য ও ডেলিভারি চার্জ নির্ধারণের কাজ চলমান থাকায় অনলাইন অর্ডার সাময়িকভাবে বন্ধ রয়েছে। চূড়ান্ত হওয়ার সাথে সাথেই অর্ডার গ্রহণ শুরু হবে। যেকোনো তথ্যের জন্য সরাসরি ফোনে বা WhatsApp-এ যোগাযোগ করতে পারেন।`
          : `Online ordering is temporarily unavailable while prices and delivery charges are being finalized by the owner. Please contact us via WhatsApp or phone.`,
        intent: 'order',
        actions,
        suggestedReplies: buildContextualSuggestedReplies('order', replyLang, params.activeDraft),
        factsVersion: facts.factsVersion,
      };
    }

    return {
      replyText: isBn
        ? `অর্ডার করার পদ্ধতি খুবই সহজ:\n১. এখানে আপনার পছন্দের সাইজ (২৫০ গ্রাম / ৫০০ গ্রাম / ১ কেজি) দিয়ে শুরু করুন — আমি ধাপে ধাপে অর্ডার সারাংশ তৈরি করে দেব।\n২. অথবা নিচের 'অনলাইনে অর্ডার করুন' বা WhatsApp বাটন ব্যবহার করুন।`
        : `How to place an order:\n1. Tell me your preferred jar size (250g, 500g, or 1kg) right here and I will prepare an interactive Order Summary step by step.\n2. Or use 'Order Online' or 'Chat on WhatsApp' below.`,
      intent: 'order',
      actions,
      productCards: buildProductComparisonCards(settings, '500g'),
      suggestedReplies: buildContextualSuggestedReplies('order', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 15. Contact details & Support
  if (/(contact|phone|whatsapp|ফোন|যোগাযোগ|ঠিকানা|address|হোয়াটসঅ্যাপ|কথা বলতে|help|সাপোর্ট|লোকেশন)/i.test(clean)) {
    addPhoneAction();
    addWhatsAppAction();
    const phoneLine = displayPhone ? `\nহেল্পলাইন: ${displayPhone}` : '';
    const waLine = displayWhatsApp ? `\nWhatsApp: ${displayWhatsApp}` : '';
    const phoneLineEn = displayPhone ? `\nPhone: ${displayPhone}` : '';
    const waLineEn = displayWhatsApp ? `\nWhatsApp: ${displayWhatsApp}` : '';
    return {
      replyText: isBn
        ? `দেশী ঘি (Deshi Gee) কাস্টমার সাপোর্ট:${phoneLine}${waLine}\nঠিকানা: ${displayAddress}\n\nসরাসরি কথা বলতে নিচের বাটন ব্যবহার করুন।`
        : `Deshi Gee Customer Support:${phoneLineEn}${waLineEn}\nAddress: ${displayAddress}`,
      intent: 'human_help',
      actions,
      suggestedReplies: buildContextualSuggestedReplies('default', replyLang, params.activeDraft),
      factsVersion: facts.factsVersion,
    };
  }

  // 16. Clear "no verified information" path when no FAQ/KB/live rule matches specific unverified queries
  addWhatsAppAction();
  addPhoneAction();
  const honestNoInfoReply = isBn
    ? config.fallbackMessageBn ||
      'দুঃখিত, এই নির্দিষ্ট বিষয়টির যাচাইকৃত তথ্য এই মুহূর্তে আমার কাছে নেই। সঠিক তথ্যের জন্য আমাদের কাস্টমার সাপোর্টে ফোন বা WhatsApp-এ যোগাযোগ করুন।'
    : config.fallbackMessageEn ||
      "Sorry, I don't have verified information on that specific point right now. Please contact our customer support team via Phone or WhatsApp below.";
  return {
    replyText: honestNoInfoReply,
    intent: 'unknown',
    actions,
    noVerifiedInfo: true,
    suggestedReplies: buildContextualSuggestedReplies('default', replyLang, params.activeDraft),
    factsVersion: facts.factsVersion,
  };
}
