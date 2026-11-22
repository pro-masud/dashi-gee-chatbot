/**
 * Pure finance logic for the Daily Profit & Expenses module.
 * No I/O here so the formulas can be unit-tested and explained to the owner.
 *
 * Net Profit = Delivered Revenue − COGS − Packaging − Courier − Advertising − Other
 *
 * - Only orders with status `delivered` count as revenue. Pending/confirmed/shipped/cancelled never do.
 * - COGS comes from the cost snapshot stored on each order at creation time (`cogsBdt`).
 * - Product-procurement expenses are shown but NOT subtracted: they are already represented by COGS,
 *   subtracting both would double count.
 * - Orders are grouped by the Asia/Dhaka calendar date they were placed on.
 * - Delivered ≠ cash received. COD settlement is tracked separately (see COD module).
 */

export const EXPENSE_TYPES = [
  'facebook_ads',
  'tiktok_ads',
  'other_marketing',
  'packaging',
  'courier',
  'procurement',
  'other',
] as const;

export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export const EXPENSE_LABELS: Record<ExpenseType, { en: string; bn: string }> = {
  facebook_ads: { en: 'Facebook / Meta Ads', bn: 'ফেসবুক / মেটা বিজ্ঞাপন' },
  tiktok_ads: { en: 'TikTok Ads', bn: 'টিকটক বিজ্ঞাপন' },
  other_marketing: { en: 'Other Marketing', bn: 'অন্যান্য মার্কেটিং' },
  packaging: { en: 'Packaging', bn: 'প্যাকেজিং' },
  courier: { en: 'Courier Charges', bn: 'কুরিয়ার চার্জ' },
  procurement: { en: 'Product Procurement', bn: 'পণ্য সংগ্রহ' },
  other: { en: 'Other Operations', bn: 'অন্যান্য খরচ' },
};

export interface ExpenseRecord {
  id: string;
  /** Asia/Dhaka calendar date, YYYY-MM-DD */
  date: string;
  type: ExpenseType;
  amountBdt: number;
  description: string;
  createdByEmail: string;
  createdAtIso: string;
}

export interface FinanceSettings {
  /** Cost of goods per jar, in BDT. 0 / undefined = not set. */
  cogs250g: number;
  cogs500g: number;
  cogs1kg: number;
}

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  cogs250g: 0,
  cogs500g: 0,
  cogs1kg: 0,
};

/** Minimal order shape needed for profit maths. */
export interface ProfitOrderInput {
  orderNumber: string;
  status: string;
  totalBdt: number;
  cogsBdt?: number;
  /** ISO timestamp of order creation */
  createdAtIso: string;
}

export interface DailyProfitRow {
  date: string;
  totalOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  grossOrderValue: number;
  deliveredRevenue: number;
  cogs: number;
  adSpend: number;
  packaging: number;
  courier: number;
  other: number;
  procurementExcluded: number;
  netProfit: number;
  /** null when there is no delivered revenue */
  marginPct: number | null;
  /** Delivered orders whose COGS snapshot is missing — profit is then an estimate. */
  ordersMissingCogs: number;
}

