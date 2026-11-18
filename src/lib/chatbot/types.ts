export type ResponseTone = 'warm' | 'concise' | 'formal';
export type ResponseLength = 'short' | 'balanced' | 'detailed';
export type LanguageBehavior =
  | 'auto'
  | 'prefer_bn'
  | 'prefer_en'
  | 'always_bn'
  | 'mirror'
  | 'customer_choice';
export type ChatbotLang = 'bn' | 'en' | 'banglish';

export type TurnIntent =
  | 'product_question'
  | 'recommendation'
  | 'pricing'
  | 'stock'
  | 'offers'
  | 'delivery'
  | 'payment'
  | 'order'
  | 'order_manage'
  | 'tracking'
  | 'policy'
  | 'complaint'
  | 'human_help'
  | 'greeting'
  | 'unknown';

export interface ApprovedClaimMeta {
  claim: string;
  evidenceNote?: string;
  expiresAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ClaimAuditEntry {
  timestamp: string;
  actor: string;
  action: string;
  summary: string;
}

export interface KnowledgeSourceRef {
  id: string;
  title: string;
  category: string;
  sourceType: 'faq' | 'kb_doc' | 'store_facts';
  score: number;
  snippet?: string;
}

export interface ProductCardItem {
  weight: '250g' | '500g' | '1kg';
  labelEn: string;
  labelBn: string;
  priceBdt: number;
  stockJars: number;
  inStock: boolean;
  recommended?: boolean;
  reasonEn?: string;
  reasonBn?: string;
}

export interface TrackingCardData {
  orderNumber: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  itemsSummary: string;
  totalBdt: number;
  estimatedDelivery: string;
}

export interface ChatDiagnosticsMeta {
  intent: string;
  confidence: number;
  model: string;
  path: ChatbotExecutionPath;
  toolsUsed: string[];
  sources: KnowledgeSourceRef[];
  guardStatus: string;
  ragMs?: number;
  modelMs?: number;
  toolMs?: number;
  totalMs?: number;
  promptTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  streamedRealTokens?: boolean;
  factsVersion?: string;
}

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
  blockedClaims?: string;
  approvedClaimsMeta?: ApprovedClaimMeta[];
  claimAuditHistory?: ClaimAuditEntry[];
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
  synonyms?: Record<string, string[]>;
  primaryModel?: string;
  fallbackModel?: string;
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
  ingredients:
    'Cultured cow milkfat from Pabna grass-fed cows. No vegetable oil, vanaspati, artificial colour, or preservatives.',
  taste: 'Rich, clean, deeply nutty traditional Bengali cow ghee flavour without greasiness.',
  aroma: 'Warm caramelized roasted-butter aroma characteristic of slow earthen clarification.',
  texture:
    'Naturally granular (danadar) golden crystals at cool room temperature (around 18°C–24°C) and clear liquid gold when warm (above 34°C).',
  productionMethod:
    'Fresh dawn milk from Pabna cows is gently boiled, fermented overnight into whole curd inside earthen pots, hand-churned before sunrise using a wooden bilona to separate cultured makkhan, and slow-simmered over low flame before straining through clean muslin into glass jars.',
  shelfLife: '12 months from packaging date when kept tightly sealed.',
  storageInstructions:
    'Store in a cool, dry place away from direct sunlight and kitchen stove heat. Always scoop using a clean, completely dry spoon. Refrigeration is unnecessary.',
  approvedClaims:
    'Single-origin Pabna milk sourcing; wooden bilona cultured curd churning; zero vegetable oils or preservatives; batch-traceable glass packaging.',
  blockedClaims:
    'lab-verified; A2; organic; BSTI certified; 100% pure; cures disease',
  approvedClaimsMeta: [
    {
      claim: 'Single-origin Pabna milk sourcing',
      evidenceNote: 'Daily milk collection records from Bera & Faridpur dairy partners in Pabna.',
    },
    {
      claim: 'Wooden bilona cultured curd churning',
      evidenceNote: 'Overnight clay-pot dahi fermentation & morning wooden bilona separation.',
    },
    {
      claim: 'Zero vegetable oils or preservatives',
      evidenceNote: 'Single-ingredient clarified cow milkfat only.',
    },
  ],
  claimAuditHistory: [],
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
  synonyms: {
    dam: ['price', 'cost', 'taka', 'tk', 'rate', 'দাম', 'মূল্য', 'কত'],
    khati: ['pure', 'authentic', 'original', 'খাঁটি', 'আসল', 'ভেজাল'],
    boyaam: ['jar', 'bottle', 'container', 'বয়াম', 'বয়াম', 'জার'],
    doi: ['curd', 'dahi', 'দই', 'মাখন', 'makkhan'],
    pathano: ['delivery', 'shipping', 'courier', 'ডেলিভারি', 'কুরিয়ার'],
    pabna: ['পাবনা', 'bera', 'faridpur', 'গ্রাস-ফেড', 'bilona', 'বিলোনা'],
  },
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
    'কোন সাইজটা আমার জন্য ভালো হবে?',
    'ঘি কীভাবে সংরক্ষণ করব?',
    'ডেলিভারি চার্জ কত?',
    'কীভাবে অর্ডার করব?',
    'অর্ডার ট্র্যাক করব কীভাবে?',
  ],
  quickQuestionsEn: [
    'What is the price of Deshi Gee?',
    'Which jar size fits my family?',
    'How should I store the ghee?',
    'What is the delivery charge?',
    'How can I place an order?',
    'How can I track my order?',
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
  version?: number;
  owner?: string;
  language?: 'bn' | 'en' | 'both';
  effectiveDate?: string;
  reviewDate?: string;
  contentHash?: string;
  accessScope?: 'public' | 'internal';
  updatedAt?: unknown;
}

