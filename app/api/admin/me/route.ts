import { permissionsForRole } from '../../../../src/lib/auth/permissions';
import { jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';

export const dynamic = 'force-dynamic';

/** GET /api/admin/me — who am I and what may I do? (any owner or active staff member) */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;
  const { email, role } = auth.actor;
  return jsonOk({ email, role, permissions: permissionsForRole(role) });
}
