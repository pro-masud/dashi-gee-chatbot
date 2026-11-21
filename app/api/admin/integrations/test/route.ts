import { NextResponse } from 'next/server';
import {
  fetchServerStoreSettingsWithMeta,
  verifyServerAdminToken,
} from '../../../../../src/lib/chatbot/firestoreRest';
import { checkAdminSdkReadiness } from '../../../../../src/lib/firebaseAdmin';
import { getCourierApiReadiness } from '../../../../../src/lib/integrations/courierApi';
import {
  sendDiscordEventNotification,
  testDiscordConnection,
} from '../../../../../src/lib/integrations/discordWebhook';
import {
  getMessagingGatewayReadiness,
  sendDirectEmail,
} from '../../../../../src/lib/integrations/messagingGateway';
import { getPaymentGatewayReadiness } from '../../../../../src/lib/integrations/paymentGateway';
import {
  sendTelegramEventNotification,
  testTelegramConnection,
} from '../../../../../src/lib/integrations/telegramBot';
import { testWhatsAppCloudConnection } from '../../../../../src/lib/integrations/whatsappCloud';
import {
  fetchIntegrationSettings,
  fetchNotificationRules,
  updateChannelConnectionStatus,
} from '../../../../../src/lib/notifications/store';
import {
  DISCORD_CHANNEL_KEYS,
  isValidBusinessEventType,
  mapEventToDiscordChannel,
  renderNotificationTemplate,
  SAMPLE_EVENT_PAYLOADS,
  sanitizeNotificationError,
  type BusinessEventType,
  type DiscordChannelKey,
  type NotificationTemplateOverride,
} from '../../../../../src/lib/notifications/types';
import {
  getConfirmedPriceForWeight,
  hasValidRealPhone,
  isStorefrontOrderingReady,
} from '../../../../../src/lib/storeTypes';

export const dynamic = 'force-dynamic';

type TestProvider =
  | 'telegram'
  | 'discord'
  | 'whatsapp'
  | 'ai'
  | 'firestore'
  | 'meta'
  | 'payments'
  | 'couriers'
  | 'email'
  | 'sms'
  | 'storefront_display'
  | 'template_test';

