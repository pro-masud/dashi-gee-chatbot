'use client';

import { FormEvent, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { BANGLADESH_DISTRICTS } from '../../data/deshiGeeData';

const field = 'mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base focus:border-[#B47B2B] focus:outline-none sm:text-sm';

const SOURCES: [string, string][] = [
  ['facebook_inbox', 'Facebook inbox'],
  ['whatsapp', 'WhatsApp'],
  ['phone', 'Phone call'],
  ['other', 'Other'],
];

export function ManualOrderModal({
  open,
  onClose,
  getIdToken,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  getIdToken: () => Promise<string>;
  onCreated: (orderNumber: string) => void;
}) {
  const tokenRef = useRef(getIdToken);
  tokenRef.current = getIdToken;
  const [form, setForm] = useState({
    customerName: '',
    phone: '',
    district: 'Dhaka',
    address: '',
    qty250g: 0,
    qty500g: 1,
    qty1kg: 0,
    source: 'facebook_inbox',
    note: '',
    couponCode: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const token = await tokenRef.current();
      const res = await fetch('/api/admin/orders/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; orderNumber?: string };
      if (!res.ok || !data.ok || !data.orderNumber) {
        setError(data.error || 'The order could not be created.');
        return;
      }
      onCreated(data.orderNumber);
      setForm((f) => ({ ...f, customerName: '', phone: '', address: '', note: '', couponCode: '', qty250g: 0, qty500g: 1, qty1kg: 0 }));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The order could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const num = (k: 'qty250g' | 'qty500g' | 'qty1kg', label: string) => (
    <label className="block">
      <span className="text-xs font-medium text-[#3F3328]">{label}</span>
      <input type="number" min={0} max={20} value={form[k]} onChange={(e) => setForm({ ...form, [k]: Math.max(0, Number(e.target.value) || 0) })} className={`${field} font-mono`} />
    </label>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="New manual order" className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#1E1710]">New manual order</h2>
            <p className="mt-1 text-xs text-[#635647]">For orders received on Facebook, WhatsApp or by phone. Cash on delivery. Price, stock and risk checks are done by the server.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[rgba(30,23,16,0.14)]"><X className="h-4 w-4" /></button>
        </div>

        {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className="text-xs font-medium text-[#3F3328]">Customer name *</span>
            <input required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} className={field} /></label>
          <label className="block"><span className="text-xs font-medium text-[#3F3328]">Mobile number *</span>
            <input required inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="01XXXXXXXXX" className={`${field} font-mono`} /></label>
          <label className="block"><span className="text-xs font-medium text-[#3F3328]">District *</span>
            <select value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} className={field}>
              {BANGLADESH_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select></label>
          <label className="block"><span className="text-xs font-medium text-[#3F3328]">Order came from *</span>
            <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className={field}>
              {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
        </div>
        <label className="block"><span className="text-xs font-medium text-[#3F3328]">Full delivery address *</span>
          <textarea required rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="House, road, area / thana" className={field} /></label>

        <div className="grid grid-cols-3 gap-3">{num('qty250g', '250g jars')}{num('qty500g', '500g jars')}{num('qty1kg', '1kg jars')}</div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className="text-xs font-medium text-[#3F3328]">Coupon (optional)</span>
            <input value={form.couponCode} onChange={(e) => setForm({ ...form, couponCode: e.target.value.toUpperCase() })} className={`${field} font-mono`} /></label>
          <label className="block"><span className="text-xs font-medium text-[#3F3328]">Note (optional)</span>
            <input value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} className={field} /></label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="min-h-[42px] rounded-lg border border-[rgba(30,23,16,0.14)] px-4 text-sm font-medium hover:bg-[#F4EFE6]">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#B47B2B] px-6 text-sm font-medium text-white hover:bg-[#96621B] disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>Create order</span>
          </button>
        </div>
      </form>
    </div>
  );
}
