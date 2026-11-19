import { NextResponse } from 'next/server';
import { notificationLogs } from '../../../../src/lib/serverState';
import { getMessagingGatewayReadiness } from '../../../../src/lib/integrations/messagingGateway';

export async function GET() {
  const direct = getMessagingGatewayReadiness();
  return NextResponse.json({
    configuredChannels: {
      ownerWebhook: Boolean(process.env.OWNER_WEBHOOK_URL),
      googleSheets: Boolean(process.env.GOOGLE_SHEETS_WEBHOOK_URL),
      whatsapp: Boolean(process.env.WHATSAPP_WEBHOOK_URL),
      email: Boolean(process.env.EMAIL_WEBHOOK_URL),
      bulksmsbd: direct.bulksmsbd,
      twilioSms: direct.twilioSms,
      resendEmail: direct.resendEmail,
    },
    recentLogs: notificationLogs.slice(0, 15),
  });
}
