import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  formatTelegramEventHtml,
  getTelegramReadiness,
  sendTelegramEventNotification,
  testTelegramConnection,
} from '../src/lib/integrations/telegramBot';
import {
  buildDiscordEmbedPayload,
  getDiscordReadiness,
  resolveDiscordWebhookUrl,
  sendDiscordEventNotification,
} from '../src/lib/integrations/discordWebhook';
import {
  formatWhatsAppRecipient,
  parseWhatsAppDeliveryStatuses,
  sendWhatsAppBusinessEventNotification,
} from '../src/lib/integrations/whatsappCloud';
import {
  buildAndPublishDailySummaryEvent,
  processNotificationQueue,
  publishBusinessEvent,
  retryNotificationJob,
} from '../src/lib/notifications/engine';
import {
  getNotificationMemoryStateForTests,
  getNotificationQueueStats,
  saveIntegrationSettings,
  saveNotificationRules,
  setNotificationStoreMemoryModeForTests,
} from '../src/lib/notifications/store';
import {
  DEFAULT_INTEGRATION_SETTINGS,
  mapEventToDiscordChannel,
  sanitizeNotificationError,
} from '../src/lib/notifications/types';
import { setStrictAdminAuthOverrideForTests } from '../src/lib/firebaseAdmin';
import { LiveFirestoreWriteBlockedInTestError } from '../src/lib/server/runtimeGuards';

import {
  GET as adminIntegrationsGet,
  POST as adminIntegrationsPost,
} from '../app/api/admin/integrations/route';
import { POST as adminIntegrationsTestPost } from '../app/api/admin/integrations/test/route';
import {
  GET as adminNotificationsGet,
  POST as adminNotificationsPost,
} from '../app/api/admin/notifications/route';
import {
  GET as workerGet,
  POST as workerPost,
} from '../app/api/notifications/worker/route';
import {
  GET as channelsWebhookGet,
  POST as channelsWebhookPost,
} from '../app/api/channels/webhook/route';

const SAVED_ENV_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'DISCORD_WEBHOOK_URL',
  'DISCORD_WEBHOOK_ORDERS',
  'DISCORD_WEBHOOK_PAYMENTS',
  'DISCORD_WEBHOOK_SUPPORT',
  'DISCORD_WEBHOOK_INVENTORY',
  'DISCORD_WEBHOOK_REPORTS',
  'DISCORD_WEBHOOK_SYSTEM',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_APP_SECRET',
  'META_VERIFY_TOKEN',
  'META_APP_SECRET',
  'NOTIFICATION_WORKER_SECRET',
  'CRON_SECRET',
  'GEMINI_API_KEY',
];

const originalEnv: Record<string, string | undefined> = {};

function clearEcosystemEnv() {
  for (const key of SAVED_ENV_KEYS) {
    delete process.env[key];
  }
}

beforeEach(() => {
  for (const key of SAVED_ENV_KEYS) {
    originalEnv[key] = process.env[key];
  }
  clearEcosystemEnv();
  setNotificationStoreMemoryModeForTests(true);
  setStrictAdminAuthOverrideForTests(null);
});

