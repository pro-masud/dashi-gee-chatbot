import { verifyServerAdminToken } from '../../../../src/lib/chatbot/firestoreRest';
import { buildRuntimeHealthReport } from '../../../../src/lib/chatbot/runtimeHealth';
import { getTodayBstDateKey } from '../../../../src/lib/chatbot/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const adminCheck = await verifyServerAdminToken(request.headers.get('authorization'));
  if (!adminCheck.ok) {
    return Response.json({ error: 'Unauthorized admin request.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const bypassCache = url.searchParams.get('refresh') === '1';
  const health = await buildRuntimeHealthReport({ bypassCache });

  return Response.json(
    {
      ok: true,
      adminEmail: adminCheck.email,
      geminiConfigured: health.checks.geminiApiKeyOk,
      model: health.checks.primaryModel.name,
      fallbackModel: health.checks.fallbackModel.name,
      activePath: health.activePath,
      health,
      bstDate: getTodayBstDateKey(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
