import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { verifyServerAdminToken } from '../../../../src/lib/chatbot/firestoreRest';
import { AdminSdkUnavailableError } from '../../../../src/lib/firebaseAdmin';
import {
  buildAndPublishDailySummaryEvent,
  processNotificationQueue,
} from '../../../../src/lib/notifications/engine';
import { getNotificationQueueStats } from '../../../../src/lib/notifications/store';
import { getDiscordReadiness } from '../../../../src/lib/integrations/discordWebhook';
import { getTelegramReadiness } from '../../../../src/lib/integrations/telegramBot';
import { getWhatsAppCloudReadiness } from '../../../../src/lib/integrations/whatsappCloud';

export const dynamic = 'force-dynamic';

function timingSafeSecretEqual(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function authorizeWorkerOrAdmin(request: Request): Promise<{ ok: boolean; actor: string }> {
  const configuredSecrets = [
    String(process.env.NOTIFICATION_WORKER_SECRET || '').trim(),
    String(process.env.CRON_SECRET || '').trim(),
  ].filter((s) => s.length >= 16);

  const headerSecret = String(request.headers.get('x-worker-secret') || '').trim();
  const authHeader = String(request.headers.get('authorization') || '').trim();
  const bearerValue = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  for (const secret of configuredSecrets) {
    if (
      (headerSecret && timingSafeSecretEqual(headerSecret, secret)) ||
      (bearerValue && timingSafeSecretEqual(bearerValue, secret))
    ) {
      return { ok: true, actor: 'scheduled_worker' };
    }
  }

  if (authHeader.startsWith('Bearer ')) {
    const admin = await verifyServerAdminToken(authHeader);
    if (admin.ok) {
      return { ok: true, actor: admin.email };
    }
  }

  return { ok: false, actor: '' };
}

export async function GET(request: Request) {
  const auth = await authorizeWorkerOrAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: 'unauthorized', error: 'Worker secret or Admin Bearer token required.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const stats = await getNotificationQueueStats();
    return NextResponse.json(
      {
        ok: true,
        actor: auth.actor,
        stats,
        readiness: {
          telegram: getTelegramReadiness(),
          discord: getDiscordReadiness(),
          whatsapp: getWhatsAppCloudReadiness(),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof AdminSdkUnavailableError) {
      return NextResponse.json(
        { ok: false, code: 'admin_sdk_unavailable', error: 'Firestore Admin SDK unavailable.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Failed to inspect notification queue health.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function POST(request: Request) {
  const auth = await authorizeWorkerOrAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: 'unauthorized', error: 'Worker secret or Admin Bearer token required.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || 'process_queue').trim().toLowerCase();

  try {
    if (action === 'daily_summary') {
      const stats = await getNotificationQueueStats();
      const result = await buildAndPublishDailySummaryEvent(
        {
          totalOrders: Number(body.totalOrders || 0),
          pendingOrders: Number(body.pendingOrders || 0),
          revenueBdt: Number(body.revenueBdt || 0),
          openTickets: Number(body.openTickets || 0),
          deadLetterNotifications: stats.deadLetter,
          force: body.force === true,
        },
        { awaitDispatch: true }
      );
      return NextResponse.json(
        { ok: result.ok, actor: auth.actor, action, result },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const limit = Math.min(50, Math.max(1, Number(body.limit || 25)));
    const outcomes = await processNotificationQueue({ limit });
    const stats = await getNotificationQueueStats();

    return NextResponse.json(
      {
        ok: true,
        actor: auth.actor,
        action: 'process_queue',
        processed: outcomes.length,
        outcomes,
        stats,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof AdminSdkUnavailableError) {
      return NextResponse.json(
        { ok: false, code: 'admin_sdk_unavailable', error: 'Firestore Admin SDK unavailable.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Notification worker execution failed.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
