'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Loader2,
  MapPin,
  Minus,
  Phone,
  Plus,
  ShieldCheck,
  Tag,
  Truck,
  User,
} from 'lucide-react';
import {
  CouponRecord,
  OrderRecord,
  PaymentMethod,
  StoreSettingsDoc,
  WeightKey,
  getConfirmedPriceForWeight,
  hasValidRealPhone,
  isStorefrontOrderingReady,
} from '../../lib/firebase';
import {
  BANGLADESH_DISTRICTS,
  clientResolveZoneFromDistrictAndArea,
  formatBdt,
  toBengaliDigits,
} from '../../data/deshiGeeData';
import type { PublicPackages } from '../../lib/packages/packages';
import {
  CHECKOUT_SECTION,
  FRESH_IMAGES,
  FRESH_WEIGHT_OPTIONS,
  FreshLang,
  computeFreshCheckoutTotals,
  getFreshStockForWeight,
  validateFreshCheckoutInput,
} from '../../data/freshStorefrontContent';
import { trackStoreEvent } from '../../lib/analytics';
import { ResilientImage } from '../ResilientImage';

interface EmbeddedOrderSectionProps {
  lang: FreshLang;
  settings: StoreSettingsDoc;
  packageMeta: PublicPackages | null;
  selectedWeight: WeightKey;
  onSelectWeight: (w: WeightKey) => void;
  qty: number;
  onChangeQty: (nextQty: number) => void;
  onOrderConfirmed: (order: OrderRecord) => void;
  onNavigateTrack: (orderNumber: string, phone: string) => void;
  onOpenCallback: () => void;
  onOpenChat: () => void;
}

