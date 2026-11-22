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
