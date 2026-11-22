'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, PackageCheck } from 'lucide-react';
import {
  PACKAGE_BADGES,
  PACKAGE_BADGE_LABELS,
  PACKAGE_SLOTS,
  SLOT_LABELS,
  defaultPackagesState,
  packageEconomics,
  type PackageBadge,
  type PackageSlot,
  type PackagesState,
} from '../../lib/packages/packages';
import { formatBdt } from '../../data/deshiGeeData';
import { Card, NumberField, PageHeader, StatusBadge, ToggleField } from './ui';

const money = (n: number) => formatBdt(Math.round(n * 100) / 100);

export function PackagesPanel({ getIdToken }: { getIdToken: () => Promise<string> }) {
  const tokenRef = useRef(getIdToken);
  tokenRef.current = getIdToken;

  const [saved, setSaved] = useState<PackagesState>(defaultPackagesState());
  const [draft, setDraft] = useState<PackagesState>(defaultPackagesState());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
      const res = await authedFetch('/api/admin/packages');
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; packages?: PackagesState };
      if (!res.ok || !data.ok || !data.packages) {
        setError(data.error || `Could not load packages (HTTP ${res.status}).`);
        return;
      }
      setSaved(data.packages);
      setDraft(data.packages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  const update = (slot: PackageSlot, patch: Partial<PackagesState[PackageSlot]>) =>
    setDraft((d) => ({ ...d, [slot]: { ...d[slot], ...patch } }));

  const setDefault = (slot: PackageSlot) =>
    setDraft((d) => {
      const next = { ...d };
      for (const s of PACKAGE_SLOTS) next[s] = { ...next[s], isDefault: s === slot };
      return next;
    });

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMsg('');
    setError('');
    try {
      const res = await authedFetch('/api/admin/packages', { method: 'PUT', body: JSON.stringify(draft) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; packages?: PackagesState };
      if (!res.ok || !data.ok || !data.packages) {
        setError(data.error || 'Could not save packages.');
        return;
      }
      setSaved(data.packages);
      setDraft(data.packages);
      setMsg('Saved. The storefront now uses these prices and settings.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save packages.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 pb-24">
      <PageHeader
        title="Product & Packages"
        description="Set price, offer, cost and stock for each jar size. The storefront and order engine use exactly these numbers."
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[rgba(30,23,16,0.14)] bg-white px-3.5 text-xs font-medium hover:bg-[#F4EFE6] disabled:opacity-60"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Reload</span>
          </button>
        }
      />

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-xl border border-[rgba(30,23,16,0.08)] bg-[#FAF7F2] px-4 py-3 text-xs text-[#635647]">
        Customer price = <strong>offer price</strong> when set, otherwise the <strong>regular price</strong>. Sizes are fixed
        to 250g, 500g and 1kg; other sizes (for example 2kg) need an order-engine extension and are not part of this page.
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {PACKAGE_SLOTS.map((slot) => {
          const p = draft[slot];
          const e = packageEconomics(p);
          return (
            <Card
              key={slot}
              title={SLOT_LABELS[slot]}
              description={p.isDefault ? 'Default selection on the storefront' : undefined}
              action={<StatusBadge status={p.enabled ? 'verified' : 'cancelled'} label={p.enabled ? 'Enabled' : 'Disabled'} />}
              bodyClassName="space-y-4 p-5"
            >
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Regular price" prefix="৳" min={0} value={p.regularPrice} onChange={(n) => update(slot, { regularPrice: n })} />
                <NumberField label="Offer price" hint="(0 = none)" prefix="৳" min={0} value={p.offerPrice} onChange={(n) => update(slot, { offerPrice: n })} />
                <NumberField label="Cost per jar" hint="(COGS)" prefix="৳" min={0} value={p.cogs} onChange={(n) => update(slot, { cogs: n })} />
                <NumberField label="Stock (jars)" min={0} value={p.stock} onChange={(n) => update(slot, { stock: Math.floor(n) })} />
              </div>

              <div className="space-y-1.5 rounded-xl bg-[#FAF7F2] p-3 text-xs">
                <div className="flex justify-between"><span className="text-[#635647]">Customer pays</span><span className="font-mono font-semibold">{money(e.sellingPrice)}</span></div>
                <div className="flex justify-between"><span className="text-[#635647]">Discount</span><span className="font-mono">{e.discountBdt > 0 ? `${money(e.discountBdt)} (${e.discountPct}%)` : '—'}</span></div>
                <div className="flex justify-between"><span className="text-[#635647]">Profit per jar</span><span className={`font-mono font-semibold ${e.profitPerJar !== null && e.profitPerJar < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{e.profitPerJar === null ? 'Set cost to see' : `${money(e.profitPerJar)} (${e.marginPct}%)`}</span></div>
              </div>

              <label className="block">
                <span className="block text-xs font-medium text-[#3F3328]">Badge</span>
                <select value={p.badge} onChange={(ev) => update(slot, { badge: ev.target.value as PackageBadge })} className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-sm">
                  {PACKAGE_BADGES.map((b) => (
                    <option key={b || 'none'} value={b}>{PACKAGE_BADGE_LABELS[b].en}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-[#3F3328]">Short description (optional)</span>
                <input value={p.description} maxLength={200} onChange={(ev) => update(slot, { description: ev.target.value })} className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-sm" />
              </label>

              <ToggleField label="Available to order" description="Turn off to stop sales of this size (checked on the server too)." checked={p.enabled} onChange={(v) => update(slot, { enabled: v })} />

              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[#3F3328]">
                <input type="radio" name="default-package" checked={p.isDefault} disabled={!p.enabled} onChange={() => setDefault(slot)} className="accent-[#B47B2B]" />
                <PackageCheck className="h-3.5 w-3.5 text-[#8A5A17]" />
                Pre-selected for customers
              </label>
            </Card>
          );
        })}
      </div>

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-[rgba(30,23,16,0.1)] bg-white/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <p role="status" className={`min-w-0 truncate text-xs font-medium ${dirty ? 'text-amber-800' : 'text-[#8A5A17]'}`}>
            {dirty ? 'You have unsaved changes' : msg || 'All changes saved'}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={!dirty || saving} onClick={() => setDraft(saved)} className="min-h-[40px] rounded-lg border border-[rgba(30,23,16,0.14)] bg-white px-4 text-xs font-medium hover:bg-[#F4EFE6] disabled:opacity-50">
              Discard
            </button>
            <button type="submit" disabled={!dirty || saving} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#B47B2B] px-5 text-sm font-medium text-white hover:bg-[#96621B] disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>Save packages</span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
