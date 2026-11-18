import {
  fetchPhase5AttributionAnalyticsSnapshot,
  verifyServerAdminToken,
} from '../../../../src/lib/chatbot/firestoreRest';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const adminCheck = await verifyServerAdminToken(authHeader);
  if (!adminCheck.ok) {
    return Response.json(
      { ok: false, error: 'Admin authentication required.' },
      { status: 401 }
    );
  }

  const adminToken = authHeader ? authHeader.slice(7).trim() : undefined;
  const analytics = await fetchPhase5AttributionAnalyticsSnapshot(adminToken);

  return Response.json({
    ok: true,
    analytics,
    channelIntegration: {
      metaVerifyConfigured: Boolean(String(process.env.META_VERIFY_TOKEN || '').trim()),
      metaWebhookSecretConfigured: Boolean(String(process.env.META_APP_SECRET || '').trim()),
      metaPageTokenConfigured: Boolean(String(process.env.META_PAGE_ACCESS_TOKEN || '').trim()),
      whatsappSecretConfigured: Boolean(
        String(process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET || '').trim()
      ),
      whatsappTokenConfigured: Boolean(
        String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim() &&
          String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim()
      ),
    },
  });
}
