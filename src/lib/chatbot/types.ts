export type ResponseTone = 'warm' | 'concise' | 'formal';
export type ResponseLength = 'short' | 'balanced' | 'detailed';
export type LanguageBehavior = 'auto' | 'prefer_bn' | 'prefer_en';
export type ChatbotLang = 'bn' | 'en' | 'banglish';

export interface ChatbotConfigDoc {
  enabled: boolean;
  maintenanceMode: boolean;
  maintenanceMessageEn: string;
  maintenanceMessageBn: string;
  botName: string;
  brandName: string;
  brandIntro: string;
  brandStory: string;
  brandMission: string;
  founderInfo: string;
  productDescription: string;
  ingredients: string;
  taste: string;
  aroma: string;
  texture: string;
  productionMethod: string;
  shelfLife: string;
  storageInstructions: string;
  approvedClaims: string;
  currentOffers: string;
  district: string;
  city: string;
  googleMapsUrl: string;
  directionsUrl: string;
  businessHours: string;
  openHourBst: number;
  closeHourBst: number;
  closedDays: string;
  supportAvailabilityNote: string;
  deliveryPolicy: string;
  returnPolicy: string;
  replacementPolicy: string;
  otherPaymentInfo: string;
  supportInstructions: string;
  customInstructions: string;
  responseTone: ResponseTone;
  responseLength: ResponseLength;
  languageBehavior: LanguageBehavior;
  fallbackMessageBn: string;
  fallbackMessageEn: string;
  welcomeMessageBn: string;
  welcomeMessageEn: string;
  quickQuestionsBn: string[];
  quickQuestionsEn: string[];
  retentionDays: number;
  dailyRequestLimit: number;
  version: number;
  lastSyncStatus: string;
  updatedAt?: unknown;
}

export const DEFAULT_CHATBOT_CONFIG: ChatbotConfigDoc = {
  enabled: true,
  maintenanceMode: false,
  maintenanceMessageEn:
    'Our AI assistant is briefly updating. Please reach us directly via WhatsApp or phone for immediate help.',
  maintenanceMessageBn:
    'আমাদের AI Assistant সাময়িক রক্ষণাবেক্ষণে রয়েছে। দ্রুত সহায়তার জন্য WhatsApp বা ফোনে যোগাযোগ করুন।',
  botName: 'Deshi Gee Assistant',
  brandName: 'Deshi Gee',
  brandIntro:
    'Deshi Gee is a single-product Bangladeshi artisanal food brand offering authentic Pabna grass-fed bilona cow ghee in clear apothecary glass jars.',
  brandStory:
    'Sourced fresh at dawn from rural dairy households across Bera & Faridpur in Pabna, whole cow milk is cultured overnight in earthen clay pots, hand-churned with a traditional wooden bilona, and slow-clarified in small batches.',
  brandMission:
    'To bring unadulterated, batch-traceable Pabna cow ghee prepared with patience and transparency directly to Bangladeshi kitchens.',
  founderInfo:
    'Founded in partnership with Pabna dairy families using traditional earthen-pot fermentation and wooden bilona churning.',
  productDescription:
    'Single-origin Pabna grass-fed cow ghee churned by traditional wooden bilona from whole cultured curd and sealed warm in clear apothecary glass jars (250g, 500g, and 1kg weight variants).',
  ingredients: 'Cultured cow milkfat from Pabna grass-fed cows. No vegetable oil, vanaspati, artificial colour, or preservatives.',
  taste: 'Rich, clean, deeply nutty traditional Bengali cow ghee flavour without greasiness.',
  aroma: 'Warm caramelized roasted-butter aroma characteristic of slow earthen clarification.',
  texture: 'Naturally granular (danadar) golden crystals at cool room temperature (around 18°C–24°C) and clear liquid gold when warm (above 34°C).',
  productionMethod:
    'Fresh dawn milk from Pabna cows is gently boiled, fermented overnight into whole curd inside earthen pots, hand-churned before sunrise using a wooden bilona to separate cultured makkhan, and slow-simmered over low flame before straining through clean muslin into glass jars.',
  shelfLife: '12 months from packaging date when kept tightly sealed.',
  storageInstructions:
    'Store in a cool, dry place away from direct sunlight and kitchen stove heat. Always scoop using a clean, completely dry spoon. Refrigeration is unnecessary.',
  approvedClaims:
    'Single-origin Pabna milk sourcing; wooden bilona cultured curd churning; zero vegetable oils or preservatives; batch-traceable glass packaging.',
  currentOffers:
    'Free nationwide delivery on orders of ৳2,500 or above (or active advance MFS/coupon promotions configured in Store Settings).',
  district: 'Dhaka / Pabna',
  city: 'Dhaka',
  googleMapsUrl: '',
  directionsUrl: '',
  businessHours: 'Saturday – Thursday, 9:00 AM – 9:00 PM (BST)',
  openHourBst: 9,
  closeHourBst: 21,
  closedDays: 'Friday',
  supportAvailabilityNote:
    'Our customer support team replies within business hours via Phone and WhatsApp.',
  deliveryPolicy:
    'Orders inside Dhaka typically arrive within 24–48 hours; nationwide orders outside Dhaka arrive within 2–4 business days. Free delivery applies automatically at or above the configured threshold.',
  returnPolicy:
    'If a glass jar arrives cracked, leaking, or with a compromised tamper seal, contact support with a photo within 24 hours of delivery for replacement or refund.',
  replacementPolicy:
    'Damaged or leaking jars verified with a delivery-day photo are replaced promptly at no extra delivery charge.',
  otherPaymentInfo:
    'Cash on Delivery (COD) is available nationwide. Advance payment via configured bKash or Nagad numbers remains Pending Verification until matched by our team.',
  supportInstructions:
    'Greet respectfully, keep answers concise (3–4 short sentences max), confirm weight & total before order placement, and never ask for PIN, OTP, or banking passwords.',
  customInstructions:
    'Recommend the 500g glass jar gently when a customer asks for a regular household option without being pushy. Always highlight exact prices with the ৳ symbol and offer Cash on Delivery or verified bKash/Nagad checkout.',
  responseTone: 'warm',
  responseLength: 'short',
  languageBehavior: 'auto',
  fallbackMessageBn:
    'দুঃখিত, এই তথ্যটা আমার কাছে নেই। সঠিক তথ্যের জন্য আমাদের কাস্টমার সাপোর্টের সঙ্গে যোগাযোগ করতে পারেন।',
  fallbackMessageEn:
    "Sorry, I don't have verified information about that. Please contact our customer support team for accurate assistance.",
  welcomeMessageBn:
    'আসসালামু আলাইকুম! স্বাগতম Deshi Gee-তে। আমি আপনার Deshi Gee AI Assistant। আমাদের ঘি, দাম, সাইজ, অর্ডার ও ডেলিভারি সম্পর্কে যেকোনো প্রশ্নে সাহায্য করতে পারি।',
  welcomeMessageEn:
    "Welcome to Deshi Gee! I'm your virtual assistant. I can help you with our ghee, pricing, available sizes, orders, delivery, and customer support.",
  quickQuestionsBn: [
    'আমাদের ঘির দাম কত?',
    'কোন কোন সাইজ পাওয়া যায়?',
    'ঘি কীভাবে সংরক্ষণ করব?',
    'ডেলিভারি চার্জ কত?',
    'কীভাবে অর্ডার করব?',
    'আপনাদের ঠিকানা কোথায়?',
  ],
  quickQuestionsEn: [
    'What is the price of Deshi Gee?',
    'Which jar sizes are available?',
    'How should I store the ghee?',
    'What is the delivery charge?',
    'How can I place an order?',
    'What is your address & contact?',
  ],
  retentionDays: 30,
  dailyRequestLimit: 2000,
  version: 1,
  lastSyncStatus: 'Initialized with verified Deshi Gee facts',
};

