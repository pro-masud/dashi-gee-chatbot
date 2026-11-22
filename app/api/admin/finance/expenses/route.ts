import { validateExpenseInput } from '../../../../../src/lib/finance/profit';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../../src/lib/server/adminApi';
import { createExpense, deleteExpense } from '../../../../../src/lib/server/financeRepository';

export const dynamic = 'force-dynamic';

/** POST /api/admin/finance/expenses — create one expense entry. */
export async function POST(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'finance.manage' });
  if ('response' in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = validateExpenseInput(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  try {
    const expense = await createExpense(parsed.value, auth.actor);
    return jsonOk({ expense }, 201);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** DELETE /api/admin/finance/expenses?id=<expenseId> — delete one entry (audit-logged). */
export async function DELETE(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'finance.manage' });
  if ('response' in auth) return auth.response;

  const id = String(new URL(request.url).searchParams.get('id') || '').trim();
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return jsonError('Invalid expense id.', 400);

  try {
    const removed = await deleteExpense(id, auth.actor);
    if (!removed) return jsonError('Expense not found.', 404);
    return jsonOk({ id });
  } catch (err) {
    return handleAdminError(err);
  }
}
