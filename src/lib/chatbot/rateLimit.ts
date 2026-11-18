import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { CHATBOT_BUILD_CONFIG } from './build-config';
import { checkAndIncrementFirestoreRateLimit } from './firestoreRest';
import { getTodayBstDateKey } from './security';

const DEVICE_COOKIE_NAME = 'dg_device_id';
const DEVICE_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

const globalCookieSecretHolder = globalThis as unknown as {
  __deshiGeeDeviceCookieSecret?: string;
};

function getDeviceCookieSecret(): string {
  const fromEnv =
    (process.env.ORDER_TOKEN_SECRET || '').trim() ||
    (process.env.RATE_LIMIT_SALT || '').trim();
  if (fromEnv.length >= 16) return fromEnv;
  if (!globalCookieSecretHolder.__deshiGeeDeviceCookieSecret) {
    globalCookieSecretHolder.__deshiGeeDeviceCookieSecret = randomBytes(32).toString('hex');
  }
  return globalCookieSecretHolder.__deshiGeeDeviceCookieSecret;
}

export function hashIdentifier(raw: string): string {
  return createHash('sha256')
    .update(`deshi-gee-id-v1:${raw}`)
    .digest('hex')
    .slice(0, 24);
}

export function extractClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'unknown_ip';
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const map: Record<string, string> = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k && v) map[k] = decodeURIComponent(v);
  }
  return map;
}

