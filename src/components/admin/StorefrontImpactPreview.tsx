'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  Phone,
  RotateCcw,
  ShoppingBag,
  Truck,
  Wallet,
} from 'lucide-react';
import {
  getConfirmedDeliveryFeeForZone,
  getConfirmedPriceForWeight,
  hasValidRealContact,
  hasValidRealPhone,
  isStorefrontOrderingReady,
  type StoreSettingsDoc,
  type WeightKey,
} from '../../lib/storeTypes';
import { formatBdt } from '../../data/deshiGeeData';

interface StorefrontImpactPreviewProps {
  savedSettings: StoreSettingsDoc;
  draftSettings: StoreSettingsDoc;
  onResetDraft: () => void;
}

interface DiffItem {
  label: string;
  section: string;
  before: string;
  after: string;
}

const TRACKED_FIELDS: Array<{
  key: keyof StoreSettingsDoc;
  label: string;
  section: string;
  isCurrency?: boolean;
}> = [
  { key: 'price250g', label: '250g Jar Price', section: 'Hero & Jar Selector', isCurrency: true },
  { key: 'price500g', label: '500g Jar Price', section: 'Hero & Jar Selector', isCurrency: true },
  { key: 'price1kg', label: '1kg Jar Price', section: 'Hero & Jar Selector', isCurrency: true },
  { key: 'stock250g', label: '250g Stock', section: 'Hero & Jar Selector' },
  { key: 'stock500g', label: '500g Stock', section: 'Hero & Jar Selector' },
  { key: 'stock1kg', label: '1kg Stock', section: 'Hero & Jar Selector' },
  { key: 'insideDhakaFee', label: 'Dhaka City Delivery', section: 'Checkout Delivery', isCurrency: true },
  { key: 'dhakaSuburbanFee', label: 'Dhaka Suburban Delivery', section: 'Checkout Delivery', isCurrency: true },
  { key: 'outsideDhakaFee', label: 'Nationwide Delivery', section: 'Checkout Delivery', isCurrency: true },
  { key: 'remoteDistrictFee', label: 'Remote Districts Delivery', section: 'Checkout Delivery', isCurrency: true },
  { key: 'freeDeliveryThreshold', label: 'Free Delivery Bar', section: 'Announcement Bar', isCurrency: true },
  { key: 'dispatchCutoffHourBst', label: 'Dispatch Cutoff (BST)', section: 'Checkout & Chatbot' },
  { key: 'codHighValueThresholdBdt', label: 'High-Value COD Flag', section: 'Order Risk Review', isCurrency: true },
  { key: 'bkashNumber', label: 'bKash Number', section: 'Checkout Payments' },
  { key: 'nagadNumber', label: 'Nagad Number', section: 'Checkout Payments' },
  { key: 'advanceDiscountPct', label: 'Advance MFS Discount (%)', section: 'Checkout Payments' },
  { key: 'codConfirmEnabled', label: 'COD Phone Confirm Policy', section: 'Checkout Payments' },
  { key: 'whatsappNumber', label: 'WhatsApp Number', section: 'Footer & Support' },
  { key: 'supportPhone', label: 'Support Phone', section: 'Footer & Support' },
  { key: 'supportEmail', label: 'Support Email', section: 'Footer & Support' },
  { key: 'businessAddress', label: 'Business Address', section: 'Footer & Receipts' },
  { key: 'activeBatchCode', label: 'Active Batch Code', section: 'Provenance Badge' },
];

function formatSettingVal(val: unknown, isCurrency?: boolean): string {
  if (typeof val === 'boolean') return val ? 'Enabled' : 'Disabled';
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) return 'Unset (0)';
    return isCurrency ? formatBdt(val) : String(val);
  }
  const s = String(val ?? '').trim();
  return s || 'Unset';
}

