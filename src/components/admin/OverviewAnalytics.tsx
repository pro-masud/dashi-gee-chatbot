'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Banknote,
  CheckCircle2,
  Clock,
  PackageCheck,
  Percent,
  PhoneCall,
  Receipt,
  RotateCcw,
  ShoppingBag,
  TrendingUp,
  Truck,
  Wallet,
} from 'lucide-react';
import {
  buildFunnel,
  computeDashboardStats,
  dhakaDay,
  pctChange,
  previousRange,
  resolveRange,
  type DashboardStats,
  type RangeKey,
  type StatsOrder,
} from '../../lib/dashboard/stats';
import { formatBdt } from '../../data/deshiGeeData';
import { Card, FilterChip, KpiCard } from './ui';

type TabTarget = 'orders' | 'leads' | 'finance' | 'cod' | 'packages';

interface Props {
  orders: StatsOrder[];
  canSeeMoney: boolean;
  canSeeLeads: boolean;
  getIdToken: () => Promise<string>;
  onNavigate: (tab: TabTarget) => void;
}

const money = (n: number) => formatBdt(Math.round(n));

const RANGES: [RangeKey, string][] = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['month', 'This month'],
  ['last_month', 'Last month'],
  ['custom', 'Custom'],
];

function Delta({ current, previous }: { current: number; previous: number }) {
  const change = pctChange(current, previous);
  if (change === null) return null;
  const up = change >= 0;
  return (
    <span className={up ? 'text-emerald-700' : 'text-red-700'}>
      {up ? '▲' : '▼'} {Math.abs(change)}% vs previous period
    </span>
  );
}

