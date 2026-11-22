/**
 * Marketing & tracking — pure rules, browser-safe (no server imports, no secrets).
 *
 * Browser sends events with an `event_id`; the server sends the same event through the Meta
 * Conversions API with the SAME id, so Meta de-duplicates them. The CAPI access token never
 * leaves the server.
 */

export interface TrackingSettings {
  pixelId: string;
  ga4Id: string;
  gtmId: string;
  googleAdsId: string;
  capiEnabled: boolean;
  /** Optional Meta "Test Events" code; while set, server events appear in Events Manager's test tab. */
  testEventCode: string;
}

export const EMPTY_TRACKING: TrackingSettings = {
  pixelId: '',
  ga4Id: '',
  gtmId: '',
  googleAdsId: '',
  capiEnabled: false,
  testEventCode: '',
};

export function validateTrackingSettings(
  raw: unknown
): { ok: true; value: TrackingSettings } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid settings.' };
  const b = raw as Record<string, unknown>;
  const s = (k: string, max: number) => String(b[k] ?? '').trim().slice(0, max);

  const pixelId = s('pixelId', 20);
  const ga4Id = s('ga4Id', 20).toUpperCase();
  const gtmId = s('gtmId', 20).toUpperCase();
  const googleAdsId = s('googleAdsId', 24).toUpperCase();
  const testEventCode = s('testEventCode', 30).toUpperCase();

  if (pixelId && !/^\d{8,20}$/.test(pixelId)) return { ok: false, error: 'Pixel ID must be 8–20 digits.' };
  if (ga4Id && !/^G-[A-Z0-9]{6,14}$/.test(ga4Id)) return { ok: false, error: 'GA4 ID looks like G-XXXXXXXXXX.' };
  if (gtmId && !/^GTM-[A-Z0-9]{4,10}$/.test(gtmId)) return { ok: false, error: 'GTM ID looks like GTM-XXXXXXX.' };
  if (googleAdsId && !/^AW-\d{6,14}$/.test(googleAdsId)) return { ok: false, error: 'Google Ads ID looks like AW-123456789.' };
  if (testEventCode && !/^TEST[A-Z0-9]{2,20}$/.test(testEventCode)) return { ok: false, error: 'Test event code looks like TEST12345.' };

  const capiEnabled = b.capiEnabled === true;
  if (capiEnabled && !pixelId) return { ok: false, error: 'Enter your Pixel ID before enabling server events.' };

  return { ok: true, value: { pixelId, ga4Id, gtmId, googleAdsId, capiEnabled, testEventCode } };
}

/** Only these fields are ever sent to browsers (public ids, no secrets). */
export function toPublicTracking(s: TrackingSettings): Pick<TrackingSettings, 'pixelId' | 'ga4Id' | 'gtmId' | 'googleAdsId'> {
  return { pixelId: s.pixelId, ga4Id: s.ga4Id, gtmId: s.gtmId, googleAdsId: s.googleAdsId };
}

export type ServerEventName = 'Purchase' | 'OrderConfirmed' | 'OrderDelivered' | 'ViewContent' | 'InitiateCheckout';

/** Identifier shared by the browser and the server for the same order event. */
export function eventIdFor(name: ServerEventName, orderNumber: string): string {
  return `${name.toLowerCase()}_${orderNumber}`;
}

/** Meta wants digits only with country code, e.g. 8801712345678, before SHA-256. */
export function phoneForMeta(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('880')) return digits;
  if (digits.startsWith('0')) return `880${digits.slice(1)}`;
  return digits;
}

export interface CapiEventInput {
  eventName: ServerEventName;
  eventId: string;
  eventTimeSec: number;
  sourceUrl: string;
  hashedPhone?: string;
  hashedName?: string;
  clientIp?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
  valueBdt?: number;
  orderNumber?: string;
  contentIds?: string[];
  numItems?: number;
}

/** Build the request body for POST /{pixel_id}/events. `test_event_code` is added when set. */
export function buildCapiBody(event: CapiEventInput, testEventCode: string): Record<string, unknown> {
  const userData: Record<string, unknown> = {};
  if (event.hashedPhone) userData.ph = [event.hashedPhone];
  if (event.hashedName) userData.fn = [event.hashedName];
  if (event.clientIp) userData.client_ip_address = event.clientIp;
  if (event.userAgent) userData.client_user_agent = event.userAgent;
  if (event.fbp) userData.fbp = event.fbp;
  if (event.fbc) userData.fbc = event.fbc;

  const custom: Record<string, unknown> = {};
  if (typeof event.valueBdt === 'number') {
    custom.currency = 'BDT';
    custom.value = event.valueBdt;
  }
  if (event.orderNumber) custom.order_id = event.orderNumber;
  if (event.contentIds?.length) {
    custom.content_ids = event.contentIds;
    custom.content_type = 'product';
  }
  if (typeof event.numItems === 'number') custom.num_items = event.numItems;

  return {
    data: [
      {
        event_name: event.eventName,
        event_time: event.eventTimeSec,
        event_id: event.eventId,
        action_source: 'website',
        event_source_url: event.sourceUrl,
        user_data: userData,
        custom_data: custom,
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };
}

export interface MarketingLogRow {
  id: string;
  eventName: string;
  eventId: string;
  orderNumber: string;
  ok: boolean;
  httpStatus: number;
  detail: string;
  test: boolean;
  atIso: string;
}
