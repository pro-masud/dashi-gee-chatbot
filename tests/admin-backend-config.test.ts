import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  BUSINESS_EVENT_TYPES,
  DEFAULT_EVENT_TEMPLATES,
  EVENT_SUPPORTED_VARIABLES,
  renderNotificationTemplate,
  SAMPLE_EVENT_PAYLOADS,
} from '../src/lib/notifications/types';
import { formatTelegramEventHtml } from '../src/lib/integrations/telegramBot';
import { buildDiscordEmbedPayload } from '../src/lib/integrations/discordWebhook';
import { sendWhatsAppBusinessEventNotification } from '../src/lib/integrations/whatsappCloud';
import { publishBusinessEvent } from '../src/lib/notifications/engine';
import {
  saveNotificationRules,
  setNotificationStoreMemoryModeForTests,
} from '../src/lib/notifications/store';
import {
  setStrictAdminAuthOverrideForTests,
  verifyAdminIdTokenStrict,
} from '../src/lib/firebaseAdmin';
import {
  setAdminAuthOverrideForTests,
  verifyServerAdminToken,
} from '../src/lib/chatbot/firestoreRest';
import {
  isTestProcessRuntime,
  ProductionTestModeForbiddenError,
} from '../src/lib/server/runtimeGuards';
import { ADMIN_HELP_CONTENT } from '../src/data/adminHelpContent';

import {
  GET as adminIntegrationsGet,
  POST as adminIntegrationsPost,
} from '../app/api/admin/integrations/route';
import { POST as adminIntegrationsTestPost } from '../app/api/admin/integrations/test/route';

const TRACKED_ENV_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'DISCORD_WEBHOOK_URL',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'META_APP_SECRET',
  'META_VERIFY_TOKEN',
  'META_PAGE_ACCESS_TOKEN',
  'SSLCOMMERZ_STORE_ID',
  'SSLCOMMERZ_STORE_PASSWD',
  'SSLCOMMERZ_IS_LIVE',
  'BKASH_APP_KEY',
  'BKASH_APP_SECRET',
  'BKASH_USERNAME',
  'BKASH_PASSWORD',
  'STEADFAST_API_KEY',
  'STEADFAST_SECRET_KEY',
  'COURIER_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'OWNER_NOTIFICATION_EMAIL',
  'BULKSMSBD_API_KEY',
  'BULKSMSBD_SENDER_ID',
  'GEMINI_API_KEY',
];

const originalEnv: Record<string, string | undefined> = {};

function clearTrackedEnv() {
  for (const key of TRACKED_ENV_KEYS) {
    delete process.env[key];
  }
}

