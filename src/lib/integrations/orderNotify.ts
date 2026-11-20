import {
  NotificationAttemptLog,
  dispatchWebhookWithRetry,
  notificationLogs,
} from '../serverState';
import {
  getMessagingGatewayReadiness,
  sendDirectEmail,
  sendDirectSms,
} from './messagingGateway';
import { publishBusinessEventSafe } from '../notifications/engine';
import { fetchNotificationRules } from '../notifications/store';

export interface ServerOrderNotifyPayload {
  orderNumber: string;
  customerName: string;
  phone: string;
  totalBdt: number;
  itemsSummary: string;
  paymentMethod?: string;
  district?: string;
  area?: string;
  address?: string;
  [key: string]: unknown;
}

export interface ServerOrderNotifyResult {
  ok: true;
  webhookStatus: 'logged_no_webhook_url' | 'delivered' | 'failed_logged_retry_exhausted';
  channelsAttempted: Array<{ channel: string; status: NotificationAttemptLog['status'] }>;
}

/**
 * S0-05: Shared server-internal order notification dispatcher.
 * Used directly by server-side order creation routes (/api/orders/storefront, /api/order)
 * and by the admin/internal-secret protected /api/orders/notify route.
 */
export async function dispatchOrderNotificationsServerSide(
  payload: ServerOrderNotifyPayload
): Promise<ServerOrderNotifyResult> {
  const orderNumber = String(payload.orderNumber || '').trim();
  const customerName = String(payload.customerName || 'Customer').trim();
  const phone = String(payload.phone || '').trim();
  const totalBdt = Number(payload.totalBdt || 0);
  const itemsSummary = String(payload.itemsSummary || 'Deshi Gee Pure Cow Ghee').trim();

  const webhookTargets = [
    { channel: 'owner_webhook', url: process.env.OWNER_WEBHOOK_URL },
    { channel: 'google_sheets', url: process.env.GOOGLE_SHEETS_WEBHOOK_URL },
    { channel: 'whatsapp_api', url: process.env.WHATSAPP_WEBHOOK_URL },
    { channel: 'email_api', url: process.env.EMAIL_WEBHOOK_URL },
  ];

  const activeTargets = webhookTargets.filter((t) => Boolean(t.url));
  const directReadiness = getMessagingGatewayReadiness();
  const ownerEmail = (process.env.OWNER_NOTIFICATION_EMAIL || '').trim();
  const canDirectSms =
    directReadiness.anyDirectSms && /^01[3-9]\d{8}$/.test(phone.replace(/\D/g, ''));
  const canDirectEmail = directReadiness.anyDirectEmail && ownerEmail.includes('@');

  // Non-blocking publish to Central Notification Engine (Telegram, Discord, WhatsApp)
  void publishBusinessEventSafe({
    type: 'ORDER_CREATED',
    idempotencyKey: `order_created_${orderNumber}`,
    title: `New Order ${orderNumber}`,
    summary: `${customerName} placed an order (${itemsSummary}) for ৳${Math.round(totalBdt)}.`,
    orderNumber,
    customerName,
    customerPhone: phone,
    itemsSummary,
    totalBdt,
    paymentMethod: typeof payload.paymentMethod === 'string' ? payload.paymentMethod : 'cod',
    orderStatus: 'pending',
    district: typeof payload.district === 'string' ? payload.district : undefined,
    area: typeof payload.area === 'string' ? payload.area : undefined,
    whatsappOptIn: payload.whatsappOptIn === true,
    adminPath: '/admin',
  });

  if (typeof payload.remainingStock === 'number' && Number.isFinite(payload.remainingStock)) {
    const remaining = Math.max(0, Math.round(payload.remainingStock));
    const variantWeight =
      typeof payload.variantWeight === 'string' && payload.variantWeight.trim()
        ? payload.variantWeight.trim()
        : itemsSummary;
    void fetchNotificationRules()
      .then((rules) => {
        if (remaining <= rules.lowStockThreshold) {
          return publishBusinessEventSafe({
            type: 'LOW_STOCK',
            idempotencyKey: `low_stock_${variantWeight.replace(/[^a-zA-Z0-9]/g, '_')}_${remaining}`,
            title: `Low Stock Alert — ${variantWeight}`,
            summary: `${variantWeight} has only ${remaining} jar(s) remaining (threshold: ${rules.lowStockThreshold}).`,
            variantWeight,
            remainingStock: remaining,
            priority: remaining === 0 ? 'urgent' : 'high',
            adminPath: '/admin',
          });
        }
        return null;
      })
      .catch(() => {});
  }

  if (activeTargets.length === 0 && !canDirectSms && !canDirectEmail) {
    const logEntry: NotificationAttemptLog = {
      orderNumber,
      channel: 'webhook_dispatcher',
      status: 'skipped_unconfigured',
      detail:
        'No server webhooks or direct SMS/Email credentials configured; order preserved in Firestore.',
      timestamp: new Date().toISOString(),
    };
    notificationLogs.unshift(logEntry);
    if (notificationLogs.length > 50) notificationLogs.pop();
    return {
      ok: true,
      webhookStatus: 'logged_no_webhook_url',
      channelsAttempted: [],
    };
  }

  const tasks: Promise<NotificationAttemptLog>[] = activeTargets.map((target) =>
    dispatchWebhookWithRetry(target.url as string, target.channel, payload)
  );

  if (canDirectSms) {
    const smsBody = `Deshi Gee: Dhonnobad ${customerName}! Apnar order ${orderNumber} (${itemsSummary}, Total ৳${totalBdt}) receive kora hoyeche. Track: ${(process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '')}/track?order=${encodeURIComponent(orderNumber)}`;
    tasks.push(sendDirectSms({ toPhone: phone, message: smsBody, orderNumber }));
  }

  if (canDirectEmail) {
    tasks.push(
      sendDirectEmail({
        toEmail: ownerEmail,
        subject: `New Deshi Gee Order ${orderNumber} — ৳${totalBdt}`,
        text: [
          `Order Number: ${orderNumber}`,
          `Customer: ${customerName}`,
          `Phone: ${phone}`,
          `Items: ${itemsSummary}`,
          `Total: ৳${totalBdt}`,
          `Payment: ${String(payload.paymentMethod || 'cod').toUpperCase()}`,
          payload.district ? `Location: ${payload.area || ''}, ${payload.district}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        orderNumber,
      })
    );
  }

  const results = await Promise.all(tasks);
  for (const r of results) {
    notificationLogs.unshift(r);
    if (notificationLogs.length > 50) notificationLogs.pop();
  }

  const anySent = results.some((r) => r.status === 'sent');
  return {
    ok: true,
    webhookStatus: anySent ? 'delivered' : 'failed_logged_retry_exhausted',
    channelsAttempted: results.map((r) => ({ channel: r.channel, status: r.status })),
  };
}
