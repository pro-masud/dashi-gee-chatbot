'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
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
import { Lang, formatBdt } from '../data/deshiGeeData';

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
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState<TrackingRecord | null>(null);

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
    setSearched(true);
    try {
      const record = await trackOrderLookup(cleanOrd, cleanPhone);
      setResult(record);
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
        </div>
      )}
    </section>
  );
}