export interface KnowledgeChunkRecord {
  id: string;
  docId: string;
  title: string;
  category: string;
  chunkIndex: number;
  sectionHeading: string;
  text: string;
  tokenEstimate: number;
  contentHash: string;
  language: 'bn' | 'en' | 'both';
  status: 'draft' | 'published';
  accessScope: 'public' | 'internal';
  embedding?: number[];
  updatedAt?: unknown;
}

export type OrderDraftState =
  | 'collecting_details'
  | 'quote_ready'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'expired'
  | 'cancelled';

export interface OrderDraftDoc {
  draftId: string;
  sessionId: string;
  weight?: '250g' | '500g' | '1kg';
  qty?: number;
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  customerName?: string;
  phone?: string;
  district?: string;
  area?: string;
  address?: string;
  addressQualityNote?: string;
  paymentMethod?: 'cod' | 'bkash' | 'nagad';
  txnId?: string;
  couponCode?: string;
  note?: string;
  state: OrderDraftState;
  priceQuoteVersion: number;
  validationErrors?: string[];
  lastSummary?: OrderSummaryCard;
  expiresAt: number;
  updatedAt?: unknown;
}

export interface ChatSessionDoc {
  sessionId: string;
  language: 'bn' | 'en';
  lockedLang?: 'bn' | 'en' | '';
  scriptPreference?: 'bn_script' | 'banglish_roman' | 'en';
  consent: boolean;
  currentIntent: TurnIntent | string;
  orderDraftId?: string;
  turnCount: number;
  lastTurnAt?: unknown;
  startedAt?: unknown;
}

export type FeedbackReason =
  | 'wrong_price'
  | 'unclear'
  | 'missing_info'
  | 'wrong_language'
  | 'other'
  | '';

export interface ChatbotFeedbackDoc {
  id: string;
  sessionId: string;
  logId?: string;
  rating: 'up' | 'down';
  reason?: FeedbackReason;
  userMessage: string;
  assistantReply: string;
  lang: 'bn' | 'en';
  intent: string;
  resolved: boolean;
  createdAt?: unknown;
}

export type ChatbotExecutionPath = 'gemini' | 'fallback';

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
  path?: ChatbotExecutionPath;
  model?: string;
  isError?: boolean;
  finishReason?: string;
  guardCategory?: string;
  retryCount?: number;
  toolCallCount?: number;
  factsVersion?: string;
  ragMs?: number;
  modelMs?: number;
  toolMs?: number;
  ragSources?: string[];
  confidence?: number;
  feedback?: 'up' | 'down' | '';
  feedbackReason?: string;
  createdAt?: unknown;
}

export interface ModelDiagnosticSummary {
  name: string;
  configured: boolean;
  supported: boolean;
  reachable: 'yes' | 'no';
  reachableOk: boolean;
  supportsTools: boolean;
  thinkingConfig: {
    supported: boolean;
    status: 'ok' | 'warning' | 'unsupported';
    detail: string;
  };
  outputLimits: {
    configuredMaxOutputTokens: number;
    valid: boolean;
    detail: string;
  };
  sdkCompatible: boolean;
  latencyMs: number;
  errorCode: string;
  detail: string;
}

export interface RuntimeHealthReport {
  ok: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  runtime: string;
  timestamp: string;
  activePath: ChatbotExecutionPath;
  supportedModelConfigured: boolean;
  checks: {
    geminiApiKeyConfigured: 'yes' | 'no';
    geminiApiKeyOk: boolean;
    primaryModel: ModelDiagnosticSummary;
    fallbackModel: ModelDiagnosticSummary;
    tokenSecretConfigured: 'yes' | 'no';
    tokenSecretOk: boolean;
    tokenSecretPresent: boolean;
    firestoreReachable: 'yes' | 'no';
    firestoreOk: boolean;
    firestoreLatencyMs: number;
    firestoreDetail: string;
    sdk: {
      package: string;
      compatible: boolean;
      functionDeclarationsCount: number;
      detail: string;
    };
  };
  errorCode: string;
  warnings: string[];
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
  type:
    | 'call'
    | 'whatsapp'
    | 'maps'
    | 'directions'
    | 'copy_phone'
    | 'track_order'
    | 'order_confirmed'
    | 'open_url';
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

export interface OrderVariantSummaryLine {
  weight: '250g' | '500g' | '1kg';
  qty: number;
  unitPriceBdt: number;
  lineSubtotalBdt: number;
}

export interface OrderSummaryCard {
  productName: string;
  weight: string;
  qty: number;
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  variantLines?: OrderVariantSummaryLine[];
  itemsSummary?: string;
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
  deliveryZone?: 'dhaka' | 'suburban' | 'nationwide' | 'remote';
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
  priceQuoteVersion?: number;
  estimatedDelivery?: string;
  dispatchCutoffNote?: string;
  duplicateWarning?: string;
  addressWarning?: string;
  riskReviewNotice?: string;
  reviewStatus?: 'none' | 'manual_review' | 'approved' | 'rejected';
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  actions?: ChatActionItem[];
  orderSummary?: OrderSummaryCard;
  productCards?: ProductCardItem[];
  trackingCard?: TrackingCardData;
  suggestedReplies?: string[];
  sources?: KnowledgeSourceRef[];
  diagnostics?: ChatDiagnosticsMeta;
  feedback?: 'up' | 'down';
  feedbackReason?: FeedbackReason;
  logId?: string;
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
