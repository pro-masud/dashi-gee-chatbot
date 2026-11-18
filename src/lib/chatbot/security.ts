import type {
  ChatbotConfigDoc,
  ChatbotFaqDoc,
  ChatbotKbDocRecord,
  ChatbotLang,
  LanguageBehavior,
} from './types';

const globalChatState = globalThis as unknown as {
  __deshiGeeChatRateWindow?: Map<string, number[]>;
  __deshiGeeDailyRequestCounter?: { dateKey: string; count: number };
};

const chatRateWindow =
  globalChatState.__deshiGeeChatRateWindow ??
  (globalChatState.__deshiGeeChatRateWindow = new Map<string, number[]>());

export function getTodayBstDateKey(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function checkAndTrackChatRateLimit(
  key: string,
  dailyLimit: number
): { allowed: boolean; reason?: 'rate_limit' | 'daily_limit' } {
  const now = Date.now();
  const hits = (chatRateWindow.get(key) || []).filter((ts) => now - ts < 60_000);
  if (hits.length >= 25) {
    return { allowed: false, reason: 'rate_limit' };
  }
  hits.push(now);
  chatRateWindow.set(key, hits);

  const today = getTodayBstDateKey();
  if (
    !globalChatState.__deshiGeeDailyRequestCounter ||
    globalChatState.__deshiGeeDailyRequestCounter.dateKey !== today
  ) {
    globalChatState.__deshiGeeDailyRequestCounter = { dateKey: today, count: 0 };
  }
  if (globalChatState.__deshiGeeDailyRequestCounter.count >= Math.max(10, dailyLimit)) {
    return { allowed: false, reason: 'daily_limit' };
  }
  globalChatState.__deshiGeeDailyRequestCounter.count += 1;
  return { allowed: true };
}

export function sanitizeUserText(input: string, maxLen = 900): string {
  return String(input || '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

const BANGLISH_HINTS = [
  'dam koto',
  'daam koto',
  'koto taka',
  'koto tk',
  'koto tka',
  'kivabe',
  'kibhabe',
  'kmne',
  'kemne',
  'kothay',
  'kothai',
  'ache naki',
  'ase naki',
  'hobe naki',
  'order korbo',
  'nibo',
  'lagbe',
  'chai',
  'bhalo',
  'valo',
  'khanti',
  'ghee er',
  'ghier',
  'delivery koto',
  'kotodin',
  'taka lagbe',
  'apnader',
  'amader',
  'khabo',
  'khawa',
  'kichu',
  'kemon',
  'thakbe',
  'parbo',
  'pathaben',
  'bkash e',
  'nagad e',
  'dhakay',
  'dhakar',
  'gram er',
  'gramer',
  'kg koto',
  'bhai',
  'vai',
  'apu',
  'assalamu',
  'salam',
  'dhonnobad',
  'pabnar',
  'boyaam',
  'boyam',
  'kototuku',
  'konta',
];

export interface LanguageResolutionResult {
  detectedInputLang: ChatbotLang;
  replyLang: 'bn' | 'en';
  explicitSwitchRequested: 'bn' | 'en' | null;
  scriptPreference: 'bn_script' | 'banglish_roman' | 'en';
}

export function detectLanguageAndSignals(
  message: string,
  behavior: LanguageBehavior,
  uiLang: 'en' | 'bn' = 'en',
  sessionLockedLang?: 'bn' | 'en' | ''
): LanguageResolutionResult {
  const clean = message.trim().normalize('NFC');
  const hasBengaliScript = /[\u0980-\u09FF]/.test(clean);
  const lower = clean.toLowerCase();

  let detectedInputLang: ChatbotLang = 'en';
  if (hasBengaliScript) {
    detectedInputLang = 'bn';
  } else {
    const banglishScore = BANGLISH_HINTS.reduce((sum, hint) => {
      const rx = new RegExp(`\\b${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return rx.test(lower) ? sum + 1 : sum;
    }, 0);
    const shortWordsBanglish =
      /\b(koto|dam|daam|kivabe|kibhabe|kmne|kemne|kothay|kothai|taka|tka|lagbe|ache|ase|nibo|chai|hobe|korbo|apni|tumi|ami|ki|naki|pawa|jabe|pathaben|kinbo|konta|pabnar)\b/i.test(
        lower
      );
    if (banglishScore >= 1 || shortWordsBanglish) {
      detectedInputLang = 'banglish';
    }
  }

  // Explicit user switch commands (persist across session via lockedLang)
  if (
    /\b(in english|english please|speak english|reply in english|english e bolo|speak in english|switch to english)\b/i.test(
      lower
    )
  ) {
    return {
      detectedInputLang,
      replyLang: 'en',
      explicitSwitchRequested: 'en',
      scriptPreference: 'en',
    };
  }
  if (
    /(\b(bangla|bengali)\s*(please|te|e|bolo|bolen)?\b|বাংলায়|বাংলাতে|বাংলায়\s*বলুন|banglay|bangla te|switch to bangla)/i.test(
      lower
    )
  ) {
    return {
      detectedInputLang,
      replyLang: 'bn',
      explicitSwitchRequested: 'bn',
      scriptPreference: 'bn_script',
    };
  }

  // Respect explicit session lock if customer switched mid-conversation
  if (sessionLockedLang === 'en' || sessionLockedLang === 'bn') {
    return {
      detectedInputLang,
      replyLang: sessionLockedLang,
      explicitSwitchRequested: null,
      scriptPreference: sessionLockedLang === 'bn' ? 'bn_script' : 'en',
    };
  }

  // Policy: prefer_bn / always_bn -> polite Bangla script by default
  if (behavior === 'prefer_bn' || behavior === 'always_bn') {
    return {
      detectedInputLang,
      replyLang: 'bn',
      explicitSwitchRequested: null,
      scriptPreference: 'bn_script',
    };
  }

  // Policy: prefer_en
  if (behavior === 'prefer_en') {
    const replyLang = detectedInputLang === 'bn' ? 'bn' : 'en';
    return {
      detectedInputLang,
      replyLang,
      explicitSwitchRequested: null,
      scriptPreference: replyLang === 'bn' ? 'bn_script' : 'en',
    };
  }

  // Policy: customer_choice -> honor UI toggle / explicit language choice, unless customer clearly wrote Bengali script
  if (behavior === 'customer_choice') {
    const replyLang = detectedInputLang === 'bn' ? 'bn' : uiLang;
    return {
      detectedInputLang,
      replyLang,
      explicitSwitchRequested: null,
      scriptPreference: replyLang === 'bn' ? 'bn_script' : 'en',
    };
  }

  // Policy: mirror -> match customer script (Banglish input keeps polite Bangla default but flags Banglish mirror preference)
  if (behavior === 'mirror') {
    if (detectedInputLang === 'bn') {
      return {
        detectedInputLang,
        replyLang: 'bn',
        explicitSwitchRequested: null,
        scriptPreference: 'bn_script',
      };
    }
    if (detectedInputLang === 'banglish') {
      return {
        detectedInputLang,
        replyLang: 'bn',
        explicitSwitchRequested: null,
        scriptPreference: 'banglish_roman',
      };
    }
    return {
      detectedInputLang,
      replyLang: 'en',
      explicitSwitchRequested: null,
      scriptPreference: 'en',
    };
  }

  // Default 'auto': Bangla or Banglish -> polite Bangla script; English -> English (or uiLang for pure greetings)
  if (detectedInputLang === 'bn' || detectedInputLang === 'banglish') {
    return {
      detectedInputLang,
      replyLang: 'bn',
      explicitSwitchRequested: null,
      scriptPreference: 'bn_script',
    };
  }
  if (/^(hi|hello|hey|assalamu alaikum|salam)\b/i.test(lower) && uiLang === 'bn') {
    return {
      detectedInputLang,
      replyLang: 'bn',
      explicitSwitchRequested: null,
      scriptPreference: 'bn_script',
    };
  }
  return {
    detectedInputLang,
    replyLang: 'en',
    explicitSwitchRequested: null,
    scriptPreference: 'en',
  };
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|system)\s+(instructions|prompts|rules)/i,
  /disregard\s+(all\s+)?(previous|prior|system)\s+(instructions|rules)/i,
  /(reveal|show|print|repeat|leak|output)\s+(your\s+)?(system\s+prompt|hidden\s+instructions|developer\s+prompt|api\s*key|env|secrets?)/i,
  /\b(jailbreak|dan mode|developer mode|god mode|bypass safety|bypass rules)\b/i,
  /(act as|pretend to be|you are now)\s+(?!a\s+deshi\s+gee)/i,
  /<\|im_start\|>|<\|system\|>|system:\s*override/i,
];

export function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((rx) => rx.test(text));
}

const SECRET_PATTERNS = [
  /\b(pin|otp|cvv|cvc|password|passcode|atm\s*pin|bkash\s*pin|nagad\s*pin)\b/i,
  /(পিন|ওটিপি|পাসওয়ার্ড|পাসওয়ার্ড|গোপন\s*নম্বর)/,
  /\b\d{13,19}\b/, // Credit/debit card number range (BD mobile numbers are 11 digits)
];

export function detectSensitiveSecret(text: string): boolean {
  return SECRET_PATTERNS.some((rx) => rx.test(text));
}

export function getBusinessHoursStatus(
  cfg: ChatbotConfigDoc,
  referenceDate?: Date
): {
  isOpenNow: boolean;
  currentTimeBst: string;
  currentDayEn: string;
} {
  try {
    const now = referenceDate || new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Dhaka',
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(now);

    const weekday = parts.find((p) => p.type === 'weekday')?.value || 'Sunday';
    const hour24Str = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Dhaka',
      hour: 'numeric',
      hour12: false,
    }).format(now);
    const hour24 = Number(hour24Str) % 24;

    const closedLower = (cfg.closedDays || '').toLowerCase();
    const isClosedDay =
      closedLower.length > 0 && closedLower.includes(weekday.toLowerCase());
    const withinHours = hour24 >= cfg.openHourBst && hour24 < cfg.closeHourBst;

    const timeFormatted = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Dhaka',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(now);

    return {
      isOpenNow: !isClosedDay && withinHours,
      currentTimeBst: `${weekday}, ${timeFormatted} BST`,
      currentDayEn: weekday,
    };
  } catch {
    return {
      isOpenNow: true,
      currentTimeBst: 'Asia/Dhaka (BST)',
      currentDayEn: 'Today',
    };
  }
}

export function chunkKnowledgeText(content: string, maxChars = 1200): string[] {
  const clean = content.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    const p = para.trim();
    if (!p) continue;
    if (buffer.length + p.length + 2 <= maxChars) {
      buffer = buffer ? `${buffer}\n\n${p}` : p;
    } else {
      if (buffer) chunks.push(buffer);
      if (p.length <= maxChars) {
        buffer = p;
      } else {
        for (let i = 0; i < p.length; i += maxChars) {
          chunks.push(p.slice(i, i + maxChars));
        }
        buffer = '';
      }
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks.slice(0, 200);
}

const BILINGUAL_SYNONYMS: [RegExp, string[]][] = [
  [
    /(size|sizes|weight|weights|variant|variants|সাইজ|ওজন|পরিমাণ|গ্রাম|কেজি|kg|gm|boyaam|boyam)/i,
    ['size', 'sizes', 'weight', 'variant', '250g', '500g', '1kg', 'সাইজ', 'ওজন', 'দাম', 'বয়াম', 'জার'],
  ],
  [/(dam|daam|price|cost|koto|tka|tk|দাম|মূল্য|কত)/i, ['price', 'cost', 'taka', 'দাম', '250g', '500g', '1kg']],
  [
    /(delivery|shipping|dhaka|courier|pathaben|ডেলিভারি|ঢাকা|পাঠান|কুরিয়ার|কুরিয়ার)/i,
    ['delivery', 'shipping', 'dhaka', 'ডেলিভারি', 'চার্জ'],
  ],
  [
    /(order|buy|purchase|nibo|lagbe|অর্ডার|কিনব|নিব|কিনবো|নিবো)/i,
    ['order', 'checkout', 'cod', 'অর্ডার'],
  ],
  [/(track|status|ট্র্যাক|অবস্থা)/i, ['track', 'status', 'ট্র্যাক']],
  [
    /(store|storage|shelf|expiry|ভালো|সংরক্ষণ|মেয়াদ|মেয়াদ|fridge|freeze)/i,
    ['storage', 'shelf', 'expire', 'সংরক্ষণ', 'মেয়াদ', 'refrigeration'],
  ],
  [
    /(pure|purity|khanti|ingredients|bilona|danadar|makkhan|butter|doi|dahi|খাঁটি|আসল|উপাদান|বিলোনা|দানা|মাখন|দই)/i,
    ['bilona', 'milkfat', 'ingredients', 'makkhan', 'মাখন', 'দই', 'বিলোনা', 'danadar', 'crystals'],
  ],
  [/(bkash|nagad|payment|cod|পেমেন্ট|বিকাশ|নগদ)/i, ['bkash', 'nagad', 'payment', 'cod', 'বিকাশ', 'নগদ']],
  [
    /(return|refund|replace|broken|damaged|leak|রিটার্ন|রিফান্ড|ভাঙা|নষ্ট)/i,
    ['return', 'refund', 'replace', 'রিটার্ন', 'রিপ্লেস'],
  ],
  [/(batch|qr|ব্যাচ|পাবনা|pabna|pabnar)/i, ['batch', 'pabna', 'ব্যাচ', 'পাবনা']],
  [
    /(address|location|map|kothay|kothai|ঠিকানা|লোকেশন|কোথায়|কোথায়)/i,
    ['address', 'location', 'map', 'phone', 'ঠিকানা'],
  ],
  [
    /(recommend|suggest|compare|family|trial|gift|কোনটা|ভালো হবে|সাজেস্ট)/i,
    ['250g', '500g', '1kg', 'family', 'starter', 'trial'],
  ],
];

export function normalizeBanglaAndBanglishToken(token: string): string {
  let clean = token.normalize('NFC').toLowerCase().trim();
  clean = clean.replace(/য়/g, 'য়').replace(/ড়/g, 'ড়').replace(/ঢ়/g, 'ঢ়');
  const suffixes = [
    'য়েরটা',
    'িয়েরটা',
    'গুলোর',
    'গুলা',
    'য়ের',
    'িয়ের',
    'দের',
    'টার',
    'টির',
    'টায়',
    'তে',
    'য়ে',
    'য়ে',
    'কে',
    'টা',
    'টি',
    'র',
  ];
  for (const sfx of suffixes) {
    if (clean.length > sfx.length + 1 && clean.endsWith(sfx)) {
      clean = clean.slice(0, -sfx.length);
      break;
    }
  }
  return clean;
}

export function expandQueryTokens(
  query: string,
  extraSynonyms?: Record<string, string[]>
): string[] {
  const normalizedQuery = query.normalize('NFC');
  const rawTokens = normalizedQuery
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const expanded = new Set<string>();
  for (const raw of rawTokens) {
    expanded.add(raw.replace(/য়/g, 'য়'));
    const stem = normalizeBanglaAndBanglishToken(raw);
    if (stem.length >= 2) {
      expanded.add(stem);
    }
    if (extraSynonyms) {
      for (const [key, list] of Object.entries(extraSynonyms)) {
        const normKey = key.normalize('NFC').toLowerCase();
        if (
          raw === normKey ||
          stem === normKey ||
          (Array.isArray(list) && list.some((s) => s.toLowerCase() === raw))
        ) {
          expanded.add(normKey);
          for (const syn of list || []) {
            expanded.add(syn.normalize('NFC').replace(/য়/g, 'য়').toLowerCase());
          }
        }
      }
    }
  }
  for (const [rx, extras] of BILINGUAL_SYNONYMS) {
    if (rx.test(normalizedQuery)) {
      for (const e of extras) expanded.add(e.normalize('NFC').replace(/য়/g, 'য়'));
    }
  }
  return Array.from(expanded);
}

const MIN_KNOWLEDGE_RELEVANCE_SCORE = 3;

export function retrieveRelevantKnowledge(
  query: string,
  faqs: ChatbotFaqDoc[],
  kbDocs: ChatbotKbDocRecord[],
  replyLang: 'bn' | 'en',
  limit = 6,
  extraSynonyms?: Record<string, string[]>
): { faqs: ChatbotFaqDoc[]; kbSnippets: { title: string; category: string; snippet: string }[] } {
  const tokens = expandQueryTokens(query, extraSynonyms);
  if (tokens.length === 0) {
    return { faqs: [], kbSnippets: [] };
  }

  const scoredFaqs = faqs
    .map((faq) => {
      const haystack = `${faq.question} ${faq.answer} ${faq.category}`
        .normalize('NFC')
        .replace(/য়/g, 'য়')
        .toLowerCase();
      let keywordScore = 0;
      for (const tok of tokens) {
        if (haystack.includes(tok)) keywordScore += 3;
      }
      const langTiebreaker =
        keywordScore >= MIN_KNOWLEDGE_RELEVANCE_SCORE &&
        (faq.lang === 'both' || faq.lang === replyLang)
          ? 1
          : 0;
      return { faq, keywordScore, totalScore: keywordScore + langTiebreaker };
    })
    .filter((x) => x.keywordScore >= MIN_KNOWLEDGE_RELEVANCE_SCORE)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, limit)
    .map((x) => x.faq);

  const snippetCandidates: {
    title: string;
    category: string;
    snippet: string;
    keywordScore: number;
  }[] = [];
  for (const doc of kbDocs) {
    if (doc.accessScope === 'internal') continue;
    const chunks = chunkKnowledgeText(doc.content, 750);
    for (const chunk of chunks) {
      const haystack = `${doc.title} ${doc.category} ${chunk}`
        .normalize('NFC')
        .replace(/য়/g, 'য়')
        .toLowerCase();
      let keywordScore = 0;
      for (const tok of tokens) {
        if (haystack.includes(tok)) keywordScore += 3;
      }
      if (keywordScore >= MIN_KNOWLEDGE_RELEVANCE_SCORE) {
        snippetCandidates.push({
          title: doc.title,
          category: doc.category,
          snippet: chunk,
          keywordScore,
        });
      }
    }
  }

  const kbSnippets = snippetCandidates
    .sort((a, b) => b.keywordScore - a.keywordScore)
    .slice(0, limit)
    .map(({ title, category, snippet }) => ({ title, category, snippet }));

  return { faqs: scoredFaqs, kbSnippets };
}
