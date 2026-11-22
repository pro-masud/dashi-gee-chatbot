'use client';

import { ComponentType, FormEvent, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  BellRing,
  Bot,
  Check,
  CheckCircle2,
  ClipboardList,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  LayoutDashboard,
  Landmark,
  Loader2,
  PhoneCall,
  LogOut,
  Menu,
  Plug,
  Printer,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Ticket,
  Trash2,
  Truck,
  UserCog,
  Wallet,
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
import type { CollectionStatus, CourierPartner, SettlementStatus } from '../lib/storeTypes';
import { buildOrdersCsv } from '../lib/chatbot/supportEngine';
import type { RefillReminderDoc } from '../lib/chatbot/types';
import { formatBdt } from '../data/deshiGeeData';
import { AdminChatbotPanel } from './AdminChatbotPanel';
import { AdminEcosystemPanel } from './AdminEcosystemPanel';
import { HelpInfoButton } from './admin/AdminHelpModal';
import { ActivityLogPanel } from './admin/ActivityLogPanel';
import { CodSettlementPanel } from './admin/CodSettlementPanel';
import { LeadsPanel } from './admin/LeadsPanel';
import { StaffRolesPanel } from './admin/StaffRolesPanel';
import type { Permission } from '../lib/auth/permissions';
import { ProfitExpensesPanel } from './admin/ProfitExpensesPanel';
import {
  COLLECTION_LABELS,
  COLLECTION_STATUSES,
  ORDER_STATUS_LABELS,
  SETTLEMENT_LABELS,
  SETTLEMENT_STATUSES,
  allowedNextStatuses,
} from '../lib/orders/pipeline';
import { StorefrontImpactPreview } from './admin/StorefrontImpactPreview';
import {
  Card,
  EmptyState,
  FilterChip,
  KpiCard,
  NumberField,
  PageHeader,
  StatusBadge,
  TextField,
  ToggleField,
} from './admin/ui';
import { useStorefront } from './StorefrontProvider';

interface AdminDashboardViewProps {
  settings: StoreSettingsDoc;
  onSettingsUpdated: (next: StoreSettingsDoc) => void;
  onBackHome: () => void;
}

type OrderFilterKey =
  | 'all'
  | 'pending'
  | 'confirmed'
  | 'packaging'
  | 'ready_to_ship'
  | 'in_transit'
  | 'delivered'
  | 'problem'
  | 'cancelled'
  | 'manual_review';

const ORDER_FILTER_GROUPS: Record<Exclude<OrderFilterKey, 'all' | 'manual_review'>, OrderStatus[]> = {
  pending: ['pending'],
  confirmed: ['confirmed'],
  packaging: ['packaging', 'processing'],
  ready_to_ship: ['ready_to_ship'],
  in_transit: ['sent_to_courier', 'shipped', 'out_for_delivery'],
  delivered: ['delivered'],
  problem: ['delivery_failed', 'returned'],
  cancelled: ['cancelled'],
};

/** Staff (non-owner) accounts are not in the client-side admin allowlist; the server decides. */
async function probeServerAdminAccess(u: User | null): Promise<boolean> {
  if (!u) return false;
  try {
    const token = await u.getIdToken();
    const res = await fetch('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.ok === true;
  } catch {
    return false;
  }
}

type AdminTab = 'overview' | 'orders' | 'finance' | 'cod' | 'leads' | 'staff' | 'activity' | 'store' | 'batches' | 'reviews' | 'chatbot' | 'ecosystem';

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
  const [statusFilter, setStatusFilter] = useState<OrderFilterKey>('all');
  const [myPerms, setMyPerms] = useState<Permission[] | null>(null);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineMsg, setPipelineMsg] = useState('');
  const [partialAmount, setPartialAmount] = useState('');
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
      const ok = (await checkIsAdminUser(u)) || (await probeServerAdminAccess(u));
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
      const idToken = user ? await user.getIdToken().catch(() => '') : '';

      // Who am I? (owner sees everything; staff only what their role allows)
      let perms: Permission[] | null = null;
      if (idToken) {
        try {
          const meRes = await fetch('/api/admin/me', { headers: { Authorization: `Bearer ${idToken}` } });
          const me = await meRes.json().catch(() => ({}));
          if (meRes.ok && me.ok && Array.isArray(me.permissions)) perms = me.permissions as Permission[];
        } catch {
          // fall through: treated as owner by the legacy client allowlist
        }
      }
      if (perms) setMyPerms(perms);
      const isOwner = !perms || perms.includes('staff.manage');

      // Orders: server API first (role-checked). Owners fall back to the legacy client read.
      let ordList: OrderRecord[] | null = null;
      if (idToken && (!perms || perms.includes('orders.view'))) {
        try {
          const res = await fetch('/api/admin/orders?limit=500', { headers: { Authorization: `Bearer ${idToken}` } });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.ok && Array.isArray(data.orders)) ordList = data.orders as OrderRecord[];
        } catch {
          ordList = null;
        }
      }
      if (!ordList && isOwner) ordList = await fetchAdminOrders();
      setOrders(ordList || []);

      if (isOwner) {
        const [revList, batchList, couponList, subList] = await Promise.all([
          fetchAdminReviews(),
          fetchAllBatches(),
          fetchAdminCoupons(),
          fetchAdminSubscribers(),
        ]);
        setReviews(revList);
        setBatches(batchList);
        setCoupons(couponList);
        setSubscribers(subList);

        const whRes = idToken
          ? await fetch('/api/notifications/status', {
              headers: { Authorization: `Bearer ${idToken}` },
            })
          : null;
        if (whRes?.ok) {
          setWebhookInfo(await whRes.json());
        }
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

  // Which sections may this person use? (Convenience only — every server API enforces it again.)
  useEffect(() => {
    if (!isAdmin || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data.ok && Array.isArray(data.permissions)) setMyPerms(data.permissions);
      } catch {
        // keep the default (menu shown); the server still enforces permissions
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, user]);

  const handleGoogleSignIn = async () => {
    setAuthError('');
    try {
      const u = await signInAdminWithGoogle();
      const ok = (await checkIsAdminUser(u)) || (await probeServerAdminAccess(u));
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

    const p250 = Number(draftSettings.price250g || 0);
    const p500 = Number(draftSettings.price500g || 0);
    const p1k = Number(draftSettings.price1kg || 0);

    if (p250 <= 0 || p500 <= 0 || p1k <= 0) {
      setSettingsSavedMsg(
        '২৫০ গ্রাম, ৫০০ গ্রাম ও ১ কেজির মূল্য অবশ্যই ০-এর বেশি হতে হবে। (Prices must be greater than 0).'
      );
      setSavingSettings(false);
      return;
    }

    try {
      const confirmedMap: Record<string, boolean> = {
        ...(draftSettings.ownerConfirmedFields || {}),
        price250g: p250 > 0,
        price500g: p500 > 0,
        price1kg: p1k > 0,
        stock250g: draftSettings.stock250g >= 0,
        stock500g: draftSettings.stock500g >= 0,
        stock1kg: draftSettings.stock1kg >= 0,
        insideDhakaFee: draftSettings.insideDhakaFee >= 0,
        outsideDhakaFee: draftSettings.outsideDhakaFee >= 0,
        dhakaSuburbanFee: (draftSettings.dhakaSuburbanFee ?? 0) >= 0,
        remoteDistrictFee: (draftSettings.remoteDistrictFee ?? 0) >= 0,
        freeDeliveryThreshold: draftSettings.freeDeliveryThreshold > 0,
      };
      const rawCutoff = draftSettings.dispatchCutoffHourBst;
      const sanitizedCutoff =
        typeof rawCutoff === 'number' && Number.isFinite(rawCutoff) && rawCutoff >= 1 && rawCutoff <= 23
          ? Math.round(rawCutoff)
          : undefined;

      const settingsToSave: StoreSettingsDoc = {
        ...draftSettings,
        price250g: p250,
        price500g: p500,
        price1kg: p1k,
        ownerConfirmedFields: confirmedMap,
      };
      if (sanitizedCutoff !== undefined) {
        settingsToSave.dispatchCutoffHourBst = sanitizedCutoff;
      } else {
        delete settingsToSave.dispatchCutoffHourBst;
      }
      await saveStoreSettings(settingsToSave);
      onSettingsUpdated(settingsToSave);
      setSettingsSavedMsg('Storefront pricing, stock, and delivery settings saved.');
    } catch (err) {
      let displayMsg = 'Failed to save store settings.';
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message) as { error?: string };
          displayMsg = parsed.error || err.message;
        } catch {
          displayMsg = err.message;
        }
      }
      setSettingsSavedMsg(displayMsg);
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

  const countGroup = (key: Exclude<OrderFilterKey, 'all' | 'manual_review'>) =>
    orders.filter((o) => ORDER_FILTER_GROUPS[key].includes(o.status)).length;

  /** Fulfilment / COD collection / settlement updates go through the server API (validated + audited). */
  const handleOrderPipelineUpdate = async (
    order: OrderRecord,
    patch: {
      status?: OrderStatus;
      collectionStatus?: CollectionStatus;
      collectedAmountBdt?: number;
      settlementStatus?: SettlementStatus;
    }
  ) => {
    if (!user || pipelineBusy) return;
    setPipelineBusy(true);
    setPipelineMsg('');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/orders/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ orderNumber: order.orderNumber, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setPipelineMsg(data.error || `Update failed (HTTP ${res.status}).`);
        return;
      }
      const updated = data.order as Partial<OrderRecord>;
      setOrders((prev) =>
        prev.map((o) => (o.orderNumber === order.orderNumber ? { ...o, ...updated } : o))
      );
      setSelectedOrder((cur) =>
        cur && cur.orderNumber === order.orderNumber ? { ...cur, ...updated } : cur
      );
      setPipelineMsg(data.stockRestored ? 'Saved. Stock was restored for the cancelled order.' : 'Saved.');
      setPartialAmount('');
      await loadOrderAuditLogs(order.orderNumber);
    } catch (err) {
      setPipelineMsg(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setPipelineBusy(false);
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
      } else if (statusFilter !== 'all' && !ORDER_FILTER_GROUPS[statusFilter].includes(o.status)) {
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

  const settingsDirty = JSON.stringify(draftSettings) !== JSON.stringify(settings);
  const pendingReviewCount = reviews.filter((r) => r.status === 'pending').length;
  const lowStockVariants = (
    [
      ['250g', settings.stock250g],
      ['500g', settings.stock500g],
      ['1kg', settings.stock1kg],
    ] as [string, number][]
  ).filter(([, stock]) => Number(stock) <= 10);

  type NavItem = {
    id: AdminTab;
    label: string;
    icon: ComponentType<{ className?: string }>;
    badge?: number;
    perm?: Permission;
    ownerOnly?: boolean;
  };
  const allNavGroups: { group: string; items: NavItem[] }[] = [
    {
      group: 'Operations',
      items: [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'orders', label: 'Orders', icon: ShoppingBag, badge: metrics.pending },
        { id: 'leads', label: 'Incomplete Leads', icon: PhoneCall, perm: 'leads.manage' },
        { id: 'finance', label: 'Profit & Expenses', icon: Wallet, perm: 'finance.view' },
        { id: 'cod', label: 'COD & Settlements', icon: Landmark, perm: 'cod.manage' },
      ],
    },
    {
      group: 'Catalog & Store',
      items: [
        { id: 'store', label: 'Pricing, Stock & Delivery', icon: SlidersHorizontal, ownerOnly: true },
        { id: 'batches', label: 'Batches & Coupons', icon: Ticket, ownerOnly: true },
        { id: 'reviews', label: 'Reviews & Subscribers', icon: Star, badge: pendingReviewCount, ownerOnly: true },
      ],
    },
    {
      group: 'Automation',
      items: [
        { id: 'chatbot', label: 'AI Chatbot', icon: Bot, ownerOnly: true },
        { id: 'ecosystem', label: 'Integrations & Alerts', icon: Plug, ownerOnly: true },
      ],
    },
    {
      group: 'System',
      items: [
        { id: 'staff', label: 'Staff & Roles', icon: UserCog, perm: 'staff.manage' },
        { id: 'activity', label: 'Activity Log', icon: ClipboardList, perm: 'logs.view' },
      ],
    },
  ];
  const adminNav = allNavGroups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          (!i.perm || myPerms === null || myPerms.includes(i.perm)) &&
          (!i.ownerOnly || myPerms === null || myPerms.includes('staff.manage'))
      ),
    }))
    .filter((g) => g.items.length > 0);
  const activeTabLabel =
    adminNav.flatMap((g) => g.items).find((t) => t.id === tab)?.label || 'Overview';

  const renderNav = (onNavigate?: () => void) => (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Admin sections">
      {adminNav.map((group) => (
        <div key={group.group}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#E8DFC5]/45">
            {group.group}
          </p>
          <div className="space-y-0.5">
            {group.items.map(({ id, label, icon: Icon, badge }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setTab(id);
                    onNavigate?.();
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={`group flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors ${
                    active
                      ? 'bg-[#B47B2B] text-[#FFFDF9] shadow-sm'
                      : 'text-[#E8DFC5]/80 hover:bg-[#FAF7F2]/10 hover:text-[#FAF7F2]'
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? '' : 'text-[#E5B25D]/80'}`} />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {typeof badge === 'number' && badge > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                        active ? 'bg-white/25 text-white' : 'bg-[#E5B25D]/20 text-[#E5B25D]'
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const renderNavFooter = (onNavigate?: () => void) => (
    <div className="space-y-1 border-t border-[#FAF7F2]/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="px-3 pb-2">
        <p className="truncate text-[11px] text-[#E8DFC5]/60">Signed in as</p>
        <p className="truncate text-xs font-medium text-[#FAF7F2]">{user.email}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          onBackHome();
        }}
        className="flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-[#E8DFC5]/80 hover:bg-[#FAF7F2]/10 hover:text-[#FAF7F2]"
      >
        <ArrowLeft className="h-4 w-4 text-[#E5B25D]/80" />
        <span>View storefront</span>
      </button>
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          signOutAdmin();
        }}
        className="flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-[#E8DFC5]/80 hover:bg-[#FAF7F2]/10 hover:text-[#FAF7F2]"
      >
        <LogOut className="h-4 w-4 text-[#E5B25D]/80" />
        <span>Sign out</span>
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#F6F2EA] text-[#1E1710]">
      {/* Desktop sidebar (>= 1024px) */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-[#1A120B] text-[#FAF7F2] lg:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-[#FAF7F2]/10 px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#B47B2B] font-display text-sm font-semibold text-[#FFFDF9]">
            DG
          </span>
          <div className="min-w-0">
            <p className="font-display truncate text-[15px] font-semibold leading-tight">
              Deshi Gee
            </p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#E5B25D]/80">
              Operations console
            </p>
          </div>
        </div>
        {renderNav()}
        {renderNavFooter()}
      </aside>

      {/* Mobile & tablet slide-over navigation (< 1024px) */}
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
            <div className="flex h-16 items-center justify-between border-b border-[#FAF7F2]/10 px-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#B47B2B] font-display text-sm font-semibold text-[#FFFDF9]">
                  DG
                </span>
                <p className="font-display text-[15px] font-semibold">Deshi Gee Admin</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close admin menu"
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[#FAF7F2] hover:bg-[#FAF7F2]/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {renderNav(() => setMobileNavOpen(false))}
            {renderNavFooter(() => setMobileNavOpen(false))}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="no-print sticky top-0 z-20 border-b border-[rgba(30,23,16,0.08)] bg-[#F6F2EA]/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-3 px-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open admin menu"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[rgba(30,23,16,0.14)] bg-white text-[#1E1710] hover:bg-[#F4EFE6] lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-medium text-[#635647]">
                  Admin <span className="mx-1 text-[#B9AD9C]">/</span>
                  <span className="font-semibold text-[#1E1710]">{activeTabLabel}</span>
                </h1>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {loadingData && (
                <span className="hidden items-center gap-1.5 text-xs text-[#635647] sm:inline-flex">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#B47B2B]" />
                  Syncing…
                </span>
              )}
              <button
                type="button"
                onClick={() => loadAdminWorkspace()}
                disabled={loadingData}
                aria-label="Refresh data"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.14)] bg-white px-3 text-xs font-medium text-[#1E1710] hover:bg-[#F4EFE6] disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-[#8A5A17] ${loadingData ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>
        </header>

      <section className="mx-auto min-h-[calc(100dvh-64px)] max-w-[1280px] px-4 py-6 sm:px-8 sm:py-8">

      {/* TAB 1: OVERVIEW */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <PageHeader
            title="Overview"
            description="Today's store health at a glance."
            actions={<HelpInfoButton section="overview" />}
          />

          {/* Needs attention */}
          {(metrics.manualReview > 0 ||
            lowStockVariants.length > 0 ||
            refillDueCount > 0 ||
            pendingReviewCount > 0) && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4" />
                Needs your attention
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {metrics.manualReview > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('manual_review');
                      setTab('orders');
                    }}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
                  >
                    {metrics.manualReview} order{metrics.manualReview > 1 ? 's' : ''} in risk review
                  </button>
                )}
                {lowStockVariants.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTab('store')}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
                  >
                    Low stock: {lowStockVariants.map(([w, s]) => `${w} (${s})`).join(', ')}
                  </button>
                )}
                {pendingReviewCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setTab('reviews')}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
                  >
                    {pendingReviewCount} review{pendingReviewCount > 1 ? 's' : ''} awaiting moderation
                  </button>
                )}
                {refillDueCount > 0 && (
                  <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
                    {refillDueCount} refill reminder{refillDueCount > 1 ? 's' : ''} due
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {(myPerms === null || myPerms.includes('finance.view')) && (
              <KpiCard
                label="Total sales"
                value={formatBdt(metrics.totalSales)}
                hint="Excludes cancelled orders"
                icon={Banknote}
                tone="green"
              />
            )}
            <KpiCard
              label="Total orders"
              value={metrics.total}
              hint={`${metrics.delivered} delivered`}
              icon={ShoppingBag}
              tone="blue"
            />
            <KpiCard
              label="Pending"
              value={metrics.pending}
              hint="Waiting for confirmation"
              icon={Clock}
              tone="amber"
            />
            <KpiCard
              label="Confirmed"
              value={metrics.confirmed}
              hint="Ready to dispatch"
              icon={CheckCircle2}
              tone="violet"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card
              title="Recent orders"
              description="Latest 6 orders"
              className="lg:col-span-2"
              bodyClassName="p-0"
              action={
                <button
                  type="button"
                  onClick={() => setTab('orders')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#8A5A17] hover:underline"
                >
                  View all
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              }
            >
              {orders.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No orders yet"
                    description="New orders from the storefront and chatbot will appear here."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-[rgba(30,23,16,0.06)]">
                  {orders.slice(0, 6).map((o) => (
                    <li key={o.orderNumber}>
                      <button
                        type="button"
                        onClick={() => {
                          setTab('orders');
                          setSelectedOrder(o);
                        }}
                        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-[#FAF7F2]"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-semibold">{o.orderNumber}</p>
                          <p className="truncate text-xs text-[#635647]">
                            {o.customerName} · {o.itemsSummary || `${o.weight} × ${o.qty}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="font-mono text-xs font-semibold tabular-nums">
                            {formatBdt(o.totalBdt)}
                          </span>
                          <StatusBadge status={o.status} />
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Order notifications"
              description="Owner webhook dispatch log"
            >
              <div className="space-y-2 text-xs">
                {webhookInfo?.recentLogs?.slice(0, 6).map((log, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-[rgba(30,23,16,0.08)] bg-[#FAF7F2] p-3"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono">
                      <span className="truncate">{log.orderNumber || 'Order'}</span>
                      <StatusBadge
                        status={log.status}
                        tone={log.status === 'sent' ? 'green' : log.status === 'failed' ? 'red' : 'neutral'}
                      />
                    </div>
                    <p className="mt-1 text-[#635647]">{log.detail}</p>
                  </div>
                ))}
                {(!webhookInfo || webhookInfo.recentLogs.length === 0) && (
                  <EmptyState
                    title="No dispatches yet"
                    description="Set OWNER_WEBHOOK_URL, GOOGLE_SHEETS_WEBHOOK_URL or WHATSAPP_WEBHOOK_URL on the server to get order alerts."
                  />
                )}
              </div>
            </Card>
          </div>
        </div>
      )}


      {/* TAB 2: ORDERS & PRINT RECEIPT */}
      {tab === 'orders' && (
        <div className="space-y-5">
          <PageHeader
            title="Orders"
            description="Search, filter and manage customer orders."
            actions={
              <>
                <HelpInfoButton section="orders" />
                <button
                  type="button"
                  onClick={handleExportOrdersCsv}
                  disabled={filteredOrders.length === 0}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.14)] bg-white px-3.5 text-xs font-medium text-[#1E1710] hover:bg-[#F4EFE6] disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5 text-[#8A5A17]" />
                  <span>Export CSV ({filteredOrders.length})</span>
                </button>
              </>
            }
          />

          <div className="no-print space-y-3">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A7867]" />
              <input
                type="search"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                placeholder="Search order ID, phone or customer"
                aria-label="Search orders"
                className="min-h-[42px] w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white pl-9 pr-3 text-base text-[#1E1710] placeholder:text-[#8A7867] focus:border-[#B47B2B] focus:outline-none focus:ring-2 focus:ring-[#B47B2B]/20 sm:text-sm"
              />
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
              {(
                [
                  ['all', 'All', orders.length],
                  ['pending', 'Pending', metrics.pending],
                  ['confirmed', 'Confirmed', metrics.confirmed],
                  ['packaging', 'Packaging', countGroup('packaging')],
                  ['ready_to_ship', 'Ready to ship', countGroup('ready_to_ship')],
                  ['in_transit', 'With courier', countGroup('in_transit')],
                  ['delivered', 'Delivered', metrics.delivered],
                  ['problem', 'Failed / returned', countGroup('problem')],
                  ['cancelled', 'Cancelled', countGroup('cancelled')],
                  ['manual_review', 'Risk review', metrics.manualReview],
                ] as [typeof statusFilter, string, number][]
              ).map(([value, label, count]) => (
                <FilterChip
                  key={value}
                  active={statusFilter === value}
                  onClick={() => setStatusFilter(value)}
                  count={count}
                >
                  {label}
                </FilterChip>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div
              className={`no-print overflow-hidden rounded-2xl border border-[rgba(30,23,16,0.08)] bg-white shadow-[0_1px_2px_rgba(30,23,16,0.04)] ${
                selectedOrder ? 'lg:col-span-7' : 'lg:col-span-12'
              }`}
            >
              {filteredOrders.length > 0 && (
                <div className="hidden grid-cols-[1.4fr_1fr_auto] gap-4 border-b border-[rgba(30,23,16,0.06)] bg-[#FAF7F2] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#8A7867] md:grid">
                  <span>Order</span>
                  <span>Status</span>
                  <span className="text-right">Total</span>
                </div>
              )}
              <ul className="divide-y divide-[rgba(30,23,16,0.06)]">
                {filteredOrders.map((order) => {
                  const isSelected = selectedOrder?.orderNumber === order.orderNumber;
                  return (
                    <li key={order.orderNumber}>
                      <button
                        type="button"
                        onClick={() => setSelectedOrder(order)}
                        aria-current={isSelected ? 'true' : undefined}
                        className={`grid w-full cursor-pointer grid-cols-[1fr_auto] gap-x-4 gap-y-2 px-5 py-3.5 text-left transition-colors md:grid-cols-[1.4fr_1fr_auto] md:items-center ${
                          isSelected ? 'bg-[#F4EFE6]' : 'hover:bg-[#FAF7F2]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-semibold">
                              {order.orderNumber}
                            </span>
                            {order.reviewStatus === 'manual_review' && (
                              <StatusBadge
                                status="manual_review"
                                label={`Risk ${order.riskScore ?? 0}`}
                              />
                            )}
                            {order.duplicateWarning && (
                              <StatusBadge status="duplicate" label="Duplicate?" tone="amber" />
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-[#635647]">
                            {order.customerName} · {order.phone} · {order.district}
                          </p>
                        </div>
                        <span className="text-right font-mono text-sm font-semibold tabular-nums text-[#1E1710] md:order-3">
                          {formatBdt(order.totalBdt)}
                        </span>
                        <div className="col-span-2 flex flex-wrap items-center gap-1.5 md:col-span-1 md:order-2">
                          <StatusBadge status={order.status} label={ORDER_STATUS_LABELS[order.status]} />
                          {order.status === 'delivered' && order.paymentMethod === 'cod' && (
                            <StatusBadge
                              status={order.collectionStatus || 'awaiting'}
                              label={COLLECTION_LABELS[order.collectionStatus || 'awaiting']}
                            />
                          )}
                          <StatusBadge
                            status={order.paymentStatus}
                            label={
                              order.paymentStatus === 'cod_due'
                                ? 'COD due'
                                : `${order.paymentMethod.toUpperCase()} · ${order.paymentStatus.replace(/_/g, ' ')}`
                            }
                          />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {filteredOrders.length === 0 && (
                <div className="p-5">
                  <EmptyState
                    title="No matching orders"
                    description="Try a different search or clear the status filter."
                  />
                </div>
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
                      Fulfilment status
                    </label>
                    <select
                      value={selectedOrder.status}
                      disabled={pipelineBusy}
                      onChange={(e) =>
                        handleOrderPipelineUpdate(selectedOrder, { status: e.target.value as OrderStatus })
                      }
                      className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-3 py-2 text-base disabled:opacity-60 sm:text-xs"
                    >
                      <option value={selectedOrder.status}>{ORDER_STATUS_LABELS[selectedOrder.status]} (current)</option>
                      {allowedNextStatuses(selectedOrder.status).map((s) => (
                        <option key={s} value={s}>
                          → {ORDER_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                    {allowedNextStatuses(selectedOrder.status).length === 0 && (
                      <p className="mt-1 text-[11px] text-[#8A7867]">
                        This order is in a final state and cannot change status.
                      </p>
                    )}
                  </div>

                  {selectedOrder.paymentMethod === 'cod' &&
                    ['delivered', 'delivery_failed', 'returned'].includes(selectedOrder.status) && (
                      <div className="space-y-2.5 rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FAF7F2] p-3 text-xs">
                        <p className="font-semibold text-[#1E1710]">COD cash tracking</p>
                        <p className="text-[11px] text-[#635647]">
                          Delivered does not mean the cash reached you. Mark what the courier actually collected and paid out.
                        </p>
                        <div>
                          <label className="block text-[11px] text-[#635647]">Collection status</label>
                          <select
                            value={selectedOrder.collectionStatus || 'awaiting'}
                            disabled={pipelineBusy}
                            onChange={(e) => {
                              const next = e.target.value as CollectionStatus;
                              if (next === 'partial') {
                                const amt = Number(window.prompt('Amount collected so far (BDT)?', partialAmount || ''));
                                if (!Number.isFinite(amt) || amt <= 0) return;
                                void handleOrderPipelineUpdate(selectedOrder, { collectionStatus: next, collectedAmountBdt: amt });
                              } else {
                                void handleOrderPipelineUpdate(selectedOrder, { collectionStatus: next });
                              }
                            }}
                            className="mt-0.5 w-full rounded border border-[rgba(30,23,16,0.18)] bg-white px-2.5 py-1.5 text-base disabled:opacity-60 sm:text-xs"
                          >
                            {COLLECTION_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {COLLECTION_LABELS[s]}
                              </option>
                            ))}
                          </select>
                          {typeof selectedOrder.collectedAmountBdt === 'number' && selectedOrder.collectedAmountBdt > 0 && (
                            <p className="mt-1 font-mono text-[11px] text-[#8A5A17]">
                              Collected {formatBdt(selectedOrder.collectedAmountBdt)} of {formatBdt(selectedOrder.totalBdt)}
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="block text-[11px] text-[#635647]">Settlement from courier</label>
                          <select
                            value={selectedOrder.settlementStatus || 'pending'}
                            disabled={pipelineBusy}
                            onChange={(e) =>
                              handleOrderPipelineUpdate(selectedOrder, {
                                settlementStatus: e.target.value as SettlementStatus,
                              })
                            }
                            className="mt-0.5 w-full rounded border border-[rgba(30,23,16,0.18)] bg-white px-2.5 py-1.5 text-base disabled:opacity-60 sm:text-xs"
                          >
                            {SETTLEMENT_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {SETTLEMENT_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                  {pipelineMsg && (
                    <p role="status" className="text-[11px] font-medium text-[#8A5A17]">
                      {pipelineMsg}
                    </p>
                  )}

                  {selectedOrder.paymentMethod !== 'cod' && (
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
                  )}

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

      {tab === 'leads' && (
        <LeadsPanel getIdToken={async () => (user ? user.getIdToken() : '')} />
      )}

      {tab === 'staff' && (
        <StaffRolesPanel getIdToken={async () => (user ? user.getIdToken() : '')} />
      )}

      {tab === 'activity' && (
        <ActivityLogPanel getIdToken={async () => (user ? user.getIdToken() : '')} />
      )}

      {/* TAB: COD COLLECTION & SETTLEMENTS */}
      {tab === 'cod' && (
        <CodSettlementPanel getIdToken={async () => (user ? user.getIdToken() : '')} />
      )}

      {/* TAB: PROFIT & EXPENSES */}
      {tab === 'finance' && (
        <ProfitExpensesPanel getIdToken={async () => (user ? user.getIdToken() : '')} />
      )}

      {/* TAB 3: STORE, STOCK, DELIVERY & CONTACT CONFIG */}
      {tab === 'store' && (
        <form onSubmit={handleSaveSettings} className="space-y-6 pb-24">
          <PageHeader
            title="Pricing, stock & delivery"
            description="Everything customers see about price, availability, delivery and how to reach you."
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card
              title="Jar pricing & stock"
              description="One product, three sizes."
              action={<HelpInfoButton section="store_pricing_stock" />}
              bodyClassName="space-y-3 p-5"
            >
              {(['250g', '500g', '1kg'] as const).map((w) => {
                const priceKey = w === '250g' ? 'price250g' : w === '500g' ? 'price500g' : 'price1kg';
                const stockKey = w === '250g' ? 'stock250g' : w === '500g' ? 'stock500g' : 'stock1kg';
                const stock = Number(draftSettings[stockKey]);
                return (
                  <div
                    key={w}
                    className="rounded-xl border border-[rgba(30,23,16,0.08)] bg-[#FAF7F2] p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold">{w} jar</span>
                      {stock <= 10 && (
                        <StatusBadge
                          status={stock === 0 ? 'failed' : 'pending'}
                          label={stock === 0 ? 'Out of stock' : 'Low stock'}
                        />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <NumberField
                        label="Price"
                        prefix="৳"
                        min={1}
                        value={draftSettings[priceKey]}
                        onChange={(n) => setDraftSettings({ ...draftSettings, [priceKey]: n })}
                      />
                      <NumberField
                        label="Stock (jars)"
                        value={draftSettings[stockKey]}
                        onChange={(n) => setDraftSettings({ ...draftSettings, [stockKey]: n })}
                      />
                    </div>
                  </div>
                );
              })}
            </Card>

            <Card
              title="Delivery fees & timing"
              description="Four delivery zones across Bangladesh."
              action={<HelpInfoButton section="store_delivery_payments" />}
              bodyClassName="space-y-4 p-5"
            >
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Dhaka city"
                  prefix="৳"
                  value={draftSettings.insideDhakaFee}
                  onChange={(n) => setDraftSettings({ ...draftSettings, insideDhakaFee: n })}
                />
                <NumberField
                  label="Dhaka suburban"
                  prefix="৳"
                  value={draftSettings.dhakaSuburbanFee ?? 0}
                  onChange={(n) => setDraftSettings({ ...draftSettings, dhakaSuburbanFee: n })}
                />
                <NumberField
                  label="Nationwide"
                  prefix="৳"
                  value={draftSettings.outsideDhakaFee}
                  onChange={(n) => setDraftSettings({ ...draftSettings, outsideDhakaFee: n })}
                />
                <NumberField
                  label="Remote districts"
                  prefix="৳"
                  value={draftSettings.remoteDistrictFee ?? 0}
                  onChange={(n) => setDraftSettings({ ...draftSettings, remoteDistrictFee: n })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Suburban delivery time"
                  placeholder="Not set"
                  value={draftSettings.estimatedSuburbanDays ?? ''}
                  onChange={(v) => setDraftSettings({ ...draftSettings, estimatedSuburbanDays: v })}
                />
                <TextField
                  label="Remote delivery time"
                  placeholder="Not set"
                  value={draftSettings.estimatedRemoteDays ?? ''}
                  onChange={(v) => setDraftSettings({ ...draftSettings, estimatedRemoteDays: v })}
                />
                <NumberField
                  label="Dispatch cut-off hour"
                  hint="(BST 0–23, 0 = not set)"
                  max={23}
                  value={draftSettings.dispatchCutoffHourBst ?? 0}
                  onChange={(n) => setDraftSettings({ ...draftSettings, dispatchCutoffHourBst: n })}
                />
                <NumberField
                  label="Free delivery from"
                  prefix="৳"
                  value={draftSettings.freeDeliveryThreshold}
                  onChange={(n) => setDraftSettings({ ...draftSettings, freeDeliveryThreshold: n })}
                />
              </div>
            </Card>

            <Card
              title="Payments & COD"
              description="Manual mobile-banking numbers and COD safety checks."
              bodyClassName="space-y-4 p-5"
            >
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="bKash number"
                  mono
                  value={draftSettings.bkashNumber}
                  onChange={(v) => setDraftSettings({ ...draftSettings, bkashNumber: v })}
                />
                <TextField
                  label="Nagad number"
                  mono
                  value={draftSettings.nagadNumber}
                  onChange={(v) => setDraftSettings({ ...draftSettings, nagadNumber: v })}
                />
                <NumberField
                  label="Advance payment discount"
                  hint="(%)"
                  max={25}
                  value={draftSettings.advanceDiscountPct}
                  onChange={(n) => setDraftSettings({ ...draftSettings, advanceDiscountPct: n })}
                />
                <NumberField
                  label="High-value COD flag"
                  hint="(৳, 0 = not set)"
                  value={draftSettings.codHighValueThresholdBdt ?? 0}
                  onChange={(n) => setDraftSettings({ ...draftSettings, codHighValueThresholdBdt: n })}
                />
              </div>
              <ToggleField
                label="COD phone confirmation"
                description="SMS provider is not configured, so confirmation stays manual."
                checked={Boolean(draftSettings.codConfirmEnabled)}
                onChange={(v) => setDraftSettings({ ...draftSettings, codConfirmEnabled: v })}
              />
            </Card>

            <Card
              title="Contact & origin"
              description="Shown on the storefront and used by the chatbot."
              action={<HelpInfoButton section="store_contact_social" />}
              bodyClassName="space-y-4 p-5"
            >
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="WhatsApp number"
                  mono
                  value={draftSettings.whatsappNumber}
                  onChange={(v) => setDraftSettings({ ...draftSettings, whatsappNumber: v })}
                />
                <TextField
                  label="Support phone"
                  mono
                  value={draftSettings.supportPhone}
                  onChange={(v) => setDraftSettings({ ...draftSettings, supportPhone: v })}
                />
              </div>
              <TextField
                label="Support email"
                type="email"
                value={draftSettings.supportEmail}
                onChange={(v) => setDraftSettings({ ...draftSettings, supportEmail: v })}
              />
              <TextField
                label="Business address"
                value={draftSettings.businessAddress}
                onChange={(v) => setDraftSettings({ ...draftSettings, businessAddress: v })}
              />
              <TextField
                label="Active batch code"
                mono
                value={draftSettings.activeBatchCode}
                onChange={(v) =>
                  setDraftSettings({ ...draftSettings, activeBatchCode: v.toUpperCase() })
                }
              />
            </Card>
          </div>

          <StorefrontImpactPreview
            savedSettings={settings}
            draftSettings={draftSettings}
            onResetDraft={() => setDraftSettings(settings)}
          />

          {/* Sticky save bar */}
          <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-[rgba(30,23,16,0.1)] bg-white/95 backdrop-blur lg:left-64">
            <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 py-3 sm:px-8">
              <p
                role="status"
                className={`min-w-0 truncate text-xs font-medium ${
                  settingsDirty ? 'text-amber-800' : settingsSavedMsg ? 'text-[#8A5A17]' : 'text-[#8A7867]'
                }`}
              >
                {settingsDirty ? 'You have unsaved changes' : settingsSavedMsg || 'All changes saved'}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={!settingsDirty || savingSettings}
                  onClick={() => {
                    setDraftSettings(settings);
                    setSettingsSavedMsg('');
                  }}
                  className="min-h-[40px] rounded-lg border border-[rgba(30,23,16,0.14)] bg-white px-4 text-xs font-medium text-[#1E1710] hover:bg-[#F4EFE6] disabled:opacity-50"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={savingSettings || !settingsDirty}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#B47B2B] px-5 text-sm font-medium text-[#FFFDF9] hover:bg-[#96621B] disabled:opacity-50"
                >
                  {savingSettings ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  <span>Save changes</span>
                </button>
              </div>
            </div>
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
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">
                Batch Provenance &amp; Lab Record
              </h2>
              <HelpInfoButton section="batches" />
            </div>
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
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">Promo Coupons</h2>
              <HelpInfoButton section="coupons" />
            </div>
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
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">
                Customer Review Moderation Queue
              </h2>
              <HelpInfoButton section="reviews" />
            </div>
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
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs tabular-nums text-[#8A5A17]">
                    {refillDueCount} due
                  </span>
                  <HelpInfoButton section="refill_reminders" />
                </div>
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
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-semibold">
                  Newsletter Subscribers ({subscribers.length})
                </h2>
                <HelpInfoButton section="subscribers" />
              </div>
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

      {/* TAB 7: INTEGRATIONS & NOTIFICATION ECOSYSTEM */}
      {tab === 'ecosystem' && (
        <AdminEcosystemPanel
          getIdToken={async () => (user ? user.getIdToken() : '')}
          onOpenChatbot={() => setTab('chatbot')}
          orderMetrics={{
            total: metrics.total,
            pending: metrics.pending,
            totalSales: metrics.totalSales,
          }}
        />
      )}
      </section>
      </div>
    </div>
  );
}
