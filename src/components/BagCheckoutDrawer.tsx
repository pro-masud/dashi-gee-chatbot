'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
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
  DEFAULT_STORE_SETTINGS,
  DeliveryZone,
  OrderRecord,
  PaymentMethod,
  StoreSettingsDoc,
  WeightKey,
  createOrderAtomically,
  fetchCouponByCode,
} from '../lib/firebase';
import {
  BANGLADESH_DISTRICTS,
  IMAGES,
  Lang,
  clientAssessAddressCompleteness,
  clientResolveZoneFromDistrictAndArea,
  formatBdt,
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

  const bn = lang === 'bn';

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch('/api/integrations/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data?.payments) return;
        setOnlineGateways({
          sslcommerz: Boolean(data.payments.sslcommerz?.configured),
          bkash: Boolean(data.payments.bkash?.configured),
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

  const getPriceForWeight = (weight: WeightKey): number => {
    if (weight === '250g') return settings.price250g;
    if (weight === '500g') return settings.price500g;
    return settings.price1kg;
  };

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
  const suburbanFee = settings.dhakaSuburbanFee ?? DEFAULT_STORE_SETTINGS.dhakaSuburbanFee ?? 90;
  const remoteFee = settings.remoteDistrictFee ?? DEFAULT_STORE_SETTINGS.remoteDistrictFee ?? 170;
  const qualifiesFree = subtotal >= settings.freeDeliveryThreshold;
  const deliveryFee =
    cart.length === 0 || qualifiesFree
      ? 0
      : deliveryZone === 'dhaka'
        ? settings.insideDhakaFee
        : deliveryZone === 'suburban'
          ? suburbanFee
          : deliveryZone === 'remote'
            ? remoteFee
            : settings.outsideDhakaFee;

  const estimatedDeliveryWindow =
    deliveryZone === 'dhaka'
      ? settings.estimatedDhakaDays
      : deliveryZone === 'suburban'
        ? settings.estimatedSuburbanDays || DEFAULT_STORE_SETTINGS.estimatedSuburbanDays || '2-3 days'
        : deliveryZone === 'remote'
          ? settings.estimatedRemoteDays || DEFAULT_STORE_SETTINGS.estimatedRemoteDays || '4-6 days'
          : settings.estimatedOutsideDays;

  const addressCheck = address.trim()
    ? clientAssessAddressCompleteness(address, area, district)
    : { complete: true };

  const advanceDiscountPct =
    paymentMethod !== 'cod' && settings.advanceDiscountPct > 0
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
  const totalDiscount = Math.round(
    (subtotal * Math.min(50, advanceDiscountPct + couponPct)) / 100
  );
  const grandTotal = Math.max(1, subtotal + deliveryFee - totalDiscount);
  const remainingForFree = Math.max(0, settings.freeDeliveryThreshold - subtotal);
  const freeProgressPct =
    settings.freeDeliveryThreshold > 0
      ? Math.min(100, Math.round((subtotal / settings.freeDeliveryThreshold) * 100))
      : 100;

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCouponLoading(true);
    setCouponFeedback('');
    try {
      const found = await fetchCouponByCode(code);
      const isExpired = Boolean(
        found?.expiresAt && Number.isFinite(Date.parse(found.expiresAt)) && Date.parse(found.expiresAt) < Date.now()
      );
      const limitReached = Boolean(
        found?.maxUses && found.maxUses > 0 && (found.usedCount || 0) >= found.maxUses
      );
      if (!found || !found.active) {
        setAppliedCoupon(null);
        setCouponFeedback(
          bn ? 'কুপন কোডটি সঠিক নয় বা নিষ্ক্রিয়।' : 'Coupon code is invalid or inactive.'
        );
      } else if (isExpired) {
        setAppliedCoupon(null);
        setCouponFeedback(bn ? 'এই কুপনের মেয়াদ শেষ হয়ে গেছে।' : 'This coupon has expired.');
      } else if (limitReached) {
        setAppliedCoupon(null);
        setCouponFeedback(
          bn ? 'এই কুপনের সর্বোচ্চ ব্যবহারসীমা পূর্ণ হয়েছে।' : 'This coupon has reached its usage limit.'
        );
      } else if (subtotal < found.minSubtotalBdt) {
        setAppliedCoupon(null);
        setCouponFeedback(
          bn
            ? `এই কুপনের জন্য ন্যূনতম ${formatBdt(found.minSubtotalBdt)} অর্ডার প্রয়োজন।`
            : `Minimum ${formatBdt(found.minSubtotalBdt)} subtotal required for this coupon.`
        );
      } else if (paymentMethod !== 'cod' && found.stackableWithAdvance === false) {
        setAppliedCoupon(found);
        setCouponFeedback(
          bn
            ? `কুপন গৃহীত, তবে ${found.discountPct}% কোডটি বিকাশ/নগদ অগ্রিম ডিসকাউন্টের সাথে একত্রে প্রযোজ্য নয়।`
            : `Coupon saved, note ${found.discountPct}% cannot stack with advance MFS discount.`
        );
      } else {
        setAppliedCoupon(found);
        setCouponFeedback(
          bn
            ? `${found.discountPct}% ছাড় প্রযোজ্য হয়েছে।`
            : `${found.discountPct}% discount applied.`
        );
      }
    } catch {
      setCouponFeedback(
        bn ? 'কুপন যাচাই করতে সমস্যা হয়েছে।' : 'Unable to verify coupon right now.'
      );
    } finally {
      setCouponLoading(false);
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

  const handleSubmitOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!primaryItem || submitting) return;

    const cleanPhone = phone.replace(/[\s-]/g, '');
    if (customerName.trim().length < 2) {
      setFormError(bn ? 'আপনার পূর্ণ নাম লিখুন।' : 'Please enter your full name.');
      return;
    }
    if (!/^01[3-9]\d{8}$/.test(cleanPhone)) {
      setFormError(
        bn
          ? 'সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন (যেমন 017XXXXXXXX)।'
          : 'Enter a valid 11-digit Bangladesh mobile number (01XXXXXXXXX).'
      );
      return;
    }
    if (area.trim().length < 2) {
      setFormError(bn ? 'আপনার এলাকার নাম লিখুন।' : 'Please enter your area or thana.');
      return;
    }
    const addrValid = clientAssessAddressCompleteness(address, area, district);
    if (!addrValid.complete) {
      setFormError(
        bn
          ? 'কুরিয়ার ডেলিভারির জন্য অনুগ্রহ করে সম্পূর্ণ বাড়ি, সড়ক বা ফ্ল্যাট নম্বরসহ ঠিকানা লিখুন।'
          : 'Please enter a full delivery street/house/road address so the courier can locate you.'
      );
      return;
    }
    if ((paymentMethod === 'bkash' || paymentMethod === 'nagad') && txnId.trim().length < 4) {
      setFormError(
        bn
          ? 'সঠিক বিকাশ/নগদ ট্রানজেকশন আইডি (TxnID) লিখুন।'
          : 'Please enter a valid bKash or Nagad Transaction ID (TxnID).'
      );
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

      const prepareRes = await fetch('/api/orders/prepare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          customerName: customerName.trim(),
          phone: cleanPhone,
          district,
          area: area.trim(),
          address: address.trim(),
          note: combinedNote.slice(0, 240),
          deliveryZone,
          qty250g,
          qty500g,
          qty1kg,
          paymentMethod,
          txnId: paymentMethod === 'cod' ? '' : txnId.trim(),
          couponCode: appliedCoupon?.code || '',
        }),
      });

      const prepared = await prepareRes.json();
      if (!prepareRes.ok) {
        setFormError(
          prepared.error ||
            (bn ? 'অর্ডার যাচাই করতে ব্যর্থ হয়েছে।' : 'Failed to validate order.')
        );
        setSubmitting(false);
        return;
      }

      const resolvedDistrict = String(prepared.district || district);
      const resolvedZone = (prepared.deliveryZone || deliveryZone) as DeliveryZone;
      const estDelivery = String(prepared.estimatedDelivery || estimatedDeliveryWindow);

      const orderPayload: Omit<OrderRecord, 'createdAt' | 'updatedAt'> = {
        orderNumber: prepared.orderNumber,
        customerName: customerName.trim().slice(0, 100),
        phone: cleanPhone,
        district: resolvedDistrict,
        area: area.trim().slice(0, 100),
        address: address.trim().slice(0, 300),
        note: combinedNote.slice(0, 240),
        deliveryZone: resolvedZone,
        weight: prepared.weight,
        qty: prepared.qty,
        qty250g: prepared.qty250g,
        qty500g: prepared.qty500g,
        qty1kg: prepared.qty1kg,
        itemsSummary: prepared.itemsSummary,
        unitPriceBdt: prepared.unitPriceBdt,
        subtotalBdt: prepared.subtotalBdt,
        deliveryFeeBdt: prepared.deliveryFeeBdt,
        discountBdt: prepared.discountBdt,
        totalBdt: prepared.totalBdt,
        couponCode: appliedCoupon?.code || '',
        paymentMethod,
        paymentStatus: prepared.paymentStatus,
        txnId: paymentMethod === 'cod' ? '' : txnId.trim().slice(0, 64),
        paymentProofData: paymentMethod === 'cod' ? '' : paymentProofData.slice(0, 180000),
        status: 'pending',
        estimatedDelivery: estDelivery,
        webhookStatus: 'pending',
        ...(typeof prepared.riskScore === 'number' ? { riskScore: prepared.riskScore } : {}),
        ...(Array.isArray(prepared.riskSignals) && prepared.riskSignals.length > 0
          ? { riskSignals: prepared.riskSignals }
          : {}),
        ...(prepared.reviewStatus ? { reviewStatus: prepared.reviewStatus } : {}),
        ...(prepared.duplicateWarning ? { duplicateWarning: prepared.duplicateWarning } : {}),
        ...(prepared.codVerificationStatus
          ? { codVerificationStatus: prepared.codVerificationStatus }
          : {}),
      };

      // Atomic Firestore persistence (orders + PII-safe order_tracking + audit log + stock decrement)
      await createOrderAtomically(orderPayload);

      // Fire non-blocking owner notification webhook (failure never erases saved order)
      try {
        await fetch('/api/orders/notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'DeshiGeeStorefront',
          },
          body: JSON.stringify({
            orderNumber: orderPayload.orderNumber,
            customerName: orderPayload.customerName,
            phone: orderPayload.phone,
            weight: orderPayload.itemsSummary,
            qty: orderPayload.qty,
            totalBdt: orderPayload.totalBdt,
            paymentMethod: orderPayload.paymentMethod,
            address: `${orderPayload.address}, ${orderPayload.area}, ${orderPayload.district}`,
          }),
        });
      } catch {
        // notification log handled server-side without blocking user confirmation
      }

      trackStoreEvent('Purchase', {
        transaction_id: orderPayload.orderNumber,
        currency: 'BDT',
        value: orderPayload.totalBdt,
      });

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
        className="fixed inset-0 z-40 bg-[#1E1710]/45 backdrop-blur-xs transition-opacity"
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={bn ? 'শপিং ব্যাগ ও চেকআউট' : 'Shopping bag and checkout'}
        hidden={!open}
        className="drawer-panel fixed inset-y-0 right-0 z-50 flex h-dvh max-h-dvh w-full max-w-md flex-col overscroll-contain border-l border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] text-[#1E1710] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[rgba(30,23,16,0.10)] px-5 py-4 bg-[#F4EFE6]/60">
          <div className="flex items-center gap-3">
            {step === 'checkout' && (
              <button
                type="button"
                onClick={() => {
                  setFormError('');
                  setStep('bag');
                }}
                aria-label={bn ? 'ব্যাগে ফিরে যান' : 'Back to bag'}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(30,23,16,0.16)] bg-[#FAF7F2] text-[#1E1710] hover:bg-[#F2ECE1] transition-colors shadow-xs"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <h2 className="font-display text-lg font-bold text-[#1E1710] sm:text-xl">
                {step === 'bag' && (bn ? 'আপনার শপিং ব্যাগ' : 'Shopping Bag')}
                {step === 'checkout' && (bn ? 'ঠিকানা ও পেমেন্ট' : 'Checkout & Payment')}
                {step === 'confirmed' && (bn ? 'অর্ডার সফলভাবে গৃহীত' : 'Order Recorded')}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`h-1.5 w-1.5 rounded-full ${step === 'bag' ? 'bg-[#B47B2B]' : 'bg-[#2D6A4F]'}`} />
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#8A5A17]">
                  {step === 'bag' && (bn ? 'ধাপ ১: ব্যাগ পর্যালোচনা' : 'Step 1: Review Items')}
                  {step === 'checkout' && (bn ? 'ধাপ ২: ডেলিভারি তথ্য' : 'Step 2: Shipping & Payment')}
                  {step === 'confirmed' && (bn ? 'ধাপ ৩: অর্ডার কনফার্মেশন' : 'Step 3: Confirmed')}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={bn ? 'বন্ধ করুন' : 'Close drawer'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(30,23,16,0.16)] bg-[#FAF7F2] text-[#1E1710] hover:bg-[#F2ECE1] transition-colors shadow-xs"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {step === 'confirmed' && lastConfirmedOrder ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#B47B2B]/35 bg-[#F2ECE1] p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[#8A5A17]" />
                  <div>
                    <p className="font-mono text-xs font-medium uppercase tracking-wide text-[#8A5A17] tabular-nums">
                      {lastConfirmedOrder.orderNumber} ·{' '}
                      {lastConfirmedOrder.paymentStatus === 'pending_verification'
                        ? bn
                          ? 'পেমেন্ট যাচাই অপেক্ষমাণ'
                          : 'Pending Payment Verification'
                        : bn
                          ? 'ক্যাশ অন ডেলিভারি'
                          : 'Cash on Delivery'}
                    </p>
                    <h3 className="font-display mt-1 text-xl font-semibold text-[#1E1710]">
                      {bn ? 'আপনার অর্ডারটি গ্রহণ করা হয়েছে' : 'Order Recorded Successfully'}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#635647]">
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

              <div className="space-y-3 rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#635647]">{bn ? 'ক্রেতা' : 'Customer'}</span>
                  <span className="font-medium">{lastConfirmedOrder.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#635647]">{bn ? 'মোবাইল' : 'Phone'}</span>
                  <span className="font-mono tabular-nums">{lastConfirmedOrder.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#635647]">{bn ? 'পণ্য ও ওজন' : 'Variant & Qty'}</span>
                  <span className="font-mono tabular-nums text-right">
                    {lastConfirmedOrder.itemsSummary ||
                      `${lastConfirmedOrder.weight} × ${lastConfirmedOrder.qty}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#635647]">{bn ? 'ঠিকানা' : 'Address'}</span>
                  <span className="max-w-[210px] text-right text-[#1E1710]">
                    {lastConfirmedOrder.address}, {lastConfirmedOrder.area},{' '}
                    {lastConfirmedOrder.district}
                  </span>
                </div>
                <div className="flex justify-between border-t border-[rgba(30,23,16,0.10)] pt-3">
                  <span className="font-medium text-[#1E1710]">
                    {bn ? 'সর্বমোট মূল্য' : 'Total Amount'}
                  </span>
                  <span className="font-mono text-base font-semibold tabular-nums text-[#8A5A17]">
                    {formatBdt(lastConfirmedOrder.totalBdt)}
                  </span>
                </div>
              </div>

              <div className="space-y-2.5">
                {lastConfirmedOrder.paymentStatus !== 'verified' &&
                  (onlineGateways.sslcommerz || onlineGateways.bkash) && (
                    <div className="space-y-2 rounded-xl border border-[rgba(180,123,43,0.3)] bg-[#FAF7F2] p-3">
                      <p className="text-xs font-semibold text-[#1E1710]">
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
                            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#B47B2B] px-3 py-2 text-xs font-semibold text-[#FFFDF9] hover:bg-[#9D6820] disabled:opacity-55"
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
                            className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#B47B2B] bg-[#FFFDF9] px-3 py-2 text-xs font-semibold text-[#8A5A17] hover:bg-[#F2ECE1] disabled:opacity-55"
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
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1E1710] px-5 py-3.5 text-sm font-medium text-[#FAF7F2] hover:bg-[#35291E]"
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
                  className="w-full rounded-lg border border-[rgba(30,23,16,0.2)] bg-[#F2ECE1] px-5 py-3 text-sm font-medium text-[#1E1710] hover:bg-[#EAE1D2]"
                >
                  {bn ? 'লাইভ অর্ডার ট্র্যাক করুন' : 'Track This Order'}
                </button>
              </div>
            </div>
          ) : cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#F2ECE1] text-[#8A5A17]">
                <ShoppingBag className="h-6 w-6" />
              </div>
              <div>
                <p className="font-display text-lg font-medium text-[#1E1710]">
                  {bn ? 'আপনার ব্যাগটি বর্তমানে খালি' : 'Your bag is empty'}
                </p>
                <p className="mt-1 max-w-[28ch] text-sm text-[#635647]">
                  {bn
                    ? 'অর্ডার করতে ২৫০ গ্রাম, ৫০০ গ্রাম বা ১ কেজি জার বেছে নিন।'
                    : 'Choose 250g, 500g, or 1kg Pabna Deshi Cow Ghee to get started.'}
                </p>
              </div>
              {lastConfirmedOrder && (
                <button
                  type="button"
                  onClick={() => setStep('confirmed')}
                  className="rounded-lg border border-[rgba(30,23,16,0.2)] px-4 py-2 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
                >
                  {bn
                    ? `সর্বশেষ অর্ডার দেখুন (${lastConfirmedOrder.orderNumber})`
                    : `View Last Order (${lastConfirmedOrder.orderNumber})`}
                </button>
              )}
              <a
                href="/#order"
                onClick={onClose}
                className="rounded-lg bg-[#B47B2B] px-5 py-3 text-sm font-medium text-[#FFFDF9] hover:bg-[#96621B]"
              >
                {bn ? 'ওজন নির্বাচন করুন' : 'Select Jar Weight'}
              </a>
            </div>
          ) : step === 'bag' ? (
            <div className="space-y-4">
              {/* Free Delivery Milestone Progress */}
              <div className="rounded-2xl border border-[rgba(180,123,43,0.22)] bg-[#F4EFE6] p-4 shadow-xs">
                <div className="flex items-center gap-2.5 text-xs font-semibold text-[#1E1710]">
                  <Truck className="h-4 w-4 shrink-0 text-[#B47B2B]" />
                  {qualifiesFree ? (
                    <span className="text-[#2D6A4F] flex items-center gap-1 font-bold">
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
                <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[#EAE1D2]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#B47B2B] to-[#D4AF37] transition-all duration-300"
                    style={{ width: `${freeProgressPct}%` }}
                  />
                </div>
              </div>

              {/* Cart Items */}
              <div className="space-y-3">
                {cart.map((item) => {
                  const unitPrice = getPriceForWeight(item.weight);
                  const stockAvail = getStockForWeight(item.weight);
                  const awaitingConfirm = confirmRemoveWeight === item.weight;
                  return (
                    <div key={item.weight} className="flex items-start gap-3.5 p-3.5 rounded-2xl border border-[rgba(30,23,16,0.08)] bg-[#FFFDF9] shadow-xs">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#F2ECE1]">
                        <ResilientImage
                          src={IMAGES.heroFront}
                          alt="Deshi Gee glass jar"
                          fallbackTitle={item.weight}
                          className="h-full w-full object-cover"
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-display text-sm font-bold text-[#1E1710] sm:text-base">
                              {bn ? settings.productNameBn : settings.productNameEn}
                            </h3>
                            <p className="mt-0.5 font-mono text-xs font-semibold text-[#8A5A17] tabular-nums">
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
                                className="rounded-lg bg-red-700 px-2.5 py-1 text-[11px] font-bold text-white shadow-xs"
                              >
                                {bn ? 'মুছুন' : 'Delete'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmRemoveWeight(null)}
                                className="rounded-lg border border-[rgba(30,23,16,0.2)] bg-[#FAF7F2] px-2 py-1 text-[11px]"
                              >
                                {bn ? 'বাতিল' : 'Cancel'}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmRemoveWeight(item.weight)}
                              aria-label={bn ? 'সরান' : 'Remove item'}
                              className="p-1.5 text-[#8A7867] hover:text-red-700 transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>

                        <div className="mt-3.5 flex items-center justify-between">
                          <div className="inline-flex items-center rounded-xl border border-[rgba(30,23,16,0.16)] bg-[#FAF7F2]">
                            <button
                              type="button"
                              onClick={() => onUpdateQty(item.weight, -1)}
                              aria-label="Decrease quantity"
                              className="flex h-9 w-9 items-center justify-center text-[#1E1710] hover:bg-[#F2ECE1] transition-colors"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-8 text-center font-mono text-xs font-bold tabular-nums">
                              {item.qty}
                            </span>
                            <button
                              type="button"
                              disabled={item.qty >= stockAvail}
                              onClick={() => onUpdateQty(item.weight, 1)}
                              aria-label="Increase quantity"
                              className="flex h-9 w-9 items-center justify-center text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <span className="font-mono text-sm font-bold tabular-nums text-[#1E1710]">
                            {formatBdt(unitPrice * item.qty)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Coupon Input */}
              <div className="space-y-2 border-t border-[rgba(30,23,16,0.10)] pt-4">
                <label
                  htmlFor="bag-coupon"
                  className="flex items-center gap-1.5 text-xs font-medium text-[#635647]"
                >
                  <Tag className="h-3.5 w-3.5 text-[#8A5A17]" />
                  <span>{bn ? 'প্রোমো কোড (ঐচ্ছিক)' : 'Coupon Code (Optional)'}</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id="bag-coupon"
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder="DESHI10"
                    className="min-h-[42px] flex-1 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-2 font-mono text-base uppercase text-[#1E1710] focus:border-[#B47B2B] focus:outline-none sm:text-xs"
                  />
                  <button
                    type="button"
                    disabled={couponLoading}
                    onClick={handleApplyCoupon}
                    className="min-h-[42px] rounded-lg border border-[rgba(30,23,16,0.2)] bg-[#F2ECE1] px-4 py-2 text-xs font-medium text-[#1E1710] hover:bg-[#EAE1D2] disabled:opacity-50"
                  >
                    {couponLoading ? '...' : bn ? 'প্রয়োগ' : 'Apply'}
                  </button>
                </div>
                {couponFeedback && (
                  <p className="text-xs text-[#8A5A17]">{couponFeedback}</p>
                )}
              </div>

              {/* District Preview for Delivery Fee */}
              <div className="space-y-2">
                <label
                  htmlFor="bag-district-preview"
                  className="block text-xs font-medium text-[#635647]"
                >
                  {bn ? 'ডেলিভারি জেলা নির্বাচন করুন' : 'Select Delivery District'}
                </label>
                <select
                  id="bag-district-preview"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-2.5 text-base text-[#1E1710] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                >
                  {BANGLADESH_DISTRICTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[#635647]">
                  {estimatedDeliveryWindow} ·{' '}
                  {bn
                    ? settings.cutoffNoticeBn || DEFAULT_STORE_SETTINGS.cutoffNoticeBn
                    : settings.cutoffNoticeEn || DEFAULT_STORE_SETTINGS.cutoffNoticeEn}
                </p>
              </div>
            </div>
          ) : (
            /* Step 2: Full Checkout Form + Payment Selection */
            <form id="deshi-checkout-form" onSubmit={handleSubmitOrder} className="space-y-4">
              {formError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label htmlFor="co-name" className="block text-xs font-medium text-[#635647]">
                  {bn ? 'পূর্ণ নাম *' : 'Full Name *'}
                </label>
                <input
                  id="co-name"
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={bn ? 'যেমন: তারিকুল ইসলাম' : 'e.g. Tariqul Islam'}
                  className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3.5 py-2.5 text-base text-[#1E1710] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                />
              </div>

              <div>
                <label htmlFor="co-phone" className="block text-xs font-medium text-[#635647]">
                  {bn ? 'মোবাইল নম্বর (বাংলাদেশ) *' : 'Bangladesh Mobile Number *'}
                </label>
                <input
                  id="co-phone"
                  type="tel"
                  inputMode="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="017XXXXXXXX"
                  className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3.5 py-2.5 font-mono text-base text-[#1E1710] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="co-district"
                    className="block text-xs font-medium text-[#635647]"
                  >
                    {bn ? 'জেলা *' : 'District *'}
                  </label>
                  <select
                    id="co-district"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-2.5 text-base text-[#1E1710] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                  >
                    {BANGLADESH_DISTRICTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="co-area" className="block text-xs font-medium text-[#635647]">
                    {bn ? 'এলাকা / থানা *' : 'City / Area *'}
                  </label>
                  <input
                    id="co-area"
                    type="text"
                    required
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    placeholder={bn ? 'যেমন: ধানমন্ডি' : 'e.g. Dhanmondi'}
                    className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3.5 py-2.5 text-base text-[#1E1710] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="co-address" className="block text-xs font-medium text-[#635647]">
                  {bn ? 'সম্পূর্ণ ঠিকানা *' : 'Complete Delivery Address *'}
                </label>
                <textarea
                  id="co-address"
                  rows={2}
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={bn ? 'বাড়ি, সড়ক, ফ্ল্যাট নম্বর' : 'House, Road, Floor / Flat'}
                  className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3.5 py-2.5 text-base text-[#1E1710] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                />
                {!addressCheck.complete && (
                  <p className="mt-1 text-[11px] text-[#8A5A17]">
                    {bn
                      ? 'দয়া করে বাড়ি, সড়ক বা ফ্ল্যাট নম্বরসহ বিস্তারিত ঠিকানা লিখুন।'
                      : 'Add house, road, or floor details for accurate courier delivery.'}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="co-note" className="block text-xs font-medium text-[#635647]">
                  {bn ? 'অতিরিক্ত নির্দেশনা (ঐচ্ছিক)' : 'Order Note (Optional)'}
                </label>
                <input
                  id="co-note"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={bn ? 'ডেলিভারির সময় বা নোট' : 'Preferred time or landmark'}
                  className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3.5 py-2.5 text-base text-[#1E1710] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                />
              </div>

              {/* Payment Method Selector */}
              <div className="space-y-2.5 pt-2">
                <span className="block text-xs font-medium uppercase tracking-wider text-[#635647]">
                  {bn ? 'পেমেন্ট মাধ্যম' : 'Payment Method'}
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(['cod', 'bkash', 'nagad'] as PaymentMethod[]).map((method) => {
                    const active = paymentMethod === method;
                    return (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        className={`min-h-[44px] rounded-lg border px-1.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'border-[#B47B2B] bg-[#F2ECE1] text-[#1E1710]'
                            : 'border-[rgba(30,23,16,0.16)] bg-[#FFFDF9] text-[#635647]'
                        }`}
                      >
                        {method === 'cod' && (bn ? 'ক্যাশ (COD)' : 'Cash (COD)')}
                        {method === 'bkash' && (bn ? 'বিকাশ' : 'bKash')}
                        {method === 'nagad' && (bn ? 'নগদ' : 'Nagad')}
                      </button>
                    );
                  })}
                </div>

                {(paymentMethod === 'bkash' || paymentMethod === 'nagad') && (
                  <div className="space-y-3 rounded-xl border border-[#B47B2B]/30 bg-[#F2ECE1] p-4 text-xs">
                    <p className="font-medium text-[#1E1710]">
                      {paymentMethod === 'bkash' ? 'bKash' : 'Nagad'}{' '}
                      {bn ? 'পেমেন্ট নির্দেশনা:' : 'Payment Instructions:'}
                    </p>
                    <p className="leading-relaxed text-[#635647]">
                      {bn
                        ? `নিচের নম্বরে "Send Money" বা "Payment" করে মোট ${formatBdt(grandTotal)} পাঠান এবং নিচে Transaction ID দিন। অ্যাডমিন যাচাইয়ের পর অর্ডারটি কনফার্ম করা হবে।`
                        : `Send ${formatBdt(grandTotal)} to our ${paymentMethod === 'bkash' ? 'bKash' : 'Nagad'} number below, then submit your Transaction ID. Payment remains pending verification until confirmed by admin.`}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#FFFDF9] px-3 py-2">
                      <span className="text-[#635647]">
                        {paymentMethod === 'bkash' ? 'bKash' : 'Nagad'} Number
                      </span>
                      <span className="font-mono text-sm font-semibold text-[#1E1710]">
                        {paymentMethod === 'bkash'
                          ? settings.bkashNumber
                          : settings.nagadNumber}
                      </span>
                    </div>

                    <div>
                      <label htmlFor="co-txnid" className="block font-medium text-[#1E1710]">
                        {bn ? 'ট্রানজেকশন আইডি (TxnID) *' : 'Transaction ID (TxnID) *'}
                      </label>
                      <input
                        id="co-txnid"
                        type="text"
                        required
                        value={txnId}
                        onChange={(e) => setTxnId(e.target.value)}
                        placeholder="e.g. 9K4M7X2P10"
                        className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-2 font-mono text-base text-[#1E1710] focus:border-[#B47B2B] focus:outline-none sm:text-xs"
                      />
                    </div>

                    <div>
                      <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[rgba(30,23,16,0.28)] bg-[#FFFDF9] px-3 py-2 text-[#635647] hover:text-[#1E1710]">
                        <Upload className="h-3.5 w-3.5 text-[#8A5A17]" />
                        <span>
                          {paymentProofData
                            ? bn
                              ? 'স্ক্রিনশট সংযুক্ত হয়েছে'
                              : 'Screenshot attached'
                            : bn
                              ? 'পেমেন্ট স্ক্রিনশট যুক্ত করুন (ঐচ্ছিক)'
                              : 'Attach payment screenshot (Optional)'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleScreenshotUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </form>
          )}
        </div>

        {/* Footer Totals */}
        {cart.length > 0 && step !== 'confirmed' && (
          <div className="border-t border-[rgba(30,23,16,0.12)] bg-[#F2ECE1]/85 px-4 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
            <div className="space-y-1 text-xs sm:text-sm">
              <div className="flex justify-between text-[#635647]">
                <span>{bn ? 'সাবটোটাল' : 'Subtotal'}</span>
                <span className="font-mono tabular-nums">{formatBdt(subtotal)}</span>
              </div>
              <div className="flex justify-between text-[#635647]">
                <span>
                  {bn ? 'ডেলিভারি' : 'Delivery'} ({district})
                </span>
                <span className="font-mono tabular-nums">
                  {deliveryFee === 0 ? (bn ? 'ফ্রি' : 'Free') : formatBdt(deliveryFee)}
                </span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between text-[#8A5A17]">
                  <span>{bn ? 'ছাড়' : 'Discount'}</span>
                  <span className="font-mono tabular-nums">
                    -{formatBdt(totalDiscount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-1.5 text-base font-semibold text-[#1E1710]">
                <span>{bn ? 'সর্বমোট' : 'Final Payable'}</span>
                <span className="font-mono tabular-nums text-[#8A5A17]">
                  {formatBdt(grandTotal)}
                </span>
              </div>
            </div>

            {step === 'bag' ? (
              <button
                type="button"
                onClick={handleProceedCheckout}
                className="mt-3.5 min-h-[50px] w-full rounded-xl bg-gradient-to-r from-[#B47B2B] via-[#C98A2C] to-[#96621B] px-5 py-3 text-sm font-bold text-[#FFFDF9] shadow-[0_8px_20px_-4px_rgba(180,123,43,0.35)] hover:scale-[1.01] transition-all"
              >
                {bn ? 'চেকআউটে এগিয়ে যান' : 'Proceed to Checkout'} · {formatBdt(grandTotal)}
              </button>
            ) : (
              <button
                type="submit"
                form="deshi-checkout-form"
                disabled={submitting}
                className="mt-3.5 inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#B47B2B] via-[#C98A2C] to-[#96621B] px-5 py-3 text-sm font-bold text-[#FFFDF9] shadow-[0_8px_20px_-4px_rgba(180,123,43,0.35)] hover:scale-[1.01] disabled:opacity-60 transition-all"
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
