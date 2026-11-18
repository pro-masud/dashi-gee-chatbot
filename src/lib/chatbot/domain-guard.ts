import { CHATBOT_BUILD_CONFIG } from './build-config';

const BN_DIGITS: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

export function convertBanglaDigitsToEnglish(text: string): string {
  return String(text || '').replace(/[০-৯]/g, (d) => BN_DIGITS[d] || d);
}

export function stripUnsafeHtml(
  input: string,
  maxLen: number = CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS
): string {
  return String(input || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?[^>]+(>|$)/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function maskSensitivePii(text: string): string {
  let out = String(text || '');
  // Mask Bangladesh mobile numbers (keep prefix 3 + last 3 digits, e.g., 017****5678 -> 017****678)
  out = out.replace(/(\+?88)?(01[3-9])\d{5}(\d{3})/g, (_m, cc, prefix, tail) => {
    return `${cc ? '+88' : ''}${prefix}*****${tail}`;
  });
  // Mask explicit house/road/flat address fragments in log transcripts
  out = out.replace(
    /\b(house|holding|flat|floor|apartment|road|rd|lane|sector|block)\s*(?:no\.?|#|:|-)?\s*[a-z0-9/\-,\s]{2,28}/gi,
    '[MASKED_ADDRESS]'
  );
  out = out.replace(
    /(বাসা|হোল্ডিং|ফ্ল্যাট|রোড|রাস্তা|সেক্টর|ব্লক)\s*(?:নং|নম্বর|:|-)?\s*[^\n,;।]{2,28}/g,
    '[MASKED_ADDRESS]'
  );
  return out;
}

const GHEE_DOMAIN_PATTERN =
  /(deshi\s*gee|deshi\s*ghee|দেশী\s*ঘি|দেশি\s*ঘি|\bghee\b|\bgee\b|ঘি|ঘিয়ের|ঘির|পাবনা|pabna|bilona|বিলোনা|দানা|danadar|দই|curd|makkhan|মাখন|jar|জার|বয়াম|\bsize\b|\bsizes\b|সাইজ|weight|weights|ওজন|পরিমাণ|variant|variants|ভ্যারিয়েন্ট|বোতল|bottle|প্যাকেট|packet|250\s*g|500\s*g|1\s*kg|১\s*কেজি|গ্রাম|কেজি|kg|gm|price|dam|দাম|মূল্য|koto|কত|cost|taka|টাকা|stock|স্টক|অর্ডার|order|buy|kinte|কিনব|নিব|nibo|lagbe|লাগবে|delivery|ডেলিভারি|shipping|courier|কুরিয়ার|ঢাকা|dhaka|district|জেলা|address|ঠিকানা|location|লোকেশন|map|ম্যাপ|hours|খোলা|বন্ধ|phone|ফোন|whatsapp|হোয়াটসঅ্যাপ|contact|যোগাযোগ|bkash|বিকাশ|nagad|নগদ|cod|cash\s*on\s*delivery|payment|পেমেন্ট|track|ট্র্যাক|status|অবস্থা|dg-\d+|return|রিটার্ন|refund|রিফান্ড|replace|ভাঙা|নষ্ট|store|সংরক্ষণ|storage|shelf\s*life|মেয়াদ|batch|ব্যাচ|offer|অফার|discount|ছাড়|coupon|কুপন|khichuri|খিচুড়ি|polao|পোলাও|halua|হালুয়া|paratha|পরোটা|ruti|রুটি|bhaat|ভাত|support|সাপোর্ট|help|সাহায্য|human|মানুষ|agent)/i;

const GREETING_OR_CONVERSATIONAL_CONTINUATION_PATTERN =
  /^(hi|hello|hey|assalamu\s*alaikum|salam|oa\s*alaikum|ওয়ালাইকুম|সালাম|হ্যালো|হাই|ধন্যবাদ|thanks|thank you|ok|okay|yes|হ্যাঁ|জ্বি|জি|না|no|dhonnobad|bhalo|ভালো|আছি|bangla|english|01[3-9]\d{8}|[০-৯]{11}|250\s*g|500\s*g|1\s*kg|১\s*কেজি|২৫০\s*গ্রাম|৫০০\s*গ্রাম|\d+\s*(টি|টা|জার|jar|jars)?)$/i;

const DISALLOWED_OFF_TOPIC_PATTERN =
  /(\b(politics|political|election|vote|parliament|prime\s*minister|president|minister|government|bnp|awami\s*league|jamaat|diplomacy|war)\b|(রাজনীতি|নির্বাচন|ভোট|সংসদ|প্রধানমন্ত্রী|রাষ্ট্রপতি|সরকার|আওয়ামী|বিএনপি)|\b(religion|islam|hinduism|christianity|bible|quran|hadith|fatwa|namaz|puja)\b|(ধর্ম|ফতোয়া|কুরআন|হাদিস|নামাজ|পূজা)|\b(python|javascript|typescript|react|next\.js|html|css|sql|c\+\+|java\b|coding|programming|algorithm|leetcode|regex|api\s*code|write\s*code|debug\s*code)\b|(প্রোগ্রামিং|কোডিং|পাইথন)|\b(homework|math\s*equation|calculus|physics|chemistry|essay|translate\s*this\s*poem|horoscope|astrology|celebrity|movie|cinema|actor|actress|cricket\s*score|football\s*match|ipl|bpl|world\s*cup|bitcoin|crypto|ethereum|stock\s*market|forex)\b|\b(jokes?|tell\s*me\s*a\s*joke|poem|story\s*about\s*dragons|capital\s*of|weather\s*in)\b|(কৌতুক|জোকস|ক্রিকেট\s*স্কোর|সিনেমা|নায়ক|রাশিফল)|\b(mustard\s*oil|olive\s*oil|coconut\s*oil|butter|honey|aarong|pran|radhuni|shwapno|chaldal|kazi\s*farms|teer|rupchanda|saffola)\b|(সরিষার\s*তেল|মধু|মাখন|আড়ং|প্রাণ|স্বপ্ন|চালডাল))/i;

export type DomainClassificationCategory =
  | 'allowed_ghee'
  | 'mixed_question'
  | 'disallowed_off_topic';

export interface DomainClassificationResult {
  category: DomainClassificationCategory;
  filteredPromptForGemini: string;
  mixedNoticeNeeded: boolean;
  blockedTopics: string[];
}

export function classifyDomainRequest(
  rawMessage: string,
  hasActiveOrderContext = false
): DomainClassificationResult {
  const normalized = convertBanglaDigitsToEnglish(stripUnsafeHtml(rawMessage, 500));
  if (!normalized) {
    return {
      category: 'disallowed_off_topic',
      filteredPromptForGemini: '',
      mixedNoticeNeeded: false,
      blockedTopics: ['empty'],
    };
  }

  // Pure greeting or short phone / quantity / address reply while chatting with Deshi Gee
  if (GREETING_OR_CONVERSATIONAL_CONTINUATION_PATTERN.test(normalized.trim())) {
    return {
      category: 'allowed_ghee',
      filteredPromptForGemini: normalized,
      mixedNoticeNeeded: false,
      blockedTopics: [],
    };
  }

  // Split into sentence / clause segments to catch mixed questions cleanly
  const clauses = normalized
    .split(/(?<=[?!।.])\s+|\n+|(?:\s*,\s*(?:also|and\s+also|btw|আর|এবং|এছাড়া)\s+)/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const allowedClauses: string[] = [];
  const disallowedClauses: string[] = [];

  for (const clause of clauses) {
    const isGhee = GHEE_DOMAIN_PATTERN.test(clause);
    const isDisallowed = DISALLOWED_OFF_TOPIC_PATTERN.test(clause);

    if (isDisallowed && !isGhee) {
      disallowedClauses.push(clause);
    } else if (isDisallowed && isGhee) {
      // Single clause mixes both: check if asking about competitor/other products with ghee
      if (/\b(aarong|pran|shwapno|chaldal|mustard\s*oil|honey|মাখন|মধু|সরিষার\s*তেল)\b/i.test(clause)) {
        disallowedClauses.push(clause);
      } else {
        allowedClauses.push(clause);
      }
    } else if (isGhee || hasActiveOrderContext) {
      allowedClauses.push(clause);
    } else {
      // Check clear general knowledge or off-topic phrasing lacking any Deshi Gee context
      if (
        /\b(who\s+is|what\s+is\s+the\s+capital|write\s+a\s+|explain\s+quantum|solve\s+\d+|translate\s+)\b/i.test(
          clause
        )
      ) {
        disallowedClauses.push(clause);
      } else {
        allowedClauses.push(clause);
      }
    }
  }

  if (disallowedClauses.length > 0 && allowedClauses.length === 0) {
    return {
      category: 'disallowed_off_topic',
      filteredPromptForGemini: '',
      mixedNoticeNeeded: false,
      blockedTopics: disallowedClauses.slice(0, 3),
    };
  }

  if (disallowedClauses.length > 0 && allowedClauses.length > 0) {
    return {
      category: 'mixed_question',
      filteredPromptForGemini: allowedClauses.join(' '),
      mixedNoticeNeeded: true,
      blockedTopics: disallowedClauses.slice(0, 3),
    };
  }

  return {
    category: 'allowed_ghee',
    filteredPromptForGemini: normalized,
    mixedNoticeNeeded: false,
    blockedTopics: [],
  };
}
