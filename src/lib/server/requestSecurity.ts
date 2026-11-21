import crypto from 'node:crypto';
import { getAdminApp } from '../firebaseAdmin';
import { isTestProcessRuntime } from './runtimeGuards';

const DEV_EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

export function getServerHmacSecret(envVarName: 'ORDER_TOKEN_SECRET' | 'CHANNEL_SESSION_SECRET' | 'TRACKING_TOKEN_SECRET'): string {
  const explicit = String(process.env[envVarName] || '').trim();
  if (explicit.length >= 16) return explicit;
  const fallbackOrderSecret = String(process.env.ORDER_TOKEN_SECRET || '').trim();
  if (fallbackOrderSecret.length >= 16) return fallbackOrderSecret;
  const fallbackSessionSecret = String(process.env.CHAT_SESSION_SECRET || '').trim();
  if (fallbackSessionSecret.length >= 16) return fallbackSessionSecret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[SECURITY_FATAL] Missing ${envVarName} (or ORDER_TOKEN_SECRET) in production environment.`
    );
  }
  return DEV_EPHEMERAL_SECRET;
}

/**
 * Generates a 192-bit CSPRNG tracking token and its keyed HMAC-SHA256 hash (Decision D14).
 */
export function generateTrackingTokenPair(): {
  trackingToken: string;
  trackingTokenHash: string;
} {
  const trackingToken = crypto.randomBytes(24).toString('base64url'); // 192 bits entropy
  const trackingTokenHash = hashTrackingToken(trackingToken);
  return { trackingToken, trackingTokenHash };
}

export function hashTrackingToken(token: string): string {
  const clean = String(token || '').trim();
  const secret = getServerHmacSecret('TRACKING_TOKEN_SECRET');
  return crypto.createHmac('sha256', secret).update(`track:${clean}`).digest('hex');
}

export function timingSafeHexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Keyed HMAC-SHA256 for order duplicate fingerprints & channel session IDs (Decision D16 / Stage 3.2).
 */
export function computeKeyedHmacDigest(
  namespace: string,
  parts: string[],
  envVarName: 'ORDER_TOKEN_SECRET' | 'CHANNEL_SESSION_SECRET' = 'ORDER_TOKEN_SECRET'
): string {
  const secret = getServerHmacSecret(envVarName);
  const payload = [namespace, ...parts.map((p) => String(p || '').trim().toLowerCase())].join('|');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export interface OriginCsrfResult {
  ok: boolean;
  reason?: string;
}

/**
 * Stage 2.6: Verifies X-Requested-With CSRF header and enforces same-origin when Origin/Referer is supplied.
 */
export function verifySameOriginAndCsrf(request: Request): OriginCsrfResult {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return { ok: false, reason: 'missing_csrf_header' };
  }

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (!origin && !referer) {
    // Non-browser fetch clients (including server/unit tests) with explicit CSRF header pass.
    return { ok: true };
  }

  const reqUrl = new URL(request.url);
  const allowedHosts = new Set<string>([
    reqUrl.host.toLowerCase(),
    'localhost:3000',
    '127.0.0.1:3000',
    'localhost',
  ]);
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    allowedHosts.add(forwardedHost.split(',')[0].trim().toLowerCase());
  }
  const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || '').trim();
  if (siteUrl) {
    try {
      allowedHosts.add(new URL(siteUrl).host.toLowerCase());
    } catch {
      // ignore invalid site URL
    }
  }

  const checkHeaderUrl = (raw: string | null): boolean => {
    if (!raw) return true;
    try {
      const parsed = new URL(raw);
      return allowedHosts.has(parsed.host.toLowerCase());
    } catch {
      return false;
    }
  };

  if (!checkHeaderUrl(origin) || !checkHeaderUrl(referer)) {
    return { ok: false, reason: 'cross_origin_rejected' };
  }

  return { ok: true };
}

export interface AppCheckVerifyResult {
  ok: boolean;
  enforced: boolean;
  reason?: string;
}

/**
 * Stage 2.6: Optional Firebase App Check verification hook controlled by APP_CHECK_ENFORCE=true.
 */
export async function verifyOptionalAppCheck(request: Request): Promise<AppCheckVerifyResult> {
  const enforced =
    process.env.APP_CHECK_ENFORCE === 'true' && !isTestProcessRuntime();
  const token = String(request.headers.get('x-firebase-appcheck') || '').trim();

  if (!enforced) {
    return { ok: true, enforced: false };
  }
  if (!token) {
    return { ok: false, enforced: true, reason: 'missing_app_check_token' };
  }
  try {
    const { getAppCheck } = await import('firebase-admin/app-check');
    await getAppCheck(getAdminApp()).verifyToken(token);
    return { ok: true, enforced: true };
  } catch {
    return { ok: false, enforced: true, reason: 'invalid_app_check_token' };
  }
}

/**
 * Combined guard for public mutating API endpoints.
 */
export async function enforcePublicMutationGuards(
  request: Request
): Promise<{ ok: true } | { ok: false; status: number; code: string; error: string }> {
  const csrf = verifySameOriginAndCsrf(request);
  if (!csrf.ok) {
    return {
      ok: false,
      status: 403,
      code: csrf.reason || 'invalid_origin',
      error: 'Invalid request origin header.',
    };
  }
  const appCheck = await verifyOptionalAppCheck(request);
  if (!appCheck.ok) {
    return {
      ok: false,
      status: 401,
      code: appCheck.reason || 'app_check_failed',
      error: 'App verification required. Please reload the page and try again.',
    };
  }
  return { ok: true };
}

export const ALLOWED_COURIER_TRACKING_DOMAINS = [
  'steadfast.com.bd',
  'packzy.com',
  'pathao.com',
  'redx.com.bd',
  'paperfly.com.bd',
  'ecourier.com.bd',
  'sundarbancourierltd.com',
] as const;

/**
 * 4-04: Strict allowlist for customer-clickable courier tracking URLs.
 * Blocks javascript:, data:, http:, and arbitrary phishing domains.
 */
export function isSafeCourierTrackingUrl(rawUrl: string | undefined | null): boolean {
  const clean = String(rawUrl || '').trim();
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_COURIER_TRACKING_DOMAINS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}
