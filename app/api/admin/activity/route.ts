import { handleAdminError, jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';
import { listActivity } from '../../../../src/lib/server/staffRepository';

export const dynamic = 'force-dynamic';

/** GET /api/admin/activity?limit=200 — recent audit trail (read-only; entries can never be edited here). */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { permission: 'logs.view' });
  if ('response' in auth) return auth.response;
  const limit = Number(new URL(request.url).searchParams.get('limit') || 200);
  try {
    return jsonOk({ entries: await listActivity(Number.isFinite(limit) ? limit : 200) });
  } catch (err) {
    return handleAdminError(err);
  }
}
