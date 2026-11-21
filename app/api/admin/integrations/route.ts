import { NextResponse } from 'next/server';
import { verifyServerAdminToken } from '../../../../src/lib/chatbot/firestoreRest';
import { AdminSdkUnavailableError } from '../../../../src/lib/firebaseAdmin';
import {
  isGeminiApiKeyConfigured,
  isOrderTokenSecretConfigured,
} from '../../../../src/lib/gemini/client';
import { getCourierApiReadiness } from '../../../../src/lib/integrations/courierApi';
import { getDiscordReadiness } from '../../../../src/lib/integrations/discordWebhook';
import { getMessagingGatewayReadiness } from '../../../../src/lib/integrations/messagingGateway';
import { getPaymentGatewayReadiness } from '../../../../src/lib/integrations/paymentGateway';
import { getTelegramReadiness } from '../../../../src/lib/integrations/telegramBot';
import { getWhatsAppCloudReadiness } from '../../../../src/lib/integrations/whatsappCloud';
import {
  fetchIntegrationSettings,
  fetchNotificationRules,
  saveIntegrationSettings,
  saveNotificationRules,
} from '../../../../src/lib/notifications/store';
import {
  BUSINESS_EVENT_TYPES,
  DEFAULT_INTEGRATION_SETTINGS,
  DEFAULT_NOTIFICATION_RULES,
  DISCORD_CHANNEL_KEYS,
  isCustomerCapableEvent,
  mergeIntegrationSettings,
  mergeNotificationRules,
  type BusinessEventType,
  type DiscordChannelKey,
  type IntegrationSettingsDoc,
  type NotificationRecipientScope,
  type NotificationRulesDoc,
  type NotificationTemplateOverride,
} from '../../../../src/lib/notifications/types';

export const dynamic = 'force-dynamic';

function getAiReadiness() {
  const hasGeminiKey = isGeminiApiKeyConfigured();
  return {
    configured: hasGeminiKey,
    provider: 'Google Gemini',
    model: process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
    hasApiKey: hasGeminiKey,
  };
}

