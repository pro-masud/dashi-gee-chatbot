import { normalizeBangladeshPhone } from '../../../../../src/lib/leads/leads';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../../src/lib/server/adminApi';
import { tagManualOrder } from '../../../../../src/lib/server/ordersAdminRepository';
import { POST as storefrontOrderPost } from '../../../orders/storefront/route';

export const dynamic = 'force-dynamic';

const SOURCES = ['facebook_inbox', 'whatsapp', 'phone', 'other'] as const;
type ManualSource = (typeof SOURCES)[number];

/**
 * POST /api/admin/orders/manual
 * Staff enter an order received outside the website (Facebook inbox, WhatsApp, phone call).
 *
 * It deliberately goes through the SAME order engine as the storefront (server pricing, stock check,
 * duplicate / risk checks, atomic write, idempotency, owner notification, lead conversion), so a manual
 * order can never bypass a rule. Only the source and the staff member are added afterwards.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'orders.update' });
  if ('response' in auth) return auth.response;

  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return jsonError('Invalid request body.', 400);

  const source = String(b.source || '') as ManualSource;
  if (!SOURCES.includes(source)) return jsonError('Choose where this order came from.', 400);

  const phone = normalizeBangladeshPhone(String(b.phone || ''));
  const qty = (k: string) => Math.max(0, Math.floor(Number(b[k]) || 0));
  const q250 = qty('qty250g');
  const q500 = qty('qty500g');
  const q1k = qty('qty1kg');
  if (q250 + q500 + q1k === 0) return jsonError('Add at least one jar.', 400);

  const district = String(b.district || '').trim();
  const forwarded = new Headers({
    'content-type': 'application/json',
    'x-requested-with': 'DeshiGeeStorefront',
  });
  for (const h of ['x-forwarded-for', 'x-real-ip', 'user-agent']) {
    const v = request.headers.get(h);
    if (v) forwarded.set(h, v);
  }

  try {
    const res = await storefrontOrderPost(
      new Request(new URL('/api/orders/storefront', request.url), {
        method: 'POST',
        headers: forwarded,
        body: JSON.stringify({
          customerName: String(b.customerName || ''),
          phone,
          district,
          area: String(b.area || '').trim() || district,
          address: String(b.address || ''),
          note: `${String(b.note || '').trim()}${b.note ? ' · ' : ''}[${source}]`.slice(0, 240),
          deliveryZone: '',
          qty250g: q250,
          qty500g: q500,
          qty1kg: q1k,
          paymentMethod: 'cod',
          couponCode: String(b.couponCode || ''),
          uiLang: 'en',
        }),
      })
    );
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      messageEn?: string;
      order?: { orderNumber: string; totalBdt: number };
    };
    if (!res.ok || !data.ok || !data.order) {
      return jsonError(data.messageEn || data.error || 'The order could not be created.', res.status >= 400 && res.status < 600 ? res.status : 400);
    }
    await tagManualOrder(data.order.orderNumber, source, auth.actor).catch(() => undefined);
    return jsonOk({ orderNumber: data.order.orderNumber, totalBdt: data.order.totalBdt }, 201);
  } catch (err) {
    return handleAdminError(err);
  }
}
