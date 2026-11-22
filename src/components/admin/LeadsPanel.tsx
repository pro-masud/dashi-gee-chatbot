'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, Phone, Search } from 'lucide-react';
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  leadsToCsv,
  type LeadDoc,
  type LeadStatus,
} from '../../lib/leads/leads';
import { Card, EmptyState, FilterChip, PageHeader, StatusBadge } from './ui';

interface Activity {
  id: string;
  type: string;
  text: string;
  byEmail: string;
  atIso: string;
}

const dhaka = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' });
const tone = (s: LeadStatus) =>
  s === 'converted' ? 'green' : s === 'not_interested' || s === 'invalid_number' || s === 'closed' ? 'neutral' : s === 'interested' ? 'blue' : 'amber';

export function LeadsPanel({ getIdToken }: { getIdToken: () => Promise<string> }) {
  const tokenRef = useRef(getIdToken);
  tokenRef.current = getIdToken;

  const [leads, setLeads] = useState<LeadDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'open' | 'all' | LeadStatus>('open');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<LeadDoc | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

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
      const res = await authedFetch('/api/admin/leads');
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; leads?: LeadDoc[] };
      if (!res.ok || !data.ok) {
        setError(data.error || `Could not load leads (HTTP ${res.status}).`);
        return;
      }
      setLeads(data.leads || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const openLead = async (lead: LeadDoc) => {
    setSelected(lead);
    setNote('');
    setMsg('');
    setActivities([]);
    const res = await authedFetch(`/api/admin/leads?phone=${lead.phone}`);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; activities?: Activity[] };
    if (res.ok && data.ok) setActivities(data.activities || []);
  };

  const patch = async (body: { status?: LeadStatus; note?: string; followUpDate?: string }) => {
    if (!selected || busy) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await authedFetch('/api/admin/leads', { method: 'PATCH', body: JSON.stringify({ phone: selected.phone, ...body }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; lead?: LeadDoc };
      if (!res.ok || !data.ok || !data.lead) {
        setMsg(data.error || 'Could not update lead.');
        return;
      }
      setSelected(data.lead);
      setLeads((prev) => prev.map((l) => (l.phone === data.lead!.phone ? data.lead! : l)));
      setNote('');
      setMsg('Saved.');
      const a = await authedFetch(`/api/admin/leads?phone=${selected.phone}`);
      const ad = (await a.json().catch(() => ({}))) as { ok?: boolean; activities?: Activity[] };
      if (a.ok && ad.ok) setActivities(ad.activities || []);
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim();
    return leads.filter((l) => {
      if (filter === 'open' && ['converted', 'not_interested', 'invalid_number', 'closed'].includes(l.status)) return false;
      if (filter !== 'open' && filter !== 'all' && l.status !== filter) return false;
      return !needle || l.phone.includes(needle) || l.name.toLowerCase().includes(needle.toLowerCase());
    });
  }, [leads, filter, q]);

  const exportCsv = () => {
    const blob = new Blob(['﻿' + leadsToCsv(filtered)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deshi-gee-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const items = (l: LeadDoc) =>
    [l.qty250g && `${l.qty250g}×250g`, l.qty500g && `${l.qty500g}×500g`, l.qty1kg && `${l.qty1kg}×1kg`].filter(Boolean).join(' · ');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incomplete Leads"
        description="Visitors who entered a phone number at checkout but did not finish. Call them back before the interest fades."
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
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search phone or name" aria-label="Search leads" className="min-h-[42px] w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white pl-9 pr-3 text-base focus:border-[#B47B2B] focus:outline-none sm:text-sm" />
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip active={filter === 'open'} onClick={() => setFilter('open')} count={leads.filter((l) => !['converted', 'not_interested', 'invalid_number', 'closed'].includes(l.status)).length}>
            Open
          </FilterChip>
          <FilterChip active={filter === 'converted'} onClick={() => setFilter('converted')} count={leads.filter((l) => l.status === 'converted').length}>
            Converted
          </FilterChip>
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} count={leads.length}>
            All
          </FilterChip>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card title={`${filtered.length} leads`} className={selected ? 'lg:col-span-7' : 'lg:col-span-12'} bodyClassName="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No leads here" description="Leads appear when a visitor types a valid phone number at checkout." />
            </div>
          ) : (
            <ul className="divide-y divide-[rgba(30,23,16,0.06)]">
              {filtered.map((l) => (
                <li key={l.phone}>
                  <button type="button" onClick={() => void openLead(l)} className={`flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-left hover:bg-[#FAF7F2] ${selected?.phone === l.phone ? 'bg-[#F4EFE6]' : ''}`}>
                    <span className="min-w-0">
                      <span className="block font-mono text-sm font-semibold">{l.phone}</span>
                      <span className="block truncate text-xs text-[#635647]">
                        {l.name || 'No name yet'} · {l.district || '—'} · {items(l)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] text-[#8A7867]">{dhaka.format(new Date(l.lastCapturedAtIso))}</span>
                      <StatusBadge status={l.status} label={LEAD_STATUS_LABELS[l.status]} tone={tone(l.status)} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {selected && (
          <Card title={selected.phone} description={selected.name || 'Name not entered'} className="lg:col-span-5" action={<a href={`tel:+88${selected.phone}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E1710] px-3 py-1.5 text-xs font-medium text-[#FAF7F2]"><Phone className="h-3.5 w-3.5" />Call</a>}>
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div><dt className="text-[#8A7867]">Wanted</dt><dd className="font-medium">{items(selected) || '—'}</dd></div>
                <div><dt className="text-[#8A7867]">District</dt><dd className="font-medium">{selected.district || '—'}</dd></div>
                <div><dt className="text-[#8A7867]">Source</dt><dd className="font-medium">{selected.utmSource || (selected.fromFacebookClick ? 'Facebook ad click' : 'Direct')}</dd></div>
                <div><dt className="text-[#8A7867]">Times seen</dt><dd className="font-medium tabular-nums">{selected.touchCount}</dd></div>
                {selected.convertedOrderNumber && (
                  <div className="col-span-2"><dt className="text-[#8A7867]">Converted to order</dt><dd className="font-mono font-medium">{selected.convertedOrderNumber}</dd></div>
                )}
              </dl>

              {selected.status !== 'converted' && (
                <label className="block">
                  <span className="block text-xs font-medium text-[#3F3328]">Status</span>
                  <select value={selected.status} disabled={busy} onChange={(e) => void patch({ status: e.target.value as LeadStatus })} className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-xs">
                    {LEAD_STATUSES.filter((s) => s !== 'converted').map((s) => (
                      <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block">
                <span className="block text-xs font-medium text-[#3F3328]">Follow-up date</span>
                <input type="date" value={selected.followUpDate || ''} disabled={busy} onChange={(e) => void patch({ followUpDate: e.target.value })} className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-xs" />
              </label>

              <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (note.trim()) void patch({ note }); }} className="space-y-2">
                <label className="block">
                  <span className="block text-xs font-medium text-[#3F3328]">Add call note</span>
                  <textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-xs" />
                </label>
                <div className="flex items-center justify-between">
                  <span role="status" className="text-xs font-medium text-[#8A5A17]">{msg}</span>
                  <button type="submit" disabled={busy || !note.trim()} className="rounded-lg bg-[#B47B2B] px-4 py-2 text-xs font-medium text-white hover:bg-[#96621B] disabled:opacity-50">Save note</button>
                </div>
              </form>

              <div>
                <p className="mb-2 text-xs font-semibold text-[#3F3328]">History</p>
                {activities.length === 0 ? (
                  <p className="text-xs text-[#8A7867]">No notes yet.</p>
                ) : (
                  <ul className="max-h-56 space-y-2 overflow-y-auto">
                    {activities.map((a) => (
                      <li key={a.id} className="rounded-lg bg-[#FAF7F2] px-3 py-2 text-xs">
                        <p>{a.text}</p>
                        <p className="mt-0.5 text-[10px] text-[#8A7867]">{a.byEmail} · {dhaka.format(new Date(a.atIso))}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
