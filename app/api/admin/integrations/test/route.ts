import { NextResponse } from 'next/server';
import { verifyServerAdminToken } from '../../../../../src/lib/chatbot/firestoreRest';
import { testDiscordConnection } from '../../../../../src/lib/integrations/discordWebhook';
import { testTelegramConnection } from '../../../../../src/lib/integrations/telegramBot';
import { testWhatsAppCloudConnection } from '../../../../../src/lib/integrations/whatsappCloud';
import {
  fetchIntegrationSettings,
  updateChannelConnectionStatus,
} from '../../../../../src/lib/notifications/store';
import {
  DISCORD_CHANNEL_KEYS,
  sanitizeNotificationError,
  type DiscordChannelKey,
} from '../../../../../src/lib/notifications/types';

export const dynamic = 'force-dynamic';

type TestProvider = 'telegram' | 'discord' | 'whatsapp' | 'ai';

async function testGeminiReadiness(): Promise<{
  ok: boolean;
  configured: boolean;
  model: string;
  error?: string;
}> {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  const model = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';
  if (apiKey.length < 16) {
    return {
      ok: false,
      configured: false,
      model,
      error: 'Gemini AI provider is not configured (set server env GEMINI_API_KEY).',
    };
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
      {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey },
        cache: 'no-store',
      }
    );
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        model,
        error: `Gemini API check HTTP ${res.status}`,
      };
    }
    return { ok: true, configured: true, model };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      model,
      error: sanitizeNotificationError(err instanceof Error ? err.message : 'Gemini test failed'),
    };
  }
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.trim().startsWith('Bearer ')) {
    return NextResponse.json(
      { ok: false, code: 'unauthorized', error: 'Admin Bearer token required.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const admin = await verifyServerAdminToken(authHeader);
  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, code: 'forbidden', error: 'Admin authorization required.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, code: 'invalid_json', error: 'Malformed JSON body.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const provider = String(body.provider || '').trim().toLowerCase() as TestProvider;
  if (provider !== 'telegram' && provider !== 'discord' && provider !== 'whatsapp' && provider !== 'ai') {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_provider',
        error: 'Provider must be one of: telegram, discord, whatsapp, ai.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const nowIso = new Date().toISOString();

  if (provider === 'telegram') {
    let chatIdsOverride = typeof body.chatIdsOverride === 'string' ? body.chatIdsOverride : undefined;
    if (!chatIdsOverride) {
      const settings = await fetchIntegrationSettings().catch(() => null);
      chatIdsOverride = settings?.telegram.chatIdsOverride;
    }
    const res = await testTelegramConnection({
      chatIdsOverride,
      sendPingMessage: body.sendPingMessage !== false,
    });
    void updateChannelConnectionStatus('telegram', {
      lastTestedAtIso: nowIso,
      ...(res.ok ? { lastConnectedAtIso: nowIso, lastError: '' } : { lastError: res.error }),
    }).catch(() => {});

    return NextResponse.json(
      { provider, ...res, testedAtIso: nowIso },
      {
        status: !res.configured ? 503 : res.ok ? 200 : 502,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  if (provider === 'discord') {
    const rawKey = String(body.channelKey || 'system-alerts').trim();
    const channelKey = (DISCORD_CHANNEL_KEYS as readonly string[]).includes(rawKey)
      ? (rawKey as DiscordChannelKey)
      : 'system-alerts';
    const res = await testDiscordConnection({ channelKey });
    void updateChannelConnectionStatus('discord', {
      lastTestedAtIso: nowIso,
      ...(res.ok ? { lastConnectedAtIso: nowIso, lastError: '' } : { lastError: res.error }),
    }).catch(() => {});

    return NextResponse.json(
      { provider, ...res, testedAtIso: nowIso },
      {
        status: !res.configured ? 503 : res.ok ? 200 : 502,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  if (provider === 'whatsapp') {
    const res = await testWhatsAppCloudConnection();
    void updateChannelConnectionStatus('whatsapp', {
      lastTestedAtIso: nowIso,
      ...(res.ok ? { lastConnectedAtIso: nowIso, lastError: '' } : { lastError: res.error }),
    }).catch(() => {});

    return NextResponse.json(
      { provider, ...res, testedAtIso: nowIso },
      {
        status: !res.configured ? 503 : res.ok ? 200 : 502,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  const aiRes = await testGeminiReadiness();
  void updateChannelConnectionStatus('aiSupport', {
    lastTestedAtIso: nowIso,
    ...(aiRes.ok ? { lastConnectedAtIso: nowIso, lastError: '' } : { lastError: aiRes.error }),
  }).catch(() => {});

  return NextResponse.json(
    { provider, ...aiRes, testedAtIso: nowIso },
    {
      status: !aiRes.configured ? 503 : aiRes.ok ? 200 : 502,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
