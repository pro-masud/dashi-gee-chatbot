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
