import { NextResponse } from 'next/server';
import {
  NotificationAttemptLog,
  dispatchWebhookWithRetry,
  notificationLogs,
} from '../../../../src/lib/serverState';

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json(
      { error: 'Invalid request origin header.' },
      { status: 403 }
    );
  }

  const payload = await request.json().catch(() => ({}));
  const webhookTargets = [
    { channel: 'owner_webhook', url: process.env.OWNER_WEBHOOK_URL },
    { channel: 'google_sheets', url: process.env.GOOGLE_SHEETS_WEBHOOK_URL },
    { channel: 'whatsapp_api', url: process.env.WHATSAPP_WEBHOOK_URL },
    { channel: 'email_api', url: process.env.EMAIL_WEBHOOK_URL },
  ];

  const activeTargets = webhookTargets.filter((t) => Boolean(t.url));
  if (activeTargets.length === 0) {
    const logEntry: NotificationAttemptLog = {
      orderNumber: String(payload.orderNumber || ''),
      channel: 'webhook_dispatcher',
      status: 'skipped_unconfigured',
      detail:
        'No server webhook URLs set in environment; order preserved in Firestore.',
      timestamp: new Date().toISOString(),
    };
    notificationLogs.unshift(logEntry);
    if (notificationLogs.length > 50) notificationLogs.pop();
    return NextResponse.json({
      ok: true,
      webhookStatus: 'logged_no_webhook_url',
    });
  }

  const results = await Promise.all(
    activeTargets.map((target) =>
      dispatchWebhookWithRetry(target.url as string, target.channel, payload)
    )
  );
  for (const r of results) {
    notificationLogs.unshift(r);
    if (notificationLogs.length > 50) notificationLogs.pop();
  }

  const anySent = results.some((r) => r.status === 'sent');
  return NextResponse.json({
    ok: true,
    webhookStatus: anySent ? 'delivered' : 'failed_logged_retry_exhausted',
  });
}
