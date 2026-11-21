'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CreditCard,
  Database,
  Globe,
  Hash,
  Loader2,
  Mail,
  MessageSquare,
  Play,
  Send,
  Smartphone,
  Truck,
  XCircle,
} from 'lucide-react';
import { HelpInfoButton } from './AdminHelpModal';

export interface DiagnosticResult {
  key: string;
  status: 'idle' | 'pending' | 'success' | 'failed' | 'not_configured';
  whatTested?: string;
  detail?: string;
  error?: string;
  possibleReasons?: string[];
  troubleshootingSteps?: string[];
  testedAtIso?: string;
}

interface DiagnosticTarget {
  key: string;
  title: string;
  description: string;
  provider: string;
  payload?: Record<string, unknown>;
  safeForBatch: boolean;
  icon: typeof Database;
}

const DIAGNOSTIC_TARGETS: DiagnosticTarget[] = [
  {
    key: 'firestore',
    title: 'Firestore Admin SDK & Named DB',
    description: 'Verifies live ADC/IAM connectivity against the named Firestore database.',
    provider: 'firestore',
    safeForBatch: true,
    icon: Database,
  },
  {
    key: 'storefront_display',
    title: 'Storefront Pricing & Ordering Display',
    description: 'Verifies whether live jar prices & delivery fees are active or safely paused.',
    provider: 'storefront_display',
    safeForBatch: true,
    icon: Globe,
  },
  {
    key: 'ai',
    title: 'Google Gemini AI Support Engine',
    description: 'Checks GEMINI_API_KEY and active chat model availability (read-only).',
    provider: 'ai',
    safeForBatch: true,
    icon: Bot,
  },
  {
    key: 'telegram',
    title: 'Telegram Admin Bot',
    description: 'Runs Bot API getMe and sends a live test ping to configured chat IDs.',
    provider: 'telegram',
    payload: { sendPingMessage: true },
    safeForBatch: false,
    icon: Send,
  },
  {
    key: 'discord',
    title: 'Discord Ops Webhook (#system-alerts)',
    description: 'Sends a formatted test embed to the configured #system-alerts webhook.',
    provider: 'discord',
    payload: { channelKey: 'system-alerts' },
    safeForBatch: false,
    icon: Hash,
  },
  {
    key: 'whatsapp',
    title: 'WhatsApp Business Cloud API',
    description: 'Verifies Meta Graph Phone Number ID & Business Display Name (read-only).',
    provider: 'whatsapp',
    safeForBatch: true,
    icon: MessageSquare,
  },
  {
    key: 'meta',
    title: 'Meta Messenger & Instagram Webhook',
    description: 'Validates META_APP_SECRET, META_VERIFY_TOKEN & optional Page Token.',
    provider: 'meta',
    safeForBatch: true,
    icon: MessageSquare,
  },
  {
    key: 'payments',
    title: 'Payment Gateways (SSLCommerz & bKash)',
    description: 'Checks server credentials & Sandbox/Live mode without creating any charge.',
    provider: 'payments',
    payload: { gateway: 'all' },
    safeForBatch: true,
    icon: CreditCard,
  },
  {
    key: 'couriers',
    title: 'Courier APIs (Steadfast, Pathao, RedX)',
    description: 'Checks API credentials & webhook secret without booking a fake parcel.',
    provider: 'couriers',
    safeForBatch: true,
    icon: Truck,
  },
  {
    key: 'email',
    title: 'Direct Email Gateway (Resend)',
    description: 'Checks Resend configuration; optional button sends a real test email.',
    provider: 'email',
    payload: { sendTestEmail: false },
    safeForBatch: true,
    icon: Mail,
  },
  {
    key: 'sms',
    title: 'Direct SMS Gateway (BulkSMSBD / Twilio)',
    description: 'Validates SMS credentials without consuming live SMS credits.',
    provider: 'sms',
    safeForBatch: true,
    icon: Smartphone,
  },
];

interface BackendDiagnosticsSuiteProps {
  getIdToken: () => Promise<string>;
  chatIdsOverride?: string;
}