function getFullIntegrationReadiness(chatIdsOverride?: string) {
  const siteBaseUrl = String(process.env.NEXT_PUBLIC_SITE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const metaHasAppSecret = String(process.env.META_APP_SECRET || '').trim().length >= 8;
  const metaHasVerifyToken = String(process.env.META_VERIFY_TOKEN || '').trim().length >= 4;
  const metaHasPageToken = String(process.env.META_PAGE_ACCESS_TOKEN || '').trim().length >= 10;

  const ownerEmail = String(process.env.OWNER_NOTIFICATION_EMAIL || '').trim();
  const maskedOwnerEmail = ownerEmail.includes('@')
    ? `${ownerEmail.slice(0, 2)}***@${ownerEmail.split('@')[1]}`
    : '';

  return {
    telegram: getTelegramReadiness(chatIdsOverride),
    discord: getDiscordReadiness(),
    whatsapp: getWhatsAppCloudReadiness(),
    aiSupport: getAiReadiness(),
    meta: {
      configured: metaHasAppSecret && metaHasVerifyToken,
      hasAppSecret: metaHasAppSecret,
      hasVerifyToken: metaHasVerifyToken,
      hasPageAccessToken: metaHasPageToken,
      webhookPath: '/api/channels/webhook',
    },
    payments: {
      ...getPaymentGatewayReadiness(),
      callbackPath: '/api/payments/callback',
    },
    couriers: {
      ...getCourierApiReadiness(),
      pathaoLiveMode: String(process.env.PATHAO_IS_LIVE || '').toLowerCase() === 'true',
      redxLiveMode: String(process.env.REDX_IS_LIVE || '').toLowerCase() === 'true',
      hasPathaoLocationMap: String(process.env.PATHAO_CITY_ZONE_MAP_JSON || '').trim().length > 2,
      hasRedxAreaMap: String(process.env.REDX_AREA_ID_MAP_JSON || '').trim().length > 2,
      webhookPath: '/api/couriers/webhook',
    },
    messaging: {
      ...getMessagingGatewayReadiness(),
      hasOwnerEmail: ownerEmail.includes('@'),
      maskedOwnerEmail,
      ownerWebhook: Boolean((process.env.OWNER_WEBHOOK_URL || '').trim()),
      whatsappWebhook: Boolean((process.env.WHATSAPP_WEBHOOK_URL || '').trim()),
      emailWebhook: Boolean((process.env.EMAIL_WEBHOOK_URL || '').trim()),
      googleSheetsWebhook: Boolean((process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim()),
    },
    security: {
      orderTokenSecretStrong: isOrderTokenSecretConfigured(),
      cronSecretConfigured: String(process.env.CRON_SECRET || '').trim().length >= 16,
      workerSecretConfigured:
        String(process.env.NOTIFICATION_WORKER_SECRET || '').trim().length >= 16,
      siteUrlConfigured: Boolean(siteBaseUrl) && !siteBaseUrl.includes('localhost'),
      siteBaseUrl: siteBaseUrl || '',
    },
  };
}

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

  let settings = mergeIntegrationSettings(DEFAULT_INTEGRATION_SETTINGS);
  let rules = mergeNotificationRules(DEFAULT_NOTIFICATION_RULES);
  let storageReady = true;
  let storageNotice: string | undefined;

  try {
    [settings, rules] = await Promise.all([
      fetchIntegrationSettings(),
      fetchNotificationRules(),
    ]);
  } catch (err) {
    if (err instanceof AdminSdkUnavailableError) {
      storageReady = false;
      storageNotice =
        'Firestore Admin SDK (ADC/IAM) is unavailable in this runtime; showing safe defaults.';
    } else {
      return NextResponse.json(
        { ok: false, error: 'Failed to load integration settings.' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }
      );
    }
  }

  return NextResponse.json(
    {
      ok: true,
      storageReady,
      storageNotice,
      readiness: getFullIntegrationReadiness(settings.telegram.chatIdsOverride),
      settings,
      rules,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
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

  if (!body || typeof body !== 'object' || (!body.settings && !body.rules)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_payload',
        error: 'Provide a valid "settings" and/or "rules" object.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // Strictly sanitize incoming settings (reject secrets / invalid chat IDs / oversized strings)
  let settingsPatch: Partial<IntegrationSettingsDoc> | undefined;
  if (body.settings !== undefined) {
    if (
      typeof body.settings !== 'object' ||
      body.settings === null ||
      Array.isArray(body.settings)
    ) {
      return NextResponse.json(
        { ok: false, code: 'invalid_settings', error: '"settings" must be an object.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const rawSettings = body.settings as Record<string, unknown>;
    settingsPatch = {};

    if (rawSettings.telegram && typeof rawSettings.telegram === 'object') {
      const tg = rawSettings.telegram as Record<string, unknown>;
      const chatIdsOverride =
        typeof tg.chatIdsOverride === 'string'
          ? tg.chatIdsOverride.trim().slice(0, 180)
          : undefined;
      if (
        chatIdsOverride &&
        chatIdsOverride
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .some((id) => !/^-?\d{4,20}$/.test(id))
      ) {
        return NextResponse.json(
          {
            ok: false,
            code: 'invalid_telegram_chat_id',
            error: 'Telegram chat IDs must be comma-separated numeric IDs (e.g. -1001234567890).',
          },
          { status: 400, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      settingsPatch.telegram = {
        ...DEFAULT_INTEGRATION_SETTINGS.telegram,
        ...(typeof tg.enabled === 'boolean' ? { enabled: tg.enabled } : {}),
        ...(chatIdsOverride !== undefined ? { chatIdsOverride } : {}),
      };
    }

    if (rawSettings.discord && typeof rawSettings.discord === 'object') {
      const dc = rawSettings.discord as Record<string, unknown>;
      const rawCh =
        dc.enabledChannels && typeof dc.enabledChannels === 'object'
          ? (dc.enabledChannels as Record<string, unknown>)
          : undefined;
      const enabledChannels: Record<DiscordChannelKey, boolean> = {
        ...DEFAULT_INTEGRATION_SETTINGS.discord.enabledChannels,
      };
      if (rawCh) {
        for (const k of DISCORD_CHANNEL_KEYS) {
          if (typeof rawCh[k] === 'boolean') {
            enabledChannels[k] = rawCh[k] as boolean;
          }
        }
      }
      settingsPatch.discord = {
        ...DEFAULT_INTEGRATION_SETTINGS.discord,
        ...(typeof dc.enabled === 'boolean' ? { enabled: dc.enabled } : {}),
        ...(rawCh ? { enabledChannels } : {}),
      };
    }

    if (rawSettings.whatsapp && typeof rawSettings.whatsapp === 'object') {
      const wa = rawSettings.whatsapp as Record<string, unknown>;
      settingsPatch.whatsapp = {
        ...DEFAULT_INTEGRATION_SETTINGS.whatsapp,
        ...(typeof wa.enabled === 'boolean' ? { enabled: wa.enabled } : {}),
        ...(typeof wa.sendOrderConfirmations === 'boolean'
          ? { sendOrderConfirmations: wa.sendOrderConfirmations }
          : {}),
        ...(typeof wa.sendStatusUpdates === 'boolean'
          ? { sendStatusUpdates: wa.sendStatusUpdates }
          : {}),
        ...(typeof wa.sendDeliveryAlerts === 'boolean'
          ? { sendDeliveryAlerts: wa.sendDeliveryAlerts }
          : {}),
        ...(typeof wa.orderConfirmationTemplateName === 'string'
          ? {
              orderConfirmationTemplateName: wa.orderConfirmationTemplateName
                .trim()
                .replace(/[^a-zA-Z0-9_-]/g, '')
                .slice(0, 80),
            }
          : {}),
        ...(typeof wa.orderStatusTemplateName === 'string'
          ? {
              orderStatusTemplateName: wa.orderStatusTemplateName
                .trim()
                .replace(/[^a-zA-Z0-9_-]/g, '')
                .slice(0, 80),
            }
          : {}),
        ...(typeof wa.templateLanguageCode === 'string'
          ? {
              templateLanguageCode: wa.templateLanguageCode
                .trim()
                .replace(/[^a-zA-Z0-9_-]/g, '')
                .slice(0, 16),
            }
          : {}),
      };
    }

    if (rawSettings.aiSupport && typeof rawSettings.aiSupport === 'object') {
      const ai = rawSettings.aiSupport as Record<string, unknown>;
      settingsPatch.aiSupport = {
        ...DEFAULT_INTEGRATION_SETTINGS.aiSupport,
        ...(typeof ai.enabled === 'boolean' ? { enabled: ai.enabled } : {}),
      };
    }
  }

  let rulesPatch: Partial<NotificationRulesDoc> | undefined;
  if (body.rules !== undefined) {
    if (typeof body.rules !== 'object' || body.rules === null || Array.isArray(body.rules)) {
      return NextResponse.json(
        { ok: false, code: 'invalid_rules', error: '"rules" must be an object.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const rawRules = body.rules as Record<string, unknown>;
    rulesPatch = {};
    if (rawRules.events && typeof rawRules.events === 'object') {
      const evInput = rawRules.events as Record<string, unknown>;
      const evOut = { ...DEFAULT_NOTIFICATION_RULES.events };
      for (const evt of BUSINESS_EVENT_TYPES) {
        if (evInput[evt] && typeof evInput[evt] === 'object') {
          const r = evInput[evt] as Record<string, unknown>;
          evOut[evt] = {
            enabled: typeof r.enabled === 'boolean' ? r.enabled : evOut[evt].enabled,
            telegram: typeof r.telegram === 'boolean' ? r.telegram : evOut[evt].telegram,
            discord: typeof r.discord === 'boolean' ? r.discord : evOut[evt].discord,
            whatsapp: typeof r.whatsapp === 'boolean' ? r.whatsapp : evOut[evt].whatsapp,
          };
        }
      }
      rulesPatch.events = evOut;
    }

    if (rawRules.templates !== undefined) {
      if (
        typeof rawRules.templates !== 'object' ||
        rawRules.templates === null ||
        Array.isArray(rawRules.templates)
      ) {
        return NextResponse.json(
          { ok: false, code: 'invalid_templates', error: '"rules.templates" must be an object.' },
          { status: 400, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      const tplInput = rawRules.templates as Record<string, unknown>;
      const tplOut: Partial<Record<BusinessEventType, NotificationTemplateOverride>> = {};
      for (const evt of BUSINESS_EVENT_TYPES) {
        const entry = tplInput[evt];
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          const t = entry as Record<string, unknown>;
          const scopeRaw = String(t.recipientScope || '').trim();
          const parsedScope: NotificationRecipientScope | undefined =
            scopeRaw === 'admin' || scopeRaw === 'customer' || scopeRaw === 'both'
              ? scopeRaw
              : undefined;
          const recipientScope: NotificationRecipientScope | undefined = parsedScope
            ? isCustomerCapableEvent(evt)
              ? parsedScope
              : 'admin'
            : undefined;
          const cleanEntry: NotificationTemplateOverride = {
            ...(typeof t.titleTemplate === 'string' && t.titleTemplate.trim()
              ? { titleTemplate: t.titleTemplate.trim().slice(0, 180) }
              : {}),
            ...(typeof t.bodyTemplate === 'string' && t.bodyTemplate.trim()
              ? { bodyTemplate: t.bodyTemplate.trim().slice(0, 1200) }
              : {}),
            ...(typeof t.emailSubjectTemplate === 'string' && t.emailSubjectTemplate.trim()
              ? { emailSubjectTemplate: t.emailSubjectTemplate.trim().slice(0, 160) }
              : {}),
            ...(typeof t.whatsappMessageTemplate === 'string' && t.whatsappMessageTemplate.trim()
              ? { whatsappMessageTemplate: t.whatsappMessageTemplate.trim().slice(0, 1000) }
              : {}),
            ...(recipientScope ? { recipientScope } : {}),
          };
          if (Object.keys(cleanEntry).length > 0) {
            tplOut[evt] = cleanEntry;
          }
        }
      }
      rulesPatch.templates = tplOut;
    }

    if (rawRules.ownerNotificationEmailOverride !== undefined) {
      const email = String(rawRules.ownerNotificationEmailOverride || '').trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json(
          {
            ok: false,
            code: 'invalid_owner_email',
            error: 'Owner notification email override must be a valid email address or left blank.',
          },
          { status: 400, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      rulesPatch.ownerNotificationEmailOverride = email.slice(0, 120);
    }

    if (rawRules.maxRetries !== undefined) {
      rulesPatch.maxRetries = Number(rawRules.maxRetries);
    }
    if (rawRules.baseBackoffSeconds !== undefined) {
      rulesPatch.baseBackoffSeconds = Number(rawRules.baseBackoffSeconds);
    }
    if (rawRules.lowStockThreshold !== undefined) {
      rulesPatch.lowStockThreshold = Number(rawRules.lowStockThreshold);
    }
  }

  try {
    const savedSettings = settingsPatch
      ? await saveIntegrationSettings(settingsPatch, auth.admin.email)
      : await fetchIntegrationSettings();
    const savedRules = rulesPatch
      ? await saveNotificationRules(rulesPatch, auth.admin.email)
      : await fetchNotificationRules();

    return NextResponse.json(
      {
        ok: true,
        settings: savedSettings,
        rules: savedRules,
        readiness: getFullIntegrationReadiness(savedSettings.telegram.chatIdsOverride),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof AdminSdkUnavailableError) {
      return NextResponse.json(
        {
          ok: false,
          code: 'admin_sdk_unavailable',
          error:
            'Firestore Admin SDK (ADC/IAM) is unavailable; cannot persist integration settings.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Failed to save integration settings.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
