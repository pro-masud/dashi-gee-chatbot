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

export const CUSTOMER_CAPABLE_EVENTS = [
  'ORDER_CREATED',
  'ORDER_UPDATED',
  'ORDER_CANCELLED',
  'CUSTOMER_MESSAGE_RECEIVED',
] as const;

export function isCustomerCapableEvent(eventType: BusinessEventType): boolean {
  return (CUSTOMER_CAPABLE_EVENTS as readonly string[]).includes(eventType);
}

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

export type NotificationRecipientScope = 'admin' | 'customer' | 'both';

export interface NotificationTemplateVariableDef {
  key: string;
  label: string;
  sample: string;
}

export interface NotificationTemplateOverride {
  titleTemplate?: string;
  bodyTemplate?: string;
  emailSubjectTemplate?: string;
  whatsappMessageTemplate?: string;
  recipientScope?: NotificationRecipientScope;
}

export interface EventChannelRule {
  enabled: boolean;
  telegram: boolean;
  discord: boolean;
  whatsapp: boolean;
}

/**
 * Per-event notification toggles, custom templates & retry policy stored in Firestore (`notification_rules/main`).
 */
export interface NotificationRulesDoc {
  events: Record<BusinessEventType, EventChannelRule>;
  templates?: Partial<Record<BusinessEventType, NotificationTemplateOverride>>;
  ownerNotificationEmailOverride?: string;
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

export const EVENT_SUPPORTED_VARIABLES: Record<
  BusinessEventType,
  NotificationTemplateVariableDef[]
> = {
  ORDER_CREATED: [
    { key: 'order_id', label: 'Order ID', sample: 'DG-20261121-1042' },
    { key: 'customer_name', label: 'Customer Name', sample: 'Farhana Rahman' },
    { key: 'customer_phone', label: 'Customer Phone (masked for admin)', sample: '0171****890' },
    { key: 'items_summary', label: 'Items Summary', sample: '500g × 2' },
    { key: 'order_total', label: 'Order Total (BDT)', sample: '৳2,450' },
    { key: 'payment_method', label: 'Payment Method', sample: 'COD' },
    { key: 'payment_status', label: 'Payment Status', sample: 'cod_due' },
    { key: 'delivery_location', label: 'Delivery Area & District', sample: 'Dhanmondi, Dhaka' },
    { key: 'order_status', label: 'Order Status', sample: 'pending' },
  ],
  ORDER_UPDATED: [
    { key: 'order_id', label: 'Order ID', sample: 'DG-20261121-1042' },
    { key: 'customer_name', label: 'Customer Name', sample: 'Farhana Rahman' },
    { key: 'order_status', label: 'New Order Status', sample: 'shipped' },
    { key: 'payment_status', label: 'Payment Status', sample: 'verified' },
    { key: 'items_summary', label: 'Items Summary', sample: '500g × 2' },
    { key: 'order_total', label: 'Order Total (BDT)', sample: '৳2,450' },
    { key: 'delivery_location', label: 'Delivery Location', sample: 'Dhanmondi, Dhaka' },
    { key: 'summary', label: 'Update Summary', sample: 'Parcel dispatched via Steadfast courier.' },
  ],
  ORDER_CANCELLED: [
    { key: 'order_id', label: 'Order ID', sample: 'DG-20261121-1042' },
    { key: 'customer_name', label: 'Customer Name', sample: 'Farhana Rahman' },
    { key: 'order_status', label: 'Order Status', sample: 'cancelled' },
    { key: 'order_total', label: 'Order Total (BDT)', sample: '৳2,450' },
    { key: 'summary', label: 'Cancellation Note', sample: 'Cancelled by customer verification request.' },
  ],
  PAYMENT_SUCCESS: [
    { key: 'order_id', label: 'Order ID', sample: 'DG-20261121-1042' },
    { key: 'customer_name', label: 'Customer Name', sample: 'Farhana Rahman' },
    { key: 'order_total', label: 'Paid Amount (BDT)', sample: '৳2,450' },
    { key: 'payment_method', label: 'Payment Gateway', sample: 'BKASH' },
    { key: 'payment_status', label: 'Payment Status', sample: 'verified' },
    { key: 'summary', label: 'Verification Detail', sample: 'Server-verified online payment received.' },
  ],
  PAYMENT_FAILED: [
    { key: 'order_id', label: 'Order ID', sample: 'DG-20261121-1042' },
    { key: 'customer_name', label: 'Customer Name', sample: 'Farhana Rahman' },
    { key: 'order_total', label: 'Order Amount (BDT)', sample: '৳2,450' },
    { key: 'payment_method', label: 'Payment Gateway', sample: 'SSLCOMMERZ' },
    { key: 'payment_status', label: 'Payment Status', sample: 'failed' },
    { key: 'summary', label: 'Failure Reason', sample: 'Gateway payment was cancelled or failed.' },
  ],
  SUPPORT_REQUESTED: [
    { key: 'ticket_id', label: 'Support Ticket ID', sample: 'TKT-90421' },
    { key: 'customer_name', label: 'Customer Name', sample: 'Tanvir Ahmed' },
    { key: 'customer_phone', label: 'Customer Phone (masked)', sample: '0181****321' },
    { key: 'order_id', label: 'Related Order ID', sample: 'DG-20261121-1042' },
    { key: 'priority', label: 'Priority Level', sample: 'HIGH' },
    { key: 'summary', label: 'Issue Summary', sample: 'Customer requested human support for delivery reschedule.' },
  ],
  CUSTOMER_MESSAGE_RECEIVED: [
    { key: 'customer_name', label: 'Customer Name', sample: 'Nusrat Jahan' },
    { key: 'customer_phone', label: 'Customer Phone (masked)', sample: '0191****654' },
    { key: 'summary', label: 'Message Preview', sample: 'Apnader 1kg jar er stock ki ache?' },
  ],
  LOW_STOCK: [
    { key: 'variant_weight', label: 'Jar Weight', sample: '500g' },
    { key: 'remaining_stock', label: 'Remaining Stock', sample: '3' },
    { key: 'summary', label: 'Alert Summary', sample: '500g jar stock dropped below threshold.' },
  ],
  DAILY_SUMMARY: [
    { key: 'order_total', label: 'Total Revenue (BDT)', sample: '৳28,400' },
    { key: 'summary', label: 'Daily KPI Summary', sample: 'Orders: 14 (3 pending) · Revenue: ৳28,400 · Open Tickets: 1' },
  ],
  SYSTEM_ERROR: [
    { key: 'error_code', label: 'Error Code', sample: 'WEBHOOK_DELIVERY_RETRY' },
    { key: 'summary', label: 'Alert Detail', sample: 'Diagnostic check or runtime system notice.' },
  ],
};

export const DEFAULT_EVENT_TEMPLATES: Record<
  BusinessEventType,
  Required<NotificationTemplateOverride>
> = {
  ORDER_CREATED: {
    titleTemplate: 'New Order Received — {{order_id}}',
    bodyTemplate:
      '{{customer_name}} placed an order for {{items_summary}} ({{order_total}} · {{payment_method}}) to {{delivery_location}}.',
    emailSubjectTemplate: '[Deshi Gee] New Order {{order_id}} — {{order_total}}',
    whatsappMessageTemplate:
      'Assalamu Alaikum {{customer_name}}, your Deshi Gee order {{order_id}} ({{items_summary}}, Total {{order_total}}) has been received. Status: {{order_status}}.',
    recipientScope: 'both',
  },
  ORDER_UPDATED: {
    titleTemplate: 'Order {{order_id}} Updated — {{order_status}}',
    bodyTemplate: '{{customer_name}} · Order {{order_id}} is now {{order_status}}. {{summary}}',
    emailSubjectTemplate: '[Deshi Gee] Order {{order_id}} is now {{order_status}}',
    whatsappMessageTemplate:
      'Deshi Gee Update: Hello {{customer_name}}, your order {{order_id}} status is now {{order_status}}. {{summary}}',
    recipientScope: 'both',
  },
  ORDER_CANCELLED: {
    titleTemplate: 'Order Cancelled — {{order_id}}',
    bodyTemplate: 'Order {{order_id}} ({{customer_name}}, {{order_total}}) was cancelled. {{summary}}',
    emailSubjectTemplate: '[Deshi Gee] Order {{order_id}} Cancelled',
    whatsappMessageTemplate:
      'Deshi Gee Update: Your order {{order_id}} has been cancelled. {{summary}}',
    recipientScope: 'both',
  },
  PAYMENT_SUCCESS: {
    titleTemplate: 'Payment Verified — {{order_id}} ({{order_total}})',
    bodyTemplate:
      '{{payment_method}} payment of {{order_total}} verified for {{customer_name}} (Order {{order_id}}). {{summary}}',
    emailSubjectTemplate: '[Deshi Gee] Payment Verified for {{order_id}}',
    whatsappMessageTemplate:
      'Payment received! Your {{payment_method}} payment of {{order_total}} for order {{order_id}} is verified.',
    recipientScope: 'admin',
  },
  PAYMENT_FAILED: {
    titleTemplate: 'Payment Failed — {{order_id}}',
    bodyTemplate:
      '{{payment_method}} payment ({{order_total}}) failed for {{customer_name}} (Order {{order_id}}). {{summary}}',
    emailSubjectTemplate: '[Deshi Gee] Payment Failed — Order {{order_id}}',
    whatsappMessageTemplate:
      'Payment could not be completed for order {{order_id}}. Please reply if you need assistance.',
    recipientScope: 'admin',
  },
  SUPPORT_REQUESTED: {
    titleTemplate: 'Support Escalation — {{ticket_id}} ({{priority}})',
    bodyTemplate: '{{customer_name}} needs human support. {{summary}}',
    emailSubjectTemplate: '[Deshi Gee Support] Ticket {{ticket_id}} ({{priority}})',
    whatsappMessageTemplate:
      'Your Deshi Gee support request {{ticket_id}} has been assigned to a team member.',
    recipientScope: 'admin',
  },
  CUSTOMER_MESSAGE_RECEIVED: {
    titleTemplate: 'Inbound Customer Message — {{customer_name}}',
    bodyTemplate: '{{summary}}',
    emailSubjectTemplate: '[Deshi Gee] New Customer Message from {{customer_name}}',
    whatsappMessageTemplate: '{{summary}}',
    recipientScope: 'admin',
  },
  LOW_STOCK: {
    titleTemplate: 'Low Inventory Alert — {{variant_weight}} ({{remaining_stock}} left)',
    bodyTemplate: 'Jar size {{variant_weight}} has only {{remaining_stock}} unit(s) remaining. {{summary}}',
    emailSubjectTemplate: '[Deshi Gee Inventory] Low Stock on {{variant_weight}}',
    whatsappMessageTemplate: 'Low stock alert: {{variant_weight}} has {{remaining_stock}} jar(s) left.',
    recipientScope: 'admin',
  },
  DAILY_SUMMARY: {
    titleTemplate: 'Deshi Gee Daily Operations Summary',
    bodyTemplate: '{{summary}}',
    emailSubjectTemplate: '[Deshi Gee] Daily Operations Summary',
    whatsappMessageTemplate: 'Daily Summary: {{summary}}',
    recipientScope: 'admin',
  },
  SYSTEM_ERROR: {
    titleTemplate: 'System Alert — {{error_code}}',
    bodyTemplate: '{{summary}}',
    emailSubjectTemplate: '[Deshi Gee System Alert] {{error_code}}',
    whatsappMessageTemplate: 'System Alert: {{summary}}',
    recipientScope: 'admin',
  },
};

export const SAMPLE_EVENT_PAYLOADS: Record<BusinessEventType, BusinessEventPayload> = {
  ORDER_CREATED: {
    type: 'ORDER_CREATED',
    orderNumber: 'DG-20261121-1042',
    customerName: 'Farhana Rahman',
    customerPhone: '01711223890',
    itemsSummary: '500g × 2',
    totalBdt: 2450,
    paymentMethod: 'cod',
    paymentStatus: 'cod_due',
    orderStatus: 'pending',
    area: 'Dhanmondi',
    district: 'Dhaka',
    summary: 'New website order submitted via checkout.',
  },
  ORDER_UPDATED: {
    type: 'ORDER_UPDATED',
    orderNumber: 'DG-20261121-1042',
    customerName: 'Farhana Rahman',
    customerPhone: '01711223890',
    itemsSummary: '500g × 2',
    totalBdt: 2450,
    orderStatus: 'shipped',
    paymentStatus: 'verified',
    area: 'Dhanmondi',
    district: 'Dhaka',
    summary: 'Parcel handed over to Steadfast courier.',
  },
  ORDER_CANCELLED: {
    type: 'ORDER_CANCELLED',
    orderNumber: 'DG-20261121-1042',
    customerName: 'Farhana Rahman',
    totalBdt: 2450,
    orderStatus: 'cancelled',
    summary: 'Cancelled after customer verification.',
  },
  PAYMENT_SUCCESS: {
    type: 'PAYMENT_SUCCESS',
    orderNumber: 'DG-20261121-1042',
    customerName: 'Farhana Rahman',
    totalBdt: 2450,
    paymentMethod: 'bkash',
    paymentStatus: 'verified',
    summary: 'Server-verified online payment received.',
  },
  PAYMENT_FAILED: {
    type: 'PAYMENT_FAILED',
    orderNumber: 'DG-20261121-1042',
    customerName: 'Farhana Rahman',
    totalBdt: 2450,
    paymentMethod: 'sslcommerz',
    paymentStatus: 'failed',
    summary: 'Payment session cancelled by payer.',
  },
  SUPPORT_REQUESTED: {
    type: 'SUPPORT_REQUESTED',
    ticketId: 'TKT-90421',
    orderNumber: 'DG-20261121-1042',
    customerName: 'Tanvir Ahmed',
    customerPhone: '01811223321',
    priority: 'high',
    summary: 'Customer asked to reschedule delivery to tomorrow afternoon.',
  },
  CUSTOMER_MESSAGE_RECEIVED: {
    type: 'CUSTOMER_MESSAGE_RECEIVED',
    customerName: 'Nusrat Jahan',
    customerPhone: '01911223654',
    summary: 'Apnader 1kg jar er stock ki ache? Dhaka te delivery koto?',
  },
  LOW_STOCK: {
    type: 'LOW_STOCK',
    variantWeight: '500g',
    remainingStock: 3,
    summary: 'Restock recommended before afternoon dispatch cut-off.',
  },
  DAILY_SUMMARY: {
    type: 'DAILY_SUMMARY',
    totalBdt: 28400,
    summary: 'Orders: 14 (3 pending) · Revenue: ৳28,400 · Open Tickets: 1 · Dead-Letter Alerts: 0',
  },
  SYSTEM_ERROR: {
    type: 'SYSTEM_ERROR',
    errorCode: 'DIAGNOSTIC_TEST',
    summary: 'Test alert triggered from Deshi Gee Admin Dashboard.',
  },
};

/**
 * Interpolates supported `{{variable}}` tokens against a BusinessEventPayload.
 * Unsupported variables are safely left blank/removed rather than rendering `undefined`.
 */
export function renderNotificationTemplate(
  templateText: string,
  event: BusinessEventPayload,
  options?: { maskPhone?: boolean }
): string {
  const rawTemplate = String(templateText || '').trim();
  if (!rawTemplate) return '';

  const location = [event.area, event.district].filter(Boolean).join(', ');
  const totalFormatted =
    typeof event.totalBdt === 'number' && Number.isFinite(event.totalBdt) && event.totalBdt > 0
      ? `৳${Math.round(event.totalBdt).toLocaleString('en-US')}`
      : '৳0';
  const phoneVal = event.customerPhone
    ? options?.maskPhone !== false
      ? maskPhoneForAdminAlert(event.customerPhone)
      : event.customerPhone
    : '';

  const values: Record<string, string> = {
    order_id: String(event.orderNumber || '').trim(),
    customer_name: String(event.customerName || 'Customer').trim(),
    customer_phone: phoneVal,
    items_summary: String(event.itemsSummary || '').trim(),
    order_total: totalFormatted,
    payment_method: String(event.paymentMethod || '').trim().toUpperCase(),
    payment_status: String(event.paymentStatus || '').trim(),
    order_status: String(event.orderStatus || '').trim(),
    delivery_location: location,
    ticket_id: String(event.ticketId || '').trim(),
    priority: String(event.priority || 'normal').trim().toUpperCase(),
    variant_weight: String(event.variantWeight || '').trim(),
    remaining_stock:
      typeof event.remainingStock === 'number' && Number.isFinite(event.remainingStock)
        ? String(event.remainingStock)
        : '',
    error_code: String(event.errorCode || 'NOTICE').trim(),
    summary: String(event.summary || '').trim(),
    admin_url: buildAdminDashboardUrl(event.adminPath || '/admin'),
  };

  const allowedKeys = new Set(
    (EVENT_SUPPORTED_VARIABLES[event.type] || []).map((v) => v.key).concat(['admin_url'])
  );

  return rawTemplate
    .replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, rawKey: string) => {
      const key = rawKey.toLowerCase();
      if (!allowedKeys.has(key)) return '';
      return values[key] ?? '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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
  templates: {},
  ownerNotificationEmailOverride: '',
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

  const mergedTemplates: Partial<Record<BusinessEventType, NotificationTemplateOverride>> = {};
  if (src.templates && typeof src.templates === 'object') {
    for (const key of BUSINESS_EVENT_TYPES) {
      const tpl = src.templates[key];
      if (tpl && typeof tpl === 'object') {
        const rawScope: NotificationRecipientScope | undefined =
          tpl.recipientScope === 'admin' ||
          tpl.recipientScope === 'customer' ||
          tpl.recipientScope === 'both'
            ? tpl.recipientScope
            : undefined;
        const cleanScope: NotificationRecipientScope | undefined = rawScope
          ? isCustomerCapableEvent(key)
            ? rawScope
            : 'admin'
          : undefined;
        mergedTemplates[key] = {
          ...(typeof tpl.titleTemplate === 'string' && tpl.titleTemplate.trim()
            ? { titleTemplate: tpl.titleTemplate.trim().slice(0, 180) }
            : {}),
          ...(typeof tpl.bodyTemplate === 'string' && tpl.bodyTemplate.trim()
            ? { bodyTemplate: tpl.bodyTemplate.trim().slice(0, 1200) }
            : {}),
          ...(typeof tpl.emailSubjectTemplate === 'string' && tpl.emailSubjectTemplate.trim()
            ? { emailSubjectTemplate: tpl.emailSubjectTemplate.trim().slice(0, 160) }
            : {}),
          ...(typeof tpl.whatsappMessageTemplate === 'string' &&
          tpl.whatsappMessageTemplate.trim()
            ? { whatsappMessageTemplate: tpl.whatsappMessageTemplate.trim().slice(0, 1000) }
            : {}),
          ...(cleanScope ? { recipientScope: cleanScope } : {}),
        };
      }
    }
  }

  const maxRetries = Math.min(
    8,
    Math.max(1, Math.round(Number(src.maxRetries || DEFAULT_NOTIFICATION_RULES.maxRetries)))
  );
  const baseBackoffSeconds = Math.min(
    600,
    Math.max(
      5,
      Math.round(Number(src.baseBackoffSeconds || DEFAULT_NOTIFICATION_RULES.baseBackoffSeconds))
    )
  );
  const lowStockThreshold = Math.min(
    100,
    Math.max(
      0,
      Math.round(Number(src.lowStockThreshold ?? DEFAULT_NOTIFICATION_RULES.lowStockThreshold))
    )
  );

  return {
    events: mergedEvents,
    templates: mergedTemplates,
    ownerNotificationEmailOverride:
      typeof src.ownerNotificationEmailOverride === 'string'
        ? src.ownerNotificationEmailOverride.trim().slice(0, 120)
        : '',
    maxRetries,
    baseBackoffSeconds,
    lowStockThreshold,
    updatedAtIso: String(src.updatedAtIso || ''),
    updatedBy: src.updatedBy,
  };
}
