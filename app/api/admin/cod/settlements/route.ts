import { validateSettlementInput } from '../../../../../src/lib/cod/settlement';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../../src/lib/server/adminApi';
import { createSettlement } from '../../../../../src/lib/server/codRepository';

export const dynamic = 'force-dynamic';

/** POST /api/admin/cod/settlements — record a courier payout against selected collected orders. */
export async function POST(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'cod.manage' });
  if ('response' in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = validateSettlementInput(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  try {
    const result = await createSettlement(parsed.value, auth.actor);
    if (!result.ok) return jsonError(result.error, result.status);
    return jsonOk({ settlement: result.settlement }, 201);
  } catch (err) {
    return handleAdminError(err);
  }
}
