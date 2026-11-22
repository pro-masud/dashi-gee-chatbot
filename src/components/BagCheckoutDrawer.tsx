'use client';

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  CreditCard,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  ShoppingBag,
  Tag,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import {
  CouponRecord,
  DeliveryZone,
  OrderRecord,
  PaymentMethod,
  StoreSettingsDoc,
  WeightKey,
  getConfirmedDeliveryFeeForZone,
  getConfirmedPriceForWeight,
  hasValidRealPhone,
  isStoreFieldConfirmed,
  isStorefrontOrderingReady,
} from '../lib/firebase';
import {
  BANGLADESH_DISTRICTS,
  IMAGES,
  Lang,
  clientAssessAddressCompleteness,
  clientResolveZoneFromDistrictAndArea,
  formatBdt,
  toBengaliDigits,
} from '../data/deshiGeeData';
import { trackStoreEvent } from '../lib/analytics';
import { ResilientImage } from './ResilientImage';

export interface CartJarItem {
  weight: WeightKey;
  qty: number;
}

interface BagCheckoutDrawerProps {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  settings: StoreSettingsDoc;
  cart: CartJarItem[];
  onUpdateQty: (weight: WeightKey, delta: number) => void;
  onRemoveItem: (weight: WeightKey) => void;
  onClearCart: () => void;
  lastConfirmedOrder: OrderRecord | null;
  onOrderConfirmed: (order: OrderRecord) => void;
  onNavigateTrack: (orderNumber: string, phone: string) => void;
}

type DrawerStep = 'bag' | 'checkout' | 'confirmed';

const STORAGE_CHECKOUT_DRAFT_KEY = 'deshi_gee_checkout_draft_v1';

