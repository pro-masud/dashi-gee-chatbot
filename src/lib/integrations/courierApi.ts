import { createHmac, timingSafeEqual } from 'crypto';
import type { CourierPartner, OrderStatus } from '../storeTypes';
import { normalizeBangladeshPhone } from '../chatbot/orderToken';

export interface CourierApiReadiness {
  steadfast: boolean;
  pathao: boolean;
  redx: boolean;
  webhookSecret: boolean;
  anyLiveCourier: boolean;
}

export interface CourierBookingRequest {
  partner: Exclude<CourierPartner, 'manual'>;
  orderNumber: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientDistrict: string;
  recipientArea: string;
  codAmountBdt: number;
  weightGrams: number;
  note?: string;
}

export interface CourierBookingResult {
  ok: boolean;
  partner: Exclude<CourierPartner, 'manual'>;
  consignmentId?: string;
  trackingCode?: string;
  courierTrackingUrl?: string;
  rawStatus?: string;
  error?: string;
  code?: string;
}

export interface NormalizedCourierWebhookEvent {
  partner: CourierPartner;
  eventId: string;
  orderNumber: string;
  consignmentId: string;
  rawStatus: string;
  mappedOrderStatus: OrderStatus | null;
  trackingMessage: string;
}

export function getCourierApiReadiness(): CourierApiReadiness {
  const steadfast =
    (process.env.STEADFAST_API_KEY || '').trim().length >= 6 &&
    (process.env.STEADFAST_SECRET_KEY || '').trim().length >= 6;
  const pathao =
    (process.env.PATHAO_CLIENT_ID || '').trim().length >= 4 &&
    (process.env.PATHAO_CLIENT_SECRET || '').trim().length >= 4 &&
    (process.env.PATHAO_USERNAME || '').trim().length >= 2 &&
    (process.env.PATHAO_PASSWORD || '').trim().length >= 2 &&
    (process.env.PATHAO_STORE_ID || '').trim().length >= 1;
  const redx = (process.env.REDX_API_TOKEN || '').trim().length >= 8;
  const webhookSecret = (process.env.COURIER_WEBHOOK_SECRET || '').trim().length >= 12;

  return {
    steadfast,
    pathao,
    redx,
    webhookSecret,
    anyLiveCourier: steadfast || pathao || redx,
  };
}

export function verifyCourierWebhookAuth(params: {
  rawBody: string;
  signatureHeader: string | null;
  bearerOrSecretHeader: string | null;
}): { ok: boolean; reason?: string } {
  const secret = (process.env.COURIER_WEBHOOK_SECRET || '').trim();
  if (secret.length < 12) {
    return { ok: false, reason: 'courier_webhook_secret_unconfigured' };
  }

  // Support either HMAC-SHA256 signature header (sha256=<hex> or <hex>) OR direct shared secret header
  const sigRaw = String(params.signatureHeader || '').trim();
  if (sigRaw) {
    const providedHex = sigRaw.startsWith('sha256=') ? sigRaw.slice(7).trim() : sigRaw;
    const expectedHex = createHmac('sha256', secret).update(params.rawBody).digest('hex');
    if (providedHex.length === expectedHex.length) {
      try {
        if (timingSafeEqual(Buffer.from(providedHex, 'utf8'), Buffer.from(expectedHex, 'utf8'))) {
          return { ok: true };
        }
      } catch {
        // fall through
      }
    }
    return { ok: false, reason: 'invalid_hmac_signature' };
  }

  const tokenRaw = String(params.bearerOrSecretHeader || '').trim();
  const normalizedToken = tokenRaw.toLowerCase().startsWith('bearer ')
    ? tokenRaw.slice(7).trim()
    : tokenRaw;
  if (normalizedToken && normalizedToken.length === secret.length) {
    try {
      if (timingSafeEqual(Buffer.from(normalizedToken, 'utf8'), Buffer.from(secret, 'utf8'))) {
        return { ok: true };
      }
    } catch {
      // fall through
    }
  }

  return { ok: false, reason: 'unauthorized_courier_webhook' };
}