afterEach(() => {
  for (const key of SAVED_ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
  setNotificationStoreMemoryModeForTests(false);
  setStrictAdminAuthOverrideForTests(null);
});

describe('Ecosystem Security & Fail-Closed Firestore Guard', () => {
  it('blocks live Firestore writes when notification memory store is disabled in tests', async () => {
    setNotificationStoreMemoryModeForTests(false);
    await assert.rejects(
      () =>
        saveIntegrationSettings({
          telegram: { enabled: true },
        }),
      (err: unknown) => err instanceof LiveFirestoreWriteBlockedInTestError
    );
  });

  it('sanitizes webhook URLs, Telegram bot tokens, and Bearer headers from errors', () => {
    const raw =
      'Failed POST https://discord.com/api/webhooks/123456/secretTokenXYZ with bot 987654321:AAHSecretBotTokenValue123456 and Bearer eyJhbGciOiJIUzI1NiJ9.abc';
    const clean = sanitizeNotificationError(raw);
    assert.ok(!clean.includes('secretTokenXYZ'));
    assert.ok(!clean.includes('AAHSecretBotTokenValue123456'));
    assert.ok(!clean.includes('eyJhbGciOiJIUzI1NiJ9'));
    assert.ok(clean.includes('[redacted-url]'));
    assert.ok(clean.includes('[redacted-bot-token]'));
    assert.ok(clean.includes('Bearer [redacted]'));
  });
});

describe('Telegram Admin Notification Bot', () => {
  it('reports not configured honestly when env vars are missing', async () => {
    const readiness = getTelegramReadiness();
    assert.equal(readiness.configured, false);
    const res = await sendTelegramEventNotification({
      type: 'ORDER_CREATED',
      orderNumber: 'DG-5001',
    });
    assert.equal(res.ok, false);
    assert.equal(res.configured, false);
    assert.equal(res.retryable, false);
  });

  it('escapes HTML, masks customer phone, and dispatches via sendMessage + getMe test', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAFakeTestTokenForUnitTestsOnly0001';
    process.env.TELEGRAM_CHAT_ID = '-1001234567890';

    const html = formatTelegramEventHtml({
      type: 'ORDER_CREATED',
      orderNumber: 'DG-5002',
      customerName: 'Arefin <script>alert(1)</script>',
      customerPhone: '01712345678',
      itemsSummary: '1kg Jar × 2',
      totalBdt: 3600,
    });
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('0171****678'));
    assert.ok(!html.includes('01712345678'));

    const calls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/getMe')) {
        return new Response(JSON.stringify({ ok: true, result: { username: 'deshigee_ops_bot' } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7781 } }), {
        status: 200,
      });
    };

    const testRes = await testTelegramConnection({ fetchImpl: mockFetch });
    assert.equal(testRes.ok, true);
    assert.equal(testRes.botUsername, 'deshigee_ops_bot');
    assert.equal(testRes.sentToChats, 1);
    assert.equal(calls.length, 2);
  });
});

describe('Discord Multi-Channel Webhook Integration', () => {
  it('maps all business event types to the 6 operational channels and validates URL safety', () => {
    assert.equal(mapEventToDiscordChannel('ORDER_CREATED'), 'new-orders');
    assert.equal(mapEventToDiscordChannel('PAYMENT_SUCCESS'), 'payments');
    assert.equal(mapEventToDiscordChannel('SUPPORT_REQUESTED'), 'customer-support');
    assert.equal(mapEventToDiscordChannel('LOW_STOCK'), 'inventory-alerts');
    assert.equal(mapEventToDiscordChannel('DAILY_SUMMARY'), 'daily-reports');
    assert.equal(mapEventToDiscordChannel('SYSTEM_ERROR'), 'system-alerts');

    // Reject insecure non-Discord URLs
    process.env.DISCORD_WEBHOOK_URL = 'http://evil.example.com/hook';
    assert.equal(resolveDiscordWebhookUrl('new-orders').url, '');

    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/111/fallbackToken';
    process.env.DISCORD_WEBHOOK_ORDERS = 'https://discord.com/api/webhooks/222/ordersToken';

    const ordersUrl = resolveDiscordWebhookUrl('new-orders');
    const paymentsUrl = resolveDiscordWebhookUrl('payments');
    assert.equal(ordersUrl.usesDedicatedWebhook, true);
    assert.equal(paymentsUrl.usesDedicatedWebhook, false);
    assert.equal(getDiscordReadiness().configured, true);
  });

  it('builds structured embeds and dispatches without exposing webhook URLs on failure', async () => {
    process.env.DISCORD_WEBHOOK_ORDERS = 'https://discord.com/api/webhooks/999/topSecretHook';
    const embed = buildDiscordEmbedPayload({
      type: 'ORDER_CREATED',
      orderNumber: 'DG-5100',
      customerName: 'Nadia Rahman',
      customerPhone: '01812345678',
      totalBdt: 1850,
      paymentMethod: 'cod',
    });
    assert.equal(embed.embeds.length, 1);
    assert.ok(embed.embeds[0].fields.some((f) => f.name === 'Order ID' && f.value === 'DG-5100'));
    assert.ok(embed.embeds[0].footer.text.includes('#new-orders'));

    const failFetch: typeof fetch = async () =>
      new Response('error reaching https://discord.com/api/webhooks/999/topSecretHook', {
        status: 500,
      });
    const res = await sendDiscordEventNotification(
      { type: 'ORDER_CREATED', orderNumber: 'DG-5100' },
      { fetchImpl: failFetch }
    );
    assert.equal(res.ok, false);
    assert.equal(res.retryable, true);
    assert.ok(!String(res.error || '').includes('topSecretHook'));
  });
});

