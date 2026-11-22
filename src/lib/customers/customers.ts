/**
 * Customer CRM — pure aggregation over orders (no I/O, browser-safe).
 * One customer = one normalised phone number.
 */

export interface CustomerOrderInput {
  orderNumber: string;
  customerName: string;
  phone: string;
  district?: string;
  address?: string;
  status: string;
  totalBdt: number;
  createdAt?: unknown;
}

export type CustomerTag = 'vip' | 'returning' | 'new' | 'risky';

export interface CustomerRow {
  phone: string;
  name: string;
  district: string;
  address: string;
  totalOrders: number;
  delivered: number;
  cancelled: number;
  returnedOrFailed: number;
  /** Delivered COD value only. null for roles that cannot see money. */
  deliveredRevenue: number | null;
  averageOrderValue: number | null;
  firstOrderAtIso: string;
  lastOrderAtIso: string;
  tags: CustomerTag[];
  orderNumbers: string[];
}

export const VIP_REVENUE_BDT = 5000;
export const VIP_DELIVERED_COUNT = 3;

function normalizePhone(raw: string): string {
  return String(raw || '')
    .replace(/[\s\-+()]/g, '')
    .replace(/^880/, '0')
    .replace(/^88(?=01)/, '');
}

function toMs(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  const c = v as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof c.toDate === 'function') return c.toDate().getTime();
  const s = c.seconds ?? c._seconds;
  return typeof s === 'number' ? s * 1000 : null;
}

export function tagsFor(c: {
  totalOrders: number;
  delivered: number;
  cancelled: number;
  returnedOrFailed: number;
  revenue: number;
}): CustomerTag[] {
  const tags: CustomerTag[] = [];
  const active = c.totalOrders - c.cancelled;
  if (c.revenue >= VIP_REVENUE_BDT || c.delivered >= VIP_DELIVERED_COUNT) tags.push('vip');
  if (active >= 2) tags.push('returning');
  if (c.totalOrders === 1) tags.push('new');
  const bad = c.cancelled + c.returnedOrFailed;
  if (bad >= 2 && bad > c.delivered) tags.push('risky');
  return tags;
}

export function computeCustomers(orders: CustomerOrderInput[], options: { includeMoney: boolean }): CustomerRow[] {
  const map = new Map<string, CustomerOrderInput[]>();
  for (const o of orders) {
    const phone = normalizePhone(o.phone);
    if (!phone) continue;
    const list = map.get(phone) || [];
    list.push(o);
    map.set(phone, list);
  }

  const out: CustomerRow[] = [];
  for (const [phone, rows] of map) {
    const sorted = rows.slice().sort((a, b) => (toMs(b.createdAt) ?? 0) - (toMs(a.createdAt) ?? 0));
    const latest = sorted[0];
    const oldest = sorted[sorted.length - 1];
    let delivered = 0;
    let cancelled = 0;
    let bad = 0;
    let revenue = 0;
    for (const o of rows) {
      if (o.status === 'delivered') {
        delivered += 1;
        revenue += Number(o.totalBdt) || 0;
      } else if (o.status === 'cancelled') {
        cancelled += 1;
      } else if (o.status === 'returned' || o.status === 'delivery_failed') {
        bad += 1;
      }
    }
    const base = { totalOrders: rows.length, delivered, cancelled, returnedOrFailed: bad };
    const firstMs = toMs(oldest.createdAt);
    const lastMs = toMs(latest.createdAt);
    out.push({
      phone,
      name: latest.customerName,
      district: latest.district || '',
      address: latest.address || '',
      ...base,
      deliveredRevenue: options.includeMoney ? Math.round(revenue * 100) / 100 : null,
      averageOrderValue: options.includeMoney ? (delivered > 0 ? Math.round((revenue / delivered) * 100) / 100 : 0) : null,
      firstOrderAtIso: firstMs ? new Date(firstMs).toISOString() : '',
      lastOrderAtIso: lastMs ? new Date(lastMs).toISOString() : '',
      tags: tagsFor({ ...base, revenue }),
      orderNumbers: sorted.map((o) => o.orderNumber),
    });
  }
  return out.sort((a, b) => b.lastOrderAtIso.localeCompare(a.lastOrderAtIso));
}

export function customersToCsv(rows: CustomerRow[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['phone', 'name', 'district', 'orders', 'delivered', 'cancelled', 'returned_failed', 'delivered_revenue', 'last_order', 'tags'];
  return [
    head.join(','),
    ...rows.map((r) =>
      [r.phone, r.name, r.district, r.totalOrders, r.delivered, r.cancelled, r.returnedOrFailed, r.deliveredRevenue ?? '', r.lastOrderAtIso, r.tags.join('|')]
        .map(esc)
        .join(',')
    ),
  ].join('\n');
}
