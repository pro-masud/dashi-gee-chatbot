import crypto from 'node:crypto';
import {
  mapEventToDiscordChannel,
  sanitizeNotificationError,
  type BusinessEventPayload,
  type IntegrationSettingsDoc,
  type NotificationChannel,
  type NotificationEventDoc,
  type NotificationJobDoc,
  type NotificationLogDoc,
} from './types';
import {
  appendNotificationLog,
  createEventIfNotDuplicate,
  enqueueNotificationJob,
  fetchIntegrationSettings,
  fetchNotificationRules,
  getNotificationJob,
  isNotificationStoreMemoryModeActive,
  listDueNotificationJobs,
  updateChannelConnectionStatus,
  updateNotificationJob,
} from './store';
import { sendTelegramEventNotification } from '../integrations/telegramBot';
import { sendDiscordEventNotification } from '../integrations/discordWebhook';
import { sendWhatsAppBusinessEventNotification } from '../integrations/whatsappCloud';
import { isTestProcessRuntime } from '../server/runtimeGuards';

export interface PublishEventOptions {
  /** If true, waits for immediate delivery attempt. Default false (non-blocking background kick). */
  awaitDispatch?: boolean;
  /** Set false to enqueue only (for scheduled worker / retry testing). Default true. */
  processImmediately?: boolean;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}

export interface DispatchOutcome {
  jobId: string;
  channel: NotificationChannel;
  status: NotificationJobDoc['status'];
  attemptCount: number;
  externalMessageId?: string;
  error?: string;
}

export interface PublishEventResult {
  ok: boolean;
  eventId: string;
  idempotencyKey: string;
  deduplicated: boolean;
  skipped?: boolean;
  skipReason?: string;
  jobsCreated: NotificationJobDoc[];
  dispatched: DispatchOutcome[];
}

export function computeEventIdempotencyKey(event: BusinessEventPayload): string {
  if (event.idempotencyKey && event.idempotencyKey.trim().length >= 8) {
    return event.idempotencyKey.trim().replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 120);
  }
  const parts = [
    event.type,
    event.eventId || '',
    event.orderNumber || '',
    event.ticketId || '',
    event.orderStatus || '',
    event.paymentStatus || '',
    event.variantWeight || '',
    typeof event.remainingStock === 'number' ? String(event.remainingStock) : '',
    event.summary || '',
  ].join('|');
  const digest = crypto.createHash('sha256').update(parts).digest('hex').slice(0, 32);
  return `evt_${event.type.toLowerCase()}_${digest}`;
}

function buildMessageSummary(event: BusinessEventPayload): string {
  const parts: string[] = [];
  if (event.title) parts.push(event.title);
  else parts.push(event.type.replace(/_/g, ' '));
  if (event.orderNumber) parts.push(`#${event.orderNumber}`);
  if (event.ticketId) parts.push(`Ticket ${event.ticketId}`);
  if (typeof event.totalBdt === 'number' && event.totalBdt > 0) {
    parts.push(`৳${Math.round(event.totalBdt)}`);
  }
  if (event.summary && parts.join(' — ').length < 120) {
    parts.push(event.summary.slice(0, 120));
  }
  return parts.join(' — ').slice(0, 240);
}