describe('WhatsApp Business Cloud API & Webhook Compliance', () => {
  it('enforces opt-in and 24h window rules and parses delivery status receipts', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'EAAG_test_whatsapp_token_value';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '10987654321';

    assert.equal(formatWhatsAppRecipient('01711223344'), '8801711223344');

    const waSettings = {
      ...DEFAULT_INTEGRATION_SETTINGS.whatsapp,
      enabled: true,
      sendOrderConfirmations: true,
      orderConfirmationTemplateName: 'order_confirmed_utility',
    };

    // Missing opt-in outside 24h window MUST skip cleanly
    const skipped = await sendWhatsAppBusinessEventNotification(
      {
        type: 'ORDER_CREATED',
        orderNumber: 'DG-5201',
        customerPhone: '01711223344',
        whatsappOptIn: false,
        withinWhatsapp24hWindow: false,
      },
      waSettings
    );
    assert.equal(skipped.ok, false);
    assert.equal(skipped.skippedReason, 'missing_customer_opt_in');

    // Opted-in order confirmation uses approved Meta utility template
    let capturedBody: Record<string, unknown> = {};
    const templateFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.test123' }] }), { status: 200 });
    };
    const sent = await sendWhatsAppBusinessEventNotification(
      {
        type: 'ORDER_CREATED',
        orderNumber: 'DG-5202',
        customerName: 'Karim',
        customerPhone: '01711223344',
        whatsappOptIn: true,
      },
      waSettings,
      { fetchImpl: templateFetch, now: new Date('2026-04-01T06:00:00Z') }
    );
    assert.equal(sent.ok, true);
    assert.equal(sent.messageId, 'wamid.test123');
    assert.equal(capturedBody.type, 'template');

    // Delivery receipt parser
    const receipts = parseWhatsAppDeliveryStatuses({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.1', recipient_id: '8801711223344', status: 'delivered', timestamp: '1730000000' },
                  { id: 'wamid.2', recipient_id: '8801711223344', status: 'failed', errors: [{ title: 'Undeliverable' }] },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(receipts.length, 2);
    assert.equal(receipts[0].status, 'delivered');
    assert.equal(receipts[1].errorTitle, 'Undeliverable');
  });

  it('verifies WHATSAPP_VERIFY_TOKEN on GET and parses delivery statuses on signed POST', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify_deshigee_wa_token';
    process.env.WHATSAPP_APP_SECRET = 'wa_test_app_secret_12345';

    const getRes = await channelsWebhookGet(
      new Request(
        'http://localhost:3000/api/channels/webhook?hub.mode=subscribe&hub.verify_token=verify_deshigee_wa_token&hub.challenge=challenge_999'
      )
    );
    assert.equal(getRes.status, 200);
    assert.equal(await getRes.text(), 'challenge_999');

    const statusPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.status_1', recipient_id: '8801711223344', status: 'read', timestamp: '1730000100' },
                ],
              },
            },
          ],
        },
      ],
    });
    const sig =
      'sha256=' +
      crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(statusPayload).digest('hex');

    const postRes = await channelsWebhookPost(
      new Request('http://localhost:3000/api/channels/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': sig,
        },
        body: statusPayload,
      })
    );
    assert.equal(postRes.status, 200);
    const json = await postRes.json();
    assert.equal(json.ok, true);
    assert.equal(json.deliveryStatusesCount, 1);
    assert.equal(json.deliveryStatuses[0].status, 'read');
  });
});

