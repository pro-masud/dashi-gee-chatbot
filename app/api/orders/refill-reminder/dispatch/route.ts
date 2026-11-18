import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import {
  dispatchDueRefillReminders,
  fetchAdminRefillReminders,
  verifyServerAdminToken,
} from '../../../../../src/lib/chatbot/firestoreRest';

export const dynamic = 'force-dynamic';

function isValidCronSecret(request: Request): boolean {
  const expected = String(process.env.CRON_SECRET || '').trim();
  if (expected.length < 16) return false;
  const provided = String(request.headers.get('x-cron-secret') || '').trim();
  if (!provided || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function authorizeDispatchCaller(request: Request): Promise<{
  ok: boolean;
  adminIdToken?: string;
  actor: string;
}> {
  if (isValidCronSecret(request)) {
    return { ok: true, actor: 'cron' };
  }
  const authHeader = request.headers.get('authorization');
  const admin = await verifyServerAdminToken(authHeader);
  if (!admin.ok) {
    return { ok: false, actor: 'unauthorized' };
  }
  return {
    ok: true,
    adminIdToken: authHeader ? authHeader.slice(7).trim() : '',
    actor: admin.email || 'admin',
  };
}

export async function GET(request: Request) {
  const caller = await authorizeDispatchCaller(request);
  if (!caller.ok) {
    return NextResponse.json(
      { ok: false, error: 'Admin authorization or valid CRON_SECRET required.' },
      { status: 403 }
    );
  }

  const nowMs = Date.now();
  const reminders = await fetchAdminRefillReminders(caller.adminIdToken);
  const dueReminders = reminders.filter(
    (r) =>
      r.status === 'active' &&
      r.consentGranted === true &&
      Number.isFinite(Date.parse(r.nextReminderAtIso)) &&
      Date.parse(r.nextReminderAtIso) <= nowMs
  );

  return NextResponse.json(
    {
      ok: true,
      reminders,
      dueCount: dueReminders.length,
      dueIds: dueReminders.map((r) => r.id),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  const isCron = isValidCronSecret(request);
  if (!isCron && request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json(
      { ok: false, error: 'Invalid request origin header.' },
      { status: 403 }
    );
  }

  const caller = await authorizeDispatchCaller(request);
  if (!caller.ok) {
    return NextResponse.json(
      { ok: false, error: 'Admin authorization or valid CRON_SECRET required.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const reminderIds = Array.isArray(body.reminderIds)
    ? body.reminderIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : undefined;

  let now = new Date();
  if (typeof body.nowIso === 'string' && body.nowIso.trim()) {
    const parsed = Date.parse(body.nowIso);
    if (Number.isFinite(parsed)) {
      now = new Date(parsed);
    }
  }

  const result = await dispatchDueRefillReminders({
    now,
    dryRun,
    adminIdToken: caller.adminIdToken,
    reminderIds,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : 207,
    headers: { 'Cache-Control': 'no-store' },
  });
}
