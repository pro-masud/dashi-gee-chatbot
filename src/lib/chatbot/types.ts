export type ResponseTone = 'warm' | 'concise' | 'formal';
export type ResponseLength = 'short' | 'balanced' | 'detailed';
export type LanguageBehavior =
  | 'bangla_script'
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
  | 'payment_dispute'
  | 'late_delivery'
  | 'order'
  | 'order_manage'
  | 'reorder'
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
  status?: 'draft' | 'approved';
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
  courierPartner?: string;
  consignmentId?: string;
  courierTrackingUrl?: string;
  dispatchedAtIso?: string;
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
  humanSupportEnabled?: boolean;
  slaStandardMinutes?: number;
  slaUrgentMinutes?: number;
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
  enableVoiceFeatures?: boolean;
  version: number;
  lastSyncStatus: string;
  updatedAt?: unknown;
}

export const DEFAULT_CHATBOT_CONFIG: ChatbotConfigDoc = {
  enabled: true,
  maintenanceMode: false,
  maintenanceMessageEn:
    'Our AI assistant is briefly updating. Please submit a callback request for assistance.',
  maintenanceMessageBn:
    'আমাদের AI Assistant সাময়িক রক্ষণাবেক্ষণে রয়েছে। সহায়তার জন্য কলব্যাক অনুরোধ পাঠান।',
  botName: 'Deshi Gee Assistant',
  brandName: 'Deshi Gee',
  brandIntro:
    'Deshi Gee is a single-product Bangladeshi artisanal food brand offering Pabna bilona cow ghee in clear apothecary glass jars.',
  brandStory:
    'Sourced from dairy households in Pabna, whole cow milk is cultured into curd in earthen pots, hand-churned with a traditional wooden bilona, and slow-clarified.',
  brandMission:
    'To bring carefully prepared, batch-traceable Pabna cow ghee directly to Bangladeshi kitchens.',
  founderInfo:
    'Crafted in partnership with Pabna dairy households using earthen-pot fermentation and wooden bilona churning.',
  productDescription:
    'Single-origin Pabna cow ghee churned by traditional wooden bilona from whole cultured curd and sealed in clear apothecary glass jars (250g, 500g, and 1kg sizes).',
  ingredients:
    'Clarified cultured cow milkfat. No added vegetable oil, vanaspati, or artificial colour.',
  taste: 'Rich, clean, nutty traditional Bengali cow ghee flavour.',
  aroma: 'Warm roasted-butter aroma characteristic of slow clarification.',
  texture:
    'Naturally granular (danadar) crystals in cooler environments and clear liquid gold when warm.',
  productionMethod:
    'Whole cow milk is gently boiled, cultured overnight into curd in earthen pots, hand-churned with a wooden bilona to separate makkhan, and slow-clarified before sealing in glass jars.',
  shelfLife: '',
  storageInstructions:
    'Store tightly sealed in a cool, dry place away from direct sunlight and moisture. Always use a clean, dry spoon.',
  approvedClaims: '',
  blockedClaims:
    'lab-verified; A2; organic; BSTI certified; 100% pure; cures disease',
  approvedClaimsMeta: [],
  claimAuditHistory: [],
  currentOffers: '',
  district: '',
  city: '',
  googleMapsUrl: '',
  directionsUrl: '',
  businessHours: '',
  openHourBst: 0,
  closeHourBst: 0,
  closedDays: '',
  supportAvailabilityNote: '',
  humanSupportEnabled: true,
  slaStandardMinutes: 0,
  slaUrgentMinutes: 0,
  deliveryPolicy: '',
  returnPolicy: '',
  replacementPolicy: '',
  otherPaymentInfo: '',
  supportInstructions:
    'Greet respectfully, keep answers concise, confirm weight & total before order placement, never invent unconfirmed facts or policies, and never ask for PIN, OTP, or banking passwords.',
  customInstructions:
    'Use only verified store settings and owner-approved facts. If a price, fee, ETA, or policy is not configured, inform the customer honestly and offer human support.',
  responseTone: 'warm',
  responseLength: 'short',
  languageBehavior: 'bangla_script',
  synonyms: {
    dam: ['price', 'cost', 'taka', 'tk', 'rate', 'দাম', 'মূল্য', 'কত'],
    khati: ['pure', 'authentic', 'original', 'খাঁটি', 'আসল', 'ভেজাল'],
    boyaam: ['jar', 'bottle', 'container', 'বয়াম', 'বয়াম', 'জার'],
    doi: ['curd', 'dahi', 'দই', 'মাখন', 'makkhan'],
    pathano: ['delivery', 'shipping', 'courier', 'ডেলিভারি', 'কুরিয়ার'],
    pabna: ['পাবনা', 'bera', 'faridpur', 'গ্রাস-ফেড', 'bilona', 'বিলোনা'],
  },
  fallbackMessageBn:
    'দুঃখিত, এই তথ্যটা আমার কাছে যাচাইকৃতভাবে নেই। সঠিক তথ্যের জন্য আমাদের সাপোর্ট টিমের সঙ্গে যোগাযোগ বা কলব্যাক অনুরোধ করতে পারেন।',
  fallbackMessageEn:
    "Sorry, I don't have owner-verified information about that yet. Please contact our support team or request a callback for accurate assistance.",
  welcomeMessageBn:
    'আসসালামু আলাইকুম! স্বাগতম Deshi Gee-তে। আমি আপনার Deshi Gee Assistant। আমাদের ঘি, সাইজ, অর্ডার ও ডেলিভারি সম্পর্কে যেকোনো প্রশ্নে সাহায্য করতে পারি।',
  welcomeMessageEn:
    "Welcome to Deshi Gee! I'm your virtual assistant. I can help you with our ghee, available sizes, orders, delivery, and customer support.",
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
  enableVoiceFeatures: false,
  version: 1,
  lastSyncStatus: 'Awaiting owner configuration in Admin',
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

export interface ChatAgentReplyItem {
  id: string;
  agentName: string;
  text: string;
  createdAtIso: string;
}

export type ChannelSource = 'web' | 'messenger' | 'instagram' | 'whatsapp' | 'email' | 'sms';

export interface ChatSessionDoc {
  sessionId: string;
  language: 'bn' | 'en';
  lockedLang?: 'bn' | 'en' | '';
  scriptPreference?: 'bn_script' | 'banglish_roman' | 'en';
  consent: boolean;
  currentIntent: TurnIntent | string;
  orderDraftId?: string;
  turnCount: number;
  channel?: ChannelSource;
  externalUserId?: string;
  linkedPhone?: string;
  aiPaused?: boolean;
  activeTicketId?: string;
  assignedAgentName?: string;
  agentReplies?: ChatAgentReplyItem[];
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
  channel?: ChannelSource;
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

export type SupportCategory =
  | 'damaged_jar'
  | 'payment_dispute'
  | 'late_delivery'
  | 'refund_return'
  | 'bulk_order'
  | 'general';

export type SupportPriority = 'standard' | 'urgent';

export type SupportTicketStatus =
  | 'open'
  | 'pending'
  | 'contacted'
  | 'waiting_for_customer'
  | 'escalated'
  | 'resolved';

export interface ChatbotSupportRequestRecord {
  id: string;
  ticketNumber?: string;
  sessionId: string;
  channel?: ChannelSource;
  externalThreadId?: string;
  customerName: string;
  phone: string;
  orderNumber?: string;
  category?: SupportCategory;
  priority?: SupportPriority;
  issueSummary: string;
  contextSummary?: string;
  transcriptExcerpt?: string;
  consentGranted?: boolean;
  evidenceIds?: string[];
  paymentStatusSnapshot?: string;
  orderStatusSnapshot?: string;
  slaMinutes?: number;
  slaDueAtIso?: string;
  slaWindowLabelEn?: string;
  slaWindowLabelBn?: string;
  assignedTo?: string;
  tags?: string[];
  resolutionReason?: string;
  internalNotes?: string;
  firstRespondedAtIso?: string;
  resolvedAtIso?: string;
  status: SupportTicketStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SupportEvidenceDoc {
  id: string;
  sessionId: string;
  orderNumber?: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  filename: string;
  sizeBytes: number;
  dataBase64: string;
  purpose: 'damage_claim' | 'payment_dispute' | 'general';
  createdAt?: unknown;
}

export interface SupportAgentReplyDoc {
  id: string;
  ticketId: string;
  sessionId: string;
  agentEmail: string;
  agentName: string;
  text: string;
  createdAtIso: string;
  createdAt?: unknown;
}

export interface RefillReminderDoc {
  id: string;
  orderNumber: string;
  phone: string;
  customerName?: string;
  weight?: '250g' | '500g' | '1kg';
  intervalDays: 30 | 45 | 60 | 90;
  status: 'active' | 'paused' | 'opted_out';
  consentGranted: boolean;
  nextReminderAtIso: string;
  lastNotifiedAtIso?: string;
  reminderCount?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ChannelWebhookEventDoc {
  id: string;
  channel: 'messenger' | 'instagram' | 'whatsapp';
  eventId: string;
  senderId: string;
  verifiedPhone?: string;
  status: 'processed' | 'duplicate' | 'rejected';
  createdAtIso: string;
  createdAt?: unknown;
}

export interface MarketingConsentDoc {
  id: string;
  phone: string;
  customerName?: string;
  channel: ChannelSource;
  optIn: boolean;
  unsubscribed: boolean;
  source: 'checkout' | 'chat' | 'track_order' | 'whatsapp' | 'admin';
  quietHoursRespect: boolean;
  lastCampaignAtIso?: string;
  campaignCount?: number;
  consentTimestampIso: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Phase5AttributionAnalytics {
  funnel: {
    chatStartedSessions: number;
    productInfoSessions: number;
    orderIntentSessions: number;
    summaryShownSessions: number;
    confirmedOrdersCount: number;
    deliveredOrdersCount: number;
    attributedRevenueBdt: number;
    attributedAovBdt: number;
    chatToOrderPct: number;
  };
  channels: Array<{
    channel: ChannelSource;
    sessions: number;
    orders: number;
    revenueBdt: number;
    handoverTickets: number;
    conversionPct: number;
  }>;
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
    | 'reorder'
    | 'open_url';
  labelEn: string;
  labelBn: string;
  value: string;
  href?: string;
  reorderData?: {
    qty250g: number;
    qty500g: number;
    qty1kg: number;
    totalBdt: number;
  };
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

export interface OrderManageProposalCard {
  action: 'cancel' | 'edit_address';
  orderNumber: string;
  phoneMasked: string;
  currentStatus: string;
  currentTotalBdt: number;
  newTotalBdt?: number;
  newDeliveryFeeBdt?: number;
  proposedDistrict?: string;
  proposedArea?: string;
  proposedAddress?: string;
  proposedDeliveryZone?: 'dhaka' | 'suburban' | 'nationwide' | 'remote';
  reason?: string;
  actionToken: string;
  expiresAt: number;
  status?: 'pending_confirm' | 'confirmed' | 'dismissed' | 'failed';
  resultMessage?: string;
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  actions?: ChatActionItem[];
  orderSummary?: OrderSummaryCard;
  orderManageProposal?: OrderManageProposalCard;
  productCards?: ProductCardItem[];
  trackingCard?: TrackingCardData;
  suggestedReplies?: string[];
  sources?: KnowledgeSourceRef[];
  diagnostics?: ChatDiagnosticsMeta;
  feedback?: 'up' | 'down';
  feedbackReason?: FeedbackReason;
  logId?: string;
  ttsToken?: string;
  isError?: boolean;
  retryPrompt?: string;
  isAgentReply?: boolean;
  agentName?: string;
}

export const PROTECTED_CORE_RULES_SUMMARY = [
  'Single-Product Restriction: Only Deshi Gee (250g, 500g, 1kg) may be discussed.',
  'Strict Domain Lock: Off-topic questions (politics, religion, coding, general AI, competitors) are politely refused.',
  'Live Database Truth: Prices, stock, delivery fees, contact details, and order status come strictly from Firestore.',
  'Zero Hallucination & Claims Guard: No invented discounts, lab/medical/A2/organic claims unless listed in Approved Claims.',
  'Payment & Credential Shield: Never requests or accepts bKash/Nagad PINs, OTPs, CVVs, or passwords.',
  'Explicit Order Confirmation: Backend order creation only runs after explicit customer confirmation.',
];
