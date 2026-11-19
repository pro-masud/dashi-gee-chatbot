export const CHATBOT_BUILD_CONFIG = {
  // Message & Payload Guards
  MAX_MESSAGE_CHARS: 800,
  MAX_BODY_BYTES: 16 * 1024, // 16 KB
  MAX_CONTEXT_MESSAGES: 10,
  MAX_CLIENT_MESSAGES_WINDOW: 120,
  MAX_TOOL_CALLS_PER_TURN: 4,

  // RAG Chunking & Thresholds (Phase 1 T1.1)
  RAG_CHUNK_TARGET_CHARS: 1500, // ~400–800 tokens depending on Bangla/EN mix
  RAG_CHUNK_OVERLAP_CHARS: 200, // ~13% overlap
  RAG_MIN_HYBRID_SCORE: 0.22,
  RAG_MAX_RESULTS: 5,

  // Chat Rate Limiting (Persistent Firestore-backed, CGNAT-aware)
  DEVICE_PER_MIN: 15,
  DEVICE_PER_DAY: 120,
  CGNAT_IP_PER_MIN: 120,
  CGNAT_IP_PER_DAY: 1500,
  SESSION_ROLLOVER_THRESHOLD: 40,
  SESSION_MAX_MESSAGES: 40,
  DAILY_MESSAGE_CAP: 2000,

  // Order Endpoint & Per-Phone Protections
  ORDER_IP_PER_MIN: 10,
  ORDER_DEVICE_PER_MIN: 5,
  ORDER_PHONE_PER_HOUR: 3,
  ORDER_PHONE_PER_DAY: 5,
  MAX_QTY_PER_ORDER: 10,

  // Confirmation Token, Draft TTL & Gemini Execution
  CONFIRM_TOKEN_TTL_MS: 10 * 60 * 1000, // 10 minutes
  ORDER_DRAFT_TTL_MS: 30 * 60 * 1000, // 30 minutes persistent order draft
  GEMINI_TIMEOUT_MS: 15 * 1000, // 15 seconds per provider attempt
  REQUEST_DEADLINE_MS: 28 * 1000, // 28 seconds hard request budget for multi-round tools + failover
  GEMINI_TEMPERATURE: 0.3,
  GEMINI_MAX_OUTPUT_TOKENS: 1800,
  GEMINI_RETRY_MAX_OUTPUT_TOKENS: 2600,

  // Retention & Notification Reliability
  DEFAULT_RETENTION_DAYS: 30,
  NOTIFICATION_RETRIES: 3,
  BUSINESS_TIMEZONE: 'Asia/Dhaka',
} as const;

export function getConfiguredMaxOutputTokens(): number {
  const raw = (process.env.GEMINI_MAX_OUTPUT_TOKENS || '').trim();
  if (!raw) return CHATBOT_BUILD_CONFIG.GEMINI_MAX_OUTPUT_TOKENS;
  const parsed = Math.round(Number(raw));
  if (Number.isFinite(parsed) && parsed >= 512 && parsed <= 8192) {
    return parsed;
  }
  return CHATBOT_BUILD_CONFIG.GEMINI_MAX_OUTPUT_TOKENS;
}

export function getOptionalDailyCostCapUsd(): number | null {
  const raw = (process.env.GEMINI_DAILY_COST_CAP_USD || '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const OWNER_NOTIFICATION_CONFIG_TODOS = [
  'OWNER_WEBHOOK_URL — Server webhook URL for instant Deshi Gee order & support alerts',
  'WHATSAPP_WEBHOOK_URL — Optional WhatsApp Business gateway webhook URL',
  'EMAIL_WEBHOOK_URL — Optional Email notification relay webhook URL',
  'GOOGLE_SHEETS_WEBHOOK_URL — Optional Google Apps Script webhook URL for order row sync',
] as const;
