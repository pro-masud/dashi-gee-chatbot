import {
  sanitizeNotificationError,
  type BusinessEventPayload,
  type IntegrationSettingsDoc,
} from '../notifications/types';
import { normalizeBangladeshPhone } from '../chatbot/orderToken';

export interface WhatsAppCloudReadiness {
  configured: boolean;
  hasAccessToken: boolean;
  hasPhoneNumberId: boolean;
  hasBusinessAccountId: boolean;
  hasVerifyToken: boolean;
  hasAppSecret: boolean;
}

export interface WhatsAppSendResult {
  ok: boolean;
  configured: boolean;
  messageId?: string;
  skippedReason?: string;
  error?: string;
  retryable?: boolean;
}

export interface WhatsAppDeliveryStatusEvent {
  messageId: string;
  recipientId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestampMs: number;
  errorTitle?: string;
}

const GRAPH_API_VERSION = 'v20.0';

function getWhatsAppAccessToken(): string {
  return String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
}

function getWhatsAppPhoneNumberId(): string {
  return String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
}

export function getWhatsAppCloudReadiness(): WhatsAppCloudReadiness {
  const hasAccessToken = getWhatsAppAccessToken().length > 10;
  const hasPhoneNumberId = getWhatsAppPhoneNumberId().length > 4;
  const hasBusinessAccountId =
    String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim().length > 4;
  const hasVerifyToken =
    String(process.env.WHATSAPP_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN || '').trim()
      .length >= 6;
  const hasAppSecret =
    String(process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET || '').trim()
      .length >= 8;

  return {
    configured: hasAccessToken && hasPhoneNumberId,
    hasAccessToken,
    hasPhoneNumberId,
    hasBusinessAccountId,
    hasVerifyToken,
    hasAppSecret,
  };
}

/**
 * Formats a Bangladesh phone (`01XXXXXXXXX`) into E.164 digits (`8801XXXXXXXXX`) for Meta Cloud API.
 */
export function formatWhatsAppRecipient(rawPhone: string): string {
  const normalized = normalizeBangladeshPhone(rawPhone);
  if (/^01[3-9]\d{8}$/.test(normalized)) {
    return `88${normalized}`;
  }
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (/^8801[3-9]\d{8}$/.test(digits)) {
    return digits;
  }
  return '';
}

/**
 * Sends a free-form text reply within an active 24-hour customer-initiated WhatsApp window.
 */
export async function sendWhatsAppTextMessage(params: {
  toPhone: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<WhatsAppSendResult> {
  const token = getWhatsAppAccessToken();
  const phoneNumberId = getWhatsAppPhoneNumberId();
  if (!token || !phoneNumberId) {
    return {
      ok: false,
      configured: false,
      error: 'WhatsApp Cloud API is not configured (WHATSAPP_ACCESS_TOKEN & WHATSAPP_PHONE_NUMBER_ID required).',
      retryable: false,
    };
  }

  const recipient = formatWhatsAppRecipient(params.toPhone);
  if (!recipient) {
    return {
      ok: false,
      configured: true,
      error: 'Invalid WhatsApp recipient phone number.',
      retryable: false,
    };
  }

  const doFetch = params.fetchImpl || fetch;
  try {
    const res = await doFetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'text',
          text: { body: String(params.text || '').slice(0, 1500), preview_url: false },
        }),
        cache: 'no-store',
      }
    );

    const data = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };
    if (res.ok) {
      return {
        ok: true,
        configured: true,
        messageId: data.messages?.[0]?.id || 'wa_sent',
      };
    }

    return {
      ok: false,
      configured: true,
      error: `WhatsApp Cloud HTTP ${res.status}: ${sanitizeNotificationError(data.error?.message || 'API error')}`,
      retryable: res.status === 429 || res.status >= 500,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: sanitizeNotificationError(err instanceof Error ? err.message : 'WhatsApp network failure'),
      retryable: true,
    };
  }
}

/**
 * Sends a Meta-approved utility template message (for order confirmations, status & delivery updates).
 */
