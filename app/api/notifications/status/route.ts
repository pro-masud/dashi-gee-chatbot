import { NextResponse } from 'next/server';
import { verifyServerAdminToken } from '../../../../src/lib/chatbot/firestoreRest';
import { notificationLogs } from '../../../../src/lib/serverState';
import { getMessagingGatewayReadiness } from '../../../../src/lib/integrations/messagingGateway';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const adminCheck = await verifyServerAdminToken(request.headers.get('authorization'));
  if (!adminCheck.ok) {
    return NextResponse.json(
      { ok: false, error: 'Admin authorization required.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const direct = getMessagingGatewayReadiness();
  return NextResponse.json(
    {
      ok: true,
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
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