function makeLogId(): string {
  return `nlog_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function makeEventId(type: string): string {
  return `nevt_${type.toLowerCase()}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function shouldEnqueueWhatsAppForEvent(
  event: BusinessEventPayload,
  settings: IntegrationSettingsDoc
): boolean {
  if (!settings.whatsapp.enabled) return false;
  if (!event.customerPhone) return false;
  const waCustomerEventTypes = new Set([
    'ORDER_CREATED',
    'ORDER_UPDATED',
    'ORDER_CANCELLED',
    'CUSTOMER_MESSAGE_RECEIVED',
  ]);
  if (!waCustomerEventTypes.has(event.type)) return false;
  if (event.type === 'ORDER_CREATED' && !settings.whatsapp.sendOrderConfirmations) return false;
  if (
    (event.type === 'ORDER_UPDATED' || event.type === 'ORDER_CANCELLED') &&
    !settings.whatsapp.sendStatusUpdates
  ) {
    return false;
  }
  return true;
}

/**
 * Central Notification Engine entry point.
 * - Deduplicates events via deterministic idempotency key.
 * - Evaluates persisted IntegrationSettingsDoc + NotificationRulesDoc.
 * - Enqueues durable per-channel jobs (isolated per channel so Telegram/Discord/WhatsApp cannot block each other).
 */
export async function publishBusinessEvent(
  event: BusinessEventPayload,
  options?: PublishEventOptions
): Promise<PublishEventResult> {
  const nowMs = options?.nowMs ?? Date.now();
  const occurredAtIso = event.occurredAtIso || new Date(nowMs).toISOString();
  const idempotencyKey = computeEventIdempotencyKey(event);
  const eventId = event.eventId || makeEventId(event.type);
  const messageSummary = buildMessageSummary(event);

  const eventDoc: NotificationEventDoc = {
    eventId,
    idempotencyKey,
    type: event.type,
    occurredAtIso,
    title: event.title || event.type.replace(/_/g, ' '),
    summary: event.summary || messageSummary,
    orderNumber: event.orderNumber,
    ticketId: event.ticketId,
    payload: { ...event, eventId, idempotencyKey, occurredAtIso },
    createdAtMs: nowMs,
  };

  const { created, event: storedEvent } = await createEventIfNotDuplicate(eventDoc);
  if (!created) {
    return {
      ok: true,
      eventId: storedEvent.eventId,
      idempotencyKey,
      deduplicated: true,
      jobsCreated: [],
      dispatched: [],
    };
  }

  const [settings, rules] = await Promise.all([
    fetchIntegrationSettings(),
    fetchNotificationRules(),
  ]);

  const rule = rules.events[event.type];
  if (!rule || !rule.enabled) {
    return {
      ok: true,
      eventId,
      idempotencyKey,
      deduplicated: false,
      skipped: true,
      skipReason: 'event_rule_disabled',
      jobsCreated: [],
      dispatched: [],
    };
  }

  const templateOverride = rules.templates?.[event.type];
  const recipientScope = templateOverride?.recipientScope || 'both';
  const allowAdminChannels = recipientScope === 'admin' || recipientScope === 'both';
  const allowCustomerChannels = recipientScope === 'customer' || recipientScope === 'both';

  const targetChannels: NotificationChannel[] = [];
  if (allowAdminChannels && rule.telegram && settings.telegram.enabled) {
    targetChannels.push('telegram');
  }
  const discordChannelKey = mapEventToDiscordChannel(event.type);
  if (
    allowAdminChannels &&
    rule.discord &&
    settings.discord.enabled &&
    settings.discord.enabledChannels[discordChannelKey] !== false
  ) {
    targetChannels.push('discord');
  }
  if (allowCustomerChannels && rule.whatsapp && shouldEnqueueWhatsAppForEvent(event, settings)) {
    targetChannels.push('whatsapp');
  }

  const jobsCreated: NotificationJobDoc[] = [];
  for (const channel of targetChannels) {
    const jobId = `njob_${channel}_${crypto
      .createHash('sha256')
      .update(`${idempotencyKey}:${channel}`)
      .digest('hex')
      .slice(0, 20)}`;

    const jobDoc: NotificationJobDoc = {
      jobId,
      eventId,
      eventType: event.type,
      channel,
      discordChannelKey: channel === 'discord' ? discordChannelKey : undefined,
      idempotencyKey: `${idempotencyKey}:${channel}`,
      status: 'queued',
      attemptCount: 0,
      maxAttempts: rules.maxRetries,
      nextRetryAtMs: nowMs,
      nextRetryAtIso: new Date(nowMs).toISOString(),
      messageSummary,
      payload: storedEvent.payload,
      createdAtMs: nowMs,
      createdAtIso: new Date(nowMs).toISOString(),
      updatedAtMs: nowMs,
      updatedAtIso: new Date(nowMs).toISOString(),
    };

    const { created: jobCreated, job } = await enqueueNotificationJob(jobDoc);
    if (jobCreated) {
      jobsCreated.push(job);
    }
  }

  if (jobsCreated.length === 0 || options?.processImmediately === false) {
    return {
      ok: true,
      eventId,
      idempotencyKey,
      deduplicated: false,
      jobsCreated,
      dispatched: [],
    };
  }

  const jobIds = jobsCreated.map((j) => j.jobId);
  if (options?.awaitDispatch) {
    const dispatched = await processNotificationQueue({
      jobIds,
      fetchImpl: options.fetchImpl,
      nowMs,
    });
    return {
      ok: true,
      eventId,
      idempotencyKey,
      deduplicated: false,
      jobsCreated,
      dispatched,
    };
  }

  // Non-blocking background dispatch so customer checkout / API responses never stall.
  void processNotificationQueue({
    jobIds,
    fetchImpl: options?.fetchImpl,
    nowMs,
  }).catch(() => {
    // Durable job remains queued in Firestore for the scheduled worker.
  });

  return {
    ok: true,
    eventId,
    idempotencyKey,
    deduplicated: false,
    jobsCreated,
    dispatched: [],
  };
}

/**
 * Processes due durable notification jobs with per-channel failure isolation,
 * bounded exponential backoff, and dead-letter queue transitions.
 */
export async function processNotificationQueue(options?: {
  limit?: number;
  jobIds?: string[];
  nowMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<DispatchOutcome[]> {
  const nowMs = options?.nowMs ?? Date.now();
  const [settings, rules] = await Promise.all([
    fetchIntegrationSettings(),
    fetchNotificationRules(),
  ]);

  let jobs: NotificationJobDoc[] = [];
  if (options?.jobIds && options.jobIds.length > 0) {
    const loaded = await Promise.all(options.jobIds.map((id) => getNotificationJob(id)));
    jobs = loaded.filter(
      (j): j is NotificationJobDoc =>
        Boolean(j) && (j!.status === 'queued' || j!.status === 'failed_retrying')
    );
  } else {
    jobs = await listDueNotificationJobs(nowMs, options?.limit ?? 25);
  }

  const outcomes: DispatchOutcome[] = [];

  for (const job of jobs) {
    const attemptNumber = job.attemptCount + 1;
    await updateNotificationJob(job.jobId, {
      status: 'processing',
      attemptCount: attemptNumber,
      updatedAtMs: nowMs,
      updatedAtIso: new Date(nowMs).toISOString(),
    });

    let ok = false;
    let retryable = false;
    let skippedReason: string | undefined;
    let externalMessageId: string | undefined;
    let errorMessage: string | undefined;

    const templateOverride = rules.templates?.[job.eventType];

    try {
      if (job.channel === 'telegram') {
        const res = await sendTelegramEventNotification(job.payload, {
          chatIdsOverride: settings.telegram.chatIdsOverride,
          templateOverride,
          fetchImpl: options?.fetchImpl,
        });
        ok = res.ok;
        retryable = Boolean(res.retryable);
        externalMessageId = res.messageIds[0];
        errorMessage = res.error;
      } else if (job.channel === 'discord') {
        const res = await sendDiscordEventNotification(job.payload, {
          channelKeyOverride: job.discordChannelKey,
          templateOverride,
          fetchImpl: options?.fetchImpl,
        });
        ok = res.ok;
        retryable = Boolean(res.retryable);
        externalMessageId = res.ok ? `discord:${res.channelKey}` : undefined;
        errorMessage = res.error;
      } else if (job.channel === 'whatsapp') {
        const res = await sendWhatsAppBusinessEventNotification(
          job.payload,
          settings.whatsapp,
          { templateOverride, fetchImpl: options?.fetchImpl, now: new Date(nowMs) }
        );
        ok = res.ok;
        retryable = Boolean(res.retryable);
        skippedReason = res.skippedReason;
        externalMessageId = res.messageId;
        errorMessage = res.error;
      }
    } catch (err) {
      ok = false;
      retryable = true;
      errorMessage = sanitizeNotificationError(
        err instanceof Error ? err.message : 'Unexpected channel dispatch failure'
      );
    }

    const sanitizedError = errorMessage ? sanitizeNotificationError(errorMessage) : undefined;
    const nowIso = new Date(nowMs).toISOString();

    if (ok) {
      await updateNotificationJob(job.jobId, {
        status: 'sent',
        externalMessageId,
        lastError: '',
        sentAtIso: nowIso,
        updatedAtMs: nowMs,
        updatedAtIso: nowIso,
      });
      await appendNotificationLog({
        logId: makeLogId(),
        jobId: job.jobId,
        eventId: job.eventId,
        eventType: job.eventType,
        channel: job.channel,
        status: 'sent',
        attemptNumber,
        messageSummary: job.messageSummary,
        externalMessageId,
        createdAtMs: nowMs,
        createdAtIso: nowIso,
      });
      void updateChannelConnectionStatus(job.channel, {
        lastConnectedAtIso: nowIso,
        lastError: '',
      }).catch(() => {});
      outcomes.push({
        jobId: job.jobId,
        channel: job.channel,
        status: 'sent',
        attemptCount: attemptNumber,
        externalMessageId,
      });
      continue;
    }

    if (skippedReason) {
      await updateNotificationJob(job.jobId, {
        status: 'skipped_disabled',
        lastError: sanitizedError,
        updatedAtMs: nowMs,
        updatedAtIso: nowIso,
      });
      await appendNotificationLog({
        logId: makeLogId(),
        jobId: job.jobId,
        eventId: job.eventId,
        eventType: job.eventType,
        channel: job.channel,
        status: 'skipped',
        attemptNumber,
        messageSummary: job.messageSummary,
        errorDetail: sanitizedError,
        createdAtMs: nowMs,
        createdAtIso: nowIso,
      });
      outcomes.push({
        jobId: job.jobId,
        channel: job.channel,
        status: 'skipped_disabled',
        attemptCount: attemptNumber,
        error: sanitizedError,
      });
      continue;
    }

    const canRetry = retryable && attemptNumber < job.maxAttempts;
    if (canRetry) {
      const backoffSec = Math.min(
        3600,
        rules.baseBackoffSeconds * Math.pow(2, Math.max(0, attemptNumber - 1))
      );
      const nextRetryAtMs = nowMs + backoffSec * 1000;
      await updateNotificationJob(job.jobId, {
        status: 'failed_retrying',
        lastError: sanitizedError,
        nextRetryAtMs,
        nextRetryAtIso: new Date(nextRetryAtMs).toISOString(),
        updatedAtMs: nowMs,
        updatedAtIso: nowIso,
      });
      await appendNotificationLog({
        logId: makeLogId(),
        jobId: job.jobId,
        eventId: job.eventId,
        eventType: job.eventType,
        channel: job.channel,
        status: 'retrying',
        attemptNumber,
        messageSummary: job.messageSummary,
        errorDetail: sanitizedError,
        createdAtMs: nowMs,
        createdAtIso: nowIso,
      });
      void updateChannelConnectionStatus(job.channel, {
        lastError: sanitizedError || 'Retrying delivery',
      }).catch(() => {});
      outcomes.push({
        jobId: job.jobId,
        channel: job.channel,
        status: 'failed_retrying',
        attemptCount: attemptNumber,
        error: sanitizedError,
      });
      continue;
    }

    // Dead-letter queue: retries exhausted or permanent / non-retryable configuration error
    await updateNotificationJob(job.jobId, {
      status: 'dead_letter',
      lastError: sanitizedError,
      deadLetteredAtIso: nowIso,
      updatedAtMs: nowMs,
      updatedAtIso: nowIso,
    });
    await appendNotificationLog({
      logId: makeLogId(),
      jobId: job.jobId,
      eventId: job.eventId,
      eventType: job.eventType,
      channel: job.channel,
      status: 'dead_letter',
      attemptNumber,
      messageSummary: job.messageSummary,
      errorDetail: sanitizedError,
      createdAtMs: nowMs,
      createdAtIso: nowIso,
    });
    void updateChannelConnectionStatus(job.channel, {
      lastError: sanitizedError || 'Delivery dead-lettered',
    }).catch(() => {});
    outcomes.push({
      jobId: job.jobId,
      channel: job.channel,
      status: 'dead_letter',
      attemptCount: attemptNumber,
      error: sanitizedError,
    });
  }

  return outcomes;
}

/**
 * Resets a failed or dead-lettered job back to `queued` and immediately dispatches it.
 */
export async function retryNotificationJob(
  jobId: string,
  options?: { fetchImpl?: typeof fetch; nowMs?: number }
): Promise<{ ok: boolean; outcome?: DispatchOutcome; error?: string }> {
  const existing = await getNotificationJob(jobId);
  if (!existing) {
    return { ok: false, error: 'Notification job not found.' };
  }
  const nowMs = options?.nowMs ?? Date.now();
  await updateNotificationJob(jobId, {
    status: 'queued',
    attemptCount: 0,
    nextRetryAtMs: nowMs,
    nextRetryAtIso: new Date(nowMs).toISOString(),
    lastError: '',
    deadLetteredAtIso: undefined,
    updatedAtMs: nowMs,
    updatedAtIso: new Date(nowMs).toISOString(),
  });

  const outcomes = await processNotificationQueue({
    jobIds: [jobId],
    fetchImpl: options?.fetchImpl,
    nowMs,
  });
  const outcome = outcomes[0];
  return {
    ok: outcome?.status === 'sent',
    outcome,
    error: outcome?.error,
  };
}

/**
 * Non-blocking, fail-safe wrapper used by existing storefront/payment/webhook routes.
 * Never throws or disrupts primary customer flows when Admin SDK is unavailable in preview
 * or when unit tests run without the notification memory store enabled.
 */
export async function publishBusinessEventSafe(
  event: BusinessEventPayload,
  options?: PublishEventOptions
): Promise<PublishEventResult | null> {
  if (
    isTestProcessRuntime() &&
    !isNotificationStoreMemoryModeActive() &&
    !process.env.FIRESTORE_EMULATOR_HOST
  ) {
    return null;
  }
  try {
    return await publishBusinessEvent(event, options);
  } catch {
    return null;
  }
}

/**
 * Publishes a Daily Summary report event (typically triggered by Cloud Scheduler or Admin button).
 */
export async function buildAndPublishDailySummaryEvent(
  stats: {
    dateLabel?: string;
    totalOrders: number;
    pendingOrders: number;
    revenueBdt: number;
    openTickets: number;
    deadLetterNotifications: number;
    force?: boolean;
  },
  options?: PublishEventOptions
): Promise<PublishEventResult> {
  const dateLabel = stats.dateLabel || new Date().toISOString().slice(0, 10);
  const summaryLines = [
    `Orders: ${stats.totalOrders} (${stats.pendingOrders} pending)`,
    `Revenue: ৳${Math.round(stats.revenueBdt).toLocaleString('en-US')}`,
    `Open Support Tickets: ${stats.openTickets}`,
    `Dead-Letter Alerts: ${stats.deadLetterNotifications}`,
  ].join(' · ');

  return publishBusinessEvent(
    {
      type: 'DAILY_SUMMARY',
      idempotencyKey: stats.force
        ? `daily_summary_${dateLabel}_${Date.now()}`
        : `daily_summary_${dateLabel}`,
      title: `Daily Operations Summary — ${dateLabel}`,
      summary: summaryLines,
      totalBdt: stats.revenueBdt,
      adminPath: '/admin',
      metadata: {
        totalOrders: stats.totalOrders,
        pendingOrders: stats.pendingOrders,
        openTickets: stats.openTickets,
        deadLetterNotifications: stats.deadLetterNotifications,
      },
    },
    options
  );
}