function verifyDeviceCookieValue(token: string): string | null {
  if (!token || !token.includes('.')) return null;
  const [id, sig] = token.split('.');
  if (!id || !sig || !/^[a-f0-9]{24}$/.test(id)) return null;
  const expected = createHmac('sha256', getDeviceCookieSecret())
    .update(id)
    .digest('base64url')
    .slice(0, 22);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

function mintDeviceCookieValue(): { id: string; setCookieHeader: string } {
  const id = randomBytes(12).toString('hex');
  const sig = createHmac('sha256', getDeviceCookieSecret())
    .update(id)
    .digest('base64url')
    .slice(0, 22);
  const value = `${id}.${sig}`;
  const isProd = process.env.NODE_ENV === 'production';
  const secureFlag = isProd ? '; Secure' : '';
  const setCookieHeader = `${DEVICE_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE_SEC}; HttpOnly; SameSite=Lax${secureFlag}`;
  return { id, setCookieHeader };
}

export interface ChatRateLimitResult {
  allowed: boolean;
  reason?: 'device_rate_limit' | 'cgnat_ip_limit' | 'global_daily_cap';
  retryAfterSec: number;
  deviceHash: string;
  ipHash: string;
  setCookieHeader?: string;
  globalAllowed: boolean;
}

/**
 * Evaluates CGNAT-safe composite rate limits:
 * - Primary throttling uses a server-signed first-party device cookie (fallback to sessionId hash only for that check)
 *   so distinct mobile users behind a shared ISP NAT IP do not exhaust each other's quota.
 * - Shared IP uses a generous CGNAT ceiling (120/min, 1500/day) keyed by hashed IP.
 */
export async function checkCompositeChatRateLimit(params: {
  request: Request;
  sessionId: string;
  dailyGlobalCap: number;
}): Promise<ChatRateLimitResult> {
  const { request, sessionId, dailyGlobalCap } = params;
  const cookies = parseCookies(request.headers.get('cookie'));
  const existingDeviceId = verifyDeviceCookieValue(cookies[DEVICE_COOKIE_NAME] || '');

  let setCookieHeader: string | undefined;
  let deviceKeySeed: string;

  if (existingDeviceId) {
    deviceKeySeed = `dev:${existingDeviceId}`;
  } else {
    const minted = mintDeviceCookieValue();
    setCookieHeader = minted.setCookieHeader;
    // Key first-request limit by client session hash so cookie-less burst callers can't bypass per-session throttling
    deviceKeySeed = `sess:${sessionId}`;
  }

  const clientIp = extractClientIp(request);
  const ipHash = hashIdentifier(clientIp);
  const deviceHash = hashIdentifier(deviceKeySeed);
  const bstDate = getTodayBstDateKey();

  const [devMin, devDay, ipMin, ipDay, globalDay] = await Promise.all([
    checkAndIncrementFirestoreRateLimit(
      `chat_dev_min_${deviceHash}`,
      CHATBOT_BUILD_CONFIG.DEVICE_PER_MIN,
      60_000
    ),
    checkAndIncrementFirestoreRateLimit(
      `chat_dev_day_${deviceHash}_${bstDate}`,
      CHATBOT_BUILD_CONFIG.DEVICE_PER_DAY,
      24 * 60 * 60 * 1000
    ),
    checkAndIncrementFirestoreRateLimit(
      `chat_cgnat_ip_min_${ipHash}`,
      CHATBOT_BUILD_CONFIG.CGNAT_IP_PER_MIN,
      60_000
    ),
    checkAndIncrementFirestoreRateLimit(
      `chat_cgnat_ip_day_${ipHash}_${bstDate}`,
      CHATBOT_BUILD_CONFIG.CGNAT_IP_PER_DAY,
      24 * 60 * 60 * 1000
    ),
    checkAndIncrementFirestoreRateLimit(
      `chat_global_day_${bstDate}`,
      dailyGlobalCap,
      24 * 60 * 60 * 1000
    ),
  ]);

  if (!devMin.allowed || !devDay.allowed) {
    const retryAfterSec = Math.max(devMin.retryAfterSec, devDay.retryAfterSec, 15);
    return {
      allowed: false,
      reason: 'device_rate_limit',
      retryAfterSec,
      deviceHash,
      ipHash,
      setCookieHeader,
      globalAllowed: globalDay.allowed,
    };
  }

  if (!ipMin.allowed || !ipDay.allowed) {
    const retryAfterSec = Math.max(ipMin.retryAfterSec, ipDay.retryAfterSec, 30);
    return {
      allowed: false,
      reason: 'cgnat_ip_limit',
      retryAfterSec,
      deviceHash,
      ipHash,
      setCookieHeader,
      globalAllowed: globalDay.allowed,
    };
  }

  return {
    allowed: true,
    retryAfterSec: 0,
    deviceHash,
    ipHash,
    setCookieHeader,
    globalAllowed: globalDay.allowed,
  };
}

export async function checkCompositeOrderRateLimit(params: {
  request: Request;
  sessionId: string;
}): Promise<{ allowed: boolean; retryAfterSec: number; setCookieHeader?: string }> {
  const { request, sessionId } = params;
  const cookies = parseCookies(request.headers.get('cookie'));
  const existingDeviceId = verifyDeviceCookieValue(cookies[DEVICE_COOKIE_NAME] || '');
  let setCookieHeader: string | undefined;
  let deviceSeed = `sess:${sessionId}`;

  if (existingDeviceId) {
    deviceSeed = `dev:${existingDeviceId}`;
  } else {
    const minted = mintDeviceCookieValue();
    setCookieHeader = minted.setCookieHeader;
  }

  const clientIp = extractClientIp(request);
  const ipHash = hashIdentifier(clientIp);
  const deviceHash = hashIdentifier(deviceSeed);

  const [devRate, ipRate] = await Promise.all([
    checkAndIncrementFirestoreRateLimit(
      `order_dev_min_${deviceHash}`,
      CHATBOT_BUILD_CONFIG.ORDER_DEVICE_PER_MIN,
      60_000
    ),
    checkAndIncrementFirestoreRateLimit(
      `order_ip_min_${ipHash}`,
      CHATBOT_BUILD_CONFIG.ORDER_IP_PER_MIN,
      60_000
    ),
  ]);

  if (!devRate.allowed || !ipRate.allowed) {
    return {
      allowed: false,
      retryAfterSec: Math.max(devRate.retryAfterSec, ipRate.retryAfterSec, 30),
      setCookieHeader,
    };
  }

  return { allowed: true, retryAfterSec: 0, setCookieHeader };
}
