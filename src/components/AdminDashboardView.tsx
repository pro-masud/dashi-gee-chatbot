'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  ArrowLeft,
  BellRing,
  Check,
  Download,
  ExternalLink,
  Loader2,
  LogOut,
  Menu,
  Printer,
  Send,
  ShieldCheck,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import {
  BatchRecord,
  CouponRecord,
  DEFAULT_ACTIVE_BATCH,
  DEFAULT_STORE_SETTINGS,
  OrderAuditLogRecord,
  OrderRecord,
  OrderStatus,
  PaymentStatus,
  ReviewRecord,
  StoreSettingsDoc,
  SubscriberRecord,
  checkIsAdminUser,
  deleteAdminReview,
  fetchAdminCoupons,
  fetchAdminOrders,
  fetchAdminReviews,
  fetchAdminSubscribers,
  fetchAllBatches,
  moderateAdminReview,
  saveAdminCoupon,
  saveBatchRecord,
  saveStoreSettings,
  signInAdminWithGoogle,
  signOutAdmin,
  subscribeToAuth,
  updateAdminOrderStatus,
} from '../lib/firebase';
import type { CourierPartner } from '../lib/storeTypes';
import { buildOrdersCsv } from '../lib/chatbot/supportEngine';
import type { RefillReminderDoc } from '../lib/chatbot/types';
import { formatBdt } from '../data/deshiGeeData';
import { AdminChatbotPanel } from './AdminChatbotPanel';
import { useStorefront } from './StorefrontProvider';

interface AdminDashboardViewProps {
  settings: StoreSettingsDoc;
  onSettingsUpdated: (next: StoreSettingsDoc) => void;
  onBackHome: () => void;
}

type AdminTab = 'overview' | 'orders' | 'store' | 'batches' | 'reviews' | 'chatbot';