export interface ChatbotFaqDoc {
  id: string;
  question: string;
  answer: string;
  lang: 'bn' | 'en' | 'both';
  category: string;
  active: boolean;
  published: boolean;
  updatedAt?: unknown;
}

export interface ChatbotKbDocRecord {
  id: string;
  title: string;
  category: string;
  sourceType: 'manual' | 'txt' | 'csv' | 'pdf' | 'docx';
  fileName: string;
  content: string;
  chunkCount: number;
  status: 'draft' | 'published';
  syncStatus: string;
  updatedAt?: unknown;
}

export interface ChatbotLogRecord {
  id: string;
  sessionId: string;
  lang: ChatbotLang;
  userMessage: string;
  assistantReply: string;
  intent: string;
  isUnanswered: boolean;
  resolved: boolean;
  handoverRequested: boolean;
  latencyMs: number;
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  errorCode: string;
  isTestPlayground: boolean;
  createdAt?: unknown;
}

export interface ChatbotVersionRecord {
  id: string;
  version: number;
  publishedBy: string;
  summary: string;
  snapshot: Record<string, unknown>;
  createdAt?: unknown;
}

export interface ChatbotSupportRequestRecord {
  id: string;
  sessionId: string;
  customerName: string;
  phone: string;
  issueSummary: string;
  status: 'open' | 'contacted' | 'resolved';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChatActionItem {
  type: 'call' | 'whatsapp' | 'maps' | 'directions' | 'copy_phone' | 'track_order' | 'order_confirmed' | 'open_url';
  labelEn: string;
  labelBn: string;
  value: string;
  href?: string;
}

export type OrderStatePhase =
  | 'collecting_details'
  | 'summary_shown'
  | 'confirmed'
  | 'order_created'
  | 'failed';

export interface OrderSummaryCard {
  productName: string;
  weight: string;
  qty: number;
  unitPriceBdt: number;
  subtotalBdt: number;
  deliveryFeeBdt: number;
  discountBdt: number;
  totalBdt: number;
  customerName?: string;
  phone?: string;
  district?: string;
  area?: string;
  deliveryArea?: string;
  address?: string;
  note?: string;
  txnId?: string;
  couponCode?: string;
  orderNumber?: string;
  paymentMethod?: string;
  confirmationToken?: string;
  expiresAt?: number;
  confirmed?: boolean;
  orderState?: OrderStatePhase;
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  actions?: ChatActionItem[];
  orderSummary?: OrderSummaryCard;
  isError?: boolean;
  retryPrompt?: string;
}

export const PROTECTED_CORE_RULES_SUMMARY = [
  'Single-Product Restriction: Only Deshi Gee (250g, 500g, 1kg) may be discussed.',
  'Strict Domain Lock: Off-topic questions (politics, religion, coding, general AI, competitors) are politely refused.',
  'Live Database Truth: Prices, stock, delivery fees, contact details, and order status come strictly from Firestore.',
  'Zero Hallucination & Claims Guard: No invented discounts, lab/medical/A2/organic claims unless listed in Approved Claims.',
  'Payment & Credential Shield: Never requests or accepts bKash/Nagad PINs, OTPs, CVVs, or passwords.',
  'Explicit Order Confirmation: Backend order creation only runs after explicit customer confirmation.',
];
