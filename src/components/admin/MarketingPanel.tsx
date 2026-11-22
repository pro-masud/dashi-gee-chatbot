'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { EMPTY_TRACKING, type MarketingLogRow, type TrackingSettings } from '../../lib/marketing/marketing';
import { Card, EmptyState, PageHeader, StatusBadge, TextField, ToggleField } from './ui';

interface State {
  settings: TrackingSettings;
  hasToken: boolean;
  tokenHint: string;
  encryptionConfigured: boolean;
}

const dhaka = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'medium' });

export function MarketingPanel({ getIdToken }: { getIdToken: () => Promise<string> }) {
  const tokenRef = useRef(getIdToken);
  tokenRef.current = getIdToken;

  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState<TrackingSettings>(EMPTY_TRACKING);
  const [newToken, setNewToken] = useState('');
  const [logs, setLogs] = useState<MarketingLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const authedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    const token = await tokenRef.current();
    return fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
        'x-requested-with': 'DeshiGeeStorefront',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authedFetch('/api/admin/marketing');
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; state?: State; logs?: MarketingLogRow[] };
      if (!res.ok || !data.ok || !data.state) {
        setError(data.error || `Could not load settings (HTTP ${res.status}).`);
        return;
      }
      setState(data.state);
      setDraft(data.state.settings);
      setLogs(data.logs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (e: FormEvent, clearToken = false) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMsg('');
    setError('');
    try {
      const res = await authedFetch('/api/admin/marketing', {
        method: 'PUT',
        body: JSON.stringify({ settings: draft, token: newToken || undefined, clearToken }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; state?: State };
      if (!res.ok || !data.ok || !data.state) {
        setError(data.error || 'Could not save.');
        return;
      }
      setState(data.state);
      setDraft(data.state.settings);
      setNewToken('');
      setMsg(clearToken ? 'Token removed.' : 'Saved.');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const res = await authedFetch('/api/admin/marketing/test', { method: 'POST', body: '{}' });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; result?: { ok: boolean; detail: string } };
      if (!res.ok || !data.ok || !data.result) {
        setTestResult({ ok: false, detail: data.error || 'Test could not be sent.' });
      } else {
        setTestResult(data.result);
      }
      await load();
    } finally {
      setTesting(false);
    }
  };

  const dirty = state ? JSON.stringify(draft) !== JSON.stringify(state.settings) || newToken.length > 0 : false;

  return (
    <div className="space-y-6">
      <PageHeader title="Facebook Ads & Tracking" description="Connect your Pixel, Google tags and the Meta Conversions API. Secrets are stored encrypted and never shown again." />

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={(e) => void save(e)} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Browser tracking" description="Public ids. The storefront loads these scripts for visitors.">
          <div className="space-y-4">
            <TextField label="Meta Pixel ID" mono value={draft.pixelId} onChange={(v) => setDraft({ ...draft, pixelId: v })} placeholder="1234567890123456" />
            <TextField label="Google Analytics 4 ID" mono value={draft.ga4Id} onChange={(v) => setDraft({ ...draft, ga4Id: v })} placeholder="G-XXXXXXXXXX" />
            <TextField label="Google Tag Manager ID" mono value={draft.gtmId} onChange={(v) => setDraft({ ...draft, gtmId: v })} placeholder="GTM-XXXXXXX" />
            <TextField label="Google Ads ID" mono value={draft.googleAdsId} onChange={(v) => setDraft({ ...draft, googleAdsId: v })} placeholder="AW-123456789" />
            <p className="text-xs text-[#635647]">Events sent from the browser: ViewContent, AddToCart, InitiateCheckout and Purchase. Each carries an event id for de-duplication.</p>
          </div>
        </Card>

        <Card title="Meta Conversions API (server side)" description="Sends order events from your server so ad blockers cannot hide them.">
          <div className="space-y-4">
            <ToggleField label="Send server events" description="Purchase on order, plus OrderConfirmed and OrderDelivered when you update the order." checked={draft.capiEnabled} onChange={(v) => setDraft({ ...draft, capiEnabled: v })} />

            <div>
              <span className="block text-xs font-medium text-[#3F3328]">Access token</span>
              {state?.hasToken ? (
                <p className="mt-1 flex items-center gap-2 text-xs text-emerald-800">
                  <ShieldCheck className="h-4 w-4" /> Saved ({state.tokenHint}). Stored encrypted — it cannot be read back.
                </p>
              ) : (
                <p className="mt-1 text-xs text-[#8A7867]">No token saved yet.</p>
              )}
              <input
                type="password"
                autoComplete="off"
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
                placeholder={state?.hasToken ? 'Paste a new token to replace it' : 'Paste your Conversions API access token'}
                className="mt-2 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 font-mono text-base sm:text-sm"
              />
              {state && !state.encryptionConfigured && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Server setting missing: <code>INTEGRATION_SECRET_KEY</code> (32+ characters). Without it a token cannot be saved safely.
                </p>
              )}
            </div>

            <TextField label="Test event code (optional)" mono value={draft.testEventCode} onChange={(v) => setDraft({ ...draft, testEventCode: v })} placeholder="TEST12345" hint="from Events Manager → Test events" />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span role="status" className="text-xs font-medium text-[#8A5A17]">{msg}</span>
              <div className="flex gap-2">
                {state?.hasToken && (
                  <button type="button" disabled={saving} onClick={(e) => void save(e as unknown as FormEvent, true)} className="rounded-lg border border-[rgba(30,23,16,0.14)] px-3 py-2 text-xs font-medium hover:bg-[#F4EFE6] disabled:opacity-50">
                    Remove token
                  </button>
                )}
                <button type="submit" disabled={saving || !dirty} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#B47B2B] px-5 text-sm font-medium text-white hover:bg-[#96621B] disabled:opacity-50">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>Save</span>
                </button>
              </div>
            </div>
          </div>
        </Card>
      </form>

      <Card title="Send a test event" description="Uses the saved Pixel ID and token against Meta for real. Success is shown only if Meta confirms it received the event.">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void runTest()} disabled={testing || !state?.hasToken || !state?.settings.pixelId} className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#1E1710] px-5 text-sm font-medium text-[#FAF7F2] hover:bg-[#35291E] disabled:opacity-50">
            {testing && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>Send test event</span>
          </button>
          {testResult && (
            <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${testResult.ok ? 'text-emerald-800' : 'text-red-800'}`}>
              {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {testResult.detail}
            </span>
          )}
        </div>
        <p className="mt-3 text-xs text-[#635647]">Save your changes first. Nothing here is verified until a test succeeds — an empty log means no event has been sent yet.</p>
      </Card>

      <Card title="Server event log" description={loading ? 'Loading…' : `${logs.length} recent events`} bodyClassName="p-0">
        {logs.length === 0 ? (
          <div className="p-5"><EmptyState title="No server events yet" description="Events appear after an order is placed or a test is sent." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-[#FAF7F2] uppercase tracking-wide text-[#8A7867]">
                <tr>{['Time', 'Event', 'Order', 'Result', 'Detail'].map((h) => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-[rgba(30,23,16,0.06)]">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-[#FAF7F2]">
                    <td className="px-4 py-2.5 tabular-nums">{dhaka.format(new Date(l.atIso))}</td>
                    <td className="px-4 py-2.5 font-mono">{l.eventName}{l.test ? ' · test' : ''}</td>
                    <td className="px-4 py-2.5 font-mono">{l.orderNumber || '—'}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={l.ok ? 'verified' : 'failed'} label={l.ok ? 'Received' : `Failed ${l.httpStatus || ''}`} /></td>
                    <td className="max-w-[320px] truncate px-4 py-2.5 text-[#635647]" title={l.detail}>{l.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