export interface ProfitReport {
  from: string;
  to: string;
  rows: DailyProfitRow[];
  totals: DailyProfitRow;
}

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/** YYYY-MM-DD in Asia/Dhaka (UTC+6, no DST) for an ISO timestamp or Date. */
export function dhakaDateKey(input: string | Date): string {
  const ms = (input instanceof Date ? input : new Date(input)).getTime();
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Inclusive list of date keys between from and to. */
export function enumerateDateKeys(from: string, to: string, maxDays = 366): string[] {
  if (!isValidDateKey(from) || !isValidDateKey(to) || from > to) return [];
  const out: string[] = [];
  let cursor = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  while (cursor <= end && out.length < maxDays) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 24 * 60 * 60 * 1000;
  }
  return out;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function emptyRow(date: string): DailyProfitRow {
  return {
    date,
    totalOrders: 0,
    deliveredOrders: 0,
    cancelledOrders: 0,
    grossOrderValue: 0,
    deliveredRevenue: 0,
    cogs: 0,
    adSpend: 0,
    packaging: 0,
    courier: 0,
    other: 0,
    procurementExcluded: 0,
    netProfit: 0,
    marginPct: null,
    ordersMissingCogs: 0,
  };
}

function finalizeRow(row: DailyProfitRow): DailyProfitRow {
  const net =
    row.deliveredRevenue - row.cogs - row.packaging - row.courier - row.adSpend - row.other;
  return {
    ...row,
    grossOrderValue: round2(row.grossOrderValue),
    deliveredRevenue: round2(row.deliveredRevenue),
    cogs: round2(row.cogs),
    adSpend: round2(row.adSpend),
    packaging: round2(row.packaging),
    courier: round2(row.courier),
    other: round2(row.other),
    procurementExcluded: round2(row.procurementExcluded),
    netProfit: round2(net),
    marginPct: row.deliveredRevenue > 0 ? round2((net / row.deliveredRevenue) * 100) : null,
  };
}

export function computeProfitReport(input: {
  orders: ProfitOrderInput[];
  expenses: ExpenseRecord[];
  from: string;
  to: string;
}): ProfitReport {
  const keys = enumerateDateKeys(input.from, input.to);
  const byDate = new Map<string, DailyProfitRow>(keys.map((k) => [k, emptyRow(k)]));

  for (const order of input.orders) {
    const key = dhakaDateKey(order.createdAtIso);
    const row = byDate.get(key);
    if (!row) continue;
    row.totalOrders += 1;
    const total = Number(order.totalBdt) || 0;
    if (order.status === 'cancelled') {
      row.cancelledOrders += 1;
      continue;
    }
    row.grossOrderValue += total;
    if (order.status === 'delivered') {
      row.deliveredOrders += 1;
      row.deliveredRevenue += total;
      if (typeof order.cogsBdt === 'number' && Number.isFinite(order.cogsBdt)) {
        row.cogs += order.cogsBdt;
      } else {
        row.ordersMissingCogs += 1;
      }
    }
  }

  for (const expense of input.expenses) {
    const row = byDate.get(expense.date);
    if (!row) continue;
    const amount = Number(expense.amountBdt) || 0;
    switch (expense.type) {
      case 'facebook_ads':
      case 'tiktok_ads':
      case 'other_marketing':
        row.adSpend += amount;
        break;
      case 'packaging':
        row.packaging += amount;
        break;
      case 'courier':
        row.courier += amount;
        break;
      case 'procurement':
        row.procurementExcluded += amount;
        break;
      default:
        row.other += amount;
    }
  }

  const rows = keys.map((k) => finalizeRow(byDate.get(k) as DailyProfitRow));
  const totals = rows.reduce<DailyProfitRow>((acc, r) => {
    acc.totalOrders += r.totalOrders;
    acc.deliveredOrders += r.deliveredOrders;
    acc.cancelledOrders += r.cancelledOrders;
    acc.grossOrderValue += r.grossOrderValue;
    acc.deliveredRevenue += r.deliveredRevenue;
    acc.cogs += r.cogs;
    acc.adSpend += r.adSpend;
    acc.packaging += r.packaging;
    acc.courier += r.courier;
    acc.other += r.other;
    acc.procurementExcluded += r.procurementExcluded;
    acc.ordersMissingCogs += r.ordersMissingCogs;
    return acc;
  }, emptyRow('total'));

  return { from: input.from, to: input.to, rows, totals: finalizeRow(totals) };
}

/** Cost snapshot for an order: sum(qty × cogs per jar). Returns undefined when no cost is configured. */
export function computeOrderCogs(
  qty: { qty250g: number; qty500g: number; qty1kg: number },
  settings: FinanceSettings
): number | undefined {
  const configured = settings.cogs250g > 0 || settings.cogs500g > 0 || settings.cogs1kg > 0;
  if (!configured) return undefined;
  const total =
    qty.qty250g * (settings.cogs250g || 0) +
    qty.qty500g * (settings.cogs500g || 0) +
    qty.qty1kg * (settings.cogs1kg || 0);
  return round2(total);
}

export function validateExpenseInput(
  raw: unknown
):
  | { ok: true; value: { date: string; type: ExpenseType; amountBdt: number; description: string } }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid expense payload.' };
  const body = raw as Record<string, unknown>;
  const date = String(body.date || '').trim();
  if (!isValidDateKey(date)) return { ok: false, error: 'Date must be a valid YYYY-MM-DD.' };
  const type = String(body.type || '') as ExpenseType;
  if (!EXPENSE_TYPES.includes(type)) return { ok: false, error: 'Unknown expense type.' };
  const amount = Number(body.amountBdt);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    return { ok: false, error: 'Amount must be greater than 0 and at most 10,000,000.' };
  }
  const description = String(body.description || '').trim().slice(0, 200);
  return { ok: true, value: { date, type, amountBdt: round2(amount), description } };
}

export function validateFinanceSettings(
  raw: unknown
): { ok: true; value: FinanceSettings } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid settings payload.' };
  const body = raw as Record<string, unknown>;
  const out: FinanceSettings = { ...DEFAULT_FINANCE_SETTINGS };
  for (const key of ['cogs250g', 'cogs500g', 'cogs1kg'] as const) {
    const n = Number(body[key] ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
      return { ok: false, error: `${key} must be between 0 and 1,000,000.` };
    }
    out[key] = round2(n);
  }
  return { ok: true, value: out };
}
