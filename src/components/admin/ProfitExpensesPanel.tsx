'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Banknote, Loader2, Megaphone, Percent, Trash2, TrendingUp, Wallet } from 'lucide-react';
import {
  EXPENSE_LABELS,
  EXPENSE_TYPES,
  dhakaDateKey,
  type DailyProfitRow,
  type ExpenseRecord,
  type ExpenseType,
  type FinanceSettings,
  type ProfitReport,
} from '../../lib/finance/profit';
import { formatBdt } from '../../data/deshiGeeData';
import { Card, EmptyState, FilterChip, KpiCard, NumberField, PageHeader, StatusBadge } from './ui';

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'custom';

interface FinanceResponse {
  ok: boolean;
  error?: string;
  report?: ProfitReport;
  expenses?: ExpenseRecord[];
  settings?: FinanceSettings;
}

function shiftDate(key: string, days: number): string {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function rangeFor(key: RangeKey, today: string): { from: string; to: string } {
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: shiftDate(today, -6), to: today };
    case '30d':
      return { from: shiftDate(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    default:
      return { from: today, to: today };
  }
}

const money = (n: number) => formatBdt(Math.round(n * 100) / 100);

export function ProfitExpensesPanel({ getIdToken }: { getIdToken: () => Promise<string> }) {
  const today = useMemo(() => dhakaDateKey(new Date()), []);
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d');
  const [custom, setCustom] = useState({ from: shiftDate(today, -6), to: today });
  const range = rangeKey === 'custom' ? custom : rangeFor(rangeKey, today);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<ProfitReport | null>(null);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [settings, setSettings] = useState<FinanceSettings>({ cogs250g: 0, cogs500g: 0, cogs1kg: 0 });
  const [settingsDraft, setSettingsDraft] = useState<FinanceSettings>(settings);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const [form, setForm] = useState<{ date: string; type: ExpenseType; amountBdt: string; description: string }>({
    date: today,
    type: 'facebook_ads',
    amountBdt: '',
    description: '',
  });
  const [savingExpense, setSavingExpense] = useState(false);
  const [formMsg, setFormMsg] = useState('');

  // Keep the token getter in a ref so data loading does not re-fire when the parent re-renders.
  const tokenGetterRef = useRef(getIdToken);
  tokenGetterRef.current = getIdToken;

  const authedFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const token = await tokenGetterRef.current();
      return fetch(url, {
        ...init,
        headers: {
          ...(init.headers || {}),
          Authorization: `Bearer ${token}`,
          'x-requested-with': 'DeshiGeeStorefront',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    },
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authedFetch(`/api/admin/finance?from=${range.from}&to=${range.to}`);
      const data = (await res.json().catch(() => ({}))) as FinanceResponse;
      if (!res.ok || !data.ok || !data.report) {
        setError(data.error || `Could not load finance data (HTTP ${res.status}).`);
        setReport(null);
        return;
      }
      setReport(data.report);
      setExpenses(data.expenses || []);
      if (data.settings) {
        setSettings(data.settings);
        setSettingsDraft(data.settings);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error while loading finance data.');
    } finally {
      setLoading(false);
    }
  }, [authedFetch, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAddExpense = async (e: FormEvent) => {
    e.preventDefault();
    if (savingExpense) return;
    setSavingExpense(true);
    setFormMsg('');
    try {
      const res = await authedFetch('/api/admin/finance/expenses', {
        method: 'POST',
        body: JSON.stringify({ ...form, amountBdt: Number(form.amountBdt) }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setFormMsg(data.error || 'Could not save expense.');
        return;
      }
      setForm((f) => ({ ...f, amountBdt: '', description: '' }));
      setFormMsg('Expense saved.');
      await load();
    } catch (err) {
      setFormMsg(err instanceof Error ? err.message : 'Could not save expense.');
    } finally {
      setSavingExpense(false);
    }
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDeleteExpense = async (exp: ExpenseRecord) => {
    setConfirmDeleteId(null);
    const res = await authedFetch(`/api/admin/finance/expenses?id=${encodeURIComponent(exp.id)}`, { method: 'DELETE' });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      setFormMsg(data.error || 'Could not delete expense.');
      return;
    }
    await load();
  };

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsMsg('');
    try {
      const res = await authedFetch('/api/admin/finance/settings', {
        method: 'PUT',
        body: JSON.stringify(settingsDraft),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; settings?: FinanceSettings };
      if (!res.ok || !data.ok) {
        setSettingsMsg(data.error || 'Could not save costs.');
        return;
      }
      if (data.settings) setSettings(data.settings);
      setSettingsMsg('Saved. New orders will snapshot these costs.');
    } catch (err) {
      setSettingsMsg(err instanceof Error ? err.message : 'Could not save costs.');
    } finally {
      setSavingSettings(false);
    }
  };

  const totals = report?.totals;
  const costNotSet = settings.cogs250g <= 0 && settings.cogs500g <= 0 && settings.cogs1kg <= 0;
  const isEstimate = costNotSet || (totals?.ordersMissingCogs ?? 0) > 0;
  const settingsDirty = JSON.stringify(settingsDraft) !== JSON.stringify(settings);
  const rowsDesc: DailyProfitRow[] = report ? [...report.rows].reverse() : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profit & Expenses"
        description="Daily profit from delivered orders, your recorded costs and advertising spend."
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[rgba(30,23,16,0.14)] bg-white px-3.5 text-xs font-medium text-[#1E1710] hover:bg-[#F4EFE6] disabled:opacity-60"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Refresh</span>
          </button>
        }
      />

      <div className="no-print flex flex-wrap items-center gap-2">
        {(
          [
            ['today', 'Today'],
            ['7d', 'Last 7 days'],
            ['30d', 'Last 30 days'],
            ['month', 'This month'],
            ['custom', 'Custom'],
          ] as [RangeKey, string][]
        ).map(([key, label]) => (
          <FilterChip key={key} active={rangeKey === key} onClick={() => setRangeKey(key)}>
            {label}
          </FilterChip>
        ))}
        {rangeKey === 'custom' && (
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={custom.from}
              max={custom.to}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              aria-label="From date"
              className="min-h-[36px] rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-2.5"
            />
            <span>to</span>
            <input
              type="date"
              value={custom.to}
              min={custom.from}
              max={today}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              aria-label="To date"
              className="min-h-[36px] rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-2.5"
            />
          </div>
        )}
        <span className="ml-auto text-xs text-[#8A7867]">
          {range.from} → {range.to} · Asia/Dhaka
        </span>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {costNotSet && !error && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Product cost per jar is not set, so profit below ignores product cost and is only an estimate. Set it in
            “Product cost per jar” on this page.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Delivered revenue" value={money(totals?.deliveredRevenue ?? 0)} hint={`${totals?.deliveredOrders ?? 0} delivered orders`} icon={Banknote} tone="green" />
        <KpiCard label="Product cost (COGS)" value={money(totals?.cogs ?? 0)} hint="From cost snapshots on orders" icon={Wallet} tone="violet" />
        <KpiCard label="Advertising" value={money(totals?.adSpend ?? 0)} hint="Facebook, TikTok, other" icon={Megaphone} tone="blue" />
        <KpiCard
          label={isEstimate ? 'Net profit (estimate)' : 'Net profit'}
          value={money(totals?.netProfit ?? 0)}
          hint={isEstimate ? 'Some costs missing' : 'After all recorded costs'}
          icon={TrendingUp}
          tone={(totals?.netProfit ?? 0) >= 0 ? 'green' : 'red'}
        />
        <KpiCard label="Profit margin" value={totals?.marginPct == null ? '—' : `${totals.marginPct}%`} hint="Net ÷ delivered revenue" icon={Percent} tone="amber" />
      </div>

      <Card
        title="Daily breakdown"
        description="Orders are grouped by the day they were placed. Only delivered orders count as revenue."
        bodyClassName="p-0"
      >
        {loading && !report ? (
          <div className="flex items-center gap-2 p-6 text-sm text-[#635647]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rowsDesc.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No data for this range" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-[#FAF7F2] text-[11px] uppercase tracking-wide text-[#8A7867]">
                <tr>
                  {['Date', 'Orders', 'Delivered', 'Revenue', 'COGS', 'Ads', 'Packaging', 'Courier', 'Other', 'Net profit', 'Margin'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(30,23,16,0.06)] font-mono text-xs tabular-nums">
                {rowsDesc.map((r) => (
                  <tr key={r.date} className="hover:bg-[#FAF7F2]">
                    <td className="px-4 py-2.5 font-sans font-medium text-[#1E1710]">{r.date}</td>
                    <td className="px-4 py-2.5">{r.totalOrders}</td>
                    <td className="px-4 py-2.5">{r.deliveredOrders}</td>
                    <td className="px-4 py-2.5">{money(r.deliveredRevenue)}</td>
                    <td className="px-4 py-2.5">
                      {money(r.cogs)}
                      {r.ordersMissingCogs > 0 && <span title="Some delivered orders have no cost snapshot"> *</span>}
                    </td>
                    <td className="px-4 py-2.5">{money(r.adSpend)}</td>
                    <td className="px-4 py-2.5">{money(r.packaging)}</td>
                    <td className="px-4 py-2.5">{money(r.courier)}</td>
                    <td className="px-4 py-2.5">{money(r.other)}</td>
                    <td className={`px-4 py-2.5 font-semibold ${r.netProfit < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{money(r.netProfit)}</td>
                    <td className="px-4 py-2.5">{r.marginPct == null ? '—' : `${r.marginPct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Add expense" description="Daily advertising and other costs. Every entry is audit-logged.">
          <form onSubmit={handleAddExpense} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-[#3F3328]">Date</span>
                <input
                  type="date"
                  required
                  max={today}
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-sm"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-[#3F3328]">Type</span>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as ExpenseType })}
                  className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-sm"
                >
                  {EXPENSE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {EXPENSE_LABELS[t].en}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <NumberField
              label="Amount"
              prefix="৳"
              min={0}
              value={Number(form.amountBdt) || 0}
              onChange={(n) => setForm({ ...form, amountBdt: n ? String(n) : '' })}
            />
            <label className="block">
              <span className="block text-xs font-medium text-[#3F3328]">Note (optional)</span>
              <input
                type="text"
                maxLength={200}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. Boost – winter campaign"
                className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-sm"
              />
            </label>
            {form.type === 'procurement' && (
              <p className="text-xs text-amber-800">
                Procurement is shown for reference but not subtracted again — product cost is already counted through COGS.
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <span role="status" className="text-xs font-medium text-[#8A5A17]">
                {formMsg}
              </span>
              <button
                type="submit"
                disabled={savingExpense || !form.amountBdt}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#B47B2B] px-5 text-sm font-medium text-white hover:bg-[#96621B] disabled:opacity-50"
              >
                {savingExpense && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Save expense</span>
              </button>
            </div>
          </form>
        </Card>

        <Card title="Product cost per jar" description="Cost of goods for each size. Stored on every new order as a snapshot.">
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="250g" prefix="৳" value={settingsDraft.cogs250g} onChange={(n) => setSettingsDraft({ ...settingsDraft, cogs250g: n })} />
              <NumberField label="500g" prefix="৳" value={settingsDraft.cogs500g} onChange={(n) => setSettingsDraft({ ...settingsDraft, cogs500g: n })} />
              <NumberField label="1kg" prefix="৳" value={settingsDraft.cogs1kg} onChange={(n) => setSettingsDraft({ ...settingsDraft, cogs1kg: n })} />
            </div>
            <p className="text-xs text-[#635647]">
              Changing a cost affects <strong>new orders only</strong>. Past orders keep the cost they were created with, so history stays accurate.
            </p>
            <div className="flex items-center justify-between gap-3">
              <span role="status" className="text-xs font-medium text-[#8A5A17]">
                {settingsMsg}
              </span>
              <button
                type="submit"
                disabled={savingSettings || !settingsDirty}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#1E1710] px-5 text-sm font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
              >
                {savingSettings && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Save costs</span>
              </button>
            </div>
          </form>
        </Card>
      </div>

      <Card title="Recorded expenses" description={`${expenses.length} entries in this range`} bodyClassName="p-0">
        {expenses.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No expenses recorded" description="Add your daily Facebook ad spend above." />
          </div>
        ) : (
          <ul className="divide-y divide-[rgba(30,23,16,0.06)]">
            {expenses.map((exp) => (
              <li key={exp.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[#1E1710]">
                    {EXPENSE_LABELS[exp.type].en}
                    {exp.type === 'procurement' && <StatusBadge status="reference" label="Reference only" tone="neutral" />}
                  </p>
                  <p className="truncate text-xs text-[#635647]">
                    {exp.date}
                    {exp.description ? ` · ${exp.description}` : ''} · by {exp.createdByEmail || 'admin'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-mono text-sm font-semibold tabular-nums">{money(exp.amountBdt)}</span>
                  {confirmDeleteId === exp.id ? (
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleDeleteExpense(exp)}
                        className="rounded-lg bg-red-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-800"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-lg border border-[rgba(30,23,16,0.14)] px-2.5 py-1.5 text-xs font-medium text-[#635647] hover:bg-[#F4EFE6]"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(exp.id)}
                      aria-label={`Delete ${EXPENSE_LABELS[exp.type].en} expense`}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-[rgba(30,23,16,0.14)] text-[#635647] hover:border-red-300 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="How profit is calculated">
        <div className="space-y-3 text-sm leading-relaxed text-[#3F3328]">
          <p className="rounded-lg bg-[#FAF7F2] px-4 py-3 font-mono text-xs">
            Net profit = Delivered revenue − Product cost (COGS) − Packaging − Courier − Advertising − Other
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-[#635647]">
            <li>Only orders marked <strong>Delivered</strong> count as revenue. Pending, confirmed, shipped and cancelled orders never do.</li>
            <li>Product cost comes from the cost snapshot saved on each order, so later price or cost changes do not rewrite history.</li>
            <li>“Product Procurement” expenses are shown for reference but not subtracted — COGS already covers them (no double counting).</li>
            <li>Orders are grouped by the day they were placed (Asia/Dhaka), not the day they were delivered.</li>
            <li>
              <strong>Delivered is not cash received.</strong> Cash-on-delivery money reaches you only after the courier settles. Settlement tracking is a separate upcoming module.
            </li>
            <li>A <strong>*</strong> beside COGS means some delivered orders have no cost snapshot (created before costs were set); profit is then an estimate.</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
