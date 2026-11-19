import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { checkAndIncrementFirestoreRateLimit } from './firestoreRest';
import { extractClientIp, hashIdentifier } from './rateLimit';

export const SESSION_COOKIE_NAME = 'dg_chat_sess';
const SESSION_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

const globalSessionSecretHolder = globalThis as unknown as {
  __deshiGeeSessionAuthSecret?: string;
};

function getSessionAuthSecret(): string {
  const fromEnv =
    (process.env.ORDER_TOKEN_SECRET || '').trim() ||
    (process.env.SESSION_COOKIE_SECRET || '').trim() ||
    (process.env.RATE_LIMIT_SALT || '').trim();
  if (fromEnv.length >= 16) return fromEnv;
  if (!globalSessionSecretHolder.__deshiGeeSessionAuthSecret) {
    globalSessionSecretHolder.__deshiGeeSessionAuthSecret = randomBytes(32).toString('hex');
  }
  return globalSessionSecretHolder.__deshiGeeSessionAuthSecret;
}

/**
 * Generates an unguessable >= 128-bit random session ID (`dg_` + 32 hex chars = 128 bits entropy).
 */
export function generateSecureSessionId(): string {
  return `dg_${randomBytes(16).toString('hex')}`;
}

export function isValidSessionIdFormat(sessionId: string): boolean {
  return /^[a-zA-Z0-9_-]{4,64}$/.test(sessionId);
}

export function isHighEntropySessionId(sessionId: string): boolean {
  return /^dg_[a-f0-9]{32,64}$/.test(sessionId);
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const map: Record<string, string> = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k && v) {
      try {
        map[k] = decodeURIComponent(v);
      } catch {
        map[k] = v;
      }
    }
  }
  return map;
}

export function signSessionCookieValue(sessionId: string): string {
  const sig = createHmac('sha256', getSessionAuthSecret())
    .update(`dg-chat-sess-v1:${sessionId}`)
    .digest('base64url');
  return `${sessionId}.${sig}`;
}

export function verifySessionCookieValue(rawToken: string): string | null {
  if (!rawToken || !rawToken.includes('.')) return null;
  const dotIdx = rawToken.lastIndexOf('.');
  if (dotIdx <= 0) return null;
  const sessionId = rawToken.slice(0, dotIdx);
  const sig = rawToken.slice(dotIdx + 1);
  if (!isValidSessionIdFormat(sessionId) || !sig || sig.length < 32) return null;

  const expected = createHmac('sha256', getSessionAuthSecret())
    .update(`dg-chat-sess-v1:${sessionId}`)
    .digest('base64url');

  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sessionId;
}

export function buildSessionSetCookieHeader(sessionId: string): string {
  const value = signSessionCookieValue(sessionId);
  const isProd = process.env.NODE_ENV === 'production';
  const secureFlag = isProd ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SEC}; HttpOnly; SameSite=Lax${secureFlag}`;
}

export function extractVerifiedSessionIdFromRequest(request: Request): string | null {
  const cookies = parseCookies(request.headers.get('cookie'));
  const raw = cookies[SESSION_COOKIE_NAME];
  if (!raw) return null;
  return verifySessionCookieValue(raw);
}

/**
 * Verifies that the request carries a valid signed HttpOnly cookie bound specifically
 * to `requestedSessionId`. Prevents cross-session reads/deletes by guessing or scraping IDs.
 */
export function verifyRequestOwnsSession(request: Request, requestedSessionId: string): boolean {
  if (!isValidSessionIdFormat(requestedSessionId)) return false;
  const verified = extractVerifiedSessionIdFromRequest(request);
  if (!verified) return false;
  const a = Buffer.from(verified, 'utf8');
  const b = Buffer.from(requestedSessionId, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Dedicated session-poll rate limiter that does NOT touch chat Gemini quotas.
 * Allows up to 24 polls/minute per session + 120 polls/minute per CGNAT IP.
 */
export async function checkSessionPollRateLimit(params: {
  request: Request;
  sessionId: string;
}): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const sessHash = hashIdentifier(`poll_sess:${params.sessionId}`);
  const ipHash = hashIdentifier(`poll_ip:${extractClientIp(params.request)}`);

  const [sessBucket, ipBucket] = await Promise.all([
    checkAndIncrementFirestoreRateLimit(`sess_poll_min_${sessHash}`, 24, 60_000),
    checkAndIncrementFirestoreRateLimit(`sess_poll_ip_${ipHash}`, 120, 60_000),
  ]);

  if (!sessBucket.allowed || !ipBucket.allowed) {
    return {
      allowed: false,
      retryAfterSec: Math.max(sessBucket.retryAfterSec, ipBucket.retryAfterSec, 10),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Creates a signed, expiring token proving phone ownership for one-click unsubscribe
 * or consent updates (S0-03). Format: `<expUnixSec>.<base64url-hmac>`.
 */
export function createSignedUnsubscribeToken(
  phone: string,
  ttlSec = 60 * 60 * 24 * 30,
  nowSec = Math.floor(Date.now() / 1000)
): string {
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  const exp = nowSec + Math.max(60, ttlSec);
  const sig = createHmac('sha256', getSessionAuthSecret())
    .update(`dg-unsub-v1:${cleanPhone}:${exp}`)
    .digest('base64url');
  return `${exp}.${sig}`;
}

export function verifySignedUnsubscribeToken(token: string, expectedPhone: string): boolean {
  const raw = String(token || '').trim();
  const cleanPhone = String(expectedPhone || '').replace(/\D/g, '');
  if (!raw || !raw.includes('.') || !/^01[3-9][0-9]{8}$/.test(cleanPhone)) return false;

  const dotIdx = raw.indexOf('.');
  const expStr = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000) || sig.length < 32) {
    return false;
  }

  const expectedSig = createHmac('sha256', getSessionAuthSecret())
    .update(`dg-unsub-v1:${cleanPhone}:${exp}`)
    .digest('base64url');

  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

