import {
  buildAdminDashboardUrl,
  DISCORD_CHANNEL_KEYS,
  mapEventToDiscordChannel,
  maskPhoneForAdminAlert,
  renderNotificationTemplate,
  sanitizeNotificationError,
  type BusinessEventPayload,
  type BusinessEventType,
  type DiscordChannelKey,
  type NotificationTemplateOverride,
} from '../notifications/types';

export interface DiscordChannelReadiness {
  channelKey: DiscordChannelKey;
  label: string;
  configured: boolean;
  usesDedicatedWebhook: boolean;
}

export interface DiscordReadinessStatus {
  configured: boolean;
  defaultWebhookConfigured: boolean;
  channels: DiscordChannelReadiness[];
}

export interface DiscordSendResult {
  ok: boolean;
  configured: boolean;
  channelKey: DiscordChannelKey;
  error?: string;
  retryable?: boolean;
}

const CHANNEL_ENV_MAP: Record<DiscordChannelKey, string> = {
  'new-orders': 'DISCORD_WEBHOOK_ORDERS',
  payments: 'DISCORD_WEBHOOK_PAYMENTS',
  'customer-support': 'DISCORD_WEBHOOK_SUPPORT',
  'inventory-alerts': 'DISCORD_WEBHOOK_INVENTORY',
  'daily-reports': 'DISCORD_WEBHOOK_REPORTS',
  'system-alerts': 'DISCORD_WEBHOOK_SYSTEM',
};

const CHANNEL_LABELS: Record<DiscordChannelKey, string> = {
  'new-orders': '#new-orders',
  payments: '#payments',
  'customer-support': '#customer-support',
  'inventory-alerts': '#inventory-alerts',
  'daily-reports': '#daily-reports',
  'system-alerts': '#system-alerts',
};

function isSafeDiscordWebhookUrl(raw: string): boolean {
  const clean = String(raw || '').trim();
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      (host === 'discord.com' ||
        host === 'discordapp.com' ||
        host.endsWith('.discord.com')) &&
      parsed.pathname.startsWith('/api/webhooks/')
    );
  } catch {
    return false;
  }
}