export function StorefrontImpactPreview({
  savedSettings,
  draftSettings,
  onResetDraft,
}: StorefrontImpactPreviewProps) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // Build a draft copy whose ownerConfirmedFields mirrors how saveStoreSettings confirms non-zero/non-empty inputs
  const previewSettings = useMemo<StoreSettingsDoc>(() => {
    const confirmed: Record<string, boolean> = { ...(draftSettings.ownerConfirmedFields || {}) };
    const numericFields: Array<keyof StoreSettingsDoc> = [
      'price250g',
      'price500g',
      'price1kg',
      'stock250g',
      'stock500g',
      'stock1kg',
      'insideDhakaFee',
      'dhakaSuburbanFee',
      'outsideDhakaFee',
      'remoteDistrictFee',
      'freeDeliveryThreshold',
    ];
    for (const f of numericFields) {
      const v = Number(draftSettings[f] || 0);
      confirmed[f] = Number.isFinite(v) && v > 0;
    }
    return { ...draftSettings, ownerConfirmedFields: confirmed };
  }, [draftSettings]);

  const diffs = useMemo<DiffItem[]>(() => {
    const changes: DiffItem[] = [];
    for (const item of TRACKED_FIELDS) {
      const before = formatSettingVal(savedSettings[item.key], item.isCurrency);
      const after = formatSettingVal(draftSettings[item.key], item.isCurrency);
      if (before !== after) {
        changes.push({
          label: item.label,
          section: item.section,
          before,
          after,
        });
      }
    }
    return changes;
  }, [savedSettings, draftSettings]);

  const orderingReady = isStorefrontOrderingReady(previewSettings);
  const dhakaFee = getConfirmedDeliveryFeeForZone(previewSettings, 'dhaka');
  const outsideFee = getConfirmedDeliveryFeeForZone(previewSettings, 'nationwide');
  const hasBkash = hasValidRealPhone(previewSettings.bkashNumber);
  const hasNagad = hasValidRealPhone(previewSettings.nagadNumber);
  const hasWhatsapp = hasValidRealPhone(previewSettings.whatsappNumber);
  const hasSupportPhone = hasValidRealPhone(previewSettings.supportPhone);
  const hasSupportEmail = hasValidRealContact(previewSettings.supportEmail);

  const weights: WeightKey[] = ['250g', '500g', '1kg'];

  return (
    <div className="rounded-2xl border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] p-4 sm:p-5 md:col-span-3">
      {/* Preview Header */}
      <div className="flex flex-col gap-2 border-b border-[rgba(30,23,16,0.10)] pb-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A5A17]">
            <Eye className="h-3.5 w-3.5" />
            <span>Live Frontend Impact Preview</span>
          </p>
          <p className="mt-0.5 text-xs text-[#635647]">
            Shows exactly how your edits will appear on the live customer storefront once saved.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`font-mono text-xs font-semibold ${
              diffs.length > 0 ? 'text-[#8A5A17]' : 'text-[#635647]'
            }`}
          >
            {diffs.length > 0 ? `${diffs.length} unsaved change(s)` : 'In sync with live store'}
          </span>
          {diffs.length > 0 &&
            (!confirmingDiscard ? (
              <button
                type="button"
                onClick={() => setConfirmingDiscard(true)}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-[rgba(30,23,16,0.16)] bg-[#FFFDF9] px-2.5 py-1 text-[11px] font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Discard Draft</span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-950">
                <span>Revert unsaved edits to saved store settings?</span>
                <button
                  type="button"
                  onClick={() => {
                    onResetDraft();
                    setConfirmingDiscard(false);
                  }}
                  className="rounded bg-[#1E1710] px-2 py-0.5 font-medium text-[#FAF7F2]"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDiscard(false)}
                  className="rounded border border-amber-400 bg-white px-2 py-0.5 font-medium text-amber-950"
                >
                  Cancel
                </button>
              </div>
            ))}
        </div>
      </div>

      {/* Before → After Diff Table (shown when there are unsaved changes) */}
      {diffs.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-[#FFFDF9] p-3.5">
          <p className="text-xs font-semibold text-[#1E1710]">
            Pending Changes (Before → After) · Goes live immediately on Save
          </p>
          <div className="mt-2.5 divide-y divide-[rgba(30,23,16,0.08)] text-xs">
            {diffs.map((d) => (
              <div
                key={d.label}
                className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <span className="font-medium text-[#1E1710]">{d.label}</span>
                  <span className="ml-2 text-[11px] text-[#635647]">· {d.section}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
                  <span className="text-[#635647] line-through">{d.before}</span>
                  <ArrowRight className="h-3 w-3 text-[#8A5A17]" />
                  <span className="font-semibold text-emerald-800">{d.after}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Miniature Storefront Preview Grid */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 1. Ordering Readiness & Product Jar Cards */}
        <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[#1E1710]">
              <ShoppingBag className="h-3.5 w-3.5 text-[#8A5A17]" />
              <span>Storefront Pricing &amp; Stock</span>
            </p>
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                orderingReady ? 'text-emerald-800' : 'text-amber-800'
              }`}
            >
              {orderingReady ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <AlertTriangle className="h-3 w-3" />
              )}
              {orderingReady ? 'Ordering Live' : 'Ordering Paused'}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {weights.map((w) => {
              const price = getConfirmedPriceForWeight(previewSettings, w);
              const stock =
                w === '250g'
                  ? previewSettings.stock250g
                  : w === '500g'
                    ? previewSettings.stock500g
                    : previewSettings.stock1kg;
              return (
                <div
                  key={w}
                  className="rounded-lg border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-2.5 text-center"
                >
                  <p className="font-mono text-[11px] font-semibold text-[#1E1710]">{w}</p>
                  <p className="font-mono mt-1 text-xs font-semibold tabular-nums text-[#8A5A17]">
                    {price ? formatBdt(price) : 'Unset'}
                  </p>
                  <p
                    className={`mt-0.5 text-[10px] ${
                      stock > 0 ? 'text-emerald-800' : 'text-red-700'
                    }`}
                  >
                    {stock > 0 ? `${stock} in stock` : 'Out of stock'}
                  </p>
                </div>
              );
            })}
          </div>

          {!orderingReady && (
            <p className="mt-2.5 text-[11px] text-amber-900">
              Customers will see &ldquo;Ordering is temporarily unavailable&rdquo; until at least one
              jar price and base delivery fee are confirmed.
            </p>
          )}
        </div>

        {/* 2. Announcement Bar & Checkout Payment Methods */}
        <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-4 space-y-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[#1E1710]">
              <Truck className="h-3.5 w-3.5 text-[#8A5A17]" />
              <span>Announcement Bar &amp; Delivery</span>
            </p>
            <div className="mt-2 rounded-lg bg-[#1E1710] px-3 py-2 text-[11px] text-[#FAF7F2]">
              {previewSettings.freeDeliveryThreshold > 0
                ? `Free delivery on orders above ${formatBdt(previewSettings.freeDeliveryThreshold)}`
                : 'Free delivery banner hidden (threshold is 0)'}
            </div>
            <p className="mt-1.5 font-mono text-[11px] tabular-nums text-[#635647]">
              Dhaka: {dhakaFee !== null ? formatBdt(dhakaFee) : 'Unset'} · Nationwide:{' '}
              {outsideFee !== null ? formatBdt(outsideFee) : 'Unset'}
            </p>
          </div>

          <div className="border-t border-[rgba(30,23,16,0.08)] pt-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[#1E1710]">
              <Wallet className="h-3.5 w-3.5 text-[#8A5A17]" />
              <span>Checkout Payment Options Shown</span>
            </p>
            <p className="mt-1 text-[11px] text-[#635647]">
              {[
                'Cash on Delivery (COD)',
                hasBkash ? 'bKash' : null,
                hasNagad ? 'Nagad' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {previewSettings.advanceDiscountPct > 0 && (hasBkash || hasNagad) && (
              <p className="mt-0.5 font-mono text-[11px] text-emerald-800">
                Advance MFS Discount: {previewSettings.advanceDiscountPct}% off
              </p>
            )}
          </div>
        </div>

        {/* 3. Public Contact, WhatsApp & Provenance Visibility */}
        <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[#1E1710]">
            <Phone className="h-3.5 w-3.5 text-[#8A5A17]" />
            <span>Footer &amp; Support Contact Visibility</span>
          </p>
          <dl className="mt-2.5 space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-2">
              <dt className="text-[#635647]">WhatsApp Button</dt>
              <dd className={`font-mono ${hasWhatsapp ? 'text-emerald-800' : 'text-[#635647]'}`}>
                {hasWhatsapp ? previewSettings.whatsappNumber : 'Hidden (unset)'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#635647]">Support Phone</dt>
              <dd className={`font-mono ${hasSupportPhone ? 'text-emerald-800' : 'text-[#635647]'}`}>
                {hasSupportPhone ? previewSettings.supportPhone : 'Hidden (unset)'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#635647]">Support Email</dt>
              <dd className={`truncate font-mono ${hasSupportEmail ? 'text-emerald-800' : 'text-[#635647]'}`}>
                {hasSupportEmail ? previewSettings.supportEmail : 'Hidden (unset)'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#635647]">Active Batch</dt>
              <dd className="font-mono text-[#1E1710]">
                {previewSettings.activeBatchCode || 'Unset'}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
