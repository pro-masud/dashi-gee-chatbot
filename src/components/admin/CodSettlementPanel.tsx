'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Landmark, Loader2, Scale, Truck } from 'lucide-react';
import {
  SETTLEMENT_COURIERS,
  evaluateSettlement,
  outstandingCollected,
  type CodOrderInput,
  type CodSummary,
} from '../../lib/cod/settlement';
import { dhakaDateKey } from '../../lib/finance/profit';
import { formatBdt } from '../../data/deshiGeeData';
import type { CourierPartner } from '../../lib/storeTypes';
import { Card, EmptyState, KpiCard, PageHeader, StatusBadge } from './ui';

interface SettlementRow {
  id: string;
  courier: string;
  reference: string;
  amountBdt: number;
  expectedBdt: number;
  discrepancyBdt: number;
  date: string;
  orderNumbers: string[];
  status: 'settled' | 'disputed';
  note: string;
  createdByEmail: string;
  createdAtIso: string;
}

interface CodResponse {
  ok: boolean;
  error?: string;
  summary?: CodSummary;
  eligible?: CodOrderInput[];
  settlements?: SettlementRow[];
}

const money = (n: number) => formatBdt(Math.round(n * 100) / 100);

export function CodSettlementPanel({ getIdToken }: { getIdToken: () => Promise<string> }) {
  const today = useMemo(() => dhakaDateKey(new Date()), []);
  const tokenRef = useRef(getIdToken);
  tokenRef.current = getIdToken;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<CodSummary | null>(null);
  const [eligible, setEligible] = useState<CodOrderInput[]>([]);
  const [history, setHistory] = useState<SettlementRow[]>([]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [courier, setCourier] = useState<CourierPartner>('steadfast');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const authedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    const token = await tokenRef.current();
    return fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
        'x-requested-with': 'DeshiGeeStorefront',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authedFetch('/api/admin/cod');
      const data = (await res.json().catch(() => ({}))) as CodResponse;
      if (!res.ok || !data.ok) {
        setError(data.error || `Could not load COD data (HTTP ${res.status}).`);
        return;
      }
      setSummary(data.summary || null);
      setEligible(data.eligible || []);
      setHistory(data.settlements || []);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error while loading COD data.');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedOrders = useMemo(() => eligible.filter((o) => selected.has(o.orderNumber)), [eligible, selected]);
  const outcome = useMemo(
    () => (selectedOrders.length ? evaluateSettlement(selectedOrders, Number(amount) || 0) : null),
    [selectedOrders, amount]
  );

  const toggle = (orderNumber: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderNumber)) next.delete(orderNumber);
      else next.add(orderNumber);
      // prefill the amount with the expected total of the new selection
      const exp = eligible
        .filter((o) => next.has(o.orderNumber))
        .reduce((s, o) => s + outstandingCollected(o), 0);
      setAmount(exp > 0 ? String(Math.round(exp * 100) / 100) : '');
      return next;
    });

  const selectAll = () => {
    const all = new Set(eligible.map((o) => o.orderNumber));
    setSelected(all);
    const exp = eligible.reduce((s, o) => s + outstandingCollected(o), 0);
    setAmount(exp > 0 ? String(Math.round(exp * 100) / 100) : '');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || selectedOrders.length === 0) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await authedFetch('/api/admin/cod/settlements', {
        method: 'POST',
        body: JSON.stringify({
          courier,
          reference,
          amountBdt: Number(amount),
          date,
          note,
          orderNumbers: selectedOrders.map((o) => o.orderNumber),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; settlement?: SettlementRow };
      if (!res.ok || !data.ok) {
        setMsg(data.error || 'Could not record settlement.');
        return;
      }
      setMsg(
        data.settlement?.status === 'disputed'
          ? `Recorded with a difference of ${money(data.settlement.discrepancyBdt)} — the orders are marked Disputed.`
          : 'Settlement recorded. The orders are marked Settled.'
      );
      setReference('');
      setNote('');
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not record settlement.');
    } finally {
      setSaving(false);
    }
  };

  const s = summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title="COD & Settlements"
        description="Where your cash-on-delivery money is: with the courier, collected, or paid out to you."
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

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="In transit" value={money(s?.inTransit.amountBdt ?? 0)} hint={`${s?.inTransit.count ?? 0} orders with courier`} icon={Truck} tone="violet" />
        <KpiCard label="Awaiting collection" value={money(s?.awaitingCollection.amountBdt ?? 0)} hint={`${s?.awaitingCollection.count ?? 0} delivered, cash unconfirmed`} icon={Clock} tone="amber" />
        <KpiCard label="Collected, not paid out" value={money(s?.collectedPendingSettlement.amountBdt ?? 0)} hint={`${s?.collectedPendingSettlement.count ?? 0} orders`} icon={Landmark} tone="blue" />
        <KpiCard label="Settled to you" value={money(s?.settled.amountBdt ?? 0)} hint={`${s?.settled.count ?? 0} orders`} icon={CheckCircle2} tone="green" />
        <KpiCard label="Disputed" value={money(s?.disputed.amountBdt ?? 0)} hint={`${s?.disputed.count ?? 0} orders need review`} icon={Scale} tone="red" />
      </div>

      <Card
        title="Record a courier settlement"
        description="Select the orders a courier payout covers, then enter the reference and the amount you actually received."
        bodyClassName="p-0"
      >
        {eligible.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No collected orders waiting for settlement"
              description="Mark a delivered COD order as “Collected by courier” in Orders first. It will then appear here."
            />
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="flex items-center justify-between border-b border-[rgba(30,23,16,0.06)] px-5 py-3 text-xs">
              <span className="text-[#635647]">
                {selected.size} of {eligible.length} selected
              </span>
              <button type="button" onClick={selectAll} className="font-medium text-[#8A5A17] hover:underline">
                Select all
              </button>
            </div>
            <ul className="max-h-72 divide-y divide-[rgba(30,23,16,0.06)] overflow-y-auto">
              {eligible.map((o) => (
                <li key={o.orderNumber}>
                  <label className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-[#FAF7F2]">
                    <input
                      type="checkbox"
                      checked={selected.has(o.orderNumber)}
                      onChange={() => toggle(o.orderNumber)}
                      className="h-4 w-4 accent-[#B47B2B]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs font-semibold">{o.orderNumber}</span>
                      <span className="block truncate text-xs text-[#635647]">
                        {o.customerName}
                        {o.courierPartner ? ` · ${o.courierPartner}` : ''}
                        {o.consignmentId ? ` · ${o.consignmentId}` : ''}
                      </span>
                    </span>
                    {o.settlementStatus === 'disputed' && <StatusBadge status="disputed" />}
                    <span className="font-mono text-sm font-semibold tabular-nums">{money(outstandingCollected(o))}</span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="space-y-4 border-t border-[rgba(30,23,16,0.08)] p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <label className="block">
                  <span className="block text-xs font-medium text-[#3F3328]">Courier</span>
                  <select
                    value={courier}
                    onChange={(e) => setCourier(e.target.value as CourierPartner)}
                    className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base capitalize sm:text-sm"
                  >
                    {SETTLEMENT_COURIERS.map((c) => (
                      <option key={c} value={c}>
                        {c === 'manual' ? 'Manual / other' : c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block sm:col-span-1">
                  <span className="block text-xs font-medium text-[#3F3328]">Settlement reference *</span>
                  <input
                    required
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="e.g. SF-PAY-10442"
                    className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 font-mono text-base sm:text-sm"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-[#3F3328]">Amount received (৳) *</span>
                  <input
                    required
                    type="number"
                    min={1}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 font-mono text-base sm:text-sm"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-[#3F3328]">Date received</span>
                  <input
                    type="date"
                    required
                    max={today}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-sm"
                  />
                </label>
              </div>
              <label className="block">
                <span className="block text-xs font-medium text-[#3F3328]">Note (optional)</span>
                <input
                  value={note}
                  maxLength={300}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-sm"
                />
              </label>

              {outcome && (
                <div
                  className={`rounded-xl border px-4 py-3 text-sm ${
                    outcome.discrepancyBdt === 0
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                      : 'border-amber-300 bg-amber-50 text-amber-900'
                  }`}
                >
                  Expected <strong className="font-mono">{money(outcome.expectedBdt)}</strong> · Received{' '}
                  <strong className="font-mono">{money(outcome.receivedBdt)}</strong> ·{' '}
                  {outcome.discrepancyBdt === 0
                    ? 'Matches — these orders will be marked Settled.'
                    : `Difference ${money(Math.abs(outcome.discrepancyBdt))} ${outcome.discrepancyBdt > 0 ? 'short' : 'extra'} — these orders will be marked Disputed so it is not forgotten.`}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <span role="status" className="text-xs font-medium text-[#8A5A17]">
                  {msg}
                </span>
                <button
                  type="submit"
                  disabled={saving || selected.size === 0 || !reference || !amount}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#B47B2B] px-6 text-sm font-medium text-white hover:bg-[#96621B] disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>Record settlement</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </Card>

      <Card title="Settlement history" description="Each courier reference can be recorded only once." bodyClassName="p-0">
        {history.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No settlements recorded yet" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[#FAF7F2] text-[11px] uppercase tracking-wide text-[#8A7867]">
                <tr>
                  {['Date', 'Courier', 'Reference', 'Orders', 'Expected', 'Received', 'Difference', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(30,23,16,0.06)] text-xs">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-[#FAF7F2]">
                    <td className="px-4 py-2.5">{h.date}</td>
                    <td className="px-4 py-2.5 capitalize">{h.courier}</td>
                    <td className="px-4 py-2.5 font-mono">{h.reference}</td>
                    <td className="px-4 py-2.5 tabular-nums">{h.orderNumbers.length}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums">{money(h.expectedBdt)}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums">{money(h.amountBdt)}</td>
                    <td className={`px-4 py-2.5 font-mono tabular-nums ${h.discrepancyBdt ? 'text-red-700' : ''}`}>
                      {h.discrepancyBdt ? money(h.discrepancyBdt) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={h.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="How COD money is tracked">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-[#635647]">
          <li><strong>Delivered ≠ cash received.</strong> After delivery, mark the order “Collected by courier” in Orders when you can confirm it.</li>
          <li><strong>Collected ≠ paid to you.</strong> Record the courier payout here with its reference; the same reference can never be entered twice.</li>
          <li>If the amount you received does not match what was collected, the orders are marked <strong>Disputed</strong> and the gap stays visible.</li>
          <li>Returned or failed deliveries never count as collected cash.</li>
        </ul>
      </Card>
    </div>
  );
}
