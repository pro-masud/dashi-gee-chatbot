import { computeProfitReport, enumerateDateKeys, isValidDateKey } from '../../../../src/lib/finance/profit';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';
import {
  getFinanceSettings,
  listExpenses,
  listOrdersForProfit,
} from '../../../../src/lib/server/financeRepository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/finance?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns daily profit rows, totals, the expenses in range and the COGS settings.
 * Range is capped at 93 days.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  const url = new URL(request.url);
  const from = String(url.searchParams.get('from') || '');
  const to = String(url.searchParams.get('to') || '');
  if (!isValidDateKey(from) || !isValidDateKey(to) || from > to) {
    return jsonError('Provide a valid from/to date range (YYYY-MM-DD).', 400);
  }
  if (enumerateDateKeys(from, to, 94).length > 93) {
    return jsonError('Date range cannot exceed 93 days.', 400);
  }

  try {
    const [orders, expenses, settings] = await Promise.all([
      listOrdersForProfit(from, to),
      listExpenses(from, to),
      getFinanceSettings(),
    ]);
    const report = computeProfitReport({ orders, expenses, from, to });
    return jsonOk({ report, expenses, settings });
  } catch (err) {
    return handleAdminError(err);
  }
}
