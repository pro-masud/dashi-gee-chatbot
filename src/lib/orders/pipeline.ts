import type { CollectionStatus, OrderStatus, SettlementStatus } from '../storeTypes';

/**
 * Order pipeline v2 — pure rules (no I/O).
 *
 * Three independent tracks on every order:
 *   1. status            — physical fulfilment (pending → … → delivered / returned / cancelled)
 *   2. collectionStatus  — has the courier collected the COD cash from the customer?
 *   3. settlementStatus  — has the courier paid that cash out to the store?
 *
 * "Delivered" never implies "collected", and "collected" never implies "settled".
 */

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Packaging (legacy)',
  packaging: 'Packaging',
  ready_to_ship: 'Ready to ship',
  shipped: 'Shipped (legacy)',
  sent_to_courier: 'Sent to courier',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  delivery_failed: 'Delivery failed',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

/** Statuses an admin can pick as a *target*. Legacy values are readable but not offered. */
export const SELECTABLE_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'packaging',
  'ready_to_ship',
  'sent_to_courier',
  'out_for_delivery',
  'delivered',
  'delivery_failed',
  'returned',
  'cancelled',
];

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['packaging', 'ready_to_ship', 'cancelled'],
  processing: ['ready_to_ship', 'sent_to_courier', 'cancelled'],
  packaging: ['ready_to_ship', 'cancelled'],
  ready_to_ship: ['sent_to_courier', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered', 'delivery_failed', 'returned'],
  sent_to_courier: ['out_for_delivery', 'delivered', 'delivery_failed'],
  out_for_delivery: ['delivered', 'delivery_failed'],
  delivery_failed: ['out_for_delivery', 'returned', 'cancelled'],
  delivered: ['returned'],
  returned: [],
  cancelled: [],
};

export function allowedNextStatuses(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || allowedNextStatuses(from).includes(to);
}

/** Terminal states: no further status change is possible. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return allowedNextStatuses(status).length === 0;
}

/**
 * Status shown to customers on /track and in chat. Customers only see the five original steps so
 * existing tracking UI keeps working; internal detail stays in the admin.
 */
export function customerFacingStatus(status: OrderStatus): OrderStatus {
  switch (status) {
    case 'packaging':
    case 'ready_to_ship':
      return 'processing';
    case 'sent_to_courier':
    case 'out_for_delivery':
    case 'delivery_failed':
      return 'shipped';
    case 'returned':
      return 'cancelled';
    default:
      return status;
  }
}

/** True when stock was deducted at order creation and should come back on cancellation. */
export function cancellationRestoresStock(from: OrderStatus): boolean {
  return from !== 'cancelled' && from !== 'returned' && from !== 'delivered';
}

export const COLLECTION_STATUSES: CollectionStatus[] = ['awaiting', 'collected', 'partial', 'failed'];
export const SETTLEMENT_STATUSES: SettlementStatus[] = ['pending', 'partial', 'settled', 'disputed'];

export const COLLECTION_LABELS: Record<CollectionStatus, string> = {
  awaiting: 'Awaiting collection',
  collected: 'Collected by courier',
  partial: 'Partially collected',
  failed: 'Collection failed',
};

export const SETTLEMENT_LABELS: Record<SettlementStatus, string> = {
  pending: 'Settlement pending',
  partial: 'Partially settled',
  settled: 'Settled',
  disputed: 'Disputed',
};

export interface PipelineUpdateInput {
  status?: OrderStatus;
  collectionStatus?: CollectionStatus;
  collectedAmountBdt?: number;
  settlementStatus?: SettlementStatus;
}

export interface PipelineCurrentState {
  status: OrderStatus;
  totalBdt: number;
  collectionStatus?: CollectionStatus;
  settlementStatus?: SettlementStatus;
}

/**
 * Validate a requested change against the current state. Returns the first problem found.
 * Rules:
 *  - status must follow the allowed transition map
 *  - collection "collected" / "partial" requires the order to be delivered
 *  - "partial" needs an amount strictly between 0 and the order total; "collected" amount = total
 *  - settlement can only move off "pending" once cash has been collected (or partially)
 */
export function validatePipelineUpdate(
  current: PipelineCurrentState,
  next: PipelineUpdateInput
): { ok: true } | { ok: false; error: string } {
  const nextStatus = next.status ?? current.status;
  if (next.status && !canTransition(current.status, next.status)) {
    return {
      ok: false,
      error: `Cannot change status from "${ORDER_STATUS_LABELS[current.status]}" to "${ORDER_STATUS_LABELS[next.status]}".`,
    };
  }

  const collection = next.collectionStatus ?? current.collectionStatus;
  if (next.collectionStatus) {
    if (!COLLECTION_STATUSES.includes(next.collectionStatus)) {
      return { ok: false, error: 'Unknown collection status.' };
    }
    if (
      (next.collectionStatus === 'collected' || next.collectionStatus === 'partial') &&
      nextStatus !== 'delivered'
    ) {
      return { ok: false, error: 'Cash can only be marked collected after the order is delivered.' };
    }
    if (next.collectionStatus === 'partial') {
      const amount = Number(next.collectedAmountBdt);
      if (!Number.isFinite(amount) || amount <= 0 || amount >= current.totalBdt) {
        return { ok: false, error: 'Partial collection needs an amount above 0 and below the order total.' };
      }
    }
  }

  if (next.settlementStatus) {
    if (!SETTLEMENT_STATUSES.includes(next.settlementStatus)) {
      return { ok: false, error: 'Unknown settlement status.' };
    }
    if (next.settlementStatus !== 'pending' && collection !== 'collected' && collection !== 'partial') {
      return { ok: false, error: 'Settlement can only progress after cash has been collected.' };
    }
    if (next.settlementStatus === 'settled' && collection === 'partial') {
      return { ok: false, error: 'A partially collected order cannot be fully settled; mark it partial or disputed.' };
    }
  }
  return { ok: true };
}

/** Defaults written when an order enters/leaves delivery, so the COD track starts honestly. */
export function defaultTracksForStatus(
  status: OrderStatus,
  current: { collectionStatus?: CollectionStatus; settlementStatus?: SettlementStatus }
): { collectionStatus?: CollectionStatus; settlementStatus?: SettlementStatus } {
  const out: { collectionStatus?: CollectionStatus; settlementStatus?: SettlementStatus } = {};
  if (status === 'delivered') {
    out.collectionStatus = current.collectionStatus ?? 'awaiting';
    out.settlementStatus = current.settlementStatus ?? 'pending';
  }
  if (status === 'delivery_failed' || status === 'returned') {
    if (!current.collectionStatus || current.collectionStatus === 'awaiting') {
      out.collectionStatus = 'failed';
    }
  }
  return out;
}
