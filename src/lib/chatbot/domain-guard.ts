import type { WeightKey } from '../storeTypes';
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

export function normalizeWeight(raw: unknown): WeightKey | null {
  if (!raw) return null;
  const s = convertBanglaDigitsToEnglish(String(raw || ''))
    .toLowerCase()
    .replace(/[\s\-_.]+/g, '');
  if (!s) return null;

  // 250g variations (must run before generic 'kg' match so 'poya kg' / 'quarter kg' resolves to 250g)
  if (
    s.includes('250') ||
    s.includes('পোয়া') ||
    s.includes('পোয়া') ||
    s.includes('poya') ||
    s.includes('poa') ||
    s.includes('quarter')
  ) {
    return '250g';
  }

  // 500g variations (must run before generic 'kg' match so 'adha kg' / 'half kg' resolves to 500g)
  if (
    s.includes('500') ||
    s.includes('হাফ') ||
    s.includes('half') ||
    s.includes('আধা') ||
    s.includes('আধ') ||
    s.includes('অর্ধেক') ||
    s.includes('adha') ||
    s.includes('ardhek')
  ) {
    return '500g';
  }

  // 1kg variations
  if (
    s.includes('1kg') ||
    s.includes('1000') ||
    s.includes('কেজি') ||
    s.includes('kg') ||
    s === '1' ||
    s.includes('এককেজি') ||
    s.includes('onekg')
  ) {
    return '1kg';
  }

  // Relative size terms
  if (s.includes('ছোট') || s === 'small') return '250g';
  if (s.includes('মাঝারি') || s === 'medium') return '500g';
  if (s.includes('বড়') || s.includes('বড়') || s === 'large') return '1kg';

  return null;
}