export function AdminDashboardView({
  settings,
  onSettingsUpdated,
  onBackHome,
}: AdminDashboardViewProps) {
  const { setChatbotConfig } = useStorefront();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authError, setAuthError] = useState('');
  const [tab, setTab] = useState<AdminTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [subscribers, setSubscribers] = useState<SubscriberRecord[]>([]);
  const [webhookInfo, setWebhookInfo] = useState<{
    configuredChannels: Record<string, boolean>;
    recentLogs: { orderNumber: string; channel: string; status: string; detail: string; timestamp: string }[];
  } | null>(null);

  const [orderSearch, setOrderSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus | 'manual_review'>('all');
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [auditLogs, setAuditLogs] = useState<OrderAuditLogRecord[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [reviewActionLoading, setReviewActionLoading] = useState(false);

  const [courierPartnerDraft, setCourierPartnerDraft] = useState<CourierPartner>('steadfast');
  const [consignmentIdDraft, setConsignmentIdDraft] = useState('');
  const [courierUrlDraft, setCourierUrlDraft] = useState('');
  const [courierMarkShipped, setCourierMarkShipped] = useState(true);
  const [courierSaving, setCourierSaving] = useState(false);
  const [courierBooking, setCourierBooking] = useState(false);
  const [courierFeedback, setCourierFeedback] = useState('');

  const [refillReminders, setRefillReminders] = useState<RefillReminderDoc[]>([]);
  const [refillDueCount, setRefillDueCount] = useState(0);
  const [refillDispatchBusy, setRefillDispatchBusy] = useState(false);
  const [refillDispatchReport, setRefillDispatchReport] = useState('');

  // Editable Store Config Form
  const [draftSettings, setDraftSettings] = useState<StoreSettingsDoc>(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState('');

  // New Batch Form
  const [batchDraft, setBatchDraft] = useState<BatchRecord>(DEFAULT_ACTIVE_BATCH);
  const [couponDraft, setCouponDraft] = useState<CouponRecord>({
    code: '',
    discountPct: 0,
    minSubtotalBdt: 0,
    active: false,
    expiresAt: '',
    maxUses: 0,
    usedCount: 0,
    stackableWithAdvance: false,
    descriptionEn: '',
  });

  useEffect(() => {
    setDraftSettings(settings);
  }, [settings]);

  useEffect(() => {
    const unsub = subscribeToAuth(async (u) => {
      setUser(u);
      const ok = await checkIsAdminUser(u);
      setIsAdmin(ok);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (mobileNavOpen) {
        setMobileNavOpen(false);
      } else if (selectedOrder && typeof window !== 'undefined' && window.innerWidth < 1024) {
        setSelectedOrder(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen, selectedOrder]);

  const loadAdminWorkspace = async () => {
    setLoadingData(true);
    try {
      const [ordList, revList, batchList, couponList, subList] = await Promise.all([
        fetchAdminOrders(),
        fetchAdminReviews(),
        fetchAllBatches(),
        fetchAdminCoupons(),
        fetchAdminSubscribers(),
      ]);
      setOrders(ordList);
      setReviews(revList);
      setBatches(batchList);
      setCoupons(couponList);
      setSubscribers(subList);

      const idToken = user ? await user.getIdToken().catch(() => '') : '';
      const whRes = idToken
        ? await fetch('/api/notifications/status', {
            headers: { Authorization: `Bearer ${idToken}` },
          })
        : null;
      if (whRes?.ok) {
        setWebhookInfo(await whRes.json());
      }
      await loadRefillReminders();
    } catch (err) {
      console.error('Failed loading admin workspace:', err);
    } finally {
      setLoadingData(false);
    }
  };

  const loadRefillReminders = async () => {
    if (!user) return;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/orders/refill-reminder/dispatch', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRefillReminders(Array.isArray(data.reminders) ? data.reminders : []);
        setRefillDueCount(Number(data.dueCount || 0));
      }
    } catch {
      // Non-blocking refresh
    }
  };

  useEffect(() => {
    if (isAdmin && user) {
      loadAdminWorkspace();
    }
  }, [isAdmin, user]);

  const handleGoogleSignIn = async () => {
    setAuthError('');
    try {
      const u = await signInAdminWithGoogle();
      const ok = await checkIsAdminUser(u);
      if (!ok) {
        setAuthError(
          `Signed in as ${u.email}, which is not listed in the authorized admin roster.`
        );
      }
      setIsAdmin(ok);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Google Sign-In was cancelled or failed.'
      );
    }
  };

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsSavedMsg('');
    try {
      await saveStoreSettings(draftSettings);
      onSettingsUpdated(draftSettings);
      setSettingsSavedMsg('Storefront pricing, stock, and delivery settings saved.');
    } catch (err) {
      setSettingsSavedMsg(
        err instanceof Error ? err.message : 'Failed to save store settings.'
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleOrderMutation = async (
    order: OrderRecord,
    nextStatus: OrderStatus,
    nextPaymentStatus: PaymentStatus
  ) => {
    await updateAdminOrderStatus(order, nextStatus, nextPaymentStatus);
    setOrders((prev) =>
      prev.map((o) =>
        o.orderNumber === order.orderNumber
          ? { ...o, status: nextStatus, paymentStatus: nextPaymentStatus }
          : o
      )
    );
    if (selectedOrder?.orderNumber === order.orderNumber) {
      setSelectedOrder({
        ...order,
        status: nextStatus,
        paymentStatus: nextPaymentStatus,
      });
    }
  };

  const loadOrderAuditLogs = async (orderNumber: string) => {
    if (!user) return;
    setLoadingAuditLogs(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(
        `/api/orders/manage?action=audit_logs&orderNumber=${encodeURIComponent(orderNumber)}`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        }
      );
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(Array.isArray(data.logs) ? data.logs : []);
      } else {
        setAuditLogs([]);
      }
    } catch {
      setAuditLogs([]);
    } finally {
      setLoadingAuditLogs(false);
    }
  };

  useEffect(() => {
    if (selectedOrder) {
      setCourierPartnerDraft(selectedOrder.courierPartner || 'steadfast');
      setConsignmentIdDraft(selectedOrder.consignmentId || '');
      setCourierUrlDraft(selectedOrder.courierTrackingUrl || '');
      setCourierMarkShipped(
        selectedOrder.status !== 'shipped' &&
          selectedOrder.status !== 'delivered' &&
          selectedOrder.status !== 'cancelled'
      );
      setCourierFeedback('');
    }
    if (selectedOrder && user) {
      loadOrderAuditLogs(selectedOrder.orderNumber);
    } else {
      setAuditLogs([]);
    }
  }, [selectedOrder?.orderNumber]);

  const handleAdminRiskDecision = async (
    order: OrderRecord,
    action: 'admin_review_approve' | 'admin_review_reject'
  ) => {
    if (!user || reviewActionLoading) return;
    setReviewActionLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/orders/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          action,
          orderNumber: order.orderNumber,
          phone: order.phone,
          reason:
            action === 'admin_review_approve'
              ? 'Admin approved manual risk review.'
              : 'Admin rejected flagged order during manual review.',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const nextStatus: OrderStatus =
          action === 'admin_review_approve'
            ? order.status === 'pending'
              ? 'confirmed'
              : order.status
            : 'cancelled';
        const nextReviewStatus =
          action === 'admin_review_approve' ? 'approved' : 'rejected';
        setOrders((prev) =>
          prev.map((o) =>
            o.orderNumber === order.orderNumber
              ? { ...o, status: nextStatus, reviewStatus: nextReviewStatus }
              : o
          )
        );
        if (selectedOrder?.orderNumber === order.orderNumber) {
          setSelectedOrder({
            ...order,
            status: nextStatus,
            reviewStatus: nextReviewStatus,
          });
        }
        await loadOrderAuditLogs(order.orderNumber);
      }
    } finally {
      setReviewActionLoading(false);
    }
  };

  const handleSaveCourier = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || !user || courierSaving) return;
    setCourierSaving(true);
    setCourierFeedback('');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/orders/manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          action: 'admin_update_courier',
          orderNumber: selectedOrder.orderNumber,
          courierPartner: courierPartnerDraft,
          consignmentId: consignmentIdDraft.trim(),
          courierTrackingUrl: courierUrlDraft.trim(),
          markShipped: courierMarkShipped,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setCourierFeedback(data.messageEn || data.error || 'Could not update courier.');
        return;
      }
      const nextStatus = (data.nextStatus as OrderStatus) || selectedOrder.status;
      const updatedFields: Partial<OrderRecord> = {
        status: nextStatus,
        courierPartner: data.courierPartner || courierPartnerDraft,
        consignmentId: data.consignmentId ?? consignmentIdDraft.trim(),
        courierTrackingUrl: data.courierTrackingUrl ?? courierUrlDraft.trim(),
        dispatchedAtIso: data.dispatchedAtIso || selectedOrder.dispatchedAtIso,
      };
      setOrders((prev) =>
        prev.map((o) =>
          o.orderNumber === selectedOrder.orderNumber ? { ...o, ...updatedFields } : o
        )
      );
      setSelectedOrder({ ...selectedOrder, ...updatedFields });
      if (data.courierTrackingUrl) {
        setCourierUrlDraft(data.courierTrackingUrl);
      }
      setCourierFeedback(data.messageEn || 'Courier updated.');
      await loadOrderAuditLogs(selectedOrder.orderNumber);
    } catch (err) {
      setCourierFeedback(err instanceof Error ? err.message : 'Courier update failed.');
    } finally {
      setCourierSaving(false);
    }
  };

  const handleAutoBookCourier = async () => {
    if (!selectedOrder || !user || courierBooking || courierPartnerDraft === 'manual') return;
    setCourierBooking(true);
    setCourierFeedback('');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/courier/book', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          orderNumber: selectedOrder.orderNumber,
          partner: courierPartnerDraft,
          markShipped: courierMarkShipped,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setCourierFeedback(
          data.error || `Could not auto-book with ${courierPartnerDraft.toUpperCase()} API.`
        );
        return;
      }
      const nextStatus = (data.nextStatus as OrderStatus) || selectedOrder.status;
      const updatedFields: Partial<OrderRecord> = {
        status: nextStatus,
        courierPartner: data.partner || courierPartnerDraft,
        consignmentId: data.consignmentId || '',
        courierTrackingUrl: data.courierTrackingUrl || '',
        dispatchedAtIso: data.dispatchedAtIso || selectedOrder.dispatchedAtIso,
      };
      setOrders((prev) =>
        prev.map((o) =>
          o.orderNumber === selectedOrder.orderNumber ? { ...o, ...updatedFields } : o
        )
      );
      setSelectedOrder({ ...selectedOrder, ...updatedFields });
      if (data.consignmentId) setConsignmentIdDraft(data.consignmentId);
      if (data.courierTrackingUrl) setCourierUrlDraft(data.courierTrackingUrl);
      setCourierFeedback(data.messageEn || 'Parcel booked via live courier API.');
      await loadOrderAuditLogs(selectedOrder.orderNumber);
    } catch (err) {
      setCourierFeedback(err instanceof Error ? err.message : 'Live courier booking failed.');
    } finally {
      setCourierBooking(false);
    }
  };

  const handleDispatchRefillQueue = async (dryRun: boolean) => {
    if (!user || refillDispatchBusy) return;
    setRefillDispatchBusy(true);
    setRefillDispatchReport('');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/orders/refill-reminder/dispatch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) {
        setRefillDispatchReport(data.error || 'Refill dispatch failed.');
        return;
      }
      setRefillDispatchReport(
        dryRun
          ? `Dry run: ${data.dueCount ?? 0} due out of ${data.totalActive ?? 0} active opt-in reminders.`
          : `Processed ${data.dueCount ?? 0} due: ${data.dispatchedCount ?? 0} dispatched/logged, ${data.failedCount ?? 0} failed.`
      );
      await loadRefillReminders();
    } catch (err) {
      setRefillDispatchReport(err instanceof Error ? err.message : 'Dispatch error.');
    } finally {
      setRefillDispatchBusy(false);
    }
  };

  const handleExportOrdersCsv = () => {
    const csv = buildOrdersCsv(filteredOrders);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deshi-gee-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveBatch = async (e: FormEvent) => {
    e.preventDefault();
    await saveBatchRecord(batchDraft);
    const updated = await fetchAllBatches();
    setBatches(updated);
  };

  const handleSaveCoupon = async (e: FormEvent) => {
    e.preventDefault();
    await saveAdminCoupon(couponDraft);
    setCoupons(await fetchAdminCoupons());
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter === 'manual_review') {
        if (o.reviewStatus !== 'manual_review') return false;
      } else if (statusFilter !== 'all' && o.status !== statusFilter) {
        return false;
      }
      if (orderSearch.trim()) {
        const q = orderSearch.trim().toLowerCase();
        return (
          o.orderNumber.toLowerCase().includes(q) ||
          o.phone.includes(q) ||
          o.customerName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [orders, orderSearch, statusFilter]);

  const metrics = useMemo(() => {
    const totalSales = orders
      .filter((o) => o.status !== 'cancelled')
      .reduce((s, o) => s + o.totalBdt, 0);
    const pending = orders.filter((o) => o.status === 'pending').length;
    const confirmed = orders.filter((o) => o.status === 'confirmed').length;
    const delivered = orders.filter((o) => o.status === 'delivered').length;
    const manualReview = orders.filter((o) => o.reviewStatus === 'manual_review').length;
    return { total: orders.length, pending, confirmed, delivered, manualReview, totalSales };
  }, [orders]);

  if (!authReady) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#B47B2B]" />
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <section className="mx-auto flex min-h-[75vh] max-w-md flex-col justify-center px-5 py-16">
        <button
          type="button"
          onClick={onBackHome}
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-[#635647] hover:text-[#1E1710]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Return to Storefront</span>
        </button>

        <div className="rounded-2xl border border-[rgba(30,23,16,0.14)] bg-[#FFFDF9] p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#F2ECE1] text-[#8A5A17]">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="font-display mt-4 text-2xl font-semibold text-[#1E1710]">
            Deshi Gee Admin Console
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#635647]">
            Sign in with your authorized Google account to manage orders, verify
            bKash/Nagad transactions, update jar stock &amp; pricing, and moderate
            customer reviews.
          </p>

          {authError && (
            <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800">
              {authError}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="mt-6 w-full rounded-lg bg-[#1E1710] px-5 py-3 text-sm font-medium text-[#FAF7F2] hover:bg-[#35291E]"
          >
            Sign in with Google
          </button>

          {user && !isAdmin && (
            <button
              type="button"
              onClick={() => signOutAdmin()}
              className="mt-3 w-full rounded-lg border border-[rgba(30,23,16,0.2)] px-4 py-2 text-xs font-medium text-[#635647]"
            >
              Sign out ({user.email})
            </button>
          )}
        </div>
      </section>
    );
  }

  const adminTabs: { id: AdminTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'orders', label: `Orders (${orders.length})` },
    { id: 'store', label: 'Product, Stock & Delivery' },
    { id: 'batches', label: 'Batches & Coupons' },
    { id: 'reviews', label: `Reviews (${reviews.length}) & Subscribers` },
    { id: 'chatbot', label: 'AI Chatbot' },
  ];
  const activeTabLabel = adminTabs.find((t) => t.id === tab)?.label || 'Overview';

  return (
    <div className="min-h-dvh bg-[#FAF7F2] text-[#1E1710]">
      {/* Dedicated Compact Admin Header Bar */}
      <header className="no-print sticky top-0 z-30 border-b border-[rgba(250,247,242,0.12)] bg-[#1A120B] text-[#FAF7F2]">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open admin menu"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#FAF7F2]/20 bg-[#FAF7F2]/5 text-[#FAF7F2] hover:bg-[#FAF7F2]/10 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#D4AF37]" />
                <h1 className="font-display truncate text-base font-semibold tracking-tight text-[#FAF7F2] sm:text-xl">
                  Deshi Gee Operations
                </h1>
              </div>
              <p className="truncate text-[11px] text-[#E5B25D] lg:hidden">
                {activeTabLabel}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onBackHome}
              className="hidden min-h-[44px] items-center gap-1.5 rounded-lg border border-[#FAF7F2]/20 px-3.5 py-2 text-xs font-medium text-[#FAF7F2]/90 hover:bg-[#FAF7F2]/10 sm:inline-flex"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-[#E5B25D]" />
              <span>Storefront</span>
            </button>
            <span className="hidden max-w-[200px] truncate text-xs text-[#E8DFC5]/75 md:inline">
              {user.email}
            </span>
            <button
              type="button"
              onClick={() => signOutAdmin()}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#FAF7F2]/20 bg-[#FAF7F2]/5 px-3 py-2 text-xs font-medium text-[#FAF7F2] hover:bg-[#FAF7F2]/15"
            >
              <LogOut className="h-3.5 w-3.5 text-[#E5B25D]" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile & Tablet Slide-Over Admin Navigation Drawer (< 1024px) */}
      {mobileNavOpen && (
        <div className="no-print fixed inset-0 z-50 flex lg:hidden">
          <div
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
            className="fixed inset-0 bg-[#1A120B]/60 backdrop-blur-xs"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
            className="relative z-10 flex h-dvh w-72 max-w-[85vw] flex-col bg-[#1A120B] text-[#FAF7F2] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#FAF7F2]/10 px-4 py-4">
              <div>
                <p className="font-display text-base font-semibold text-[#FAF7F2]">
                  Deshi Gee Admin
                </p>
                <p className="mt-0.5 max-w-[180px] truncate text-[11px] text-[#E8DFC5]/70">
                  {user.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close admin menu"
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[#FAF7F2]/15 text-[#FAF7F2] hover:bg-[#FAF7F2]/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 space-y-1.5 overflow-y-auto p-3">
              {adminTabs.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setTab(id);
                    setMobileNavOpen(false);
                  }}
                  className={`flex min-h-[44px] w-full items-center rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-colors ${
                    tab === id
                      ? 'bg-[#B47B2B] text-[#FFFDF9]'
                      : 'text-[#E8DFC5]/85 hover:bg-[#FAF7F2]/10 hover:text-[#FAF7F2]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="space-y-2 border-t border-[#FAF7F2]/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  onBackHome();
                }}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-[#FAF7F2]/20 px-3.5 py-2 text-xs font-medium text-[#FAF7F2] hover:bg-[#FAF7F2]/10"
              >
                <ArrowLeft className="h-4 w-4 text-[#E5B25D]" />
                <span>Back to Storefront</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  signOutAdmin();
                }}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-xl bg-[#FAF7F2]/10 px-3.5 py-2 text-xs font-medium text-[#FAF7F2] hover:bg-[#FAF7F2]/15"
              >
                <LogOut className="h-4 w-4 text-[#E5B25D]" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      <section className="mx-auto min-h-[calc(100dvh-64px)] max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8">
        {/* Desktop Navigation Tabs (>= 1024px) */}
        <div className="no-print hidden lg:flex lg:flex-wrap lg:gap-2">
          {adminTabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`min-h-[44px] shrink-0 rounded-lg px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                tab === id
                  ? 'bg-[#1E1710] text-[#FAF7F2]'
                  : 'border border-[rgba(30,23,16,0.14)] bg-[#FFFDF9] text-[#635647] hover:text-[#1E1710]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loadingData && (
          <div className="mt-4 flex items-center gap-2 text-xs text-[#635647]">
            <Loader2 className="h-4 w-4 animate-spin text-[#B47B2B]" />
            <span>Syncing live Firestore data...</span>
          </div>
        )}

      {/* TAB 1: OVERVIEW */}
      {tab === 'overview' && (
        <div className="mt-8 space-y-8">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5">
              <p className="text-xs text-[#635647]">Total Orders</p>
              <p className="font-mono mt-2 text-2xl font-semibold tabular-nums">
                {metrics.total}
              </p>
            </div>
            <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5">
              <p className="text-xs text-[#635647]">Pending</p>
              <p className="font-mono mt-2 text-2xl font-semibold tabular-nums text-[#8A5A17]">
                {metrics.pending}
              </p>
            </div>
            <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5">
              <p className="text-xs text-[#635647]">Confirmed</p>
              <p className="font-mono mt-2 text-2xl font-semibold tabular-nums">
                {metrics.confirmed}
              </p>
            </div>
            <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5">
              <p className="text-xs text-[#635647]">Delivered</p>
              <p className="font-mono mt-2 text-2xl font-semibold tabular-nums">
                {metrics.delivered}
              </p>
            </div>
            <div className="col-span-2 rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#F2ECE1] p-5 md:col-span-1">
              <p className="text-xs text-[#635647]">Total Sales</p>
              <p className="font-mono mt-2 text-2xl font-semibold tabular-nums text-[#8A5A17]">
                {formatBdt(metrics.totalSales)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6">
              <h2 className="font-display text-lg font-semibold">Recent Orders</h2>
              <div className="mt-4 divide-y divide-[rgba(30,23,16,0.08)] text-sm">
                {orders.slice(0, 6).map((o) => (
                  <div
                    key={o.orderNumber}
                    className="flex items-center justify-between py-3"
                  >
                    <div>
                      <p className="font-mono text-xs font-semibold">{o.orderNumber}</p>
                      <p className="text-xs text-[#635647]">
                        {o.customerName} · {o.itemsSummary || `${o.weight} × ${o.qty}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-xs font-medium tabular-nums">
                        {formatBdt(o.totalBdt)}
                      </p>
                      <p className="text-[11px] uppercase text-[#8A5A17]">
                        {o.status}
                      </p>
                    </div>
                  </div>
                ))}
                {orders.length === 0 && (
                  <p className="py-6 text-xs text-[#635647]">No orders recorded yet.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6">
              <h2 className="font-display text-lg font-semibold">
                Owner Notification Webhook Log
              </h2>
              <p className="mt-1 text-xs text-[#635647]">
                Configure `OWNER_WEBHOOK_URL`, `GOOGLE_SHEETS_WEBHOOK_URL`, or
                `WHATSAPP_WEBHOOK_URL` on the server environment.
              </p>
              <div className="mt-4 space-y-2 text-xs">
                {webhookInfo?.recentLogs?.map((log, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-3"
                  >
                    <div className="flex justify-between font-mono">
                      <span>{log.orderNumber || 'Order'}</span>
                      <span>{log.status}</span>
                    </div>
                    <p className="mt-1 text-[#635647]">{log.detail}</p>
                  </div>
                ))}
                {(!webhookInfo || webhookInfo.recentLogs.length === 0) && (
                  <p className="py-4 text-[#635647]">
                    No webhook dispatches recorded in this server session yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ORDERS & PRINT RECEIPT */}
      {tab === 'orders' && (
        <div className="mt-8 space-y-6">
          <div className="no-print flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <input
              type="text"
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder="Search Order ID, phone, or customer..."
              className="min-h-[42px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3.5 py-2 text-base focus:border-[#B47B2B] focus:outline-none sm:max-w-xs sm:text-sm"
            />
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'all' | OrderStatus | 'manual_review')
              }
              className="min-h-[42px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-2 text-base sm:w-auto sm:text-sm"
            >
              <option value="all">All Statuses</option>
              <option value="manual_review">
                Manual Risk Review ({metrics.manualReview})
              </option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="processing">Processing</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button
              type="button"
              onClick={handleExportOrdersCsv}
              disabled={filteredOrders.length === 0}
              className="inline-flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.2)] bg-[#FFFDF9] px-4 py-2 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5 text-[#8A5A17]" />
              <span>Export CSV ({filteredOrders.length})</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="no-print space-y-3 lg:col-span-7">
              {filteredOrders.map((order) => (
                <button
                  key={order.orderNumber}
                  type="button"
                  onClick={() => setSelectedOrder(order)}
                  className={`block w-full cursor-pointer rounded-xl border p-4 text-left transition-colors ${
                    selectedOrder?.orderNumber === order.orderNumber
                      ? 'border-[#B47B2B] bg-[#F2ECE1]'
                      : 'border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] hover:bg-[#FAF7F2]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {order.orderNumber}
                      </span>
                      {order.reviewStatus === 'manual_review' && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-amber-900">
                          Review · Risk {order.riskScore ?? 0}
                        </span>
                      )}
                      {order.duplicateWarning && (
                        <span className="rounded bg-orange-100 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-orange-900">
                          Dup Check
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-sm font-semibold tabular-nums text-[#8A5A17]">
                      {formatBdt(order.totalBdt)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-[#635647]">
                    <span>
                      {order.customerName} · {order.phone} · {order.district}
                    </span>
                    <span className="uppercase">
                      {order.status} · {order.paymentMethod} ({order.paymentStatus})
                    </span>
                  </div>
                </button>
              ))}
              {filteredOrders.length === 0 && (
                <p className="text-sm text-[#635647]">No matching orders found.</p>
              )}
            </div>

            {selectedOrder && (
              <div
                onClick={(e) => {
                  if (e.target === e.currentTarget) setSelectedOrder(null);
                }}
                className="fixed inset-0 z-40 flex justify-end bg-[#1A120B]/50 backdrop-blur-xs lg:static lg:inset-auto lg:z-auto lg:col-span-5 lg:block lg:bg-transparent lg:backdrop-blur-none"
              >
                <div className="h-dvh w-full max-w-lg overflow-y-auto overscroll-contain bg-[#FFFDF9] p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl lg:h-auto lg:max-w-none lg:overflow-visible lg:rounded-2xl lg:border lg:border-[rgba(30,23,16,0.14)] lg:p-6 lg:shadow-none">
                  <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-4 flex items-start justify-between gap-2 border-b border-[rgba(30,23,16,0.10)] bg-[#FFFDF9]/95 px-5 py-4 backdrop-blur-xs lg:static lg:mx-0 lg:mt-0 lg:mb-0 lg:border-b-0 lg:bg-transparent lg:p-0">
                    <div>
                      <p className="font-mono text-xs uppercase text-[#8A5A17]">
                        Order Receipt &amp; Controls
                      </p>
                      <h3 className="font-display mt-1 text-2xl font-semibold">
                        {selectedOrder.orderNumber}
                      </h3>
                    </div>
                    <div className="no-print flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.2)] px-3 py-1.5 text-xs font-medium hover:bg-[#F2ECE1]"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Print Receipt</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedOrder(null)}
                        aria-label="Close order details"
                        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[rgba(30,23,16,0.2)] text-[#1E1710] hover:bg-[#F2ECE1] lg:hidden"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                <dl className="mt-5 space-y-2.5 border-y border-[rgba(30,23,16,0.10)] py-4 text-xs">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-[#635647]">Customer</dt>
                    <dd className="text-right font-medium">{selectedOrder.customerName}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-[#635647]">Phone</dt>
                    <dd className="font-mono text-right">{selectedOrder.phone}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-[#635647]">Address</dt>
                    <dd className="max-w-[220px] break-words text-right">
                      {selectedOrder.address}, {selectedOrder.area},{' '}
                      {selectedOrder.district}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-[#635647]">Jar &amp; Qty</dt>
                    <dd className="font-mono text-right">
                      {selectedOrder.itemsSummary ||
                        `${selectedOrder.weight} × ${selectedOrder.qty}`}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-[#635647]">Payment</dt>
                    <dd className="font-mono text-right uppercase break-all">
                      {selectedOrder.paymentMethod}{' '}
                      {selectedOrder.txnId ? `(${selectedOrder.txnId})` : ''}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 font-semibold">
                    <dt className="shrink-0">Total</dt>
                    <dd className="font-mono tabular-nums text-[#8A5A17]">
                      {formatBdt(selectedOrder.totalBdt)}
                    </dd>
                  </div>
                </dl>

                {selectedOrder.paymentProofData && (
                  <div className="mt-4">
                    <p className="mb-1.5 text-xs font-medium text-[#635647]">
                      Attached MFS Proof:
                    </p>
                    <img
                      src={selectedOrder.paymentProofData}
                      alt="Payment proof screenshot"
                      className="max-h-48 rounded-lg border border-[rgba(30,23,16,0.12)]"
                    />
                  </div>
                )}

                <div className="no-print mt-5 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[#635647]">
                      Update Fulfillment Status
                    </label>
                    <select
                      value={selectedOrder.status}
                      onChange={(e) =>
                        handleOrderMutation(
                          selectedOrder,
                          e.target.value as OrderStatus,
                          selectedOrder.paymentStatus
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-3 py-2 text-base sm:text-xs"
                    >
                      <option value="pending">Pending</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="processing">Processing</option>
                      <option value="shipped">Shipped</option>
                      <option value="delivered">Delivered</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#635647]">
                      Payment Verification Status
                    </label>
                    <select
                      value={selectedOrder.paymentStatus}
                      onChange={(e) =>
                        handleOrderMutation(
                          selectedOrder,
                          selectedOrder.status,
                          e.target.value as PaymentStatus
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-3 py-2 text-base sm:text-xs"
                    >
                      <option value="cod_due">COD Due</option>
                      <option value="pending_verification">Pending Verification</option>
                      <option value="verified">Verified</option>
                      <option value="failed">Failed</option>
                    </select>
                  </div>

                  {/* Courier Consignment & Tracking Assignment */}
                  <form
                    onSubmit={handleSaveCourier}
                    className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FAF7F2] p-3 text-xs space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-semibold text-[#1E1710]">
                        <Truck className="h-3.5 w-3.5 text-[#8A5A17]" />
                        <span>Courier &amp; Consignment</span>
                      </span>
                      {selectedOrder.courierTrackingUrl &&
                        /^https:\/\/[^\s]+$/i.test(selectedOrder.courierTrackingUrl) && (
                          <a
                            href={selectedOrder.courierTrackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#8A5A17] hover:underline"
                          >
                            <span>Open Link</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label className="block text-[10px] text-[#635647]">Partner</label>
                        <select
                          value={courierPartnerDraft}
                          onChange={(e) => setCourierPartnerDraft(e.target.value as CourierPartner)}
                          className="mt-0.5 w-full rounded border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-2.5 py-1.5 text-base sm:text-xs"
                        >
                          <option value="steadfast">Steadfast</option>
                          <option value="pathao">Pathao</option>
                          <option value="redx">RedX</option>
                          <option value="manual">Manual / Local Rider</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-[#635647]">Consignment ID</label>
                        <input
                          type="text"
                          value={consignmentIdDraft}
                          onChange={(e) => setConsignmentIdDraft(e.target.value)}
                          placeholder="SF-994210"
                          className="mt-0.5 w-full rounded border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-2.5 py-1.5 font-mono text-base sm:text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-[#635647]">
                        Tracking URL (https:// optional — auto-built if blank)
                      </label>
                      <input
                        type="url"
                        value={courierUrlDraft}
                        onChange={(e) => setCourierUrlDraft(e.target.value)}
                        placeholder="https://steadfast.com.bd/t/..."
                        className="mt-0.5 w-full rounded border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-2.5 py-1.5 font-mono text-base sm:text-xs"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-[#635647]">
                      <input
                        type="checkbox"
                        checked={courierMarkShipped}
                        onChange={(e) => setCourierMarkShipped(e.target.checked)}
                      />
                      <span>Mark order status as Shipped on save</span>
                    </label>
                    {courierFeedback && (
                      <p className="text-[11px] font-medium text-[#8A5A17]">{courierFeedback}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        disabled={courierSaving || courierBooking}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-3 py-1.5 text-[11px] font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
                      >
                        {courierSaving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Truck className="h-3 w-3" />
                        )}
                        <span>Save Courier Dispatch</span>
                      </button>
                      {courierPartnerDraft !== 'manual' && (
                        <button
                          type="button"
                          disabled={courierBooking || courierSaving}
                          onClick={handleAutoBookCourier}
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#B47B2B] bg-[#FFFDF9] px-3 py-1.5 text-[11px] font-medium text-[#8A5A17] hover:bg-[#F2ECE1] disabled:opacity-50"
                        >
                          {courierBooking ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <ExternalLink className="h-3 w-3" />
                          )}
                          <span>
                            Auto-Book {courierPartnerDraft.toUpperCase()} API
                          </span>
                        </button>
                      )}
                    </div>
                  </form>

                  {/* Risk Signals & Manual Review Queue Controls */}
                  <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FAF7F2] p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#1E1710]">
                        Risk &amp; Review ({selectedOrder.reviewStatus || 'auto_approved'})
                      </span>
                      <span className="font-mono text-[#8A5A17]">
                        Score: {selectedOrder.riskScore ?? 0}/100
                      </span>
                    </div>
                    {selectedOrder.riskSignals && selectedOrder.riskSignals.length > 0 && (
                      <p className="font-mono text-[11px] text-[#635647]">
                        Signals: {selectedOrder.riskSignals.join(', ')}
                      </p>
                    )}
                    {selectedOrder.duplicateWarning && (
                      <p className="text-[11px] text-amber-900">
                        {selectedOrder.duplicateWarning}
                      </p>
                    )}
                    {selectedOrder.paymentMethod === 'cod' && (
                      <p className="text-[11px] text-[#635647]">
                        COD OTP Provider:{' '}
                        <span className="font-mono font-medium">
                          {selectedOrder.codVerificationStatus === 'not_configured'
                            ? 'Not configured (manual phone confirm)'
                            : selectedOrder.codVerificationStatus || 'Not required'}
                        </span>
                      </p>
                    )}
                    {selectedOrder.reviewStatus === 'manual_review' && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          disabled={reviewActionLoading}
                          onClick={() =>
                            handleAdminRiskDecision(selectedOrder, 'admin_review_approve')
                          }
                          className="rounded-lg bg-[#1E1710] px-3 py-1.5 text-[11px] font-medium text-[#FAF7F2] disabled:opacity-50"
                        >
                          Approve Review &amp; Confirm
                        </button>
                        <button
                          type="button"
                          disabled={reviewActionLoading}
                          onClick={() =>
                            handleAdminRiskDecision(selectedOrder, 'admin_review_reject')
                          }
                          className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-[11px] font-medium text-red-800 disabled:opacity-50"
                        >
                          Reject &amp; Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Order Audit Logs */}
                  <div className="rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#1E1710]">
                        Audit History ({auditLogs.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => loadOrderAuditLogs(selectedOrder.orderNumber)}
                        className="text-[11px] font-medium text-[#8A5A17] hover:underline"
                      >
                        {loadingAuditLogs ? 'Loading...' : 'Refresh'}
                      </button>
                    </div>
                    {auditLogs.length === 0 ? (
                      <p className="text-[11px] text-[#635647]">
                        No audit events recorded yet.
                      </p>
                    ) : (
                      <ul className="space-y-1.5 max-h-44 overflow-y-auto">
                        {auditLogs.map((log) => (
                          <li
                            key={log.id}
                            className="rounded border border-[rgba(30,23,16,0.08)] bg-white px-2.5 py-1.5 text-[11px]"
                          >
                            <div className="flex justify-between font-mono text-[10px] text-[#8A5A17]">
                              <span>
                                {log.action} · {log.actorType}
                              </span>
                              <span>
                                {log.previousStatus ? `${log.previousStatus}→` : ''}
                                {log.nextStatus}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[#1E1710]">{log.summary}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: STORE, STOCK, DELIVERY & CONTACT CONFIG */}
      {tab === 'store' && (
        <form
          onSubmit={handleSaveSettings}
          className="mt-8 grid grid-cols-1 gap-6 rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-4 sm:p-6 md:grid-cols-3"
        >
          <div className="space-y-4">
            <h2 className="font-display text-lg font-semibold">
              Single-Product Pricing &amp; Stock
            </h2>
            {(['250g', '500g', '1kg'] as const).map((w) => {
              const priceKey = w === '250g' ? 'price250g' : w === '500g' ? 'price500g' : 'price1kg';
              const stockKey = w === '250g' ? 'stock250g' : w === '500g' ? 'stock500g' : 'stock1kg';
              return (
                <div key={w} className="grid grid-cols-2 gap-3 rounded-xl bg-[#FAF7F2] p-3">
                  <div>
                    <label className="block text-xs text-[#635647]">{w} Price (৳)</label>
                    <input
                      type="number"
                      min={1}
                      value={draftSettings[priceKey]}
                      onChange={(e) =>
                        setDraftSettings({
                          ...draftSettings,
                          [priceKey]: Number(e.target.value),
                        })
                      }
                      className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] bg-white px-2.5 py-1.5 font-mono text-base sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#635647]">{w} Stock</label>
                    <input
                      type="number"
                      min={0}
                      value={draftSettings[stockKey]}
                      onChange={(e) =>
                        setDraftSettings({
                          ...draftSettings,
                          [stockKey]: Number(e.target.value),
                        })
                      }
                      className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] bg-white px-2.5 py-1.5 font-mono text-base sm:text-sm"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-4">
            <h2 className="font-display text-lg font-semibold">
              Bangladesh Delivery &amp; MFS Numbers
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#635647]">Dhaka City (৳)</label>
                <input
                  type="number"
                  min={0}
                  value={draftSettings.insideDhakaFee}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      insideDhakaFee: Number(e.target.value),
                    })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[#635647]">Dhaka Suburban (৳)</label>
                <input
                  type="number"
                  min={0}
                  value={draftSettings.dhakaSuburbanFee ?? 0}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      dhakaSuburbanFee: Number(e.target.value),
                    })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[#635647]">Nationwide (৳)</label>
                <input
                  type="number"
                  min={0}
                  value={draftSettings.outsideDhakaFee}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      outsideDhakaFee: Number(e.target.value),
                    })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[#635647]">Remote Districts (৳)</label>
                <input
                  type="number"
                  min={0}
                  value={draftSettings.remoteDistrictFee ?? 0}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      remoteDistrictFee: Number(e.target.value),
                    })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#635647]">Suburban ETA</label>
                <input
                  type="text"
                  placeholder="Unset"
                  value={draftSettings.estimatedSuburbanDays ?? ''}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      estimatedSuburbanDays: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 text-base sm:text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-[#635647]">Remote ETA</label>
                <input
                  type="text"
                  placeholder="Unset"
                  value={draftSettings.estimatedRemoteDays ?? ''}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      estimatedRemoteDays: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 text-base sm:text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#635647]">
                  Cutoff Hour (BST 0-23, 0=Unset)
                </label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={draftSettings.dispatchCutoffHourBst ?? 0}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      dispatchCutoffHourBst: Number(e.target.value),
                    })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[#635647]">
                  High-Value COD Flag (৳, 0=Unset)
                </label>
                <input
                  type="number"
                  min={0}
                  value={draftSettings.codHighValueThresholdBdt ?? 0}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      codHighValueThresholdBdt: Number(e.target.value),
                    })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#635647]">
                Free Delivery Threshold (৳)
              </label>
              <input
                type="number"
                min={0}
                value={draftSettings.freeDeliveryThreshold}
                onChange={(e) =>
                  setDraftSettings({
                    ...draftSettings,
                    freeDeliveryThreshold: Number(e.target.value),
                  })
                }
                className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#635647]">bKash Number</label>
              <input
                type="text"
                value={draftSettings.bkashNumber}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, bkashNumber: e.target.value })
                }
                className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#635647]">Nagad Number</label>
              <input
                type="text"
                value={draftSettings.nagadNumber}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, nagadNumber: e.target.value })
                }
                className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#635647]">
                Advance MFS Discount (%)
              </label>
              <input
                type="number"
                min={0}
                max={25}
                value={draftSettings.advanceDiscountPct}
                onChange={(e) =>
                  setDraftSettings({
                    ...draftSettings,
                    advanceDiscountPct: Number(e.target.value),
                  })
                }
                className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-[#635647]">
              <input
                type="checkbox"
                checked={Boolean(draftSettings.codConfirmEnabled)}
                onChange={(e) =>
                  setDraftSettings({
                    ...draftSettings,
                    codConfirmEnabled: e.target.checked,
                  })
                }
              />
              <span>
                Enable COD Phone Confirm Policy (SMS Provider: Not configured)
              </span>
            </label>
          </div>

          <div className="space-y-4">
            <h2 className="font-display text-lg font-semibold">
              Contact, Origin &amp; Social Links
            </h2>
            <div>
              <label className="block text-xs text-[#635647]">WhatsApp Number</label>
              <input
                type="text"
                value={draftSettings.whatsappNumber}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, whatsappNumber: e.target.value })
                }
                className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#635647]">Support Phone</label>
              <input
                type="text"
                value={draftSettings.supportPhone}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, supportPhone: e.target.value })
                }
                className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#635647]">Support Email</label>
              <input
                type="email"
                value={draftSettings.supportEmail}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, supportEmail: e.target.value })
                }
                className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 text-base sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#635647]">Business Address</label>
              <input
                type="text"
                value={draftSettings.businessAddress}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, businessAddress: e.target.value })
                }
                className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 text-base sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#635647]">Active Batch Code</label>
              <input
                type="text"
                value={draftSettings.activeBatchCode}
                onChange={(e) =>
                  setDraftSettings({
                    ...draftSettings,
                    activeBatchCode: e.target.value.toUpperCase(),
                  })
                }
                className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-2.5 py-1.5 font-mono text-base sm:text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[rgba(30,23,16,0.10)] pt-4 md:col-span-3">
            <span className="text-xs font-medium text-[#8A5A17]">{settingsSavedMsg}</span>
            <button
              type="submit"
              disabled={savingSettings}
              className="inline-flex items-center gap-2 rounded-lg bg-[#B47B2B] px-6 py-2.5 text-sm font-medium text-[#FFFDF9] hover:bg-[#96621B]"
            >
              {savingSettings ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              <span>Save Storefront Configuration</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 4: BATCHES & COUPONS */}
      {tab === 'batches' && (
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <form
            onSubmit={handleSaveBatch}
            className="space-y-4 rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6"
          >
            <h2 className="font-display text-lg font-semibold">
              Batch Provenance &amp; Lab Record
            </h2>
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <div>
                <label className="text-[#635647]">Batch Code</label>
                <input
                  type="text"
                  value={batchDraft.batchCode}
                  onChange={(e) =>
                    setBatchDraft({ ...batchDraft, batchCode: e.target.value.toUpperCase() })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-3 py-2 font-mono text-base sm:text-xs"
                />
              </div>
              <div>
                <label className="text-[#635647]">Origin District</label>
                <input
                  type="text"
                  value={batchDraft.originDistrict}
                  onChange={(e) =>
                    setBatchDraft({ ...batchDraft, originDistrict: e.target.value })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-3 py-2 text-base sm:text-xs"
                />
              </div>
              <div>
                <label className="text-[#635647]">Production Date</label>
                <input
                  type="text"
                  value={batchDraft.productionDate}
                  onChange={(e) =>
                    setBatchDraft({ ...batchDraft, productionDate: e.target.value })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-3 py-2 text-base sm:text-xs"
                />
              </div>
              <div>
                <label className="text-[#635647]">Expiry Date</label>
                <input
                  type="text"
                  value={batchDraft.expiryDate}
                  onChange={(e) =>
                    setBatchDraft({ ...batchDraft, expiryDate: e.target.value })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-3 py-2 text-base sm:text-xs"
                />
              </div>
            </div>
            <div className="text-xs">
              <label className="text-[#635647]">Regulatory Licence Details</label>
              <input
                type="text"
                value={batchDraft.licenceDetails}
                onChange={(e) =>
                  setBatchDraft({ ...batchDraft, licenceDetails: e.target.value })
                }
                className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-3 py-2 text-base sm:text-xs"
              />
            </div>
            <div className="text-xs">
              <label className="text-[#635647]">Lab Report PDF URL</label>
              <input
                type="url"
                value={batchDraft.labReportUrl}
                onChange={(e) =>
                  setBatchDraft({ ...batchDraft, labReportUrl: e.target.value })
                }
                placeholder="https://..."
                className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-3 py-2 text-base sm:text-xs"
              />
            </div>
            <button
              type="submit"
              className="min-h-[42px] rounded-lg bg-[#1E1710] px-5 py-2.5 text-xs font-medium text-[#FAF7F2]"
            >
              Save Batch Record
            </button>

            <div className="border-t border-[rgba(30,23,16,0.10)] pt-4 space-y-2">
              {batches.map((b) => (
                <div key={b.batchCode} className="flex flex-wrap justify-between gap-2 text-xs">
                  <span className="font-mono font-medium">{b.batchCode}</span>
                  <span className="text-[#635647]">
                    {b.productionDate} → {b.expiryDate}
                  </span>
                </div>
              ))}
            </div>
          </form>

          <form
            onSubmit={handleSaveCoupon}
            className="space-y-4 rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6"
          >
            <h2 className="font-display text-lg font-semibold">Promo Coupons</h2>
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
              <div>
                <label className="text-[#635647]">Code</label>
                <input
                  type="text"
                  value={couponDraft.code}
                  onChange={(e) =>
                    setCouponDraft({ ...couponDraft, code: e.target.value.toUpperCase() })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-3 py-2 font-mono text-base sm:text-xs"
                />
              </div>
              <div>
                <label className="text-[#635647]">Discount %</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={couponDraft.discountPct}
                  onChange={(e) =>
                    setCouponDraft({ ...couponDraft, discountPct: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-3 py-2 font-mono text-base sm:text-xs"
                />
              </div>
              <div>
                <label className="text-[#635647]">Min Subtotal (৳)</label>
                <input
                  type="number"
                  min={0}
                  value={couponDraft.minSubtotalBdt}
                  onChange={(e) =>
                    setCouponDraft({
                      ...couponDraft,
                      minSubtotalBdt: Number(e.target.value),
                    })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-3 py-2 font-mono text-base sm:text-xs"
                />
              </div>
              <div>
                <label className="text-[#635647]">Expires At (ISO, optional)</label>
                <input
                  type="text"
                  value={couponDraft.expiresAt || ''}
                  onChange={(e) =>
                    setCouponDraft({ ...couponDraft, expiresAt: e.target.value })
                  }
                  placeholder="2027-12-31T23:59:59Z"
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-3 py-2 font-mono text-base sm:text-xs"
                />
              </div>
              <div>
                <label className="text-[#635647]">Max Uses (0 = unlimited)</label>
                <input
                  type="number"
                  min={0}
                  value={couponDraft.maxUses ?? 0}
                  onChange={(e) =>
                    setCouponDraft({ ...couponDraft, maxUses: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded border border-[rgba(30,23,16,0.18)] px-3 py-2 font-mono text-base sm:text-xs"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs text-[#635647]">
                  <input
                    type="checkbox"
                    checked={Boolean(couponDraft.stackableWithAdvance)}
                    onChange={(e) =>
                      setCouponDraft({
                        ...couponDraft,
                        stackableWithAdvance: e.target.checked,
                      })
                    }
                  />
                  <span>Stack with Advance MFS %</span>
                </label>
              </div>
            </div>
            <button
              type="submit"
              className="min-h-[42px] rounded-lg bg-[#B47B2B] px-5 py-2.5 text-xs font-medium text-[#FFFDF9]"
            >
              Save Coupon Code
            </button>

            <div className="border-t border-[rgba(30,23,16,0.10)] pt-4 space-y-2">
              {coupons.map((c) => (
                <div
                  key={c.code}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#FAF7F2] px-3 py-2 text-xs"
                >
                  <span className="font-mono font-semibold">{c.code}</span>
                  <span>
                    {c.discountPct}% off · Min {formatBdt(c.minSubtotalBdt)}
                    {c.maxUses ? ` · ${c.usedCount || 0}/${c.maxUses} used` : ''}
                    {c.expiresAt ? ` · Exp ${c.expiresAt.slice(0, 10)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </form>
        </div>
      )}

      {/* TAB 5: REVIEWS MODERATION & SUBSCRIBERS */}
      {tab === 'reviews' && (
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            <h2 className="font-display text-lg font-semibold">
              Customer Review Moderation Queue
            </h2>
            {reviews.map((rev) => (
              <div
                key={rev.id}
                className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">
                      {rev.customerName} ·{' '}
                      <span className="text-[#635647]">{rev.district}</span>
                    </p>
                    <p className="font-mono text-xs text-[#8A5A17]">
                      Rating: {rev.rating}/5 · Status: {rev.status.toUpperCase()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await moderateAdminReview(rev.id, 'approved', true);
                        setReviews((prev) =>
                          prev.map((r) =>
                            r.id === rev.id
                              ? { ...r, status: 'approved', verifiedPurchase: true }
                              : r
                          )
                        );
                      }}
                      className="rounded-lg bg-[#1E1710] px-3 py-1.5 text-xs font-medium text-[#FAF7F2]"
                    >
                      Approve &amp; Verify
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await moderateAdminReview(rev.id, 'rejected', rev.verifiedPurchase);
                        setReviews((prev) =>
                          prev.map((r) =>
                            r.id === rev.id ? { ...r, status: 'rejected' } : r
                          )
                        );
                      }}
                      className="rounded-lg border border-[rgba(30,23,16,0.2)] px-3 py-1.5 text-xs"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteAdminReview(rev.id);
                        setReviews((prev) => prev.filter((r) => r.id !== rev.id));
                      }}
                      aria-label="Delete review"
                      className="p-1.5 text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-sm text-[#1E1710]">{rev.comment}</p>
              </div>
            ))}
            {reviews.length === 0 && (
              <p className="text-sm text-[#635647]">No customer reviews submitted yet.</p>
            )}
          </div>

          <div className="space-y-6 lg:col-span-4">
            <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
                  <BellRing className="h-4 w-4 text-[#B47B2B]" />
                  <span>Refill Reminders ({refillReminders.length})</span>
                </h2>
                <span className="font-mono text-xs tabular-nums text-[#8A5A17]">
                  {refillDueCount} due
                </span>
              </div>
              <p className="mt-1 text-xs text-[#635647]">
                Opt-in customer refill schedules. Dispatch triggers configured WhatsApp/Email
                webhooks and advances the next due date.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={refillDispatchBusy}
                  onClick={() => handleDispatchRefillQueue(true)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.2)] bg-[#FAF7F2] px-3 py-1.5 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
                >
                  <span>Preview Due</span>
                </button>
                <button
                  type="button"
                  disabled={refillDispatchBusy || refillDueCount === 0}
                  onClick={() => handleDispatchRefillQueue(false)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#B47B2B] px-3 py-1.5 text-xs font-medium text-[#FFFDF9] hover:bg-[#96621B] disabled:opacity-50"
                >
                  {refillDispatchBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  <span>Dispatch Due ({refillDueCount})</span>
                </button>
              </div>
              {refillDispatchReport && (
                <p className="mt-2.5 text-xs font-medium text-[#8A5A17]">
                  {refillDispatchReport}
                </p>
              )}
              <ul className="mt-4 max-h-64 divide-y divide-[rgba(30,23,16,0.08)] overflow-y-auto text-xs">
                {refillReminders.map((r) => {
                  const isDue =
                    r.status === 'active' &&
                    Number.isFinite(Date.parse(r.nextReminderAtIso)) &&
                    Date.parse(r.nextReminderAtIso) <= Date.now();
                  return (
                    <li key={r.id} className="py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-[#1E1710]">
                          {r.orderNumber} · {r.weight || '500g'}
                        </span>
                        <span
                          className={`font-mono text-[10.5px] uppercase ${
                            isDue ? 'font-semibold text-amber-800' : 'text-[#635647]'
                          }`}
                        >
                          {isDue ? 'due now' : r.status}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[#635647]">
                        Every {r.intervalDays}d · Next{' '}
                        {new Date(r.nextReminderAtIso).toLocaleDateString()} · Sent{' '}
                        {r.reminderCount || 0}×
                      </p>
                    </li>
                  );
                })}
                {refillReminders.length === 0 && (
                  <li className="py-4 text-[#635647]">
                    No opt-in refill reminders scheduled yet.
                  </li>
                )}
              </ul>
            </div>

            <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6">
              <h2 className="font-display text-lg font-semibold">
                Newsletter Subscribers ({subscribers.length})
              </h2>
              <ul className="mt-4 divide-y divide-[rgba(30,23,16,0.08)] text-xs">
                {subscribers.map((s) => (
                  <li key={s.id} className="flex justify-between py-2.5">
                    <span>{s.email}</span>
                    <span className="uppercase text-[#635647]">{s.lang}</span>
                  </li>
                ))}
                {subscribers.length === 0 && (
                  <li className="py-4 text-[#635647]">No subscribers yet.</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: AI CHATBOT MANAGEMENT STUDIO */}
      {tab === 'chatbot' && (
        <AdminChatbotPanel
          settings={settings}
          onPublishedConfig={(cfg) => setChatbotConfig(cfg)}
        />
      )}
      </section>
    </div>
  );
}