export async function sendWhatsAppTemplateMessage(params: {
  toPhone: string;
  templateName: string;
  languageCode?: string;
  bodyParameters: string[];
  fetchImpl?: typeof fetch;
}): Promise<WhatsAppSendResult> {
  const token = getWhatsAppAccessToken();
  const phoneNumberId = getWhatsAppPhoneNumberId();
  if (!token || !phoneNumberId) {
    return {
      ok: false,
      configured: false,
      error: 'WhatsApp Cloud API is not configured (WHATSAPP_ACCESS_TOKEN & WHATSAPP_PHONE_NUMBER_ID required).',
      retryable: false,
    };
  }

  const recipient = formatWhatsAppRecipient(params.toPhone);
  if (!recipient) {
    return {
      ok: false,
      configured: true,
      error: 'Invalid WhatsApp recipient phone number.',
      retryable: false,
    };
  }

  const templateName = String(params.templateName || '').trim();
  if (!templateName) {
    return {
      ok: false,
      configured: true,
      skippedReason: 'approved_template_not_configured',
      error: 'Approved WhatsApp utility template name is not configured in Admin Integration Settings.',
      retryable: false,
    };
  }

  const doFetch = params.fetchImpl || fetch;
  try {
    const res = await doFetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'template',
          template: {
            name: templateName,
            language: { code: params.languageCode || 'en_US' },
            components: [
              {
                type: 'body',
                parameters: params.bodyParameters.slice(0, 6).map((text) => ({
                  type: 'text',
                  text: String(text || '').slice(0, 200),
                })),
              },
            ],
          },
        }),
        cache: 'no-store',
      }
    );

    const data = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };
    if (res.ok) {
      return {
        ok: true,
        configured: true,
        messageId: data.messages?.[0]?.id || 'wa_template_sent',
      };
    }

    return {
      ok: false,
      configured: true,
      error: `WhatsApp template HTTP ${res.status}: ${sanitizeNotificationError(data.error?.message || 'API error')}`,
      retryable: res.status === 429 || res.status >= 500,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: sanitizeNotificationError(err instanceof Error ? err.message : 'WhatsApp network failure'),
      retryable: true,
    };
  }
}

/**
 * Policy-compliant WhatsApp business event dispatcher:
 * - Requires customer opt-in (`whatsappOptIn === true`) OR active 24h customer-care window.
 * - Uses approved template messages for proactive order confirmation / status updates outside 24h.
 */
