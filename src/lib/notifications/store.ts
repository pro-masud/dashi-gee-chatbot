import {
  AdminSdkUnavailableError,
  getAdminDb,
  getAdminSdkTestAvailabilityOverride,
  isAdminSdkCredentialOrIamError,
} from '../firebaseAdmin';
import {
  assertNoTestModeInProduction,
  isTestProcessRuntime,
  LiveFirestoreWriteBlockedInTestError,
} from '../server/runtimeGuards';
import {
  DEFAULT_INTEGRATION_SETTINGS,
  DEFAULT_NOTIFICATION_RULES,
  mergeIntegrationSettings,
  mergeNotificationRules,
  sanitizeNotificationError,
  type BusinessEventType,
  type IntegrationSettingsDoc,
  type NotificationChannel,
  type NotificationEventDoc,
  type NotificationJobDoc,
  type NotificationJobStatus,
  type NotificationLogDoc,
  type NotificationRulesDoc,
} from './types';

const COL_INTEGRATION_SETTINGS = 'integration_settings';
const COL_NOTIFICATION_RULES = 'notification_rules';
const COL_NOTIFICATION_EVENTS = 'notification_events';
const COL_NOTIFICATION_JOBS = 'notification_jobs';
const COL_NOTIFICATION_LOGS = 'notification_logs';

interface NotificationMemoryStore {
  settings: IntegrationSettingsDoc;
  rules: NotificationRulesDoc;
  events: Map<string, NotificationEventDoc>;
  eventsByIdempotencyKey: Map<string, string>;
  jobs: Map<string, NotificationJobDoc>;
  jobsByIdempotencyKey: Map<string, string>;
  logs: NotificationLogDoc[];
}

const g = globalThis as unknown as {
  __deshiGeeNotificationMemoryMode?: boolean;
  __deshiGeeNotificationMemoryStore?: NotificationMemoryStore;
};

function createFreshMemoryStore(): NotificationMemoryStore {
  return {
    settings: mergeIntegrationSettings(DEFAULT_INTEGRATION_SETTINGS),
    rules: mergeNotificationRules(DEFAULT_NOTIFICATION_RULES),
    events: new Map(),
    eventsByIdempotencyKey: new Map(),
    jobs: new Map(),
    jobsByIdempotencyKey: new Map(),
    logs: [],
  };
}

function getMemoryStore(): NotificationMemoryStore {
  if (!g.__deshiGeeNotificationMemoryStore) {
    g.__deshiGeeNotificationMemoryStore = createFreshMemoryStore();
  }
  return g.__deshiGeeNotificationMemoryStore;
}

export function isNotificationStoreMemoryModeActive(): boolean {
  assertNoTestModeInProduction();
  return isTestProcessRuntime() && Boolean(g.__deshiGeeNotificationMemoryMode);
}

export function setNotificationStoreMemoryModeForTests(enabled: boolean): void {
  assertNoTestModeInProduction();
  if (!isTestProcessRuntime()) return;
  g.__deshiGeeNotificationMemoryMode = enabled;
  if (enabled) {
    g.__deshiGeeNotificationMemoryStore = createFreshMemoryStore();
  }
}

export function getNotificationMemoryStateForTests(): NotificationMemoryStore {
  assertNoTestModeInProduction();
  return getMemoryStore();
}

function ensureAdminAvailable(): void {
  if (getAdminSdkTestAvailabilityOverride() === false) {
    throw new AdminSdkUnavailableError('Admin SDK unavailable (fail-closed test override).');
  }
}