export function resolveDiscordWebhookUrl(channelKey: DiscordChannelKey): {
  url: string;
  usesDedicatedWebhook: boolean;
} {
  const envName = CHANNEL_ENV_MAP[channelKey];
  const dedicated = String(process.env[envName] || '').trim();
  if (isSafeDiscordWebhookUrl(dedicated)) {
    return { url: dedicated, usesDedicatedWebhook: true };
  }
  const fallback = String(process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (isSafeDiscordWebhookUrl(fallback)) {
    return { url: fallback, usesDedicatedWebhook: false };
  }
  return { url: '', usesDedicatedWebhook: false };
}

export function getDiscordReadiness(): DiscordReadinessStatus {
  const defaultWebhookConfigured = isSafeDiscordWebhookUrl(
    String(process.env.DISCORD_WEBHOOK_URL || '')
  );
  const channels: DiscordChannelReadiness[] = DISCORD_CHANNEL_KEYS.map((channelKey) => {
    const resolved = resolveDiscordWebhookUrl(channelKey);
    return {
      channelKey,
      label: CHANNEL_LABELS[channelKey],
      configured: Boolean(resolved.url),
      usesDedicatedWebhook: resolved.usesDedicatedWebhook,
    };
  });

  return {
    configured: channels.some((c) => c.configured),
    defaultWebhookConfigured,
    channels,
  };
}

function getEmbedColor(type: BusinessEventType): number {
  switch (type) {
    case 'ORDER_CREATED':
    case 'PAYMENT_SUCCESS':
      return 0x2d6a4f; // forest emerald
    case 'ORDER_UPDATED':
    case 'DAILY_SUMMARY':
      return 0xb47b2b; // deshi gee amber
    case 'LOW_STOCK':
    case 'SUPPORT_REQUESTED':
    case 'CUSTOMER_MESSAGE_RECEIVED':
      return 0xd97706; // warm warning amber
    case 'ORDER_CANCELLED':
    case 'PAYMENT_FAILED':
    case 'SYSTEM_ERROR':
      return 0xdc2626; // crimson alert
    default:
      return 0x1e1710;
  }
}

export interface DiscordEmbedPayload {
  username: string;
  embeds: Array<{
    title: string;
    description?: string;
    color: number;
    url?: string;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
    footer: { text: string };
    timestamp: string;
  }>;
}

export function buildDiscordEmbedPayload(
  event: BusinessEventPayload,
  templateOverride?: NotificationTemplateOverride
): DiscordEmbedPayload {
  const channelKey = mapEventToDiscordChannel(event.type);
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  if (event.orderNumber) {
    fields.push({ name: 'Order ID', value: event.orderNumber.slice(0, 64), inline: true });
  }
  if (typeof event.totalBdt === 'number' && event.totalBdt > 0) {
    fields.push({
      name: 'Total Amount',
      value: `৳${Math.round(event.totalBdt).toLocaleString('en-US')}`,
      inline: true,
    });
  }
  if (event.paymentMethod) {
    fields.push({
      name: 'Payment Method',
      value: event.paymentMethod.toUpperCase().slice(0, 32),
      inline: true,
    });
  }
  if (event.orderStatus || event.paymentStatus) {
    fields.push({
      name: 'Status',
      value: [event.orderStatus, event.paymentStatus].filter(Boolean).join(' · ').slice(0, 80),
      inline: true,
    });
  }
  if (event.customerName) {
    const phoneMask = event.customerPhone ? ` (${maskPhoneForAdminAlert(event.customerPhone)})` : '';
    fields.push({
      name: 'Customer',
      value: `${event.customerName}${phoneMask}`.slice(0, 120),
      inline: true,
    });
  }
  if (event.itemsSummary) {
    fields.push({ name: 'Product Details', value: event.itemsSummary.slice(0, 200), inline: false });
  }
  if (event.district || event.area) {
    fields.push({
      name: 'Delivery Location',
      value: [event.area, event.district].filter(Boolean).join(', ').slice(0, 120),
      inline: true,
    });
  }
  if (event.ticketId) {
    fields.push({ name: 'Support Ticket', value: event.ticketId.slice(0, 64), inline: true });
  }
  if (event.priority) {
    fields.push({ name: 'Priority', value: event.priority.toUpperCase(), inline: true });
  }
  if (event.variantWeight && typeof event.remainingStock === 'number') {
    fields.push({
      name: 'Inventory Remaining',
      value: `${event.variantWeight}: ${event.remainingStock} jar(s)`,
      inline: true,
    });
  }
  if (event.errorCode) {
    fields.push({ name: 'Error Code', value: event.errorCode.slice(0, 80), inline: true });
  }

  const adminUrl = buildAdminDashboardUrl(event.adminPath || '/admin');
  const validHttpUrl = /^https?:\/\//i.test(adminUrl) ? adminUrl : undefined;

  const customTitle = templateOverride?.titleTemplate
    ? renderNotificationTemplate(templateOverride.titleTemplate, event, { maskPhone: true })
    : '';
  const customBody = templateOverride?.bodyTemplate
    ? renderNotificationTemplate(templateOverride.bodyTemplate, event, { maskPhone: true })
    : '';

  return {
    username: 'Deshi Gee Operations',
    embeds: [
      {
        title: (customTitle || event.title || event.type.replace(/_/g, ' ')).slice(0, 240),
        description:
          customBody || event.summary ? (customBody || event.summary || '').slice(0, 1500) : undefined,
        color: getEmbedColor(event.type),
        url: validHttpUrl,
        fields: fields.slice(0, 12),
        footer: { text: `Deshi Gee · ${CHANNEL_LABELS[channelKey]}` },
        timestamp: event.occurredAtIso || new Date().toISOString(),
      },
    ],
  };
}

/**
 * Dispatches a structured Discord Embed notification to the resolved channel webhook.
 * Never logs or returns any webhook URL.
 */
export async function sendDiscordEventNotification(
  event: BusinessEventPayload,
  options?: {
    channelKeyOverride?: DiscordChannelKey;
    templateOverride?: NotificationTemplateOverride;
    fetchImpl?: typeof fetch;
  }
): Promise<DiscordSendResult> {
  const channelKey = options?.channelKeyOverride || mapEventToDiscordChannel(event.type);
  const { url } = resolveDiscordWebhookUrl(channelKey);

  if (!url) {
    return {
      ok: false,
      configured: false,
      channelKey,
      error: `Discord webhook is not configured for ${CHANNEL_LABELS[channelKey]} (set ${CHANNEL_ENV_MAP[channelKey]} or DISCORD_WEBHOOK_URL).`,
      retryable: false,
    };
  }

  const payload = buildDiscordEmbedPayload(event, options?.templateOverride);
  const doFetch = options?.fetchImpl || fetch;

  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (res.ok) {
      return { ok: true, configured: true, channelKey };
    }

    const retryable = res.status === 429 || res.status >= 500;
    const errText = await res.text().catch(() => '');
    return {
      ok: false,
      configured: true,
      channelKey,
      error: `Discord webhook HTTP ${res.status}: ${sanitizeNotificationError(errText)}`,
      retryable,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      channelKey,
      error: sanitizeNotificationError(err instanceof Error ? err.message : 'Discord webhook network failure'),
      retryable: true,
    };
  }
}

export async function testDiscordConnection(options?: {
  channelKey?: DiscordChannelKey;
  fetchImpl?: typeof fetch;
}): Promise<DiscordSendResult> {
  const channelKey = options?.channelKey || 'system-alerts';
  return sendDiscordEventNotification(
    {
      type: 'SYSTEM_ERROR',
      title: `Deshi Gee Discord Test (${CHANNEL_LABELS[channelKey]})`,
      summary: 'Discord webhook connection verified from the Deshi Gee Admin Console.',
      adminPath: '/admin',
    },
    { channelKeyOverride: channelKey, fetchImpl: options?.fetchImpl }
  );
}
