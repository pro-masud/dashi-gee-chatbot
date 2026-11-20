import { NextResponse } from 'next/server';
import { verifyServerAdminToken } from '../../../../src/lib/chatbot/firestoreRest';
import { AdminSdkUnavailableError } from '../../../../src/lib/firebaseAdmin';
import {
  buildAndPublishDailySummaryEvent,
  processNotificationQueue,
  publishBusinessEvent,
  retryNotificationJob,
} from '../../../../src/lib/notifications/engine';
import {
  getNotificationQueueStats,
  listNotificationJobs,
  listNotificationLogs,
} from '../../../../src/lib/notifications/store';
import {
  isValidBusinessEventType,
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
} from '../../../../src/lib/notifications/types';

export const dynamic = 'force-dynamic';

async function authorizeAdmin(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.trim().startsWith('Bearer ')) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, code: 'unauthorized', error: 'Admin Bearer token required.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      ),
    };
  }
  const admin = await verifyServerAdminToken(authHeader);
  if (!admin.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, code: 'forbidden', error: 'Admin authorization required.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      ),
    };
  }
  return { ok: true as const, admin };
}

export async function GET(request: Request) {
  const auth = await authorizeAdmin(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const rawChannel = String(searchParams.get('channel') || '').trim().toLowerCase();
  const channel = (NOTIFICATION_CHANNELS as readonly string[]).includes(rawChannel)
    ? (rawChannel as NotificationChannel)
    : undefined;
  const rawStatus = String(searchParams.get('status') || '').trim().toLowerCase() || undefined;
  const rawEventType = String(searchParams.get('eventType') || '').trim().toUpperCase();
  const eventType = isValidBusinessEventType(rawEventType) ? rawEventType : undefined;
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 25)));
  const offset = Math.max(0, Number(searchParams.get('offset') || 0));

  try {
    const [logsRes, jobsRes, stats] = await Promise.all([
      listNotificationLogs({ channel, status: rawStatus, eventType, limit, offset }),
      listNotificationJobs({ channel, status: rawStatus, eventType, limit, offset }),
      getNotificationQueueStats(),
    ]);

    return NextResponse.json(
      {
        ok: true,
        logs: logsRes.logs,
        totalLogs: logsRes.total,
        jobs: jobsRes.jobs,
        totalJobs: jobsRes.total,
        stats,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof AdminSdkUnavailableError) {
      return NextResponse.json(
        {
          ok: false,
          code: 'admin_sdk_unavailable',
          error: 'Firestore Admin SDK (ADC/IAM) is unavailable; notification history cannot be read.',
          logs: [],
          totalLogs: 0,
          jobs: [],
          totalJobs: 0,
          stats: {
            queued: 0,
            processing: 0,
            sent: 0,
            failedRetrying: 0,
            deadLetter: 0,
            skippedDisabled: 0,
            totalJobs: 0,
            totalLogs: 0,
          },
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Failed to load notification history.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, code: 'invalid_json', error: 'Malformed JSON body.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const action = String(body.action || '').trim().toLowerCase();

  try {
    if (action === 'retry') {
      const jobId = String(body.jobId || '').trim();
      if (!jobId) {
        return NextResponse.json(
          { ok: false, code: 'missing_job_id', error: 'jobId is required for retry.' },
          { status: 400, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      const res = await retryNotificationJob(jobId);
      if (!res.outcome && res.error === 'Notification job not found.') {
        return NextResponse.json(
          { ok: false, code: 'not_found', error: res.error },
          { status: 404, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return NextResponse.json(
        { ok: res.ok, outcome: res.outcome, error: res.error },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (action === 'process_queue') {
      const limit = Math.min(50, Math.max(1, Number(body.limit || 20)));
      const outcomes = await processNotificationQueue({ limit });
      const stats = await getNotificationQueueStats();
      return NextResponse.json(
        { ok: true, processed: outcomes.length, outcomes, stats },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (action === 'daily_summary') {
      const stats = await getNotificationQueueStats();
      const result = await buildAndPublishDailySummaryEvent(
        {
          totalOrders: Number(body.totalOrders || 0),
          pendingOrders: Number(body.pendingOrders || 0),
          revenueBdt: Number(body.revenueBdt || 0),
          openTickets: Number(body.openTickets || 0),
          deadLetterNotifications: stats.deadLetter,
          force: true,
        },
        { awaitDispatch: true }
      );
      return NextResponse.json(
        { ok: result.ok, result },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (action === 'publish_test_event') {
      const result = await publishBusinessEvent(
        {
          type: 'SYSTEM_ERROR',
          idempotencyKey: `admin_test_${Date.now()}`,
          title: 'Admin Test Notification',
          summary: `Triggered manually by ${auth.admin.email} from Integrations & Alerts Hub.`,
          priority: 'normal',
          adminPath: '/admin',
        },
        { awaitDispatch: true }
      );
      return NextResponse.json(
        { ok: result.ok, result },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: 'unsupported_action',
        error: 'Supported actions: retry, process_queue, daily_summary, publish_test_event.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof AdminSdkUnavailableError) {
      return NextResponse.json(
        {
          ok: false,
          code: 'admin_sdk_unavailable',
          error: 'Firestore Admin SDK (ADC/IAM) is unavailable.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Failed to process notification action.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
