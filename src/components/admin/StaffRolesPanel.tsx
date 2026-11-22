'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { ASSIGNABLE_ROLES, ROLE_LABELS, type Role } from '../../lib/auth/permissions';
import { Card, EmptyState, PageHeader, StatusBadge } from './ui';

interface StaffRow {
  uid: string;
  email: string;
  role: Role;
  active: boolean;
  createdByEmail: string;
  createdAtIso: string;
}

export function StaffRolesPanel({ getIdToken }: { getIdToken: () => Promise<string> }) {
  const tokenRef = useRef(getIdToken);
  tokenRef.current = getIdToken;

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('call_agent');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

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
      const res = await authedFetch('/api/admin/staff');
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; staff?: StaffRow[] };
      if (!res.ok || !data.ok) {
        setError(data.error || `Could not load staff (HTTP ${res.status}).`);
        return;
      }
      setStaff(data.staff || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await authedFetch('/api/admin/staff', { method: 'POST', body: JSON.stringify({ email, role }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setMsg(data.error || 'Could not add staff member.');
        return;
      }
      setEmail('');
      setMsg('Staff member added.');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const patch = async (uid: string, body: { role?: Role; active?: boolean }) => {
    setMsg('');
    const res = await authedFetch('/api/admin/staff', { method: 'PATCH', body: JSON.stringify({ uid, ...body }) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      setMsg(data.error || 'Could not update.');
      return;
    }
    await load();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Staff & Roles" description="Give your team limited access. Roles are enforced on the server, not just hidden in the menu." />

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Add staff" description="They must sign in once at /admin with their Google account first." className="lg:col-span-1">
          <form onSubmit={add} className="space-y-4">
            <label className="block">
              <span className="block text-xs font-medium text-[#3F3328]">Google email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-[#3F3328]">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-3 py-2 text-base sm:text-sm"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r].label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-[#635647]">{ROLE_LABELS[role].description}</span>
            </label>
            <div className="flex items-center justify-between gap-3">
              <span role="status" className="text-xs font-medium text-[#8A5A17]">
                {msg}
              </span>
              <button
                type="submit"
                disabled={saving || !email}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#B47B2B] px-5 text-sm font-medium text-white hover:bg-[#96621B] disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Add</span>
              </button>
            </div>
          </form>
        </Card>

        <Card title="Team" description={`${staff.length} staff member${staff.length === 1 ? '' : 's'} (the owner always has full access)`} className="lg:col-span-2" bodyClassName="p-0">
          {loading && staff.length === 0 ? (
            <div className="flex items-center gap-2 p-5 text-sm text-[#635647]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : staff.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No staff yet" description="Add a call agent, delivery manager or accountant." />
            </div>
          ) : (
            <ul className="divide-y divide-[rgba(30,23,16,0.06)]">
              {staff.map((s) => (
                <li key={s.uid} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#1E1710]">{s.email}</p>
                    <p className="text-xs text-[#635647]">added by {s.createdByEmail || 'owner'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={s.active ? 'verified' : 'cancelled'} label={s.active ? 'Active' : 'Disabled'} />
                    <select
                      value={s.role}
                      onChange={(e) => void patch(s.uid, { role: e.target.value as Role })}
                      aria-label={`Role for ${s.email}`}
                      className="rounded-lg border border-[rgba(30,23,16,0.16)] bg-white px-2.5 py-1.5 text-xs"
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r].label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void patch(s.uid, { active: !s.active })}
                      className="rounded-lg border border-[rgba(30,23,16,0.16)] px-3 py-1.5 text-xs font-medium hover:bg-[#F4EFE6]"
                    >
                      {s.active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="What each role can do">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['owner', ...ASSIGNABLE_ROLES] as Role[]).map((r) => (
            <div key={r} className="rounded-xl border border-[rgba(30,23,16,0.08)] bg-[#FAF7F2] p-4">
              <p className="text-sm font-semibold text-[#1E1710]">{ROLE_LABELS[r].label}</p>
              <p className="mt-1 text-xs leading-relaxed text-[#635647]">{ROLE_LABELS[r].description}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
