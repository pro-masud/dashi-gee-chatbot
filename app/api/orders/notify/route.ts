import { NextResponse } from 'next/server';
import {
  NotificationAttemptLog,
  dispatchWebhookWithRetry,
  notificationLogs,
} from '../../../../src/lib/serverState';
import {
  getMessagingGatewayReadiness,
  sendDirectEmail,
  sendDirectSms,
} from '../../../../src/lib/integrations/messagingGateway';

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json(
      { error: 'Invalid request origin header.' },
      { status: 403 }
    );
  }

  const payload = await request.json().catch(() => ({}));
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
  const canDirectSms = directReadiness.anyDirectSms && /^01[3-9]\d{8}$/.test(phone.replace(/\D/g, ''));
  const canDirectEmail = directReadiness.anyDirectEmail && ownerEmail.includes('@');

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
    return NextResponse.json({
      ok: true,
      webhookStatus: 'logged_no_webhook_url',
    });
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
        ].join('\n'),
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
  return NextResponse.json({
    ok: true,
    webhookStatus: anySent ? 'delivered' : 'failed_logged_retry_exhausted',
    channelsAttempted: results.map((r) => ({ channel: r.channel, status: r.status })),
  });
}