export function BagCheckoutDrawer({
  open,
  onClose,
  lang,
  settings,
  cart,
  onUpdateQty,
  onRemoveItem,
  onClearCart,
  lastConfirmedOrder,
  onOrderConfirmed,
  onNavigateTrack,
}: BagCheckoutDrawerProps) {
  const [step, setStep] = useState<DrawerStep>('bag');
  const [confirmRemoveWeight, setConfirmRemoveWeight] = useState<WeightKey | null>(null);
  const [district, setDistrict] = useState('Dhaka');
  const [area, setArea] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [txnId, setTxnId] = useState('');
  const [paymentProofData, setPaymentProofData] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<CouponRecord | null>(null);
  const [couponFeedback, setCouponFeedback] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [onlineGateways, setOnlineGateways] = useState<{
    sslcommerz: boolean;
    bkash: boolean;
  }>({ sslcommerz: false, bkash: false });
  const [gatewayBusy, setGatewayBusy] = useState<'sslcommerz' | 'bkash' | null>(null);
  const [gatewayError, setGatewayError] = useState('');
  const [copiedMfs, setCopiedMfs] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [orderingUnavailable, setOrderingUnavailable] = useState('');

  const bn = lang === 'bn';

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_CHECKOUT_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          customerName: string;
          phone: string;
          district: string;
          area: string;
          address: string;
          note: string;
          paymentMethod: PaymentMethod;
        }>;
        if (typeof parsed.customerName === 'string') setCustomerName(parsed.customerName);
        if (typeof parsed.phone === 'string') setPhone(parsed.phone);
        if (
          typeof parsed.district === 'string' &&
          BANGLADESH_DISTRICTS.includes(parsed.district)
        ) {
          setDistrict(parsed.district);
        }
        if (typeof parsed.area === 'string') setArea(parsed.area);
        if (typeof parsed.address === 'string') setAddress(parsed.address);
        if (typeof parsed.note === 'string') setNote(parsed.note);
        if (
          parsed.paymentMethod === 'cod' ||
          parsed.paymentMethod === 'bkash' ||
          parsed.paymentMethod === 'nagad'
        ) {
          setPaymentMethod(parsed.paymentMethod);
        }
      }
    } catch {
      // Ignore unavailable sessionStorage
    } finally {
      setDraftHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    try {
      window.sessionStorage.setItem(
        STORAGE_CHECKOUT_DRAFT_KEY,
        JSON.stringify({
          customerName,
          phone,
          district,
          area,
          address,
          note,
          paymentMethod,
        })
      );
    } catch {
      // Ignore quota / privacy mode errors
    }
  }, [draftHydrated, customerName, phone, district, area, address, note, paymentMethod]);

  // Incomplete-order lead capture: starts only once the visitor has a valid phone number and the
  // privacy notice shown above the form is on screen. Debounced; identical data is never re-sent.
  const lastLeadSignatureRef = useRef('');
  useEffect(() => {
    if (!open || step !== 'checkout' || cart.length === 0) return;
    const cleanPhone = phone.replace(/[\s-]/g, '');
    if (!/^01[3-9]\d{8}$/.test(cleanPhone)) return;

    const qty250g = cart.filter((c) => c.weight === '250g').reduce((s, c) => s + c.qty, 0);
    const qty500g = cart.filter((c) => c.weight === '500g').reduce((s, c) => s + c.qty, 0);
    const qty1kg = cart.filter((c) => c.weight === '1kg').reduce((s, c) => s + c.qty, 0);
    const signature = [cleanPhone, customerName.trim(), district, qty250g, qty500g, qty1kg].join('|');
    if (signature === lastLeadSignatureRef.current) return;

    const timer = window.setTimeout(() => {
      lastLeadSignatureRef.current = signature;
      const params = new URLSearchParams(window.location.search);
      void fetch('/api/leads', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'DeshiGeeStorefront' },
        body: JSON.stringify({
          consent: true,
          phone: cleanPhone,
          name: customerName.trim(),
          district,
          qty250g,
          qty500g,
          qty1kg,
          source: {
            path: window.location.pathname,
            utmSource: params.get('utm_source') || '',
            utmCampaign: params.get('utm_campaign') || '',
            utmMedium: params.get('utm_medium') || '',
            fbclid: params.has('fbclid'),
          },
        }),
      }).catch(() => {
        // lead capture must never interrupt checkout
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [open, step, cart, phone, customerName, district]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch('/api/payments/methods')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data?.onlineGateways) return;
        setOnlineGateways({
          sslcommerz: Boolean(data.onlineGateways.sslcommerz),
          bkash: Boolean(data.onlineGateways.bkash),
        });
      })
      .catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      active = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const handleStartOnlinePayment = async (
    gateway: 'sslcommerz' | 'bkash',
    order: OrderRecord
  ) => {
    if (gatewayBusy) return;
    setGatewayBusy(gateway);
    setGatewayError('');
    try {
      const res = await fetch('/api/payments/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          gateway,
          orderNumber: order.orderNumber,
          phone: order.phone,
          customerName: order.customerName,
          address: order.address,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.gatewayUrl) {
        throw new Error(
          data.error ||
            (bn ? 'অনলাইন পেমেন্ট শুরু করা যায়নি।' : 'Could not initiate online payment.')
        );
      }
      window.location.href = String(data.gatewayUrl);
    } catch (err) {
      setGatewayError(
        err instanceof Error
          ? err.message
          : bn
            ? 'পেমেন্ট গেটওয়ে সংযোগ ব্যর্থ হয়েছে।'
            : 'Payment gateway connection failed.'
      );
      setGatewayBusy(null);
    }
  };

  useEffect(() => {
    if (open && cart.length > 0 && step === 'confirmed') {
      setStep('bag');
    }
  }, [open, cart.length, step]);

  const orderingReady = isStorefrontOrderingReady(settings);
  const bkashManualConfigured = hasValidRealPhone(settings.bkashNumber);
  const nagadManualConfigured = hasValidRealPhone(settings.nagadNumber);
  // The store currently accepts Cash on Delivery only.
  const availableMethods: PaymentMethod[] = ['cod'];

  useEffect(() => {
    if (!availableMethods.includes(paymentMethod)) {
      setPaymentMethod('cod');
    }
  }, [bkashManualConfigured, nagadManualConfigured, paymentMethod]);

  const getPriceForWeight = (weight: WeightKey): number =>
    getConfirmedPriceForWeight(settings, weight) ?? 0;

  const getStockForWeight = (weight: WeightKey): number => {
    if (weight === '250g') return settings.stock250g;
    if (weight === '500g') return settings.stock500g;
    return settings.stock1kg;
  };

  const primaryItem = cart[0] ?? null;
  const subtotal = cart.reduce(
    (sum, item) => sum + getPriceForWeight(item.weight) * item.qty,
    0
  );
  const deliveryZone: DeliveryZone = clientResolveZoneFromDistrictAndArea(
    district,
    area,
    address
  );
  const confirmedZoneFee = getConfirmedDeliveryFeeForZone(settings, deliveryZone);
  const freeThresholdConfirmed =
    isStoreFieldConfirmed(settings, 'freeDeliveryThreshold') &&
    settings.freeDeliveryThreshold > 0;
  const qualifiesFree = freeThresholdConfirmed && subtotal >= settings.freeDeliveryThreshold;
  const couponWaivesDelivery =
    Boolean(appliedCoupon?.freeDelivery) &&
    subtotal >= (appliedCoupon?.minSubtotalBdt ?? 0) &&
    (paymentMethod === 'cod' || appliedCoupon?.stackableWithAdvance !== false);
  const deliveryFee =
    cart.length === 0 || qualifiesFree || couponWaivesDelivery ? 0 : (confirmedZoneFee ?? 0);

  const estimatedDeliveryWindow =
    deliveryZone === 'dhaka'
      ? isStoreFieldConfirmed(settings, 'estimatedDhakaDays')
        ? settings.estimatedDhakaDays
        : ''
      : deliveryZone === 'suburban'
        ? isStoreFieldConfirmed(settings, 'estimatedSuburbanDays')
          ? settings.estimatedSuburbanDays || ''
          : ''
        : deliveryZone === 'remote'
          ? isStoreFieldConfirmed(settings, 'estimatedRemoteDays')
            ? settings.estimatedRemoteDays || ''
            : ''
          : isStoreFieldConfirmed(settings, 'estimatedOutsideDays')
            ? settings.estimatedOutsideDays
            : '';

  const cutoffNotice = bn
    ? isStoreFieldConfirmed(settings, 'cutoffNoticeBn')
      ? settings.cutoffNoticeBn || ''
      : ''
    : isStoreFieldConfirmed(settings, 'cutoffNoticeEn')
      ? settings.cutoffNoticeEn || ''
      : '';

  const addressCheck = address.trim()
    ? clientAssessAddressCompleteness(address, area, district)
    : { complete: true };

  const advanceDiscountPct =
    paymentMethod !== 'cod' &&
    isStoreFieldConfirmed(settings, 'advanceDiscountPct') &&
    settings.advanceDiscountPct > 0
      ? settings.advanceDiscountPct
      : 0;
  const couponAllowedWithPayment =
    paymentMethod === 'cod' || appliedCoupon?.stackableWithAdvance !== false;
  const couponPct =
    appliedCoupon &&
    subtotal >= appliedCoupon.minSubtotalBdt &&
    couponAllowedWithPayment
      ? appliedCoupon.discountPct
      : 0;
  const couponCapBdt = Number(appliedCoupon?.maxDiscountBdt) || 0;
  let totalDiscount: number;
  if (couponCapBdt > 0 && couponPct > 0) {
    // Same poisha maths as the server (coupon share capped, advance share added, never above 50%).
    const subtotalPoisha = subtotal * 100;
    const couponPoisha = Math.min(Math.round((subtotalPoisha * couponPct) / 100), couponCapBdt * 100);
    const advPct = Math.min(25, Math.max(0, Math.round(advanceDiscountPct)));
    const advancePoisha = Math.round((subtotalPoisha * advPct) / 100);
    totalDiscount = Math.round(Math.min(couponPoisha + advancePoisha, Math.round(subtotalPoisha / 2)) / 100);
  } else {
    totalDiscount = Math.round((subtotal * Math.min(50, advanceDiscountPct + couponPct)) / 100);
  }
  const grandTotal = Math.max(0, subtotal + deliveryFee - totalDiscount);
  const remainingForFree = freeThresholdConfirmed
    ? Math.max(0, settings.freeDeliveryThreshold - subtotal)
    : 0;
  const freeProgressPct = freeThresholdConfirmed
    ? Math.min(100, Math.round((subtotal / settings.freeDeliveryThreshold) * 100))
    : 0;

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCouponLoading(true);
    setCouponFeedback('');
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          code,
          subtotalBdt: subtotal,
          paymentMethod,
          uiLang: lang,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const msg =
        (bn ? data.messageBn : data.messageEn) ||
        data.message ||
        data.error ||
        (bn ? 'কুপন যাচাই করতে সমস্যা হয়েছে।' : 'Unable to verify coupon right now.');

      if (!res.ok) {
        setAppliedCoupon(null);
        setCouponFeedback(msg);
        return;
      }

      if (data.valid && data.coupon) {
        setAppliedCoupon(data.coupon as CouponRecord);
        setCouponFeedback(msg);
      } else if (data.reason === 'non_stackable_with_advance' && data.coupon) {
        setAppliedCoupon(data.coupon as CouponRecord);
        setCouponFeedback(msg);
      } else {
        setAppliedCoupon(null);
        setCouponFeedback(msg);
      }
    } catch {
      setCouponFeedback(
        bn ? 'কুপন যাচাই করতে সমস্যা হয়েছে।' : 'Unable to verify coupon right now.'
      );
    } finally {
      setCouponLoading(false);
    }
  };

  const handleCopyMfsNumber = async (num: string) => {
    try {
      await navigator.clipboard.writeText(num);
      setCopiedMfs(true);
      window.setTimeout(() => setCopiedMfs(false), 1800);
    } catch {
      // Clipboard blocked in some embedded contexts
    }
  };

  const handleScreenshotUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFormError(bn ? 'অনুগ্রহ করে একটি ছবি ফাইল দিন।' : 'Please upload a valid image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 540;
        const scale = Math.min(1, maxW / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setPaymentProofData(canvas.toDataURL('image/jpeg', 0.65));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleProceedCheckout = () => {
    trackStoreEvent('InitiateCheckout', {
      currency: 'BDT',
      value: grandTotal,
      items: cart.map((c) => ({
        item_name: settings.productNameEn,
        item_variant: c.weight,
        quantity: c.qty,
        price: getPriceForWeight(c.weight),
      })),
    });
    setFormError('');
    setStep('checkout');
  };

  const focusCheckoutField = (id: string) => {
    const el = document.getElementById(id) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
  };

  const handleSubmitOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!primaryItem || submitting) return;
    setOrderingUnavailable('');
    if (!orderingReady || subtotal <= 0) {
      setOrderingUnavailable(
        bn
          ? 'অনলাইন অর্ডার এখন সাময়িকভাবে অনুপলব্ধ। কোনো অর্ডার তৈরি হয়নি — অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।'
          : 'Ordering is temporarily unavailable right now. No order was placed — please try again shortly.'
      );
      return;
    }

    const cleanPhone = phone.replace(/[\s-]/g, '');
    if (customerName.trim().length < 2) {
      setFormError(bn ? 'আপনার পূর্ণ নাম লিখুন।' : 'Please enter your full name.');
      focusCheckoutField('co-name');
      return;
    }
    if (!/^01[3-9]\d{8}$/.test(cleanPhone)) {
      setFormError(
        bn
          ? 'সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন (যেমন 017XXXXXXXX)।'
          : 'Enter a valid 11-digit Bangladesh mobile number (01XXXXXXXXX).'
      );
      focusCheckoutField('co-phone');
      return;
    }
    const areaValue = area.trim() || district;
    const addrValid = clientAssessAddressCompleteness(address, areaValue, district);
    if (!addrValid.complete) {
      setFormError(
        bn
          ? 'কুরিয়ার ডেলিভারির জন্য অনুগ্রহ করে সম্পূর্ণ বাড়ি, সড়ক বা ফ্ল্যাট নম্বরসহ ঠিকানা লিখুন।'
          : 'Please enter a full delivery street/house/road address so the courier can locate you.'
      );
      focusCheckoutField('co-address');
      return;
    }
    if ((paymentMethod === 'bkash' || paymentMethod === 'nagad') && txnId.trim().length < 4) {
      setFormError(
        bn
          ? 'সঠিক বিকাশ/নগদ ট্রানজেকশন আইডি (TxnID) লিখুন।'
          : 'Please enter a valid bKash or Nagad Transaction ID (TxnID).'
      );
      focusCheckoutField('co-txnid');
      return;
    }

    // Check stock availability
    for (const item of cart) {
      const avail = getStockForWeight(item.weight);
      if (avail < item.qty) {
        setFormError(
          bn
            ? `${item.weight} জারের পর্যাপ্ত স্টক নেই (উপলব্ধ: ${avail}টি)।`
            : `Insufficient stock for ${item.weight} jar (available: ${avail}).`
        );
        return;
      }
    }

    setSubmitting(true);
    setFormError('');

    try {
      const qty250g = cart.find((c) => c.weight === '250g')?.qty || 0;
      const qty500g = cart.find((c) => c.weight === '500g')?.qty || 0;
      const qty1kg = cart.find((c) => c.weight === '1kg')?.qty || 0;

      const combinedNote = note.trim();

      // S0-05: Route storefront checkout through server API so order persistence
      // and owner notifications run server-side without reopening /api/orders/notify to browsers.
      const checkoutRes = await fetch('/api/orders/storefront', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          customerName: customerName.trim(),
          phone: cleanPhone,
          district,
          area: area.trim() || district,
          address: address.trim(),
          note: combinedNote.slice(0, 240),
          deliveryZone,
          qty250g,
          qty500g,
          qty1kg,
          paymentMethod,
          txnId: paymentMethod === 'cod' ? '' : txnId.trim(),
          paymentProofData: paymentMethod === 'cod' ? '' : paymentProofData.slice(0, 180000),
          couponCode: appliedCoupon?.code || '',
          uiLang: lang,
        }),
      });

      const checkoutData = await checkoutRes.json().catch(() => ({}));
      if (
        checkoutRes.status === 503 ||
        checkoutData.code === 'admin_sdk_unavailable' ||
        checkoutData.code === 'ordering_not_available'
      ) {
        setFormError('');
        setOrderingUnavailable(
          bn
            ? 'আমাদের অর্ডার সিস্টেম সাময়িকভাবে অনুপলব্ধ থাকায় আপনার অর্ডারটি জমা দেওয়া যায়নি। কোনো অর্ডার তৈরি হয়নি এবং কোনো টাকা কাটা হয়নি।'
            : 'Ordering is temporarily unavailable right now. No order was placed and no payment was charged. Please try again shortly.'
        );
        setSubmitting(false);
        return;
      }
      if (!checkoutRes.ok || !checkoutData.ok || !checkoutData.order) {
        setFormError(
          (bn ? checkoutData.messageBn : checkoutData.messageEn) ||
            checkoutData.error ||
            (bn ? 'অর্ডার সম্পন্ন করতে ব্যর্থ হয়েছে।' : 'Failed to submit order.')
        );
        setSubmitting(false);
        return;
      }

      const orderPayload = checkoutData.order as OrderRecord;

      trackStoreEvent('Purchase', {
        transaction_id: orderPayload.orderNumber,
        currency: 'BDT',
        value: orderPayload.totalBdt,
      });

      try {
        window.sessionStorage.removeItem(STORAGE_CHECKOUT_DRAFT_KEY);
      } catch {
        // Ignore storage error
      }
      onOrderConfirmed(orderPayload);
      onClearCart();
      setStep('confirmed');
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : bn
            ? 'নেটওয়ার্ক সমস্যার কারণে অর্ডার সম্পন্ন হয়নি। আবার চেষ্টা করুন।'
            : 'Network or database error submitting order. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const whatsappDigits = settings.whatsappNumber.replace(/[^0-9]/g, '');
  const buildWhatsappSupportUrl = (order: OrderRecord) => {
    const summary = order.itemsSummary || `${order.weight} × ${order.qty}`;
    const msg = encodeURIComponent(
      `Assalamu Alaikum Deshi Gee, I just placed order ${order.orderNumber} (${summary}, Total ৳${order.totalBdt}) via ${order.paymentMethod.toUpperCase()}. Please confirm dispatch.`
    );
    return whatsappDigits
      ? `https://wa.me/${whatsappDigits}?text=${msg}`
      : `https://wa.me/?text=${msg}`;
  };

  return (
    <>
      <div
        hidden={!open}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs transition-opacity"
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={bn ? 'শপিং ব্যাগ ও চেকআউট' : 'Shopping bag and checkout'}
        hidden={!open}
        className="drawer-panel fixed inset-y-0 right-0 z-50 flex h-dvh max-h-dvh w-full max-w-md flex-col overscroll-contain border-l border-[rgb(var(--c-tint)/0.14)] bg-[var(--c-bg)] text-[var(--c-ink)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[rgb(var(--c-tint)/0.10)] px-5 py-4 bg-[var(--c-band)]/60">
          <div className="flex items-center gap-3">
            {step === 'checkout' && (
              <button
                type="button"
                onClick={() => {
                  setFormError('');
                  setOrderingUnavailable('');
                  setStep('bag');
                }}
                aria-label={bn ? 'ব্যাগে ফিরে যান' : 'Back to bag'}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[rgb(var(--c-tint)/0.16)] bg-[var(--c-bg)] text-[var(--c-ink)] hover:bg-[var(--c-surface)] transition-colors shadow-xs"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <h2 className="font-display text-lg font-bold text-[var(--c-ink)] sm:text-xl">
                {step === 'bag' && (bn ? 'আপনার শপিং ব্যাগ' : 'Shopping Bag')}
                {step === 'checkout' && (bn ? 'ডেলিভারি তথ্য' : 'Delivery Details')}
                {step === 'confirmed' && (bn ? 'অর্ডার সফলভাবে গৃহীত' : 'Order Recorded')}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`h-1.5 w-1.5 rounded-full ${step === 'bag' ? 'bg-[#B47B2B]' : 'bg-[#2D6A4F]'}`} />
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--c-gold-text)]">
                  {step === 'bag' && (bn ? 'ধাপ ১: ব্যাগ পর্যালোচনা' : 'Step 1: Review Items')}
                  {step === 'checkout' && (bn ? 'ধাপ ২: নাম, ফোন ও ঠিকানা' : 'Step 2: Name, phone & address')}
                  {step === 'confirmed' && (bn ? 'ধাপ ৩: অর্ডার কনফার্মেশন' : 'Step 3: Confirmed')}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={bn ? 'বন্ধ করুন' : 'Close drawer'}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[rgb(var(--c-tint)/0.16)] bg-[var(--c-bg)] text-[var(--c-ink)] hover:bg-[var(--c-surface)] transition-colors shadow-xs"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {step === 'confirmed' && lastConfirmedOrder ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#B47B2B]/35 bg-[var(--c-surface)] p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[var(--c-gold-text)]" />
                  <div>
                    <p className="font-mono text-xs font-medium uppercase tracking-wide text-[var(--c-gold-text)] tabular-nums">
                      {lastConfirmedOrder.orderNumber} ·{' '}
                      {lastConfirmedOrder.paymentStatus === 'pending_verification'
                        ? bn
                          ? 'পেমেন্ট যাচাই অপেক্ষমাণ'
                          : 'Pending Payment Verification'
                        : bn
                          ? 'ক্যাশ অন ডেলিভারি'
                          : 'Cash on Delivery'}
                    </p>
                    <h3 className="font-display mt-1 text-xl font-semibold text-[var(--c-ink)]">
                      {bn ? 'আপনার অর্ডারটি গ্রহণ করা হয়েছে' : 'Order Recorded Successfully'}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[var(--c-muted)]">
                      {lastConfirmedOrder.paymentMethod === 'cod'
                        ? bn
                          ? 'আমাদের টিম শীঘ্রই কল করে ডেলিভারি নিশ্চিত করবে।'
                          : 'Our team will verify your delivery address and dispatch from our fresh batch.'
                        : bn
                          ? 'আপনার TxnID যাচাইয়ের জন্য সংরক্ষণ করা হয়েছে। অ্যাডমিন যাচাইয়ের পর অর্ডার কনফার্ম হবে।'
                          : 'Your transaction ID has been recorded and remains pending verification until confirmed by our team.'}
                    </p>
                    {lastConfirmedOrder.duplicateWarning && (
                      <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                        {lastConfirmedOrder.duplicateWarning}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-card)] p-5 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--c-muted)]">{bn ? 'ক্রেতা' : 'Customer'}</span>
                  <span className="font-medium">{lastConfirmedOrder.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--c-muted)]">{bn ? 'মোবাইল' : 'Phone'}</span>
                  <span className="font-mono tabular-nums">{lastConfirmedOrder.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--c-muted)]">{bn ? 'পণ্য ও ওজন' : 'Variant & Qty'}</span>
                  <span className="font-mono tabular-nums text-right">
                    {lastConfirmedOrder.itemsSummary ||
                      `${lastConfirmedOrder.weight} × ${lastConfirmedOrder.qty}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--c-muted)]">{bn ? 'ঠিকানা' : 'Address'}</span>
                  <span className="max-w-[210px] text-right text-[var(--c-ink)]">
                    {lastConfirmedOrder.address}, {lastConfirmedOrder.area},{' '}
                    {lastConfirmedOrder.district}
                  </span>
                </div>
                <div className="flex justify-between border-t border-[rgb(var(--c-tint)/0.10)] pt-3">
                  <span className="font-medium text-[var(--c-ink)]">
                    {bn ? 'সর্বমোট মূল্য' : 'Total Amount'}
                  </span>
                  <span className="font-mono text-base font-semibold tabular-nums text-[var(--c-gold-text)]">
                    {formatBdt(lastConfirmedOrder.totalBdt)}
                  </span>
                </div>
              </div>

              <div className="space-y-2.5">
                {lastConfirmedOrder.paymentStatus !== 'verified' &&
                  (onlineGateways.sslcommerz || onlineGateways.bkash) && (
                    <div className="space-y-2 rounded-xl border border-[rgba(180,123,43,0.3)] bg-[var(--c-bg)] p-3">
                      <p className="text-xs font-semibold text-[var(--c-ink)]">
                        {bn ? 'তাৎক্ষণিক অনলাইন পেমেন্ট করুন' : 'Pay Online Instantly'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {onlineGateways.sslcommerz && (
                          <button
                            type="button"
                            disabled={Boolean(gatewayBusy)}
                            onClick={() =>
                              handleStartOnlinePayment('sslcommerz', lastConfirmedOrder)
                            }
                            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#B47B2B] px-3 py-2 text-xs font-semibold text-[var(--c-on-gold)] hover:bg-[#9D6820] disabled:opacity-55"
                          >
                            {gatewayBusy === 'sslcommerz' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CreditCard className="h-3.5 w-3.5" />
                            )}
                            <span>{bn ? 'SSLCommerz দিয়ে পেমেন্ট' : 'Pay via SSLCommerz'}</span>
                          </button>
                        )}
                        {onlineGateways.bkash && (
                          <button
                            type="button"
                            disabled={Boolean(gatewayBusy)}
                            onClick={() => handleStartOnlinePayment('bkash', lastConfirmedOrder)}
                            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#B47B2B] bg-[var(--c-card)] px-3 py-2 text-xs font-semibold text-[var(--c-gold-text)] hover:bg-[var(--c-surface)] disabled:opacity-55"
                          >
                            {gatewayBusy === 'bkash' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CreditCard className="h-3.5 w-3.5" />
                            )}
                            <span>{bn ? 'bKash গেটওয়ে পেমেন্ট' : 'Pay via bKash'}</span>
                          </button>
                        )}
                      </div>
                      {gatewayError && (
                        <p className="text-[11px] font-medium text-red-700">{gatewayError}</p>
                      )}
                    </div>
                  )}
                <a
                  href={buildWhatsappSupportUrl(lastConfirmedOrder)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--c-accent)] px-5 py-3.5 text-sm font-medium text-[var(--c-on-accent)] hover:bg-[var(--c-accent-hover)]"
                >
                  <MessageCircle className="h-4 w-4 text-[#D89B2B]" />
                  <span>
                    {bn ? 'হোয়াটসঅ্যাপে অর্ডার শেয়ার করুন' : 'Message Order on WhatsApp'}
                  </span>
                </a>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateTrack(
                      lastConfirmedOrder.orderNumber,
                      lastConfirmedOrder.phone
                    );
                  }}
                  className="w-full rounded-lg border border-[rgb(var(--c-tint)/0.2)] bg-[var(--c-surface)] px-5 py-3 text-sm font-medium text-[var(--c-ink)] hover:bg-[var(--c-elev)]"
                >
                  {bn ? 'লাইভ অর্ডার ট্র্যাক করুন' : 'Track This Order'}
                </button>
              </div>
            </div>
          ) : cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--c-surface)] text-[var(--c-gold-text)]">
                <ShoppingBag className="h-6 w-6" />
              </div>
              <div>
                <p className="font-display text-lg font-medium text-[var(--c-ink)]">
                  {bn ? 'আপনার ব্যাগটি বর্তমানে খালি' : 'Your bag is empty'}
                </p>
                <p className="mt-1 max-w-[28ch] text-sm text-[var(--c-muted)]">
                  {bn
                    ? 'অর্ডার করতে ২৫০ গ্রাম, ৫০০ গ্রাম বা ১ কেজি জার বেছে নিন।'
                    : 'Choose 250g, 500g, or 1kg Pabna Deshi Cow Ghee to get started.'}
                </p>
              </div>
              {lastConfirmedOrder && (
                <button
                  type="button"
                  onClick={() => setStep('confirmed')}
                  className="rounded-lg border border-[rgb(var(--c-tint)/0.2)] px-4 py-2 text-xs font-medium text-[var(--c-ink)] hover:bg-[var(--c-surface)]"
                >
                  {bn
                    ? `সর্বশেষ অর্ডার দেখুন (${lastConfirmedOrder.orderNumber})`
                    : `View Last Order (${lastConfirmedOrder.orderNumber})`}
                </button>
              )}
              <a
                href="/#order"
                onClick={onClose}
                className="rounded-lg bg-[#B47B2B] px-5 py-3 text-sm font-medium text-[var(--c-on-gold)] hover:bg-[#96621B]"
              >
                {bn ? 'ওজন নির্বাচন করুন' : 'Select Jar Weight'}
              </a>
            </div>
          ) : step === 'bag' ? (
            <div className="space-y-4">
              {/* Free Delivery Milestone Progress — only when the owner configured a threshold */}
              {freeThresholdConfirmed && (
              <div className="rounded-2xl border border-[rgba(180,123,43,0.22)] bg-[var(--c-band)] p-4 shadow-xs">
                <div className="flex items-center gap-2.5 text-xs font-semibold text-[var(--c-ink)]">
                  <Truck className="h-4 w-4 shrink-0 text-[#B47B2B]" />
                  {qualifiesFree ? (
                    <span className="text-[var(--c-green-text)] flex items-center gap-1 font-bold">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {bn
                        ? 'অভিনন্দন! আপনার অর্ডারে ফ্রি ডেলিভারি আনলক হয়েছে।'
                        : 'Congratulations! Free delivery unlocked.'}
                    </span>
                  ) : (
                    <span>
                      {bn
                        ? `ফ্রি ডেলিভারি পেতে আরও ${formatBdt(remainingForFree)} এর ঘি যোগ করুন।`
                        : `Add ${formatBdt(remainingForFree)} more to unlock free delivery.`}
                    </span>
                  )}
                </div>
                <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[var(--c-elev)]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#B47B2B] to-[#D4AF37] transition-all duration-300"
                    style={{ width: `${freeProgressPct}%` }}
                  />
                </div>
              </div>
              )}

              {/* Cart Items */}
              <div className="space-y-3">
                {cart.map((item) => {
                  const unitPrice = getPriceForWeight(item.weight);
                  const stockAvail = getStockForWeight(item.weight);
                  const awaitingConfirm = confirmRemoveWeight === item.weight;
                  return (
                    <div key={item.weight} className="flex items-start gap-3.5 p-3.5 rounded-2xl border border-[rgb(var(--c-tint)/0.08)] bg-[var(--c-card)] shadow-xs">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-[rgb(var(--c-tint)/0.10)] bg-[var(--c-surface)]">
                        <ResilientImage
                          src={IMAGES.heroFront}
                          alt="Deshi Gee jar"
                          fallbackTitle={item.weight}
                          className="h-full w-full object-cover"
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-display text-sm font-bold text-[var(--c-ink)] sm:text-base">
                              {bn ? settings.productNameBn : settings.productNameEn}
                            </h3>
                            <p className="mt-0.5 font-mono text-xs font-semibold text-[var(--c-gold-text)] tabular-nums">
                              {item.weight} · {formatBdt(unitPrice)}
                            </p>
                          </div>

                          {awaitingConfirm ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  onRemoveItem(item.weight);
                                  setConfirmRemoveWeight(null);
                                }}
                                className="min-h-[40px] rounded-lg bg-red-700 px-3 py-1.5 text-xs font-bold text-white shadow-xs"
                              >
                                {bn ? 'মুছুন' : 'Delete'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmRemoveWeight(null)}
                                className="min-h-[40px] rounded-lg border border-[rgb(var(--c-tint)/0.2)] bg-[var(--c-bg)] px-3 py-1.5 text-xs"
                              >
                                {bn ? 'বাতিল' : 'Cancel'}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmRemoveWeight(item.weight)}
                              aria-label={bn ? 'সরান' : 'Remove item'}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[#8A7867] hover:bg-red-50 hover:text-red-700 transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>

                        <div className="mt-3 flex items-center justify-between">
                          <div className="inline-flex items-center rounded-xl border border-[rgb(var(--c-tint)/0.16)] bg-[var(--c-bg)]">
                            <button
                              type="button"
                              onClick={() => onUpdateQty(item.weight, -1)}
                              aria-label="Decrease quantity"
                              className="flex h-11 w-11 items-center justify-center text-[var(--c-ink)] hover:bg-[var(--c-surface)] transition-colors"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-8 text-center font-mono text-sm font-bold tabular-nums text-[var(--c-ink)]">
                              {bn ? toBengaliDigits(item.qty) : item.qty}
                            </span>
                            <button
                              type="button"
                              disabled={item.qty >= stockAvail}
                              onClick={() => onUpdateQty(item.weight, 1)}
                              aria-label="Increase quantity"
                              className="flex h-11 w-11 items-center justify-center text-[var(--c-ink)] hover:bg-[var(--c-surface)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <span className="font-mono text-sm font-bold tabular-nums text-[var(--c-ink)]">
                            {formatBdt(unitPrice * item.qty)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Coupon Input */}
              <div className="space-y-2 border-t border-[rgb(var(--c-tint)/0.10)] pt-4">
                <label
                  htmlFor="bag-coupon"
                  className="flex items-center gap-1.5 text-xs font-medium text-[var(--c-muted)]"
                >
                  <Tag className="h-3.5 w-3.5 text-[var(--c-gold-text)]" />
                  <span>{bn ? 'প্রোমো কোড (ঐচ্ছিক)' : 'Coupon Code (Optional)'}</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id="bag-coupon"
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder={bn ? 'কুপন কোড লিখুন' : 'Enter promo code'}
                    className="min-h-[44px] flex-1 rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3 py-2 font-mono text-base uppercase text-[var(--c-ink)] focus:border-[#B47B2B] focus:outline-none sm:text-xs"
                  />
                  <button
                    type="button"
                    disabled={couponLoading}
                    onClick={handleApplyCoupon}
                    className="min-h-[44px] rounded-lg border border-[rgb(var(--c-tint)/0.2)] bg-[var(--c-surface)] px-4 py-2 text-xs font-medium text-[var(--c-ink)] hover:bg-[var(--c-elev)] disabled:opacity-50"
                  >
                    {couponLoading ? '...' : bn ? 'প্রয়োগ' : 'Apply'}
                  </button>
                </div>
                {couponFeedback && (
                  <p className="text-xs text-[var(--c-gold-text)]">{couponFeedback}</p>
                )}
              </div>

              {/* District Preview for Delivery Fee */}
              <div className="space-y-2">
                <label
                  htmlFor="bag-district-preview"
                  className="block text-xs font-medium text-[var(--c-muted)]"
                >
                  {bn ? 'ডেলিভারি জেলা নির্বাচন করুন' : 'Select Delivery District'}
                </label>
                <select
                  id="bag-district-preview"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3 py-2.5 text-base text-[var(--c-ink)] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                >
                  {BANGLADESH_DISTRICTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                {(estimatedDeliveryWindow || cutoffNotice) && (
                  <p className="text-xs text-[var(--c-muted)]">
                    {[estimatedDeliveryWindow, cutoffNotice].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* Step 2: Full Checkout Form + Payment Selection */
            <form id="deshi-checkout-form" onSubmit={handleSubmitOrder} className="space-y-4">
              {orderingUnavailable && (
                <div
                  role="status"
                  aria-live="polite"
                  data-testid="ordering-temporarily-unavailable"
                  className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-[#1E1710]"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-800" />
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-amber-950">
                        {bn ? 'অনলাইন অর্ডার সাময়িকভাবে অনুপলব্ধ' : 'Ordering is temporarily unavailable'}
                      </p>
                      <p className="text-xs leading-relaxed text-amber-900">
                        {orderingUnavailable}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setOrderingUnavailable('')}
                          className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-amber-400 bg-[var(--c-card)] px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
                        >
                          {bn ? 'আবার চেষ্টা করুন' : 'Try Again'}
                        </button>
                        {hasValidRealPhone(settings.supportPhone) && (
                          <a
                            href={`tel:${settings.supportPhone.replace(/[^+\d]/g, '')}`}
                            className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-[var(--c-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--c-on-accent)] hover:bg-[var(--c-accent-hover)]"
                          >
                            {bn ? 'সাপোর্টে কল করুন' : 'Call Support'}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {formError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <p className="rounded-lg bg-[rgb(var(--c-tint)/0.06)] px-3 py-2 text-[11px] leading-relaxed text-[var(--c-muted)]">
                {bn
                  ? 'অর্ডার সম্পন্ন না হলেও যেন আমরা প্রয়োজনে ফোনে সাহায্য করতে পারি, তাই আপনার মোবাইল নম্বর ও নির্বাচিত পরিমাণ সাময়িকভাবে সংরক্ষিত হতে পারে। এটি শুধু আপনার অর্ডারের ফলো-আপে ব্যবহার হবে।'
                  : 'So we can help if you do not finish, your mobile number and selected jars may be saved temporarily. This is used only to follow up on your order.'}
              </p>

              <div>
                <label htmlFor="co-name" className="block text-xs font-medium text-[var(--c-muted)]">
                  {bn ? 'পূর্ণ নাম *' : 'Full Name *'}
                </label>
                <input
                  id="co-name"
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                    autoComplete="name"
                  placeholder={bn ? 'যেমন: তারিকুল ইসলাম' : 'e.g. Tariqul Islam'}
                  className="mt-1 w-full rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3.5 py-2.5 text-base text-[var(--c-ink)] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="co-phone" className="block text-xs font-medium text-[var(--c-muted)]">
                  {bn ? 'মোবাইল নম্বর (বাংলাদেশ) *' : 'Bangladesh Mobile Number *'}
                </label>
                <input
                  id="co-phone"
                  type="tel"
                  inputMode="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                  placeholder="017XXXXXXXX"
                  className="mt-1 w-full rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3.5 py-2.5 font-mono text-base text-[var(--c-ink)] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="co-district" className="block text-xs font-medium text-[var(--c-muted)]">
                  {bn ? 'জেলা *' : 'District *'}
                </label>
                <select
                  id="co-district"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3 py-2.5 text-base text-[var(--c-ink)] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                >
                  {BANGLADESH_DISTRICTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="co-address" className="block text-xs font-medium text-[var(--c-muted)]">
                  {bn ? 'সম্পূর্ণ ঠিকানা *' : 'Complete Delivery Address *'}
                </label>
                <textarea
                  id="co-address"
                  rows={3}
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                    autoComplete="street-address"
                  placeholder={bn ? 'বাসা, রোড, এলাকা/থানা (যেমন: বাসা ১২, রোড ৫, মিরপুর-১০)' : 'House, road, area / thana (e.g. House 12, Road 5, Mirpur-10)'}
                  className="mt-1 w-full rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3.5 py-2.5 text-base text-[var(--c-ink)] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                />
                {!addressCheck.complete && (
                  <p className="mt-1 text-[11px] text-[var(--c-gold-text)]">
                    {bn
                      ? 'দয়া করে বাড়ি, সড়ক বা ফ্ল্যাট নম্বরসহ বিস্তারিত ঠিকানা লিখুন।'
                      : 'Add house, road, or floor details for accurate courier delivery.'}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="co-note" className="block text-xs font-medium text-[var(--c-muted)]">
                  {bn ? 'অতিরিক্ত নির্দেশনা (ঐচ্ছিক)' : 'Order Note (Optional)'}
                </label>
                <input
                  id="co-note"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={bn ? 'ডেলিভারির সময় বা নোট' : 'Preferred time or landmark'}
                  className="mt-1 w-full rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3.5 py-2.5 text-base text-[var(--c-ink)] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                />
              </div>

              {/* Payment — Cash on Delivery only */}
              <div className="flex items-start gap-3 rounded-xl border border-[#B47B2B]/35 bg-[#B47B2B]/10 p-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#B47B2B] text-[var(--c-on-gold)]">
                  <Truck className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--c-ink)]">
                    {bn ? 'ক্যাশ অন ডেলিভারি' : 'Cash on Delivery'}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--c-muted)]">
                    {bn
                      ? 'এখন কোনো টাকা দিতে হবে না। ঘি হাতে পেয়ে ডেলিভারি ম্যানকে মূল্য পরিশোধ করুন।'
                      : 'Nothing to pay now. Pay in cash to the delivery person when your ghee arrives.'}
                  </p>
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Footer Totals */}
        {cart.length > 0 && step !== 'confirmed' && (
          <div className="border-t border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-surface)]/85 px-4 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
            <div className="space-y-1 text-xs sm:text-sm">
              <div className="flex justify-between text-[var(--c-muted)]">
                <span>{bn ? 'সাবটোটাল' : 'Subtotal'}</span>
                <span className="font-mono tabular-nums">{formatBdt(subtotal)}</span>
              </div>
              <div className="flex justify-between text-[var(--c-muted)]">
                <span>
                  {bn ? 'ডেলিভারি' : 'Delivery'} ({district})
                </span>
                <span className="font-mono tabular-nums">
                  {deliveryFee === 0 ? (bn ? 'ফ্রি' : 'Free') : formatBdt(deliveryFee)}
                </span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between text-[var(--c-gold-text)]">
                  <span>{bn ? 'ছাড়' : 'Discount'}</span>
                  <span className="font-mono tabular-nums">
                    -{formatBdt(totalDiscount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-1.5 text-base font-semibold text-[var(--c-ink)]">
                <span>{bn ? 'সর্বমোট' : 'Final Payable'}</span>
                <span className="font-mono tabular-nums text-[var(--c-gold-text)]">
                  {formatBdt(grandTotal)}
                </span>
              </div>
            </div>

            {step === 'checkout' && formError && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {step === 'bag' ? (
              <button
                type="button"
                onClick={handleProceedCheckout}
                className="mt-3.5 min-h-[50px] w-full rounded-xl bg-gradient-to-r from-[#B47B2B] via-[#C98A2C] to-[#96621B] px-5 py-3 text-sm font-bold text-[var(--c-on-gold)] shadow-[0_8px_20px_-4px_rgba(180,123,43,0.35)] hover:scale-[1.01] transition-all"
              >
                {bn ? 'চেকআউটে এগিয়ে যান' : 'Proceed to Checkout'} · {formatBdt(grandTotal)}
              </button>
            ) : (
              <button
                type="submit"
                form="deshi-checkout-form"
                disabled={submitting}
                className="mt-3.5 inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#B47B2B] via-[#C98A2C] to-[#96621B] px-5 py-3 text-sm font-bold text-[var(--c-on-gold)] shadow-[0_8px_20px_-4px_rgba(180,123,43,0.35)] hover:scale-[1.01] disabled:opacity-60 transition-all"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin text-[#FFFDF9]" />}
                <span>
                  {submitting
                    ? bn
                      ? 'অর্ডার জমা হচ্ছে...'
                      : 'Recording Order...'
                    : `${bn ? 'অর্ডার নিশ্চিত করুন' : 'Place Order'} · ${formatBdt(grandTotal)}`}
                </span>
              </button>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