describe('Central Notification Engine: Idempotency, Isolation, Backoff, DLQ & Manual Retry', () => {
  it('isolates per-channel failures, deduplicates events, backs off exponentially, moves to DLQ, and recovers on manual retry', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAFakeTestTokenForUnitTestsOnly0002';
    process.env.TELEGRAM_CHAT_ID = '-1001234567890';
    process.env.DISCORD_WEBHOOK_ORDERS = 'https://discord.com/api/webhooks/333/ordersHook';

    await saveNotificationRules({ maxRetries: 2, baseBackoffSeconds: 30 });

    let telegramShouldFail = true;
    const mixedFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('api.telegram.org')) {
        if (telegramShouldFail) {
          return new Response(JSON.stringify({ ok: false, description: 'Upstream 502' }), {
            status: 502,
          });
        }
        return new Response(JSON.stringify({ ok: true, result: { message_id: 901 } }), {
          status: 200,
        });
      }
      // Discord succeeds
      return new Response(null, { status: 204 });
    };

    const t0 = 1_750_000_000_000;
    const pub = await publishBusinessEvent(
      {
        type: 'ORDER_CREATED',
        idempotencyKey: 'order_created_DG-7700',
        orderNumber: 'DG-7700',
        customerName: 'Tariq Hasan',
        totalBdt: 2400,
      },
      { awaitDispatch: true, fetchImpl: mixedFetch, nowMs: t0 }
    );

    assert.equal(pub.ok, true);
    assert.equal(pub.deduplicated, false);
    assert.equal(pub.dispatched.length, 2);

    const discordOut = pub.dispatched.find((d) => d.channel === 'discord');
    const telegramOut = pub.dispatched.find((d) => d.channel === 'telegram');
    assert.equal(discordOut?.status, 'sent'); // Channel isolation: Discord succeeded despite Telegram 502!
    assert.equal(telegramOut?.status, 'failed_retrying');
    assert.equal(telegramOut?.attemptCount, 1);

    // Verify exponential backoff scheduled 30s in the future
    const mem = getNotificationMemoryStateForTests();
    const tgJobAfter1 = mem.jobs.get(telegramOut!.jobId)!;
    assert.equal(tgJobAfter1.nextRetryAtMs, t0 + 30_000);

    // Duplicate publish with same idempotencyKey MUST deduplicate
    const dup = await publishBusinessEvent(
      {
        type: 'ORDER_CREATED',
        idempotencyKey: 'order_created_DG-7700',
        orderNumber: 'DG-7700',
      },
      { awaitDispatch: true, fetchImpl: mixedFetch, nowMs: t0 + 1000 }
    );
    assert.equal(dup.deduplicated, true);
    assert.equal(dup.jobsCreated.length, 0);

    // Before backoff window expires, worker processes 0 jobs
    const earlyRun = await processNotificationQueue({ nowMs: t0 + 15_000, fetchImpl: mixedFetch });
    assert.equal(earlyRun.length, 0);

    // After backoff window expires, 2nd attempt fails -> moves to dead_letter (maxRetries=2)
    const retryRun = await processNotificationQueue({ nowMs: t0 + 35_000, fetchImpl: mixedFetch });
    assert.equal(retryRun.length, 1);
    assert.equal(retryRun[0].status, 'dead_letter');
    assert.equal(retryRun[0].attemptCount, 2);

    const statsBeforeRecovery = await getNotificationQueueStats();
    assert.equal(statsBeforeRecovery.sent, 1);
    assert.equal(statsBeforeRecovery.deadLetter, 1);

    // Admin clicks Retry after Telegram recovers
    telegramShouldFail = false;
    const manualRetry = await retryNotificationJob(telegramOut!.jobId, {
      fetchImpl: mixedFetch,
      nowMs: t0 + 60_000,
    });
    assert.equal(manualRetry.ok, true);
    assert.equal(manualRetry.outcome?.status, 'sent');

    const statsAfterRecovery = await getNotificationQueueStats();
    assert.equal(statsAfterRecovery.sent, 2);
    assert.equal(statsAfterRecovery.deadLetter, 0);
  });

  it('publishes daily summary reports to enabled channels', async () => {
    process.env.DISCORD_WEBHOOK_REPORTS = 'https://discord.com/api/webhooks/444/reportsHook';
    const okFetch: typeof fetch = async () => new Response(null, { status: 204 });
    const res = await buildAndPublishDailySummaryEvent(
      {
        dateLabel: '2026-11-20',
        totalOrders: 14,
        pendingOrders: 2,
        revenueBdt: 28500,
        openTickets: 1,
        deadLetterNotifications: 0,
      },
      { awaitDispatch: true, fetchImpl: okFetch }
    );
    assert.equal(res.ok, true);
    assert.ok(res.dispatched.some((d) => d.channel === 'discord' && d.status === 'sent'));
  });
});

