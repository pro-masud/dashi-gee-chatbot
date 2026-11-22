import { NextResponse } from 'next/server';
import { verifyServerAdminToken } from '../chatbot/firestoreRest';
import { AdminSdkUnavailableError, getAdminDb, isAdminSdkCredentialOrIamError } from '../firebaseAdmin';
import {
  roleFromStaffDoc,
  roleHasPermission,
  type Permission,
  type Role,
} from '../auth/permissions';
import { isTestProcessRuntime } from './runtimeGuards';
import { verifySameOriginAndCsrf } from './requestSecurity';

/**
 * Shared guard for admin-only JSON APIs.
 * Order of checks: CSRF (mutations) → verified identity → role → permission → handler.
 *
 * Identity:
 *  - owner: the bootstrapped owner email or a legacy `admins/{uid}` document (full access)
 *  - staff: an active `staff/{uid}` document with a role (limited access)
 */

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export interface AdminActor {
  email: string;
  uid: string;
  role: Role;
}

export function jsonOk(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...body }, { status, headers: NO_STORE });
}

export function jsonError(error: string, status: number, code?: string): NextResponse {
  return NextResponse.json({ ok: false, error, ...(code ? { code } : {}) }, { status, headers: NO_STORE });
}

async function lookupStaffRole(uid: string): Promise<Role | null> {
  if (isTestProcessRuntime()) return null;
  try {
    const snap = await getAdminDb().collection('staff').doc(uid).get();
    return roleFromStaffDoc(snap.exists ? (snap.data() as { email?: string; role?: string; active?: boolean }) : null);
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    return null;
  }
}

export async function requireAdmin(
  request: Request,
  options: { mutation?: boolean; permission?: Permission; ownerOnly?: boolean } = {}
): Promise<{ actor: AdminActor } | { response: NextResponse }> {
  if (options.mutation) {
    const csrf = verifySameOriginAndCsrf(request);
    if (!csrf.ok) return { response: jsonError('Invalid request origin header.', 403, csrf.reason) };
  }

  const check = await verifyServerAdminToken(request.headers.get('authorization'));
  let actor: AdminActor | null = null;

  if (check.ok) {
    actor = { email: check.email, uid: check.uid, role: 'owner' };
  } else if (check.reason === 'not_an_admin' && check.uid) {
    const staffRole = await lookupStaffRole(check.uid).catch(() => null);
    if (staffRole) actor = { email: check.email, uid: check.uid, role: staffRole };
  }

  if (!actor) return { response: jsonError('Admin authorization required.', 401) };

  if (options.ownerOnly && actor.role !== 'owner') {
    return { response: jsonError('Only the store owner can do this.', 403, 'owner_only') };
  }
  if (options.permission && !roleHasPermission(actor.role, options.permission)) {
    return {
      response: jsonError('Your role does not have permission for this action.', 403, 'forbidden'),
    };
  }
  return { actor };
}

export function handleAdminError(err: unknown): NextResponse {
  if (err instanceof AdminSdkUnavailableError) {
    return jsonError(
      'Server database access is unavailable. Check Admin SDK credentials / IAM.',
      503,
      err.code
    );
  }
  console.error('[admin-api] unexpected error', err instanceof Error ? err.message : err);
  return jsonError('Unexpected server error.', 500);
}
