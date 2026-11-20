export const BUSINESS_EVENT_TYPES = [
  'ORDER_CREATED',
  'ORDER_UPDATED',
  'ORDER_CANCELLED',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  'SUPPORT_REQUESTED',
  'CUSTOMER_MESSAGE_RECEIVED',
  'LOW_STOCK',
  'DAILY_SUMMARY',
  'SYSTEM_ERROR',
] as const;

export type BusinessEventType = (typeof BUSINESS_EVENT_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['telegram', 'discord', 'whatsapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const DISCORD_CHANNEL_KEYS = [
  'new-orders',
  'payments',
  'customer-support',
  'inventory-alerts',
  'daily-reports',
  'system-alerts',
] as const;

export type DiscordChannelKey = (typeof DISCORD_CHANNEL_KEYS)[number];

export type NotificationJobStatus =
  | 'queued'
  | 'processing'
  | 'sent'
  | 'failed_retrying'
  | 'dead_letter'
  | 'skipped_disabled';

export interface BusinessEventPayload {
  eventId?: string;
  idempotencyKey?: string;
  type: BusinessEventType;
  occurredAtIso?: string;
  title?: string;
  summary?: string;
  orderNumber?: string;
  customerName?: string;
  customerPhone?: string;
  itemsSummary?: string;
  totalBdt?: number;
  paymentMethod?: string;
  paymentStatus?: string;
  orderStatus?: string;
  district?: string;
  area?: string;
  channel?: string;
  ticketId?: string;
  priority?: 'normal' | 'high' | 'urgent';
  variantWeight?: string;
  remainingStock?: number;
  errorCode?: string;
  errorMessage?: string;
  whatsappOptIn?: boolean;
  withinWhatsapp24hWindow?: boolean;
  whatsappTemplateName?: string;
  adminPath?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ChannelConnectionMeta {
  enabled: boolean;
  lastConnectedAtIso?: string;
  lastError?: string;
  lastTestedAtIso?: string;
}

/**
 * Non-secret operational integration settings stored in Firestore (`integration_settings/main`).
 * Secrets (tokens, webhook URLs, app secrets) NEVER live in this document — server env only.
 */
export interface IntegrationSettingsDoc {
  telegram: ChannelConnectionMeta & {
    /** Optional non-secret override chat IDs (comma-separated); falls back to TELEGRAM_CHAT_ID env. */
    chatIdsOverride?: string;
  };
  discord: ChannelConnectionMeta & {
    enabledChannels: Record<DiscordChannelKey, boolean>;
  };
  whatsapp: ChannelConnectionMeta & {
    sendOrderConfirmations: boolean;
    sendStatusUpdates: boolean;
    sendDeliveryAlerts: boolean;
    orderConfirmationTemplateName: string;
    orderStatusTemplateName: string;
    templateLanguageCode: string;
  };
  aiSupport: ChannelConnectionMeta;
  updatedAtIso: string;
  updatedBy?: string;
}

export interface EventChannelRule {
  enabled: boolean;
  telegram: boolean;
  discord: boolean;
  whatsapp: boolean;
}

/**
 * Per-event notification toggles & retry policy stored in Firestore (`notification_rules/main`).
 */
export interface NotificationRulesDoc {
  events: Record<BusinessEventType, EventChannelRule>;
  maxRetries: number;
  baseBackoffSeconds: number;
  lowStockThreshold: number;
  updatedAtIso: string;
  updatedBy?: string;
}

export interface NotificationEventDoc {
  eventId: string;
  idempotencyKey: string;
  type: BusinessEventType;
  occurredAtIso: string;
  title: string;
  summary: string;
  orderNumber?: string;
  ticketId?: string;
  payload: BusinessEventPayload;
  createdAtMs: number;
}

export interface NotificationJobDoc {
  jobId: string;
  eventId: string;
  eventType: BusinessEventType;
  channel: NotificationChannel;
  discordChannelKey?: DiscordChannelKey;
  idempotencyKey: string;
  status: NotificationJobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAtMs: number;
  nextRetryAtIso: string;
  messageSummary: string;
  externalMessageId?: string;
  lastError?: string;
  payload: BusinessEventPayload;
  createdAtMs: number;
  createdAtIso: string;
  updatedAtMs: number;
  updatedAtIso: string;
  sentAtIso?: string;
  deadLetteredAtIso?: string;
}

export interface NotificationLogDoc {
  logId: string;
  jobId: string;
  eventId: string;
  eventType: BusinessEventType;
  channel: NotificationChannel;
  status: 'sent' | 'failed' | 'retrying' | 'dead_letter' | 'skipped';
  attemptNumber: number;
  messageSummary: string;
  externalMessageId?: string;
  errorDetail?: string;
  createdAtMs: number;
  createdAtIso: string;
}

export const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettingsDoc = {
  telegram: {
    enabled: true,
    chatIdsOverride: '',
  },
  discord: {
    enabled: true,
    enabledChannels: {
      'new-orders': true,
      payments: true,
      'customer-support': true,
      'inventory-alerts': true,
      'daily-reports': true,
      'system-alerts': true,
    },
  },
  whatsapp: {
    enabled: true,
    sendOrderConfirmations: false,
    sendStatusUpdates: false,
    sendDeliveryAlerts: false,
    orderConfirmationTemplateName: '',
    orderStatusTemplateName: '',
    templateLanguageCode: 'en_US',
  },
  aiSupport: {
    enabled: true,
  },
  updatedAtIso: '',
};

export const DEFAULT_NOTIFICATION_RULES: NotificationRulesDoc = {
  events: {
    ORDER_CREATED: { enabled: true, telegram: true, discord: true, whatsapp: true },
    ORDER_UPDATED: { enabled: true, telegram: true, discord: true, whatsapp: true },
    ORDER_CANCELLED: { enabled: true, telegram: true, discord: true, whatsapp: true },
    PAYMENT_SUCCESS: { enabled: true, telegram: true, discord: true, whatsapp: false },
    PAYMENT_FAILED: { enabled: true, telegram: true, discord: true, whatsapp: false },
    SUPPORT_REQUESTED: { enabled: true, telegram: true, discord: true, whatsapp: false },
    CUSTOMER_MESSAGE_RECEIVED: { enabled: true, telegram: false, discord: true, whatsapp: false },
    LOW_STOCK: { enabled: true, telegram: true, discord: true, whatsapp: false },
    DAILY_SUMMARY: { enabled: true, telegram: true, discord: true, whatsapp: false },
    SYSTEM_ERROR: { enabled: true, telegram: true, discord: true, whatsapp: false },
  },
  maxRetries: 4,
  baseBackoffSeconds: 30,
  lowStockThreshold: 5,
  updatedAtIso: '',
};

export function mapEventToDiscordChannel(eventType: BusinessEventType): DiscordChannelKey {
  switch (eventType) {
    case 'ORDER_CREATED':
    case 'ORDER_UPDATED':
    case 'ORDER_CANCELLED':
      return 'new-orders';
    case 'PAYMENT_SUCCESS':
    case 'PAYMENT_FAILED':
      return 'payments';
    case 'SUPPORT_REQUESTED':
    case 'CUSTOMER_MESSAGE_RECEIVED':
      return 'customer-support';
    case 'LOW_STOCK':
      return 'inventory-alerts';
    case 'DAILY_SUMMARY':
      return 'daily-reports';
    case 'SYSTEM_ERROR':
    default:
      return 'system-alerts';
  }
}

export function isValidBusinessEventType(value: unknown): value is BusinessEventType {
  return (
    typeof value === 'string' &&
    (BUSINESS_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Redacts URLs, bot tokens, Bearer headers, and query credentials from any error/log string.
 */
export function sanitizeNotificationError(raw: string): string {
  return String(raw || 'Unknown error')
    .replace(/https?:\/\/[^\s'"]+/gi, '[redacted-url]')
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, '[redacted-bot-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/(token|secret|key|password|passwd)=[^&\s]+/gi, '$1=[redacted]')
    .slice(0, 320);
}

export function maskPhoneForAdminAlert(phone?: string): string {
  const clean = String(phone || '').replace(/[^\d+]/g, '');
  if (!clean) return '';
  if (clean.length <= 6) return '***';
  return `${clean.slice(0, 4)}****${clean.slice(-3)}`;
}

export function buildAdminDashboardUrl(adminPath = '/admin'): string {
  const base = String(process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  const cleanPath = adminPath.startsWith('/') ? adminPath : `/${adminPath}`;
  if (!base || /^http:\/\/localhost/i.test(base)) {
    return base ? `${base}${cleanPath}` : cleanPath;
  }
  return `${base}${cleanPath}`;
}

export function mergeIntegrationSettings(
  raw?: Partial<IntegrationSettingsDoc> | null
): IntegrationSettingsDoc {
  const src = raw || {};
  return {
    telegram: {
      ...DEFAULT_INTEGRATION_SETTINGS.telegram,
      ...(src.telegram || {}),
    },
    discord: {
      ...DEFAULT_INTEGRATION_SETTINGS.discord,
      ...(src.discord || {}),
      enabledChannels: {
        ...DEFAULT_INTEGRATION_SETTINGS.discord.enabledChannels,
        ...(src.discord?.enabledChannels || {}),
      },
    },
    whatsapp: {
      ...DEFAULT_INTEGRATION_SETTINGS.whatsapp,
      ...(src.whatsapp || {}),
    },
    aiSupport: {
      ...DEFAULT_INTEGRATION_SETTINGS.aiSupport,
      ...(src.aiSupport || {}),
    },
    updatedAtIso: String(src.updatedAtIso || ''),
    updatedBy: src.updatedBy,
  };
}

export function mergeNotificationRules(
  raw?: Partial<NotificationRulesDoc> | null
): NotificationRulesDoc {
  const src = raw || {};
  const mergedEvents = { ...DEFAULT_NOTIFICATION_RULES.events };
  for (const key of BUSINESS_EVENT_TYPES) {
    if (src.events && src.events[key]) {
      mergedEvents[key] = {
        ...DEFAULT_NOTIFICATION_RULES.events[key],
        ...src.events[key],
      };
    }
  }
  const maxRetries = Math.min(8, Math.max(1, Math.round(Number(src.maxRetries || DEFAULT_NOTIFICATION_RULES.maxRetries))));
  const baseBackoffSeconds = Math.min(
    600,
    Math.max(5, Math.round(Number(src.baseBackoffSeconds || DEFAULT_NOTIFICATION_RULES.baseBackoffSeconds)))
  );
  const lowStockThreshold = Math.min(
    100,
    Math.max(0, Math.round(Number(src.lowStockThreshold ?? DEFAULT_NOTIFICATION_RULES.lowStockThreshold)))
  );

  return {
    events: mergedEvents,
    maxRetries,
    baseBackoffSeconds,
    lowStockThreshold,
    updatedAtIso: String(src.updatedAtIso || ''),
    updatedBy: src.updatedBy,
  };
}