export function stripUnsafeHtml(
  input: string,
  maxLen: number = CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS
): string {
  return String(input || '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
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
  // Mask Bangladesh mobile numbers (keep prefix 3 + last 3 digits, e.g., 017*****678)
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
  /(deshi\s*gee|deshi\s*ghee|দেশী\s*ঘি|দেশি\s*ঘি|\bghee\b|\bgee\b|ঘি(?:য়ের|য়ের|য়ে|র|টা|টি)?|পাবনা|pabna|pabnar|bilona|বিলোনা|দানা|danadar|দই|curd|dahi|doi|makkhan|মাখন|clarified\s*butter|cultured\s*butter|\bbutter\b|milkfat|\bjar\b|jar\b|জার|বয়াম|বয়াম|boyaam|boyam|\bsize\b|\bsizes\b|সাইজ|weight|weights|ওজন|পরিমাণ|variant|variants|ভ্যারিয়েন্ট|ভ্যারিয়েন্ট|বোতল|bottle|প্যাকেট|packet|250\s*g|500\s*g|1\s*kg|১\s*কেজি|গ্রাম|কেজি|\bkg\b|\bgm\b|\bprice\b|\bdam\b|\bdaam\b|দাম|মূল্য|\bcost\b|\btaka\b|\btka\b|\btk\b|টাকা|\bstock\b|স্টক|অর্ডার|\border\b|\bbuy\b|kinte|কিনব|নিব|nibo|lagbe|লাগবে|delivery|ডেলিভারি|shipping|courier|কুরিয়ার|কুরিয়ার|ঢাকা|dhaka|district|জেলা|address|ঠিকানা|location|লোকেশন|\bmap\b|ম্যাপ|\bhours\b|খোলা|বন্ধ|phone|ফোন|whatsapp|হোয়াটসঅ্যাপ|হোয়াটসঅ্যাপ|contact|যোগাযোগ|bkash|বিকাশ|nagad|নগদ|\bcod\b|cash\s*on\s*delivery|payment|পেমেন্ট|\btrack\b|ট্র্যাক|\bstatus\b|অবস্থা|dg-\d+|return|রিটার্ন|refund|রিফান্ড|replace|ভাঙা|নষ্ট|broken|leak|leaking|অভিযোগ|complaint|\bstore\b|সংরক্ষণ|storage|shelf\s*life|মেয়াদ|মেয়াদ|\bbatch\b|ব্যাচ|\boffer\b|অফার|discount|ছাড়|ছাড়|ডিসকাউন্ট|coupon|কুপন|khichuri|খিচুড়ি|খিচুড়ি|polao|পোলাও|halua|হালুয়া|হালুয়া|paratha|পরোটা|ruti|রুটি|bhaat|ভাত|support|সাপোর্ট|help|সাহায্য|human|মানুষ|agent|recommend|suggest|compare|comparison|family|trial|gift|কোনটা|কোন\s*সাইজ|ভাল\s*হবে|ভালো\s*হবে|সাজেস্ট)/i;

const GREETING_OR_CONVERSATIONAL_CONTINUATION_PATTERN =
  /^(hi|hello|hey|assalamu\s*alaikum|salam|oa\s*alaikum|ওয়ালাইকুম|সালাম|হ্যালো|হাই|ধন্যবাদ|thanks|thank you|ok|okay|hmm|yes|হ্যাঁ|জ্বি|জি|না|no|dhonnobad|bhalo|ভালো|আছি|bangla|english|in\s+english|english\s+please|বাংলায়|বাংলাতে|banglish|(?:\+?88)?01[3-9]\d{8}|[০-৯]{11}|250\s*g|500\s*g|1\s*kg|১\s*কেজি|২৫০\s*গ্রাম|৫০০\s*গ্রাম|cod|bkash|nagad|\d+\s*(?:টি|টা|জার|jar|jars|ta|ti)?)$/i;

const ORDER_CONTINUATION_HINT_PATTERN =
  /\b(dhaka|chattogram|chittagong|ctg|sylhet|pabna|rajshahi|khulna|barishal|rangpur|mymensingh|cumilla|comilla|gazipur|narayanganj|savar|uttara|dhanmondi|mirpur|banani|gulshan|mohammadpur|badda|bashundhara|road|house|flat|block|sector|thana|txnid|trx)\b|(ঢাকা|চট্টগ্রাম|সিলেট|পাবনা|রাজশাহী|খুলনা|বরিশাল|রংপুর|ময়মনসিংহ|কুমিল্লা|গাজীপুর|নারায়ণগঞ্জ|উত্তরা|ধানমন্ডি|মিরপুর|রোড|বাসা|সেক্টর|থানা)/i;

const DISALLOWED_OFF_TOPIC_PATTERN =
  /(\b(politics|political|election|vote|parliament|prime\s*minister|president|minister|government|bnp|awami\s*league|jamaat|diplomacy|war)\b|(রাজনীতি|নির্বাচন|ভোট|সংসদ|প্রধানমন্ত্রী|রাষ্ট্রপতি|সরকার|আওয়ামী|আওয়ামী|বিএনপি)|\b(religion|islam|hinduism|christianity|bible|quran|hadith|fatwa|namaz|puja)\b|(ধর্ম|ফতোয়া|ফতোয়া|কুরআন|হাদিস|নামাজ|পূজা)|\b(python|javascript|typescript|react|next\.js|html|css|sql|c\+\+|java\b|coding|programming|algorithm|leetcode|regex|api\s*code|write\s*code|debug\s*code)\b|(প্রোগ্রামিং|কোডিং|পাইথন)|\b(homework|math\s*equation|calculus|physics|chemistry|essay|translate\s*this\s*poem|horoscope|astrology|celebrity|movie|cinema|actor|actress|cricket\s*score|football\s*match|ipl|bpl|world\s*cup|bitcoin|crypto|ethereum|stock\s*market|forex)\b|\b(jokes?|tell\s*me\s*a\s*joke|poem|story\s*about\s*dragons|capital\s*of|weather\s*in)\b|(কৌতুক|জোকস|ক্রিকেট\s*স্কোর|সিনেমা|নায়ক|রাশিফল)|\b(mustard\s*oil|olive\s*oil|coconut\s*oil|peanut\s*butter|almond\s*butter|honey|aarong|pran|radhuni|shwapno|chaldal|kazi\s*farms|teer|rupchanda|saffola)\b|(সরিষার\s*তেল|মধু|আড়ং|আড়ং|প্রাণ|স্বপ্ন|চালডাল))/i;

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
  const normalized = convertBanglaDigitsToEnglish(
    stripUnsafeHtml(rawMessage, CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS)
  ).normalize('NFC');
  if (!normalized) {
    return {
      category: 'disallowed_off_topic',
      filteredPromptForGemini: '',
      mixedNoticeNeeded: false,
      blockedTopics: ['empty'],
    };
  }

  // Pure greeting or short phone / quantity / address / language switch reply while chatting with Deshi Gee
  if (GREETING_OR_CONVERSATIONAL_CONTINUATION_PATTERN.test(normalized.trim())) {
    return {
      category: 'allowed_ghee',
      filteredPromptForGemini: normalized,
      mixedNoticeNeeded: false,
      blockedTopics: [],
    };
  }

  // Short slot replies during an active order / handover collection conversation
  if (
    hasActiveOrderContext &&
    !DISALLOWED_OFF_TOPIC_PATTERN.test(normalized) &&
    (ORDER_CONTINUATION_HINT_PATTERN.test(normalized) || normalized.length <= 120)
  ) {
    return {
      category: 'allowed_ghee',
      filteredPromptForGemini: normalized,
      mixedNoticeNeeded: false,
      blockedTopics: [],
    };
  }

  // Split into sentence / clause segments to catch mixed questions cleanly
  const clauses = normalized
    .split(/(?<=[?!।.])\s+|\n+|(?:\s*,\s*(?:also|and\s+also|btw|আর|এবং|এছাড়া|এছাড়া)\s+)/i)
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
      // Single clause mixes both: block unrelated competitor/oil/honey items explicitly asked alongside ghee
      if (
        /\b(aarong|pran|radhuni|shwapno|chaldal|mustard\s*oil|olive\s*oil|coconut\s*oil|peanut\s*butter|honey)\b|(মধু|সরিষার\s*তেল|আড়ং|আড়ং|প্রাণ)/i.test(
          clause
        )
      ) {
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