function BarChart({ points, valueKey, format }: { points: { date: string; orders: number; revenue: number }[]; valueKey: 'orders' | 'revenue'; format: (n: number) => string }) {
  const max = Math.max(1, ...points.map((p) => p[valueKey]));
  const w = 600;
  const h = 150;
  const gap = 4;
  const bw = Math.max(2, (w - gap * (points.length - 1)) / Math.max(points.length, 1));
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h + 22}`} role="img" aria-label={`Daily ${valueKey}`} className="w-full">
        {points.map((p, i) => {
          const bh = (p[valueKey] / max) * h;
          const x = i * (bw + gap);
          return (
            <g key={p.date}>
              <title>{`${p.date}: ${format(p[valueKey])}`}</title>
              <rect x={x} y={h - bh} width={bw} height={Math.max(bh, p[valueKey] > 0 ? 2 : 0)} rx={2} fill="#B47B2B" opacity={p[valueKey] > 0 ? 0.9 : 0.15} />
            </g>
          );
        })}
        <line x1={0} y1={h} x2={w} y2={h} stroke="rgba(30,23,16,0.15)" />
        {points.length > 0 && (
          <>
            <text x={0} y={h + 15} fontSize={10} fill="#8A7867">{points[0].date.slice(5)}</text>
            <text x={w} y={h + 15} fontSize={10} fill="#8A7867" textAnchor="end">{points[points.length - 1].date.slice(5)}</text>
          </>
        )}
      </svg>
      <p className="mt-1 text-[11px] text-[#8A7867]">Peak: {format(max === 1 && points.every((p) => p[valueKey] === 0) ? 0 : max)}</p>
    </div>
  );
}

function HBars({ rows, format = (n: number) => String(n) }: { rows: { key: string; label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="text-xs">
          <div className="mb-1 flex justify-between text-[#635647]">
            <span>{r.label}</span>
            <span className="font-mono font-semibold tabular-nums text-[#1E1710]">{format(r.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[rgba(30,23,16,0.08)]">
            <div className="h-full rounded-full bg-gradient-to-r from-[#B47B2B] to-[#D4AF37]" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OverviewAnalytics({ orders, canSeeMoney, canSeeLeads, getIdToken, onNavigate }: Props) {
  const today = useMemo(() => dhakaDay(Date.now()), []);
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d');
  const [custom, setCustom] = useState({ from: resolveRange('7d', today).from, to: today });
  const range = resolveRange(rangeKey, today, custom);

  const stats: DashboardStats = useMemo(() => computeDashboardStats(orders, range.from, range.to), [orders, range.from, range.to]);
  const prevRange = useMemo(() => previousRange(range.from, range.to), [range.from, range.to]);
  const prev: DashboardStats = useMemo(() => computeDashboardStats(orders, prevRange.from, prevRange.to), [orders, prevRange.from, prevRange.to]);

  const tokenRef = useRef(getIdToken);
  tokenRef.current = getIdToken;

  const [leadDays, setLeadDays] = useState<string[] | null>(null);
  const [finance, setFinance] = useState<{ adSpend: number; netProfit: number; estimate: boolean } | null>(null);
  const [financeError, setFinanceError] = useState('');

  useEffect(() => {
    if (!canSeeLeads) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await tokenRef.current();
        const res = await fetch('/api/admin/leads', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data.ok && Array.isArray(data.leads)) {
          setLeadDays(data.leads.map((l: { createdAtIso?: string }) => (l.createdAtIso ? dhakaDay(Date.parse(l.createdAtIso)) : '')));
        }
      } catch {
        // funnel simply omits the leads step
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canSeeLeads]);

  const loadFinance = useCallback(async () => {
    if (!canSeeMoney) return;
    setFinanceError('');
    setFinance(null);
    try {
      const token = await tokenRef.current();
      const res = await fetch(`/api/admin/finance?from=${range.from}&to=${range.to}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setFinanceError(data.error || 'Profit data unavailable.');
        return;
      }
      const t = data.report.totals;
      setFinance({ adSpend: t.adSpend, netProfit: t.netProfit, estimate: t.ordersMissingCogs > 0 || (data.settings?.cogs250g ?? 0) + (data.settings?.cogs500g ?? 0) + (data.settings?.cogs1kg ?? 0) <= 0 });
    } catch {
      setFinanceError('Profit data unavailable.');
    }
  }, [canSeeMoney, range.from, range.to]);

  useEffect(() => {
    void loadFinance();
  }, [loadFinance]);

  const leadsInRange = leadDays ? leadDays.filter((d) => d >= range.from && d <= range.to).length : null;
  const funnel = useMemo(() => buildFunnel(leadsInRange, stats), [leadsInRange, stats]);

  const tile = (target: TabTarget | null, node: React.ReactNode) =>
    target ? (
      <button type="button" onClick={() => onNavigate(target)} className="block w-full rounded-2xl text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-offset-2">
        {node}
      </button>
    ) : (
      node
    );

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center gap-2">
        {RANGES.map(([key, label]) => (
          <FilterChip key={key} active={rangeKey === key} onClick={() => setRangeKey(key)}>
            {label}
          </FilterChip>
        ))}
        {rangeKey === 'custom' && (
          <div className="flex items-center gap-2 text-xs">
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="From date" className="min-h-[36px] rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-2.5" />
            <span>to</span>
            <input type="date" value={custom.to} min={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="To date" className="min-h-[36px] rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-2.5" />
          </div>
        )}
        <span className="ml-auto text-xs text-[#8A7867]">{range.from} → {range.to} · Asia/Dhaka</span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tile('orders', <KpiCard label="Orders" value={stats.totalOrders} hint={`${prev.totalOrders} in previous period`} icon={ShoppingBag} tone="blue" />)}
        {tile('orders', <KpiCard label="Delivered" value={stats.delivered} hint={`${stats.deliverySuccessPct ?? '—'}% delivery success`} icon={CheckCircle2} tone="green" />)}
        {canSeeMoney && tile('finance', <KpiCard label="Delivered revenue" value={money(stats.deliveredRevenue)} hint={`Gross ${money(stats.grossOrderValue)}`} icon={Banknote} tone="green" />)}
        {tile('orders', <KpiCard label="Pending" value={stats.pending} hint="Waiting for confirmation" icon={Clock} tone="amber" />)}
        {tile('orders', <KpiCard label="Confirmed" value={stats.confirmed} hint="Ready to pack" icon={CheckCircle2} tone="violet" />)}
        {tile('orders', <KpiCard label="Packaging / ready" value={stats.packaging} hint="Being prepared" icon={PackageCheck} tone="violet" />)}
        {tile('orders', <KpiCard label="With courier" value={stats.withCourier} hint="In transit" icon={Truck} tone="blue" />)}
        {tile('orders', <KpiCard label="Returned" value={stats.returned} hint={`${stats.failed} delivery failed`} icon={RotateCcw} tone="red" />)}
        {tile('orders', <KpiCard label="Cancelled" value={stats.cancelled} hint={`${stats.cancelRatePct ?? '—'}% cancel rate`} icon={Ban} tone="red" />)}
        {tile(null, <KpiCard label="Return rate" value={stats.returnRatePct === null ? '—' : `${stats.returnRatePct}%`} hint="Returned ÷ (delivered + returned)" icon={Percent} tone="amber" />)}
        {tile(null, <KpiCard label="Average order value" value={money(stats.avgOrderValue)} hint="Non-cancelled orders" icon={Receipt} tone="neutral" />)}
        {canSeeLeads && tile('leads', <KpiCard label="Checkout leads" value={leadsInRange ?? '—'} hint="Entered a phone number" icon={PhoneCall} tone="amber" />)}
        {canSeeMoney && tile('finance', <KpiCard label="Advertising spend" value={finance ? money(finance.adSpend) : financeError ? '—' : '…'} hint="From Profit & Expenses" icon={Wallet} tone="blue" />)}
        {canSeeMoney && tile('finance', <KpiCard label={finance?.estimate ? 'Net profit (estimate)' : 'Net profit'} value={finance ? money(finance.netProfit) : financeError ? '—' : '…'} hint={financeError || (finance?.estimate ? 'Some costs missing' : 'After recorded costs')} icon={TrendingUp} tone={finance && finance.netProfit < 0 ? 'red' : 'green'} />)}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Orders per day" description={<Delta current={stats.totalOrders} previous={prev.totalOrders} />}>
          <BarChart points={stats.days} valueKey="orders" format={(n) => String(n)} />
        </Card>
        {canSeeMoney ? (
          <Card title="Delivered revenue per day" description={<Delta current={stats.deliveredRevenue} previous={prev.deliveredRevenue} />}>
            <BarChart points={stats.days} valueKey="revenue" format={money} />
          </Card>
        ) : (
          <Card title="Order status">
            <HBars rows={stats.statusBreakdown.map((s) => ({ key: s.key, label: s.label, value: s.count }))} />
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {canSeeMoney && (
          <Card title="Order status">
            <HBars rows={stats.statusBreakdown.map((s) => ({ key: s.key, label: s.label, value: s.count }))} />
          </Card>
        )}
        <Card title="Jars sold by package" description="Non-cancelled orders in range">
          <HBars rows={stats.packageSales.map((p) => ({ key: p.slot, label: `${p.slot} jars`, value: p.jars }))} />
        </Card>
        <Card title="Conversion funnel" description={leadsInRange === null && canSeeLeads ? 'Loading leads…' : undefined}>
          {funnel.length === 0 ? (
            <p className="text-xs text-[#8A7867]">No data in this range.</p>
          ) : (
            <ul className="space-y-3">
              {funnel.map((s, i) => (
                <li key={s.key} className="text-xs">
                  <div className="flex justify-between text-[#635647]">
                    <span>{s.label}</span>
                    <span className="font-mono font-semibold tabular-nums text-[#1E1710]">
                      {s.count}
                      {s.pctOfPrevious !== null && <span className="ml-2 font-normal text-[#8A7867]">{s.pctOfPrevious}%</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-[rgba(30,23,16,0.08)]">
                    <div className="h-full rounded-full bg-[#B47B2B]" style={{ width: `${funnel[0].count > 0 ? (s.count / funnel[0].count) * 100 : i === 0 ? 100 : 0}%`, opacity: 1 - i * 0.18 }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
