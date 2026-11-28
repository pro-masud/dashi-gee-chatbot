'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  Clock,
  CreditCard,
  Edit3,
  ExternalLink,
  Headset,
  ImagePlus,
  Loader2,
  PackageSearch,
  RotateCw,
  Search,
  Star,
  Truck,
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
import {
  evaluateOrderDelayStatus,
  formatPaymentClarification,
} from '../lib/chatbot/supportEngine';
import type { RefillReminderDoc, SupportCategory } from '../lib/chatbot/types';
import { useStorefront } from './StorefrontProvider';

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
  const { settings } = useStorefront();
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

  // Phase 3: Post-purchase support ticket + private evidence state
  const [showSupportPanel, setShowSupportPanel] = useState(false);
  const [ticketCategory, setTicketCategory] = useState<SupportCategory>('damaged_jar');
  const [ticketName, setTicketName] = useState('');
  const [ticketSummary, setTicketSummary] = useState('');
  const [ticketConsent, setTicketConsent] = useState(false);
  const [uploadedEvidence, setUploadedEvidence] = useState<
    { evidenceId: string; filename: string }[]
  >([]);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ticketFeedback, setTicketFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Phase 3: After-delivery retention state (reorder, verified review, refill reminder)
  const [reorderBusy, setReorderBusy] = useState(false);
  const [reorderErr, setReorderErr] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewName, setReviewName] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const [reminderInterval, setReminderInterval] = useState<30 | 45 | 60 | 90>(45);
  const [reminderConsent, setReminderConsent] = useState(false);
  const [savedReminder, setSavedReminder] = useState<RefillReminderDoc | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderFeedback, setReminderFeedback] = useState('');
  const [paymentBanner, setPaymentBanner] = useState<{
    status: 'verified' | 'failed' | 'cancelled';
    ref: string;
  } | null>(null);
  const [onlineGateways, setOnlineGateways] = useState<{
    sslcommerz: boolean;
    bkash: boolean;
  }>({ sslcommerz: false, bkash: false });
  const [gatewayBusy, setGatewayBusy] = useState<'sslcommerz' | 'bkash' | null>(null);
  const [gatewayError, setGatewayError] = useState('');

  const bn = lang === 'bn';

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const paymentParam = (sp.get('payment') || '').toLowerCase();
      if (
        paymentParam === 'verified' ||
        paymentParam === 'failed' ||
        paymentParam === 'cancelled'
      ) {
        setPaymentBanner({
          status: paymentParam,
          ref: sp.get('ref') || '',
        });
      }
      const tokenParam = (sp.get('token') || '').trim();
      if (tokenParam.length >= 24) {
        setLoading(true);
        setSearched(true);
        trackOrderLookup('', '', tokenParam)
          .then((found) => {
            if (found) {
              setResult(found);
              setOrderInput(found.orderNumber);
              setErrorMsg('');
            } else {
              setErrorMsg(
                bn
                  ? 'এই ট্র্যাকিং লিংকটি সঠিক নয় অথবা মেয়াদ শেষ হয়েছে। অনুগ্রহ করে অর্ডার নম্বর ও ফোন দিয়ে খুঁজুন।'
                  : 'This tracking link is invalid or expired. Please try searching with your Order ID and mobile number.'
              );
            }
          })
          .catch(() => {})
          .finally(() => setLoading(false));
      }
    }
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
    return () => {
      active = false;
    };
  }, [bn]);

  const handlePayOrderOnline = async (gateway: 'sslcommerz' | 'bkash') => {
    if (!result || !verifiedPhone || gatewayBusy) return;
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
          orderNumber: result.orderNumber,
          phone: verifiedPhone,
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

  const shrinkImageForUpload = async (file: File): Promise<string> => {
    const rawUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('Read error'));
      r.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image error'));
      i.src = rawUrl;
    });
    const maxDim = 1100;
    const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.width || 800) * scale));
    canvas.height = Math.max(1, Math.round((img.height || 800) * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return rawUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let out = canvas.toDataURL('image/jpeg', 0.8);
    if (out.length > 680_000) out = canvas.toDataURL('image/jpeg', 0.6);
    return out;
  };

  const runLookup = async (ord: string, ph: string) => {
    const cleanOrd = ord.trim().toUpperCase();
    const cleanPhone = ph.replace(/[\s-]/g, '');
    if (!/^DG-[0-9]{4,8}$/.test(cleanOrd)) {
      setErrorMsg(
        bn
          ? 'সঠিক অর্ডার নম্বর দিন (যেমন DG-XXXXX)।'
          : 'Enter a valid Order ID (e.g. DG-XXXXX).'
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
    setTicketFeedback(null);
    setShowEditForm(false);
    setShowCancelConfirm(false);
    setShowSupportPanel(false);
    setSavedReminder(null);
    setReviewStatus(null);
    setReorderErr('');
    setSearched(true);
    try {
      const record = await trackOrderLookup(cleanOrd, cleanPhone);
      setResult(record);
      if (record) {
        setVerifiedPhone(cleanPhone);
        if (record.district) setEditDistrict(record.district);
        if (record.status === 'delivered') {
          fetch(
            `/api/orders/refill-reminder?orderNumber=${encodeURIComponent(cleanOrd)}&phone=${encodeURIComponent(cleanPhone)}&uiLang=${lang}`
          )
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { ok?: boolean; reminder?: RefillReminderDoc | null } | null) => {
              if (d?.ok && d.reminder) {
                setSavedReminder(d.reminder);
                setReminderInterval(d.reminder.intervalDays);
                setReminderConsent(Boolean(d.reminder.consentGranted));
              }
            })
            .catch(() => {});
        }
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

  const paymentClarification = result
    ? formatPaymentClarification(
        result.paymentMethod,
        result.paymentStatus,
        settings,
        bn ? 'bn' : 'en'
      )
    : null;

  const delayDiagnostic = result
    ? evaluateOrderDelayStatus({
        status: result.status,
        estimatedDelivery: result.estimatedDelivery,
        deliveryZone: result.deliveryZone,
        updatedAt: result.updatedAt,
      })
    : null;

  const handleUploadEvidence = async (file?: File | null) => {
    if (!file || !result || evidenceBusy) return;
    setEvidenceBusy(true);
    setTicketFeedback(null);
    try {
      const dataUrl = await shrinkImageForUpload(file);
      const res = await fetch('/api/support/evidence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          dataUrl,
          filename: file.name || 'evidence.jpg',
          orderNumber: result.orderNumber,
          sessionId: `track_${result.orderNumber}`,
          purpose:
            ticketCategory === 'payment_dispute'
              ? 'payment_dispute'
              : ticketCategory === 'damaged_jar'
                ? 'damage_claim'
                : 'general',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.evidenceId) {
        throw new Error(data.error || 'Could not upload evidence image.');
      }
      setUploadedEvidence((prev) => [
        ...prev.slice(-4),
        { evidenceId: String(data.evidenceId), filename: String(data.filename || file.name) },
      ]);
    } catch (err) {
      setTicketFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to upload image.',
      });
    } finally {
      setEvidenceBusy(false);
    }
  };

  const handleSubmitSupportTicket = async (e: FormEvent) => {
    e.preventDefault();
    if (!result || ticketBusy) return;
    if (!ticketConsent) {
      setTicketFeedback({
        type: 'err',
        text: bn
          ? 'টিকিট পাঠাতে অনুগ্রহ করে সম্মতি চেকবক্সে টিক দিন।'
          : 'Please check consent before submitting a support ticket.',
      });
      return;
    }
    setTicketBusy(true);
    setTicketFeedback(null);
    try {
      const res = await fetch('/api/support/ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          sessionId: `track_${result.orderNumber}`,
          customerName: ticketName.trim(),
          phone: verifiedPhone,
          orderNumber: result.orderNumber,
          category: ticketCategory,
          issueSummary: ticketSummary.trim(),
          evidenceIds: uploadedEvidence.map((u) => u.evidenceId),
          consentGranted: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to create support ticket.');
      }
      const slaText = bn ? data.sla?.expectationBn : data.sla?.expectationEn;
      setTicketFeedback({
        type: 'ok',
        text: bn
          ? `টিকিট ${data.ticketNumber} জমা হয়েছে। ${slaText || ''}`
          : `Ticket ${data.ticketNumber} created. ${slaText || ''}`,
      });
      setTicketSummary('');
      setUploadedEvidence([]);
    } catch (err) {
      setTicketFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Support ticket submission failed.',
      });
    } finally {
      setTicketBusy(false);
    }
  };

  const handleOneClickReorder = async () => {
    if (!result || reorderBusy) return;
    setReorderBusy(true);
    setReorderErr('');
    try {
      const res = await fetch('/api/orders/reorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          orderNumber: result.orderNumber,
          phone: verifiedPhone,
          uiLang: lang,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.reorderUrl) {
        throw new Error(
          (bn ? data.messageBn : data.messageEn) ||
            data.error ||
            'Reorder unavailable right now.'
        );
      }
      window.location.href = String(data.reorderUrl);
    } catch (err) {
      setReorderErr(err instanceof Error ? err.message : 'Could not prepare reorder.');
      setReorderBusy(false);
    }
  };

  const handleSubmitVerifiedReview = async (e: FormEvent) => {
    e.preventDefault();
    if (!result || reviewBusy) return;
    setReviewBusy(true);
    setReviewStatus(null);
    try {
      const res = await fetch('/api/orders/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          orderNumber: result.orderNumber,
          phone: verifiedPhone,
          customerName: reviewName.trim(),
          district: result.district || 'Dhaka',
          rating: reviewRating,
          comment: reviewComment.trim(),
          uiLang: lang,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(
          (bn ? data.messageBn : data.messageEn) ||
            data.error ||
            'Could not save verified review.'
        );
      }
      setReviewStatus({
        type: 'ok',
        text: bn ? data.messageBn : data.messageEn,
      });
      setReviewComment('');
    } catch (err) {
      setReviewStatus({
        type: 'err',
        text: err instanceof Error ? err.message : 'Review failed.',
      });
    } finally {
      setReviewBusy(false);
    }
  };

  const handleSaveRefillReminder = async (
    nextStatus: 'active' | 'paused' | 'opted_out' = 'active'
  ) => {
    if (!result || reminderBusy) return;
    setReminderBusy(true);
    setReminderFeedback('');
    try {
      const res = await fetch('/api/orders/refill-reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          orderNumber: result.orderNumber,
          phone: verifiedPhone,
          intervalDays: reminderInterval,
          status: nextStatus,
          consentGranted: reminderConsent || nextStatus !== 'active',
          uiLang: lang,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(
          (bn ? data.messageBn : data.messageEn) || data.error || 'Could not update reminder.'
        );
      }
      setSavedReminder(data.reminder || null);
      setReminderFeedback(bn ? data.messageBn : data.messageEn);
    } catch (err) {
      setReminderFeedback(err instanceof Error ? err.message : 'Failed updating reminder.');
    } finally {
      setReminderBusy(false);
    }
  };

  return (
    <section className="mx-auto min-h-[75vh] max-w-3xl px-4 py-10 sm:px-8 sm:py-14">
      <button
        type="button"
        onClick={onBackHome}
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-[var(--c-muted)] hover:text-[var(--c-ink)]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>{bn ? 'স্টোরফ্রন্টে ফিরে যান' : 'Back to Deshi Gee'}</span>
      </button>

      <div className="mt-5 sm:mt-6">
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--c-gold-text)]">
          {bn ? 'লাইভ অর্ডার স্ট্যাটাস' : 'Order Tracking'}
        </p>
        <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight text-[var(--c-ink)] sm:text-4xl">
          {bn ? 'আপনার দেশী ঘি অর্ডার ট্র্যাক করুন' : 'Track Your Deshi Gee Order'}
        </h1>
        <p className="mt-2 text-sm text-[var(--c-muted)]">
          {bn
            ? 'অর্ডার নিশ্চিতকরণের সময় পাওয়া অর্ডার আইডি এবং আপনার মোবাইল নম্বর দিন।'
            : 'Enter your Order ID and verified checkout phone number to inspect live dispatch status.'}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-7 grid grid-cols-1 gap-4 rounded-3xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-band)]/80 p-5 sm:mt-8 sm:grid-cols-12 sm:p-7 shadow-xs"
      >
        <div className="sm:col-span-5">
          <label htmlFor="trk-id" className="block text-xs font-semibold text-[var(--c-muted)]">
            {bn ? 'অর্ডার আইডি' : 'Order ID'}
          </label>
          <input
            id="trk-id"
            type="text"
            value={orderInput}
            onChange={(e) => setOrderInput(e.target.value.toUpperCase())}
            placeholder="DG-XXXXX"
            className="mt-1.5 w-full rounded-xl border border-[rgb(var(--c-tint)/0.16)] bg-[var(--c-card)] px-4 py-2.5 font-mono text-base uppercase text-[var(--c-ink)] shadow-xs focus:border-[#B47B2B] focus:outline-none sm:text-sm"
          />
        </div>

        <div className="sm:col-span-4">
          <label htmlFor="trk-phone" className="block text-xs font-semibold text-[var(--c-muted)]">
            {bn ? 'মোবাইল নম্বর' : 'Mobile Number'}
          </label>
          <input
            id="trk-phone"
            type="tel"
            inputMode="tel"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder="017XXXXXXXX"
            className="mt-1.5 w-full rounded-xl border border-[rgb(var(--c-tint)/0.16)] bg-[var(--c-card)] px-4 py-2.5 font-mono text-base text-[var(--c-ink)] shadow-xs focus:border-[#B47B2B] focus:outline-none sm:text-sm"
          />
        </div>

        <div className="flex items-end sm:col-span-3">
          <button
            type="submit"
            disabled={loading}
            className="btn-primary min-h-[46px] w-full"
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
        <div className="mt-8 flex flex-col items-center rounded-2xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-card)] p-10 text-center">
          <PackageSearch className="h-10 w-10 text-[var(--c-gold-text)]" />
          <h2 className="font-display mt-3 text-xl font-semibold text-[var(--c-ink)]">
            {bn ? 'কোনো অর্ডার খুঁজে পাওয়া যায়নি' : 'No Matching Order Found'}
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-[var(--c-muted)]">
            {bn
              ? 'দয়া করে আপনার অর্ডার আইডি এবং অর্ডারের সময় ব্যবহৃত মোবাইল নম্বর মিলিয়ে আবার চেষ্টা করুন।'
              : 'Double-check your Order ID and the exact 11-digit mobile number entered at checkout.'}
          </p>
        </div>
      )}

      {paymentBanner && (
        <div
          className={`mt-6 flex items-start gap-2.5 rounded-xl border p-4 text-sm ${
            paymentBanner.status === 'verified'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
              : 'border-amber-300 bg-amber-50 text-amber-950'
          }`}
        >
          {paymentBanner.status === 'verified' ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
          ) : (
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          )}
          <div>
            <p className="font-semibold">
              {paymentBanner.status === 'verified'
                ? bn
                  ? 'অনলাইন পেমেন্ট যাচাই সফল হয়েছে'
                  : 'Online Payment Verified'
                : paymentBanner.status === 'cancelled'
                  ? bn
                    ? 'অনলাইন পেমেন্ট বাতিল করা হয়েছে'
                    : 'Online Payment Cancelled'
                  : bn
                    ? 'অনলাইন পেমেন্ট সম্পন্ন হয়নি'
                    : 'Online Payment Could Not Be Verified'}
            </p>
            {paymentBanner.ref && (
              <p className="mt-0.5 font-mono text-xs opacity-80">
                Ref: {paymentBanner.ref}
              </p>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="mt-8 space-y-6 rounded-2xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-card)] p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[rgb(var(--c-tint)/0.10)] pb-5">
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-[var(--c-gold-text)] tabular-nums">
                {result.orderNumber}
                {result.district ? ` · ${result.district}` : ''}
              </p>
              <h2 className="font-display mt-1 text-2xl font-semibold text-[var(--c-ink)]">
                {result.itemsSummary || `${result.weight} × ${result.qty}`} ·{' '}
                <span className="font-mono tabular-nums">
                  {formatBdt(result.totalBdt)}
                </span>
              </h2>
            </div>

            <div className="text-left text-xs sm:text-right">
              <p className="text-[var(--c-muted)]">
                {bn ? 'পেমেন্ট অবস্থা' : 'Payment Status'}
              </p>
              <p className="mt-0.5 font-medium text-[var(--c-ink)]">
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

          {result.status !== 'cancelled' &&
            result.paymentStatus !== 'verified' &&
            (onlineGateways.sslcommerz || onlineGateways.bkash) && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(180,123,43,0.3)] bg-[var(--c-bg)] px-4 py-3 text-xs">
                <span className="font-medium text-[var(--c-ink)]">
                  {bn
                    ? 'এখনই অনলাইনে নিরাপদ পেমেন্ট সম্পন্ন করুন:'
                    : 'Complete payment online securely:'}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {onlineGateways.sslcommerz && (
                    <button
                      type="button"
                      disabled={Boolean(gatewayBusy)}
                      onClick={() => handlePayOrderOnline('sslcommerz')}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#B47B2B] px-3.5 py-2 font-semibold text-[var(--c-on-gold)] hover:bg-[#9D6820] disabled:opacity-55"
                    >
                      {gatewayBusy === 'sslcommerz' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CreditCard className="h-3.5 w-3.5" />
                      )}
                      <span>{bn ? 'SSLCommerz পেমেন্ট' : 'Pay via SSLCommerz'}</span>
                    </button>
                  )}
                  {onlineGateways.bkash && (
                    <button
                      type="button"
                      disabled={Boolean(gatewayBusy)}
                      onClick={() => handlePayOrderOnline('bkash')}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#B47B2B] bg-[var(--c-card)] px-3.5 py-2 font-semibold text-[var(--c-gold-text)] hover:bg-[var(--c-surface)] disabled:opacity-55"
                    >
                      {gatewayBusy === 'bkash' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CreditCard className="h-3.5 w-3.5" />
                      )}
                      <span>{bn ? 'bKash গেটওয়ে' : 'Pay via bKash'}</span>
                    </button>
                  )}
                </div>
                {gatewayError && (
                  <p className="w-full text-[11px] font-medium text-red-700">{gatewayError}</p>
                )}
              </div>
            )}

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
                        ? 'border-[#B47B2B] bg-[var(--c-surface)]'
                        : 'border-[rgb(var(--c-tint)/0.10)] bg-[var(--c-bg)]/60 opacity-65'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2
                        className={`h-4 w-4 shrink-0 ${
                          completed ? 'text-[var(--c-gold-text)]' : 'text-[var(--c-muted)]/40'
                        }`}
                      />
                      <span className="font-mono text-[11px] tabular-nums text-[var(--c-muted)]">
                        0{idx + 1}
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-[var(--c-ink)]">
                      {bn ? step.bn : step.en}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-[var(--c-muted)]">
            {bn ? 'সম্ভাব্য ডেলিভারি সময়:' : 'Estimated Delivery Window:'}{' '}
            <span className="font-medium text-[var(--c-ink)]">
              {result.estimatedDelivery}
            </span>
          </p>

          {(result.courierPartner || result.consignmentId || result.courierTrackingUrl) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-bg)] px-4 py-3 text-xs">
              <div className="space-y-0.5">
                <p className="font-medium text-[var(--c-ink)]">
                  <Truck className="mr-1.5 inline h-3.5 w-3.5 text-[var(--c-gold-text)]" />
                  {bn ? 'কুরিয়ার কনসাইনমেন্ট:' : 'Courier Dispatch:'}{' '}
                  <span className="font-mono uppercase">
                    {result.courierPartner || 'courier'}
                  </span>
                  {result.consignmentId ? (
                    <span className="font-mono text-[var(--c-gold-text)]"> · {result.consignmentId}</span>
                  ) : null}
                </p>
                {result.dispatchedAtIso && (
                  <p className="font-mono text-[11px] tabular-nums text-[var(--c-muted)]">
                    {bn ? 'পাঠানোর সময়:' : 'Dispatched:'}{' '}
                    {new Date(result.dispatchedAtIso).toLocaleString()}
                  </p>
                )}
              </div>
              {result.courierTrackingUrl &&
                /^https:\/\/[^\s]+$/i.test(result.courierTrackingUrl) && (
                  <a
                    href={result.courierTrackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-[var(--c-accent)] px-3.5 py-2 text-xs font-medium text-[var(--c-on-accent)] hover:bg-[var(--c-accent-hover)]"
                  >
                    <span>{bn ? 'কুরিয়ার ট্র্যাক করুন' : 'Track on Courier'}</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
            </div>
          )}

          {manageFeedback && (
            <div
              role="status"
              className={`rounded-xl border px-4 py-3 text-xs font-medium ${
                manageFeedback.type === 'ok'
                  ? 'border-[#B47B2B]/40 bg-[var(--c-surface)] text-[#1E1710]'
                  : 'border-red-300 bg-red-50 text-red-800'
              }`}
            >
              {manageFeedback.text}
            </div>
          )}

          {/* Pre-Dispatch Self-Serve Management */}
          {canSelfServeModify ? (
            <div className="space-y-4 border-t border-[rgb(var(--c-tint)/0.10)] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-[var(--c-muted)]">
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
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[rgb(var(--c-tint)/0.2)] bg-[var(--c-bg)] px-3.5 py-2 text-xs font-medium text-[var(--c-ink)] hover:bg-[var(--c-surface)]"
                  >
                    <Edit3 className="h-3.5 w-3.5 text-[var(--c-gold-text)]" />
                    <span>{bn ? 'ঠিকানা পরিবর্তন' : 'Edit Delivery Address'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCancelConfirm((v) => !v);
                      setShowEditForm(false);
                    }}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-800 hover:bg-red-100"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>{bn ? 'অর্ডার বাতিল' : 'Cancel Order'}</span>
                  </button>
                </div>
              </div>

              {showEditForm && (
                <form
                  onSubmit={handleSaveAddressChange}
                  className="space-y-3 rounded-xl border border-[rgb(var(--c-tint)/0.14)] bg-[var(--c-bg)] p-4"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-[var(--c-muted)]">
                        {bn ? 'নতুন জেলা *' : 'New District *'}
                      </label>
                      <select
                        value={editDistrict}
                        onChange={(e) => setEditDistrict(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3 py-2 text-base text-[var(--c-ink)] sm:text-sm"
                      >
                        {BANGLADESH_DISTRICTS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--c-muted)]">
                        {bn ? 'এলাকা / থানা *' : 'Area / Thana *'}
                      </label>
                      <input
                        type="text"
                        required
                        value={editArea}
                        onChange={(e) => setEditArea(e.target.value)}
                        placeholder={bn ? 'যেমন: সাভার / উত্তরা' : 'e.g. Savar / Uttara'}
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3 py-2 text-base text-[var(--c-ink)] sm:text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--c-muted)]">
                      {bn ? 'সম্পূর্ণ সড়ক ও বাড়ির ঠিকানা *' : 'Complete Street Address *'}
                    </label>
                    <input
                      type="text"
                      required
                      value={editAddress}
                      onChange={(e) => setEditAddress(e.target.value)}
                      placeholder={bn ? 'বাড়ি ১২, রোড ৪, সেক্টর ১০' : 'House 12, Road 4, Sector 10'}
                      className="mt-1 w-full rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3 py-2 text-base text-[var(--c-ink)] sm:text-sm"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={manageLoading}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#B47B2B] px-4 py-2 text-xs font-semibold text-[var(--c-on-gold)] disabled:opacity-60"
                    >
                      {manageLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>
                        {bn ? 'নতুন ঠিকানা সংরক্ষণ ও চার্জ হিসাব করুন' : 'Save Address & Recalculate Fee'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowEditForm(false)}
                      className="min-h-[44px] rounded-lg border border-[rgb(var(--c-tint)/0.18)] px-4 py-2 text-xs font-medium text-[var(--c-muted)]"
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
                    className="w-full rounded-lg border border-red-200 bg-[var(--c-card)] px-3 py-2 text-base text-[var(--c-ink)] sm:text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={manageLoading}
                      onClick={handleConfirmCancelOrder}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {manageLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>{bn ? 'হ্যাঁ, অর্ডার বাতিল করুন' : 'Yes, Cancel Order'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCancelConfirm(false)}
                      className="min-h-[44px] rounded-lg border border-[rgb(var(--c-tint)/0.2)] bg-[var(--c-card)] px-4 py-2 text-xs font-medium text-[var(--c-ink)]"
                    >
                      {bn ? 'ফিরে যান' : 'Keep Order'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : result.status !== 'cancelled' ? (
            <div className="border-t border-[rgb(var(--c-tint)/0.10)] pt-4 text-xs text-[var(--c-muted)]">
              {bn
                ? 'এই অর্ডারটি ইতিমধ্যে প্যাকেজিং বা কুরিয়ার পর্যায়ে চলে যাওয়ায় অনলাইনে পরিবর্তন বন্ধ রয়েছে। জরুরি প্রয়োজনে নিচের সাপোর্ট অপশন ব্যবহার করুন।'
                : 'This order is already being processed/shipped, so online edits or cancellation are locked. Use the support option below if urgent.'}
            </div>
          ) : null}

          {/* Payment Verification Clarification Banner (Non-COD) */}
          {paymentClarification && result.paymentMethod !== 'cod' && (
            <div
              className={`rounded-xl border p-4 text-xs ${
                result.paymentStatus === 'verified'
                  ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
                  : 'border-amber-200 bg-amber-50/80 text-amber-950'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{paymentClarification.headline}</p>
                {paymentClarification.canEscalateDispute && (
                  <button
                    type="button"
                    onClick={() => {
                      setTicketCategory('payment_dispute');
                      setShowSupportPanel(true);
                    }}
                    className="min-h-[44px] rounded-lg border border-amber-400 bg-[var(--c-card)] px-3.5 py-2 text-xs font-semibold text-[var(--c-ink)] hover:bg-[var(--c-surface)]"
                  >
                    {bn ? 'পেমেন্ট ডিসপিউট টিকিট দিন' : 'Dispute Payment Verification'}
                  </button>
                )}
              </div>
              <p className="mt-1 leading-relaxed">{paymentClarification.detail}</p>
            </div>
          )}

          {/* Delivery Delay Diagnostic */}
          {delayDiagnostic && result.status !== 'delivered' && result.status !== 'cancelled' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-bg)] p-4 text-xs">
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--c-gold-text)]" />
                <p className="text-[var(--c-muted)]">
                  {bn ? delayDiagnostic.statusNoteBn : delayDiagnostic.statusNoteEn}
                </p>
              </div>
              {delayDiagnostic.recommendEscalation && (
                <button
                  type="button"
                  onClick={() => {
                    setTicketCategory('late_delivery');
                    setShowSupportPanel(true);
                  }}
                  className="min-h-[44px] shrink-0 rounded-lg border border-[rgba(180,123,43,0.45)] bg-[var(--c-card)] px-3.5 py-2 text-xs font-semibold text-[var(--c-ink)] hover:bg-[var(--c-surface)]"
                >
                  {bn ? 'জরুরি ডেলিভারি ফলো-আপ' : 'Report Delay (Urgent)'}
                </button>
              )}
            </div>
          )}

          {/* Report Issue / Upload Private Evidence / Open Support Ticket */}
          <div className="border-t border-[rgb(var(--c-tint)/0.10)] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--c-ink)]">
                  <Headset className="h-4 w-4 text-[var(--c-gold-text)]" />
                  <span>
                    {bn
                      ? 'ক্ষতিগ্রস্ত জার, পেমেন্ট বা ডেলিভারি সহায়তা'
                      : 'Need Help? Report Issue or Upload Photo'}
                  </span>
                </h3>
                <p className="mt-0.5 text-xs text-[var(--c-muted)]">
                  {bn
                    ? 'ডেলিভারির ২৪ ঘণ্টার মধ্যে ভাঙা জারের ছবি বা পেমেন্ট স্ক্রিনশট দিয়ে সরাসরি টিকিট খুলুন।'
                    : 'Upload a delivery-day jar photo (within 24h) or payment screenshot to open an escalated ticket.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSupportPanel((v) => !v)}
                className="min-h-[44px] rounded-lg border border-[rgb(var(--c-tint)/0.2)] bg-[var(--c-bg)] px-4 py-2 text-xs font-medium text-[var(--c-ink)] hover:bg-[var(--c-surface)]"
              >
                {showSupportPanel
                  ? bn
                    ? 'বন্ধ করুন'
                    : 'Close Form'
                  : bn
                    ? 'সাপোর্ট টিকিট খুলুন'
                    : 'Open Support Ticket'}
              </button>
            </div>

            {ticketFeedback && (
              <div
                className={`mt-3 rounded-xl border px-4 py-3 text-xs font-medium ${
                  ticketFeedback.type === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                    : 'border-red-300 bg-red-50 text-red-900'
                }`}
              >
                {ticketFeedback.text}
              </div>
            )}

            {showSupportPanel && (
              <form
                onSubmit={handleSubmitSupportTicket}
                className="mt-4 space-y-3 rounded-xl border border-[rgb(var(--c-tint)/0.14)] bg-[var(--c-bg)] p-4 text-xs"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[var(--c-muted)]">
                      {bn ? 'সমস্যার ধরন *' : 'Issue Category *'}
                    </label>
                    <select
                      value={ticketCategory}
                      onChange={(e) => setTicketCategory(e.target.value as SupportCategory)}
                      className="mt-1 w-full rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3 py-2 text-base sm:text-xs"
                    >
                      <option value="damaged_jar">
                        {bn ? 'ভাঙা বা লিক হওয়া জার (Urgent)' : 'Damaged / Leaking Jar (Urgent)'}
                      </option>
                      <option value="payment_dispute">
                        {bn ? 'bKash/Nagad পেমেন্ট সমস্যা (Urgent)' : 'Payment Verification Issue (Urgent)'}
                      </option>
                      <option value="late_delivery">
                        {bn ? 'ডেলিভারিতে দেরি (Urgent)' : 'Late Delivery Follow-up (Urgent)'}
                      </option>
                      <option value="refund_return">
                        {bn ? 'রিটার্ন বা রিফান্ড অনুরোধ' : 'Return / Refund Inquiry'}
                      </option>
                      <option value="general">
                        {bn ? 'অন্যান্য সহায়তা' : 'General Order Help'}
                      </option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[var(--c-muted)]">
                      {bn ? 'আপনার নাম *' : 'Your Name *'}
                    </label>
                    <input
                      type="text"
                      required
                      value={ticketName}
                      onChange={(e) => setTicketName(e.target.value)}
                      placeholder={bn ? 'যেমন: রাকিব হাসান' : 'Full Name'}
                      className="mt-1 w-full rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3 py-2 text-base sm:text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[var(--c-muted)]">
                    {bn ? 'সমস্যার বিবরণ *' : 'Describe the Issue *'}
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={ticketSummary}
                    onChange={(e) => setTicketSummary(e.target.value)}
                    placeholder={
                      bn
                        ? 'দয়া করে আপনার সমস্যাটি সংক্ষেপে লিখুন...'
                        : 'Briefly explain the jar condition, payment TxnID, or delivery concern...'
                    }
                    className="mt-1 w-full rounded-lg border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-3 py-2 text-base sm:text-xs"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-[rgba(180,123,43,0.4)] bg-[var(--c-card)] px-3.5 py-2 text-xs font-medium text-[var(--c-ink)] hover:bg-[var(--c-surface)]">
                    {evidenceBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#B47B2B]" />
                    ) : (
                      <ImagePlus className="h-3.5 w-3.5 text-[var(--c-gold-text)]" />
                    )}
                    <span>
                      {evidenceBusy
                        ? bn
                          ? 'আপলোড হচ্ছে...'
                          : 'Uploading...'
                        : bn
                          ? 'ছবি সংযুক্ত করুন (JPEG/PNG)'
                          : 'Upload Photo Evidence'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        handleUploadEvidence(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {uploadedEvidence.map((ev) => (
                    <span
                      key={ev.evidenceId}
                      className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 font-mono text-[11px] text-emerald-900"
                    >
                      {ev.filename}
                    </span>
                  ))}
                </div>

                <label className="flex items-start gap-2 text-[11px] text-[var(--c-muted)]">
                  <input
                    type="checkbox"
                    checked={ticketConsent}
                    onChange={(e) => setTicketConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[#B47B2B]"
                  />
                  <span>
                    {bn
                      ? 'আমি এই অর্ডার নম্বর, ফোন ও সংযুক্ত ছবি সাপোর্ট পর্যালোচনার জন্য Deshi Gee টিমের সাথে শেয়ার করতে সম্মতি দিচ্ছি।'
                      : 'I consent to share my order details, phone, and uploaded photo with the Deshi Gee human support team for ticket review.'}
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={ticketBusy}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#B47B2B] px-4 py-2 text-xs font-semibold text-[var(--c-on-gold)] hover:bg-[#9D6820] disabled:opacity-60"
                >
                  {ticketBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{bn ? 'সাপোর্ট টিকিট জমা দিন' : 'Submit Support Ticket'}</span>
                </button>
              </form>
            )}
          </div>

          {/* T3.3 After-Delivery Retention Features (Delivered Orders Only) */}
          {result.status === 'delivered' && (
            <div className="space-y-5 border-t border-[rgb(var(--c-tint)/0.10)] pt-5">
              {/* 1. One-Click Reorder */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(180,123,43,0.35)] bg-[var(--c-surface)]/70 p-4">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--c-ink)]">
                    <RotateCw className="h-4 w-4 text-[var(--c-gold-text)]" />
                    <span>{bn ? 'আগের মতোই আবার অর্ডার করুন' : 'Enjoyed Deshi Gee? Order Again'}</span>
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--c-muted)]">
                    {bn
                      ? 'বর্তমান লাইভ স্টক ও মূল্য যাচাই করে এক ক্লিকেই কার্ট সাজিয়ে নিন।'
                      : 'Pre-fill your cart in one click using live jar stock and current BDT pricing.'}
                  </p>
                  {reorderErr && <p className="mt-1 text-xs text-red-700">{reorderErr}</p>}
                </div>
                <button
                  type="button"
                  disabled={reorderBusy}
                  onClick={handleOneClickReorder}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--c-accent)] px-4 py-2 text-xs font-semibold text-[var(--c-on-accent)] hover:bg-[var(--c-accent-hover)] disabled:opacity-60"
                >
                  {reorderBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCw className="h-3.5 w-3.5 text-[#D89B2B]" />
                  )}
                  <span>{bn ? 'ওয়ান-ক্লিক রিঅর্ডার' : 'One-Click Reorder'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {/* 2. Verified Review Prompt */}
                <form
                  onSubmit={handleSubmitVerifiedReview}
                  className="space-y-3 rounded-xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-bg)] p-4 text-xs"
                >
                  <h4 className="flex items-center gap-1.5 font-semibold text-[var(--c-ink)]">
                    <Star className="h-4 w-4 text-[#B47B2B]" />
                    <span>
                      {bn ? 'যাচাইকৃত ক্রেতা রিভিউ দিন' : 'Share Your Verified Review'}
                    </span>
                  </h4>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setReviewRating(star)}
                        aria-label={`${star} stars`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-[var(--c-surface)]"
                      >
                        <Star
                          className={`h-5 w-5 ${
                            star <= reviewRating
                              ? 'fill-[#B47B2B] text-[#B47B2B]'
                              : 'text-[#C5B8A5]'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    required
                    value={reviewName}
                    onChange={(e) => setReviewName(e.target.value)}
                    placeholder={bn ? 'আপনার নাম' : 'Your name'}
                    className="w-full rounded-lg border border-[rgb(var(--c-tint)/0.16)] bg-[var(--c-card)] px-3 py-2 text-base sm:text-xs"
                  />
                  <textarea
                    rows={2}
                    required
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder={
                      bn
                        ? 'ঘিয়ের স্বাদ, দানা ও প্যাকেজিং কেমন লেগেছে লিখুন...'
                        : 'Tell us how the aroma, danadar texture, and jar arrived...'
                    }
                    className="w-full rounded-lg border border-[rgb(var(--c-tint)/0.16)] bg-[var(--c-card)] px-3 py-2 text-base sm:text-xs"
                  />
                  {reviewStatus && (
                    <p
                      className={`text-[11px] font-medium ${
                        reviewStatus.type === 'ok' ? 'text-emerald-800' : 'text-red-700'
                      }`}
                    >
                      {reviewStatus.text}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={reviewBusy}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#B47B2B] px-4 py-2 text-xs font-semibold text-[var(--c-on-gold)] disabled:opacity-60"
                  >
                    {reviewBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                    <span>{bn ? 'রিভিউ জমা দিন' : 'Submit Verified Review'}</span>
                  </button>
                </form>

                {/* 3. Opt-in Refill Reminder */}
                <div className="space-y-3 rounded-xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-bg)] p-4 text-xs">
                  <h4 className="flex items-center gap-1.5 font-semibold text-[var(--c-ink)]">
                    <BellRing className="h-4 w-4 text-[var(--c-gold-text)]" />
                    <span>{bn ? 'রিফিল রিমাইন্ডার (ঐচ্ছিক)' : 'Opt-in Refill Reminder'}</span>
                  </h4>
                  <p className="text-[11px] text-[var(--c-muted)]">
                    {bn
                      ? 'আপনি চাইলে নির্দিষ্ট দিন পর ঘি রিফিলের স্মরণবার্তা সেট করে রাখতে পারেন (যেকোনো সময় বন্ধ করা যাবে)।'
                      : 'Choose an optional refill interval reminder tailored to your kitchen pace. Pause or opt out anytime.'}
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {([30, 45, 60, 90] as const).map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setReminderInterval(days)}
                        className={`min-h-[44px] rounded-lg border font-mono text-xs font-semibold ${
                          reminderInterval === days
                            ? 'border-[#B47B2B] bg-[#B47B2B] text-[var(--c-on-gold)]'
                            : 'border-[rgb(var(--c-tint)/0.16)] bg-[var(--c-card)] text-[var(--c-ink)]'
                        }`}
                      >
                        {days}d
                      </button>
                    ))}
                  </div>
                  <label className="flex items-start gap-2 text-[11px] text-[var(--c-muted)]">
                    <input
                      type="checkbox"
                      checked={reminderConsent}
                      onChange={(e) => setReminderConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-[#B47B2B]"
                    />
                    <span>
                      {bn
                        ? 'আমি সম্মতি দিচ্ছি যেন নির্বাচিত সময়ে রিফিল রিমাইন্ডার শিডিউল করা হয়।'
                        : 'I explicitly opt in to schedule this refill reminder.'}
                    </span>
                  </label>
                  {savedReminder && (
                    <p className="font-mono text-[10.5px] text-[var(--c-gold-text)]">
                      Status: {savedReminder.status} · {savedReminder.intervalDays} days
                    </p>
                  )}
                  {reminderFeedback && (
                    <p className="text-[11px] font-medium text-[var(--c-ink)]">{reminderFeedback}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={reminderBusy || !reminderConsent}
                      onClick={() => handleSaveRefillReminder('active')}
                      className="min-h-[44px] rounded-lg bg-[var(--c-accent)] px-4 py-2 text-xs font-semibold text-[var(--c-on-accent)] disabled:opacity-50"
                    >
                      {bn ? 'রিমাইন্ডার চালু করুন' : 'Save Reminder'}
                    </button>
                    {savedReminder && savedReminder.status === 'active' && (
                      <button
                        type="button"
                        disabled={reminderBusy}
                        onClick={() => handleSaveRefillReminder('opted_out')}
                        className="min-h-[44px] rounded-lg border border-[rgb(var(--c-tint)/0.2)] bg-[var(--c-card)] px-3.5 py-2 text-xs font-medium text-[var(--c-muted)]"
                      >
                        {bn ? 'বন্ধ করুন' : 'Opt Out'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
