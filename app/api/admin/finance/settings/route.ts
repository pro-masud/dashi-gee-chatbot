import { validateFinanceSettings } from '../../../../../src/lib/finance/profit';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../../src/lib/server/adminApi';
import { saveFinanceSettings } from '../../../../../src/lib/server/financeRepository';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/admin/finance/settings — save cost-of-goods per jar size.
 * New orders snapshot these costs; existing orders are never rewritten.
 */
export async function PUT(request: Request) {
  const auth = await requireAdmin(request, { mutation: true });
  if ('response' in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = validateFinanceSettings(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  try {
    const settings = await saveFinanceSettings(parsed.value, auth.actor);
    return jsonOk({ settings });
  } catch (err) {
    return handleAdminError(err);
  }
}