function ensureWriteAllowed(operation: string): void {
  if (isNotificationStoreMemoryModeActive()) return;
  if (isTestProcessRuntime() && !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new LiveFirestoreWriteBlockedInTestError(
      `[SECURITY_GUARD] Blocked live Firestore write in test mode (${operation}) — enable notification memory store or FIRESTORE_EMULATOR_HOST.`
    );
  }
  ensureAdminAvailable();
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function wrapAdminError(err: unknown): never {
  if (
    err instanceof AdminSdkUnavailableError ||
    err instanceof LiveFirestoreWriteBlockedInTestError
  ) {
    throw err;
  }
  if (isAdminSdkCredentialOrIamError(err)) {
    throw new AdminSdkUnavailableError(
      sanitizeNotificationError(err instanceof Error ? err.message : 'Admin SDK unavailable')
    );
  }
  throw err;
}

export async function fetchIntegrationSettings(): Promise<IntegrationSettingsDoc> {
  if (isNotificationStoreMemoryModeActive()) {
    return mergeIntegrationSettings(getMemoryStore().settings);
  }
  if (isTestProcessRuntime() && !process.env.FIRESTORE_EMULATOR_HOST) {
    return mergeIntegrationSettings(DEFAULT_INTEGRATION_SETTINGS);
  }
  ensureAdminAvailable();
  try {
    const snap = await getAdminDb().collection(COL_INTEGRATION_SETTINGS).doc('main').get();
    if (!snap.exists) {
      return mergeIntegrationSettings(DEFAULT_INTEGRATION_SETTINGS);
    }
    return mergeIntegrationSettings(snap.data() as Partial<IntegrationSettingsDoc>);
  } catch (err) {
    wrapAdminError(err);
  }
}

export async function saveIntegrationSettings(
  patch: Partial<IntegrationSettingsDoc>,
  updatedBy?: string
): Promise<IntegrationSettingsDoc> {
  ensureWriteAllowed('saveIntegrationSettings');
  const current = await fetchIntegrationSettings();
  const next = mergeIntegrationSettings({
    ...current,
    ...patch,
    telegram: { ...current.telegram, ...(patch.telegram || {}) },
    discord: {
      ...current.discord,
      ...(patch.discord || {}),
      enabledChannels: {
        ...current.discord.enabledChannels,
        ...(patch.discord?.enabledChannels || {}),
      },
    },
    whatsapp: { ...current.whatsapp, ...(patch.whatsapp || {}) },
    aiSupport: { ...current.aiSupport, ...(patch.aiSupport || {}) },
    updatedAtIso: new Date().toISOString(),
    updatedBy: updatedBy || current.updatedBy,
  });

  if (isNotificationStoreMemoryModeActive()) {
    getMemoryStore().settings = next;
    return next;
  }

  try {
    await getAdminDb()
      .collection(COL_INTEGRATION_SETTINGS)
      .doc('main')
      .set(stripUndefined(next as unknown as Record<string, unknown>), { merge: true });
    return next;
  } catch (err) {
    wrapAdminError(err);
  }
}

export async function updateChannelConnectionStatus(
  channel: 'telegram' | 'discord' | 'whatsapp' | 'aiSupport',
  update: {
    lastConnectedAtIso?: string;
    lastError?: string;
    lastTestedAtIso?: string;
  }
): Promise<void> {
  ensureWriteAllowed(`updateChannelConnectionStatus:${channel}`);
  const current = await fetchIntegrationSettings();
  const prevMeta = current[channel];
  const nextMeta = {
    ...prevMeta,
    ...(update.lastConnectedAtIso !== undefined
      ? { lastConnectedAtIso: update.lastConnectedAtIso }
      : {}),
    ...(update.lastTestedAtIso !== undefined ? { lastTestedAtIso: update.lastTestedAtIso } : {}),
    lastError:
      update.lastError !== undefined ? sanitizeNotificationError(update.lastError) : '',
  };

  await saveIntegrationSettings({
    [channel]: nextMeta,
  } as Partial<IntegrationSettingsDoc>);
}

export async function fetchNotificationRules(): Promise<NotificationRulesDoc> {
  if (isNotificationStoreMemoryModeActive()) {
    return mergeNotificationRules(getMemoryStore().rules);
  }
  if (isTestProcessRuntime() && !process.env.FIRESTORE_EMULATOR_HOST) {
    return mergeNotificationRules(DEFAULT_NOTIFICATION_RULES);
  }
  ensureAdminAvailable();
  try {
    const snap = await getAdminDb().collection(COL_NOTIFICATION_RULES).doc('main').get();
    if (!snap.exists) {
      return mergeNotificationRules(DEFAULT_NOTIFICATION_RULES);
    }
    return mergeNotificationRules(snap.data() as Partial<NotificationRulesDoc>);
  } catch (err) {
    wrapAdminError(err);
  }
}

export async function saveNotificationRules(
  patch: Partial<NotificationRulesDoc>,
  updatedBy?: string
): Promise<NotificationRulesDoc> {
  ensureWriteAllowed('saveNotificationRules');
  const current = await fetchNotificationRules();
  const next = mergeNotificationRules({
    ...current,
    ...patch,
    events: {
      ...current.events,
      ...(patch.events || {}),
    },
    updatedAtIso: new Date().toISOString(),
    updatedBy: updatedBy || current.updatedBy,
  });

  if (isNotificationStoreMemoryModeActive()) {
    getMemoryStore().rules = next;
    return next;
  }

  try {
    await getAdminDb()
      .collection(COL_NOTIFICATION_RULES)
      .doc('main')
      .set(stripUndefined(next as unknown as Record<string, unknown>), { merge: true });
    return next;
  } catch (err) {
    wrapAdminError(err);
  }
}

export async function createEventIfNotDuplicate(
  eventDoc: NotificationEventDoc
): Promise<{ created: boolean; event: NotificationEventDoc }> {
  ensureWriteAllowed('createEventIfNotDuplicate');

  if (isNotificationStoreMemoryModeActive()) {
    const store = getMemoryStore();
    const existingId = store.eventsByIdempotencyKey.get(eventDoc.idempotencyKey);
    if (existingId) {
      const existing = store.events.get(existingId);
      if (existing) {
        return { created: false, event: existing };
      }
    }
    store.events.set(eventDoc.eventId, eventDoc);
    store.eventsByIdempotencyKey.set(eventDoc.idempotencyKey, eventDoc.eventId);
    return { created: true, event: eventDoc };
  }

  try {
    const db = getAdminDb();
    const docRef = db.collection(COL_NOTIFICATION_EVENTS).doc(eventDoc.idempotencyKey);
    const created = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (snap.exists) {
        return false;
      }
      tx.set(docRef, stripUndefined(eventDoc as unknown as Record<string, unknown>));
      return true;
    });
    if (!created) {
      const existingSnap = await docRef.get();
      return {
        created: false,
        event: (existingSnap.data() as NotificationEventDoc) || eventDoc,
      };
    }
    return { created: true, event: eventDoc };
  } catch (err) {
    wrapAdminError(err);
  }
}

