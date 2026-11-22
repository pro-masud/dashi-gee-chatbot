'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Search } from 'lucide-react';
import { Card, EmptyState, PageHeader } from './ui';

interface Entry {
  id: string;
  action: string;
  resource: string;
  actorEmail: string;
  before: unknown;
  after: unknown;
  atIso: string;
}

const dhaka = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dhaka',
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function ActivityLogPanel({ getIdToken }: { getIdToken: () => Promise<string> }) {
  const tokenRef = useRef(getIdToken);
  tokenRef.current = getIdToken;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = await tokenRef.current();
      const res = await fetch('/api/admin/activity?limit=300', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; entries?: Entry[] };
      if (!res.ok || !data.ok) {
        setError(data.error || `Could not load activity (HTTP ${res.status}).`);
        return;
      }
      setEntries(data.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) => `${e.action} ${e.resource} ${e.actorEmail}`.toLowerCase().includes(needle));
  }, [entries, q]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity Log"
        description="Who changed what, and when. Entries are read-only and cannot be edited or deleted here."
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[rgba(30,23,16,0.14)] bg-white px-3.5 text-xs font-medium hover:bg-[#F4EFE6] disabled:opacity-60"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Refresh</span>
          </button>
        }
      />

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A7867]" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by action, order, or person"
          aria-label="Filter activity"
          className="min-h-[42px] w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white pl-9 pr-3 text-base focus:border-[#B47B2B] focus:outline-none sm:text-sm"
        />
      </div>

      <Card title={`${filtered.length} entries`} bodyClassName="p-0">
        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No activity found" />
          </div>
        ) : (
          <ul className="divide-y divide-[rgba(30,23,16,0.06)]">
            {filtered.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setOpen(open === e.id ? null : e.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3 text-left hover:bg-[#FAF7F2]"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-semibold text-[#1E1710]">{e.action}</span>
                    <span className="block truncate text-xs text-[#635647]">
                      {e.resource} · {e.actorEmail || 'system'}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-[#8A7867]">
                    {e.atIso ? dhaka.format(new Date(e.atIso)) : ''}
                  </span>
                </button>
                {open === e.id && (
                  <div className="grid grid-cols-1 gap-3 bg-[#FAF7F2] px-5 pb-4 text-[11px] sm:grid-cols-2">
                    <div>
                      <p className="mb-1 font-semibold text-[#635647]">Before</p>
                      <pre className="max-h-48 overflow-auto rounded-lg bg-white p-3 font-mono">{JSON.stringify(e.before, null, 2)}</pre>
                    </div>
                    <div>
                      <p className="mb-1 font-semibold text-[#635647]">After</p>
                      <pre className="max-h-48 overflow-auto rounded-lg bg-white p-3 font-mono">{JSON.stringify(e.after, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
