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

export async function createOrderAtomically(
  order: Omit<OrderRecord, 'createdAt' | 'updatedAt'>
): Promise<void> {
  const orderRef = doc(db, 'orders', order.orderNumber);
  const trackingId = `${order.orderNumber}_${order.phone}`;
  const trackingRef = doc(db, 'order_tracking', trackingId);
  const settingsRef = doc(db, 'store_settings', 'main');
  const auditRef = doc(
    collection(db, 'order_audit_logs'),
    `aud_${order.orderNumber}_created`
  );

  let settingsData: Partial<StoreSettingsDoc> | null = null;
  try {
    const settingsSnap = await getDoc(settingsRef);
    if (settingsSnap.exists()) {
      settingsData = settingsSnap.data() as Partial<StoreSettingsDoc>;
    }
  } catch {
    settingsData = null;
  }

  const batch = writeBatch(db);
  batch.set(orderRef, {
    ...order,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(trackingRef, {
    orderNumber: order.orderNumber,
    weight: order.weight,
    qty: order.qty,
    qty250g: order.qty250g,
    qty500g: order.qty500g,
    qty1kg: order.qty1kg,
    itemsSummary: order.itemsSummary,
    subtotalBdt: order.subtotalBdt,
    deliveryFeeBdt: order.deliveryFeeBdt,
    discountBdt: order.discountBdt,
    totalBdt: order.totalBdt,
    couponCode: order.couponCode || '',
    deliveryZone: order.deliveryZone,
    district: order.district,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    status: order.status,
    reviewStatus: order.reviewStatus || 'none',
    estimatedDelivery: order.estimatedDelivery,
    updatedAt: serverTimestamp(),
  });
  batch.set(auditRef, {
    orderNumber: order.orderNumber,
    action: 'created',
    actorType: 'customer',
    summary: `Checkout order created (${order.itemsSummary}, Total ৳${order.totalBdt})`,
    previousStatus: '',
    nextStatus: order.status,
    createdAt: serverTimestamp(),
  });

  if (settingsData) {
    const cur250 = Number(settingsData.stock250g ?? DEFAULT_STORE_SETTINGS.stock250g);
    const cur500 = Number(settingsData.stock500g ?? DEFAULT_STORE_SETTINGS.stock500g);
    const cur1k = Number(settingsData.stock1kg ?? DEFAULT_STORE_SETTINGS.stock1kg);
    batch.update(settingsRef, {
      stock250g: Math.max(0, cur250 - Number(order.qty250g || 0)),
      stock500g: Math.max(0, cur500 - Number(order.qty500g || 0)),
      stock1kg: Math.max(0, cur1k - Number(order.qty1kg || 0)),
      lastOrderNumber: order.orderNumber,
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `orders/${order.orderNumber}`);
  }
}

export async function trackOrderLookup(
  orderNumber: string,
  phone: string
): Promise<TrackingRecord | null> {
  const cleanOrder = orderNumber.trim().toUpperCase();
  const cleanPhone = phone.replace(/[\s-]/g, '');
  if (!/^DG-[0-9]{4,8}$/.test(cleanOrder) || !/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
    return null;
  }
  const lookupId = `${cleanOrder}_${cleanPhone}`;
  try {
    const snap = await getDoc(doc(db, 'order_tracking', lookupId));
    return snap.exists() ? (snap.data() as TrackingRecord) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `order_tracking/${lookupId}`);
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
  const id = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  try {
    await setDoc(doc(db, 'reviews', id), {
      customerName: input.customerName.trim().slice(0, 80),
      district: input.district.trim().slice(0, 80),
      rating: Math.max(1, Math.min(5, Math.round(input.rating))),
      comment: input.comment.trim().slice(0, 600),
      orderNumber: input.orderNumber.trim().toUpperCase().slice(0, 20),
      verifiedPurchase: false,
      helpfulCount: 0,
      photoData: input.photoData.slice(0, 180000),
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `reviews/${id}`);
  }
}

export async function incrementReviewHelpful(reviewId: string, currentCount: number): Promise<void> {
  try {
    await updateDoc(doc(db, 'reviews', reviewId), {
      helpfulCount: currentCount + 1,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `reviews/${reviewId}`);
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
  const clean = email.trim().toLowerCase();
  const id = `sub_${clean.replace(/[^a-z0-9]/g, '_').slice(0, 96)}`;
  try {
    await setDoc(doc(db, 'subscribers', id), {
      email: clean,
      lang,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `subscribers/${id}`);
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