export function BackendDiagnosticsSuite({
  getIdToken,
  chatIdsOverride,
}: BackendDiagnosticsSuiteProps) {
  const [results, setResults] = useState<Record<string, DiagnosticResult>>({});
  const [batchRunning, setBatchRunning] = useState(false);

  const runCheck = async (
    target: DiagnosticTarget,
    extraPayload?: Record<string, unknown>
  ) => {
    setResults((prev) => ({
      ...prev,
      [target.key]: { key: target.key, status: 'pending' },
    }));

    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/integrations/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider: target.provider,
          ...(target.payload || {}),
          ...(extraPayload || {}),
          ...(target.provider === 'telegram' && chatIdsOverride
            ? { chatIdsOverride }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      const status: DiagnosticResult['status'] =
        data.status === 'success' || data.status === 'failed' || data.status === 'not_configured'
          ? data.status
          : res.status === 503
            ? 'not_configured'
            : res.ok && data.ok
              ? 'success'
              : 'failed';

      setResults((prev) => ({
        ...prev,
        [target.key]: {
          key: target.key,
          status,
          whatTested: data.whatTested || target.description,
          detail:
            data.detail ||
            (data.ok
              ? data.botUsername
                ? `Verified @${data.botUsername} (${data.sentToChats ?? 1} chat).`
                : data.verifiedName
                  ? `Verified ${data.verifiedName} (${data.displayPhoneNumber || 'Graph API'}).`
                  : data.model
                    ? `Gemini model ${data.model} responded normally.`
                    : 'Verification passed.'
              : undefined),
          error: data.error,
          possibleReasons: Array.isArray(data.possibleReasons) ? data.possibleReasons : [],
          troubleshootingSteps: Array.isArray(data.troubleshootingSteps)
            ? data.troubleshootingSteps
            : [],
          testedAtIso: data.testedAtIso || new Date().toISOString(),
        },
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [target.key]: {
          key: target.key,
          status: 'failed',
          whatTested: target.description,
          error: err instanceof Error ? err.message : 'Network error while running test.',
          possibleReasons: ['Server request failed or admin session expired.'],
          troubleshootingSteps: ['Reload the Admin Dashboard and retry the check.'],
          testedAtIso: new Date().toISOString(),
        },
      }));
    }
  };

  const handleRunAllSafe = async () => {
    setBatchRunning(true);
    try {
      const safeTargets = DIAGNOSTIC_TARGETS.filter((t) => t.safeForBatch);
      await Promise.all(safeTargets.map((t) => runCheck(t)));
    } finally {
      setBatchRunning(false);
    }
  };

  const renderStatusLabel = (status: DiagnosticResult['status']) => {
    if (status === 'pending') {
      return (
        <span className="inline-flex items-center gap-1 font-mono text-xs text-[#8A5A17]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Pending
        </span>
      );
    }
    if (status === 'success') {
      return (
        <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Success
        </span>
      );
    }
    if (status === 'not_configured') {
      return (
        <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-[#635647]">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
          Not Configured
        </span>
      );
    }
    if (status === 'failed') {
      return (
        <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-red-700">
          <XCircle className="h-3.5 w-3.5" />
          Failed
        </span>
      );
    }
    return <span className="font-mono text-xs text-[#635647]">Test Required</span>;
  };

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold text-[#1E1710]">
              Backend Diagnostics &amp; Feature Verification Suite
            </h3>
            <HelpInfoButton section="diagnostics_suite" />
          </div>
          <p className="mt-0.5 text-xs text-[#635647]">
            Honest live server checks · Zero fake passes · Safe checks never create charges, book
            parcels, or burn SMS credits
          </p>
        </div>

        <button
          type="button"
          disabled={batchRunning}
          onClick={() => void handleRunAllSafe()}
          className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#1E1710] px-4 py-2 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
        >
          {batchRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          <span>Run All Safe Checks</span>
        </button>
      </div>

      {/* Diagnostic Cards Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {DIAGNOSTIC_TARGETS.map((target) => {
          const Icon = target.icon;
          const res = results[target.key] || { key: target.key, status: 'idle' };

          return (
            <div
              key={target.key}
              className="flex flex-col justify-between rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-5"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#8A5A17]" />
                    <div>
                      <h4 className="text-sm font-semibold text-[#1E1710]">{target.title}</h4>
                      <p className="mt-0.5 text-xs text-[#635647]">{target.description}</p>
                    </div>
                  </div>
                  <div className="shrink-0">{renderStatusLabel(res.status)}</div>
                </div>

                {/* Diagnostic Detail Output */}
                {res.status !== 'idle' && res.status !== 'pending' && (
                  <div className="mt-3.5 space-y-2 rounded-lg border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] p-3 text-xs">
                    {res.whatTested && (
                      <p className="text-[#635647]">
                        <span className="font-semibold text-[#1E1710]">Tested: </span>
                        {res.whatTested}
                      </p>
                    )}

                    {res.detail && (
                      <p className="text-emerald-900">
                        <span className="font-semibold">Result: </span>
                        {res.detail}
                      </p>
                    )}

                    {res.error && (
                      <p className="text-red-800">
                        <span className="font-semibold">Error: </span>
                        {res.error}
                      </p>
                    )}

                    {res.possibleReasons && res.possibleReasons.length > 0 && (
                      <div>
                        <p className="font-semibold text-[#1E1710]">Possible Reasons:</p>
                        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[#635647]">
                          {res.possibleReasons.map((reason, i) => (
                            <li key={i}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {res.troubleshootingSteps && res.troubleshootingSteps.length > 0 && (
                      <div>
                        <p className="font-semibold text-[#1E1710]">Troubleshooting:</p>
                        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[#635647]">
                          {res.troubleshootingSteps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(30,23,16,0.08)] pt-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={res.status === 'pending'}
                    onClick={() => void runCheck(target)}
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-3 py-1.5 text-xs font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50"
                  >
                    {res.status === 'pending' && <Loader2 className="h-3 w-3 animate-spin" />}
                    <span>{target.safeForBatch ? 'Run Check' : 'Send Test Ping'}</span>
                  </button>

                  {target.key === 'email' && (
                    <button
                      type="button"
                      disabled={res.status === 'pending'}
                      onClick={() => void runCheck(target, { sendTestEmail: true })}
                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-3 py-1.5 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
                    >
                      <Mail className="h-3 w-3 text-[#8A5A17]" />
                      <span>Send Test Email</span>
                    </button>
                  )}

                  {target.key === 'payments' && (
                    <button
                      type="button"
                      disabled={res.status === 'pending'}
                      onClick={() => void runCheck(target, { gateway: 'bkash' })}
                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-3 py-1.5 text-xs font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
                    >
                      <span>Test bKash Auth</span>
                    </button>
                  )}
                </div>

                {res.testedAtIso && (
                  <span className="font-mono text-[10px] tabular-nums text-[#635647]">
                    {new Date(res.testedAtIso).toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