export async function sendWhatsAppBusinessEventNotification(
  event: BusinessEventPayload,
  waSettings: IntegrationSettingsDoc['whatsapp'],
  options?: { fetchImpl?: typeof fetch }
): Promise<WhatsAppSendResult> {
  if (!event.customerPhone) {
    return {
      ok: false,
      configured: getWhatsAppCloudReadiness().configured,
      skippedReason: 'no_customer_phone',
      error: 'Event has no customer phone number for WhatsApp delivery.',
      retryable: false,
    };
  }

  if (event.type === 'ORDER_CREATED' && !waSettings.sendOrderConfirmations) {
    return {
      ok: false,
      configured: getWhatsAppCloudReadiness().configured,
      skippedReason: 'whatsapp_order_confirmations_disabled',
      error: 'WhatsApp order confirmation messages are disabled in settings.',
      retryable: false,
    };
  }

  if ((event.type === 'ORDER_UPDATED' || event.type === 'ORDER_CANCELLED') && !waSettings.sendStatusUpdates) {
    return {
      ok: false,
      configured: getWhatsAppCloudReadiness().configured,
      skippedReason: 'whatsapp_status_updates_disabled',
      error: 'WhatsApp order status updates are disabled in settings.',
      retryable: false,
    };
  }

  if (!event.withinWhatsapp24hWindow && event.whatsappOptIn !== true) {
    return {
      ok: false,
      configured: getWhatsAppCloudReadiness().configured,
      skippedReason: 'missing_customer_opt_in',
      error: 'Skipped proactive WhatsApp notification: verified customer opt-in is required outside the 24-hour window.',
      retryable: false,
    };
  }

  if (event.withinWhatsapp24hWindow && !event.whatsappTemplateName) {
    const bodyText = [
      event.title || 'Deshi Gee Order Update',
      event.orderNumber ? `Order: ${event.orderNumber}` : '',
      event.itemsSummary ? `Items: ${event.itemsSummary}` : '',
      typeof event.totalBdt === 'number' && event.totalBdt > 0 ? `Total: ৳${Math.round(event.totalBdt)}` : '',
      event.orderStatus ? `Status: ${event.orderStatus}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return sendWhatsAppTextMessage({
      toPhone: event.customerPhone,
      text: bodyText,
      fetchImpl: options?.fetchImpl,
    });
  }

  const templateName =
    event.whatsappTemplateName ||
    (event.type === 'ORDER_CREATED'
      ? waSettings.orderConfirmationTemplateName
      : waSettings.orderStatusTemplateName);

  return sendWhatsAppTemplateMessage({
    toPhone: event.customerPhone,
    templateName,
    languageCode: waSettings.templateLanguageCode || 'en_US',
    bodyParameters: [
      event.customerName || 'Customer',
      event.orderNumber || 'Order',
      event.orderStatus || event.summary || 'Updated',
    ],
    fetchImpl: options?.fetchImpl,
  });
}

/**
 * Extracts WhatsApp Cloud API delivery status receipts (`sent`, `delivered`, `read`, `failed`).
 */
export function parseWhatsAppDeliveryStatuses(
  body: Record<string, unknown>
): WhatsAppDeliveryStatusEvent[] {
  const out: WhatsAppDeliveryStatusEvent[] = [];
  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as Record<string, unknown>)?.changes)
      ? ((entry as Record<string, unknown>).changes as Array<Record<string, unknown>>)
      : [];
    for (const change of changes) {
      const value = (change?.value || {}) as Record<string, unknown>;
      const statuses = Array.isArray(value.statuses)
        ? (value.statuses as Array<Record<string, unknown>>)
        : [];
      for (const st of statuses) {
        const rawStatus = String(st.status || '').toLowerCase();
        if (
          rawStatus !== 'sent' &&
          rawStatus !== 'delivered' &&
          rawStatus !== 'read' &&
          rawStatus !== 'failed'
        ) {
          continue;
        }
        const messageId = String(st.id || '').trim();
        const recipientId = String(st.recipient_id || '').trim();
        if (!messageId) continue;
        const tsSec = Number(st.timestamp || 0);
        const errors = Array.isArray(st.errors) ? (st.errors as Array<Record<string, unknown>>) : [];
        const errorTitle = errors[0]?.title ? String(errors[0].title) : undefined;
        out.push({
          messageId,
          recipientId,
          status: rawStatus,
          timestampMs: tsSec > 0 ? tsSec * 1000 : Date.now(),
          errorTitle,
        });
      }
    }
  }
  return out;
}

/**
 * Tests WhatsApp Cloud API credentials against Meta Graph Phone Number endpoint (read-only).
 */
export async function testWhatsAppCloudConnection(options?: {
  fetchImpl?: typeof fetch;
}): Promise<{
  ok: boolean;
  configured: boolean;
  verifiedName?: string;
  displayPhoneNumber?: string;
  error?: string;
}> {
  const token = getWhatsAppAccessToken();
  const phoneNumberId = getWhatsAppPhoneNumberId();
  if (!token || !phoneNumberId) {
    return {
      ok: false,
      configured: false,
      error: 'WhatsApp Cloud API is not configured (WHATSAPP_ACCESS_TOKEN & WHATSAPP_PHONE_NUMBER_ID required).',
    };
  }

  const doFetch = options?.fetchImpl || fetch;
  try {
    const res = await doFetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}?fields=verified_name,display_phone_number`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }
    );
    const data = (await res.json().catch(() => ({}))) as {
      verified_name?: string;
      display_phone_number?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        error: `WhatsApp Graph HTTP ${res.status}: ${sanitizeNotificationError(data.error?.message || 'Unauthorized')}`,
      };
    }
    return {
      ok: true,
      configured: true,
      verifiedName: data.verified_name,
      displayPhoneNumber: data.display_phone_number,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: sanitizeNotificationError(err instanceof Error ? err.message : 'WhatsApp connection test failed'),
    };
  }
}
