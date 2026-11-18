export const CHATBOT_BUILD_CONFIG = {
  // Message & Payload Guards
  MAX_MESSAGE_CHARS: 500,
  MAX_BODY_BYTES: 10 * 1024, // 10 KB
  MAX_CONTEXT_MESSAGES: 10,
  MAX_TOOL_CALLS_PER_TURN: 4,

  // Chat Rate Limiting (Persistent Firestore-backed)
  IP_PER_MIN: 15,
  IP_PER_DAY: 100,
  SESSION_MAX_MESSAGES: 40,
  DAILY_MESSAGE_CAP: 2000,

  // Order Endpoint & Per-Phone Protections
  ORDER_IP_PER_MIN: 5,
  ORDER_PHONE_PER_HOUR: 3,
  ORDER_PHONE_PER_DAY: 5,
  MAX_QTY_PER_ORDER: 10,

  // Confirmation Token & Gemini Execution
  CONFIRM_TOKEN_TTL_MS: 10 * 60 * 1000, // 10 minutes
  GEMINI_TIMEOUT_MS: 15 * 1000, // 15 seconds
  GEMINI_TEMPERATURE: 0.3,
  GEMINI_MAX_OUTPUT_TOKENS: 600,

  // Retention & Notification Reliability
  DEFAULT_RETENTION_DAYS: 30,
  NOTIFICATION_RETRIES: 3,
  BUSINESS_TIMEZONE: 'Asia/Dhaka',
} as const;

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