export function EmbeddedOrderSection({
  lang,
  settings,
  packageMeta,
  selectedWeight,
  onSelectWeight,
  qty,
  onChangeQty,
  onOrderConfirmed,
  onNavigateTrack,
  onOpenCallback,
  onOpenChat,
}: EmbeddedOrderSectionProps) {
  const bn = lang === 'bn';
  const orderingReady = isStorefrontOrderingReady(settings);

  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [district, setDistrict] = useState('Dhaka');
  const [area, setArea] = useState('');
  const [address, setAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [txnId, setTxnId] = useState('');

  const [showCoupon, setShowCoupon] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<CouponRecord | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponMsg, setCouponMsg] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [unavailableMsg, setUnavailableMsg] = useState('');
  const [confirmedOrder, setConfirmedOrder] = useState<OrderRecord | null>(null);

  const zone = useMemo(
    () => clientResolveZoneFromDistrictAndArea(district, area),
    [district, area]
  );

  const availableOptions = useMemo(
    () =>
      FRESH_WEIGHT_OPTIONS.filter((opt) =>
        packageMeta ? packageMeta[opt.weight]?.enabled !== false : true
      ),
    [packageMeta]
  );

  const selectedOption =
    FRESH_WEIGHT_OPTIONS.find((o) => o.weight === selectedWeight) || FRESH_WEIGHT_OPTIONS[0];
  const currentStock = getFreshStockForWeight(settings, selectedWeight);
  const maxOrderable = Math.min(20, orderingReady && currentStock > 0 ? currentStock : 10);

  const couponDiscountBdt = useMemo(() => {
    if (!appliedCoupon) return 0;
    const unit = getConfirmedPriceForWeight(settings, selectedWeight);
    if (unit === null) return 0;
    const sub = unit * qty;
    if (appliedCoupon.minSubtotalBdt && sub < appliedCoupon.minSubtotalBdt) return 0;
    const raw = Math.round((sub * (appliedCoupon.discountPct || 0)) / 100);
    if (appliedCoupon.maxDiscountBdt && appliedCoupon.maxDiscountBdt > 0) {
      return Math.min(sub, Math.min(raw, appliedCoupon.maxDiscountBdt));
    }
    return Math.min(sub, raw);
  }, [appliedCoupon, settings, selectedWeight, qty]);

  const totals = useMemo(
    () =>
      computeFreshCheckoutTotals({
        settings,
        weight: selectedWeight,
        qty,
        zone,
        discountBdt: couponDiscountBdt,
      }),
    [settings, selectedWeight, qty, zone, couponDiscountBdt]
  );

  const hasBkash = hasValidRealPhone(settings.bkashNumber);
  const hasNagad = hasValidRealPhone(settings.nagadNumber);
  const hasHelpline = hasValidRealPhone(settings.supportPhone);

  const formatNum = (n: number) => (bn ? toBengaliDigits(n) : String(n));
  const formatPrice = (n: number) => (bn ? toBengaliDigits(formatBdt(n)) : formatBdt(n));

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCouponBusy(true);
    setCouponMsg('');
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({ code, subtotalBdt: totals.subtotalBdt || 0 }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        coupon?: CouponRecord;
        error?: string;
      };
      if (res.ok && data.ok && data.coupon) {
        setAppliedCoupon(data.coupon);
        setCouponMsg(
          bn ? `প্রোমো কোড ${data.coupon.code} সফলভাবে যুক্ত হয়েছে।` : `Promo ${data.coupon.code} applied.`
        );
      } else {
        setAppliedCoupon(null);
        setCouponMsg(
          data.error || (bn ? 'কোডটি সঠিক নয় বা মেয়াদ শেষ হয়েছে।' : 'Invalid or expired promo code.')
        );
      }
    } catch {
      setCouponMsg(bn ? 'কোড যাচাই করা যায়নি।' : 'Could not verify promo code right now.');
    } finally {
      setCouponBusy(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    setUnavailableMsg('');

    const validation = validateFreshCheckoutInput({
      customerName,
      phone,
      district,
      address,
      lang,
    });
    if (!validation.ok) {
      setFormError(validation.message);
      return;
    }

    if ((paymentMethod === 'bkash' || paymentMethod === 'nagad') && txnId.trim().length < 5) {
      setFormError(
        bn
          ? 'মোবাইল পেমেন্টের ট্রানজ্যাকশন আইডি (TrxID) লিখুন।'
          : 'Please enter your mobile payment Transaction ID (TrxID).'
      );
      return;
    }

    if (!orderingReady) {
      setUnavailableMsg(
        bn
          ? 'Ordering is temporarily unavailable — বর্তমানে স্টোরের লাইভ অর্ডার সাময়িকভাবে বন্ধ রয়েছে। কোনো অর্ডার তৈরি হয়নি বা টাকা কাটা হয়নি।'
          : 'Ordering is temporarily unavailable right now while live pricing and inventory are being confirmed. No order was placed and no payment was charged.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        uiLang: lang,
        customerName: customerName.trim(),
        phone: phone.trim(),
        district,
        area: area.trim() || district,
        address: address.trim(),
        deliveryZone: zone,
        paymentMethod,
        txnId: txnId.trim(),
        couponCode: appliedCoupon?.code || '',
        qty250g: selectedWeight === '250g' ? qty : 0,
        qty500g: selectedWeight === '500g' ? qty : 0,
        qty1kg: selectedWeight === '1kg' ? qty : 0,
      };

      const res = await fetch('/api/orders/storefront', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        error?: string;
        order?: OrderRecord;
      };

      if (
        res.status === 503 ||
        data.code === 'ordering_not_available' ||
        data.code === 'admin_sdk_unavailable'
      ) {
        setUnavailableMsg(
          bn
            ? 'Ordering is temporarily unavailable — অর্ডার সার্ভিস সাময়িকভাবে অনুপলব্ধ। কোনো অর্ডার তৈরি হয়নি এবং কোনো টাকা কাটা হয়নি।'
            : 'Ordering is temporarily unavailable right now. No order was placed and no payment was charged.'
        );
        return;
      }

      if (!res.ok || !data.ok || !data.order) {
        setFormError(
          data.error ||
            (bn
              ? 'অর্ডার সম্পন্ন করা যায়নি। তথ্যগুলো আবার যাচাই করে চেষ্টা করুন।'
              : 'Could not complete your order. Please verify your details and try again.')
        );
        return;
      }

      setConfirmedOrder(data.order);
      onOrderConfirmed(data.order);
      trackStoreEvent('Purchase', {
        orderNumber: data.order.orderNumber,
        value: data.order.totalBdt,
        currency: 'BDT',
      });
    } catch {
      setFormError(
        bn
          ? 'নেটওয়ার্ক সমস্যার কারণে অর্ডার পাঠানো যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
          : 'Network issue while placing your order. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      id="order"
      aria-labelledby="order-section-heading"
      className="bg-gradient-to-b from-white to-[#F4FAF5] py-16 sm:py-24"
    >
      <div className="mx-auto max-w-[1140px] px-4 sm:px-6 lg:px-8">
        {/* Section Heading */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-bold tracking-wide text-[#855E00]">
            {CHECKOUT_SECTION.kicker[lang]}
          </p>
          <h2
            id="order-section-heading"
            className="font-display mt-2 text-3xl font-extrabold leading-tight text-[#14231A] sm:text-[2.375rem]"
          >
            {CHECKOUT_SECTION.heading[lang]}
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[#56645A] sm:text-lg">
            {CHECKOUT_SECTION.sub[lang]}
          </p>
        </div>

        {/* 2-Column Sticky Summary + Elevated Form */}
        <div className="mt-10 grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
          {/* Left Sticky Summary Column */}
          <aside className="space-y-5 lg:sticky lg:top-24 lg:col-span-5">
            <div className="hidden overflow-hidden rounded-[22px] border border-[#E7E3D3] bg-white shadow-[0_18px_40px_rgba(12,63,34,0.10)] lg:block">
              <ResilientImage
                src={FRESH_IMAGES.checkoutJar}
                alt={
                  bn
                    ? 'Deshi Gee সিল করা খাঁটি গাওয়া ঘির কাচের জার'
                    : 'Sealed glass jar of Deshi Gee pure golden cow ghee'
                }
                fallbackTitle="Deshi Gee"
                className="aspect-[4/3] w-full object-cover"
              />
            </div>

            <div className="rounded-[20px] border border-[#E7E3D3] bg-white p-5 shadow-[0_14px_34px_rgba(12,63,34,0.08)] sm:p-6">
              <div className="space-y-3 text-[15px]">
                <div className="flex items-center justify-between gap-4 border-b border-dashed border-[#E7E3D3] pb-3">
                  <span className="text-[#56645A]">
                    {bn ? 'Deshi Gee খাঁটি গাওয়া ঘি' : 'Deshi Gee Pure Cow Ghee'} (
                    {bn ? selectedOption.labelBn : selectedOption.labelEn}) × {formatNum(qty)}
                  </span>
                  <span className="font-mono font-bold text-[#14231A] tabular-nums">
                    {totals.subtotalBdt !== null
                      ? formatPrice(totals.subtotalBdt)
                      : bn
                        ? 'হালনাগাদ হচ্ছে'
                        : 'Pending'}
                  </span>
                </div>

                {totals.discountBdt > 0 && (
                  <div className="flex items-center justify-between gap-4 border-b border-dashed border-[#E7E3D3] pb-3 text-[#16673A]">
                    <span>{bn ? 'প্রোমো ছাড়' : 'Promo discount'}</span>
                    <span className="font-mono font-bold tabular-nums">
                      -{formatPrice(totals.discountBdt)}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 border-b border-dashed border-[#E7E3D3] pb-3">
                  <span className="text-[#56645A]">
                    {bn ? 'ডেলিভারি চার্জ' : 'Delivery charge'} ({district})
                  </span>
                  <span
                    className={`font-mono font-bold tabular-nums ${
                      totals.isFreeDelivery ? 'text-[#1F8A4C]' : 'text-[#14231A]'
                    }`}
                  >
                    {totals.deliveryFeeBdt === null
                      ? bn
                        ? 'চেকআউটে নির্ধারিত'
                        : 'Calculated at checkout'
                      : totals.isFreeDelivery
                        ? bn
                          ? 'ফ্রি'
                          : 'Free'
                        : formatPrice(totals.deliveryFeeBdt)}
                  </span>
                </div>

                <div className="flex items-baseline justify-between gap-4 pt-1">
                  <span className="text-lg font-bold text-[#14231A]">
                    {bn ? 'সর্বমোট প্রদেয়' : 'Total Payable'}
                  </span>
                  <span className="font-display text-2xl font-extrabold text-[#16673A] tabular-nums">
                    {totals.totalBdt !== null
                      ? formatPrice(totals.totalBdt)
                      : bn
                        ? 'মূল্য হালনাগাদ হচ্ছে'
                        : 'Temporarily unavailable'}
                  </span>
                </div>
              </div>

              <ul className="mt-5 space-y-2 border-t border-[#E7E3D3] pt-4 text-sm font-semibold text-[#16673A]">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-[#1F8A4C]" />
                  <span>{bn ? 'পণ্য হাতে পেয়ে টাকা পরিশোধ' : 'Pay cash on delivery'}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-[#1F8A4C]" />
                  <span>
                    {bn
                      ? 'দেখে ও ঘ্রাণ নিয়ে তারপর পেমেন্ট'
                      : 'Inspect grain & aroma before paying'}
                  </span>
                </li>
                {hasHelpline ? (
                  <li className="flex items-center gap-2">
                    <Phone className="h-4 w-4 shrink-0 text-[#1F8A4C]" />
                    <span>
                      {bn ? 'হেল্পলাইন:' : 'Helpline:'}{' '}
                      <a
                        href={`tel:${settings.supportPhone.replace(/[^0-9+]/g, '')}`}
                        className="font-mono underline decoration-[#1F8A4C]/40 underline-offset-2"
                      >
                        {settings.supportPhone}
                      </a>
                    </span>
                  </li>
                ) : (
                  <li className="flex items-center gap-2">
                    <Phone className="h-4 w-4 shrink-0 text-[#1F8A4C]" />
                    <button
                      type="button"
                      onClick={onOpenCallback}
                      className="text-left underline decoration-[#1F8A4C]/50 underline-offset-2 hover:text-[#0C3F22]"
                    >
                      {bn ? 'সরাসরি কলব্যাক অনুরোধ করুন' : 'Request a direct callback'}
                    </button>
                  </li>
                )}
              </ul>
            </div>
          </aside>

          {/* Right Elevated Checkout Form Card */}
          <div className="rounded-[26px] border border-[#E7E3D3] border-t-[6px] border-t-[#1F8A4C] bg-white p-6 shadow-[0_24px_60px_rgba(12,63,34,0.13)] sm:p-8 lg:col-span-7">
            {confirmedOrder ? (
              <div className="space-y-5 py-2 text-center sm:text-left">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#EAF6EE] text-[#16673A]">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[#1F8A4C]">
                    {bn ? 'অর্ডার গৃহীত হয়েছে' : 'Order Received'}
                  </p>
                  <h3 className="font-display mt-1 text-2xl font-extrabold text-[#0C3F22] sm:text-3xl">
                    {bn ? 'ধন্যবাদ! আপনার অর্ডার সফলভাবে সম্পন্ন হয়েছে' : 'Thank You! Your Order Is Placed'}
                  </h3>
                  <p className="mt-2 text-sm text-[#56645A]">
                    {bn
                      ? 'আমাদের প্রতিনিধি শীঘ্রই আপনার মোবাইল নম্বরে যোগাযোগ করে ডেলিভারি নিশ্চিত করবেন।'
                      : 'Our team will reach out to your mobile number shortly to confirm dispatch.'}
                  </p>
                </div>

                <div className="rounded-2xl border border-[#E7E3D3] bg-[#FFFDF5] p-5 text-left text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-[#E7E3D3] pb-3">
                    <span className="text-[#56645A]">{bn ? 'অর্ডার নম্বর' : 'Order Number'}</span>
                    <span className="font-mono text-base font-bold text-[#0C3F22]">
                      {confirmedOrder.orderNumber}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1.5 text-[#14231A]">
                    <p>
                      <span className="text-[#56645A]">{bn ? 'ক্রেতা:' : 'Customer:'}</span>{' '}
                      <strong>{confirmedOrder.customerName}</strong> ({confirmedOrder.phone})
                    </p>
                    <p>
                      <span className="text-[#56645A]">{bn ? 'ঠিকানা:' : 'Address:'}</span>{' '}
                      {confirmedOrder.address}, {confirmedOrder.district}
                    </p>
                    <p>
                      <span className="text-[#56645A]">{bn ? 'মোট প্রদেয়:' : 'Total:'}</span>{' '}
                      <strong className="font-mono text-[#16673A]">
                        {formatPrice(confirmedOrder.totalBdt)}
                      </strong>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => onNavigateTrack(confirmedOrder.orderNumber, confirmedOrder.phone)}
                    className="dg-btn-emerald text-base"
                  >
                    <Truck className="h-4 w-4" />
                    <span>{bn ? 'অর্ডার ট্র্যাক করুন' : 'Track This Order'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmedOrder(null)}
                    className="btn-secondary"
                  >
                    {bn ? 'আরেকটি অর্ডার করুন' : 'Place Another Order'}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-6">
                {/* Honest Unavailable Notice when starter/preview lacks live confirmed pricing */}
                {(!orderingReady || unavailableMsg) && (
                  <div
                    role="status"
                    data-testid="storefront-ordering-unavailable"
                    className="rounded-2xl border border-[#F5DC7A] bg-[#FFFAEB] p-4 text-sm text-[#14231A]"
                  >
                    <div className="flex items-start gap-3">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#855E00]" />
                      <div className="space-y-2">
                        <p className="font-bold text-[#0C3F22]">
                          {bn
                            ? 'অনলাইন অর্ডারিং সাময়িকভাবে বন্ধ রয়েছে (Ordering is temporarily unavailable)'
                            : 'Ordering is temporarily unavailable'}
                        </p>
                        <p className="text-xs leading-relaxed text-[#56645A]">
                          {unavailableMsg ||
                            (bn
                              ? 'স্টোরের লাইভ মূল্য ও স্টক আপডেট সম্পন্ন হওয়ার সাথে সাথেই অর্ডার চালু হবে। এই মুহূর্তে কোনো অর্ডার তৈরি হবে না বা টাকা কাটা হবে না।'
                              : 'Online checkout will reopen as soon as live store prices and inventory are confirmed. No order is placed and no payment is charged right now.')}
                        </p>
                        <div className="flex flex-wrap gap-3 pt-1">
                          <button
                            type="button"
                            onClick={onOpenCallback}
                            className="text-xs font-bold text-[#16673A] underline underline-offset-2 hover:text-[#0C3F22]"
                          >
                            {bn ? 'কলব্যাক অনুরোধ পাঠান' : 'Request a callback'}
                          </button>
                          <button
                            type="button"
                            onClick={onOpenChat}
                            className="text-xs font-bold text-[#16673A] underline underline-offset-2 hover:text-[#0C3F22]"
                          >
                            {bn ? 'সহকারীর সাথে কথা বলুন' : 'Ask Support Assistant'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 1: Jar Size & Quantity Selector */}
                <div>
                  <div className="flex items-center justify-between gap-2 border-b border-[#E7E3D3] pb-3">
                    <h3 className="font-display text-xl font-bold text-[#0C3F22]">
                      {bn ? '১. জারের ওজন ও পরিমাণ বেছে নিন' : '1. Choose Jar Size & Quantity'}
                    </h3>
                    <span className="text-xs font-semibold text-[#56645A]">
                      {bn ? '১ কেজি জনপ্রিয়' : '1 kg Flagship'}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    {availableOptions.map((opt) => {
                      const active = selectedWeight === opt.weight;
                      const unitPrice = getConfirmedPriceForWeight(settings, opt.weight);
                      const stock = getFreshStockForWeight(settings, opt.weight);
                      const outOfStock = orderingReady && unitPrice !== null && stock <= 0;

                      return (
                        <button
                          key={opt.weight}
                          type="button"
                          disabled={outOfStock}
                          onClick={() => {
                            onSelectWeight(opt.weight);
                            setFormError('');
                          }}
                          className={`flex min-h-[78px] flex-col justify-between rounded-2xl border-2 px-3.5 py-3 text-left transition-all ${
                            active
                              ? 'border-[#1F8A4C] bg-[#F1F9F3] shadow-[0_6px_18px_rgba(31,138,76,0.14)]'
                              : 'border-[#E7E3D3] bg-[#FFFDF9] hover:border-[#1F8A4C]/50'
                          } ${outOfStock ? 'cursor-not-allowed opacity-50' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-[#14231A]">
                              {bn ? opt.labelBn : opt.labelEn}
                            </span>
                            {active && (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1F8A4C] text-white">
                                <Check className="h-3 w-3" />
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex flex-col gap-0.5">
                            {unitPrice !== null && (
                              <span className="font-mono whitespace-nowrap text-base font-extrabold leading-tight text-[#16673A] tabular-nums">
                                {formatPrice(unitPrice)}
                              </span>
                            )}
                            <span className="text-[11px] leading-snug text-[#56645A]">
                              {outOfStock
                                ? bn
                                  ? 'স্টক শেষ'
                                  : 'Out of stock'
                                : bn
                                  ? opt.subtitleBn
                                  : opt.subtitleEn}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Quantity Stepper */}
                  <div className="mt-3.5 flex items-center justify-between rounded-xl border border-[#E7E3D3] bg-[#FAFBF9] px-4 py-2.5">
                    <span className="text-sm font-semibold text-[#14231A]">
                      {bn ? 'জারের সংখ্যা' : 'Quantity'}
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        aria-label={bn ? 'পরিমাণ কমান' : 'Decrease quantity'}
                        onClick={() => onChangeQty(Math.max(1, qty - 1))}
                        disabled={qty <= 1}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#DFE7E1] bg-white text-[#14231A] transition-colors hover:border-[#1F8A4C] disabled:opacity-40"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="min-w-[28px] text-center font-mono text-base font-bold text-[#0C3F22] tabular-nums">
                        {formatNum(qty)}
                      </span>
                      <button
                        type="button"
                        aria-label={bn ? 'পরিমাণ বাড়ান' : 'Increase quantity'}
                        onClick={() => onChangeQty(Math.min(maxOrderable, qty + 1))}
                        disabled={qty >= maxOrderable}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#DFE7E1] bg-white text-[#14231A] transition-colors hover:border-[#1F8A4C] disabled:opacity-40"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Step 2: Delivery Information */}
                <div className="space-y-4">
                  <h3 className="font-display border-b border-[#E7E3D3] pb-3 text-xl font-bold text-[#0C3F22]">
                    {bn ? '২. ডেলিভারির তথ্য দিন' : '2. Delivery Information'}
                  </h3>

                  <div>
                    <label
                      htmlFor="dg-order-name"
                      className="mb-1.5 block text-[15px] font-semibold text-[#14231A]"
                    >
                      {bn ? 'আপনার নাম' : 'Your Full Name'}{' '}
                      <span className="text-[#D93F34]">*</span>
                    </label>
                    <div className="relative">
                      <User
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-[#1F8A4C]"
                      />
                      <input
                        id="dg-order-name"
                        type="text"
                        required
                        autoComplete="name"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder={bn ? 'আপনার পূর্ণ নাম লিখুন' : 'Enter your full name'}
                        className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-[#DFE7E1] bg-[#F8FAF8] py-3 pr-4 pl-11 text-base text-[#14231A] transition-colors focus:border-[#1F8A4C] focus:bg-white focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="dg-order-phone"
                        className="mb-1.5 block text-[15px] font-semibold text-[#14231A]"
                      >
                        {bn ? 'মোবাইল নম্বর' : 'Mobile Number'}{' '}
                        <span className="text-[#D93F34]">*</span>
                      </label>
                      <div className="relative">
                        <Phone
                          aria-hidden="true"
                          className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-[#1F8A4C]"
                        />
                        <input
                          id="dg-order-phone"
                          type="tel"
                          inputMode="tel"
                          required
                          autoComplete="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="01XXXXXXXXX"
                          className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-[#DFE7E1] bg-[#F8FAF8] py-3 pr-4 pl-11 font-mono text-base text-[#14231A] transition-colors focus:border-[#1F8A4C] focus:bg-white focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="dg-order-district"
                        className="mb-1.5 block text-[15px] font-semibold text-[#14231A]"
                      >
                        {bn ? 'জেলা' : 'District'} <span className="text-[#D93F34]">*</span>
                      </label>
                      <select
                        id="dg-order-district"
                        value={district}
                        onChange={(e) => setDistrict(e.target.value)}
                        className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-[#DFE7E1] bg-[#F8FAF8] px-4 py-3 text-base text-[#14231A] transition-colors focus:border-[#1F8A4C] focus:bg-white focus:outline-none"
                      >
                        {BANGLADESH_DISTRICTS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="dg-order-address"
                      className="mb-1.5 block text-[15px] font-semibold text-[#14231A]"
                    >
                      {bn ? 'সম্পূর্ণ ঠিকানা' : 'Full Delivery Address'}{' '}
                      <span className="text-[#D93F34]">*</span>
                    </label>
                    <div className="relative">
                      <MapPin
                        aria-hidden="true"
                        className="pointer-events-none absolute top-4 left-4 h-4 w-4 text-[#1F8A4C]"
                      />
                      <input
                        id="dg-order-address"
                        type="text"
                        required
                        autoComplete="street-address"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder={
                          bn
                            ? 'বাসা/রোড নম্বর, এলাকা, থানা'
                            : 'House / Road, Area, Thana'
                        }
                        className="min-h-[52px] w-full rounded-[14px] border-[1.5px] border-[#DFE7E1] bg-[#F8FAF8] py-3 pr-4 pl-11 text-base text-[#14231A] transition-colors focus:border-[#1F8A4C] focus:bg-white focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="dg-order-area"
                      className="mb-1.5 block text-xs font-semibold text-[#56645A]"
                    >
                      {bn ? 'থানা / এলাকা (ঐচ্ছিক)' : 'Area / Thana (Optional)'}
                    </label>
                    <input
                      id="dg-order-area"
                      type="text"
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                      placeholder={bn ? 'যেমন: ধানমন্ডি, উত্তরা, সদর' : 'e.g. Dhanmondi, Uttara, Sadar'}
                      className="min-h-[46px] w-full rounded-[14px] border-[1.5px] border-[#DFE7E1] bg-[#F8FAF8] px-4 py-2.5 text-sm text-[#14231A] transition-colors focus:border-[#1F8A4C] focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                {/* Optional Promo Code */}
                <div>
                  {!showCoupon ? (
                    <button
                      type="button"
                      onClick={() => setShowCoupon(true)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#16673A] hover:text-[#0C3F22]"
                    >
                      <Tag className="h-3.5 w-3.5" />
                      <span>{bn ? 'প্রোমো কোড আছে?' : 'Have a promo code?'}</span>
                    </button>
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        placeholder={bn ? 'প্রোমো কোড লিখুন' : 'Enter promo code'}
                        aria-label={bn ? 'প্রোমো কোড' : 'Promo code'}
                        className="min-h-[44px] flex-1 rounded-xl border border-[#DFE7E1] bg-[#F8FAF8] px-3.5 font-mono text-sm uppercase text-[#14231A] focus:border-[#1F8A4C] focus:bg-white focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={couponBusy || !couponInput.trim()}
                        onClick={handleApplyCoupon}
                        className="btn-secondary min-h-[44px] px-5 text-xs"
                      >
                        {couponBusy ? '...' : bn ? 'প্রয়োগ করুন' : 'Apply'}
                      </button>
                    </div>
                  )}
                  {couponMsg && (
                    <p
                      className={`mt-1.5 text-xs font-medium ${
                        appliedCoupon ? 'text-[#16673A]' : 'text-[#B9382C]'
                      }`}
                    >
                      {couponMsg}
                    </p>
                  )}
                </div>

                {/* Step 3: Payment Method */}
                <div className="space-y-3">
                  <div className="rounded-2xl border-[1.5px] border-[#1F8A4C] bg-[#F1F9F3] p-4">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="radio"
                        name="dg-payment-method"
                        value="cod"
                        checked={paymentMethod === 'cod'}
                        onChange={() => setPaymentMethod('cod')}
                        className="mt-1 h-4 w-4 accent-[#16673A]"
                      />
                      <div>
                        <span className="block text-base font-bold text-[#0C3F22]">
                          {bn ? 'ক্যাশ অন ডেলিভারি' : 'Cash on Delivery'}
                        </span>
                        <span className="block text-sm text-[#56645A]">
                          {bn
                            ? 'পণ্য হাতে পেয়ে দেখে ও ঘ্রাণ নিয়ে তারপর টাকা পরিশোধ করুন।'
                            : 'Inspect your jar on arrival and pay cash directly to the delivery rider.'}
                        </span>
                      </div>
                    </label>
                  </div>

                  {(hasBkash || hasNagad) && (
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {hasBkash && (
                        <label
                          className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm ${
                            paymentMethod === 'bkash'
                              ? 'border-[#1F8A4C] bg-[#F1F9F3] font-semibold'
                              : 'border-[#E7E3D3] bg-white'
                          }`}
                        >
                          <input
                            type="radio"
                            name="dg-payment-method"
                            value="bkash"
                            checked={paymentMethod === 'bkash'}
                            onChange={() => setPaymentMethod('bkash')}
                            className="h-4 w-4 accent-[#16673A]"
                          />
                          <span>bKash ({settings.bkashNumber})</span>
                        </label>
                      )}
                      {hasNagad && (
                        <label
                          className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm ${
                            paymentMethod === 'nagad'
                              ? 'border-[#1F8A4C] bg-[#F1F9F3] font-semibold'
                              : 'border-[#E7E3D3] bg-white'
                          }`}
                        >
                          <input
                            type="radio"
                            name="dg-payment-method"
                            value="nagad"
                            checked={paymentMethod === 'nagad'}
                            onChange={() => setPaymentMethod('nagad')}
                            className="h-4 w-4 accent-[#16673A]"
                          />
                          <span>Nagad ({settings.nagadNumber})</span>
                        </label>
                      )}
                    </div>
                  )}

                  {(paymentMethod === 'bkash' || paymentMethod === 'nagad') && (
                    <div>
                      <label
                        htmlFor="dg-order-trx"
                        className="mb-1 block text-xs font-semibold text-[#14231A]"
                      >
                        {bn ? 'ট্রানজ্যাকশন আইডি (TrxID) *' : 'Transaction ID (TrxID) *'}
                      </label>
                      <input
                        id="dg-order-trx"
                        type="text"
                        value={txnId}
                        onChange={(e) => setTxnId(e.target.value)}
                        placeholder="e.g. 9G8H7J6K5L"
                        className="min-h-[46px] w-full rounded-xl border border-[#DFE7E1] bg-[#F8FAF8] px-4 font-mono text-sm text-[#14231A] focus:border-[#1F8A4C] focus:bg-white focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                {/* Inline Validation / Error Banner */}
                {formError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-xl border border-[#F6D6D2] bg-[#FFF6F5] px-4 py-3 text-sm font-medium text-[#8A261D]"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#D93F34]" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* Full-Width Emerald Confirm Button */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-[58px] w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-br from-[#1F8A4C] to-[#16673A] px-6 py-4 text-lg font-extrabold text-white shadow-[0_12px_30px_rgba(22,103,58,0.32)] transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(22,103,58,0.42)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>{bn ? 'অর্ডার প্রক্রিয়াকরণ হচ্ছে...' : 'Placing your order...'}</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-5 w-5" />
                      <span>
                        {bn ? 'অর্ডার কনফার্ম করুন' : 'Confirm Order'}
                        {totals.totalBdt !== null ? ` · ${formatPrice(totals.totalBdt)}` : ''}
                      </span>
                    </>
                  )}
                </button>

                <p className="text-center text-xs text-[#56645A]">
                  {bn ? 'আগে থেকেই অর্ডার করেছেন?' : 'Already placed an order?'}{' '}
                  <Link
                    href="/track"
                    className="font-semibold text-[#16673A] underline underline-offset-2 hover:text-[#0C3F22]"
                  >
                    {bn ? 'এখান থেকে ট্র্যাক করুন' : 'Track your parcel here'}
                  </Link>
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
