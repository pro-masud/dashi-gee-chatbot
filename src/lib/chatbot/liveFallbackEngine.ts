import type {
  ChatActionItem,
  ChatbotConfigDoc,
  ChatbotFaqDoc,
} from './types';
import type { BatchRecord, StoreSettingsDoc } from '../storeTypes';
import { normalizeWeight } from '../gemini/tools';
import { convertBanglaDigitsToEnglish } from './domain-guard';

export interface LiveFallbackResult {
  replyText: string;
  intent: string;
  actions: ChatActionItem[];
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
}): LiveFallbackResult {
  const { userMessage, replyLang, settings, batch, config, matchedFaqs } = params;
  const isBn = replyLang === 'bn';
  const clean = convertBanglaDigitsToEnglish(userMessage).toLowerCase().trim();
  const actions: ChatActionItem[] = [];

  const displayPhone = settings.supportPhone.toLowerCase().includes('configure')
    ? '+880 1700-000000'
    : settings.supportPhone;
  const displayWhatsApp = settings.whatsappNumber.toLowerCase().includes('configure')
    ? '+880 1700-000000'
    : settings.whatsappNumber;
  const displayAddress = settings.businessAddress.toLowerCase().includes('configurable')
    ? 'ঢাকা ও পাবনা, বাংলাদেশ'
    : settings.businessAddress;

  const addPhoneAction = () => {
    const digits = cleanDigits(displayPhone);
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
    const waText = encodeURIComponent(
      isBn
        ? 'আসসালামু আলাইকুম, দেশী ঘি অর্ডার করতে চাই।'
        : 'Hello, I would like to order Deshi Gee.'
    );
    pushAction(actions, {
      type: 'whatsapp',
      labelEn: 'Chat on WhatsApp',
      labelBn: 'WhatsApp-এ অর্ডার',
      value: displayWhatsApp,
      href: `https://wa.me/${digits}?text=${waText}`,
    });
  };

  const addOrderAction = () => {
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

  // 1. Matched verified FAQs from store database
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
      };
    }
  }

  // 2. Greetings & Courtesy
  if (
    /(assalamu|salam|সালাম|হ্যালো|হাই|hello|hi|hey|কেমন আছেন|valo|bhalo)/i.test(clean) &&
    !clean.includes('দাম') &&
    !clean.includes('অর্ডার') &&
    !clean.includes('ডেলিভারি')
  ) {
    addOrderAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `ওয়ালাইকুম আসসালাম! Deshi Gee-তে আপনাকে স্বাগতম। আমি আপনার ভার্চুয়াল সহকারী। আমাদের পাবনার ঐতিহ্যবাহী কাঠের বিলোনার গাওয়া ঘি, দাম, সাইজ, ডেলিভারি বা যেকোনো তথ্যে সাহায্য করতে পারি। আপনি কীভাবে সাহায্য চান?`
        : `Assalamu Alaikum! Welcome to Deshi Gee. I am your virtual assistant. How can I help you today with our Pabna bilona cow ghee, jar sizes, prices, or orders?`,
      intent: 'greeting',
      actions,
    };
  }

  // 3. Payment methods (COD, bKash, Nagad) - Check before delivery
  if (/(payment|cod|cash on delivery|পেমেন্ট|ক্যাশ অন|ক্যাশঅন|বিকাশ|নগদ|bkash|nagad)/i.test(clean)) {
    addWhatsAppAction();
    addOrderAction();
    return {
      replyText: isBn
        ? `পেমেন্ট পদ্ধতিসমূহ:\n১. ক্যাশ অন ডেলিভারি (COD): সারা দেশে পণ্য হাতে পেয়ে ডেলিভারিম্যানের সামনে জার দেখে নিশ্চিন্তে মূল্য পরিশোধ করুন।\n২. বিকাশ ও নগদ: অগ্রিম পেমেন্টে ${settings.advanceDiscountPct}% বিশেষ ক্যাশব্যাক/মূল্যছাড় সুবিধা রয়েছে।\n\n⚠️ নিরাপত্তার স্বার্থে কখনোই কারো সাথে আপনার বিকাশ বা নগদ পিন (PIN) বা OTP শেয়ার করবেন না।`
        : `Payment options:\n1. Cash on Delivery (COD) across all 64 districts in Bangladesh.\n2. bKash / Nagad advance payment with ${settings.advanceDiscountPct}% special discount.\n\nNever share your PIN or OTP with anyone.`,
      intent: 'payment',
      actions,
    };
  }

  // 4. Delivery & Shipping details
  if (
    /(delivery|shipping|courier|ডেলিভারি|কুরিয়ার|পৌঁছাবে|পৌছাবে)/i.test(clean) ||
    (clean.includes('চার্জ') && !clean.includes('দাম'))
  ) {
    addOrderAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `আমাদের ডেলিভারি সংক্রান্ত নিয়ম ও সময়সূচী:\n• ঢাকা সিটির ভেতরে: চার্জ ৳${settings.insideDhakaFee} (ডেলিভারি সময়: ${settings.estimatedDhakaDays})\n• সারা বাংলাদেশ (ঢাকার বাইরে): চার্জ ৳${settings.outsideDhakaFee} (ডেলিভারি সময়: ${settings.estimatedOutsideDays})\n• ৳${settings.freeDeliveryThreshold} টাকার বা তার বেশি অর্ডারে সারা দেশে ডেলিভারি সম্পূর্ণ ফ্রি!\n\n📦 সারা বাংলাদেশে ক্যাশ অন ডেলিভারি (পণ্য হাতে পেয়ে মূল্য পরিশোধ) সুবিধা রয়েছে।`
        : `Delivery details:\n• Inside Dhaka: ৳${settings.insideDhakaFee} (${settings.estimatedDhakaDays})\n• Outside Dhaka / Nationwide: ৳${settings.outsideDhakaFee} (${settings.estimatedOutsideDays})\n• Free delivery nationwide for orders of ৳${settings.freeDeliveryThreshold} or above!\n\nCash on Delivery is available across all 64 districts.`,
      intent: 'delivery',
      actions,
    };
  }

  // 5. Price inquiry (specific weight or all weights)
  if (
    /(dam|price|cost|taka|rate|দাম|মূল্য|টাকা|দর|প্রাইস)/i.test(clean) ||
    (detectedWeight && /(koto|কত|দাম|price)/i.test(clean))
  ) {
    addOrderAction();
    addWhatsAppAction();

    if (detectedWeight === '250g') {
      return {
        replyText: isBn
          ? `আমাদের ২৫০ গ্রাম (250g) দেশী ঘিয়ের জারটির মূল্য ৳${settings.price250g}। বর্তমান স্টকে ${settings.stock250g}টি জার উপলব্ধ আছে।\n\n🚚 ৳${settings.freeDeliveryThreshold} টাকার অর্ডারে সারা দেশে ডেলিভারি সম্পূর্ণ ফ্রি!`
          : `Our 250g Deshi Gee jar is priced at ৳${settings.price250g} (${settings.stock250g} jars in stock).\n\n🚚 Free delivery nationwide for orders of ৳${settings.freeDeliveryThreshold} or more!`,
        intent: 'price_specific',
        actions,
      };
    }
    if (detectedWeight === '500g') {
      return {
        replyText: isBn
          ? `আমাদের ৫০০ গ্রাম (500g) পারিবারিক সাইজের দেশী ঘিয়ের জারটির মূল্য ৳${settings.price500g}। বর্তমান স্টকে ${settings.stock500g}টি জার উপলব্ধ আছে।\n\n🚚 ৳${settings.freeDeliveryThreshold} টাকার অর্ডারে সারা দেশে ডেলিভারি সম্পূর্ণ ফ্রি!`
          : `Our 500g Family Kitchen Deshi Gee jar is priced at ৳${settings.price500g} (${settings.stock500g} jars in stock).\n\n🚚 Free delivery nationwide for orders of ৳${settings.freeDeliveryThreshold} or more!`,
        intent: 'price_specific',
        actions,
      };
    }
    if (detectedWeight === '1kg') {
      return {
        replyText: isBn
          ? `আমাদের ১ কেজি (1kg) দেশী ঘিয়ের জারটির মূল্য ৳${settings.price1kg}। বর্তমান স্টকে ${settings.stock1kg}টি জার উপলব্ধ আছে।\n\n🚚 ৳${settings.freeDeliveryThreshold} টাকার অর্ডারে সারা দেশে ডেলিভারি সম্পূর্ণ ফ্রি!`
          : `Our 1kg Deshi Gee jar is priced at ৳${settings.price1kg} (${settings.stock1kg} jars in stock).\n\n🚚 Free delivery nationwide for orders of ৳${settings.freeDeliveryThreshold} or more!`,
        intent: 'price_specific',
        actions,
      };
    }

    return {
      replyText: isBn
        ? `পাবনার খাঁটি কাঠের বিলোনার গাওয়া ঘিয়ের বর্তমান মূল্য তালিকা:\n• ২৫০ গ্রাম: ৳${settings.price250g} (স্টক: ${settings.stock250g}টি)\n• ৫০০ গ্রাম: ৳${settings.price500g} (স্টক: ${settings.stock500g}টি)\n• ১ কেজি: ৳${settings.price1kg} (স্টক: ${settings.stock1kg}টি)\n\n🚚 ৳${settings.freeDeliveryThreshold} টাকার বা তার বেশি অর্ডারে সারা দেশে ডেলিভারি সম্পূর্ণ ফ্রি!\nসরাসরি ওয়েবসাইটে বা WhatsApp-এ অর্ডার করতে পারেন।`
        : `Current prices for Pabna Grass-Fed Bilona Cow Ghee:\n• 250g: ৳${settings.price250g} (${settings.stock250g} in stock)\n• 500g: ৳${settings.price500g} (${settings.stock500g} in stock)\n• 1kg: ৳${settings.price1kg} (${settings.stock1kg} in stock)\n\n🚚 Free delivery nationwide on orders of ৳${settings.freeDeliveryThreshold} or more!`,
      intent: 'price_all',
      actions,
    };
  }

  // 6. Size & Packaging inquiry
  if (/(size|sizes|weight|weights|সাইজ|ওজন|বয়াম|জার|প্যাকেট|বোতল|variant)/i.test(clean)) {
    addOrderAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `Deshi Gee ৩টি এয়ারটাইট সিলযুক্ত প্রিমিয়াম কাঁচের জারে পাওয়া যায়:\n১. ২৫০ গ্রাম — ছোট ট্রায়াল সাইজ (৳${settings.price250g})\n২. ৫০০ গ্রাম — নিয়মিত পারিবারিক সাইজ (৳${settings.price500g})\n৩. ১ কেজি — বড় সাশ্রয়ী সাইজ (৳${settings.price1kg})\n\nসবগুলো জার পরিষ্কার অ্যাপোথেকারি কাঁচের বয়ামে উষ্ণাবস্থায় সুবাস ধরে রেখে সিল করা হয়। আপনি কোন সাইজটি নিতে চান?`
        : `Deshi Gee is available in 3 sealed apothecary glass jar sizes:\n1. 250g — Starter Jar (৳${settings.price250g})\n2. 500g — Family Kitchen Jar (৳${settings.price500g})\n3. 1kg — Household Reserve Jar (৳${settings.price1kg})\n\nEach jar is poured warm and sealed with airtight brass-toned foil to lock in fresh aroma.`,
      intent: 'sizes',
      actions,
    };
  }

  // 7. Stock check
  if (/(stock|স্টক|মজুদ|available|পাওয়া যাবে)/i.test(clean)) {
    addOrderAction();
    return {
      replyText: isBn
        ? `বর্তমান ব্যাচের (${batch.batchCode}) লাইভ স্টক:\n• ২৫০ গ্রাম: ${settings.stock250g}টি জার উপলব্ধ\n• ৫০০ গ্রাম: ${settings.stock500g}টি জার উপলব্ধ\n• ১ কেজি: ${settings.stock1kg}টি জার উপলব্ধ\n\nস্টক সীমিত থাকায় আপনার প্রয়োজনীয় সাইজ এখনই অর্ডার করে নিশ্চিত করতে পারেন।`
        : `Live stock for Batch ${batch.batchCode}:\n• 250g: ${settings.stock250g} jars\n• 500g: ${settings.stock500g} jars\n• 1kg: ${settings.stock1kg} jars`,
      intent: 'stock',
      actions,
    };
  }

  // 8. Purity, Ingredients & Traditional Craft
  if (
    /(pure|purity|khanti|খাঁটি|আসল|ভেজাল|উপাদান|উপকরন|বানান|তৈরি|দই|বিলোনা|গাওয়া|bilona|curd|danadar|দানা|ঘি কি|ঘিয়ের সুবাস)/i.test(
      clean
    )
  ) {
    addOrderAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `Deshi Gee-এর বিশুদ্ধতা ও বৈশিষ্ট্য:\n• ১০০% খাঁটি পাবনার চারণভূমির দেশী গরুর সকালের তাজা দুধ।\n• মাটির হাঁড়িতে পাতা দই কাঠের বিলোনায় মন্থন করে মাখন আলাদা করা হয়।\n• মৃদু আঁচে জ্বাল দিয়ে তৈরি হয় প্রাকৃতিক দানাদার টেক্সচার ও হালকা বাদামী মিষ্টি সুবাস।\n• কোনো সংরক্ষক (preservative), ডালডা বা ভেজিটেবল অয়েল মেশানো হয় না।`
        : `Deshi Gee Authenticity:\n• 100% pure grass-fed Pabna cow milk.\n• Cultured overnight into thick curd, wood-churned at dawn by traditional bilona.\n• Slow-simmered for coarse granular (danadar) texture and golden aroma.\n• Zero preservatives, vegetable oils, or additives.`,
      intent: 'craft_purity',
      actions,
    };
  }

  // 9. Storage, Shelf Life & Expiry
  if (/(store|storage|সংরক্ষণ|রাখব|নষ্ট|মেয়াদ|expiry|expire|shelf)/i.test(clean)) {
    return {
      replyText: isBn
        ? `ঘি সংরক্ষণের নিয়ম:\n• ঘরের স্বাভাবিক তাপমাত্রায় (১৮°C–২৫°C) শুকনো ও ছায়াযুক্ত স্থানে রাখুন।\n• ফ্রিজে রাখার প্রয়োজন নেই। সবসময় শুকনো ও পরিষ্কার চামচ ব্যবহার করুন।\n• বর্তমান ব্যাচ (${batch.batchCode})-এর মেয়াদ উৎপাদন তারিখ থেকে ১২ মাস পর্যন্ত অক্ষুণ্ণ থাকে।`
        : `Storage guidelines:\n• Keep in a dry, shaded cupboard at room temperature (18°C–25°C).\n• Refrigeration is not needed. Use a clean, dry spoon.\n• Current batch (${batch.batchCode}) has a 12-month shelf life from production.`,
      intent: 'storage',
      actions,
    };
  }

  // 10. How to place an order
  if (/(order|অর্ডার|কিনব|নিব|কিনি|buy|purchase|নিবো|লাগবে|নেব|নিতে চাই)/i.test(clean)) {
    addOrderAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `অর্ডার করার পদ্ধতি খুবই সহজ:\n১. ওয়েবসাইটের 'অর্ডার করুন' বাটনে ক্লিক করে আপনার পছন্দের সাইজ ও ঠিকানা দিন।\n২. অথবা নিচের 'WhatsApp-এ অর্ডার' বাটনে ক্লিক করে সরাসরি মেসেজ দিয়ে অর্ডার নিশ্চিত করতে পারেন।\n৩. অথবা এখানে আপনার নাম, মোবাইল নম্বর, সাইজ (২৫০ গ্রাম / ৫০০ গ্রাম / ১ কেজি) এবং ঠিকানা জানালে আমরা অর্ডার গ্রহণ করব।`
        : `How to place an order:\n1. Click 'Order Online' below to select your jar size and checkout.\n2. Or click 'Chat on WhatsApp' to place your order with 1 tap.\n3. Or share your name, phone, jar size (250g, 500g, 1kg), and address here.`,
      intent: 'order_placement',
      actions,
    };
  }

  // 11. Order Tracking
  if (/(track|ট্র্যাক|অবস্থা|status|কবে আসবে|অর্ডার কোথায়|dg-\d+)/i.test(clean)) {
    addTrackAction();
    return {
      replyText: isBn
        ? `আপনার অর্ডারের বর্তমান অবস্থা জানতে নিচের 'অর্ডার ট্র্যাক করুন' বাটনে ক্লিক করে আপনার Order ID (যেমন DG-1042) এবং মোবাইল নম্বর দিন। অথবা সহায়তার জন্য আমাদের সাপোর্টে যোগাযোগ করতে পারেন।`
        : `To check your live order progress, click 'Track Order' below and enter your Order ID (e.g. DG-1042) and phone number.`,
      intent: 'tracking',
      actions,
    };
  }

  // 12. Contact details & Support
  if (/(contact|phone|whatsapp|ফোন|যোগাযোগ|ঠিকানা|address|হোয়াটসঅ্যাপ|কথা বলতে|help|সাপোর্ট|লোকেশন)/i.test(clean)) {
    addPhoneAction();
    addWhatsAppAction();
    return {
      replyText: isBn
        ? `দেশী ঘি (Deshi Gee) কাস্টমার সাপোর্ট:\n📞 হেল্পলাইন: ${displayPhone}\n💬 WhatsApp: ${displayWhatsApp}\n📍 ঠিকানা: ${displayAddress}\n\nসরাসরি কথা বলতে নিচের বাটন ব্যবহার করুন।`
        : `Deshi Gee Customer Support:\n📞 Phone: ${displayPhone}\n💬 WhatsApp: ${displayWhatsApp}\n📍 Address: ${displayAddress}`,
      intent: 'contact',
      actions,
    };
  }

  // 13. Default helpful fallback response
  addOrderAction();
  addWhatsAppAction();
  addPhoneAction();
  return {
    replyText: isBn
      ? `আমি দেশী ঘি (Deshi Gee)-এর সহকারী। আমাদের খাঁটি পাবনার গাওয়া ঘি, দাম (২৫০ গ্রাম: ৳${settings.price250g}, ৫০০ গ্রাম: ৳${settings.price500g}, ১ কেজি: ৳${settings.price1kg}), ডেলিভারি, অথবা অর্ডার বিষয়ে যেকোনো প্রশ্ন করতে পারেন। কীভাবে সহায়তা করতে পারি?`
      : `I am your Deshi Gee assistant. I can help with our authentic Pabna bilona cow ghee, pricing (250g: ৳${settings.price250g}, 500g: ৳${settings.price500g}, 1kg: ৳${settings.price1kg}), delivery, and orders. How can I assist you?`,
    intent: 'general_help',
    actions,
  };
}
