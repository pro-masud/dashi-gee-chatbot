'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Edit3,
  Loader2,
  PackageSearch,
  Search,
  XCircle,
} from 'lucide-react';
import {
  OrderStatus,
  TrackingRecord,
  trackOrderLookup,
} from '../lib/firebase';
import {
  BANGLADESH_DISTRICTS,
  Lang,
  clientAssessAddressCompleteness,
  formatBdt,
} from '../data/deshiGeeData';

interface TrackOrderViewProps {
  lang: Lang;
  initialOrderNumber?: string;
  initialPhone?: string;
  onBackHome: () => void;
}

const ORDER_FLOW: { key: OrderStatus; en: string; bn: string }[] = [
  { key: 'pending', en: 'Pending', bn: 'অপেক্ষমাণ' },
  { key: 'confirmed', en: 'Confirmed', bn: 'নিশ্চিত' },
  { key: 'processing', en: 'Processing', bn: 'প্রস্তুত হচ্ছে' },
  { key: 'shipped', en: 'Shipped', bn: 'পথে রয়েছে' },
  { key: 'delivered', en: 'Delivered', bn: 'ডেলিভারি সম্পন্ন' },
];

export function TrackOrderView({
  lang,
  initialOrderNumber = '',
  initialPhone = '',
  onBackHome,
}: TrackOrderViewProps) {
  const [orderInput, setOrderInput] = useState(initialOrderNumber);
  const [phoneInput, setPhoneInput] = useState(initialPhone);
  const [verifiedPhone, setVerifiedPhone] = useState(initialPhone);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState<TrackingRecord | null>(null);

  // Pre-dispatch self-serve state
  const [showEditForm, setShowEditForm] = useState(false);
  const [editDistrict, setEditDistrict] = useState('Dhaka');
  const [editArea, setEditArea] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [manageLoading, setManageLoading] = useState(false);
  const [manageFeedback, setManageFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const bn = lang === 'bn';

  const runLookup = async (ord: string, ph: string) => {
    const cleanOrd = ord.trim().toUpperCase();
    const cleanPhone = ph.replace(/[\s-]/g, '');
    if (!/^DG-[0-9]{4,8}$/.test(cleanOrd)) {
      setErrorMsg(
        bn
          ? 'সঠিক অর্ডার নম্বর দিন (যেমন DG-1042)।'
          : 'Enter a valid Order ID (e.g. DG-1042).'
      );
      return;
    }
    if (!/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
      setErrorMsg(
        bn
          ? 'সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন (01XXXXXXXXX)।'
          : 'Enter the 11-digit checkout mobile number (01XXXXXXXXX).'
      );
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setManageFeedback(null);
    setShowEditForm(false);
    setShowCancelConfirm(false);
    setSearched(true);
    try {
      const record = await trackOrderLookup(cleanOrd, cleanPhone);
      setResult(record);
      if (record) {
        setVerifiedPhone(cleanPhone);
        if (record.district) setEditDistrict(record.district);
      }
    } catch {
      setErrorMsg(
        bn
          ? 'অর্ডার তথ্য লোড করতে সমস্যা হয়েছে।'
          : 'Unable to fetch order tracking status right now.'
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialOrderNumber && initialPhone) {
      runLookup(initialOrderNumber, initialPhone);
    }
  }, [initialOrderNumber, initialPhone]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    runLookup(orderInput, phoneInput);
  };

  const canSelfServeModify =
    result !== null && (result.status === 'pending' || result.status === 'confirmed');

  const handleSaveAddressChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!result || manageLoading) return;
    if (editArea.trim().length < 2) {
      setManageFeedback({
        type: 'err',
        text: bn ? 'এলাকা বা থানার নাম লিখুন।' : 'Please enter your area or thana.',
      });
      return;
    }
    const check = clientAssessAddressCompleteness(editAddress, editArea, editDistrict);
    if (!check.complete) {
      setManageFeedback({
        type: 'err',
        text: bn
          ? 'সম্পূর্ণ বাড়ি, সড়ক বা ফ্ল্যাট নম্বরসহ ঠিকানা লিখুন।'
          : 'Please enter a full delivery address with house/road details.',
      });
      return;
    }

    setManageLoading(true);
    setManageFeedback(null);
    try {
      const res = await fetch('/api/orders/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          action: 'edit_address',
          orderNumber: result.orderNumber,
          phone: verifiedPhone,
          district: editDistrict,
          area: editArea.trim(),
          address: editAddress.trim(),
          uiLang: lang,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setManageFeedback({
          type: 'err',
          text:
            (bn ? data.messageBn : data.messageEn) ||
            data.error ||
            (bn ? 'ঠিকানা পরিবর্তন করা যায়নি।' : 'Could not update delivery address.'),
        });
        return;
      }

      setResult({
        ...result,
        district: data.district || editDistrict,
        deliveryZone: data.deliveryZone || result.deliveryZone,
        deliveryFeeBdt:
          typeof data.deliveryFeeBdt === 'number' ? data.deliveryFeeBdt : result.deliveryFeeBdt,
        totalBdt: typeof data.totalBdt === 'number' ? data.totalBdt : result.totalBdt,
        estimatedDelivery: data.estimatedDelivery || result.estimatedDelivery,
      });
      setShowEditForm(false);
      setManageFeedback({
        type: 'ok',
        text:
          (bn ? data.messageBn : data.messageEn) ||
          (bn ? 'ঠিকানা সফলভাবে হালনাগাদ হয়েছে।' : 'Delivery address updated cleanly.'),
      });
    } catch {
      setManageFeedback({
        type: 'err',
        text: bn ? 'নেটওয়ার্ক ত্রুটি হয়েছে।' : 'Network error updating address.',
      });
    } finally {
      setManageLoading(false);
    }
  };

  const handleConfirmCancelOrder = async () => {
    if (!result || manageLoading) return;
    setManageLoading(true);
    setManageFeedback(null);
    try {
      const res = await fetch('/api/orders/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          action: 'cancel',
          orderNumber: result.orderNumber,
          phone: verifiedPhone,
          reason: cancelReason.trim(),
          uiLang: lang,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setManageFeedback({
          type: 'err',
          text:
            (bn ? data.messageBn : data.messageEn) ||
            data.error ||
            (bn ? 'অর্ডার বাতিল করা যায়নি।' : 'Could not cancel order right now.'),
        });
        return;
      }

      setResult({
        ...result,
        status: 'cancelled',
      });
      setShowCancelConfirm(false);
      setManageFeedback({
        type: 'ok',
        text:
          (bn ? data.messageBn : data.messageEn) ||
          (bn ? 'অর্ডারটি বাতিল করা হয়েছে।' : 'Your order has been cancelled.'),
      });
    } catch {
      setManageFeedback({
        type: 'err',
        text: bn ? 'নেটওয়ার্ক ত্রুটি হয়েছে।' : 'Network error cancelling order.',
      });
    } finally {
      setManageLoading(false);
    }
  };

  const activeStepIdx = result
    ? ORDER_FLOW.findIndex((s) => s.key === result.status)
    : -1;

  return (
    <section className="mx-auto min-h-[75vh] max-w-3xl px-4 py-10 sm:px-8 sm:py-14">
      <button
        type="button"
        onClick={onBackHome}
        className="inline-flex min-h-[40px] items-center gap-2 text-sm font-medium text-[#635647] hover:text-[#1E1710]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>{bn ? 'স্টোরফ্রন্টে ফিরে যান' : 'Back to Deshi Gee'}</span>
      </button>

      <div className="mt-5 sm:mt-6">
        <p className="text-xs font-medium uppercase tracking-widest text-[#8A5A17]">
          {bn ? 'লাইভ অর্ডার স্ট্যাটাস' : 'Order Tracking'}
        </p>
        <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight text-[#1E1710] sm:text-4xl">
          {bn ? 'আপনার দেশী ঘি অর্ডার ট্র্যাক করুন' : 'Track Your Deshi Gee Order'}
        </h1>
        <p className="mt-2 text-sm text-[#635647]">
          {bn
            ? 'অর্ডার নিশ্চিতকরণের সময় পাওয়া অর্ডার আইডি এবং আপনার মোবাইল নম্বর দিন।'
            : 'Enter your Order ID and verified checkout phone number to inspect live dispatch status.'}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-7 grid grid-cols-1 gap-4 rounded-3xl border border-[rgba(30,23,16,0.12)] bg-[#F4EFE6]/80 p-5 sm:mt-8 sm:grid-cols-12 sm:p-7 shadow-xs"
      >
        <div className="sm:col-span-5">
          <label htmlFor="trk-id" className="block text-xs font-semibold text-[#635647]">
            {bn ? 'অর্ডার আইডি' : 'Order ID'}
          </label>
          <input
            id="trk-id"
            type="text"
            value={orderInput}
            onChange={(e) => setOrderInput(e.target.value.toUpperCase())}
            placeholder="DG-1042"
            className="mt-1.5 w-full rounded-xl border border-[rgba(30,23,16,0.16)] bg-[#FFFDF9] px-4 py-2.5 font-mono text-base uppercase text-[#1E1710] shadow-xs focus:border-[#B47B2B] focus:outline-none sm:text-sm"
          />
        </div>

        <div className="sm:col-span-4">
          <label htmlFor="trk-phone" className="block text-xs font-semibold text-[#635647]">
            {bn ? 'মোবাইল নম্বর' : 'Mobile Number'}
          </label>
          <input
            id="trk-phone"
            type="tel"
            inputMode="tel"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder="017XXXXXXXX"
            className="mt-1.5 w-full rounded-xl border border-[rgba(30,23,16,0.16)] bg-[#FFFDF9] px-4 py-2.5 font-mono text-base text-[#1E1710] shadow-xs focus:border-[#B47B2B] focus:outline-none sm:text-sm"
          />
        </div>

        <div className="flex items-end sm:col-span-3">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#B47B2B] to-[#96621B] px-5 py-2.5 text-sm font-bold text-[#FFFDF9] shadow-xs hover:scale-[1.01] disabled:opacity-60 transition-all"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#FFFDF9]" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            <span>{bn ? 'খুঁজুন' : 'Track'}</span>
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800 sm:col-span-12"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </form>

      {/* Tracking Result or Empty State */}
      {searched && !loading && !errorMsg && !result && (
        <div className="mt-8 flex flex-col items-center rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-10 text-center">
          <PackageSearch className="h-10 w-10 text-[#8A5A17]" />
          <h2 className="font-display mt-3 text-xl font-semibold text-[#1E1710]">
            {bn ? 'কোনো অর্ডার খুঁজে পাওয়া যায়নি' : 'No Matching Order Found'}
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-[#635647]">
            {bn
              ? 'দয়া করে আপনার অর্ডার আইডি (যেমন DG-1042) এবং অর্ডারের সময় ব্যবহৃত মোবাইল নম্বর মিলিয়ে আবার চেষ্টা করুন।'
              : 'Double-check your Order ID and the exact 11-digit mobile number entered at checkout.'}
          </p>
        </div>
      )}

      {result && (
        <div className="mt-8 space-y-6 rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[rgba(30,23,16,0.10)] pb-5">
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-[#8A5A17] tabular-nums">
                {result.orderNumber}
                {result.district ? ` · ${result.district}` : ''}
              </p>
              <h2 className="font-display mt-1 text-2xl font-semibold text-[#1E1710]">
                {result.itemsSummary || `${result.weight} × ${result.qty}`} ·{' '}
                <span className="font-mono tabular-nums">
                  {formatBdt(result.totalBdt)}
                </span>
              </h2>
            </div>

            <div className="text-left text-xs sm:text-right">
              <p className="text-[#635647]">
                {bn ? 'পেমেন্ট অবস্থা' : 'Payment Status'}
              </p>
              <p className="mt-0.5 font-medium text-[#1E1710]">
                {result.paymentMethod.toUpperCase()} ·{' '}
                {result.paymentStatus === 'verified'
                  ? bn
                    ? 'যাচাইকৃত'
                    : 'Verified'
                  : result.paymentStatus === 'pending_verification'
                    ? bn
                      ? 'যাচাই অপেক্ষমাণ'
                      : 'Pending Verification'
                    : result.paymentStatus === 'failed'
                      ? bn
                        ? 'ব্যর্থ'
                        : 'Failed'
                      : bn
                        ? 'ক্যাশ অন ডেলিভারি'
                        : 'Due on Delivery'}
              </p>
            </div>
          </div>

          {result.status === 'cancelled' ? (
            <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <XCircle className="h-5 w-5 shrink-0" />
              <span>
                {bn
                  ? 'এই অর্ডারটি বাতিল করা হয়েছে।'
                  : 'This order has been cancelled.'}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              {ORDER_FLOW.map((step, idx) => {
                const completed = activeStepIdx >= idx;
                return (
                  <div
                    key={step.key}
                    className={`rounded-xl border p-3.5 transition-colors ${
                      completed
                        ? 'border-[#B47B2B] bg-[#F2ECE1]'
                        : 'border-[rgba(30,23,16,0.10)] bg-[#FAF7F2]/60 opacity-65'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2
                        className={`h-4 w-4 shrink-0 ${
                          completed ? 'text-[#8A5A17]' : 'text-[#635647]/40'
                        }`}
                      />
                      <span className="font-mono text-[11px] tabular-nums text-[#635647]">
                        0{idx + 1}
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-[#1E1710]">
                      {bn ? step.bn : step.en}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-[#635647]">
            {bn ? 'সম্ভাব্য ডেলিভারি সময়:' : 'Estimated Delivery Window:'}{' '}
            <span className="font-medium text-[#1E1710]">
              {result.estimatedDelivery}
            </span>
          </p>

          {manageFeedback && (
            <div
              role="status"
              className={`rounded-xl border px-4 py-3 text-xs font-medium ${
                manageFeedback.type === 'ok'
                  ? 'border-[#B47B2B]/40 bg-[#F2ECE1] text-[#1E1710]'
                  : 'border-red-300 bg-red-50 text-red-800'
              }`}
            >
              {manageFeedback.text}
            </div>
          )}

          {/* Pre-Dispatch Self-Serve Management */}
          {canSelfServeModify ? (
            <div className="space-y-4 border-t border-[rgba(30,23,16,0.10)] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-[#635647]">
                  {bn
                    ? 'ডেলিভারি পাঠানোর আগে আপনি ঠিকানা পরিবর্তন বা অর্ডার বাতিল করতে পারেন।'
                    : 'Before dispatch, you can update your delivery address or cancel this order.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditForm((v) => !v);
                      setShowCancelConfirm(false);
                    }}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.2)] bg-[#FAF7F2] px-3 py-1.5 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
                  >
                    <Edit3 className="h-3.5 w-3.5 text-[#8A5A17]" />
                    <span>{bn ? 'ঠিকানা পরিবর্তন' : 'Edit Delivery Address'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCancelConfirm((v) => !v);
                      setShowEditForm(false);
                    }}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>{bn ? 'অর্ডার বাতিল' : 'Cancel Order'}</span>
                  </button>
                </div>
              </div>

              {showEditForm && (
                <form
                  onSubmit={handleSaveAddressChange}
                  className="space-y-3 rounded-xl border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] p-4"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-[#635647]">
                        {bn ? 'নতুন জেলা *' : 'New District *'}
                      </label>
                      <select
                        value={editDistrict}
                        onChange={(e) => setEditDistrict(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-2 text-sm text-[#1E1710]"
                      >
                        {BANGLADESH_DISTRICTS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#635647]">
                        {bn ? 'এলাকা / থানা *' : 'Area / Thana *'}
                      </label>
                      <input
                        type="text"
                        required
                        value={editArea}
                        onChange={(e) => setEditArea(e.target.value)}
                        placeholder={bn ? 'যেমন: সাভার / উত্তরা' : 'e.g. Savar / Uttara'}
                        className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-2 text-sm text-[#1E1710]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#635647]">
                      {bn ? 'সম্পূর্ণ সড়ক ও বাড়ির ঠিকানা *' : 'Complete Street Address *'}
                    </label>
                    <input
                      type="text"
                      required
                      value={editAddress}
                      onChange={(e) => setEditAddress(e.target.value)}
                      placeholder={bn ? 'বাড়ি ১২, রোড ৪, সেক্টর ১০' : 'House 12, Road 4, Sector 10'}
                      className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-2 text-sm text-[#1E1710]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={manageLoading}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#B47B2B] px-4 py-2 text-xs font-semibold text-[#FFFDF9] disabled:opacity-60"
                    >
                      {manageLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>
                        {bn ? 'নতুন ঠিকানা সংরক্ষণ ও চার্জ হিসাব করুন' : 'Save Address & Recalculate Fee'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowEditForm(false)}
                      className="min-h-[40px] rounded-lg border border-[rgba(30,23,16,0.18)] px-4 py-2 text-xs font-medium text-[#635647]"
                    >
                      {bn ? 'বন্ধ করুন' : 'Dismiss'}
                    </button>
                  </div>
                </form>
              )}

              {showCancelConfirm && (
                <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/70 p-4">
                  <p className="text-xs font-semibold text-red-900">
                    {bn
                      ? `আপনি কি নিশ্চিতভাবে অর্ডার ${result.orderNumber} বাতিল করতে চান?`
                      : `Confirm cancellation of order ${result.orderNumber}?`}
                  </p>
                  <input
                    type="text"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder={
                      bn ? 'বাতিলের কারণ (ঐচ্ছিক)' : 'Reason for cancellation (optional)'
                    }
                    className="w-full rounded-lg border border-red-200 bg-[#FFFDF9] px-3 py-2 text-xs text-[#1E1710]"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={manageLoading}
                      onClick={handleConfirmCancelOrder}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {manageLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>{bn ? 'হ্যাঁ, অর্ডার বাতিল করুন' : 'Yes, Cancel Order'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCancelConfirm(false)}
                      className="min-h-[38px] rounded-lg border border-[rgba(30,23,16,0.2)] bg-[#FFFDF9] px-4 py-2 text-xs font-medium text-[#1E1710]"
                    >
                      {bn ? 'ফিরে যান' : 'Keep Order'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : result.status !== 'cancelled' ? (
            <div className="border-t border-[rgba(30,23,16,0.10)] pt-4 text-xs text-[#635647]">
              {bn
                ? 'এই অর্ডারটি ইতিমধ্যে প্যাকেজিং বা কুরিয়ার পর্যায়ে চলে যাওয়ায় অনলাইনে পরিবর্তন বন্ধ রয়েছে। জরুরি প্রয়োজনে আমাদের সাপোর্টে যোগাযোগ করুন।'
                : 'This order is already being processed/shipped, so online edits or cancellation are locked. Please contact customer support if urgent.'}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
