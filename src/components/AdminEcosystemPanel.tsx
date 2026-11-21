'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Hash,
  KeyRound,
  Loader2,
  Mail,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Truck,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  BUSINESS_EVENT_TYPES,
  DEFAULT_INTEGRATION_SETTINGS,
  DEFAULT_NOTIFICATION_RULES,
  DISCORD_CHANNEL_KEYS,
  type BusinessEventType,
  type DiscordChannelKey,
  type IntegrationSettingsDoc,
  type NotificationJobDoc,
  type NotificationLogDoc,
  type NotificationRulesDoc,
} from '../lib/notifications/types';
import { HelpInfoButton } from './admin/AdminHelpModal';
import { BackendDiagnosticsSuite } from './admin/BackendDiagnosticsSuite';
import { NotificationTemplatesEditor } from './admin/NotificationTemplatesEditor';

interface TelegramReadiness {
  configured: boolean;
  hasBotToken: boolean;
  chatIdCount: number;
  maskedChatIds: string[];
}

interface DiscordChannelReadiness {
  channelKey: DiscordChannelKey;
  label: string;
  configured: boolean;
  usesDedicatedWebhook: boolean;
}

interface DiscordReadiness {
  configured: boolean;
  defaultWebhookConfigured: boolean;
  channels: DiscordChannelReadiness[];
}

interface WhatsAppReadiness {
  configured: boolean;
  hasAccessToken: boolean;
  hasPhoneNumberId: boolean;
  hasBusinessAccountId: boolean;
  hasVerifyToken: boolean;
  hasAppSecret: boolean;
}

interface AiReadiness {
  configured: boolean;
  provider: string;
  model: string;
  hasApiKey: boolean;
}

interface MetaReadiness {
  configured: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
  hasPageAccessToken: boolean;
  webhookPath: string;
}

interface PaymentReadiness {
  sslcommerz: { configured: boolean; liveMode: boolean };
  bkash: { configured: boolean; liveMode: boolean };
  anyConfigured: boolean;
  callbackPath: string;
}

interface CourierReadiness {
  steadfast: boolean;
  pathao: boolean;
  redx: boolean;
  webhookSecret: boolean;
  anyLiveCourier: boolean;
  pathaoLiveMode: boolean;
  redxLiveMode: boolean;
  hasPathaoLocationMap: boolean;
  hasRedxAreaMap: boolean;
  webhookPath: string;
}

interface MessagingReadiness {
  bulksmsbd: boolean;
  twilioSms: boolean;
  resendEmail: boolean;
  anyDirectSms: boolean;
  anyDirectEmail: boolean;
  hasOwnerEmail: boolean;
  maskedOwnerEmail: string;
  ownerWebhook: boolean;
  whatsappWebhook: boolean;
  emailWebhook: boolean;
  googleSheetsWebhook: boolean;
}

interface SecurityReadiness {
  orderTokenSecretStrong: boolean;
  cronSecretConfigured: boolean;
  workerSecretConfigured: boolean;
  siteUrlConfigured: boolean;
  siteBaseUrl: string;
}

interface ReadinessPayload {
  telegram: TelegramReadiness;
  discord: DiscordReadiness;
  whatsapp: WhatsAppReadiness;
  aiSupport: AiReadiness;
  meta?: MetaReadiness;
  payments?: PaymentReadiness;
  couriers?: CourierReadiness;
  messaging?: MessagingReadiness;
  security?: SecurityReadiness;
}

interface QueueStats {
  queued: number;
  processing: number;
  sent: number;
  failedRetrying: number;
  deadLetter: number;
  skippedDisabled: number;
  totalJobs: number;
  totalLogs: number;
}

type SubTab =
  | 'overview'
  | 'telegram'
  | 'discord'
  | 'whatsapp'
  | 'rules'
  | 'diagnostics'
  | 'history';

const EVENT_LABELS: Record<BusinessEventType, string> = {
  ORDER_CREATED: 'New Order Created',
  ORDER_UPDATED: 'Order Updated / Shipped',
  ORDER_CANCELLED: 'Order Cancelled',
  PAYMENT_SUCCESS: 'Payment Verified',
  PAYMENT_FAILED: 'Payment Failed / Cancelled',
  SUPPORT_REQUESTED: 'Support Escalation Ticket',
  CUSTOMER_MESSAGE_RECEIVED: 'Inbound Customer Message',
  LOW_STOCK: 'Low Inventory Alert',
  DAILY_SUMMARY: 'Daily Operations Summary',
  SYSTEM_ERROR: 'System Error / Test Alert',
};

const DISCORD_LABELS: Record<DiscordChannelKey, { channel: string; env: string }> = {
  'new-orders': { channel: '#new-orders', env: 'DISCORD_WEBHOOK_ORDERS' },
  payments: { channel: '#payments', env: 'DISCORD_WEBHOOK_PAYMENTS' },
  'customer-support': { channel: '#customer-support', env: 'DISCORD_WEBHOOK_SUPPORT' },
  'inventory-alerts': { channel: '#inventory-alerts', env: 'DISCORD_WEBHOOK_INVENTORY' },
  'daily-reports': { channel: '#daily-reports', env: 'DISCORD_WEBHOOK_REPORTS' },
  'system-alerts': { channel: '#system-alerts', env: 'DISCORD_WEBHOOK_SYSTEM' },
};

interface AdminEcosystemPanelProps {
  getIdToken: () => Promise<string>;
  onOpenChatbot: () => void;
  orderMetrics?: {
    total: number;
    pending: number;
    totalSales: number;
  };
}

