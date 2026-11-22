import type { CollectionStatus, CourierPartner, OrderStatus, SettlementStatus } from '../storeTypes';

/**
 * COD collection & courier settlement — pure rules (no I/O).
 *
 * Money moves through three separate stages and is never inferred from fulfilment status:
 *   in transit  →  awaiting collection (delivered, cash not yet confirmed)
 *               →  collected by courier (cash received from customer)
 *               →  settled to the store (courier paid out; recorded with a unique reference)
 */

export interface CodOrderInput {
  orderNumber: string;
  customerName: string;
  status: OrderStatus;
  paymentMethod: string;
  totalBdt: number;
  collectionStatus?: CollectionStatus;
  collectedAmountBdt?: number;
  settlementStatus?: SettlementStatus;
  settledAmountBdt?: number;
  courierPartner?: CourierPartner;
  consignmentId?: string;
  deliveredAtIso?: string;
  createdAtIso: string;
}

export interface CodSummary {
  /** COD orders currently with the courier (not yet delivered). */
  inTransit: { count: number; amountBdt: number };
  /** Delivered, but the courier has not been confirmed to have collected the cash. */
  awaitingCollection: { count: number; amountBdt: number };
  /** Cash collected from customers but not yet paid out to the store. */
  collectedPendingSettlement: { count: number; amountBdt: number };
  /** Cash the courier has already paid out and that you recorded. */
  settled: { count: number; amountBdt: number };
  /** Orders flagged as disputed (collected amount not matched by the courier). */
  disputed: { count: number; amountBdt: number };
  /** Collection failed (delivery failed / returned with no cash). */
  failedCollection: { count: number; amountBdt: number };
}

const IN_TRANSIT: OrderStatus[] = ['sent_to_courier', 'shipped', 'out_for_delivery'];

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Cash collected on an order that is still owed by the courier. */
export function outstandingCollected(order: CodOrderInput): number {
  const collected =
    order.collectionStatus === 'collected'
      ? order.totalBdt
      : order.collectionStatus === 'partial'
        ? Number(order.collectedAmountBdt) || 0
        : 0;
  return Math.max(0, round2(collected - (Number(order.settledAmountBdt) || 0)));
}

export function computeCodSummary(orders: CodOrderInput[]): CodSummary {
  const empty = () => ({ count: 0, amountBdt: 0 });
  const out: CodSummary = {
    inTransit: empty(),
    awaitingCollection: empty(),
    collectedPendingSettlement: empty(),
    settled: empty(),
    disputed: empty(),
    failedCollection: empty(),
  };
  const add = (b: { count: number; amountBdt: number }, amount: number) => {
    b.count += 1;
    b.amountBdt = round2(b.amountBdt + amount);
  };

  for (const o of orders) {
    if (o.paymentMethod !== 'cod' || o.status === 'cancelled') continue;

    if (IN_TRANSIT.includes(o.status)) {
      add(out.inTransit, o.totalBdt);
      continue;
    }
    if (o.status === 'delivery_failed' || o.status === 'returned') {
      if (!o.collectionStatus || o.collectionStatus === 'failed' || o.collectionStatus === 'awaiting') {
        add(out.failedCollection, o.totalBdt);
        continue;
      }
    }
    if (o.status !== 'delivered' && o.status !== 'returned' && o.status !== 'delivery_failed') continue;

    const collection = o.collectionStatus ?? 'awaiting';
    if (collection === 'awaiting') {
      add(out.awaitingCollection, o.totalBdt);
      continue;
    }
    if (collection === 'failed') {
      add(out.failedCollection, o.totalBdt);
      continue;
    }

    // collected or partial
    if (o.settlementStatus === 'disputed') {
      add(out.disputed, outstandingCollected(o) || o.totalBdt);
    } else if (o.settlementStatus === 'settled') {
      add(out.settled, Number(o.settledAmountBdt) || o.totalBdt);
    } else {
      const outstanding = outstandingCollected(o);
      if (outstanding > 0) add(out.collectedPendingSettlement, outstanding);
      if ((Number(o.settledAmountBdt) || 0) > 0) add(out.settled, Number(o.settledAmountBdt));
    }
  }
  return out;
}

/** Orders eligible to be included in a settlement: COD, cash collected, still owed. */
export function eligibleForSettlement(orders: CodOrderInput[]): CodOrderInput[] {
  return orders.filter(
    (o) =>
      o.paymentMethod === 'cod' &&
      (o.collectionStatus === 'collected' || o.collectionStatus === 'partial') &&
      o.settlementStatus !== 'settled' &&
      outstandingCollected(o) > 0
  );
}

export const SETTLEMENT_COURIERS: CourierPartner[] = ['steadfast', 'pathao', 'redx', 'manual'];

export interface SettlementInput {
  courier: CourierPartner;
  reference: string;
  amountBdt: number;
  /** YYYY-MM-DD */
  date: string;
  orderNumbers: string[];
  note: string;
}

export function validateSettlementInput(
  raw: unknown
): { ok: true; value: SettlementInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid settlement payload.' };
  const b = raw as Record<string, unknown>;

  const courier = String(b.courier || '') as CourierPartner;
  if (!SETTLEMENT_COURIERS.includes(courier)) return { ok: false, error: 'Select a valid courier.' };

  const reference = String(b.reference || '').trim();
  if (reference.length < 3 || reference.length > 60 || !/^[A-Za-z0-9._\-/# ]+$/.test(reference)) {
    return { ok: false, error: 'Settlement reference must be 3–60 characters (letters, numbers, . _ - / #).' };
  }

  const amount = Number(b.amountBdt);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    return { ok: false, error: 'Amount received must be greater than 0.' };
  }

  const date = String(b.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    return { ok: false, error: 'Settlement date must be YYYY-MM-DD.' };
  }

  const list = Array.isArray(b.orderNumbers) ? b.orderNumbers : [];
  const orderNumbers = Array.from(new Set(list.map((n) => String(n).trim().toUpperCase())));
  if (orderNumbers.length === 0) return { ok: false, error: 'Select at least one order.' };
  if (orderNumbers.length > 100) return { ok: false, error: 'A settlement can include at most 100 orders.' };
  if (orderNumbers.some((n) => !/^DG-[0-9]{4,8}$/.test(n))) return { ok: false, error: 'Invalid order number in list.' };

  return {
    ok: true,
    value: { courier, reference, amountBdt: round2(amount), date, orderNumbers, note: String(b.note || '').trim().slice(0, 300) },
  };
}

/** Deterministic document id → the same courier + reference can never be recorded twice. */
export function settlementDocId(courier: string, reference: string): string {
  const norm = reference.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${courier}__${norm}`.slice(0, 120);
}

export interface SettlementOutcome {
  expectedBdt: number;
  receivedBdt: number;
  /** expected − received. Positive = courier paid less than collected. */
  discrepancyBdt: number;
  /** New settlement status for every included order. */
  orderStatus: SettlementStatus;
}

/**
 * Compare what you should receive (sum of cash collected and still owed on the selected orders)
 * with what you actually received. Exact match settles the orders; any difference marks them
 * disputed so the gap cannot be forgotten.
 */
export function evaluateSettlement(selected: CodOrderInput[], receivedBdt: number): SettlementOutcome {
  const expected = round2(selected.reduce((s, o) => s + outstandingCollected(o), 0));
  const received = round2(receivedBdt);
  const discrepancy = round2(expected - received);
  return {
    expectedBdt: expected,
    receivedBdt: received,
    discrepancyBdt: discrepancy,
    orderStatus: discrepancy === 0 ? 'settled' : 'disputed',
  };
}
