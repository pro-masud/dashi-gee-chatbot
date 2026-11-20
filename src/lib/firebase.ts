'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export const BOOTSTRAPPED_ADMIN_EMAIL = 'kinboni.bd@gmail.com';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate live connection to Firestore on startup
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Firebase client is offline. Please verify configuration.');
    }
    return false;
  }
}

export function subscribeToAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

export async function signInAdminWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutAdmin(): Promise<void> {
  await signOut(auth);
}

export async function checkIsAdminUser(user: User | null): Promise<boolean> {
  if (!user || !user.emailVerified) return false;
  if (user.email === BOOTSTRAPPED_ADMIN_EMAIL) return true;
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists();
  } catch {
    return false;
  }
}

export * from './storeTypes';
import {
  DEFAULT_ACTIVE_BATCH,
  DEFAULT_STORE_SETTINGS,
  type BatchRecord,
  type CouponRecord,
  type OrderRecord,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type ReviewRecord,
  type StoreSettingsDoc,
  type SubscriberRecord,
  type TrackingRecord,
} from './storeTypes';

export async function fetchStoreSettings(): Promise<StoreSettingsDoc> {
  try {
    const snap = await getDoc(doc(db, 'store_settings', 'main'));
    if (snap.exists()) {
      return { ...DEFAULT_STORE_SETTINGS, ...(snap.data() as Partial<StoreSettingsDoc>) };
    }
    return DEFAULT_STORE_SETTINGS;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'store_settings/main');
  }
}

export async function saveStoreSettings(settings: StoreSettingsDoc): Promise<void> {
  const path = 'store_settings/main';
  try {
    await setDoc(doc(db, 'store_settings', 'main'), {
      ...settings,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Stage 2.3: Direct browser Firestore order writes are permanently disabled.
 * Storefront orders MUST go through POST /api/orders/storefront (Admin SDK atomic transaction).
 */
export async function createOrderAtomically(
  _order: Omit<OrderRecord, 'createdAt' | 'updatedAt'>
): Promise<void> {
  void _order;
  throw new Error(
    'Direct client Firestore order writes are disabled. Use POST /api/orders/storefront.'
  );
}

/**
 * Decision D14 (Stage 2.4): Order tracking goes through POST /api/orders/track
 * (supports 192-bit CSPRNG token or rate-limited orderNumber + phone with uniform 404).
 */
export async function trackOrderLookup(
  orderNumber: string,
  phone: string,
  trackingToken?: string
): Promise<TrackingRecord | null> {
  try {
    const res = await fetch('/api/orders/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'DeshiGeeStorefront',
      },
      body: JSON.stringify({
        trackingToken: trackingToken || undefined,
        orderNumber: orderNumber.trim().toUpperCase(),
        phone: phone.replace(/[\s-]/g, ''),
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; tracking?: TrackingRecord };
    return data.ok && data.tracking ? data.tracking : null;
  } catch {
    return null;
  }
}

export async function fetchBatchRecord(batchCode: string): Promise<BatchRecord | null> {
  const clean = batchCode.trim().toUpperCase();
  if (!clean) return null;
  try {
    const snap = await getDoc(doc(db, 'batches', clean));
    if (snap.exists()) return snap.data() as BatchRecord;
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `batches/${clean}`);
  }
}

export async function fetchAllBatches(): Promise<BatchRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'batches'));
    return snap.docs.map((d) => d.data() as BatchRecord);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'batches');
  }
}

export async function saveBatchRecord(batch: BatchRecord): Promise<void> {
  const id = batch.batchCode.trim().toUpperCase();
  try {
    await setDoc(doc(db, 'batches', id), {
      ...batch,
      batchCode: id,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `batches/${id}`);
  }
}

export async function fetchApprovedReviews(): Promise<ReviewRecord[]> {
  try {
    const q = query(
      collection(db, 'reviews'),
      where('status', '==', 'approved'),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReviewRecord, 'id'>) }));
  } catch (error) {
    // Fallback query without composite index if index is not yet built
    try {
      const qSimple = query(collection(db, 'reviews'), where('status', '==', 'approved'));
      const snap = await getDocs(qSimple);
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReviewRecord, 'id'>) }));
    } catch (innerErr) {
      handleFirestoreError(innerErr, OperationType.LIST, 'reviews');
    }
  }
}

export async function submitCustomerReview(input: {
  customerName: string;
  district: string;
  rating: number;
  comment: string;
  orderNumber: string;
  photoData: string;
}): Promise<string> {
  const res = await fetch('/api/reviews', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-requested-with': 'DeshiGeeStorefront',
    },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
  if (!res.ok || !data.ok || !data.id) {
    throw new Error(data.error || 'Could not submit review right now.');
  }
  return data.id;
}

export async function incrementReviewHelpful(reviewId: string, _currentCount?: number): Promise<void> {
  void _currentCount;
  const res = await fetch('/api/reviews/helpful', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-requested-with': 'DeshiGeeStorefront',
    },
    body: JSON.stringify({ reviewId }),
  });
  if (!res.ok) {
    throw new Error('Could not mark review helpful right now.');
  }
}

export async function fetchCouponByCode(code: string): Promise<CouponRecord | null> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(clean)) return null;
  try {
    const snap = await getDoc(doc(db, 'coupons', clean));
    return snap.exists() ? (snap.data() as CouponRecord) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `coupons/${clean}`);
  }
}

export async function subscribeNewsletterEmail(
  email: string,
  lang: 'en' | 'bn'
): Promise<void> {
  const res = await fetch('/api/newsletter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-requested-with': 'DeshiGeeStorefront',
    },
    body: JSON.stringify({ email, lang }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Could not subscribe right now.');
  }
}

// --- ADMIN OPERATIONS ---
export async function fetchAdminOrders(): Promise<OrderRecord[]> {
  try {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as OrderRecord);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'orders');
  }
}

export async function updateAdminOrderStatus(
  order: OrderRecord,
  nextStatus: OrderStatus,
  nextPaymentStatus: PaymentStatus
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'orders', order.orderNumber), {
    status: nextStatus,
    paymentStatus: nextPaymentStatus,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'order_tracking', `${order.orderNumber}_${order.phone}`), {
    status: nextStatus,
    paymentStatus: nextPaymentStatus,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${order.orderNumber}`);
  }
}

export async function fetchAdminReviews(): Promise<ReviewRecord[]> {
  try {
    const q = query(collection(db, 'reviews'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReviewRecord, 'id'>) }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'reviews');
  }
}

export async function moderateAdminReview(
  reviewId: string,
  status: 'approved' | 'rejected' | 'pending',
  verifiedPurchase: boolean
): Promise<void> {
  try {
    await updateDoc(doc(db, 'reviews', reviewId), {
      status,
      verifiedPurchase,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `reviews/${reviewId}`);
  }
}

export async function deleteAdminReview(reviewId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'reviews', reviewId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `reviews/${reviewId}`);
  }
}

export async function fetchAdminCoupons(): Promise<CouponRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'coupons'));
    return snap.docs.map((d) => d.data() as CouponRecord);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'coupons');
  }
}

export async function saveAdminCoupon(coupon: CouponRecord): Promise<void> {
  const code = coupon.code.trim().toUpperCase();
  try {
    await setDoc(doc(db, 'coupons', code), {
      ...coupon,
      code,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `coupons/${code}`);
  }
}

export async function fetchAdminSubscribers(): Promise<SubscriberRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'subscribers'));
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<SubscriberRecord, 'id'>),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'subscribers');
  }
}