describe('Admin Integrations, Notifications & Worker API Routes Security', () => {
  const enableMockAdmin = () => {
    setStrictAdminAuthOverrideForTests(async (authHeader) => {
      if (authHeader === 'Bearer valid-admin-token') {
        return { ok: true, email: 'kinboni.bd@gmail.com', uid: 'admin-1', emailVerified: true };
      }
      return { ok: false, email: 'guest@example.com', uid: 'guest-1', emailVerified: true };
    });
  };

  it('enforces 401/403 on admin routes, rejects invalid payloads (400), and never leaks secrets', async () => {
    enableMockAdmin();
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AASuperSecretBotTokenNeverLeak999';
    process.env.TELEGRAM_CHAT_ID = '-100999888777';
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/888/superSecretHook';

    const unauth = await adminIntegrationsGet(new Request('http://localhost:3000/api/admin/integrations'));
    assert.equal(unauth.status, 401);

    const forbidden = await adminIntegrationsGet(
      new Request('http://localhost:3000/api/admin/integrations', {
        headers: { Authorization: 'Bearer non-admin-token' },
      })
    );
    assert.equal(forbidden.status, 403);

    const okRes = await adminIntegrationsGet(
      new Request('http://localhost:3000/api/admin/integrations', {
        headers: { Authorization: 'Bearer valid-admin-token' },
      })
    );
    assert.equal(okRes.status, 200);
    const rawJson = await okRes.text();
    assert.ok(!rawJson.includes('AASuperSecretBotTokenNeverLeak999'));
    assert.ok(!rawJson.includes('superSecretHook'));

    // Reject invalid Telegram chat ID override
    const badChat = await adminIntegrationsPost(
      new Request('http://localhost:3000/api/admin/integrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-admin-token',
        },
        body: JSON.stringify({
          settings: { telegram: { enabled: true, chatIdsOverride: 'not-a-chat-id' } },
        }),
      })
    );
    assert.equal(badChat.status, 400);

    // Save valid settings + rules
    const saveRes = await adminIntegrationsPost(
      new Request('http://localhost:3000/api/admin/integrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-admin-token',
        },
        body: JSON.stringify({
          settings: { telegram: { enabled: true, chatIdsOverride: '-1001122334455' } },
          rules: { maxRetries: 5, lowStockThreshold: 3 },
        }),
      })
    );
    assert.equal(saveRes.status, 200);
    const saved = await saveRes.json();
    assert.equal(saved.rules.maxRetries, 5);
    assert.equal(saved.rules.lowStockThreshold, 3);
  });

  it('returns honest 503 when testing unconfigured integrations and 400 on unknown provider', async () => {
    enableMockAdmin();

    const badProvider = await adminIntegrationsTestPost(
      new Request('http://localhost:3000/api/admin/integrations/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-admin-token',
        },
        body: JSON.stringify({ provider: 'slack' }),
      })
    );
    assert.equal(badProvider.status, 400);

    const unconfiguredTg = await adminIntegrationsTestPost(
      new Request('http://localhost:3000/api/admin/integrations/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-admin-token',
        },
        body: JSON.stringify({ provider: 'telegram' }),
      })
    );
    assert.equal(unconfiguredTg.status, 503);
    const body = await unconfiguredTg.json();
    assert.equal(body.configured, false);
  });

  it('protects /api/admin/notifications and /api/notifications/worker with strict auth', async () => {
    enableMockAdmin();
    process.env.NOTIFICATION_WORKER_SECRET = 'worker_secret_abcdef1234567890';

    const unauthHist = await adminNotificationsGet(
      new Request('http://localhost:3000/api/admin/notifications')
    );
    assert.equal(unauthHist.status, 401);

    const badAction = await adminNotificationsPost(
      new Request('http://localhost:3000/api/admin/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-admin-token',
        },
        body: JSON.stringify({ action: 'drop_table' }),
      })
    );
    assert.equal(badAction.status, 400);

    const unauthWorker = await workerGet(new Request('http://localhost:3000/api/notifications/worker'));
    assert.equal(unauthWorker.status, 401);

    const authWorkerGet = await workerGet(
      new Request('http://localhost:3000/api/notifications/worker', {
        headers: { 'x-worker-secret': 'worker_secret_abcdef1234567890' },
      })
    );
    assert.equal(authWorkerGet.status, 200);
    const workerHealth = await authWorkerGet.json();
    assert.equal(workerHealth.ok, true);
    assert.equal(workerHealth.actor, 'scheduled_worker');

    const authWorkerPost = await workerPost(
      new Request('http://localhost:3000/api/notifications/worker', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-worker-secret': 'worker_secret_abcdef1234567890',
        },
        body: JSON.stringify({ action: 'process_queue', limit: 10 }),
      })
    );
    assert.equal(authWorkerPost.status, 200);
  });
});