export function mapCourierRawStatusToOrderStatus(rawStatus: string): OrderStatus | null {
  const s = String(rawStatus || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (!s) return null;
  if (
    s === 'delivered' ||
    s === 'delivery_completed' ||
    s === 'partial_delivered' ||
    s === 'delivered_approval_pending'
  ) {
    return 'delivered';
  }
  if (
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'returned' ||
    s === 'return' ||
    s === 'pickup_cancelled' ||
    s === 'delivery_failed'
  ) {
    return 'cancelled';
  }
  if (
    s === 'in_transit' ||
    s === 'shipped' ||
    s === 'picked' ||
    s === 'picked_up' ||
    s === 'out_for_delivery' ||
    s === 'at_sorting_hub' ||
    s === 'assigned_for_delivery' ||
    s === 'on_the_way'
  ) {
    return 'shipped';
  }
  if (
    s === 'pickup_requested' ||
    s === 'assigned_for_pickup' ||
    s === 'in_review' ||
    s === 'pending' ||
    s === 'hold' ||
    s === 'ready_for_pickup'
  ) {
    return 'processing';
  }
  return null;
}

export function normalizeCourierWebhookPayload(
  partnerHint: string,
  payload: Record<string, unknown>
): NormalizedCourierWebhookEvent | null {
  const partnerRaw = String(partnerHint || payload.partner || payload.courier || 'steadfast')
    .trim()
    .toLowerCase();
  const partner: CourierPartner =
    partnerRaw === 'pathao' || partnerRaw === 'redx' || partnerRaw === 'manual'
      ? partnerRaw
      : 'steadfast';

  const orderNumber = String(
    payload.invoice ||
      payload.merchant_order_id ||
      payload.merchant_invoice_id ||
      payload.orderNumber ||
      ''
  )
    .trim()
    .toUpperCase();

  const consignmentId = String(
    payload.consignment_id || payload.tracking_id || payload.consignmentId || ''
  ).trim();

  const rawStatus = String(
    payload.status || payload.order_status || payload.event || ''
  ).trim();

  if (!orderNumber && !consignmentId) return null;
  if (!rawStatus) return null;

  const mappedOrderStatus = mapCourierRawStatusToOrderStatus(rawStatus);
  const trackingMessage = String(
    payload.tracking_message || payload.message || `Courier status update: ${rawStatus}`
  )
    .trim()
    .slice(0, 220);

  const eventIdSource = String(
    payload.event_id ||
      payload.notification_id ||
      `${partner}_${orderNumber || consignmentId}_${rawStatus}_${payload.updated_at || Date.now()}`
  );
  const eventId = eventIdSource.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 110);

  return {
    partner,
    eventId,
    orderNumber,
    consignmentId,
    rawStatus,
    mappedOrderStatus,
    trackingMessage,
  };
}

