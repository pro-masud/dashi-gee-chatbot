import { NextResponse } from 'next/server';
import { verifyServerAdminToken } from '../chatbot/firestoreRest';
import { AdminSdkUnavailableError } from '../firebaseAdmin';
import { verifySameOriginAndCsrf } from './requestSecurity';

/**
 * Shared guard for admin-only JSON APIs.
 * Every admin route: verified admin token → (mutations) same-origin/CSRF check → handler.
 * Role-based permissions plug in here later without touching individual routes.
 */

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export interface AdminActor {
  email: string;
  uid: string;
}

export function jsonOk(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...body }, { status, headers: NO_STORE });
}

export function jsonError(error: string, status: number, code?: string): NextResponse {
  return NextResponse.json({ ok: false, error, ...(code ? { code } : {}) }, { status, headers: NO_STORE });
}

export async function requireAdmin(
  request: Request,
  options: { mutation?: boolean } = {}
): Promise<{ actor: AdminActor } | { response: NextResponse }> {
  if (options.mutation) {
    const csrf = verifySameOriginAndCsrf(request);
    if (!csrf.ok) return { response: jsonError('Invalid request origin header.', 403, csrf.reason) };
  }
  const check = await verifyServerAdminToken(request.headers.get('authorization'));
  if (!check.ok) return { response: jsonError('Admin authorization required.', 401) };
  return { actor: { email: check.email, uid: check.uid } };
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
