'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, Phone, Search } from 'lucide-react';
import { customersToCsv, type CustomerRow, type CustomerTag } from '../../lib/customers/customers';
import { formatBdt } from '../../data/deshiGeeData';
import { Card, EmptyState, FilterChip, PageHeader, StatusBadge } from './ui';

type Segment = 'all' | CustomerTag;
type Notes = Record<string, { note: string; updatedAtIso: string; updatedBy: string }>;

const dhaka = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium' });
const TAG_TONE: Record<CustomerTag, 'amber' | 'green' | 'blue' | 'red'> = { vip: 'amber', returning: 'green', new: 'blue', risky: 'red' };
const TAG_LABEL: Record<CustomerTag, string> = { vip: 'VIP', returning: 'Returning', new: 'New', risky: 'Risky' };

export function CustomersPanel({ getIdToken }: { getIdToken: () => Promise<string> }) {
  const tokenRef = useRef(getIdToken);
  tokenRef.current = getIdToken;

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [notes, setNotes] = useState<Notes>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

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
      const res = await authedFetch('/api/admin/customers');
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; customers?: CustomerRow[]; notes?: Notes };
      if (!res.ok || !data.ok) {
        setError(data.error || `Could not load customers (HTTP ${res.status}).`);
        return;
      }
      setCustomers(data.customers || []);
      setNotes(data.notes || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return customers.filter((c) => (segment === 'all' || c.tags.includes(segment)) && (!needle || c.phone.includes(needle) || c.name.toLowerCase().includes(needle)));
  }, [customers, q, segment]);

  const open = (c: CustomerRow) => {
    setSelected(c);
    setNoteDraft(notes[c.phone]?.note || '');
    setMsg('');
  };

  const saveNote = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await authedFetch('/api/admin/customers', { method: 'PATCH', body: JSON.stringify({ phone: selected.phone, note: noteDraft }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; note?: string };
      if (!res.ok || !data.ok) {
        setMsg(data.error || 'Could not save note.');
        return;
      }
      setNotes((n) => ({ ...n, [selected.phone]: { note: data.note || '', updatedAtIso: new Date().toISOString(), updatedBy: 'you' } }));
      setMsg('Saved.');
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const blob = new Blob(['﻿' + customersToCsv(filtered)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deshi-gee-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const seg = (s: Segment) => (s === 'all' ? customers.length : customers.filter((c) => c.tags.includes(s)).length);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Everyone who ordered, grouped by phone number. Tags are calculated from real order history."
        actions={
          <>
            <button type="button" onClick={exportCsv} disabled={filtered.length === 0} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.14)] bg-white px-3.5 text-xs font-medium hover:bg-[#F4EFE6] disabled:opacity-50">
              <Download className="h-3.5 w-3.5 text-[#8A5A17]" />
              <span>Export CSV ({filtered.length})</span>
            </button>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[rgba(30,23,16,0.14)] bg-white px-3.5 text-xs font-medium hover:bg-[#F4EFE6] disabled:opacity-60">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Refresh</span>
            </button>
          </>
        }
      />

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A7867]" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search phone or name" aria-label="Search customers" className="min-h-[42px] w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white pl-9 pr-3 text-base focus:border-[#B47B2B] focus:outline-none sm:text-sm" />
        </div>
        <div className="flex flex-wrap gap-2">
          {(['all', 'vip', 'returning', 'new', 'risky'] as Segment[]).map((s) => (
            <FilterChip key={s} active={segment === s} onClick={() => setSegment(s)} count={seg(s)}>
              {s === 'all' ? 'All' : TAG_LABEL[s]}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card title={`${filtered.length} customers`} className={selected ? 'lg:col-span-7' : 'lg:col-span-12'} bodyClassName="p-0">
          {filtered.length === 0 ? (
            <div className="p-5"><EmptyState title="No customers found" /></div>
          ) : (
            <ul className="divide-y divide-[rgba(30,23,16,0.06)]">
              {filtered.map((c) => (
                <li key={c.phone}>
                  <button type="button" onClick={() => open(c)} className={`flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-left hover:bg-[#FAF7F2] ${selected?.phone === c.phone ? 'bg-[#F4EFE6]' : ''}`}>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[#1E1710]">{c.name}</span>
                      <span className="block font-mono text-xs text-[#635647]">{c.phone} · {c.district || '—'}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {c.tags.map((t) => <StatusBadge key={t} status={t} label={TAG_LABEL[t]} tone={TAG_TONE[t]} />)}
                      <span className="text-xs tabular-nums text-[#8A7867]">{c.totalOrders} order{c.totalOrders === 1 ? '' : 's'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {selected && (
          <Card title={selected.name} description={selected.phone} className="lg:col-span-5" action={<a href={`tel:+88${selected.phone}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E1710] px-3 py-1.5 text-xs font-medium text-[#FAF7F2]"><Phone className="h-3.5 w-3.5" />Call</a>}>
            <div className="space-y-4 text-xs">
              <dl className="grid grid-cols-2 gap-2">
                <div><dt className="text-[#8A7867]">Orders</dt><dd className="font-medium tabular-nums">{selected.totalOrders}</dd></div>
                <div><dt className="text-[#8A7867]">Delivered</dt><dd className="font-medium tabular-nums">{selected.delivered}</dd></div>
                <div><dt className="text-[#8A7867]">Cancelled</dt><dd className="font-medium tabular-nums">{selected.cancelled}</dd></div>
                <div><dt className="text-[#8A7867]">Returned / failed</dt><dd className="font-medium tabular-nums">{selected.returnedOrFailed}</dd></div>
                {selected.deliveredRevenue !== null && (
                  <>
                    <div><dt className="text-[#8A7867]">Delivered revenue</dt><dd className="font-mono font-medium">{formatBdt(selected.deliveredRevenue)}</dd></div>
                    <div><dt className="text-[#8A7867]">Average order</dt><dd className="font-mono font-medium">{formatBdt(selected.averageOrderValue ?? 0)}</dd></div>
                  </>
                )}
                <div><dt className="text-[#8A7867]">First order</dt><dd className="font-medium">{selected.firstOrderAtIso ? dhaka.format(new Date(selected.firstOrderAtIso)) : '—'}</dd></div>
                <div><dt className="text-[#8A7867]">Last order</dt><dd className="font-medium">{selected.lastOrderAtIso ? dhaka.format(new Date(selected.lastOrderAtIso)) : '—'}</dd></div>
                <div className="col-span-2"><dt className="text-[#8A7867]">Last address</dt><dd className="font-medium">{selected.address || '—'}</dd></div>
              </dl>
              <div>
                <p className="mb-1 text-xs font-semibold text-[#3F3328]">Orders</p>
                <p className="font-mono text-[11px] leading-relaxed text-[#635647]">{selected.orderNumbers.join(' · ')}</p>
              </div>
              <label className="block">
                <span className="block text-xs font-medium text-[#3F3328]">Internal note</span>
                <textarea rows={3} maxLength={600} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-xs" />
              </label>
              <div className="flex items-center justify-between">
                <span role="status" className="text-xs font-medium text-[#8A5A17]">{msg}</span>
                <button type="button" disabled={saving} onClick={() => void saveNote()} className="rounded-lg bg-[#B47B2B] px-4 py-2 text-xs font-medium text-white hover:bg-[#96621B] disabled:opacity-50">Save note</button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
