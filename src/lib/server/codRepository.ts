import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  AdminSdkUnavailableError,
  getAdminDb,
  isAdminSdkCredentialOrIamError,
} from '../firebaseAdmin';
import {
  evaluateSettlement,
  outstandingCollected,
  settlementDocId,
  type CodOrderInput,
  type SettlementInput,
} from '../cod/settlement';

export interface SettlementRecord {
  id: string;
  courier: string;
  reference: string;
  amountBdt: number;
  expectedBdt: number;
  discrepancyBdt: number;
  date: string;
  orderNumbers: string[];
  status: 'settled' | 'disputed';
  note: string;
  createdByEmail: string;
  createdAtIso: string;
}

type Actor = { email: string; uid: string };

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    throw err;
  });
}

function tsToIso(v: unknown): string {
  return v && typeof (v as { toDate?: () => Date }).toDate === 'function'
    ? (v as { toDate: () => Date }).toDate().toISOString()
    : '';
}

export function docToCodOrder(id: string, d: FirebaseFirestore.DocumentData): CodOrderInput {
  return {
    orderNumber: String(d.orderNumber || id),
    customerName: String(d.customerName || ''),
    status: d.status,
    paymentMethod: String(d.paymentMethod || ''),
    totalBdt: Number(d.totalBdt) || 0,
    collectionStatus: d.collectionStatus,
    collectedAmountBdt: typeof d.collectedAmountBdt === 'number' ? d.collectedAmountBdt : undefined,
    settlementStatus: d.settlementStatus,
    settledAmountBdt: typeof d.settledAmountBdt === 'number' ? d.settledAmountBdt : undefined,
    courierPartner: d.courierPartner,
    consignmentId: typeof d.consignmentId === 'string' ? d.consignmentId : undefined,
    deliveredAtIso: typeof d.deliveredAtIso === 'string' ? d.deliveredAtIso : undefined,
    createdAtIso: tsToIso(d.createdAt),
  };
}

/** Recent COD orders (single-field index only; filtered in memory). */
export async function listCodOrders(limit = 2000): Promise<CodOrderInput[]> {
  return wrap(async () => {
    const snap = await getAdminDb().collection('orders').orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((doc) => docToCodOrder(doc.id, doc.data())).filter((o) => o.paymentMethod === 'cod');
  });
}

export async function listSettlements(limit = 50): Promise<SettlementRecord[]> {
  return wrap(async () => {
    const snap = await getAdminDb().collection('cod_settlements').orderBy('createdAtIso', 'desc').limit(limit).get();
    return snap.docs.map((doc) => doc.data() as SettlementRecord);
  });
}

export type CreateSettlementResult =
  | { ok: true; settlement: SettlementRecord }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Record a courier settlement atomically:
 *  - settlement doc id = courier + reference → the same payout can never be entered twice
 *  - every selected order must be COD, cash collected and not already settled
 *  - exact amount match settles the orders; any difference marks them disputed
 */
export async function createSettlement(input: SettlementInput, actor: Actor): Promise<CreateSettlementResult> {
  return wrap(async () => {
    const db = getAdminDb();
    const id = settlementDocId(input.courier, input.reference);
    const settlementRef = db.collection('cod_settlements').doc(id);
    const orderRefs = input.orderNumbers.map((n) => db.collection('orders').doc(n));

    try {
      return await db.runTransaction(async (tx): Promise<CreateSettlementResult> => {
        const existing = await tx.get(settlementRef);
        if (existing.exists) {
          return { ok: false, status: 409, error: 'This settlement reference was already recorded for this courier.' };
        }
        const snaps = await tx.getAll(...orderRefs);
        const selected: CodOrderInput[] = [];
        for (let i = 0; i < snaps.length; i++) {
          const s = snaps[i];
          if (!s.exists) return { ok: false, status: 404, error: `Order ${input.orderNumbers[i]} not found.` };
          const o = docToCodOrder(s.id, s.data() || {});
          if (o.paymentMethod !== 'cod') return { ok: false, status: 409, error: `${o.orderNumber} is not a COD order.` };
          if (o.collectionStatus !== 'collected' && o.collectionStatus !== 'partial') {
            return { ok: false, status: 409, error: `${o.orderNumber}: cash has not been marked collected.` };
          }
          if (o.settlementStatus === 'settled' || outstandingCollected(o) <= 0) {
            return { ok: false, status: 409, error: `${o.orderNumber} is already settled.` };
          }
          selected.push(o);
        }

        const outcome = evaluateSettlement(selected, input.amountBdt);
        const nowIso = new Date().toISOString();
        const record: SettlementRecord = {
          id,
          courier: input.courier,
          reference: input.reference,
          amountBdt: outcome.receivedBdt,
          expectedBdt: outcome.expectedBdt,
          discrepancyBdt: outcome.discrepancyBdt,
          date: input.date,
          orderNumbers: input.orderNumbers,
          status: outcome.orderStatus === 'settled' ? 'settled' : 'disputed',
          note: input.note,
          createdByEmail: actor.email,
          createdAtIso: nowIso,
        };
        tx.create(settlementRef, record);

        for (const o of selected) {
          const settledNow = outcome.orderStatus === 'settled';
          tx.update(db.collection('orders').doc(o.orderNumber), {
            settlementStatus: outcome.orderStatus,
            settlementId: id,
            ...(settledNow
              ? { settledAmountBdt: (Number(o.settledAmountBdt) || 0) + outstandingCollected(o) }
              : {}),
            updatedAt: FieldValue.serverTimestamp(),
          });
          tx.set(db.collection('order_audit_logs').doc(), {
            orderNumber: o.orderNumber,
            action: 'status_updated',
            actorType: 'admin',
            summary: settledNow
              ? `COD settled via ${input.courier.toUpperCase()} ref ${input.reference}`
              : `COD settlement ${input.reference} had a discrepancy of ৳${outcome.discrepancyBdt} — marked disputed`,
            metadata: { actor: actor.email, settlementId: id },
            createdAt: Timestamp.now(),
          });
        }
        tx.set(db.collection('activity_logs').doc(), {
          action: 'cod.settlement_record',
          resource: `cod_settlements/${id}`,
          actorEmail: actor.email,
          actorUid: actor.uid,
          before: null,
          after: record,
          atIso: nowIso,
        });
        return { ok: true, settlement: record };
      });
    } catch (err) {
      const code = (err as { code?: number | string })?.code;
      if (code === 6 || code === 'already-exists') {
        return { ok: false, status: 409, error: 'This settlement reference was already recorded for this courier.' };
      }
      throw err;
    }
  });
}
