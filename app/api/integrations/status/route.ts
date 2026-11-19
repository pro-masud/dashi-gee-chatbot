import { NextResponse } from 'next/server';
import {
  isGeminiApiKeyConfigured,
  isOrderTokenSecretConfigured,
} from '../../../../src/lib/gemini/client';
import { getCourierApiReadiness } from '../../../../src/lib/integrations/courierApi';
import { getMessagingGatewayReadiness } from '../../../../src/lib/integrations/messagingGateway';
import { getPaymentGatewayReadiness } from '../../../../src/lib/integrations/paymentGateway';

export const dynamic = 'force-dynamic';

export async function GET() {
  const payments = getPaymentGatewayReadiness();
  const couriers = getCourierApiReadiness();
  const messaging = getMessagingGatewayReadiness();

  const whatsappCloud =
    (process.env.WHATSAPP_APP_SECRET || '').trim().length >= 8 &&
    (process.env.WHATSAPP_ACCESS_TOKEN || '').trim().length >= 10 &&
    (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim().length >= 4;
  const metaMessengerInstagram =
    (process.env.META_APP_SECRET || '').trim().length >= 8 &&
    (process.env.META_VERIFY_TOKEN || '').trim().length >= 4;
  const cronSecret = (process.env.CRON_SECRET || '').trim().length >= 16;

  return NextResponse.json(
    {
      ok: true,
      payments,
      couriers,
      messaging: {
        ...messaging,
        ownerWebhook: Boolean(process.env.OWNER_WEBHOOK_URL),
        whatsappWebhook: Boolean(process.env.WHATSAPP_WEBHOOK_URL),
        emailWebhook: Boolean(process.env.EMAIL_WEBHOOK_URL),
        googleSheetsWebhook: Boolean(process.env.GOOGLE_SHEETS_WEBHOOK_URL),
      },
      omnichannel: {
        whatsappCloud,
        metaMessengerInstagram,
      },
      ai: {
        geminiConfigured: isGeminiApiKeyConfigured(),
        geminiTtsReady: isGeminiApiKeyConfigured(),
        ttsModel: 'gemini-3.8-flash-lite-tts',
      },
      security: {
        orderTokenSecretStrong: isOrderTokenSecretConfigured(),
        cronSecretConfigured: cronSecret,
        siteUrlConfigured:
          Boolean((process.env.NEXT_PUBLIC_SITE_URL || '').trim()) &&
          !(process.env.NEXT_PUBLIC_SITE_URL || '').includes('localhost'),
      },
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