export async function bookCourierParcel(
  req: CourierBookingRequest
): Promise<CourierBookingResult> {
  const readiness = getCourierApiReadiness();
  const cleanPhone = normalizeBangladeshPhone(req.recipientPhone);

  if (req.partner === 'steadfast') {
    if (!readiness.steadfast) {
      return {
        ok: false,
        partner: 'steadfast',
        code: 'courier_not_configured',
        error: 'Steadfast API keys (STEADFAST_API_KEY / STEADFAST_SECRET_KEY) are not configured.',
      };
    }

    try {
      const res = await fetch('https://portal.packzy.com/api/v1/create_order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': (process.env.STEADFAST_API_KEY || '').trim(),
          'Secret-Key': (process.env.STEADFAST_SECRET_KEY || '').trim(),
        },
        body: JSON.stringify({
          invoice: req.orderNumber,
          recipient_name: req.recipientName.slice(0, 100),
          recipient_phone: cleanPhone,
          recipient_address: `${req.recipientAddress}, ${req.recipientArea}, ${req.recipientDistrict}`.slice(
            0,
            250
          ),
          cod_amount: Math.max(0, Math.round(req.codAmountBdt)),
          note: (req.note || 'Deshi Gee glass jar — handle with care').slice(0, 200),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: number;
        message?: string;
        consignment?: {
          consignment_id?: string | number;
          tracking_code?: string;
          status?: string;
        };
      };
      const cid = String(data.consignment?.consignment_id || '').trim();
      const trackingCode = String(data.consignment?.tracking_code || cid).trim();
      if (!res.ok || !cid) {
        return {
          ok: false,
          partner: 'steadfast',
          code: 'steadfast_booking_failed',
          error: data.message || `Steadfast create_order failed (HTTP ${res.status}).`,
        };
      }
      return {
        ok: true,
        partner: 'steadfast',
        consignmentId: trackingCode || cid,
        trackingCode,
        courierTrackingUrl: `https://steadfast.com.bd/t/${encodeURIComponent(trackingCode || cid)}`,
        rawStatus: data.consignment?.status || 'in_review',
      };
    } catch (err) {
      return {
        ok: false,
        partner: 'steadfast',
        code: 'steadfast_network_error',
        error: err instanceof Error ? err.message : 'Steadfast API request failed.',
      };
    }
  }

  if (req.partner === 'pathao') {
    if (!readiness.pathao) {
      return {
        ok: false,
        partner: 'pathao',
        code: 'courier_not_configured',
        error:
          'Pathao Hermes credentials (PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET, PATHAO_USERNAME, PATHAO_PASSWORD, PATHAO_STORE_ID) are not configured.',
      };
    }
    const baseUrl =
      String(process.env.PATHAO_IS_LIVE || '').toLowerCase() === 'true'
        ? 'https://api-hermes.pathao.com'
        : 'https://courier-api-sandbox.pathao.com';

    try {
      const tokenRes = await fetch(`${baseUrl}/aladdin/api/v1/issue-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: (process.env.PATHAO_CLIENT_ID || '').trim(),
          client_secret: (process.env.PATHAO_CLIENT_SECRET || '').trim(),
          username: (process.env.PATHAO_USERNAME || '').trim(),
          password: (process.env.PATHAO_PASSWORD || '').trim(),
          grant_type: 'password',
        }),
      });
      const tokenData = (await tokenRes.json().catch(() => ({}))) as {
        access_token?: string;
        message?: string;
      };
      if (!tokenRes.ok || !tokenData.access_token) {
        return {
          ok: false,
          partner: 'pathao',
          code: 'pathao_auth_failed',
          error: tokenData.message || `Pathao token issue failed (HTTP ${tokenRes.status}).`,
        };
      }

      const weightKg = Math.max(0.5, Number((req.weightGrams / 1000).toFixed(2)));
      const orderRes = await fetch(`${baseUrl}/aladdin/api/v1/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${tokenData.access_token}`,
        },
        body: JSON.stringify({
          store_id: Number(process.env.PATHAO_STORE_ID || 0),
          merchant_order_id: req.orderNumber,
          recipient_name: req.recipientName.slice(0, 100),
          recipient_phone: cleanPhone,
          recipient_address: `${req.recipientAddress}, ${req.recipientArea}, ${req.recipientDistrict}`.slice(
            0,
            220
          ),
          delivery_type: 48,
          item_type: 2,
          special_instruction: (req.note || 'Fragile glass jar — handle carefully').slice(0, 180),
          item_quantity: 1,
          item_weight: weightKg,
          amount_to_collect: Math.max(0, Math.round(req.codAmountBdt)),
          item_description: `Deshi Gee order ${req.orderNumber}`,
        }),
      });

      const orderData = (await orderRes.json().catch(() => ({}))) as {
        message?: string;
        data?: {
          consignment_id?: string;
          order_status?: string;
        };
      };
      const cid = String(orderData.data?.consignment_id || '').trim();
      if (!orderRes.ok || !cid) {
        return {
          ok: false,
          partner: 'pathao',
          code: 'pathao_booking_failed',
          error: orderData.message || `Pathao parcel booking failed (HTTP ${orderRes.status}).`,
        };
      }

      return {
        ok: true,
        partner: 'pathao',
        consignmentId: cid,
        trackingCode: cid,
        courierTrackingUrl: `https://merchant.pathao.com/tracking?consignment_id=${encodeURIComponent(
          cid
        )}`,
        rawStatus: orderData.data?.order_status || 'Pending',
      };
    } catch (err) {
      return {
        ok: false,
        partner: 'pathao',
        code: 'pathao_network_error',
        error: err instanceof Error ? err.message : 'Pathao API request failed.',
      };
    }
  }

  // RedX
  if (!readiness.redx) {
    return {
      ok: false,
      partner: 'redx',
      code: 'courier_not_configured',
      error: 'RedX API token (REDX_API_TOKEN) is not configured.',
    };
  }
  const redxBase =
    String(process.env.REDX_IS_LIVE || '').toLowerCase() === 'true'
      ? 'https://openapi.redx.com.bd'
      : 'https://sandbox.redx.com.bd';

  try {
    const res = await fetch(`${redxBase}/v1.0.0-beta/parcel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-ACCESS-TOKEN': `Bearer ${(process.env.REDX_API_TOKEN || '').trim()}`,
      },
      body: JSON.stringify({
        customer_name: req.recipientName.slice(0, 100),
        customer_phone: cleanPhone,
        delivery_area: req.recipientArea || req.recipientDistrict || 'Dhaka',
        delivery_area_id: 1,
        customer_address: `${req.recipientAddress}, ${req.recipientArea}, ${req.recipientDistrict}`.slice(
          0,
          250
        ),
        merchant_invoice_id: req.orderNumber,
        cash_collection_amount: Math.max(0, Math.round(req.codAmountBdt)),
        parcel_weight: Math.max(250, Math.round(req.weightGrams || 500)),
        instruction: (req.note || 'Fragile glass jar — Deshi Gee').slice(0, 180),
        value: Math.max(100, Math.round(req.codAmountBdt || 1000)),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      tracking_id?: string;
      message?: string;
    };
    const trackingId = String(data.tracking_id || '').trim();
    if (!res.ok || !trackingId) {
      return {
        ok: false,
        partner: 'redx',
        code: 'redx_booking_failed',
        error: data.message || `RedX parcel booking failed (HTTP ${res.status}).`,
      };
    }

    return {
      ok: true,
      partner: 'redx',
      consignmentId: trackingId,
      trackingCode: trackingId,
      courierTrackingUrl: `https://redx.com.bd/track-global-parcel/?trackingId=${encodeURIComponent(
        trackingId
      )}`,
      rawStatus: 'pickup-pending',
    };
  } catch (err) {
    return {
      ok: false,
      partner: 'redx',
      code: 'redx_network_error',
      error: err instanceof Error ? err.message : 'RedX API request failed.',
    };
  }
}
