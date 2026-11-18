import { NextResponse } from 'next/server';
import { notificationLogs } from '../../../../src/lib/serverState';

export async function GET() {
  return NextResponse.json({
    configuredChannels: {
      ownerWebhook: Boolean(process.env.OWNER_WEBHOOK_URL),
      googleSheets: Boolean(process.env.GOOGLE_SHEETS_WEBHOOK_URL),
      whatsapp: Boolean(process.env.WHATSAPP_WEBHOOK_URL),
      email: Boolean(process.env.EMAIL_WEBHOOK_URL),
    },
    recentLogs: notificationLogs.slice(0, 15),
  });
}