export function AdminEcosystemPanel({
  getIdToken,
  onOpenChatbot,
  orderMetrics,
}: AdminEcosystemPanelProps) {
  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [storageReady, setStorageReady] = useState(true);
  const [storageNotice, setStorageNotice] = useState('');
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null);
  const [settings, setSettings] = useState<IntegrationSettingsDoc>(DEFAULT_INTEGRATION_SETTINGS);
  const [rules, setRules] = useState<NotificationRulesDoc>(DEFAULT_NOTIFICATION_RULES);

  const [jobs, setJobs] = useState<NotificationJobDoc[]>([]);
  const [logs, setLogs] = useState<NotificationLogDoc[]>([]);
  const [totalJobs, setTotalJobs] = useState(0);
  const [totalLogs, setTotalLogs] = useState(0);
  const [stats, setStats] = useState<QueueStats>({
    queued: 0,
    processing: 0,
    sent: 0,
    failedRetrying: 0,
    deadLetter: 0,
    skippedDisabled: 0,
    totalJobs: 0,
    totalLogs: 0,
  });

  const [filterChannel, setFilterChannel] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterEvent, setFilterEvent] = useState<string>('');
  const [pageOffset, setPageOffset] = useState(0);
  const pageLimit = 20;

  const [banner, setBanner] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(
    null
  );
  const [pendingReset, setPendingReset] = useState<
    null | 'telegram' | 'discord' | 'whatsapp' | 'rules'
  >(null);

  const confirmResetSection = (section: 'telegram' | 'discord' | 'whatsapp' | 'rules') => {
    if (section === 'telegram') {
      setSettings((prev) => ({
        ...prev,
        telegram: { ...DEFAULT_INTEGRATION_SETTINGS.telegram },
      }));
      showBanner('info', 'Telegram routing toggles reset to default (store prices, stock & contacts untouched). Click Save to persist.');
    } else if (section === 'discord') {
      setSettings((prev) => ({
        ...prev,
        discord: {
          ...DEFAULT_INTEGRATION_SETTINGS.discord,
          enabledChannels: { ...DEFAULT_INTEGRATION_SETTINGS.discord.enabledChannels },
        },
      }));
      showBanner('info', 'Discord channel toggles reset to default (store prices, stock & contacts untouched). Click Save to persist.');
    } else if (section === 'whatsapp') {
      setSettings((prev) => ({
        ...prev,
        whatsapp: { ...DEFAULT_INTEGRATION_SETTINGS.whatsapp },
      }));
      showBanner('info', 'WhatsApp notification settings reset to default (store prices, stock & contacts untouched). Click Save to persist.');
    } else if (section === 'rules') {
      setRules((prev) => ({
        ...DEFAULT_NOTIFICATION_RULES,
        templates: prev.templates,
      }));
      showBanner('info', 'Notification routing matrix reset to default (custom templates, store prices, stock & contacts untouched). Click Save to persist.');
    }
    setPendingReset(null);
  };

  const showBanner = (kind: 'success' | 'error' | 'info', text: string) => {
    setBanner({ kind, text });
  };

  const copyText = (key: string, text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
      });
    }
  };

  const buildWebhookUrl = (path: string) => {
    const base =
      readiness?.security?.siteBaseUrl ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    return base ? `${base.replace(/\/+$/, '')}${path}` : path;
  };

  const loadIntegrations = useCallback(async () => {
    const token = await getIdToken();
    if (!token) return;
    const res = await fetch('/api/admin/integrations', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showBanner('error', data.error || 'Failed to load integration configuration.');
      return;
    }
    setStorageReady(data.storageReady !== false);
    setStorageNotice(data.storageNotice || '');
    setReadiness(data.readiness || null);
    if (data.settings) setSettings(data.settings);
    if (data.rules) setRules(data.rules);
  }, [getIdToken]);

  const loadHistory = useCallback(async () => {
    const token = await getIdToken();
    if (!token) return;
    const params = new URLSearchParams();
    params.set('limit', String(pageLimit));
    params.set('offset', String(pageOffset));
    if (filterChannel) params.set('channel', filterChannel);
    if (filterStatus) params.set('status', filterStatus);
    if (filterEvent) params.set('eventType', filterEvent);

    const res = await fetch(`/api/admin/notifications?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (data.stats) setStats(data.stats);
    setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    setLogs(Array.isArray(data.logs) ? data.logs : []);
    setTotalJobs(Number(data.totalJobs || 0));
    setTotalLogs(Number(data.totalLogs || 0));
    if (!res.ok && res.status === 503 && data.error) {
      setStorageReady(false);
      setStorageNotice(data.error);
    }
  }, [getIdToken, filterChannel, filterStatus, filterEvent, pageOffset]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadIntegrations(), loadHistory()]);
    } finally {
      setLoading(false);
    }
  }, [loadIntegrations, loadHistory]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleSave = async (payload: {
    settings?: Partial<IntegrationSettingsDoc>;
    rules?: Partial<NotificationRulesDoc>;
  }) => {
    setSaving(true);
    setBanner(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/integrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showBanner('error', data.error || `Save failed (HTTP ${res.status}).`);
        return;
      }
      if (data.settings) setSettings(data.settings);
      if (data.rules) setRules(data.rules);
      if (data.readiness) setReadiness(data.readiness);
      showBanner('success', 'Integration settings, rules, and custom templates saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestProvider = async (
    provider: 'telegram' | 'discord' | 'whatsapp' | 'ai',
    extra?: { channelKey?: DiscordChannelKey }
  ) => {
    const key = extra?.channelKey ? `${provider}:${extra.channelKey}` : provider;
    setTestingKey(key);
    setBanner(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/integrations/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider,
          channelKey: extra?.channelKey,
          chatIdsOverride: provider === 'telegram' ? settings.telegram.chatIdsOverride : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const detail =
          provider === 'telegram'
            ? `Telegram @${data.botUsername || 'bot'} verified (${data.sentToChats ?? 1} chat).`
            : provider === 'discord'
              ? `Discord test embed delivered to #${extra?.channelKey || 'system-alerts'}.`
              : provider === 'whatsapp'
                ? `WhatsApp Cloud verified (${data.verifiedName || data.displayPhoneNumber || 'Meta Graph'}).`
                : `Gemini API verified (${data.model || 'active'}).`;
        showBanner('success', detail);
      } else {
        showBanner(
          res.status === 503 ? 'info' : 'error',
          data.error || `${provider.toUpperCase()} test failed (HTTP ${res.status}).`
        );
      }
      await loadIntegrations();
    } finally {
      setTestingKey(null);
    }
  };

  const handleQueueAction = async (
    action: 'process_queue' | 'daily_summary' | 'publish_test_event'
  ) => {
    setQueueBusy(true);
    setBanner(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          totalOrders: orderMetrics?.total ?? 0,
          pendingOrders: orderMetrics?.pending ?? 0,
          revenueBdt: orderMetrics?.totalSales ?? 0,
          openTickets: 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showBanner('error', data.error || `Action failed (HTTP ${res.status}).`);
        return;
      }
      if (action === 'process_queue') {
        showBanner('success', `Processed ${data.processed ?? 0} due notification job(s).`);
      } else if (action === 'daily_summary') {
        showBanner('success', 'Daily summary event published to enabled channels.');
      } else {
        showBanner('success', 'Test system alert queued and dispatched.');
      }
      await loadHistory();
    } finally {
      setQueueBusy(false);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setRetryingJobId(jobId);
    setBanner(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'retry', jobId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        showBanner('success', `Job ${jobId} delivered on manual retry.`);
      } else {
        showBanner('error', data.error || `Retry did not deliver (${data.outcome?.status || 'failed'}).`);
      }
      await loadHistory();
    } finally {
      setRetryingJobId(null);
    }
  };

  const getChannelStatusBadge = (
    configured: boolean | undefined,
    meta?: { lastConnectedAtIso?: string; lastError?: string }
  ) => {
    if (!configured) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#635647]">
          <XCircle className="h-3.5 w-3.5" />
          Not Configured
        </span>
      );
    }
    if (meta?.lastError) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          Configuration Error
        </span>
      );
    }
    if (meta?.lastConnectedAtIso) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Connected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#8A5A17]">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Test Required
      </span>
    );
  };

  const subTabs: Array<{ id: SubTab; label: string }> = [
    { id: 'overview', label: 'Overview & Credentials' },
    { id: 'telegram', label: 'Telegram' },
    { id: 'discord', label: 'Discord' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'rules', label: 'Rules & Templates' },
    { id: 'diagnostics', label: 'Diagnostics & Tests' },
    { id: 'history', label: `History & DLQ (${stats.deadLetter})` },
  ];

  const formatTimestamp = (iso?: string) => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Never';
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="mt-8 space-y-6">
      {/* Header Row */}
      <div className="flex flex-col gap-3 border-b border-[rgba(30,23,16,0.12)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A5A17]">
            AI Support, Credentials &amp; Notification Ecosystem
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-[#1E1710]">
              Integrations, Templates &amp; Diagnostics
            </h2>
            <HelpInfoButton section="integrations_overview" />
          </div>
          <p className="mt-1 text-xs text-[#635647]">
            Server-side secrets only · Custom per-event templates · Durable Firestore job queue ·
            Live verification checks
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('diagnostics')}
            className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3.5 py-2 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
          >
            <Wrench className="h-3.5 w-3.5 text-[#8A5A17]" />
            <span>Diagnostics</span>
          </button>
          <button
            type="button"
            onClick={onOpenChatbot}
            className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3.5 py-2 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
          >
            <Bot className="h-3.5 w-3.5 text-[#8A5A17]" />
            <span>AI Chatbot &amp; Inbox</span>
          </button>
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={loading}
            className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#1E1710] px-3.5 py-2 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Sub-tab Strip */}
      <div className="flex flex-wrap gap-1.5 border-b border-[rgba(30,23,16,0.10)] pb-3">
        {subTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSubTab(item.id)}
            className={`min-h-[38px] shrink-0 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${
              subTab === item.id
                ? 'bg-[#B47B2B] text-[#FFFDF9]'
                : 'border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] text-[#635647] hover:text-[#1E1710]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Storage Notice (Honest Preview / Missing IAM Banner) */}
      {!storageReady && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/80 px-4 py-3 text-xs text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <p className="font-semibold">Firestore Admin SDK Unavailable in Current Runtime</p>
            <p className="mt-0.5 text-amber-900">
              {storageNotice ||
                'Grant roles/datastore.user to the Cloud Run service account before saving rules or viewing persistent notification logs.'}
            </p>
          </div>
        </div>
      )}

      {/* Action Feedback Banner */}
      {banner && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            banner.kind === 'success'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
              : banner.kind === 'error'
                ? 'border-red-300 bg-red-50 text-red-950'
                : 'border-amber-300 bg-amber-50 text-amber-950'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-[11px] font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && !readiness ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FFFDF9] p-5"
            />
          ))}
        </div>
      ) : (
        <>
          {/* SUB-TAB 1: OVERVIEW & CREDENTIALS */}
          {subTab === 'overview' && (
            <div className="space-y-6">
              {/* Queue KPI Strip */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-4">
                  <p className="text-xs text-[#635647]">Delivered</p>
                  <p className="font-mono mt-1.5 text-2xl font-semibold tabular-nums text-emerald-800">
                    {stats.sent}
                  </p>
                </div>
                <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-4">
                  <p className="text-xs text-[#635647]">Queued</p>
                  <p className="font-mono mt-1.5 text-2xl font-semibold tabular-nums text-[#1E1710]">
                    {stats.queued}
                  </p>
                </div>
                <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-4">
                  <p className="text-xs text-[#635647]">Retrying</p>
                  <p className="font-mono mt-1.5 text-2xl font-semibold tabular-nums text-[#8A5A17]">
                    {stats.failedRetrying}
                  </p>
                </div>
                <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-4">
                  <p className="text-xs text-[#635647]">Dead Letter</p>
                  <p className="font-mono mt-1.5 text-2xl font-semibold tabular-nums text-red-700">
                    {stats.deadLetter}
                  </p>
                </div>
              </div>

              {/* Primary 4 AI & Notification Channel Cards */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Telegram Card */}
                <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Send className="h-4 w-4 text-[#8A5A17]" />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-semibold text-[#1E1710]">
                            Telegram Admin Bot
                          </h3>
                          <HelpInfoButton section="telegram_bot" />
                        </div>
                        <p className="text-xs text-[#635647]">
                          {readiness?.telegram.configured
                            ? `Configured · ${readiness.telegram.chatIdCount} chat target(s)`
                            : 'Set TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID in server env'}
                        </p>
                      </div>
                    </div>
                    {getChannelStatusBadge(readiness?.telegram.configured, settings.telegram)}
                  </div>

                  <p className="mt-3 text-[11px] text-[#635647]">
                    Routing: {settings.telegram.enabled ? 'Enabled' : 'Disabled'} · Last connected:{' '}
                    {formatTimestamp(settings.telegram.lastConnectedAtIso)}
                  </p>
                  {settings.telegram.lastError && (
                    <p className="mt-1.5 truncate text-[11px] text-red-700">
                      Last error: {settings.telegram.lastError}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleTestProvider('telegram')}
                      disabled={testingKey === 'telegram'}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-3 py-1.5 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
                    >
                      {testingKey === 'telegram' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>Test Connection</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubTab('telegram')}
                      className="min-h-[36px] rounded-lg border border-[rgba(30,23,16,0.16)] px-3 py-1.5 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
                    >
                      Configure
                    </button>
                  </div>
                </div>

                {/* Discord Card */}
                <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Hash className="h-4 w-4 text-[#8A5A17]" />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-semibold text-[#1E1710]">
                            Discord Ops Webhooks
                          </h3>
                          <HelpInfoButton section="discord_webhooks" />
                        </div>
                        <p className="text-xs text-[#635647]">
                          {readiness?.discord.configured
                            ? `${readiness.discord.channels.filter((c) => c.configured).length} / 6 channels configured`
                            : 'Set DISCORD_WEBHOOK_URL or per-channel env vars'}
                        </p>
                      </div>
                    </div>
                    {getChannelStatusBadge(readiness?.discord.configured, settings.discord)}
                  </div>

                  <p className="mt-3 text-[11px] text-[#635647]">
                    Routing: {settings.discord.enabled ? 'Enabled' : 'Disabled'} · Last connected:{' '}
                    {formatTimestamp(settings.discord.lastConnectedAtIso)}
                  </p>
                  {settings.discord.lastError && (
                    <p className="mt-1.5 truncate text-[11px] text-red-700">
                      Last error: {settings.discord.lastError}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleTestProvider('discord', { channelKey: 'system-alerts' })}
                      disabled={testingKey === 'discord:system-alerts'}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-3 py-1.5 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
                    >
                      {testingKey === 'discord:system-alerts' && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      <span>Test Connection</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubTab('discord')}
                      className="min-h-[36px] rounded-lg border border-[rgba(30,23,16,0.16)] px-3 py-1.5 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
                    >
                      Manage 6 Channels
                    </button>
                  </div>
                </div>

                {/* WhatsApp Business Card */}
                <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <MessageSquare className="h-4 w-4 text-[#8A5A17]" />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-semibold text-[#1E1710]">
                            WhatsApp Business Cloud API
                          </h3>
                          <HelpInfoButton section="whatsapp_cloud" />
                        </div>
                        <p className="text-xs text-[#635647]">
                          {readiness?.whatsapp.configured
                            ? 'Configured · Meta Cloud Graph API ready'
                            : 'Set WHATSAPP_ACCESS_TOKEN & WHATSAPP_PHONE_NUMBER_ID'}
                        </p>
                      </div>
                    </div>
                    {getChannelStatusBadge(readiness?.whatsapp.configured, settings.whatsapp)}
                  </div>

                  <p className="mt-3 text-[11px] text-[#635647]">
                    Verify token: {readiness?.whatsapp.hasVerifyToken ? 'Set' : 'Unset'} · App
                    Secret: {readiness?.whatsapp.hasAppSecret ? 'Set' : 'Unset'} · Last connected:{' '}
                    {formatTimestamp(settings.whatsapp.lastConnectedAtIso)}
                  </p>
                  {settings.whatsapp.lastError && (
                    <p className="mt-1.5 truncate text-[11px] text-red-700">
                      Last error: {settings.whatsapp.lastError}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleTestProvider('whatsapp')}
                      disabled={testingKey === 'whatsapp'}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-3 py-1.5 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
                    >
                      {testingKey === 'whatsapp' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>Test Connection</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubTab('whatsapp')}
                      className="min-h-[36px] rounded-lg border border-[rgba(30,23,16,0.16)] px-3 py-1.5 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
                    >
                      Templates &amp; Opt-In
                    </button>
                  </div>
                </div>

                {/* AI Customer Support Card */}
                <div className="rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Bot className="h-4 w-4 text-[#8A5A17]" />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-semibold text-[#1E1710]">
                            AI Customer Support Engine
                          </h3>
                          <HelpInfoButton section="chatbot_studio" />
                        </div>
                        <p className="text-xs text-[#635647]">
                          {readiness?.aiSupport.configured
                            ? `${readiness.aiSupport.provider} · ${readiness.aiSupport.model}`
                            : 'GEMINI_API_KEY not set · Deterministic grounded fallback active'}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold ${
                        readiness?.aiSupport.configured ? 'text-emerald-800' : 'text-[#8A5A17]'
                      }`}
                    >
                      {readiness?.aiSupport.configured ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      )}
                      {readiness?.aiSupport.configured ? 'Live LLM' : 'Fallback Only'}
                    </span>
                  </div>

                  <p className="mt-3 text-[11px] text-[#635647]">
                    Shared across Website Widget &amp; WhatsApp/Meta Webhooks · Human takeover
                    supported
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleTestProvider('ai')}
                      disabled={testingKey === 'ai'}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-3 py-1.5 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
                    >
                      {testingKey === 'ai' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>Test Gemini Key</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenChatbot}
                      className="min-h-[36px] rounded-lg border border-[rgba(30,23,16,0.16)] px-3 py-1.5 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
                    >
                      Open Chatbot Studio
                    </button>
                  </div>
                </div>
              </div>

              {/* Server-Side Credentials, Webhook URLs & External Gateways Inspector */}
              <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6 space-y-5">
                <div className="flex flex-col gap-2 border-b border-[rgba(30,23,16,0.10)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-[#8A5A17]" />
                      <h3 className="font-display text-lg font-semibold text-[#1E1710]">
                        All Server Integrations, Credentials &amp; Webhook Endpoints
                      </h3>
                    </div>
                    <p className="mt-0.5 text-xs text-[#635647]">
                      Private API keys &amp; secrets live exclusively in Cloud Run / Server
                      Environment Variables and are never exposed to the browser.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSubTab('diagnostics')}
                    className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#1E1710] px-3.5 py-1.5 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E]"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    <span>Run All Diagnostics</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {/* Meta Messenger & Instagram */}
                  <div className="rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-4 text-xs space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <MessageSquare className="h-4 w-4 text-[#8A5A17]" />
                        <p className="font-semibold text-[#1E1710]">
                          Meta Messenger &amp; Instagram DM
                        </p>
                        <HelpInfoButton section="meta_channels" />
                      </div>
                      <span
                        className={`font-mono text-[11px] font-semibold ${
                          readiness?.meta?.configured ? 'text-emerald-800' : 'text-[#635647]'
                        }`}
                      >
                        {readiness?.meta?.configured ? 'Configured' : 'Not Configured'}
                      </span>
                    </div>
                    <p className="text-[#635647]">
                      App Secret: <strong className="font-mono text-[#1E1710]">{readiness?.meta?.hasAppSecret ? 'Set' : 'Missing'}</strong> ·
                      Verify Token: <strong className="font-mono text-[#1E1710]">{readiness?.meta?.hasVerifyToken ? 'Set' : 'Missing'}</strong> ·
                      Page Token: <strong className="font-mono text-[#1E1710]">{readiness?.meta?.hasPageAccessToken ? 'Set' : 'Optional'}</strong>
                    </p>
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-[rgba(30,23,16,0.10)] bg-[#FFFDF9] px-2.5 py-1.5">
                      <code className="truncate font-mono text-[11px] text-[#1E1710]">
                        {buildWebhookUrl(readiness?.meta?.webhookPath || '/api/channels/webhook')}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          copyText(
                            'meta_webhook',
                            buildWebhookUrl(readiness?.meta?.webhookPath || '/api/channels/webhook')
                          )
                        }
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-[rgba(30,23,16,0.14)] px-2 py-1 text-[10px] font-medium hover:bg-[#F2ECE1]"
                      >
                        {copiedKey === 'meta_webhook' ? (
                          <Check className="h-3 w-3 text-emerald-700" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        <span>{copiedKey === 'meta_webhook' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Payment Gateways */}
                  <div className="rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-4 text-xs space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <CreditCard className="h-4 w-4 text-[#8A5A17]" />
                        <p className="font-semibold text-[#1E1710]">
                          Online Payments (SSLCommerz &amp; bKash)
                        </p>
                        <HelpInfoButton section="payment_gateways" />
                      </div>
                      <span
                        className={`font-mono text-[11px] font-semibold ${
                          readiness?.payments?.anyConfigured ? 'text-emerald-800' : 'text-[#635647]'
                        }`}
                      >
                        {readiness?.payments?.anyConfigured ? 'Configured' : 'Not Configured'}
                      </span>
                    </div>
                    <p className="text-[#635647]">
                      SSLCommerz:{' '}
                      <strong className="font-mono text-[#1E1710]">
                        {readiness?.payments?.sslcommerz.configured
                          ? readiness.payments.sslcommerz.liveMode
                            ? 'Live'
                            : 'Sandbox'
                          : 'Unset'}
                      </strong>{' '}
                      · bKash PGW:{' '}
                      <strong className="font-mono text-[#1E1710]">
                        {readiness?.payments?.bkash.configured
                          ? readiness.payments.bkash.liveMode
                            ? 'Live'
                            : 'Sandbox'
                          : 'Unset'}
                      </strong>
                    </p>
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-[rgba(30,23,16,0.10)] bg-[#FFFDF9] px-2.5 py-1.5">
                      <code className="truncate font-mono text-[11px] text-[#1E1710]">
                        {buildWebhookUrl(
                          readiness?.payments?.callbackPath || '/api/payments/callback'
                        )}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          copyText(
                            'pay_callback',
                            buildWebhookUrl(
                              readiness?.payments?.callbackPath || '/api/payments/callback'
                            )
                          )
                        }
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-[rgba(30,23,16,0.14)] px-2 py-1 text-[10px] font-medium hover:bg-[#F2ECE1]"
                      >
                        {copiedKey === 'pay_callback' ? (
                          <Check className="h-3 w-3 text-emerald-700" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        <span>{copiedKey === 'pay_callback' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Courier APIs */}
                  <div className="rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-4 text-xs space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Truck className="h-4 w-4 text-[#8A5A17]" />
                        <p className="font-semibold text-[#1E1710]">
                          Couriers (Steadfast, Pathao, RedX)
                        </p>
                        <HelpInfoButton section="courier_partners" />
                      </div>
                      <span
                        className={`font-mono text-[11px] font-semibold ${
                          readiness?.couriers?.anyLiveCourier ? 'text-emerald-800' : 'text-[#635647]'
                        }`}
                      >
                        {readiness?.couriers?.anyLiveCourier ? 'Configured' : 'Not Configured'}
                      </span>
                    </div>
                    <p className="text-[#635647]">
                      Steadfast:{' '}
                      <strong className="font-mono text-[#1E1710]">
                        {readiness?.couriers?.steadfast ? 'Set' : 'Unset'}
                      </strong>{' '}
                      · Pathao:{' '}
                      <strong className="font-mono text-[#1E1710]">
                        {readiness?.couriers?.pathao ? 'Set' : 'Unset'}
                      </strong>{' '}
                      · RedX:{' '}
                      <strong className="font-mono text-[#1E1710]">
                        {readiness?.couriers?.redx ? 'Set' : 'Unset'}
                      </strong>{' '}
                      · Webhook Secret:{' '}
                      <strong className="font-mono text-[#1E1710]">
                        {readiness?.couriers?.webhookSecret ? 'Set' : 'Unset'}
                      </strong>
                    </p>
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-[rgba(30,23,16,0.10)] bg-[#FFFDF9] px-2.5 py-1.5">
                      <code className="truncate font-mono text-[11px] text-[#1E1710]">
                        {buildWebhookUrl(
                          readiness?.couriers?.webhookPath || '/api/couriers/webhook'
                        )}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          copyText(
                            'courier_webhook',
                            buildWebhookUrl(
                              readiness?.couriers?.webhookPath || '/api/couriers/webhook'
                            )
                          )
                        }
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-[rgba(30,23,16,0.14)] px-2 py-1 text-[10px] font-medium hover:bg-[#F2ECE1]"
                      >
                        {copiedKey === 'courier_webhook' ? (
                          <Check className="h-3 w-3 text-emerald-700" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        <span>{copiedKey === 'courier_webhook' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Direct SMS, Email & Worker Security */}
                  <div className="rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-4 text-xs space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Mail className="h-4 w-4 text-[#8A5A17]" />
                        <p className="font-semibold text-[#1E1710]">
                          Direct SMS, Email &amp; Queue Worker
                        </p>
                        <HelpInfoButton section="sms_email_gateways" />
                      </div>
                      <span
                        className={`font-mono text-[11px] font-semibold ${
                          readiness?.messaging?.anyDirectEmail || readiness?.messaging?.anyDirectSms
                            ? 'text-emerald-800'
                            : 'text-[#635647]'
                        }`}
                      >
                        {readiness?.messaging?.anyDirectEmail || readiness?.messaging?.anyDirectSms
                          ? 'Configured'
                          : 'Not Configured'}
                      </span>
                    </div>
                    <p className="text-[#635647]">
                      Resend Email:{' '}
                      <strong className="font-mono text-[#1E1710]">
                        {readiness?.messaging?.resendEmail ? 'Set' : 'Unset'}
                      </strong>{' '}
                      · BulkSMSBD:{' '}
                      <strong className="font-mono text-[#1E1710]">
                        {readiness?.messaging?.bulksmsbd ? 'Set' : 'Unset'}
                      </strong>{' '}
                      · Twilio:{' '}
                      <strong className="font-mono text-[#1E1710]">
                        {readiness?.messaging?.twilioSms ? 'Set' : 'Unset'}
                      </strong>{' '}
                      · Worker Secret:{' '}
                      <strong className="font-mono text-[#1E1710]">
                        {readiness?.security?.workerSecretConfigured ? 'Set' : 'Unset'}
                      </strong>
                    </p>
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-[rgba(30,23,16,0.10)] bg-[#FFFDF9] px-2.5 py-1.5">
                      <code className="truncate font-mono text-[11px] text-[#1E1710]">
                        {buildWebhookUrl('/api/notifications/worker')}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          copyText('worker_url', buildWebhookUrl('/api/notifications/worker'))
                        }
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-[rgba(30,23,16,0.14)] px-2 py-1 text-[10px] font-medium hover:bg-[#F2ECE1]"
                      >
                        {copiedKey === 'worker_url' ? (
                          <Check className="h-3 w-3 text-emerald-700" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        <span>{copiedKey === 'worker_url' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SUB-TAB 2: TELEGRAM */}
          {subTab === 'telegram' && (
            <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6 space-y-5">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-lg font-semibold">
                    Telegram Admin Notification Bot
                  </h3>
                  <HelpInfoButton section="telegram_bot" />
                </div>
                <p className="mt-1 text-xs text-[#635647]">
                  Bot token stays strictly in server secret <code>TELEGRAM_BOT_TOKEN</code>. Default
                  chat IDs come from <code>TELEGRAM_CHAT_ID</code>.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-4 text-xs">
                  <p className="font-semibold text-[#1E1710]">Server Secret Readiness</p>
                  <p className="mt-1 text-[#635647]">
                    TELEGRAM_BOT_TOKEN:{' '}
                    <span className="font-mono font-semibold text-[#1E1710]">
                      {readiness?.telegram.hasBotToken ? 'Configured in server env' : 'Not set'}
                    </span>
                  </p>
                  <p className="mt-1 text-[#635647]">
                    Resolved Chat Targets:{' '}
                    <span className="font-mono font-semibold text-[#1E1710]">
                      {readiness?.telegram.maskedChatIds.length
                        ? readiness.telegram.maskedChatIds.join(', ')
                        : 'None'}
                    </span>
                  </p>
                </div>

                <label className="flex items-center justify-between rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-4 text-xs">
                  <div>
                    <span className="font-semibold text-[#1E1710]">Enable Telegram Dispatch</span>
                    <p className="mt-0.5 text-[#635647]">
                      Pause or resume all outgoing Telegram admin alerts
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.telegram.enabled}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        telegram: { ...prev.telegram, enabled: e.target.checked },
                      }))
                    }
                    className="h-4 w-4 accent-[#B47B2B]"
                  />
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#1E1710]">
                  Optional Non-Secret Chat ID Override (comma-separated numeric IDs)
                </label>
                <input
                  type="text"
                  value={settings.telegram.chatIdsOverride || ''}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      telegram: { ...prev.telegram, chatIdsOverride: e.target.value },
                    }))
                  }
                  placeholder="Leave blank to use server TELEGRAM_CHAT_ID (e.g. -1001234567890)"
                  className="mt-1.5 min-h-[42px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3.5 py-2 font-mono text-xs focus:border-[#B47B2B] focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave({ settings: { telegram: settings.telegram } })}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-4 py-2 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Telegram Settings</span>
                </button>
                <button
                  type="button"
                  disabled={testingKey === 'telegram'}
                  onClick={() => void handleTestProvider('telegram')}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-4 py-2 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
                >
                  {testingKey === 'telegram' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5 text-[#8A5A17]" />
                  )}
                  <span>Send Test Ping</span>
                </button>
                {pendingReset === 'telegram' ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-950">
                    <span>Reset Telegram toggles only? (Prices, stock &amp; contacts untouched.)</span>
                    <button
                      type="button"
                      onClick={() => confirmResetSection('telegram')}
                      className="rounded-md bg-[#1E1710] px-2.5 py-1 text-[11px] font-medium text-[#FAF7F2]"
                    >
                      Confirm Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingReset(null)}
                      className="rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-950"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingReset('telegram')}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] px-3.5 py-2 text-xs font-medium text-[#635647] hover:text-[#1E1710]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* SUB-TAB 3: DISCORD */}
          {subTab === 'discord' && (
            <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6 space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-lg font-semibold">Discord Channel Webhooks</h3>
                    <HelpInfoButton section="discord_webhooks" />
                  </div>
                  <p className="mt-1 text-xs text-[#635647]">
                    Webhook URLs stay exclusively in server env vars (<code>DISCORD_WEBHOOK_*</code>{' '}
                    or fallback <code>DISCORD_WEBHOOK_URL</code>).
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#1E1710]">
                  <input
                    type="checkbox"
                    checked={settings.discord.enabled}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        discord: { ...prev.discord, enabled: e.target.checked },
                      }))
                    }
                    className="h-4 w-4 accent-[#B47B2B]"
                  />
                  <span>Discord Enabled</span>
                </label>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[rgba(30,23,16,0.12)] text-[#635647]">
                      <th className="py-2.5 pr-4 font-semibold">Channel</th>
                      <th className="py-2.5 pr-4 font-semibold">Server Env Variable</th>
                      <th className="py-2.5 pr-4 font-semibold">Webhook Status</th>
                      <th className="py-2.5 pr-4 font-semibold">Active</th>
                      <th className="py-2.5 text-right font-semibold">Test</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(30,23,16,0.08)]">
                    {DISCORD_CHANNEL_KEYS.map((key) => {
                      const chStatus = readiness?.discord.channels.find((c) => c.channelKey === key);
                      const testId = `discord:${key}`;
                      return (
                        <tr key={key}>
                          <td className="py-3 pr-4 font-mono font-semibold text-[#1E1710]">
                            {DISCORD_LABELS[key].channel}
                          </td>
                          <td className="py-3 pr-4 font-mono text-[11px] text-[#635647]">
                            {DISCORD_LABELS[key].env}
                          </td>
                          <td className="py-3 pr-4">
                            {chStatus?.configured ? (
                              <span className="font-medium text-emerald-800">
                                {chStatus.usesDedicatedWebhook ? 'Dedicated' : 'Default Fallback'}
                              </span>
                            ) : (
                              <span className="text-[#635647]">Not configured</span>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            <input
                              type="checkbox"
                              checked={settings.discord.enabledChannels[key] !== false}
                              onChange={(e) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  discord: {
                                    ...prev.discord,
                                    enabledChannels: {
                                      ...prev.discord.enabledChannels,
                                      [key]: e.target.checked,
                                    },
                                  },
                                }))
                              }
                              className="h-4 w-4 accent-[#B47B2B]"
                            />
                          </td>
                          <td className="py-3 text-right">
                            <button
                              type="button"
                              disabled={testingKey === testId}
                              onClick={() => void handleTestProvider('discord', { channelKey: key })}
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[rgba(30,23,16,0.16)] bg-[#FAF7F2] px-2.5 py-1 text-[11px] font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
                            >
                              {testingKey === testId && (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              )}
                              <span>Test</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave({ settings: { discord: settings.discord } })}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-4 py-2 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Discord Channel Toggles</span>
                </button>
                {pendingReset === 'discord' ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-950">
                    <span>Reset Discord channel toggles only? (Prices, stock &amp; contacts untouched.)</span>
                    <button
                      type="button"
                      onClick={() => confirmResetSection('discord')}
                      className="rounded-md bg-[#1E1710] px-2.5 py-1 text-[11px] font-medium text-[#FAF7F2]"
                    >
                      Confirm Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingReset(null)}
                      className="rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-950"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingReset('discord')}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] px-3.5 py-2 text-xs font-medium text-[#635647] hover:text-[#1E1710]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* SUB-TAB 4: WHATSAPP */}
          {subTab === 'whatsapp' && (
            <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6 space-y-5">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-lg font-semibold">
                    WhatsApp Business Cloud API
                  </h3>
                  <HelpInfoButton section="whatsapp_cloud" />
                </div>
                <p className="mt-1 text-xs text-[#635647]">
                  Proactive messages outside the 24-hour customer care window require verified opt-in
                  and a Meta-approved utility template.
                </p>
              </div>

              {/* Copyable Webhook URL */}
              <div className="flex flex-col gap-2 rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-3.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-[#1E1710]">Inbound Meta Webhook Callback URL</p>
                  <code className="mt-0.5 block truncate font-mono text-[11px] text-[#635647]">
                    {buildWebhookUrl('/api/channels/webhook')}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={() => copyText('wa_webhook', buildWebhookUrl('/api/channels/webhook'))}
                  className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.16)] bg-[#FFFDF9] px-3 py-1.5 text-xs font-medium hover:bg-[#F2ECE1]"
                >
                  {copiedKey === 'wa_webhook' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-700" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedKey === 'wa_webhook' ? 'Copied URL' : 'Copy Webhook URL'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-4 text-xs sm:grid-cols-5">
                <div>
                  <p className="text-[#635647]">Access Token</p>
                  <p className="mt-0.5 font-mono font-semibold">
                    {readiness?.whatsapp.hasAccessToken ? 'Set' : 'Missing'}
                  </p>
                </div>
                <div>
                  <p className="text-[#635647]">Phone Number ID</p>
                  <p className="mt-0.5 font-mono font-semibold">
                    {readiness?.whatsapp.hasPhoneNumberId ? 'Set' : 'Missing'}
                  </p>
                </div>
                <div>
                  <p className="text-[#635647]">WABA ID</p>
                  <p className="mt-0.5 font-mono font-semibold">
                    {readiness?.whatsapp.hasBusinessAccountId ? 'Set' : 'Missing'}
                  </p>
                </div>
                <div>
                  <p className="text-[#635647]">Verify Token</p>
                  <p className="mt-0.5 font-mono font-semibold">
                    {readiness?.whatsapp.hasVerifyToken ? 'Set' : 'Missing'}
                  </p>
                </div>
                <div>
                  <p className="text-[#635647]">App Secret</p>
                  <p className="mt-0.5 font-mono font-semibold">
                    {readiness?.whatsapp.hasAppSecret ? 'Set' : 'Missing'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    ['enabled', 'Enable WhatsApp Outgoing Engine'],
                    ['sendOrderConfirmations', 'Send Opt-In Order Confirmations'],
                    ['sendStatusUpdates', 'Send Order Status & Cancel Updates'],
                    ['sendDeliveryAlerts', 'Send Courier Dispatch / Delivery Alerts'],
                  ] as const
                ).map(([field, label]) => (
                  <label
                    key={field}
                    className="flex items-center justify-between rounded-xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] px-4 py-3 text-xs font-medium"
                  >
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(settings.whatsapp[field])}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          whatsapp: { ...prev.whatsapp, [field]: e.target.checked },
                        }))
                      }
                      className="h-4 w-4 accent-[#B47B2B]"
                    />
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-[#1E1710]">
                    Order Confirmation Template Name
                  </label>
                  <input
                    type="text"
                    value={settings.whatsapp.orderConfirmationTemplateName}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        whatsapp: {
                          ...prev.whatsapp,
                          orderConfirmationTemplateName: e.target.value,
                        },
                      }))
                    }
                    placeholder="e.g. order_confirmed_utility"
                    className="mt-1 min-h-[40px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3 py-2 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1E1710]">
                    Order Status Template Name
                  </label>
                  <input
                    type="text"
                    value={settings.whatsapp.orderStatusTemplateName}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        whatsapp: {
                          ...prev.whatsapp,
                          orderStatusTemplateName: e.target.value,
                        },
                      }))
                    }
                    placeholder="e.g. order_status_update"
                    className="mt-1 min-h-[40px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3 py-2 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#1E1710]">
                    Template Language Code
                  </label>
                  <input
                    type="text"
                    value={settings.whatsapp.templateLanguageCode}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        whatsapp: { ...prev.whatsapp, templateLanguageCode: e.target.value },
                      }))
                    }
                    placeholder="en_US"
                    className="mt-1 min-h-[40px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3 py-2 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave({ settings: { whatsapp: settings.whatsapp } })}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-4 py-2 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save WhatsApp Settings</span>
                </button>
                <button
                  type="button"
                  disabled={testingKey === 'whatsapp'}
                  onClick={() => void handleTestProvider('whatsapp')}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-4 py-2 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
                >
                  {testingKey === 'whatsapp' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Verify Meta Graph Connection</span>
                </button>
                {pendingReset === 'whatsapp' ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-950">
                    <span>Reset WhatsApp toggles &amp; template names only? (Prices, stock &amp; contacts untouched.)</span>
                    <button
                      type="button"
                      onClick={() => confirmResetSection('whatsapp')}
                      className="rounded-md bg-[#1E1710] px-2.5 py-1 text-[11px] font-medium text-[#FAF7F2]"
                    >
                      Confirm Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingReset(null)}
                      className="rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-950"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingReset('whatsapp')}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] px-3.5 py-2 text-xs font-medium text-[#635647] hover:text-[#1E1710]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Reset</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* SUB-TAB 5: RULES & MESSAGE TEMPLATES */}
          {subTab === 'rules' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-6 space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-[#8A5A17]" />
                    <h3 className="font-display text-lg font-semibold">
                      Event Routing Matrix &amp; Retry Policy
                    </h3>
                    <HelpInfoButton section="notification_rules" />
                  </div>
                  {pendingReset === 'rules' ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-950">
                      <span>Reset event routing matrix only? (Prices, stock &amp; contacts untouched.)</span>
                      <button
                        type="button"
                        onClick={() => confirmResetSection('rules')}
                        className="rounded-md bg-[#1E1710] px-2.5 py-1 text-[11px] font-medium text-[#FAF7F2]"
                      >
                        Confirm Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingReset(null)}
                        className="rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-950"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingReset('rules')}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] px-3 py-1.5 text-xs font-medium text-[#635647] hover:text-[#1E1710]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reset Matrix to Default</span>
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[rgba(30,23,16,0.12)] text-[#635647]">
                        <th className="py-2.5 pr-4 font-semibold">Business Event</th>
                        <th className="py-2.5 px-3 text-center font-semibold">Enabled</th>
                        <th className="py-2.5 px-3 text-center font-semibold">Telegram</th>
                        <th className="py-2.5 px-3 text-center font-semibold">Discord</th>
                        <th className="py-2.5 px-3 text-center font-semibold">WhatsApp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(30,23,16,0.08)]">
                      {BUSINESS_EVENT_TYPES.map((evt) => {
                        const row = rules.events[evt];
                        return (
                          <tr key={evt}>
                            <td className="py-3 pr-4">
                              <p className="font-medium text-[#1E1710]">{EVENT_LABELS[evt]}</p>
                              <p className="font-mono text-[10px] text-[#635647]">{evt}</p>
                            </td>
                            {(['enabled', 'telegram', 'discord', 'whatsapp'] as const).map((col) => (
                              <td key={col} className="py-3 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={Boolean(row?.[col])}
                                  onChange={(e) =>
                                    setRules((prev) => ({
                                      ...prev,
                                      events: {
                                        ...prev.events,
                                        [evt]: {
                                          ...prev.events[evt],
                                          [col]: e.target.checked,
                                        },
                                      },
                                    }))
                                  }
                                  className="h-4 w-4 accent-[#B47B2B]"
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-1 gap-4 border-t border-[rgba(30,23,16,0.10)] pt-5 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="block text-xs font-medium text-[#1E1710]">
                      Owner Alert Email Override
                    </label>
                    <input
                      type="email"
                      value={rules.ownerNotificationEmailOverride || ''}
                      onChange={(e) =>
                        setRules((prev) => ({
                          ...prev,
                          ownerNotificationEmailOverride: e.target.value,
                        }))
                      }
                      placeholder={
                        readiness?.messaging?.maskedOwnerEmail || 'Leave blank for server env'
                      }
                      className="mt-1 min-h-[40px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#1E1710]">
                      Max Retry Attempts (1–8)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={rules.maxRetries}
                      onChange={(e) =>
                        setRules((prev) => ({ ...prev, maxRetries: Number(e.target.value || 4) }))
                      }
                      className="mt-1 min-h-[40px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3 py-2 font-mono text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#1E1710]">
                      Base Backoff Seconds (5–600)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={600}
                      value={rules.baseBackoffSeconds}
                      onChange={(e) =>
                        setRules((prev) => ({
                          ...prev,
                          baseBackoffSeconds: Number(e.target.value || 30),
                        }))
                      }
                      className="mt-1 min-h-[40px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3 py-2 font-mono text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#1E1710]">
                      Low Stock Alert Threshold (jars)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={rules.lowStockThreshold}
                      onChange={(e) =>
                        setRules((prev) => ({
                          ...prev,
                          lowStockThreshold: Number(e.target.value || 5),
                        }))
                      }
                      className="mt-1 min-h-[40px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-white px-3 py-2 font-mono text-xs tabular-nums"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave({ rules })}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-4 py-2 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Notification Rules</span>
                </button>
              </div>

              {/* Message Template Customizer & Live Preview */}
              <NotificationTemplatesEditor
                rules={rules}
                saving={saving}
                getIdToken={getIdToken}
                onChangeRules={setRules}
                onSaveRules={async (nextRules) => handleSave({ rules: nextRules })}
                onFeedback={showBanner}
              />
            </div>
          )}

          {/* SUB-TAB 6: DIAGNOSTICS & TESTS */}
          {subTab === 'diagnostics' && (
            <BackendDiagnosticsSuite
              getIdToken={getIdToken}
              chatIdsOverride={settings.telegram.chatIdsOverride}
            />
          )}

          {/* SUB-TAB 7: HISTORY & DLQ */}
          {subTab === 'history' && (
            <div className="space-y-6">
              {/* Filter & Worker Controls */}
              <div className="flex flex-col gap-3 rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <HelpInfoButton section="notification_history_dlq" />
                  <select
                    value={filterChannel}
                    onChange={(e) => {
                      setFilterChannel(e.target.value);
                      setPageOffset(0);
                    }}
                    className="min-h-[38px] rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 text-xs"
                  >
                    <option value="">All Channels</option>
                    <option value="telegram">Telegram</option>
                    <option value="discord">Discord</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                  <select
                    value={filterStatus}
                    onChange={(e) => {
                      setFilterStatus(e.target.value);
                      setPageOffset(0);
                    }}
                    className="min-h-[38px] rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 text-xs"
                  >
                    <option value="">All Statuses</option>
                    <option value="sent">Sent</option>
                    <option value="queued">Queued</option>
                    <option value="failed_retrying">Retrying</option>
                    <option value="dead_letter">Dead Letter</option>
                    <option value="skipped_disabled">Skipped</option>
                  </select>
                  <select
                    value={filterEvent}
                    onChange={(e) => {
                      setFilterEvent(e.target.value);
                      setPageOffset(0);
                    }}
                    className="min-h-[38px] rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 text-xs"
                  >
                    <option value="">All Events</option>
                    {BUSINESS_EVENT_TYPES.map((evt) => (
                      <option key={evt} value={evt}>
                        {EVENT_LABELS[evt]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={queueBusy}
                    onClick={() => void handleQueueAction('process_queue')}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-3 py-1.5 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>Process Queue</span>
                  </button>
                  <button
                    type="button"
                    disabled={queueBusy}
                    onClick={() => void handleQueueAction('daily_summary')}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-3 py-1.5 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
                  >
                    <Bell className="h-3.5 w-3.5 text-[#8A5A17]" />
                    <span>Send Daily Summary</span>
                  </button>
                  <button
                    type="button"
                    disabled={queueBusy}
                    onClick={() => void handleQueueAction('publish_test_event')}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-3 py-1.5 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
                  >
                    <ShieldAlert className="h-3.5 w-3.5 text-[#8A5A17]" />
                    <span>Test Alert</span>
                  </button>
                </div>
              </div>

              {/* Jobs & Dead-Letter Queue Table */}
              <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base font-semibold">
                    Notification Queue &amp; Dead-Letter Jobs ({totalJobs})
                  </h3>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      disabled={pageOffset === 0}
                      onClick={() => setPageOffset((o) => Math.max(0, o - pageLimit))}
                      className="rounded border border-[rgba(30,23,16,0.16)] px-2.5 py-1 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      disabled={pageOffset + pageLimit >= totalJobs}
                      onClick={() => setPageOffset((o) => o + pageLimit)}
                      className="rounded border border-[rgba(30,23,16,0.16)] px-2.5 py-1 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[rgba(30,23,16,0.10)] text-[#635647]">
                        <th className="py-2 pr-3 font-semibold">Channel</th>
                        <th className="py-2 pr-3 font-semibold">Event &amp; Summary</th>
                        <th className="py-2 pr-3 font-semibold">Status</th>
                        <th className="py-2 pr-3 font-semibold">Attempts</th>
                        <th className="py-2 pr-3 font-semibold">Timestamp</th>
                        <th className="py-2 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(30,23,16,0.08)]">
                      {jobs.map((job) => (
                        <tr key={job.jobId}>
                          <td className="py-3 pr-3 font-mono uppercase text-[#1E1710]">
                            {job.channel}
                            {job.discordChannelKey ? ` · ${job.discordChannelKey}` : ''}
                          </td>
                          <td className="py-3 pr-3 max-w-md">
                            <p className="font-medium text-[#1E1710]">{job.messageSummary}</p>
                            {job.lastError && (
                              <p className="mt-0.5 text-[11px] text-red-700">{job.lastError}</p>
                            )}
                          </td>
                          <td className="py-3 pr-3 font-mono">
                            <span
                              className={
                                job.status === 'sent'
                                  ? 'text-emerald-800 font-semibold'
                                  : job.status === 'dead_letter'
                                    ? 'text-red-700 font-semibold'
                                    : 'text-[#8A5A17] font-semibold'
                              }
                            >
                              {job.status}
                            </span>
                          </td>
                          <td className="py-3 pr-3 font-mono tabular-nums">
                            {job.attemptCount}/{job.maxAttempts}
                          </td>
                          <td className="py-3 pr-3 font-mono text-[11px] text-[#635647]">
                            {formatTimestamp(job.sentAtIso || job.updatedAtIso)}
                          </td>
                          <td className="py-3 text-right">
                            {(job.status === 'dead_letter' ||
                              job.status === 'failed_retrying' ||
                              job.status === 'queued') && (
                              <button
                                type="button"
                                disabled={retryingJobId === job.jobId}
                                onClick={() => void handleRetryJob(job.jobId)}
                                className="inline-flex min-h-[30px] items-center gap-1 rounded border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-2.5 py-1 text-[11px] font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
                              >
                                {retryingJobId === job.jobId ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3 w-3" />
                                )}
                                <span>Retry</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {jobs.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-[#635647]">
                            No notification jobs match the selected filters yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Delivery Attempt Audit Log */}
              <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5">
                <h3 className="font-display text-base font-semibold">
                  Delivery Attempt Logs ({totalLogs})
                </h3>
                <div className="mt-3 divide-y divide-[rgba(30,23,16,0.08)] text-xs">
                  {logs.map((log) => (
                    <div
                      key={log.logId}
                      className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-[#1E1710]">
                          <span className="font-mono uppercase">{log.channel}</span> ·{' '}
                          {log.eventType} · Attempt #{log.attemptNumber}
                        </p>
                        <p className="truncate text-[#635647]">{log.messageSummary}</p>
                        {log.errorDetail && (
                          <p className="text-[11px] text-red-700">{log.errorDetail}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right font-mono text-[11px]">
                        <span
                          className={
                            log.status === 'sent'
                              ? 'font-semibold text-emerald-800'
                              : log.status === 'dead_letter' || log.status === 'failed'
                                ? 'font-semibold text-red-700'
                                : 'text-[#8A5A17]'
                          }
                        >
                          {log.status}
                        </span>
                        <p className="text-[#635647]">{formatTimestamp(log.createdAtIso)}</p>
                      </div>
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <p className="py-6 text-center text-[#635647]">
                      No delivery attempt logs recorded yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
