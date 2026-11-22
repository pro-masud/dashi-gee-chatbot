/**
 * Dashboard statistics — pure functions, browser-safe (no server imports).
 * Dates are Asia/Dhaka calendar days (UTC+6, no DST).
 */

export interface StatsOrder {
  orderNumber: string;
  status: string;
  totalBdt: number;
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  paymentMethod?: string;
  createdAt?: unknown;
}

const DHAKA_OFFSET_MS = 6 * 3600 * 1000;

/** Best-effort ISO timestamp from an ISO string, Date, Firestore Timestamp or {seconds}. */
export function orderCreatedAtMs(createdAt: unknown): number | null {
  if (!createdAt) return null;
  if (typeof createdAt === 'string') {
    const ms = Date.parse(createdAt);
    return Number.isFinite(ms) ? ms : null;
  }
  if (createdAt instanceof Date) return createdAt.getTime();
  const c = createdAt as { toDate?: () => Date; seconds?: number; _seconds?: number };
  if (typeof c.toDate === 'function') return c.toDate().getTime();
  const s = c.seconds ?? c._seconds;
  return typeof s === 'number' ? s * 1000 : null;
}

export function dhakaDay(ms: number): string {
  return new Date(ms + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

export function shiftDay(key: string, days: number): string {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'last_month' | 'custom';

export function resolveRange(key: RangeKey, today: string, custom?: { from: string; to: string }): { from: string; to: string } {
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = shiftDay(today, -1);
      return { from: y, to: y };
    }
    case '7d':
      return { from: shiftDay(today, -6), to: today };
    case '30d':
      return { from: shiftDay(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'last_month': {
      const firstThis = `${today.slice(0, 8)}01`;
      const lastPrev = shiftDay(firstThis, -1);
      return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
    }
    default:
      return custom ?? { from: today, to: today };
  }
}

const IN_TRANSIT = ['sent_to_courier', 'shipped', 'out_for_delivery'];
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DayPoint {
  date: string;
  orders: number;
  revenue: number;
}

export interface DashboardStats {
  from: string;
  to: string;
  totalOrders: number;
  pending: number;
  confirmed: number;
  packaging: number;
  withCourier: number;
  delivered: number;
  returned: number;
  failed: number;
  cancelled: number;
  /** Delivered revenue (COD): only delivered orders count. */
  deliveredRevenue: number;
  /** Value of all non-cancelled orders placed in the range. */
  grossOrderValue: number;
  avgOrderValue: number;
  returnRatePct: number | null;
  cancelRatePct: number | null;
  deliverySuccessPct: number | null;
  days: DayPoint[];
  statusBreakdown: { key: string; label: string; count: number }[];
  packageSales: { slot: '250g' | '500g' | '1kg'; jars: number }[];
}

export function computeDashboardStats(orders: StatsOrder[], from: string, to: string): DashboardStats {
  const dayMap = new Map<string, DayPoint>();
  for (let k = from; k <= to; k = shiftDay(k, 1)) {
    dayMap.set(k, { date: k, orders: 0, revenue: 0 });
    if (dayMap.size > 400) break;
  }

  const c = { pending: 0, confirmed: 0, packaging: 0, withCourier: 0, delivered: 0, returned: 0, failed: 0, cancelled: 0 };
  let total = 0;
  let gross = 0;
  let deliveredRevenue = 0;
  const jars = { '250g': 0, '500g': 0, '1kg': 0 };

  for (const o of orders) {
    const ms = orderCreatedAtMs(o.createdAt);
    if (ms === null) continue;
    const day = dhakaDay(ms);
    const point = dayMap.get(day);
    if (!point) continue;

    total += 1;
    point.orders += 1;
    const value = Number(o.totalBdt) || 0;

    switch (o.status) {
      case 'pending':
        c.pending += 1;
        break;
      case 'confirmed':
        c.confirmed += 1;
        break;
      case 'packaging':
      case 'processing':
      case 'ready_to_ship':
        c.packaging += 1;
        break;
      case 'delivered':
        c.delivered += 1;
        deliveredRevenue += value;
        point.revenue += value;
        break;
      case 'returned':
        c.returned += 1;
        break;
      case 'delivery_failed':
        c.failed += 1;
        break;
      case 'cancelled':
        c.cancelled += 1;
        break;
      default:
        if (IN_TRANSIT.includes(o.status)) c.withCourier += 1;
    }
    if (o.status !== 'cancelled') {
      gross += value;
      jars['250g'] += Number(o.qty250g) || 0;
      jars['500g'] += Number(o.qty500g) || 0;
      jars['1kg'] += Number(o.qty1kg) || 0;
    }
  }

  const nonCancelled = total - c.cancelled;
  // Orders that reached a delivery outcome
  const outcomes = c.delivered + c.returned + c.failed;
  return {
    from,
    to,
    totalOrders: total,
    ...c,
    deliveredRevenue: round2(deliveredRevenue),
    grossOrderValue: round2(gross),
    avgOrderValue: nonCancelled > 0 ? round2(gross / nonCancelled) : 0,
    returnRatePct: c.delivered + c.returned > 0 ? round2((c.returned / (c.delivered + c.returned)) * 100) : null,
    cancelRatePct: total > 0 ? round2((c.cancelled / total) * 100) : null,
    deliverySuccessPct: outcomes > 0 ? round2((c.delivered / outcomes) * 100) : null,
    days: Array.from(dayMap.values()).map((d) => ({ ...d, revenue: round2(d.revenue) })),
    statusBreakdown: [
      { key: 'pending', label: 'Pending', count: c.pending },
      { key: 'confirmed', label: 'Confirmed', count: c.confirmed },
      { key: 'packaging', label: 'Packaging / ready', count: c.packaging },
      { key: 'withCourier', label: 'With courier', count: c.withCourier },
      { key: 'delivered', label: 'Delivered', count: c.delivered },
      { key: 'failed', label: 'Delivery failed', count: c.failed },
      { key: 'returned', label: 'Returned', count: c.returned },
      { key: 'cancelled', label: 'Cancelled', count: c.cancelled },
    ],
    packageSales: [
      { slot: '250g', jars: jars['250g'] },
      { slot: '500g', jars: jars['500g'] },
      { slot: '1kg', jars: jars['1kg'] },
    ],
  };
}

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  /** % of the previous step, null for the first step */
  pctOfPrevious: number | null;
}

/** Leads → orders placed → confirmed or further → delivered. */
export function buildFunnel(leadsInRange: number | null, stats: DashboardStats): FunnelStep[] {
  const confirmedOrFurther = stats.confirmed + stats.packaging + stats.withCourier + stats.delivered + stats.returned + stats.failed;
  const raw: { key: string; label: string; count: number | null }[] = [
    { key: 'leads', label: 'Checkout started (leads)', count: leadsInRange },
    { key: 'orders', label: 'Orders placed', count: stats.totalOrders },
    { key: 'confirmed', label: 'Confirmed or later', count: confirmedOrFurther },
    { key: 'delivered', label: 'Delivered', count: stats.delivered },
  ];
  const steps: FunnelStep[] = [];
  let prev: number | null = null;
  for (const s of raw) {
    if (s.count === null) continue; // leads unavailable (no permission / not loaded)
    steps.push({
      key: s.key,
      label: s.label,
      count: s.count,
      pctOfPrevious: prev === null || prev === 0 ? null : round2((s.count / prev) * 100),
    });
    prev = s.count;
  }
  return steps;
}

/** Percentage change vs a previous value; null when the base is zero. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
}

/** Previous period of the same length, immediately before `from`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const length = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: shiftDay(from, -length), to: shiftDay(from, -1) };
}
