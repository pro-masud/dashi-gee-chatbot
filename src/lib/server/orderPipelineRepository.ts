import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  AdminSdkUnavailableError,
  getAdminDb,
  isAdminSdkCredentialOrIamError,
} from '../firebaseAdmin';
import {
  COLLECTION_LABELS,
  ORDER_STATUS_LABELS,
  SETTLEMENT_LABELS,
  cancellationRestoresStock,
  customerFacingStatus,
  defaultTracksForStatus,
  validatePipelineUpdate,
  type PipelineUpdateInput,
} from '../orders/pipeline';
import type { CollectionStatus, OrderStatus, SettlementStatus } from '../storeTypes';

export type PipelineUpdateResult =
  | {
      ok: true;
      order: {
        orderNumber: string;
        status: OrderStatus;
        collectionStatus?: CollectionStatus;
        collectedAmountBdt?: number;
        settlementStatus?: SettlementStatus;
        deliveredAtIso?: string;
        returnedAtIso?: string;
        statusUpdatedAtIso: string;
      };
      stockRestored: boolean;
    }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Atomically update an order's fulfilment / COD-collection / settlement tracks.
 * One transaction: order + public tracking doc + status history + audit log (+ stock restore on cancel).
 * Browsers never write these fields directly; this runs with the Admin SDK only.
 */
export async function updateOrderPipeline(
  orderNumber: string,
  input: PipelineUpdateInput & { note?: string },
  actor: { email: string; uid: string }
): Promise<PipelineUpdateResult> {
  try {
    const db = getAdminDb();
    const orderRef = db.collection('orders').doc(orderNumber);

    return await db.runTransaction(async (tx): Promise<PipelineUpdateResult> => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) return { ok: false, status: 404, error: 'Order not found.' };
      const order = snap.data() as Record<string, unknown>;

      const currentStatus = String(order.status || 'pending') as OrderStatus;
      const totalBdt = Number(order.totalBdt) || 0;
      const currentCollection = order.collectionStatus as CollectionStatus | undefined;
      const currentSettlement = order.settlementStatus as SettlementStatus | undefined;

      const check = validatePipelineUpdate(
        { status: currentStatus, totalBdt, collectionStatus: currentCollection, settlementStatus: currentSettlement },
        input
      );
      if (!check.ok) return { ok: false, status: 409, error: check.error };

      const nextStatus = input.status ?? currentStatus;
      const statusChanged = nextStatus !== currentStatus;
      const nowIso = new Date().toISOString();

      const defaults = statusChanged
        ? defaultTracksForStatus(nextStatus, { collectionStatus: currentCollection, settlementStatus: currentSettlement })
        : {};
      const nextCollection = input.collectionStatus ?? defaults.collectionStatus ?? currentCollection;
      const nextSettlement = input.settlementStatus ?? defaults.settlementStatus ?? currentSettlement;

      let collectedAmount: number | undefined = Number(order.collectedAmountBdt) || undefined;
      if (input.collectionStatus === 'collected') collectedAmount = totalBdt;
      else if (input.collectionStatus === 'partial') collectedAmount = Number(input.collectedAmountBdt);
      else if (input.collectionStatus === 'awaiting' || input.collectionStatus === 'failed') collectedAmount = 0;

      const phone = String(order.phone || '');
      const trackingRef = db.collection('order_tracking').doc(`${orderNumber}_${phone}`);
      const restoreStock = statusChanged && nextStatus === 'cancelled' && cancellationRestoresStock(currentStatus);
      const storeRef = db.collection('store_settings').doc('main');
      const trackingSnap = await tx.get(trackingRef);

      const orderUpdate: Record<string, unknown> = {
        status: nextStatus,
        statusUpdatedAtIso: nowIso,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (nextCollection) orderUpdate.collectionStatus = nextCollection;
      if (collectedAmount !== undefined) orderUpdate.collectedAmountBdt = collectedAmount;
      if (nextSettlement) orderUpdate.settlementStatus = nextSettlement;
      if (statusChanged && nextStatus === 'delivered') orderUpdate.deliveredAtIso = nowIso;
      if (statusChanged && nextStatus === 'returned') orderUpdate.returnedAtIso = nowIso;
      tx.update(orderRef, orderUpdate);

      if (trackingSnap.exists) {
        tx.update(trackingRef, {
          status: customerFacingStatus(nextStatus),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      if (restoreStock) {
        const q250 = Number(order.qty250g) || 0;
        const q500 = Number(order.qty500g) || 0;
        const q1k = Number(order.qty1kg) || 0;
        tx.update(storeRef, {
          ...(q250 ? { stock250g: FieldValue.increment(q250) } : {}),
          ...(q500 ? { stock500g: FieldValue.increment(q500) } : {}),
          ...(q1k ? { stock1kg: FieldValue.increment(q1k) } : {}),
        });
      }

      const parts: string[] = [];
      if (statusChanged) parts.push(`Status ${ORDER_STATUS_LABELS[currentStatus]} → ${ORDER_STATUS_LABELS[nextStatus]}`);
      if (nextCollection && nextCollection !== currentCollection) parts.push(`COD: ${COLLECTION_LABELS[nextCollection]}`);
      if (nextSettlement && nextSettlement !== currentSettlement) parts.push(`Settlement: ${SETTLEMENT_LABELS[nextSettlement]}`);
      if (restoreStock) parts.push('stock restored');
      const summary = `${parts.join('; ') || 'No change'}${input.note ? ` — ${input.note.slice(0, 200)}` : ''}`;

      tx.set(db.collection('order_audit_logs').doc(), {
        orderNumber,
        action: 'status_updated',
        actorType: 'admin',
        summary,
        previousStatus: currentStatus,
        nextStatus,
        metadata: {
          actor: actor.email,
          collectionStatus: nextCollection ?? null,
          settlementStatus: nextSettlement ?? null,
          collectedAmountBdt: collectedAmount ?? null,
        },
        createdAt: Timestamp.now(),
      });
      tx.set(db.collection('order_status_history').doc(), {
        orderNumber,
        from: currentStatus,
        to: nextStatus,
        collectionStatus: nextCollection ?? null,
        settlementStatus: nextSettlement ?? null,
        actorEmail: actor.email,
        note: input.note ? input.note.slice(0, 200) : '',
        atIso: nowIso,
      });
      tx.set(db.collection('activity_logs').doc(), {
        action: 'order.pipeline_update',
        resource: `orders/${orderNumber}`,
        actorEmail: actor.email,
        actorUid: actor.uid,
        before: { status: currentStatus, collectionStatus: currentCollection ?? null, settlementStatus: currentSettlement ?? null },
        after: { status: nextStatus, collectionStatus: nextCollection ?? null, settlementStatus: nextSettlement ?? null },
        atIso: nowIso,
      });

      return {
        ok: true,
        stockRestored: restoreStock,
        order: {
          orderNumber,
          status: nextStatus,
          collectionStatus: nextCollection,
          collectedAmountBdt: collectedAmount,
          settlementStatus: nextSettlement,
          deliveredAtIso: statusChanged && nextStatus === 'delivered' ? nowIso : (order.deliveredAtIso as string | undefined),
          returnedAtIso: statusChanged && nextStatus === 'returned' ? nowIso : (order.returnedAtIso as string | undefined),
          statusUpdatedAtIso: nowIso,
        },
      };
    });
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    throw err;
  }
}