const VALID_PROVIDERS = new Set<TestProvider>([
  'telegram',
  'discord',
  'whatsapp',
  'ai',
  'firestore',
  'meta',
  'payments',
  'couriers',
  'email',
  'sms',
  'storefront_display',
  'template_test',
]);

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
  if (!VALID_PROVIDERS.has(provider)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'invalid_provider',
        error: `Provider must be one of: ${Array.from(VALID_PROVIDERS).join(', ')}.`,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const nowIso = new Date().toISOString();

  if (provider === 'telegram') {
    let chatIdsOverride =
      typeof body.chatIdsOverride === 'string' ? body.chatIdsOverride : undefined;
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
      {
        provider,
        ...res,
        status: !res.configured ? 'not_configured' : res.ok ? 'success' : 'failed',
        whatTested: 'Telegram Bot API getMe verification and test ping dispatch to target chat IDs.',
        possibleReasons: res.ok
          ? []
          : !res.configured
            ? ['TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set in server environment.']
            : [
                'Bot token was revoked or copied with extra spaces.',
                'Bot has not been started by the recipient (/start) or added to the admin group.',
                'Chat ID is wrong (supergroups require the -100 prefix).',
              ],
        troubleshootingSteps: res.ok
          ? ['Check your Telegram chat to confirm the ping arrived with clickable Admin link.']
          : [
              'Create a bot via @BotFather and set TELEGRAM_BOT_TOKEN in Cloud Run / Secret Manager.',
              'Send /start to your bot or add it to your admin group, then confirm the numeric chat ID.',
            ],
        testedAtIso: nowIso,
      },
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
      {
        provider,
        ...res,
        status: !res.configured ? 'not_configured' : res.ok ? 'success' : 'failed',
        whatTested: `Discord webhook embed POST to #${channelKey}.`,
        possibleReasons: res.ok
          ? []
          : !res.configured
            ? [
                `No dedicated webhook env or fallback DISCORD_WEBHOOK_URL is set for #${channelKey}.`,
              ]
            : [
                'Discord webhook was deleted or regenerated in Server Settings → Integrations.',
                'Webhook URL was not a valid https://discord.com/api/webhooks/... URL.',
              ],
        troubleshootingSteps: res.ok
          ? [`Confirm the formatted Deshi Gee embed card appeared in #${channelKey}.`]
          : [
              'Open Discord Channel Settings → Integrations → Webhooks → Copy Webhook URL.',
              'Save the URL in server env DISCORD_WEBHOOK_* or DISCORD_WEBHOOK_URL and redeploy.',
            ],
        testedAtIso: nowIso,
      },
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
      {
        provider,
        ...res,
        status: !res.configured ? 'not_configured' : res.ok ? 'success' : 'failed',
        whatTested: 'Meta Graph API read-only lookup of WhatsApp Phone Number ID & verified display name.',
        possibleReasons: res.ok
          ? []
          : !res.configured
            ? ['WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are missing on the server.']
            : [
                'Temporary 24-hour Meta developer token expired (use a permanent System User token).',
                'Phone Number ID does not belong to the token’s WhatsApp Business Account.',
              ],
        troubleshootingSteps: res.ok
          ? ['Register /api/channels/webhook in Meta App Dashboard and verify WHATSAPP_APP_SECRET.']
          : [
              'Generate a permanent System User token in Meta Business Settings with whatsapp_business_messaging permission.',
              'Set WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, and WHATSAPP_APP_SECRET on the server.',
            ],
        testedAtIso: nowIso,
      },
      {
        status: !res.configured ? 503 : res.ok ? 200 : 502,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  if (provider === 'ai') {
    const aiRes = await testGeminiReadiness();
    void updateChannelConnectionStatus('aiSupport', {
      lastTestedAtIso: nowIso,
      ...(aiRes.ok ? { lastConnectedAtIso: nowIso, lastError: '' } : { lastError: aiRes.error }),
    }).catch(() => {});

    return NextResponse.json(
      {
        provider,
        ...aiRes,
        status: !aiRes.configured ? 'not_configured' : aiRes.ok ? 'success' : 'failed',
        whatTested: `Google Gemini model metadata availability check for ${aiRes.model}.`,
        possibleReasons: aiRes.ok
          ? []
          : !aiRes.configured
            ? ['GEMINI_API_KEY is missing; chatbot currently uses deterministic DB fallback replies.']
            : [
                'GEMINI_API_KEY is invalid, restricted, or quota-exhausted.',
                `Model "${aiRes.model}" is unavailable for this API key.`,
              ],
        troubleshootingSteps: aiRes.ok
          ? ['Test a live customer question in the AI Chatbot Studio playground to verify tone & grounding.']
          : [
              'Create a Gemini API key in Google AI Studio and set GEMINI_API_KEY in server env.',
              'Verify GEMINI_CHAT_MODEL uses an active supported model (default: gemini-2.5-flash).',
            ],
        testedAtIso: nowIso,
      },
      {
        status: !aiRes.configured ? 503 : aiRes.ok ? 200 : 502,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  if (provider === 'firestore') {
    const sdk = await checkAdminSdkReadiness();
    return NextResponse.json(
      {
        provider,
        ok: sdk.ok,
        configured: sdk.ok,
        status: sdk.ok ? 'success' : 'failed',
        databaseId: sdk.databaseId,
        projectId: sdk.projectId,
        whatTested: `Firebase Admin SDK ADC/IAM read probe against named Firestore database (${sdk.databaseId}).`,
        detail: sdk.ok
          ? sdk.detail || `Connected to Firestore database ${sdk.databaseId} (${sdk.projectId}).`
          : sdk.detail || 'Firestore Admin SDK is unavailable.',
        error: sdk.ok ? undefined : `${sdk.code}: ${sdk.detail}`,
        possibleReasons: sdk.ok
          ? []
          : [
              'Cloud Run service account is missing roles/datastore.user or roles/firebase.sdkAdminServiceAgent.',
              'AI Studio preview runtime lacks ADC/IAM bindings until deployed to Cloud Run.',
            ],
        troubleshootingSteps: sdk.ok
          ? ['All server-side orders, settings, chatbot logs, and notification queues can persist safely.']
          : [
              'Grant roles/datastore.user on the Cloud Run service account in GCP IAM.',
              'Ensure the named Firestore database ID matches firebase-applet-config.json.',
            ],
        testedAtIso: nowIso,
      },
      {
        status: sdk.ok ? 200 : 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  if (provider === 'meta') {
    const appSecret = String(process.env.META_APP_SECRET || '').trim();
    const verifyToken = String(process.env.META_VERIFY_TOKEN || '').trim();
    const pageToken = String(process.env.META_PAGE_ACCESS_TOKEN || '').trim();
    const configured = appSecret.length >= 8 && verifyToken.length >= 4;

    if (!configured) {
      return NextResponse.json(
        {
          provider,
          ok: false,
          configured: false,
          status: 'not_configured',
          whatTested: 'Meta Messenger & Instagram webhook credential readiness (META_APP_SECRET, META_VERIFY_TOKEN).',
          error: 'Meta webhook credentials (META_APP_SECRET and META_VERIFY_TOKEN) are not configured.',
          possibleReasons: [
            'META_APP_SECRET and META_VERIFY_TOKEN are not set in the server environment.',
          ],
          troubleshootingSteps: [
            'Copy your App Secret from Meta Developer App → Settings → Basic.',
            'Generate a random verify token and set META_APP_SECRET, META_VERIFY_TOKEN, and META_PAGE_ACCESS_TOKEN.',
            'Register /api/channels/webhook in Meta Webhooks for Messenger & Instagram messaging events.',
          ],
          testedAtIso: nowIso,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (pageToken.length >= 10) {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v20.0/me?fields=id,name`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${pageToken}` },
            cache: 'no-store',
          }
        );
        const data = (await res.json().catch(() => ({}))) as {
          id?: string;
          name?: string;
          error?: { message?: string };
        };
        if (!res.ok) {
          return NextResponse.json(
            {
              provider,
              ok: false,
              configured: true,
              status: 'failed',
              whatTested: 'Meta Graph /me read-only verification using META_PAGE_ACCESS_TOKEN.',
              error: `Meta Graph HTTP ${res.status}: ${sanitizeNotificationError(data.error?.message || 'Unauthorized')}`,
              possibleReasons: [
                'META_PAGE_ACCESS_TOKEN expired or lacks pages_messaging / instagram_manage_messages.',
              ],
              troubleshootingSteps: [
                'Regenerate a long-lived Page Access Token in Meta Business Settings and update META_PAGE_ACCESS_TOKEN.',
              ],
              testedAtIso: nowIso,
            },
            { status: 502, headers: { 'Cache-Control': 'no-store' } }
          );
        }
        return NextResponse.json(
          {
            provider,
            ok: true,
            configured: true,
            status: 'success',
            pageName: data.name,
            whatTested: 'Meta Webhook signature config + live Graph /me page token verification.',
            detail: `Connected to Meta Page "${data.name || data.id}" with webhook verification enabled.`,
            possibleReasons: [],
            troubleshootingSteps: ['Verify /api/channels/webhook is subscribed to messages in Meta App Dashboard.'],
            testedAtIso: nowIso,
          },
          { status: 200, headers: { 'Cache-Control': 'no-store' } }
        );
      } catch (err) {
        return NextResponse.json(
          {
            provider,
            ok: false,
            configured: true,
            status: 'failed',
            whatTested: 'Meta Graph /me read-only verification.',
            error: sanitizeNotificationError(err instanceof Error ? err.message : 'Meta Graph request failed'),
            possibleReasons: ['Outbound network error reaching graph.facebook.com.'],
            troubleshootingSteps: ['Check Cloud Run outbound internet connectivity and retry.'],
            testedAtIso: nowIso,
          },
          { status: 502, headers: { 'Cache-Control': 'no-store' } }
        );
      }
    }

    return NextResponse.json(
      {
        provider,
        ok: true,
        configured: true,
        status: 'success',
        whatTested: 'Meta Webhook signature verification readiness (META_APP_SECRET & META_VERIFY_TOKEN).',
        detail:
          'Inbound webhook verification is configured. Set META_PAGE_ACCESS_TOKEN to enable outbound Messenger/Instagram replies.',
        possibleReasons: [],
        troubleshootingSteps: [
          'Optional: set META_PAGE_ACCESS_TOKEN if you want the AI support engine to send automated replies back to Messenger/Instagram.',
        ],
        testedAtIso: nowIso,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (provider === 'payments') {
    const gateway = String(body.gateway || 'all').trim().toLowerCase();
    const readiness = getPaymentGatewayReadiness();
    const targetSsl = gateway === 'sslcommerz' || gateway === 'all';
    const targetBkash = gateway === 'bkash' || gateway === 'all';

    if ((gateway === 'sslcommerz' && !readiness.sslcommerz.configured) ||
        (gateway === 'bkash' && !readiness.bkash.configured) ||
        (gateway === 'all' && !readiness.anyConfigured)) {
      return NextResponse.json(
        {
          provider,
          gateway,
          ok: false,
          configured: false,
          status: 'not_configured',
          whatTested: 'Online payment gateway server credential readiness (SSLCommerz & bKash Tokenized Checkout).',
          error:
            gateway === 'sslcommerz'
              ? 'SSLCommerz is not configured (set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWD).'
              : gateway === 'bkash'
                ? 'bKash Tokenized Checkout is not configured (set BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD).'
                : 'Neither SSLCommerz nor bKash Tokenized Checkout is configured on the server.',
          possibleReasons: [
            'Merchant API credentials have not been added to Cloud Run environment variables yet.',
          ],
          troubleshootingSteps: [
            'For SSLCommerz: set SSLCOMMERZ_STORE_ID, SSLCOMMERZ_STORE_PASSWD, and SSLCOMMERZ_IS_LIVE=false (sandbox) or true.',
            'For bKash: set BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD, and BKASH_IS_LIVE.',
            'Note: Manual bKash/Nagad storefront numbers in Store Settings work independently of automated gateway APIs.',
          ],
          testedAtIso: nowIso,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Safe read-only token grant test for bKash when configured (does NOT create a payment or charge)
    if (targetBkash && readiness.bkash.configured && gateway === 'bkash') {
      const baseUrl = readiness.bkash.liveMode
        ? 'https://tokenized.pay.bka.sh/v1.2.0-beta'
        : 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
      try {
        const res = await fetch(`${baseUrl}/tokenized/checkout/token/grant`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            username: (process.env.BKASH_USERNAME || '').trim(),
            password: (process.env.BKASH_PASSWORD || '').trim(),
          },
          body: JSON.stringify({
            app_key: (process.env.BKASH_APP_KEY || '').trim(),
            app_secret: (process.env.BKASH_APP_SECRET || '').trim(),
          }),
          cache: 'no-store',
        });
        const data = (await res.json().catch(() => ({}))) as {
          id_token?: string;
          statusMessage?: string;
        };
        if (!res.ok || !data.id_token) {
          return NextResponse.json(
            {
              provider,
              gateway: 'bkash',
              ok: false,
              configured: true,
              status: 'failed',
              whatTested: `bKash ${readiness.bkash.liveMode ? 'Live' : 'Sandbox'} read-only token/grant authentication (zero charge).`,
              error: sanitizeNotificationError(
                data.statusMessage || `bKash auth failed (HTTP ${res.status})`
              ),
              possibleReasons: [
                'bKash username, password, app key, or app secret does not match the selected Sandbox/Live mode.',
                'Server IP is not whitelisted by bKash merchant support.',
              ],
              troubleshootingSteps: [
                'Verify BKASH_IS_LIVE matches whether your credentials are Sandbox or Production.',
                'Confirm credentials with bKash PGW merchant portal.',
              ],
              testedAtIso: nowIso,
            },
            { status: 502, headers: { 'Cache-Control': 'no-store' } }
          );
        }
        return NextResponse.json(
          {
            provider,
            gateway: 'bkash',
            ok: true,
            configured: true,
            status: 'success',
            whatTested: `bKash ${readiness.bkash.liveMode ? 'Live' : 'Sandbox'} read-only token/grant authentication (zero charge).`,
            detail: `bKash ${readiness.bkash.liveMode ? 'Live' : 'Sandbox'} authentication succeeded without creating any charge.`,
            possibleReasons: [],
            troubleshootingSteps: ['Run a small sandbox checkout to test the /api/payments/callback redirect end-to-end.'],
            testedAtIso: nowIso,
          },
          { status: 200, headers: { 'Cache-Control': 'no-store' } }
        );
      } catch (err) {
        return NextResponse.json(
          {
            provider,
            gateway: 'bkash',
            ok: false,
            configured: true,
            status: 'failed',
            whatTested: 'bKash token/grant authentication.',
            error: sanitizeNotificationError(err instanceof Error ? err.message : 'bKash network error'),
            possibleReasons: ['Unable to reach bKash tokenized checkout API.'],
            troubleshootingSteps: ['Retry in a moment or verify network egress rules.'],
            testedAtIso: nowIso,
          },
          { status: 502, headers: { 'Cache-Control': 'no-store' } }
        );
      }
    }

    const activeSummary = [
      targetSsl && readiness.sslcommerz.configured
        ? `SSLCommerz (${readiness.sslcommerz.liveMode ? 'Live' : 'Sandbox'})`
        : null,
      targetBkash && readiness.bkash.configured
        ? `bKash (${readiness.bkash.liveMode ? 'Live' : 'Sandbox'})`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return NextResponse.json(
      {
        provider,
        gateway,
        ok: true,
        configured: true,
        status: 'success',
        whatTested: 'Payment gateway server credentials, mode flags, and callback route readiness.',
        detail: `Configured: ${activeSummary}. Safe diagnostic does not initiate live monetary transactions (SSLCommerz has no charge-free ping endpoint).`,
        possibleReasons: [],
        troubleshootingSteps: [
          'Verify NEXT_PUBLIC_SITE_URL points to your HTTPS production domain so /api/payments/callback receives IPN callbacks.',
        ],
        testedAtIso: nowIso,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (provider === 'couriers') {
    const readiness = getCourierApiReadiness();
    if (!readiness.anyLiveCourier) {
      return NextResponse.json(
        {
          provider,
          ok: false,
          configured: false,
          status: 'not_configured',
          whatTested: 'Bangladesh courier API credential readiness (Steadfast, Pathao, RedX) & webhook secret.',
          error: 'No live courier partner API credentials are configured on the server.',
          possibleReasons: [
            'Steadfast, Pathao, and RedX API credentials have not been set in server environment variables.',
          ],
          troubleshootingSteps: [
            'Steadfast: set STEADFAST_API_KEY and STEADFAST_SECRET_KEY.',
            'Pathao: set PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET, PATHAO_USERNAME, PATHAO_PASSWORD, PATHAO_STORE_ID, and PATHAO_CITY_ZONE_MAP_JSON.',
            'RedX: set REDX_API_TOKEN and REDX_AREA_ID_MAP_JSON.',
            'Set COURIER_WEBHOOK_SECRET (12+ chars) so /api/couriers/webhook authenticates courier status callbacks.',
          ],
          testedAtIso: nowIso,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const active = [
      readiness.steadfast ? 'Steadfast' : null,
      readiness.pathao ? 'Pathao' : null,
      readiness.redx ? 'RedX' : null,
    ]
      .filter(Boolean)
      .join(', ');

    return NextResponse.json(
      {
        provider,
        ok: true,
        configured: true,
        status: 'success',
        whatTested: 'Courier API credential validation & webhook secret check (no real parcel booked).',
        detail: `Ready partners: ${active}. Webhook auth secret: ${readiness.webhookSecret ? 'Configured' : 'Not set (recommended)'}. Live booking is skipped during safe diagnostics so no dummy parcel is created.`,
        possibleReasons: [],
        troubleshootingSteps: readiness.webhookSecret
          ? ['You can book real parcels from any confirmed order inside the Orders tab.']
          : ['Set COURIER_WEBHOOK_SECRET so courier status updates to /api/couriers/webhook are verified.'],
        testedAtIso: nowIso,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (provider === 'email') {
    const messaging = getMessagingGatewayReadiness();
    if (!messaging.resendEmail) {
      return NextResponse.json(
        {
          provider,
          ok: false,
          configured: false,
          status: 'not_configured',
          whatTested: 'Direct transactional email readiness (Resend API).',
          error: 'Resend email is not configured (set RESEND_API_KEY and RESEND_FROM_EMAIL).',
          possibleReasons: ['RESEND_API_KEY or verified RESEND_FROM_EMAIL is not set on the server.'],
          troubleshootingSteps: [
            'Create an API key at resend.com and verify your sending domain.',
            'Set RESEND_API_KEY, RESEND_FROM_EMAIL, and OWNER_NOTIFICATION_EMAIL on the server.',
          ],
          testedAtIso: nowIso,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (body.sendTestEmail === true) {
      const rules = await fetchNotificationRules().catch(() => null);
      // Admin-only test target: never allow arbitrary customer/external email addresses in diagnostic tests.
      const targetEmail =
        String(rules?.ownerNotificationEmailOverride || '').trim() ||
        String(process.env.OWNER_NOTIFICATION_EMAIL || '').trim() ||
        admin.email;
      const sendRes = await sendDirectEmail({
        toEmail: targetEmail,
        subject: '[Deshi Gee] Admin Diagnostic Test Email',
        text: `This is a live diagnostic email triggered from the Deshi Gee Admin Console at ${nowIso}. Resend email delivery is working properly.`,
      });
      const ok = sendRes.status === 'sent';
      return NextResponse.json(
        {
          provider,
          ok,
          configured: true,
          status: ok ? 'success' : 'failed',
          whatTested: `Live Resend API email dispatch to ${targetEmail}.`,
          detail: sendRes.detail,
          error: ok ? undefined : sendRes.detail,
          possibleReasons: ok
            ? []
            : ['Sender domain in RESEND_FROM_EMAIL is not verified in Resend.', 'RESEND_API_KEY is invalid.'],
          troubleshootingSteps: ok
            ? ['Check the inbox (and spam folder) of the recipient email address.']
            : ['Verify domain DNS records in Resend Dashboard and retest.'],
          testedAtIso: nowIso,
        },
        { status: ok ? 200 : 502, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(
      {
        provider,
        ok: true,
        configured: true,
        status: 'success',
        whatTested: 'Resend API credential presence check.',
        detail: 'RESEND_API_KEY and RESEND_FROM_EMAIL are configured. Use "Send Test Email" to verify inbox delivery.',
        possibleReasons: [],
        troubleshootingSteps: ['Click "Send Test Email" to confirm real delivery to your owner inbox.'],
        testedAtIso: nowIso,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (provider === 'sms') {
    const messaging = getMessagingGatewayReadiness();
    if (!messaging.anyDirectSms) {
      return NextResponse.json(
        {
          provider,
          ok: false,
          configured: false,
          status: 'not_configured',
          whatTested: 'Direct SMS gateway credential readiness (BulkSMSBD / Twilio).',
          error: 'Neither BulkSMSBD nor Twilio SMS is configured on the server.',
          possibleReasons: ['SMS provider credentials are not set in server environment variables.'],
          troubleshootingSteps: [
            'BulkSMSBD: set BULKSMSBD_API_KEY and BULKSMSBD_SENDER_ID.',
            'Twilio: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.',
          ],
          testedAtIso: nowIso,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const activeSms = [
      messaging.bulksmsbd ? 'BulkSMSBD' : null,
      messaging.twilioSms ? 'Twilio SMS' : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return NextResponse.json(
      {
        provider,
        ok: true,
        configured: true,
        status: 'success',
        whatTested: 'Direct SMS gateway credential validation (zero SMS credits spent).',
        detail: `Configured SMS gateway: ${activeSms}. Diagnostic skips sending a live SMS automatically so your SMS balance is not consumed.`,
        possibleReasons: [],
        troubleshootingSteps: ['Verify your SMS account balance and approved Sender ID in the provider portal.'],
        testedAtIso: nowIso,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (provider === 'storefront_display') {
    const { settings, source } = await fetchServerStoreSettingsWithMeta();
    const orderingReady = isStorefrontOrderingReady(settings);
    const p250 = getConfirmedPriceForWeight(settings, '250g');
    const p500 = getConfirmedPriceForWeight(settings, '500g');
    const p1kg = getConfirmedPriceForWeight(settings, '1kg');
    const hasContact = hasValidRealPhone(settings.whatsappNumber) || hasValidRealPhone(settings.supportPhone);

    return NextResponse.json(
      {
        provider,
        ok: orderingReady,
        configured: source === 'firestore',
        status: orderingReady ? 'success' : 'failed',
        source,
        orderingReady,
        whatTested: 'Live Storefront Settings projection (confirmed prices, stock, delivery fees, contact readiness).',
        detail: orderingReady
          ? `Storefront ordering is LIVE (${[p250 ? '250g' : null, p500 ? '500g' : null, p1kg ? '1kg' : null].filter(Boolean).join(', ')} priced · Contact ${hasContact ? 'set' : 'missing'}).`
          : `Storefront is safely showing "Ordering Temporarily Unavailable" (source: ${source}). Set at least one jar price and base delivery fee in Product, Stock & Delivery.`,
        error: orderingReady
          ? undefined
          : 'Storefront ordering is not yet live (confirmed jar price and base delivery fee required).',
        possibleReasons: orderingReady
          ? []
          : [
              'No jar price (250g / 500g / 1kg) or base delivery fee has been saved yet.',
              source !== 'firestore' ? 'Firestore Admin SDK is unavailable so safe defaults are active.' : '',
            ].filter(Boolean),
        troubleshootingSteps: orderingReady
          ? ['Open the storefront homepage in a new tab to visually verify jar prices and checkout.']
          : ['Open the Product, Stock & Delivery tab, enter prices & delivery fees, review the Frontend Impact Preview, and click Save.'],
        testedAtIso: nowIso,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // provider === 'template_test'
  const rawEventType = String(body.eventType || 'ORDER_CREATED').trim();
  const eventType: BusinessEventType = isValidBusinessEventType(rawEventType)
    ? rawEventType
    : 'ORDER_CREATED';
  const channel = String(body.channel || 'telegram').trim().toLowerCase();
  const sampleEvent = SAMPLE_EVENT_PAYLOADS[eventType];
  const rawTpl =
    body.templateOverride && typeof body.templateOverride === 'object'
      ? (body.templateOverride as NotificationTemplateOverride)
      : undefined;

  if (channel === 'telegram') {
    const settings = await fetchIntegrationSettings().catch(() => null);
    const res = await sendTelegramEventNotification(sampleEvent, {
      chatIdsOverride: settings?.telegram.chatIdsOverride,
      templateOverride: rawTpl,
    });
    return NextResponse.json(
      {
        provider,
        channel,
        eventType,
        ...res,
        renderedTitle: rawTpl?.titleTemplate
          ? renderNotificationTemplate(rawTpl.titleTemplate, sampleEvent)
          : sampleEvent.title || eventType,
        renderedBody: rawTpl?.bodyTemplate
          ? renderNotificationTemplate(rawTpl.bodyTemplate, sampleEvent)
          : sampleEvent.summary || '',
        status: !res.configured ? 'not_configured' : res.ok ? 'success' : 'failed',
        whatTested: `Custom template test dispatch for ${eventType} via Telegram.`,
        possibleReasons: res.ok ? [] : ['Telegram credentials are not configured or chat ID rejected the message.'],
        troubleshootingSteps: res.ok
          ? ['Inspect the received Telegram alert to verify wording and variable formatting.']
          : ['Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID before sending live test alerts.'],
        testedAtIso: nowIso,
      },
      {
        status: !res.configured ? 503 : res.ok ? 200 : 502,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  if (channel === 'discord') {
    const channelKey = mapEventToDiscordChannel(eventType);
    const res = await sendDiscordEventNotification(sampleEvent, {
      channelKeyOverride: channelKey,
      templateOverride: rawTpl,
    });
    return NextResponse.json(
      {
        provider,
        channel,
        eventType,
        ...res,
        renderedTitle: rawTpl?.titleTemplate
          ? renderNotificationTemplate(rawTpl.titleTemplate, sampleEvent)
          : sampleEvent.title || eventType,
        renderedBody: rawTpl?.bodyTemplate
          ? renderNotificationTemplate(rawTpl.bodyTemplate, sampleEvent)
          : sampleEvent.summary || '',
        status: !res.configured ? 'not_configured' : res.ok ? 'success' : 'failed',
        whatTested: `Custom template test dispatch for ${eventType} via Discord (#${channelKey}).`,
        possibleReasons: res.ok ? [] : [`No Discord webhook configured for #${channelKey}.`],
        troubleshootingSteps: res.ok
          ? [`Check #${channelKey} in Discord to verify your custom embed title and body.`]
          : ['Set DISCORD_WEBHOOK_URL or the channel-specific webhook env var and retest.'],
        testedAtIso: nowIso,
      },
      {
        status: !res.configured ? 503 : res.ok ? 200 : 502,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      code: 'unsupported_template_test_channel',
      error:
        'Template live tests are restricted to admin channels ("telegram" or "discord") only and are never dispatched to customers. Use the Live Preview for WhatsApp/Email templates.',
    },
    { status: 400, headers: { 'Cache-Control': 'no-store' } }
  );
}
