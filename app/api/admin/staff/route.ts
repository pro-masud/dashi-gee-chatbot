import { isRole, validateStaffInput, ASSIGNABLE_ROLES } from '../../../../src/lib/auth/permissions';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';
import { addStaff, listStaff, updateStaff } from '../../../../src/lib/server/staffRepository';

export const dynamic = 'force-dynamic';

/** GET /api/admin/staff — list staff (owner only). */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { permission: 'staff.manage' });
  if ('response' in auth) return auth.response;
  try {
    return jsonOk({ staff: await listStaff() });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** POST /api/admin/staff — add a staff member by email + role (owner only). */
export async function POST(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'staff.manage' });
  if ('response' in auth) return auth.response;

  const parsed = validateStaffInput(await request.json().catch(() => null));
  if (!parsed.ok) return jsonError(parsed.error, 400);

  try {
    const result = await addStaff(parsed.value, auth.actor);
    if (!result.ok) return jsonError(result.error, result.status);
    return jsonOk({ staff: result.staff }, 201);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** PATCH /api/admin/staff — change role or deactivate (owner only). Body: { uid, role?, active? } */
export async function PATCH(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'staff.manage' });
  if ('response' in auth) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const uid = String(body?.uid || '').trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) return jsonError('Invalid staff id.', 400);

  const patch: { role?: (typeof ASSIGNABLE_ROLES)[number]; active?: boolean } = {};
  if (body?.role !== undefined) {
    if (!isRole(body.role) || !ASSIGNABLE_ROLES.includes(body.role)) return jsonError('Invalid role.', 400);
    patch.role = body.role;
  }
  if (body?.active !== undefined) {
    if (typeof body.active !== 'boolean') return jsonError('active must be true or false.', 400);
    patch.active = body.active;
  }
  if (patch.role === undefined && patch.active === undefined) return jsonError('Nothing to update.', 400);

  try {
    const result = await updateStaff(uid, patch, auth.actor);
    if (!result.ok) return jsonError(result.error, result.status);
    return jsonOk({ staff: result.staff });
  } catch (err) {
    return handleAdminError(err);
  }
}
