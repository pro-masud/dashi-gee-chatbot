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
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

const BANGLISH_HINTS = [
  'dam koto',
  'koto taka',
  'koto tk',
  'kivabe',
  'kibhabe',
  'kothay',
  'kothai',
  'ache naki',
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
];

export function detectLanguageAndSignals(
  message: string,
  behavior: LanguageBehavior,
  uiLang: 'en' | 'bn' = 'en'
): { detectedInputLang: ChatbotLang; replyLang: 'bn' | 'en' } {
  const clean = message.trim();
  const hasBengaliScript = /[\u0980-\u09FF]/.test(clean);
  const lower = clean.toLowerCase();

  let detectedInputLang: ChatbotLang = 'en';
  if (hasBengaliScript) {
    detectedInputLang = 'bn';
  } else {
    const banglishScore = BANGLISH_HINTS.reduce(
      (sum, hint) => (lower.includes(hint) ? sum + 1 : sum),
      0
    );
    const shortWordsBanglish = /\b(koto|dam|kivabe|kothay|taka|lagbe|ache|nibo|chai|hobe|korbo|apni|tumi|ami|ki)\b/i.test(
      lower
    );
    if (banglishScore >= 1 || shortWordsBanglish) {
      detectedInputLang = 'banglish';
    }
  }

  // Explicit user override phrasing
  if (
    /\b(in english|english please|speak english|reply in english|english e bolo)\b/i.test(lower)
  ) {
    return { detectedInputLang, replyLang: 'en' };
  }
  if (
    /(\b(bangla|bengali)\b|বাংলায়|বাংলাতে|banglay|bangla te)/i.test(lower)
  ) {
    return { detectedInputLang, replyLang: 'bn' };
  }

  if (behavior === 'prefer_bn') {
    return { detectedInputLang, replyLang: detectedInputLang === 'en' && uiLang === 'en' ? 'bn' : 'bn' };
  }
  if (behavior === 'prefer_en') {
    return { detectedInputLang, replyLang: detectedInputLang === 'bn' ? 'bn' : 'en' };
  }

  // Auto mode: Bangla or Banglish -> polite Bangla; English -> follow message (or uiLang if just greeting)
  if (detectedInputLang === 'bn' || detectedInputLang === 'banglish') {
    return { detectedInputLang, replyLang: 'bn' };
  }
  if (/^(hi|hello|hey|assalamu alaikum|salam)\b/i.test(lower) && uiLang === 'bn') {
    return { detectedInputLang, replyLang: 'bn' };
  }
  return { detectedInputLang, replyLang: 'en' };
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
  /(পিন|ওটিপি|পাসওয়ার্ড|গোপন\s*নম্বর)/,
  /\b\d{13,19}\b/, // Credit/debit card number range (BD mobile numbers are 11 digits)
];

export function detectSensitiveSecret(text: string): boolean {
  return SECRET_PATTERNS.some((rx) => rx.test(text));
}

export function getBusinessHoursStatus(cfg: ChatbotConfigDoc): {
  isOpenNow: boolean;
  currentTimeBst: string;
  currentDayEn: string;
} {
  try {
    const now = new Date();
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

export function chunkKnowledgeText(content: string, maxChars = 900): string[] {
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
  [/(size|sizes|weight|weights|variant|variants|সাইজ|ওজন|পরিমাণ|গ্রাম|কেজি|kg|gm)/i, ['size', 'sizes', 'weight', 'variant', '250g', '500g', '1kg', 'সাইজ', 'ওজন', 'দাম', 'বয়াম', 'জার']],
  [/(dam|price|cost|koto|দাম|মূল্য|কত)/i, ['price', 'cost', 'taka', 'দাম', '250g', '500g', '1kg']],
  [/(delivery|shipping|dhaka|courier|ডেলিভারি|ঢাকা|পাঠান)/i, ['delivery', 'shipping', 'dhaka', 'ডেলিভারি']],
  [/(order|buy|purchase|nibo|অর্ডার|কিনব|নিব)/i, ['order', 'checkout', 'cod', 'অর্ডার']],
  [/(track|status|ট্র্যাক|অবস্থা)/i, ['track', 'status', 'ট্র্যাক']],
  [/(store|storage|shelf|expiry|ভালো|সংরক্ষণ|মেয়াদ)/i, ['storage', 'shelf', 'expire', 'সংরক্ষণ', 'মেয়াদ']],
  [/(pure|ingredients|bilona|danadar|খাঁটি|উপাদান|বিলোনা|দানা)/i, ['pure', 'bilona', 'milkfat', 'ingredients', 'খাঁটি']],
  [/(bkash|nagad|payment|cod|পেমেন্ট|বিকাশ|নগদ)/i, ['bkash', 'nagad', 'payment', 'cod', 'বিকাশ', 'নগদ']],
  [/(return|refund|replace|broken|ভাঙা|রিটার্ন|রিফান্ড)/i, ['return', 'refund', 'replace', 'রিটার্ন']],
  [/(address|location|map|kothay|ঠিকানা|লোকেশন|কোথায়)/i, ['address', 'location', 'map', 'phone', 'ঠিকানা']],
];

function expandQueryTokens(query: string): string[] {
  const base = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const expanded = new Set(base);
  for (const [rx, extras] of BILINGUAL_SYNONYMS) {
    if (rx.test(query)) {
      for (const e of extras) expanded.add(e);
    }
  }
  return Array.from(expanded);
}

export function retrieveRelevantKnowledge(
  query: string,
  faqs: ChatbotFaqDoc[],
  kbDocs: ChatbotKbDocRecord[],
  replyLang: 'bn' | 'en',
  limit = 6
): { faqs: ChatbotFaqDoc[]; kbSnippets: { title: string; category: string; snippet: string }[] } {
  const tokens = expandQueryTokens(query);

  const scoredFaqs = faqs
    .map((faq) => {
      const haystack = `${faq.question} ${faq.answer} ${faq.category}`.toLowerCase();
      let score = faq.lang === 'both' || faq.lang === replyLang ? 1 : 0;
      for (const tok of tokens) {
        if (haystack.includes(tok)) score += 3;
      }
      return { faq, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.faq);

  const snippetCandidates: { title: string; category: string; snippet: string; score: number }[] = [];
  for (const doc of kbDocs) {
    const chunks = chunkKnowledgeText(doc.content, 750);
    for (const chunk of chunks) {
      const haystack = `${doc.title} ${doc.category} ${chunk}`.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (haystack.includes(tok)) score += 3;
      }
      if (score > 0 || chunks.length === 1) {
        snippetCandidates.push({
          title: doc.title,
          category: doc.category,
          snippet: chunk,
          score,
        });
      }
    }
  }

  const kbSnippets = snippetCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ title, category, snippet }) => ({ title, category, snippet }));

  return { faqs: scoredFaqs, kbSnippets };
}
