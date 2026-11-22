import { handleAdminError, jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';
import { getOrderSignal } from '../../../../src/lib/server/ordersAdminRepository';

export const dynamic = 'force-dynamic';

/** GET /api/admin/signal — lightweight order counter for new-order alerts (polled by the dashboard). */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { permission: 'orders.view' });
  if ('response' in auth) return auth.response;
  try {
    return jsonOk({ signal: await getOrderSignal() });
  } catch (err) {
    return handleAdminError(err);
  }
}
