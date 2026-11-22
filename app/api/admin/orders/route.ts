import { handleAdminError, jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';
import { listOrdersForAdmin } from '../../../../src/lib/server/ordersAdminRepository';

export const dynamic = 'force-dynamic';

/** GET /api/admin/orders?limit=500 — recent orders for the admin list (owner and staff with orders.view). */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { permission: 'orders.view' });
  if ('response' in auth) return auth.response;
  const limit = Number(new URL(request.url).searchParams.get('limit') || 500);
  try {
    return jsonOk({ orders: await listOrdersForAdmin(Number.isFinite(limit) ? limit : 500) });
  } catch (err) {
    return handleAdminError(err);
  }
}