describe('Admin Backend Configuration, Help Registry, Templates & Diagnostics', () => {
  beforeEach(() => {
    for (const key of TRACKED_ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
    clearTrackedEnv();
    setNotificationStoreMemoryModeForTests(true);
    setStrictAdminAuthOverrideForTests(async () => ({
      ok: true,
      email: 'kinboni.bd@gmail.com',
      uid: 'admin-owner-test',
      emailVerified: true,
    }));
  });

  afterEach(() => {
    for (const key of TRACKED_ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    setNotificationStoreMemoryModeForTests(false);
    setStrictAdminAuthOverrideForTests(null);
  });

  it('interpolates supported variables, strips unsupported variables, and masks phone for admin alerts', () => {
    const sample = SAMPLE_EVENT_PAYLOADS.ORDER_CREATED;
    const rendered = renderNotificationTemplate(
      'Order {{order_id}} by {{customer_name}} ({{customer_phone}}) — {{order_total}} {{ticket_id}} {{unknown_var}}',
      sample,
      { maskPhone: true }
    );

    assert.ok(rendered.includes('DG-20261121-1042'));
    assert.ok(rendered.includes('Farhana Rahman'));
    assert.ok(rendered.includes('0171****890'));
    assert.ok(!rendered.includes('01711223890'), 'Raw phone must be masked for admin alerts');
    assert.ok(rendered.includes('৳2,450'));
    assert.ok(!rendered.includes('{{'), 'Must not leave unrendered template tokens');
    assert.ok(!rendered.includes('undefined'), 'Must not output undefined');
  });

  it('applies custom NotificationTemplateOverride cleanly in Telegram HTML (with XSS escaping) and Discord embeds', () => {
    const event = {
      ...SAMPLE_EVENT_PAYLOADS.ORDER_CREATED,
      customerName: '<b>Injected</b> Rahim',
    };
    const override = {
      titleTemplate: 'Custom Title: {{order_id}}',
      bodyTemplate: 'Buyer {{customer_name}} ordered {{items_summary}}',
    };

    const tgHtml = formatTelegramEventHtml(event, override);
    assert.ok(tgHtml.includes('<b>Custom Title: DG-20261121-1042</b>'));
    assert.ok(tgHtml.includes('&lt;b&gt;Injected&lt;/b&gt; Rahim'));
    assert.ok(!tgHtml.includes('<b>Injected</b>'));

    const discordPayload = buildDiscordEmbedPayload(event, override);
    assert.equal(discordPayload.embeds[0]?.title, 'Custom Title: DG-20261121-1042');
    assert.equal(
      discordPayload.embeds[0]?.description,
      'Buyer <b>Injected</b> Rahim ordered 500g × 2'
    );
  });

  it('uses custom WhatsApp 24h message template when provided inside customer-care window', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'test_wa_token_long_enough_123456';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';

    let sentBody = '';
    const mockFetch: typeof fetch = async (_url, init) => {
      sentBody = String(init?.body || '');
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.test_1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await sendWhatsAppBusinessEventNotification(
      {
        ...SAMPLE_EVENT_PAYLOADS.ORDER_CREATED,
        withinWhatsapp24hWindow: true,
      },
      {
        enabled: true,
        sendOrderConfirmations: true,
        sendStatusUpdates: true,
        sendDeliveryAlerts: true,
        orderConfirmationTemplateName: '',
        orderStatusTemplateName: '',
        templateLanguageCode: 'en_US',
      },
      {
        templateOverride: {
          whatsappMessageTemplate: 'Salam {{customer_name}}, order {{order_id}} confirmed!',
        },
        fetchImpl: mockFetch,
      }
    );

    assert.equal(res.ok, true);
    assert.ok(sentBody.includes('Salam Farhana Rahman, order DG-20261121-1042 confirmed!'));
  });

  it('enforces recipientScope (admin vs customer) when routing notification jobs', async () => {
    await saveNotificationRules({
      templates: {
        ORDER_CREATED: {
          recipientScope: 'admin',
        },
      },
    });

    const result = await publishBusinessEvent(
      {
        ...SAMPLE_EVENT_PAYLOADS.ORDER_CREATED,
        idempotencyKey: 'scope_admin_only_test_1',
        whatsappOptIn: true,
        withinWhatsapp24hWindow: true,
      },
      { processImmediately: false }
    );

    const channels = result.jobsCreated.map((j) => j.channel);
    assert.ok(channels.includes('telegram'));
    assert.ok(channels.includes('discord'));
    assert.ok(!channels.includes('whatsapp'), 'Admin-only scope must exclude customer WhatsApp');
  });

  it('returns complete non-secret multi-integration readiness on GET /api/admin/integrations and persists custom templates on POST', async () => {
    process.env.SSLCOMMERZ_STORE_ID = 'deshi_store_id';
    process.env.SSLCOMMERZ_STORE_PASSWD = 'super_secret_ssl_passwd_999';
    process.env.STEADFAST_API_KEY = 'sf_api_key_secret_123';
    process.env.STEADFAST_SECRET_KEY = 'sf_secret_key_999';
    process.env.OWNER_NOTIFICATION_EMAIL = 'owner@deshigee.com';

    const getRes = await adminIntegrationsGet(
      new Request('http://localhost/api/admin/integrations', {
        headers: { Authorization: 'Bearer mock-token' },
      })
    );
    assert.equal(getRes.status, 200);
    const getText = await getRes.text();
    assert.ok(!getText.includes('super_secret_ssl_passwd_999'), 'Never leak payment secret');
    assert.ok(!getText.includes('sf_secret_key_999'), 'Never leak courier secret');

    const getData = JSON.parse(getText);
    assert.equal(getData.ok, true);
    assert.equal(getData.readiness.payments.sslcommerz.configured, true);
    assert.equal(getData.readiness.couriers.steadfast, true);
    assert.equal(getData.readiness.messaging.hasOwnerEmail, true);
    assert.equal(getData.readiness.messaging.maskedOwnerEmail, 'ow***@deshigee.com');

    // Invalid owner email should be rejected with 400
    const badPost = await adminIntegrationsPost(
      new Request('http://localhost/api/admin/integrations', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rules: { ownerNotificationEmailOverride: 'not-an-email' },
        }),
      })
    );
    assert.equal(badPost.status, 400);

    // Valid custom template & email override should persist cleanly
    const goodPost = await adminIntegrationsPost(
      new Request('http://localhost/api/admin/integrations', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rules: {
            ownerNotificationEmailOverride: 'ops@deshigee.com',
            templates: {
              ORDER_CREATED: {
                titleTemplate: 'Deshi Gee Order {{order_id}}',
                bodyTemplate: '{{customer_name}} ordered {{items_summary}}',
                recipientScope: 'both',
              },
            },
          },
        }),
      })
    );
    assert.equal(goodPost.status, 200);
    const saved = await goodPost.json();
    assert.equal(saved.rules.ownerNotificationEmailOverride, 'ops@deshigee.com');
    assert.equal(saved.rules.templates.ORDER_CREATED.titleTemplate, 'Deshi Gee Order {{order_id}}');
  });

  it('returns honest structured diagnostics from /api/admin/integrations/test without fake passes', async () => {
    const unconfiguredProviders = ['meta', 'payments', 'couriers', 'email', 'sms'];
    for (const provider of unconfiguredProviders) {
      const res = await adminIntegrationsTestPost(
        new Request('http://localhost/api/admin/integrations/test', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer mock-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ provider }),
        })
      );
      assert.equal(res.status, 503, `${provider} must return 503 when unconfigured`);
      const data = await res.json();
      assert.equal(data.status, 'not_configured');
      assert.ok(data.whatTested, `${provider} must report whatTested`);
      assert.ok(Array.isArray(data.troubleshootingSteps) && data.troubleshootingSteps.length > 0);
    }

    // Configure Steadfast and confirm honest non-destructive readiness check returns 200
    process.env.STEADFAST_API_KEY = 'sf_key_valid_123';
    process.env.STEADFAST_SECRET_KEY = 'sf_secret_valid_123';
    const courierRes = await adminIntegrationsTestPost(
      new Request('http://localhost/api/admin/integrations/test', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: 'couriers' }),
      })
    );
    assert.equal(courierRes.status, 200);
    const courierJson = await courierRes.json();
    assert.equal(courierJson.status, 'success');
    assert.ok(courierJson.detail.includes('Steadfast'));

    // Storefront display check works honestly in test mode
    const storefrontRes = await adminIntegrationsTestPost(
      new Request('http://localhost/api/admin/integrations/test', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider: 'storefront_display' }),
      })
    );
    assert.equal(storefrontRes.status, 200);
    const sfJson = await storefrontRes.json();
    assert.ok(sfJson.whatTested);
    assert.equal(typeof sfJson.orderingReady, 'boolean');

    // Template live test returns honest 503 when Telegram is unconfigured
    const tplTestRes = await adminIntegrationsTestPost(
      new Request('http://localhost/api/admin/integrations/test', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'template_test',
          eventType: 'ORDER_CREATED',
          channel: 'telegram',
          templateOverride: DEFAULT_EVENT_TEMPLATES.ORDER_CREATED,
        }),
      })
    );
    assert.equal(tplTestRes.status, 503);
    const tplJson = await tplTestRes.json();
    assert.equal(tplJson.status, 'not_configured');
    assert.ok(tplJson.renderedTitle.includes('DG-20261121-1042'));
  });

  it('defines complete 3-tab interactive help guidance for every Admin section and supported variables for every business event', () => {
    const entries = Object.values(ADMIN_HELP_CONTENT);
    assert.ok(entries.length >= 20, 'Should cover all major backend sections');

    for (const entry of entries) {
      assert.ok(entry.title.trim().length > 3, `Missing title on ${entry.key}`);
      assert.ok(entry.howToUse.whatItDoes.trim().length > 10, `Missing whatItDoes on ${entry.key}`);
      assert.ok(entry.howToUse.steps.length >= 1, `Missing steps on ${entry.key}`);
      assert.ok(entry.frontendImpact.summary.trim().length > 10, `Missing impact on ${entry.key}`);
      assert.ok(entry.frontendImpact.affectedAreas.length >= 1, `Missing affectedAreas on ${entry.key}`);
      assert.ok(entry.testAndTroubleshoot.howToVerify.length >= 1, `Missing verify on ${entry.key}`);
      assert.ok(entry.testAndTroubleshoot.commonIssues.length >= 1, `Missing troubleshooting on ${entry.key}`);
    }

    for (const evt of BUSINESS_EVENT_TYPES) {
      assert.ok(EVENT_SUPPORTED_VARIABLES[evt].length > 0, `Missing variable definitions for ${evt}`);
      assert.ok(DEFAULT_EVENT_TEMPLATES[evt].titleTemplate.length > 0, `Missing default title for ${evt}`);
      assert.ok(SAMPLE_EVENT_PAYLOADS[evt].type === evt, `Missing sample payload for ${evt}`);
    }
  });

  it('X-22: auth override hooks are test-only, throw in NODE_ENV=production+DESHI_GEE_TEST_MODE=1, and refuse to bypass admin auth in production', async () => {
    const env = process.env as Record<string, string | undefined>;
    const prevNodeEnv = env.NODE_ENV;
    const prevTestMode = env.DESHI_GEE_TEST_MODE;
    const origError = console.error;
    console.error = () => {};

    try {
      // Attach both overrides while legitimately in test mode
      setStrictAdminAuthOverrideForTests(async () => ({
        ok: true,
        email: 'kinboni.bd@gmail.com',
        uid: 'test-override-strict',
        emailVerified: true,
      }));
      setAdminAuthOverrideForTests(async () => ({
        ok: true,
        email: 'kinboni.bd@gmail.com',
        uid: 'test-override-server',
      }));

      // 1. NODE_ENV=production + DESHI_GEE_TEST_MODE=1 MUST throw ProductionTestModeForbiddenError
      env.NODE_ENV = 'production';
      env.DESHI_GEE_TEST_MODE = '1';

      assert.throws(
        () => setStrictAdminAuthOverrideForTests(null),
        (err: unknown) => err instanceof ProductionTestModeForbiddenError
      );
      assert.throws(
        () => setAdminAuthOverrideForTests(null),
        (err: unknown) => err instanceof ProductionTestModeForbiddenError
      );
      await assert.rejects(
        () => verifyAdminIdTokenStrict('Bearer forged-token'),
        (err: unknown) => err instanceof ProductionTestModeForbiddenError
      );
      await assert.rejects(
        () => verifyServerAdminToken('Bearer forged-token'),
        (err: unknown) => err instanceof ProductionTestModeForbiddenError
      );

      // 2. NODE_ENV=production WITHOUT DESHI_GEE_TEST_MODE=1: isTestProcessRuntime() is false
      //    and previously attached test overrides are completely ignored (cannot bypass admin auth)
      delete env.DESHI_GEE_TEST_MODE;
      assert.equal(isTestProcessRuntime(), false);

      const strictRes = await verifyAdminIdTokenStrict('Bearer forged-short');
      assert.equal(strictRes.ok, false);
      assert.equal(strictRes.reason, 'invalid_token_format');

      const serverRes = await verifyServerAdminToken(null);
      assert.equal(serverRes.ok, false);
      assert.equal(serverRes.reason, 'missing_bearer_token');
    } finally {
      console.error = origError;
      if (prevNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = prevNodeEnv;
      if (prevTestMode === undefined) delete env.DESHI_GEE_TEST_MODE;
      else env.DESHI_GEE_TEST_MODE = prevTestMode;
      setAdminAuthOverrideForTests(null);
      setStrictAdminAuthOverrideForTests(null);
    }
  });

  it('X-25: customer-scope WhatsApp messages require verified consent, block opt-out, and enforce Asia/Dhaka quiet hours (22:00-08:00 BST)', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'wa_test_token_1234567890';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '9876543210';

    const waSettings = {
      enabled: true,
      sendOrderConfirmations: true,
      sendStatusUpdates: true,
      sendDeliveryAlerts: true,
      orderConfirmationTemplateName: 'order_confirmed_utility',
      orderStatusTemplateName: 'order_status_update',
      templateLanguageCode: 'en_US',
    };

    let fetchCalls = 0;
    const mockFetch: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] }), { status: 200 });
    };

    // 1. Missing opt-in outside 24h window -> skipped
    const noConsent = await sendWhatsAppBusinessEventNotification(
      { ...SAMPLE_EVENT_PAYLOADS.ORDER_CREATED, withinWhatsapp24hWindow: false },
      waSettings,
      { fetchImpl: mockFetch, now: new Date('2026-11-21T06:00:00Z') } // 12:00 BST (daytime)
    );
    assert.equal(noConsent.ok, false);
    assert.equal(noConsent.skippedReason, 'missing_customer_opt_in');

    // 2. Explicit opt-out -> blocked even inside 24h window
    const optedOut = await sendWhatsAppBusinessEventNotification(
      {
        ...SAMPLE_EVENT_PAYLOADS.ORDER_CREATED,
        whatsappOptIn: false,
        withinWhatsapp24hWindow: true,
      },
      waSettings,
      { fetchImpl: mockFetch, now: new Date('2026-11-21T06:00:00Z') }
    );
    assert.equal(optedOut.ok, false);
    assert.equal(optedOut.skippedReason, 'customer_opted_out');

    // 3. Opted in, but 23:30 Asia/Dhaka (17:30 UTC) quiet hours -> skipped
    const quietRes = await sendWhatsAppBusinessEventNotification(
      {
        ...SAMPLE_EVENT_PAYLOADS.ORDER_CREATED,
        whatsappOptIn: true,
        withinWhatsapp24hWindow: false,
      },
      waSettings,
      { fetchImpl: mockFetch, now: new Date('2026-11-21T17:30:00Z') } // 23:30 BST
    );
    assert.equal(quietRes.ok, false);
    assert.equal(quietRes.skippedReason, 'quiet_hours_dhaka');
    assert.equal(fetchCalls, 0);

    // 4. Opted in + daytime 12:00 Asia/Dhaka (06:00 UTC) -> allowed & sent
    const okRes = await sendWhatsAppBusinessEventNotification(
      {
        ...SAMPLE_EVENT_PAYLOADS.ORDER_CREATED,
        whatsappOptIn: true,
        withinWhatsapp24hWindow: false,
      },
      waSettings,
      { fetchImpl: mockFetch, now: new Date('2026-11-21T06:00:00Z') } // 12:00 BST
    );
    assert.equal(okRes.ok, true);
    assert.equal(fetchCalls, 1);
  });

  it('X-25: template tests are admin-only, email tests ignore arbitrary customer toEmail, and internal events clamp recipientScope to admin', async () => {
    // 1. template_test rejects customer WhatsApp channel with 400
    const waTplTest = await adminIntegrationsTestPost(
      new Request('http://localhost/api/admin/integrations/test', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'template_test',
          eventType: 'ORDER_CREATED',
          channel: 'whatsapp',
        }),
      })
    );
    assert.equal(waTplTest.status, 400);
    const waTplJson = await waTplTest.json();
    assert.equal(waTplJson.code, 'unsupported_template_test_channel');
    assert.match(waTplJson.error, /admin channels/i);

    // 2. Email diagnostic test ignores arbitrary body.toEmail and sends only to owner/admin email
    process.env.RESEND_API_KEY = 're_test_key_123456';
    process.env.RESEND_FROM_EMAIL = 'orders@deshigee.com';
    process.env.OWNER_NOTIFICATION_EMAIL = 'owner@deshigee.com';
    const origFetch = globalThis.fetch;
    let sentTo = '';
    try {
      globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        const parsed = JSON.parse(String(init?.body || '{}')) as { to?: string[] };
        sentTo = parsed.to?.[0] || '';
        return new Response(JSON.stringify({ id: 'email_admin_only' }), { status: 200 });
      }) as typeof fetch;

      const emailRes = await adminIntegrationsTestPost(
        new Request('http://localhost/api/admin/integrations/test', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer mock-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            provider: 'email',
            sendTestEmail: true,
            toEmail: 'random-customer@example.com',
          }),
        })
      );
      assert.equal(emailRes.status, 200);
      assert.equal(sentTo, 'owner@deshigee.com');
    } finally {
      globalThis.fetch = origFetch;
    }

    // 3. Internal event (LOW_STOCK) cannot be saved as customer-scope; server clamps to admin
    const clampRes = await adminIntegrationsPost(
      new Request('http://localhost/api/admin/integrations', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rules: {
            templates: {
              LOW_STOCK: {
                titleTemplate: 'Low stock test',
                recipientScope: 'customer',
              },
            },
          },
        }),
      })
    );
    assert.equal(clampRes.status, 200);
    const clampJson = await clampRes.json();
    assert.equal(clampJson.rules.templates.LOW_STOCK.recipientScope, 'admin');
  });

  it('X-25/X-26: all admin Reset controls require inline confirmation, avoid window.confirm, and never modify prices/stock/contacts', () => {
    const files = [
      'src/components/AdminEcosystemPanel.tsx',
      'src/components/admin/NotificationTemplatesEditor.tsx',
      'src/components/admin/StorefrontImpactPreview.tsx',
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      assert.equal(src.includes('window.confirm'), false, `${rel} must not use window.confirm`);
      assert.equal(src.includes('window.alert'), false, `${rel} must not use window.alert`);
    }
    const ecoSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/AdminEcosystemPanel.tsx'),
      'utf8'
    );
    assert.ok(ecoSrc.includes('pendingReset'), 'AdminEcosystemPanel must gate resets behind confirmation');
    assert.ok(ecoSrc.includes('Confirm Reset'));

    const tplSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/admin/NotificationTemplatesEditor.tsx'),
      'utf8'
    );
    assert.ok(tplSrc.includes('confirmingReset'), 'NotificationTemplatesEditor must gate reset behind confirmation');
    assert.ok(tplSrc.includes('Never touches'));
  });
});
