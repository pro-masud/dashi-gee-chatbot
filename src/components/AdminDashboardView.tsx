'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  ArrowLeft,
  Check,
  Loader2,
  LogOut,
  Printer,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  BatchRecord,
  CouponRecord,
  DEFAULT_ACTIVE_BATCH,
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
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);

  // Editable Store Config Form
  const [draftSettings, setDraftSettings] = useState<StoreSettingsDoc>(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState('');

  // New Batch Form
  const [batchDraft, setBatchDraft] = useState<BatchRecord>(DEFAULT_ACTIVE_BATCH);
  const [couponDraft, setCouponDraft] = useState<CouponRecord>({
    code: 'DESHI10',
    discountPct: 10,
    minSubtotalBdt: 1000,
    active: true,
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

      const whRes = await fetch('/api/notifications/status');
      if (whRes.ok) {
        setWebhookInfo(await whRes.json());
      }
    } catch (err) {
      console.error('Failed loading admin workspace:', err);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadAdminWorkspace();
    }
  }, [isAdmin]);

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
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
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
    return { total: orders.length, pending, confirmed, delivered, totalSales };
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

  return (
    <section className="mx-auto min-h-[85vh] max-w-[1320px] px-4 py-8 sm:px-8 sm:py-10">
      {/* Admin Top Header */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4 border-b border-[rgba(30,23,16,0.12)] pb-5 sm:pb-6">
        <div>
          <button
            type="button"
            onClick={onBackHome}
            className="inline-flex min-h-[40px] items-center gap-1.5 text-xs font-medium text-[#635647] hover:text-[#1E1710]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Storefront</span>
          </button>
          <h1 className="font-display mt-1 text-2xl font-semibold text-[#1E1710] sm:text-3xl">
            Deshi Gee Operations
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="max-w-[200px] truncate text-xs text-[#635647] sm:max-w-none">
            {user.email}
          </span>
          <button
            type="button"
            onClick={() => signOutAdmin()}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.2)] px-3.5 py-2 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="no-print mt-5 flex gap-2 overflow-x-auto pb-1 sm:mt-6 sm:flex-wrap sm:overflow-visible sm:pb-0">
        {(
          [
            ['overview', 'Overview'],
            ['orders', `Orders (${orders.length})`],
            ['store', 'Product, Stock & Delivery'],
            ['batches', 'Batches & Coupons'],
            ['reviews', `Reviews (${reviews.length}) & Subscribers`],
            ['chatbot', 'AI Chatbot'],
          ] as [AdminTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-[40px] shrink-0 rounded-lg px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              tab === id
                ? 'bg-[#1E1710] text-[#FAF7F2]'
                : 'border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] text-[#635647] hover:text-[#1E1710]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loadingData && (
        <div className="mt-6 flex items-center gap-2 text-xs text-[#635647]">
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
              onChange={(e) => setStatusFilter(e.target.value as 'all' | OrderStatus)}
              className="min-h-[42px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-2 text-base sm:w-auto sm:text-sm"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="processing">Processing</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="no-print space-y-3 lg:col-span-7">
              {filteredOrders.map((order) => (
                <div
                  key={order.orderNumber}
                  onClick={() => setSelectedOrder(order)}
                  className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                    selectedOrder?.orderNumber === order.orderNumber
                      ? 'border-[#B47B2B] bg-[#F2ECE1]'
                      : 'border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] hover:bg-[#FAF7F2]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold">
                      {order.orderNumber}
                    </span>
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
                </div>
              ))}
              {filteredOrders.length === 0 && (
                <p className="text-sm text-[#635647]">No matching orders found.</p>
              )}
            </div>

            {selectedOrder && (
              <div className="rounded-2xl border border-[rgba(30,23,16,0.14)] bg-[#FFFDF9] p-6 lg:col-span-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono text-xs uppercase text-[#8A5A17]">
                      Order Receipt &amp; Controls
                    </p>
                    <h3 className="font-display mt-1 text-2xl font-semibold">
                      {selectedOrder.orderNumber}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="no-print inline-flex items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.2)] px-3 py-1.5 text-xs font-medium hover:bg-[#F2ECE1]"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>Print Receipt</span>
                  </button>
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
                <label className="block text-xs text-[#635647]">Inside Dhaka (৳)</label>
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
                <label className="block text-xs text-[#635647]">Outside Dhaka (৳)</label>
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
                  className="flex items-center justify-between rounded-lg bg-[#FAF7F2] px-3 py-2 text-xs"
                >
                  <span className="font-mono font-semibold">{c.code}</span>
                  <span>
                    {c.discountPct}% off · Min {formatBdt(c.minSubtotalBdt)}
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

          <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6 lg:col-span-4">
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
      )}

      {/* TAB 6: AI CHATBOT MANAGEMENT STUDIO */}
      {tab === 'chatbot' && (
        <AdminChatbotPanel
          settings={settings}
          onPublishedConfig={(cfg) => setChatbotConfig(cfg)}
        />
      )}
    </section>
  );
}
