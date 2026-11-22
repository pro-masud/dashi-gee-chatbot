import { computeCustomers } from '../../../../src/lib/customers/customers';
import { normalizeBangladeshPhone } from '../../../../src/lib/leads/leads';
import { roleHasPermission } from '../../../../src/lib/auth/permissions';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';
import { listOrdersForAdmin, readCustomerNotes, saveCustomerNote } from '../../../../src/lib/server/ordersAdminRepository';

export const dynamic = 'force-dynamic';

/** GET /api/admin/customers — customers derived from orders (money columns only with finance.view). */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { permission: 'orders.view' });
  if ('response' in auth) return auth.response;
  try {
    const [orders, notes] = await Promise.all([listOrdersForAdmin(1000), readCustomerNotes()]);
    const customers = computeCustomers(orders, { includeMoney: roleHasPermission(auth.actor.role, 'finance.view') });
    return jsonOk({ customers, notes });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** PATCH /api/admin/customers — body: { phone, note } saves an internal note (audit-logged). */
export async function PATCH(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'orders.update' });
  if ('response' in auth) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const phone = normalizeBangladeshPhone(String(body?.phone || ''));
  if (!/^01[3-9]\d{8}$/.test(phone)) return jsonError('Invalid phone number.', 400);
  const note = String(body?.note ?? '').replace(/<[^>]*>/g, '').trim().slice(0, 600);
  try {
    await saveCustomerNote(phone, note, auth.actor);
    return jsonOk({ phone, note });
  } catch (err) {
    return handleAdminError(err);
  }
}
