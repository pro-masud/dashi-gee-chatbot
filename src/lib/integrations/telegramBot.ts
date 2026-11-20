import {
  buildAdminDashboardUrl,
  maskPhoneForAdminAlert,
  sanitizeNotificationError,
  type BusinessEventPayload,
  type BusinessEventType,
} from '../notifications/types';

export interface TelegramConfigStatus {
  configured: boolean;
  hasBotToken: boolean;
  chatIdCount: number;
  maskedChatIds: string[];
}

export interface TelegramSendResult {
  ok: boolean;
  configured: boolean;
  messageIds: string[];
  error?: string;
  retryable?: boolean;
}

export interface TelegramTestResult {
  ok: boolean;
  configured: boolean;
  botUsername?: string;
  sentToChats?: number;
  error?: string;
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getTelegramBotToken(): string {
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

export function resolveTelegramChatIds(chatIdsOverride?: string): string[] {
  const raw = String(chatIdsOverride || process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^-?\d{4,20}$/.test(id));
}

export function getTelegramReadiness(chatIdsOverride?: string): TelegramConfigStatus {
  const hasBotToken = getTelegramBotToken().length >= 20;
  const chatIds = resolveTelegramChatIds(chatIdsOverride);
  return {
    configured: hasBotToken && chatIds.length > 0,
    hasBotToken,
    chatIdCount: chatIds.length,
    maskedChatIds: chatIds.map((id) =>
      id.length > 5 ? `${id.slice(0, 3)}***${id.slice(-2)}` : '***'
    ),
  };
}

const EVENT_LABELS: Record<BusinessEventType, string> = {
  ORDER_CREATED: 'New Order Received',
  ORDER_UPDATED: 'Order Updated',
  ORDER_CANCELLED: 'Order Cancelled',
  PAYMENT_SUCCESS: 'Payment Verified',
  PAYMENT_FAILED: 'Payment Failed',
  SUPPORT_REQUESTED: 'Customer Support Request',
  CUSTOMER_MESSAGE_RECEIVED: 'Customer Message Received',
  LOW_STOCK: 'Low Inventory Alert',
  DAILY_SUMMARY: 'Daily Business Summary',
  SYSTEM_ERROR: 'System Alert',
};

export function formatTelegramEventHtml(event: BusinessEventPayload): string {
  const title = event.title || EVENT_LABELS[event.type] || event.type;
  const lines: string[] = [`<b>${escapeHtml(title)}</b>`];

  if (event.summary) {
    lines.push(escapeHtml(event.summary.slice(0, 500)));
  }

  if (event.orderNumber) {
    lines.push(`<b>Order ID:</b> <code>${escapeHtml(event.orderNumber)}</code>`);
  }
  if (event.customerName) {
    const maskedPhone = event.customerPhone ? ` (${maskPhoneForAdminAlert(event.customerPhone)})` : '';
    lines.push(`<b>Customer:</b> ${escapeHtml(event.customerName)}${escapeHtml(maskedPhone)}`);
  }
  if (event.itemsSummary) {
    lines.push(`<b>Items:</b> ${escapeHtml(event.itemsSummary)}`);
  }
  if (typeof event.totalBdt === 'number' && event.totalBdt > 0) {
    lines.push(`<b>Total:</b> ৳${Math.round(event.totalBdt).toLocaleString('en-US')}`);
  }
  if (event.paymentMethod) {
    lines.push(`<b>Payment:</b> ${escapeHtml(event.paymentMethod.toUpperCase())}`);
  }
  if (event.orderStatus || event.paymentStatus) {
    const statusParts = [event.orderStatus, event.paymentStatus].filter(Boolean).join(' / ');
    lines.push(`<b>Status:</b> ${escapeHtml(statusParts)}`);
  }
  if (event.district || event.area) {
    lines.push(
      `<b>Location:</b> ${escapeHtml([event.area, event.district].filter(Boolean).join(', '))}`
    );
  }
  if (event.ticketId) {
    lines.push(`<b>Ticket:</b> <code>${escapeHtml(event.ticketId)}</code>`);
  }
  if (event.priority && event.priority !== 'normal') {
    lines.push(`<b>Priority:</b> ${escapeHtml(event.priority.toUpperCase())}`);
  }
  if (event.variantWeight && typeof event.remainingStock === 'number') {
    lines.push(
      `<b>Inventory:</b> ${escapeHtml(event.variantWeight)} — ${event.remainingStock} jar(s) left`
    );
  }
  if (event.errorCode) {
    lines.push(`<b>Error Code:</b> <code>${escapeHtml(event.errorCode)}</code>`);
  }

  const adminUrl = buildAdminDashboardUrl(event.adminPath || '/admin');
  if (/^https?:\/\//i.test(adminUrl)) {
    lines.push(`<a href="${escapeHtml(adminUrl)}">Open Admin Console</a>`);
  } else {
    lines.push(`Admin Console: ${escapeHtml(adminUrl)}`);
  }

  return lines.join('\n').slice(0, 3900);
}

/**
 * Dispatches an admin notification via the official Telegram Bot API (`sendMessage`).
 * Never logs or returns `TELEGRAM_BOT_TOKEN`.
 */
export async function sendTelegramEventNotification(
  event: BusinessEventPayload,
  options?: { chatIdsOverride?: string; fetchImpl?: typeof fetch }
): Promise<TelegramSendResult> {
  const token = getTelegramBotToken();
  const chatIds = resolveTelegramChatIds(options?.chatIdsOverride);

  if (!token || chatIds.length === 0) {
    return {
      ok: false,
      configured: false,
      messageIds: [],
      error: 'Telegram Bot is not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID).',
      retryable: false,
    };
  }

  const html = formatTelegramEventHtml(event);
  const doFetch = options?.fetchImpl || fetch;
  const messageIds: string[] = [];
  const errors: string[] = [];
  let retryable = false;

  for (const chatId of chatIds) {
    try {
      const res = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: html,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        cache: 'no-store',
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { message_id?: number };
        description?: string;
      };

      if (res.ok && data.ok) {
        messageIds.push(String(data.result?.message_id ?? 'ok'));
      } else {
        if (res.status === 429 || res.status >= 500) {
          retryable = true;
        }
        errors.push(`HTTP ${res.status}: ${sanitizeNotificationError(data.description || 'Telegram API error')}`);
      }
    } catch (err) {
      retryable = true;
      errors.push(sanitizeNotificationError(err instanceof Error ? err.message : 'Telegram network failure'));
    }
  }

  if (messageIds.length > 0 && errors.length === 0) {
    return { ok: true, configured: true, messageIds };
  }
  if (messageIds.length > 0) {
    return {
      ok: true,
      configured: true,
      messageIds,
      error: `Partial delivery: ${errors.join('; ')}`,
    };
  }
  return {
    ok: false,
    configured: true,
    messageIds: [],
    error: errors.join('; ') || 'Telegram dispatch failed.',
    retryable,
  };
}

/**
 * Verifies the Telegram Bot token via `getMe` and optionally sends a test ping to configured chats.
 */
export async function testTelegramConnection(options?: {
  chatIdsOverride?: string;
  sendPingMessage?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<TelegramTestResult> {
  const token = getTelegramBotToken();
  const chatIds = resolveTelegramChatIds(options?.chatIdsOverride);

  if (!token || chatIds.length === 0) {
    return {
      ok: false,
      configured: false,
      error: 'Telegram Bot not configured (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID required).',
    };
  }

  const doFetch = options?.fetchImpl || fetch;
  try {
    const meRes = await doFetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: 'GET',
      cache: 'no-store',
    });
    const meJson = (await meRes.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { username?: string };
      description?: string;
    };
    if (!meRes.ok || !meJson.ok) {
      return {
        ok: false,
        configured: true,
        error: `Telegram getMe failed (HTTP ${meRes.status}): ${sanitizeNotificationError(meJson.description || 'Unauthorized')}`,
      };
    }

    let sentToChats = 0;
    if (options?.sendPingMessage !== false) {
      const sendRes = await sendTelegramEventNotification(
        {
          type: 'SYSTEM_ERROR',
          title: 'Deshi Gee Telegram Connection Test',
          summary: 'Admin notification bot connection verified successfully.',
          adminPath: '/admin',
        },
        { chatIdsOverride: options?.chatIdsOverride, fetchImpl: doFetch }
      );
      if (!sendRes.ok) {
        return {
          ok: false,
          configured: true,
          botUsername: meJson.result?.username,
          error: sendRes.error,
        };
      }
      sentToChats = sendRes.messageIds.length;
    }

    return {
      ok: true,
      configured: true,
      botUsername: meJson.result?.username,
      sentToChats,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: sanitizeNotificationError(err instanceof Error ? err.message : 'Telegram connection test failed'),
    };
  }
}
