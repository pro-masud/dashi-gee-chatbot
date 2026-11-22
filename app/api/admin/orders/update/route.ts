import {
  COLLECTION_STATUSES,
  SETTLEMENT_STATUSES,
  SELECTABLE_STATUSES,
  type PipelineUpdateInput,
} from '../../../../../src/lib/orders/pipeline';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../../src/lib/server/adminApi';
import { updateOrderPipeline } from '../../../../../src/lib/server/orderPipelineRepository';
import type { CollectionStatus, OrderStatus, SettlementStatus } from '../../../../../src/lib/storeTypes';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/orders/update
 * Body: { orderNumber, status?, collectionStatus?, collectedAmountBdt?, settlementStatus?, note? }
 * Validates the transition server-side, then updates order + tracking + history + audit in one transaction.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request, { mutation: true });
  if ('response' in auth) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return jsonError('Invalid request body.', 400);

  const orderNumber = String(body.orderNumber || '').trim().toUpperCase();
  if (!/^DG-[0-9]{4,8}$/.test(orderNumber)) return jsonError('Invalid order number.', 400);

  const input: PipelineUpdateInput & { note?: string } = {};
  if (body.status !== undefined) {
    if (!SELECTABLE_STATUSES.includes(body.status as OrderStatus)) return jsonError('Unknown order status.', 400);
    input.status = body.status as OrderStatus;
  }
  if (body.collectionStatus !== undefined) {
    if (!COLLECTION_STATUSES.includes(body.collectionStatus as CollectionStatus)) {
      return jsonError('Unknown collection status.', 400);
    }
    input.collectionStatus = body.collectionStatus as CollectionStatus;
  }
  if (body.collectedAmountBdt !== undefined) {
    const n = Number(body.collectedAmountBdt);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return jsonError('Invalid collected amount.', 400);
    input.collectedAmountBdt = n;
  }
  if (body.settlementStatus !== undefined) {
    if (!SETTLEMENT_STATUSES.includes(body.settlementStatus as SettlementStatus)) {
      return jsonError('Unknown settlement status.', 400);
    }
    input.settlementStatus = body.settlementStatus as SettlementStatus;
  }
  if (typeof body.note === 'string') input.note = body.note.trim().slice(0, 200);

  if (!input.status && !input.collectionStatus && !input.settlementStatus) {
    return jsonError('Nothing to update.', 400);
  }

  try {
    const result = await updateOrderPipeline(orderNumber, input, auth.actor);
    if (!result.ok) return jsonError(result.error, result.status);
    return jsonOk({ order: result.order, stockRestored: result.stockRestored });
  } catch (err) {
    return handleAdminError(err);
  }
}