export async function enqueueNotificationJob(
  job: NotificationJobDoc
): Promise<{ created: boolean; job: NotificationJobDoc }> {
  ensureWriteAllowed('enqueueNotificationJob');

  if (isNotificationStoreMemoryModeActive()) {
    const store = getMemoryStore();
    const existingId = store.jobsByIdempotencyKey.get(job.idempotencyKey);
    if (existingId) {
      const existing = store.jobs.get(existingId);
      if (existing) return { created: false, job: existing };
    }
    store.jobs.set(job.jobId, job);
    store.jobsByIdempotencyKey.set(job.idempotencyKey, job.jobId);
    return { created: true, job };
  }

  try {
    const db = getAdminDb();
    const docRef = db.collection(COL_NOTIFICATION_JOBS).doc(job.jobId);
    const created = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (snap.exists) return false;
      tx.set(docRef, stripUndefined(job as unknown as Record<string, unknown>));
      return true;
    });
    if (!created) {
      const existing = await docRef.get();
      return { created: false, job: (existing.data() as NotificationJobDoc) || job };
    }
    return { created: true, job };
  } catch (err) {
    wrapAdminError(err);
  }
}

export async function getNotificationJob(jobId: string): Promise<NotificationJobDoc | null> {
  if (isNotificationStoreMemoryModeActive()) {
    return getMemoryStore().jobs.get(jobId) || null;
  }
  ensureAdminAvailable();
  try {
    const snap = await getAdminDb().collection(COL_NOTIFICATION_JOBS).doc(jobId).get();
    if (!snap.exists) return null;
    return snap.data() as NotificationJobDoc;
  } catch (err) {
    wrapAdminError(err);
  }
}

