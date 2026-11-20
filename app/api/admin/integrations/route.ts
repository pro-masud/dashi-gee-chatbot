import { NextResponse } from 'next/server';
import { verifyServerAdminToken } from '../../../../src/lib/chatbot/firestoreRest';
import { AdminSdkUnavailableError } from '../../../../src/lib/firebaseAdmin';
import { getDiscordReadiness } from '../../../../src/lib/integrations/discordWebhook';
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
  mergeIntegrationSettings,
  mergeNotificationRules,
  type DiscordChannelKey,
  type IntegrationSettingsDoc,
  type NotificationRulesDoc,
} from '../../../../src/lib/notifications/types';

export const dynamic = 'force-dynamic';

function getAiReadiness() {
  const hasGeminiKey = String(process.env.GEMINI_API_KEY || '').trim().length >= 16;
  return {
    configured: hasGeminiKey,
    provider: 'Google Gemini',
    model: process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
    hasApiKey: hasGeminiKey,
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
      readiness: {
        telegram: getTelegramReadiness(settings.telegram.chatIdsOverride),
        discord: getDiscordReadiness(),
        whatsapp: getWhatsAppCloudReadiness(),
        aiSupport: getAiReadiness(),
      },
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
    if (typeof body.settings !== 'object' || body.settings === null || Array.isArray(body.settings)) {
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
        typeof tg.chatIdsOverride === 'string' ? tg.chatIdsOverride.trim().slice(0, 180) : undefined;
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
        readiness: {
          telegram: getTelegramReadiness(savedSettings.telegram.chatIdsOverride),
          discord: getDiscordReadiness(),
          whatsapp: getWhatsAppCloudReadiness(),
          aiSupport: getAiReadiness(),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof AdminSdkUnavailableError) {
      return NextResponse.json(
        {
          ok: false,
          code: 'admin_sdk_unavailable',
          error: 'Firestore Admin SDK (ADC/IAM) is unavailable; cannot persist integration settings.',
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
