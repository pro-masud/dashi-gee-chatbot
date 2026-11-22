import { createHash } from 'node:crypto';
import {
  buildCapiBody,
  eventIdFor,
  phoneForMeta,
  type CapiEventInput,
  type MarketingLogRow,
  type ServerEventName,
} from '../marketing/marketing';
import { extractClientIp } from '../chatbot/rateLimit';
import {
  hasSentEvent,
  readCapiTokenServerOnly,
  readTrackingState,
  writeEventLog,
} from './marketingRepository';
import { isTestProcessRuntime } from './runtimeGuards';

const GRAPH_VERSION = 'v19.0';

export const sha256 = (v: string): string => createHash('sha256').update(v.trim().toLowerCase()).digest('hex');

export interface CapiResult {
  ok: boolean;
  httpStatus: number;
  detail: string;
}

/**
 * Send one event to Meta's Conversions API.
 * Success means Meta answered HTTP 200 AND reported events_received >= 1 — nothing else counts.
 * `fetchImpl` is injectable so tests never touch the network.
 */
export async function postToMeta(
  pixelId: string,
  token: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3500
): Promise<CapiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as {
      events_received?: number;
      error?: { message?: string; code?: number };
    };
    if (res.ok && (json.events_received ?? 0) >= 1) {
      return { ok: true, httpStatus: res.status, detail: `Meta received ${json.events_received} event(s).` };
    }
    return {
      ok: false,
      httpStatus: res.status,
      detail: json.error?.message ? `Meta error: ${json.error.message}`.slice(0, 300) : `Unexpected response (HTTP ${res.status}).`,
    };
  } catch (err) {
    return { ok: false, httpStatus: 0, detail: err instanceof Error ? `Request failed: ${err.message}`.slice(0, 300) : 'Request failed.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Send a manual test event with the stored credentials (uses the real provider; never faked). */
export async function sendTestEvent(siteUrl: string, fetchImpl: typeof fetch = fetch): Promise<CapiResult & { skipped?: string }> {
  const state = await readTrackingState();
  if (!state.settings.pixelId) return { ok: false, httpStatus: 0, detail: 'Enter your Pixel ID first.', skipped: 'no_pixel' };
  const token = await readCapiTokenServerOnly();
  if (!token) return { ok: false, httpStatus: 0, detail: 'No access token saved (or it could not be decrypted).', skipped: 'no_token' };

  const eventId = `test_${Date.now()}`;
  const event: CapiEventInput = {
    eventName: 'ViewContent',
    eventId,
    eventTimeSec: Math.floor(Date.now() / 1000),
    sourceUrl: siteUrl,
    userAgent: 'DeshiGee-AdminTest',
    valueBdt: 1,
  };
  const result = await postToMeta(state.settings.pixelId, token, buildCapiBody(event, state.settings.testEventCode), fetchImpl);
  const row: MarketingLogRow = {
    id: eventId,
    eventName: 'ViewContent (test)',
    eventId,
    orderNumber: '',
    ok: result.ok,
    httpStatus: result.httpStatus,
    detail: result.detail,
    test: true,
    atIso: new Date().toISOString(),
  };
  await writeEventLog(row).catch(() => undefined);
  return result;
}

function readCookie(header: string, name: string): string {
  const m = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}

export interface OrderEventInput {
  orderNumber: string;
  phone: string;
  customerName: string;
  totalBdt: number;
  jarCount: number;
}

/**
 * Report an order event (Purchase on order, OrderConfirmed / OrderDelivered later) to Meta.
 * Best effort: never throws, never blocks an order for more than a few seconds, and is idempotent —
 * the same event id is sent successfully at most once.
 */
export async function reportOrderEvent(
  name: ServerEventName,
  order: OrderEventInput,
  request: Request | null,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if (isTestProcessRuntime()) return;
  try {
    const state = await readTrackingState();
    if (!state.settings.capiEnabled || !state.settings.pixelId) return;
    const token = await readCapiTokenServerOnly();
    if (!token) return;

    const eventId = eventIdFor(name, order.orderNumber);
    if (await hasSentEvent(eventId)) return; // prevents repeated Purchase for one order

    const cookies = request?.headers.get('cookie') || '';
    const event: CapiEventInput = {
      eventName: name,
      eventId,
      eventTimeSec: Math.floor(Date.now() / 1000),
      sourceUrl: request?.headers.get('referer') || process.env.NEXT_PUBLIC_SITE_URL || 'https://localhost',
      hashedPhone: sha256(phoneForMeta(order.phone)),
      hashedName: order.customerName ? sha256(order.customerName) : undefined,
      clientIp: request ? extractClientIp(request) : undefined,
      userAgent: request?.headers.get('user-agent') || undefined,
      fbp: readCookie(cookies, '_fbp') || undefined,
      fbc: readCookie(cookies, '_fbc') || undefined,
      valueBdt: order.totalBdt,
      orderNumber: order.orderNumber,
      numItems: order.jarCount,
    };
    const result = await postToMeta(state.settings.pixelId, token, buildCapiBody(event, state.settings.testEventCode), fetchImpl);
    await writeEventLog({
      id: eventId,
      eventName: name,
      eventId,
      orderNumber: order.orderNumber,
      ok: result.ok,
      httpStatus: result.httpStatus,
      detail: result.detail,
      test: Boolean(state.settings.testEventCode),
      atIso: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[capi] report failed', err instanceof Error ? err.message : err);
  }
}