export async function updateNotificationJob(
  jobId: string,
  patch: Partial<NotificationJobDoc>
): Promise<NotificationJobDoc | null> {
  ensureWriteAllowed('updateNotificationJob');
  const nowMs = Date.now();
  const enriched: Partial<NotificationJobDoc> = {
    ...patch,
    updatedAtMs: patch.updatedAtMs ?? nowMs,
    updatedAtIso: patch.updatedAtIso ?? new Date(nowMs).toISOString(),
  };

  if (isNotificationStoreMemoryModeActive()) {
    const store = getMemoryStore();
    const existing = store.jobs.get(jobId);
    if (!existing) return null;
    const updated = { ...existing, ...enriched };
    store.jobs.set(jobId, updated);
    return updated;
  }

  try {
    const docRef = getAdminDb().collection(COL_NOTIFICATION_JOBS).doc(jobId);
    await docRef.set(stripUndefined(enriched as unknown as Record<string, unknown>), { merge: true });
    const snap = await docRef.get();
    return snap.exists ? (snap.data() as NotificationJobDoc) : null;
  } catch (err) {
    wrapAdminError(err);
  }
}

export async function listDueNotificationJobs(
  nowMs: number,
  limit = 25
): Promise<NotificationJobDoc[]> {
  if (isNotificationStoreMemoryModeActive()) {
    return Array.from(getMemoryStore().jobs.values())
      .filter(
        (j) =>
          (j.status === 'queued' || j.status === 'failed_retrying') && j.nextRetryAtMs <= nowMs
      )
      .sort((a, b) => a.nextRetryAtMs - b.nextRetryAtMs)
      .slice(0, limit);
  }
  ensureAdminAvailable();
  try {
    const snap = await getAdminDb()
      .collection(COL_NOTIFICATION_JOBS)
      .orderBy('createdAtMs', 'desc')
      .limit(Math.max(limit * 4, 100))
      .get();
    return snap.docs
      .map((d) => d.data() as NotificationJobDoc)
      .filter(
        (j) =>
          (j.status === 'queued' || j.status === 'failed_retrying') && j.nextRetryAtMs <= nowMs
      )
      .sort((a, b) => a.nextRetryAtMs - b.nextRetryAtMs)
      .slice(0, limit);
  } catch (err) {
    wrapAdminError(err);
  }
}

export interface NotificationListFilter {
  channel?: NotificationChannel;
  status?: string;
  eventType?: BusinessEventType;
  limit?: number;
  offset?: number;
}

export async function listNotificationJobs(filter?: NotificationListFilter): Promise<{
  jobs: NotificationJobDoc[];
  total: number;
}> {
  const limit = Math.min(100, Math.max(1, filter?.limit || 30));
  const offset = Math.max(0, filter?.offset || 0);

  let all: NotificationJobDoc[] = [];
  if (isNotificationStoreMemoryModeActive()) {
    all = Array.from(getMemoryStore().jobs.values()).sort(
      (a, b) => b.createdAtMs - a.createdAtMs
    );
  } else if (isTestProcessRuntime() && !process.env.FIRESTORE_EMULATOR_HOST) {
    all = [];
  } else {
    ensureAdminAvailable();
    try {
      const snap = await getAdminDb()
        .collection(COL_NOTIFICATION_JOBS)
        .orderBy('createdAtMs', 'desc')
        .limit(250)
        .get();
      all = snap.docs.map((d) => d.data() as NotificationJobDoc);
    } catch (err) {
      wrapAdminError(err);
    }
  }

  const filtered = all.filter((j) => {
    if (filter?.channel && j.channel !== filter.channel) return false;
    if (filter?.status && j.status !== filter.status) return false;
    if (filter?.eventType && j.eventType !== filter.eventType) return false;
    return true;
  });

  return {
    jobs: filtered.slice(offset, offset + limit),
    total: filtered.length,
  };
}

