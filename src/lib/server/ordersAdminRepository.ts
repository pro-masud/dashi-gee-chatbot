import {
  AdminSdkUnavailableError,
  getAdminDb,
  isAdminSdkCredentialOrIamError,
} from '../firebaseAdmin';
import type { OrderRecord } from '../storeTypes';

function tsToIso(v: unknown): string | undefined {
  return v && typeof (v as { toDate?: () => Date }).toDate === 'function'
    ? (v as { toDate: () => Date }).toDate().toISOString()
    : undefined;
}

/**
 * Orders for the admin list, read with the Admin SDK so role checks happen on the server.
 * Heavy fields (payment proof images) are dropped; timestamps become ISO strings.
 */
export async function listOrdersForAdmin(limit = 500): Promise<OrderRecord[]> {
  try {
    const snap = await getAdminDb()
      .collection('orders')
      .orderBy('createdAt', 'desc')
      .limit(Math.min(Math.max(limit, 1), 1000))
      .get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      return {
        ...d,
        paymentProofData: '',
        createdAt: tsToIso(d.createdAt),
        updatedAt: tsToIso(d.updatedAt),
      } as unknown as OrderRecord;
    });
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    throw err;
  }
}

export async function readCustomerNotes(): Promise<Record<string, { note: string; updatedAtIso: string; updatedBy: string }>> {
  try {
    const snap = await getAdminDb().collection('customer_notes').limit(2000).get();
    const out: Record<string, { note: string; updatedAtIso: string; updatedBy: string }> = {};
    for (const d of snap.docs) {
      const x = d.data();
      out[d.id] = { note: String(x.note || ''), updatedAtIso: String(x.updatedAtIso || ''), updatedBy: String(x.updatedBy || '') };
    }
    return out;
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    throw err;
  }
}

export async function saveCustomerNote(phone: string, note: string, actor: { email: string; uid: string }): Promise<void> {
  try {
    const db = getAdminDb();
    const nowIso = new Date().toISOString();
    const ref = db.collection('customer_notes').doc(phone);
    await db.runTransaction(async (tx) => {
      const before = await tx.get(ref);
      tx.set(ref, { note, updatedAtIso: nowIso, updatedBy: actor.email });
      tx.set(db.collection('activity_logs').doc(), {
        action: 'customer.note',
        resource: `customer_notes/${phone}`,
        actorEmail: actor.email,
        actorUid: actor.uid,
        before: before.exists ? { note: before.data()?.note ?? '' } : null,
        after: { note },
        atIso: nowIso,
      });
    });
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    throw err;
  }
}

/** Record who entered a manual order and where it came from (the order itself is created by the shared engine). */
export async function tagManualOrder(
  orderNumber: string,
  source: string,
  actor: { email: string; uid: string }
): Promise<void> {
  try {
    const db = getAdminDb();
    const nowIso = new Date().toISOString();
    await db.collection('orders').doc(orderNumber).update({
      orderSource: source,
      createdByEmail: actor.email,
      manualEntry: true,
    });
    await db.collection('activity_logs').add({
      action: 'order.manual_create',
      resource: `orders/${orderNumber}`,
      actorEmail: actor.email,
      actorUid: actor.uid,
      before: null,
      after: { source },
      atIso: nowIso,
    });
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    throw err;
  }
}

export interface OrderSignal {
  orderCount: number;
  latestOrderNumber: string;
  latestCustomerName: string;
  latestCreatedAtIso: string;
}

/** Tiny summary used for new-order alerts: one count aggregate + the latest order. No phone/address. */
export async function getOrderSignal(): Promise<OrderSignal> {
  try {
    const db = getAdminDb();
    const [count, latest] = await Promise.all([
      db.collection('orders').count().get(),
      db.collection('orders').orderBy('createdAt', 'desc').limit(1).get(),
    ]);
    const d = latest.docs[0]?.data();
    return {
      orderCount: count.data().count,
      latestOrderNumber: String(d?.orderNumber || ''),
      latestCustomerName: String(d?.customerName || ''),
      latestCreatedAtIso: tsToIso(d?.createdAt) || '',
    };
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    throw err;
  }
}
