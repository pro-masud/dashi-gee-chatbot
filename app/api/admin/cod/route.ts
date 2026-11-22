import { computeCodSummary, eligibleForSettlement } from '../../../../src/lib/cod/settlement';
import { handleAdminError, jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';
import { listCodOrders, listSettlements } from '../../../../src/lib/server/codRepository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/cod
 * COD money overview: in transit, awaiting collection, collected-but-unsettled, settled, disputed,
 * plus the orders eligible for a new settlement and the settlement history.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { permission: 'cod.manage' });
  if ('response' in auth) return auth.response;

  try {
    const [orders, settlements] = await Promise.all([listCodOrders(), listSettlements(50)]);
    return jsonOk({
      summary: computeCodSummary(orders),
      eligible: eligibleForSettlement(orders),
      settlements,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}