export async function appendNotificationLog(log: NotificationLogDoc): Promise<void> {
  ensureWriteAllowed('appendNotificationLog');
  const sanitizedLog: NotificationLogDoc = {
    ...log,
    errorDetail: log.errorDetail ? sanitizeNotificationError(log.errorDetail) : undefined,
  };

  if (isNotificationStoreMemoryModeActive()) {
    const store = getMemoryStore();
    store.logs.unshift(sanitizedLog);
    if (store.logs.length > 500) store.logs.pop();
    return;
  }

  try {
    await getAdminDb()
      .collection(COL_NOTIFICATION_LOGS)
      .doc(sanitizedLog.logId)
      .set(stripUndefined(sanitizedLog as unknown as Record<string, unknown>));
  } catch (err) {
    wrapAdminError(err);
  }
}

export async function listNotificationLogs(filter?: NotificationListFilter): Promise<{
  logs: NotificationLogDoc[];
  total: number;
}> {
  const limit = Math.min(100, Math.max(1, filter?.limit || 30));
  const offset = Math.max(0, filter?.offset || 0);

  let all: NotificationLogDoc[] = [];
  if (isNotificationStoreMemoryModeActive()) {
    all = [...getMemoryStore().logs].sort((a, b) => b.createdAtMs - a.createdAtMs);
  } else if (isTestProcessRuntime() && !process.env.FIRESTORE_EMULATOR_HOST) {
    all = [];
  } else {
    ensureAdminAvailable();
    try {
      const snap = await getAdminDb()
        .collection(COL_NOTIFICATION_LOGS)
        .orderBy('createdAtMs', 'desc')
        .limit(300)
        .get();
      all = snap.docs.map((d) => d.data() as NotificationLogDoc);
    } catch (err) {
      wrapAdminError(err);
    }
  }

  const filtered = all.filter((l) => {
    if (filter?.channel && l.channel !== filter.channel) return false;
    if (filter?.status && l.status !== filter.status) return false;
    if (filter?.eventType && l.eventType !== filter.eventType) return false;
    return true;
  });

  return {
    logs: filtered.slice(offset, offset + limit),
    total: filtered.length,
  };
}

export interface NotificationQueueStats {
  queued: number;
  processing: number;
  sent: number;
  failedRetrying: number;
  deadLetter: number;
  skippedDisabled: number;
  totalJobs: number;
  totalLogs: number;
}

export async function getNotificationQueueStats(): Promise<NotificationQueueStats> {
  const { jobs } = await listNotificationJobs({ limit: 250 });
  const { total: totalLogs } = await listNotificationLogs({ limit: 1 });

  const counts: Record<NotificationJobStatus, number> = {
    queued: 0,
    processing: 0,
    sent: 0,
    failed_retrying: 0,
    dead_letter: 0,
    skipped_disabled: 0,
  };

  for (const job of jobs) {
    counts[job.status] = (counts[job.status] || 0) + 1;
  }

  return {
    queued: counts.queued,
    processing: counts.processing,
    sent: counts.sent,
    failedRetrying: counts.failed_retrying,
    deadLetter: counts.dead_letter,
    skippedDisabled: counts.skipped_disabled,
    totalJobs: jobs.length,
    totalLogs,
  };
}
