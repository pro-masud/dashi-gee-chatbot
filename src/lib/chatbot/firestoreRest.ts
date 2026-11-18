import { createHash } from 'crypto';
import firebaseConfig from '../../../firebase-applet-config.json';
import {
  DEFAULT_ACTIVE_BATCH,
  DEFAULT_STORE_SETTINGS,
  type BatchRecord,
  type CouponRecord,
  type DeliveryZone,
  type OrderAuditLogRecord,
  type OrderRecord,
  type StoreSettingsDoc,
  type TrackingRecord,
} from '../storeTypes';
import {
  assessAddressCompleteness,
  resolveConfiguredDistrictAndZone,
  resolveZoneDeliveryFeeAndEta,
} from './orderToken';
import { maskSensitivePii } from './domain-guard';
import {
  DEFAULT_CHATBOT_CONFIG,
  type ChatSessionDoc,
  type ChatbotConfigDoc,
  type ChatbotExecutionPath,
  type ChatbotFaqDoc,
  type ChatbotFeedbackDoc,
  type ChatbotKbDocRecord,
  type ChatbotLang,
  type FeedbackReason,
  type KnowledgeChunkRecord,
  type OrderDraftDoc,
} from './types';

const PROJECT_ID = firebaseConfig.projectId;
const DATABASE_ID = firebaseConfig.firestoreDatabaseId;
const API_KEY = firebaseConfig.apiKey;
const BASE_DOC_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

interface FsDocument {
  name?: string;
  fields?: Record<string, FsValue>;
  createTime?: string;
  updateTime?: string;
}

function decodeFsValue(val: FsValue | undefined): unknown {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map((v) => decodeFsValue(v));
  }
  if ('mapValue' in val) {
    return decodeFsFields(val.mapValue.fields);
  }
  return undefined;
}

function decodeFsFields(fields?: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeFsValue(v);
  }
  return out;
}

function encodeFsValue(value: unknown): FsValue {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && Number.isSafeInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: Number.isFinite(value) ? value : 0 };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => encodeFsValue(item)) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: encodeFsFields(value as Record<string, unknown>) } };
  }
  return { stringValue: String(value) };
}

function encodeFsFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = encodeFsValue(v);
    }
  }
  return fields;
}

function docName(collection: string, docId: string): string {
  return `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${collection}/${docId}`;
}

function extractDocId(name?: string): string {
  if (!name) return '';
  const parts = name.split('/');
  return parts[parts.length - 1] || '';
}

async function fetchFsGetWithMeta(
  path: string,
  idToken?: string
): Promise<{ data: Record<string, unknown>; updateTime?: string } | null> {
  const url = `${BASE_DOC_URL}/${path}?key=${encodeURIComponent(API_KEY)}`;
  const headers: Record<string, string> = {};
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  const res = await fetch(url, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  if (res.status === 404 || res.status === 403 || !res.ok) {
    return null;
  }
  const doc = (await res.json()) as FsDocument;
  if (!doc.fields) return null;
  return {
    data: {
      id: extractDocId(doc.name),
      ...decodeFsFields(doc.fields),
    },
    updateTime: doc.updateTime,
  };
}

async function fetchFsGet(
  path: string,
  idToken?: string
): Promise<Record<string, unknown> | null> {
  const res = await fetchFsGetWithMeta(path, idToken);
  return res ? res.data : null;
}

async function fetchFsCollectionList(
  collectionId: string,
  pageSize = 200,
  idToken?: string
): Promise<Record<string, unknown>[]> {
  const url = `${BASE_DOC_URL}/${collectionId}?pageSize=${pageSize}&key=${encodeURIComponent(API_KEY)}`;
  const headers: Record<string, string> = {};
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  const res = await fetch(url, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { documents?: FsDocument[] };
  return (data.documents || []).map((doc) => ({
    id: extractDocId(doc.name),
    ...decodeFsFields(doc.fields),
  }));
}

async function runFsStructuredQuery(
  structuredQuery: Record<string, unknown>,
  idToken?: string
): Promise<Record<string, unknown>[]> {
  const url = `${BASE_DOC_URL}:runQuery?key=${encodeURIComponent(API_KEY)}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ structuredQuery }),
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as { document?: FsDocument }[];
  return rows
    .filter((r) => Boolean(r.document?.fields))
    .map((r) => ({
      id: extractDocId(r.document!.name),
      ...decodeFsFields(r.document!.fields),
    }));
}

export async function verifyServerAdminToken(
  authHeader: string | null
): Promise<{ ok: boolean; email: string; uid: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, email: '', uid: '' };
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken || idToken.length < 20) {
    return { ok: false, email: '', uid: '' };
  }

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        cache: 'no-store',
      }
    );
    if (!res.ok) {
      return { ok: false, email: '', uid: '' };
    }
    const payload = (await res.json()) as {
      users?: { localId?: string; email?: string; emailVerified?: boolean }[];
    };
    const user = payload.users?.[0];
    if (!user || !user.emailVerified || !user.localId) {
      return { ok: false, email: '', uid: '' };
    }

    if (user.email === 'kinboni.bd@gmail.com') {
      return { ok: true, email: user.email, uid: user.localId };
    }

    // Check /admins/{uid} collection using admin's own Bearer token
    const adminDoc = await fetchFsGet(`admins/${user.localId}`, idToken);
    if (adminDoc) {
      return { ok: true, email: user.email || '', uid: user.localId };
    }
    return { ok: false, email: user.email || '', uid: user.localId };
  } catch {
    return { ok: false, email: '', uid: '' };
  }
}

export async function fetchServerStoreSettings(): Promise<StoreSettingsDoc> {
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeTestStoreSettings
  ) {
    return { ...globalFirestoreTestHooks.__deshiGeeTestStoreSettings };
  }
  try {
    const data = await fetchFsGet('store_settings/main');
    if (data) {
      return { ...DEFAULT_STORE_SETTINGS, ...(data as Partial<StoreSettingsDoc>) };
    }
    return DEFAULT_STORE_SETTINGS;
  } catch {
    return DEFAULT_STORE_SETTINGS;
  }
}

export async function fetchServerBatchRecord(batchCode: string): Promise<BatchRecord> {
  const clean = (batchCode || '').trim().toUpperCase();
  if (!clean) return DEFAULT_ACTIVE_BATCH;
  try {
    const data = await fetchFsGet(`batches/${encodeURIComponent(clean)}`);
    if (data) {
      return { ...DEFAULT_ACTIVE_BATCH, ...(data as Partial<BatchRecord>) };
    }
    return DEFAULT_ACTIVE_BATCH;
  } catch {
    return DEFAULT_ACTIVE_BATCH;
  }
}

export async function fetchServerChatbotConfig(
  mode: 'published' | 'draft',
  idToken?: string
): Promise<ChatbotConfigDoc> {
  try {
    const targetDoc = mode === 'draft' ? 'chatbot_config/draft' : 'chatbot_config/published';
    const data = await fetchFsGet(targetDoc, mode === 'draft' ? idToken : undefined);
    if (data) {
      return { ...DEFAULT_CHATBOT_CONFIG, ...(data as Partial<ChatbotConfigDoc>) };
    }
    if (mode === 'draft') {
      const pub = await fetchFsGet('chatbot_config/published');
      if (pub) {
        return { ...DEFAULT_CHATBOT_CONFIG, ...(pub as Partial<ChatbotConfigDoc>) };
      }
    }
    return DEFAULT_CHATBOT_CONFIG;
  } catch {
    return DEFAULT_CHATBOT_CONFIG;
  }
}

export async function fetchServerChatbotFaqs(
  includeDraft: boolean,
  idToken?: string
): Promise<ChatbotFaqDoc[]> {
  try {
    if (includeDraft && idToken) {
      const rows = await fetchFsCollectionList('chatbot_faqs', 200, idToken);
      return (rows as unknown as ChatbotFaqDoc[]).filter((f) => f.active);
    }
    const rows = await runFsStructuredQuery({
      from: [{ collectionId: 'chatbot_faqs' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'active' },
                op: 'EQUAL',
                value: { booleanValue: true },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'published' },
                op: 'EQUAL',
                value: { booleanValue: true },
              },
            },
          ],
        },
      },
      limit: 120,
    });
    return rows as unknown as ChatbotFaqDoc[];
  } catch {
    return [];
  }
}

export async function fetchServerChatbotKbDocs(
  includeDraft: boolean,
  idToken?: string
): Promise<ChatbotKbDocRecord[]> {
  try {
    if (includeDraft && idToken) {
      const rows = await fetchFsCollectionList('chatbot_kb_docs', 100, idToken);
      return rows as unknown as ChatbotKbDocRecord[];
    }
    const rows = await runFsStructuredQuery({
      from: [{ collectionId: 'chatbot_kb_docs' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'status' },
          op: 'EQUAL',
          value: { stringValue: 'published' },
        },
      },
      limit: 60,
    });
    return rows as unknown as ChatbotKbDocRecord[];
  } catch {
    return [];
  }
}

export async function fetchServerOrderTracking(
  orderNumber: string,
  phone: string
): Promise<TrackingRecord | null> {
  const cleanOrder = orderNumber.trim().toUpperCase();
  const cleanPhone = phone.replace(/[\s-]/g, '');
  if (!/^DG-[0-9]{4,8}$/.test(cleanOrder) || !/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
    return null;
  }
  const lookupId = `${cleanOrder}_${cleanPhone}`;
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled
  ) {
    return globalFirestoreTestHooks.__deshiGeeOrderMemoryState.tracking.get(lookupId) || null;
  }
  const data = await fetchFsGet(`order_tracking/${encodeURIComponent(lookupId)}`);
  return data ? (data as unknown as TrackingRecord) : null;
}

export async function fetchServerCouponByCode(code: string): Promise<CouponRecord | null> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(clean)) return null;
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeTestCouponsMap
  ) {
    return globalFirestoreTestHooks.__deshiGeeTestCouponsMap.get(clean) || null;
  }
  const data = await fetchFsGet(`coupons/${encodeURIComponent(clean)}`);
  return data ? (data as unknown as CouponRecord) : null;
}

export async function checkAndIncrementFirestoreRateLimit(
  rawBucketKey: string,
  maxCount: number,
  windowMs: number
): Promise<{ allowed: boolean; count: number; retryAfterSec: number }> {
  const bucketId = createHash('sha256').update(rawBucketKey).digest('hex').slice(0, 32);
  const path = `chatbot_rate_buckets/${bucketId}`;
  const now = Date.now();

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeRateLimitMemoryMap
  ) {
    const store = globalFirestoreTestHooks.__deshiGeeRateLimitMemoryMap;
    const prev = store.get(bucketId);
    const expired = !prev || now - prev.windowStartMs >= windowMs;
    if (!expired && prev.count >= maxCount) {
      const remainingMs = Math.max(1000, windowMs - (now - prev.windowStartMs));
      return {
        allowed: false,
        count: prev.count,
        retryAfterSec: Math.ceil(remainingMs / 1000),
      };
    }
    const nextCount = expired ? 1 : prev.count + 1;
    const nextWindowStart = expired ? now : prev.windowStartMs;
    store.set(bucketId, { count: nextCount, windowStartMs: nextWindowStart });
    return { allowed: true, count: nextCount, retryAfterSec: 0 };
  }

  try {
    const existing = await fetchFsGet(path);
    const prevWindowStart = Number(existing?.windowStartMs || 0);
    const prevCount = Number(existing?.count || 0);
    const expired = !existing || now - prevWindowStart >= windowMs;

    if (!expired && prevCount >= maxCount) {
      const remainingMs = Math.max(1000, windowMs - (now - prevWindowStart));
      return {
        allowed: false,
        count: prevCount,
        retryAfterSec: Math.ceil(remainingMs / 1000),
      };
    }

    const nextCount = expired ? 1 : prevCount + 1;
    const nextWindowStart = expired ? now : prevWindowStart;

    const writeRes = await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: existing ? { exists: true } : { exists: false },
            update: {
              name: docName('chatbot_rate_buckets', bucketId),
              fields: encodeFsFields({
                count: nextCount,
                windowStartMs: nextWindowStart,
              }),
            },
            updateTransforms: [
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        ],
      }),
      cache: 'no-store',
    });

    if (!writeRes.ok) {
      // On rare race conflict allow through unless clearly saturated
      return { allowed: true, count: nextCount, retryAfterSec: 0 };
    }
    return { allowed: true, count: nextCount, retryAfterSec: 0 };
  } catch {
    return { allowed: true, count: 1, retryAfterSec: 0 };
  }
}

export async function checkOrderIdempotency(
  idemKey: string
): Promise<{ found: boolean; orderNumber?: string }> {
  if (!idemKey || !/^[a-zA-Z0-9._-]+$/.test(idemKey)) {
    return { found: false };
  }
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled
  ) {
    const num = globalFirestoreTestHooks.__deshiGeeOrderMemoryState.idempotency.get(idemKey);
    return num ? { found: true, orderNumber: num } : { found: false };
  }
  try {
    const data = await fetchFsGet(`chatbot_order_idempotency/${idemKey}`);
    if (data && typeof data.orderNumber === 'string') {
      return { found: true, orderNumber: data.orderNumber };
    }
    return { found: false };
  } catch {
    return { found: false };
  }
}

export async function checkRecentOrderFingerprint(
  fingerprintHash: string,
  windowMs = 2 * 60 * 60 * 1000
): Promise<{ duplicateFound: boolean; recentOrderNumber?: string }> {
  if (!fingerprintHash || !/^[a-f0-9]{16,64}$/i.test(fingerprintHash)) {
    return { duplicateFound: false };
  }
  const now = Date.now();
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled
  ) {
    const prev = globalFirestoreTestHooks.__deshiGeeOrderMemoryState.fingerprints.get(fingerprintHash);
    if (prev && now - prev.createdAtMs <= windowMs) {
      return { duplicateFound: true, recentOrderNumber: prev.orderNumber };
    }
    return { duplicateFound: false };
  }
  try {
    const doc = await fetchFsGet(`order_fingerprints/${fingerprintHash}`);
    if (
      doc &&
      typeof doc.orderNumber === 'string' &&
      Number(doc.createdAtMs || 0) > 0 &&
      now - Number(doc.createdAtMs) <= windowMs
    ) {
      return { duplicateFound: true, recentOrderNumber: doc.orderNumber };
    }
    return { duplicateFound: false };
  } catch {
    return { duplicateFound: false };
  }
}

export async function createServerOrderAtomically(
  order: Omit<OrderRecord, 'createdAt' | 'updatedAt'>,
  tokenMeta?: { tokenId: string; sessionId: string; idemKey: string },
  options?: { fingerprintHash?: string }
): Promise<{ ok: boolean; error?: string; conflict?: boolean; outOfStock?: boolean }> {
  const trackingPayload: Omit<TrackingRecord, 'updatedAt'> = {
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
    couponCode: order.couponCode,
    deliveryZone: order.deliveryZone,
    district: order.district,
    totalBdt: order.totalBdt,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    status: order.status,
    reviewStatus: order.reviewStatus || 'none',
    estimatedDelivery: order.estimatedDelivery,
  };

  // Deterministic atomic memory store for integration/concurrency testing
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled
  ) {
    const mem = globalFirestoreTestHooks.__deshiGeeOrderMemoryState;
    if (tokenMeta) {
      if (mem.idempotency.has(tokenMeta.idemKey)) {
        return { ok: false, conflict: true, error: 'ALREADY_EXISTS' };
      }
      if (mem.usedTokens.has(tokenMeta.tokenId)) {
        return { ok: false, conflict: true, error: 'TOKEN_ALREADY_USED' };
      }
    }
    if (mem.orders.has(order.orderNumber)) {
      return { ok: false, conflict: true, error: 'ALREADY_EXISTS' };
    }

    const inv = globalFirestoreTestHooks.__deshiGeeTestStoreSettings || { ...DEFAULT_STORE_SETTINGS };
    if (
      inv.stock250g < order.qty250g ||
      inv.stock500g < order.qty500g ||
      inv.stock1kg < order.qty1kg
    ) {
      return {
        ok: false,
        conflict: true,
        outOfStock: true,
        error: 'INSUFFICIENT_STOCK',
      };
    }

    inv.stock250g -= order.qty250g;
    inv.stock500g -= order.qty500g;
    inv.stock1kg -= order.qty1kg;
    inv.lastOrderNumber = order.orderNumber;
    globalFirestoreTestHooks.__deshiGeeTestStoreSettings = inv;

    const nowIso = new Date().toISOString();
    mem.orders.set(order.orderNumber, { ...order, createdAt: nowIso, updatedAt: nowIso });
    mem.tracking.set(`${order.orderNumber}_${order.phone}`, {
      ...trackingPayload,
      updatedAt: nowIso,
    });
    if (tokenMeta) {
      mem.usedTokens.set(tokenMeta.tokenId, order.orderNumber);
      mem.idempotency.set(tokenMeta.idemKey, order.orderNumber);
    }
    if (options?.fingerprintHash) {
      mem.fingerprints.set(options.fingerprintHash, {
        orderNumber: order.orderNumber,
        createdAtMs: Date.now(),
      });
    }
    mem.auditLogs.push({
      id: `audit_${order.orderNumber}_created`,
      orderNumber: order.orderNumber,
      action: 'created',
      actorType: 'system',
      summary: `Order created (${order.itemsSummary}, total ৳${order.totalBdt}).`,
      nextStatus: order.status,
      nextTotalBdt: order.totalBdt,
      createdAt: nowIso,
    });
    return { ok: true };
  }

  const orderPath = docName('orders', order.orderNumber);
  const trackingPath = docName('order_tracking', `${order.orderNumber}_${order.phone}`);
  const auditId = `audit_${order.orderNumber}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Optimistic retry loop (up to 2 attempts) for store_settings stock contention
  for (let attempt = 0; attempt < 2; attempt++) {
    const storeMeta = await fetchFsGetWithMeta('store_settings/main');
    const writes: Record<string, unknown>[] = [
      {
        currentDocument: { exists: false },
        update: {
          name: orderPath,
          fields: encodeFsFields(order as unknown as Record<string, unknown>),
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      },
      {
        currentDocument: { exists: false },
        update: {
          name: trackingPath,
          fields: encodeFsFields(trackingPayload as unknown as Record<string, unknown>),
        },
        updateTransforms: [
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      },
      {
        currentDocument: { exists: false },
        update: {
          name: docName('order_audit_logs', auditId),
          fields: encodeFsFields({
            orderNumber: order.orderNumber,
            action: 'created',
            actorType: 'system',
            summary: `Order created (${order.itemsSummary}, total ৳${order.totalBdt}).`.slice(0, 300),
            nextStatus: order.status,
            nextTotalBdt: order.totalBdt,
          }),
        },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ];

    if (storeMeta?.updateTime) {
      const s250 = Number(storeMeta.data.stock250g ?? DEFAULT_STORE_SETTINGS.stock250g);
      const s500 = Number(storeMeta.data.stock500g ?? DEFAULT_STORE_SETTINGS.stock500g);
      const s1k = Number(storeMeta.data.stock1kg ?? DEFAULT_STORE_SETTINGS.stock1kg);
      if (s250 < order.qty250g || s500 < order.qty500g || s1k < order.qty1kg) {
        return { ok: false, conflict: true, outOfStock: true, error: 'INSUFFICIENT_STOCK' };
      }
      writes.push({
        currentDocument: { updateTime: storeMeta.updateTime },
        update: {
          name: docName('store_settings', 'main'),
          fields: encodeFsFields({
            stock250g: s250 - order.qty250g,
            stock500g: s500 - order.qty500g,
            stock1kg: s1k - order.qty1kg,
            lastOrderNumber: order.orderNumber,
          }),
        },
        updateMask: {
          fieldPaths: ['stock250g', 'stock500g', 'stock1kg', 'lastOrderNumber'],
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      });
    }

    if (tokenMeta) {
      writes.push(
        {
          currentDocument: { exists: false },
          update: {
            name: docName('chatbot_used_tokens', tokenMeta.tokenId),
            fields: encodeFsFields({
              orderNumber: order.orderNumber,
              sessionId: tokenMeta.sessionId.slice(0, 64),
            }),
          },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
        {
          currentDocument: { exists: false },
          update: {
            name: docName('chatbot_order_idempotency', tokenMeta.idemKey),
            fields: encodeFsFields({
              orderNumber: order.orderNumber,
            }),
          },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        }
      );
    }

    if (options?.fingerprintHash) {
      writes.push({
        update: {
          name: docName('order_fingerprints', options.fingerprintHash),
          fields: encodeFsFields({
            orderNumber: order.orderNumber,
            createdAtMs: Date.now(),
          }),
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      });
    }

    try {
      const res = await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes }),
        cache: 'no-store',
      });
      if (res.ok) {
        return { ok: true };
      }
      const errText = await res.text().catch(() => '');
      const isStoreRace =
        errText.includes('FAILED_PRECONDITION') &&
        errText.includes('store_settings/main') &&
        attempt === 0;
      if (isStoreRace) {
        continue;
      }
      const conflict =
        res.status === 409 ||
        errText.includes('ALREADY_EXISTS') ||
        errText.includes('FAILED_PRECONDITION');
      return { ok: false, conflict, error: errText.slice(0, 220) || `HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Order write failed',
      };
    }
  }

  return { ok: false, conflict: true, outOfStock: true, error: 'Stock update conflict' };
}

export async function fetchServerOrderAuditLogs(
  orderNumber: string,
  idToken?: string
): Promise<OrderAuditLogRecord[]> {
  const cleanOrder = orderNumber.trim().toUpperCase();
  if (!/^DG-[0-9]{4,8}$/.test(cleanOrder)) return [];
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled
  ) {
    return globalFirestoreTestHooks.__deshiGeeOrderMemoryState.auditLogs.filter(
      (l) => l.orderNumber === cleanOrder
    );
  }
  try {
    const rows = await runFsStructuredQuery(
      {
        from: [{ collectionId: 'order_audit_logs' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'orderNumber' },
            op: 'EQUAL',
            value: { stringValue: cleanOrder },
          },
        },
        limit: 50,
      },
      idToken
    );
    return rows as unknown as OrderAuditLogRecord[];
  } catch {
    return [];
  }
}

export interface ManageOrderParams {
  action:
    | 'check'
    | 'cancel'
    | 'edit_address'
    | 'admin_review_approve'
    | 'admin_review_reject'
    | 'admin_cancel';
  orderNumber: string;
  phone?: string;
  district?: string;
  area?: string;
  address?: string;
  reason?: string;
  adminIdToken?: string;
  actorEmail?: string;
}

export interface ManageOrderResult {
  ok: boolean;
  eligible: boolean;
  supportRequired?: boolean;
  code?: string;
  currentStatus?: string;
  nextStatus?: string;
  orderNumber?: string;
  updatedTotalBdt?: number;
  updatedDeliveryFeeBdt?: number;
  updatedZone?: DeliveryZone;
  updatedDistrict?: string;
  estimatedDelivery?: string;
  stockRestored?: boolean;
  refundNoticeEn?: string;
  refundNoticeBn?: string;
  messageEn: string;
  messageBn: string;
}

export async function manageServerOrder(params: ManageOrderParams): Promise<ManageOrderResult> {
  const cleanOrder = (params.orderNumber || '').trim().toUpperCase();
  const cleanPhone = (params.phone || '').replace(/[\s-]/g, '');
  const isAdminOp =
    params.action === 'admin_review_approve' ||
    params.action === 'admin_review_reject' ||
    params.action === 'admin_cancel';

  if (!/^DG-[0-9]{4,8}$/.test(cleanOrder)) {
    return {
      ok: false,
      eligible: false,
      code: 'invalid_order_number',
      messageEn: 'Please provide a valid order number (e.g. DG-10421).',
      messageBn: 'অনুগ্রহ করে সঠিক অর্ডার নম্বর দিন (যেমন DG-10421)।',
    };
  }

  if (!isAdminOp && !/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
    return {
      ok: false,
      eligible: false,
      code: 'invalid_phone',
      messageEn: 'Please share the 11-digit checkout mobile number (01XXXXXXXXX) to verify ownership.',
      messageBn: 'অর্ডারটি যাচাই করতে চেকআউটের ১১ সংখ্যার মোবাইল নম্বর (01XXXXXXXXX) দিন।',
    };
  }

  const memEnabled =
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled;

  // Locate tracking/order record
  let tracking: TrackingRecord | null = null;
  let adminOrderDoc: OrderRecord | null = null;

  if (memEnabled) {
    const mem = globalFirestoreTestHooks.__deshiGeeOrderMemoryState!;
    adminOrderDoc = mem.orders.get(cleanOrder) || null;
    if (isAdminOp && adminOrderDoc) {
      tracking = mem.tracking.get(`${cleanOrder}_${adminOrderDoc.phone}`) || null;
    } else if (cleanPhone) {
      tracking = mem.tracking.get(`${cleanOrder}_${cleanPhone}`) || null;
    }
  } else if (isAdminOp && params.adminIdToken) {
    const rawOrder = await fetchFsGet(`orders/${encodeURIComponent(cleanOrder)}`, params.adminIdToken);
    if (rawOrder) {
      adminOrderDoc = rawOrder as unknown as OrderRecord;
      tracking = await fetchServerOrderTracking(cleanOrder, adminOrderDoc.phone);
    }
  } else {
    tracking = await fetchServerOrderTracking(cleanOrder, cleanPhone);
  }

  if (!tracking) {
    return {
      ok: false,
      eligible: false,
      code: 'order_not_found',
      messageEn: 'No matching order was found for that order number and phone.',
      messageBn: 'এই অর্ডার নম্বর ও মোবাইল নম্বরের সাথে কোনো অর্ডার পাওয়া যায়নি।',
    };
  }

  const effectivePhone = adminOrderDoc?.phone || cleanPhone;
  const currentStatus = tracking.status;
  const preDispatchEligible = currentStatus === 'pending' || currentStatus === 'confirmed';

  if (params.action === 'check') {
    return {
      ok: true,
      eligible: preDispatchEligible,
      supportRequired: !preDispatchEligible,
      orderNumber: cleanOrder,
      currentStatus,
      updatedTotalBdt: tracking.totalBdt,
      estimatedDelivery: tracking.estimatedDelivery,
      messageEn: preDispatchEligible
        ? `Order ${cleanOrder} (${currentStatus}) is still pre-dispatch and eligible for address edit or cancellation.`
        : `Order ${cleanOrder} is already "${currentStatus}". Please contact customer support for changes.`,
      messageBn: preDispatchEligible
        ? `অর্ডার ${cleanOrder} (${currentStatus}) এখনো ডিসপ্যাচ হয়নি—আপনি ঠিকানা পরিবর্তন বা বাতিল করতে পারবেন।`
        : `অর্ডার ${cleanOrder} ইতিমধ্যে "${currentStatus}" ধাপে আছে। পরিবর্তনের জন্য সাপোর্টে যোগাযোগ করুন।`,
    };
  }

  // Enforce pre-dispatch boundary for customer edit & cancel
  if ((params.action === 'cancel' || params.action === 'edit_address') && !preDispatchEligible) {
    return {
      ok: false,
      eligible: false,
      supportRequired: true,
      code: 'post_dispatch_locked',
      orderNumber: cleanOrder,
      currentStatus,
      messageEn: `Order ${cleanOrder} is currently "${currentStatus}" and can no longer be edited or cancelled online. Please contact our support team directly.`,
      messageBn: `অর্ডার ${cleanOrder} ইতিমধ্যে "${currentStatus}" অবস্থায় আছে, তাই অনলাইনে পরিবর্তন বা বাতিল করা যাবে না। অনুগ্রহ করে সরাসরি আমাদের সাপোর্টে যোগাযোগ করুন।`,
    };
  }

  const settings = await fetchServerStoreSettings();
  const auditId = `audit_${cleanOrder}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  if (params.action === 'edit_address') {
    const resolved = resolveConfiguredDistrictAndZone(
      params.district || tracking.district || 'Dhaka',
      undefined,
      `${params.area || ''} ${params.address || ''}`
    );
    if (!resolved.valid) {
      return {
        ok: false,
        eligible: true,
        code: 'invalid_district',
        orderNumber: cleanOrder,
        currentStatus,
        messageEn: 'Could not match that Bangladesh district. Please enter a valid district name.',
        messageBn: 'জেলার নামটি সঠিক নয়। অনুগ্রহ করে বাংলাদেশের বৈধ একটি জেলার নাম লিখুন।',
      };
    }

    const areaClean = (params.area || '').trim();
    const addrClean = (params.address || '').trim();
    const completeness = assessAddressCompleteness(addrClean, areaClean, resolved.canonicalDistrict);
    if (!completeness.complete) {
      return {
        ok: false,
        eligible: true,
        code: 'incomplete_address',
        orderNumber: cleanOrder,
        currentStatus,
        messageEn: completeness.suggestionEn || 'Please share a complete house/road or village address.',
        messageBn: completeness.suggestionBn || 'অনুগ্রহ করে বাসা/রোড বা গ্রামসহ পূর্ণাঙ্গ ঠিকানা দিন।',
      };
    }

    const subtotalBdt = Number(tracking.subtotalBdt ?? tracking.totalBdt);
    const discountBdt = Number(tracking.discountBdt ?? 0);
    const zoneInfo = resolveZoneDeliveryFeeAndEta(settings, resolved.deliveryZone);
    const freeDelivery = subtotalBdt >= Math.round(settings.freeDeliveryThreshold);
    const nextDeliveryFee = freeDelivery ? 0 : zoneInfo.feeBdt;
    const nextTotalBdt = Math.max(1, subtotalBdt + nextDeliveryFee - discountBdt);

    if (memEnabled) {
      const mem = globalFirestoreTestHooks.__deshiGeeOrderMemoryState!;
      const ord = mem.orders.get(cleanOrder);
      if (ord) {
        ord.district = resolved.canonicalDistrict;
        ord.area = areaClean;
        ord.address = addrClean;
        ord.deliveryZone = resolved.deliveryZone;
        ord.deliveryFeeBdt = nextDeliveryFee;
        ord.totalBdt = nextTotalBdt;
        ord.estimatedDelivery = zoneInfo.etaText;
      }
      tracking.district = resolved.canonicalDistrict;
      tracking.deliveryZone = resolved.deliveryZone;
      tracking.deliveryFeeBdt = nextDeliveryFee;
      tracking.totalBdt = nextTotalBdt;
      tracking.estimatedDelivery = zoneInfo.etaText;
      mem.auditLogs.push({
        id: auditId,
        orderNumber: cleanOrder,
        action: 'address_updated',
        actorType: 'customer',
        summary: `Delivery address updated to ${areaClean}, ${resolved.canonicalDistrict} (zone ${resolved.deliveryZone}).`,
        previousTotalBdt: Number(tracking.totalBdt),
        nextTotalBdt,
        createdAt: new Date().toISOString(),
      });
    } else {
      const res = await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          writes: [
            {
              currentDocument: { exists: true },
              update: {
                name: docName('orders', cleanOrder),
                fields: encodeFsFields({
                  district: resolved.canonicalDistrict,
                  area: areaClean,
                  address: addrClean,
                  deliveryZone: resolved.deliveryZone,
                  deliveryFeeBdt: nextDeliveryFee,
                  totalBdt: nextTotalBdt,
                  estimatedDelivery: zoneInfo.etaText,
                  status: currentStatus,
                }),
              },
              updateMask: {
                fieldPaths: [
                  'district',
                  'area',
                  'address',
                  'deliveryZone',
                  'deliveryFeeBdt',
                  'totalBdt',
                  'estimatedDelivery',
                  'status',
                ],
              },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              currentDocument: { exists: true },
              update: {
                name: docName('order_tracking', `${cleanOrder}_${effectivePhone}`),
                fields: encodeFsFields({
                  district: resolved.canonicalDistrict,
                  deliveryZone: resolved.deliveryZone,
                  deliveryFeeBdt: nextDeliveryFee,
                  totalBdt: nextTotalBdt,
                  estimatedDelivery: zoneInfo.etaText,
                  status: currentStatus,
                }),
              },
              updateMask: {
                fieldPaths: [
                  'district',
                  'deliveryZone',
                  'deliveryFeeBdt',
                  'totalBdt',
                  'estimatedDelivery',
                  'status',
                ],
              },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              currentDocument: { exists: false },
              update: {
                name: docName('order_audit_logs', auditId),
                fields: encodeFsFields({
                  orderNumber: cleanOrder,
                  action: 'address_updated',
                  actorType: 'customer',
                  summary: `Customer updated address to ${areaClean}, ${resolved.canonicalDistrict} (${resolved.deliveryZone}).`.slice(
                    0,
                    300
                  ),
                  previousStatus: currentStatus,
                  nextStatus: currentStatus,
                  nextTotalBdt,
                }),
              },
              updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
            },
          ],
        }),
        cache: 'no-store',
      });
      if (!res.ok) {
        return {
          ok: false,
          eligible: true,
          code: 'update_failed',
          orderNumber: cleanOrder,
          messageEn: 'Could not update address right now. Please contact support.',
          messageBn: 'এই মুহূর্তে ঠিকানা আপডেট করা যায়নি। অনুগ্রহ করে সাপোর্টে যোগাযোগ করুন।',
        };
      }
    }

    return {
      ok: true,
      eligible: true,
      orderNumber: cleanOrder,
      currentStatus,
      nextStatus: currentStatus,
      updatedTotalBdt: nextTotalBdt,
      updatedDeliveryFeeBdt: nextDeliveryFee,
      updatedZone: resolved.deliveryZone,
      updatedDistrict: resolved.canonicalDistrict,
      estimatedDelivery: zoneInfo.etaText,
      messageEn: `Delivery address updated to ${areaClean}, ${resolved.canonicalDistrict}. Recalculated total: ৳${nextTotalBdt} (${zoneInfo.etaText}).`,
      messageBn: `ডেলিভারি ঠিকানা ${areaClean}, ${resolved.canonicalDistrict}-এ আপডেট হয়েছে। নতুন সর্বমোট ৳${nextTotalBdt} (${zoneInfo.etaText})।`,
    };
  }

  if (
    params.action === 'cancel' ||
    params.action === 'admin_cancel' ||
    params.action === 'admin_review_reject'
  ) {
    if (currentStatus === 'cancelled') {
      return {
        ok: true,
        eligible: false,
        orderNumber: cleanOrder,
        currentStatus: 'cancelled',
        nextStatus: 'cancelled',
        messageEn: `Order ${cleanOrder} is already cancelled.`,
        messageBn: `অর্ডার ${cleanOrder} আগেই বাতিল করা হয়েছে।`,
      };
    }

    const q250 = Number(tracking.qty250g ?? (tracking.weight === '250g' ? tracking.qty : 0));
    const q500 = Number(tracking.qty500g ?? (tracking.weight === '500g' ? tracking.qty : 0));
    const q1k = Number(tracking.qty1kg ?? (tracking.weight === '1kg' ? tracking.qty : 0));
    const isAdvancePaid = tracking.paymentMethod !== 'cod';
    const refundNoticeEn = isAdvancePaid
      ? `Advance ${tracking.paymentMethod.toUpperCase()} payment (${tracking.paymentStatus}) has been marked for manual team verification & refund.`
      : undefined;
    const refundNoticeBn = isAdvancePaid
      ? `আপনার অগ্রিম ${tracking.paymentMethod.toUpperCase()} পেমেন্টটি রিফান্ড যাচাইয়ের জন্য টিমের কাছে পাঠানো হয়েছে।`
      : undefined;

    if (memEnabled) {
      const mem = globalFirestoreTestHooks.__deshiGeeOrderMemoryState!;
      const ord = mem.orders.get(cleanOrder);
      if (ord) {
        ord.status = 'cancelled';
        if (params.action === 'admin_review_reject') ord.reviewStatus = 'rejected';
      }
      tracking.status = 'cancelled';
      if (params.action === 'admin_review_reject') tracking.reviewStatus = 'rejected';

      const inv = globalFirestoreTestHooks.__deshiGeeTestStoreSettings || { ...DEFAULT_STORE_SETTINGS };
      inv.stock250g += q250;
      inv.stock500g += q500;
      inv.stock1kg += q1k;
      inv.lastOrderNumber = cleanOrder;
      globalFirestoreTestHooks.__deshiGeeTestStoreSettings = inv;

      mem.auditLogs.push({
        id: auditId,
        orderNumber: cleanOrder,
        action: params.action === 'admin_review_reject' ? 'review_rejected' : 'cancelled',
        actorType: isAdminOp ? 'admin' : 'customer',
        summary: (params.reason || `Order cancelled (${isAdminOp ? 'admin' : 'customer'}).`).slice(
          0,
          300
        ),
        previousStatus: currentStatus,
        nextStatus: 'cancelled',
        createdAt: new Date().toISOString(),
      });
    } else {
      const storeMeta = await fetchFsGetWithMeta('store_settings/main');
      const writes: Record<string, unknown>[] = [
        {
          currentDocument: { exists: true },
          update: {
            name: docName('orders', cleanOrder),
            fields: encodeFsFields({
              status: 'cancelled',
              ...(params.action === 'admin_review_reject' ? { reviewStatus: 'rejected' } : {}),
            }),
          },
          updateMask: {
            fieldPaths:
              params.action === 'admin_review_reject'
                ? ['status', 'reviewStatus']
                : ['status'],
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
        {
          currentDocument: { exists: true },
          update: {
            name: docName('order_tracking', `${cleanOrder}_${effectivePhone}`),
            fields: encodeFsFields({
              status: 'cancelled',
              ...(params.action === 'admin_review_reject' ? { reviewStatus: 'rejected' } : {}),
            }),
          },
          updateMask: {
            fieldPaths:
              params.action === 'admin_review_reject'
                ? ['status', 'reviewStatus']
                : ['status'],
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
        {
          currentDocument: { exists: false },
          update: {
            name: docName('order_audit_logs', auditId),
            fields: encodeFsFields({
              orderNumber: cleanOrder,
              action: params.action === 'admin_review_reject' ? 'review_rejected' : 'cancelled',
              actorType: isAdminOp ? 'admin' : 'customer',
              summary: (
                params.reason || `Order cancelled by ${isAdminOp ? 'admin' : 'customer'}.`
              ).slice(0, 300),
              previousStatus: currentStatus,
              nextStatus: 'cancelled',
            }),
          },
          updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ];

      if (storeMeta?.updateTime && currentStatus !== 'delivered' && currentStatus !== 'shipped') {
        writes.push({
          currentDocument: { updateTime: storeMeta.updateTime },
          update: {
            name: docName('store_settings', 'main'),
            fields: encodeFsFields({
              stock250g: Number(storeMeta.data.stock250g ?? DEFAULT_STORE_SETTINGS.stock250g) + q250,
              stock500g: Number(storeMeta.data.stock500g ?? DEFAULT_STORE_SETTINGS.stock500g) + q500,
              stock1kg: Number(storeMeta.data.stock1kg ?? DEFAULT_STORE_SETTINGS.stock1kg) + q1k,
              lastOrderNumber: cleanOrder,
            }),
          },
          updateMask: {
            fieldPaths: ['stock250g', 'stock500g', 'stock1kg', 'lastOrderNumber'],
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        });
      }

      const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (params.adminIdToken) {
        authHeaders.Authorization = `Bearer ${params.adminIdToken}`;
      }
      const res = await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ writes }),
        cache: 'no-store',
      });
      if (!res.ok) {
        return {
          ok: false,
          eligible: true,
          code: 'cancel_failed',
          orderNumber: cleanOrder,
          messageEn: 'Could not cancel order right now. Please contact support.',
          messageBn: 'এই মুহূর্তে অর্ডারটি বাতিল করা যায়নি। অনুগ্রহ করে সাপোর্টে যোগাযোগ করুন।',
        };
      }
    }

    return {
      ok: true,
      eligible: true,
      orderNumber: cleanOrder,
      currentStatus,
      nextStatus: 'cancelled',
      stockRestored: q250 + q500 + q1k > 0,
      refundNoticeEn,
      refundNoticeBn,
      messageEn: `Order ${cleanOrder} has been cancelled and jar inventory restored.${refundNoticeEn ? ` ${refundNoticeEn}` : ''}`,
      messageBn: `অর্ডার ${cleanOrder} বাতিল করা হয়েছে এবং স্টক পুনরায় যুক্ত হয়েছে।${refundNoticeBn ? ` ${refundNoticeBn}` : ''}`,
    };
  }

  // admin_review_approve
  const nextStatus = currentStatus === 'pending' ? 'confirmed' : currentStatus;
  if (memEnabled) {
    const mem = globalFirestoreTestHooks.__deshiGeeOrderMemoryState!;
    const ord = mem.orders.get(cleanOrder);
    if (ord) {
      ord.reviewStatus = 'approved';
      ord.status = nextStatus;
    }
    tracking.reviewStatus = 'approved';
    tracking.status = nextStatus;
    mem.auditLogs.push({
      id: auditId,
      orderNumber: cleanOrder,
      action: 'review_approved',
      actorType: 'admin',
      summary: `Admin ${params.actorEmail || ''} approved manual review.`.slice(0, 300),
      previousStatus: currentStatus,
      nextStatus,
      createdAt: new Date().toISOString(),
    });
  } else if (params.adminIdToken) {
    const res = await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.adminIdToken}`,
      },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: { exists: true },
            update: {
              name: docName('orders', cleanOrder),
              fields: encodeFsFields({
                status: nextStatus,
                reviewStatus: 'approved',
              }),
            },
            updateMask: { fieldPaths: ['status', 'reviewStatus'] },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            currentDocument: { exists: true },
            update: {
              name: docName('order_tracking', `${cleanOrder}_${effectivePhone}`),
              fields: encodeFsFields({
                status: nextStatus,
                reviewStatus: 'approved',
              }),
            },
            updateMask: { fieldPaths: ['status', 'reviewStatus'] },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            currentDocument: { exists: false },
            update: {
              name: docName('order_audit_logs', auditId),
              fields: encodeFsFields({
                orderNumber: cleanOrder,
                action: 'review_approved',
                actorType: 'admin',
                summary: `Admin approved order after manual risk check.`,
                previousStatus: currentStatus,
                nextStatus,
              }),
            },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      return {
        ok: false,
        eligible: false,
        code: 'approve_failed',
        messageEn: 'Failed to approve order review.',
        messageBn: 'অর্ডার অনুমোদন করা যায়নি।',
      };
    }
  }

  return {
    ok: true,
    eligible: true,
    orderNumber: cleanOrder,
    currentStatus,
    nextStatus,
    messageEn: `Order ${cleanOrder} approved for dispatch (${nextStatus}).`,
    messageBn: `অর্ডার ${cleanOrder} ডিসপ্যাচের জন্য অনুমোদিত হয়েছে (${nextStatus})।`,
  };
}

export async function createServerSupportRequest(input: {
  sessionId: string;
  customerName: string;
  phone: string;
  issueSummary: string;
}): Promise<{ ok: boolean; requestId?: string; error?: string }> {
  const cleanPhone = input.phone.replace(/[\s-]/g, '');
  if (!/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
    return { ok: false, error: 'Valid Bangladesh mobile number (01XXXXXXXXX) is required.' };
  }
  const reqId = `sup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const docPath = docName('chatbot_support_requests', reqId);

  const payload = {
    sessionId: input.sessionId.slice(0, 64),
    customerName: input.customerName.trim().slice(0, 100),
    phone: cleanPhone,
    issueSummary: input.issueSummary.trim().slice(0, 500),
    status: 'open',
  };

  try {
    const res = await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: { exists: false },
            update: {
              name: docPath,
              fields: encodeFsFields(payload),
            },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        ],
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, requestId: reqId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to log request' };
  }
}

export interface ServerChatLogInput {
  sessionId: string;
  lang: ChatbotLang;
  userMessage: string;
  assistantReply: string;
  intent: string;
  isUnanswered: boolean;
  handoverRequested: boolean;
  latencyMs: number;
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  errorCode: string;
  isTestPlayground: boolean;
  path?: ChatbotExecutionPath;
  model?: string;
  isError?: boolean;
  finishReason?: string;
  guardCategory?: string;
  retryCount?: number;
  toolCallCount?: number;
  factsVersion?: string;
  ragMs?: number;
  modelMs?: number;
  toolMs?: number;
  ragSources?: string[];
  confidence?: number;
}

export interface PersistentCostLedgerState {
  dateKey: string;
  totalUsd: number;
  requestCount: number;
  promptTokens: number;
  outputTokens: number;
  capHit: boolean;
  source: 'firestore' | 'cache' | 'fallback_memory';
}

const COST_LEDGER_CACHE_TTL_MS = 15_000;

const globalFirestoreTestHooks = globalThis as unknown as {
  __deshiGeeChatLogObserver?: ((payload: Record<string, unknown>) => void) | null;
  __deshiGeeFirestoreHealthOverride?:
    | (() => Promise<{ reachable: boolean; latencyMs: number; detail: string }>)
    | null;
  __deshiGeeCostLedgerMemory?: Map<string, PersistentCostLedgerState>;
  __deshiGeeCostLedgerCache?: Map<string, { expiresAt: number; state: PersistentCostLedgerState }>;
  __deshiGeeCostLedgerOverride?: {
    get: (dateKey: string) => Promise<PersistentCostLedgerState>;
    record: (
      dateKey: string,
      add: { costUsd: number; promptTokens: number; outputTokens: number; capUsd: number | null }
    ) => Promise<PersistentCostLedgerState>;
  } | null;
  __deshiGeeRateLimitMemoryMap?: Map<string, { count: number; windowStartMs: number }> | null;
  __deshiGeeSessionMemoryMap?: Map<string, ChatSessionDoc> | null;
  __deshiGeeDraftMemoryMap?: Map<string, OrderDraftDoc> | null;
  __deshiGeeKnowledgeChunksStore?: KnowledgeChunkRecord[] | null;
  __deshiGeeFeedbackObserver?: ((payload: ChatbotFeedbackDoc) => void) | null;
  __deshiGeeTestStoreSettings?: StoreSettingsDoc | null;
  __deshiGeeTestCouponsMap?: Map<string, CouponRecord> | null;
  __deshiGeeOrderMemoryState?: {
    enabled: boolean;
    orders: Map<string, OrderRecord>;
    tracking: Map<string, TrackingRecord>;
    usedTokens: Map<string, string>;
    idempotency: Map<string, string>;
    fingerprints: Map<string, { orderNumber: string; createdAtMs: number }>;
    auditLogs: OrderAuditLogRecord[];
  } | null;
};

export function setInventoryMemoryModeForTests(
  settingsOverride: Partial<StoreSettingsDoc> | null
): void {
  if (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') {
    globalFirestoreTestHooks.__deshiGeeTestStoreSettings = settingsOverride
      ? { ...DEFAULT_STORE_SETTINGS, ...settingsOverride }
      : null;
  }
}

export function getInventoryMemoryStateForTests(): StoreSettingsDoc | null {
  return globalFirestoreTestHooks.__deshiGeeTestStoreSettings || null;
}

export function setCouponsMemoryForTests(coupons: CouponRecord[] | null): void {
  if (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') {
    if (!coupons) {
      globalFirestoreTestHooks.__deshiGeeTestCouponsMap = null;
      return;
    }
    const map = new Map<string, CouponRecord>();
    for (const c of coupons) {
      map.set(c.code.trim().toUpperCase(), c);
    }
    globalFirestoreTestHooks.__deshiGeeTestCouponsMap = map;
  }
}

export function setOrderStorageMemoryModeForTests(enabled: boolean): void {
  if (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') {
    globalFirestoreTestHooks.__deshiGeeOrderMemoryState = enabled
      ? {
          enabled: true,
          orders: new Map(),
          tracking: new Map(),
          usedTokens: new Map(),
          idempotency: new Map(),
          fingerprints: new Map(),
          auditLogs: [],
        }
      : null;
  }
}

export function getOrderStorageMemoryStateForTests() {
  return globalFirestoreTestHooks.__deshiGeeOrderMemoryState || null;
}

export function setChatLogObserverForTests(
  observer: ((payload: Record<string, unknown>) => void) | null
): void {
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.DESHI_GEE_TEST_MODE === '1'
  ) {
    globalFirestoreTestHooks.__deshiGeeChatLogObserver = observer;
  }
}

export function setSessionDraftMemoryModeForTests(enabled: boolean): void {
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.DESHI_GEE_TEST_MODE === '1'
  ) {
    globalFirestoreTestHooks.__deshiGeeSessionMemoryMap = enabled ? new Map() : null;
    globalFirestoreTestHooks.__deshiGeeDraftMemoryMap = enabled ? new Map() : null;
  }
}

export function setKnowledgeChunkTestStore(chunks: KnowledgeChunkRecord[] | null): void {
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.DESHI_GEE_TEST_MODE === '1'
  ) {
    globalFirestoreTestHooks.__deshiGeeKnowledgeChunksStore = chunks;
  }
}

export function setFeedbackMemoryObserverForTests(
  observer: ((payload: ChatbotFeedbackDoc) => void) | null
): void {
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.DESHI_GEE_TEST_MODE === '1'
  ) {
    globalFirestoreTestHooks.__deshiGeeFeedbackObserver = observer;
  }
}

export function setFirestoreHealthOverrideForTests(
  override:
    | (() => Promise<{ reachable: boolean; latencyMs: number; detail: string }>)
    | null
): void {
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.DESHI_GEE_TEST_MODE === '1'
  ) {
    globalFirestoreTestHooks.__deshiGeeFirestoreHealthOverride = override;
  }
}

export function setCostLedgerOverrideForTests(
  override: typeof globalFirestoreTestHooks.__deshiGeeCostLedgerOverride
): void {
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.DESHI_GEE_TEST_MODE === '1'
  ) {
    globalFirestoreTestHooks.__deshiGeeCostLedgerOverride = override;
    globalFirestoreTestHooks.__deshiGeeCostLedgerCache?.clear();
    globalFirestoreTestHooks.__deshiGeeCostLedgerMemory?.clear();
  }
}

export function setRateLimitMemoryModeForTests(enabled: boolean): void {
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.DESHI_GEE_TEST_MODE === '1'
  ) {
    globalFirestoreTestHooks.__deshiGeeRateLimitMemoryMap = enabled ? new Map() : null;
  }
}

export async function getPersistentDailyCostStatus(
  dateKey: string
): Promise<PersistentCostLedgerState> {
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeCostLedgerOverride
  ) {
    return globalFirestoreTestHooks.__deshiGeeCostLedgerOverride.get(dateKey);
  }

  if (!globalFirestoreTestHooks.__deshiGeeCostLedgerCache) {
    globalFirestoreTestHooks.__deshiGeeCostLedgerCache = new Map();
  }
  const cached = globalFirestoreTestHooks.__deshiGeeCostLedgerCache.get(dateKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.state, source: 'cache' };
  }

  try {
    const doc = await fetchFsGet(`chatbot_cost_ledger/${encodeURIComponent(dateKey)}`);
    const state: PersistentCostLedgerState = doc
      ? {
          dateKey,
          totalUsd: Number(doc.totalUsd || 0),
          requestCount: Number(doc.requestCount || 0),
          promptTokens: Number(doc.promptTokens || 0),
          outputTokens: Number(doc.outputTokens || 0),
          capHit: Boolean(doc.capHit),
          source: 'firestore',
        }
      : {
          dateKey,
          totalUsd: 0,
          requestCount: 0,
          promptTokens: 0,
          outputTokens: 0,
          capHit: false,
          source: 'firestore',
        };
    globalFirestoreTestHooks.__deshiGeeCostLedgerCache.set(dateKey, {
      expiresAt: Date.now() + COST_LEDGER_CACHE_TTL_MS,
      state,
    });
    return state;
  } catch {
    if (!globalFirestoreTestHooks.__deshiGeeCostLedgerMemory) {
      globalFirestoreTestHooks.__deshiGeeCostLedgerMemory = new Map();
    }
    return (
      globalFirestoreTestHooks.__deshiGeeCostLedgerMemory.get(dateKey) || {
        dateKey,
        totalUsd: 0,
        requestCount: 0,
        promptTokens: 0,
        outputTokens: 0,
        capHit: false,
        source: 'fallback_memory',
      }
    );
  }
}

export async function recordPersistentDailyCost(
  dateKey: string,
  add: { costUsd: number; promptTokens: number; outputTokens: number; capUsd: number | null }
): Promise<PersistentCostLedgerState> {
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeCostLedgerOverride
  ) {
    return globalFirestoreTestHooks.__deshiGeeCostLedgerOverride.record(dateKey, add);
  }

  const safeCost = Math.max(0, Math.min(0.5, Number(add.costUsd || 0)));
  const safePrompt = Math.max(0, Math.round(add.promptTokens || 0));
  const safeOutput = Math.max(0, Math.round(add.outputTokens || 0));
  const path = `chatbot_cost_ledger/${encodeURIComponent(dateKey)}`;

  // Optimistic retry (2 attempts) to keep persistent ledger accurate across concurrent requests
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const existing = await fetchFsGet(path);
      const prevTotal = Number(existing?.totalUsd || 0);
      const prevReqs = Number(existing?.requestCount || 0);
      const prevPrompt = Number(existing?.promptTokens || 0);
      const prevOutput = Number(existing?.outputTokens || 0);

      const nextTotal = Number((prevTotal + safeCost).toFixed(6));
      const capHit = add.capUsd !== null ? nextTotal >= add.capUsd : Boolean(existing?.capHit);

      const nextPayload = {
        dateKey,
        totalUsd: nextTotal,
        requestCount: prevReqs + 1,
        promptTokens: prevPrompt + safePrompt,
        outputTokens: prevOutput + safeOutput,
        capHit,
      };

      const writeRes = await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          writes: [
            {
              currentDocument: existing ? { exists: true } : { exists: false },
              update: {
                name: docName('chatbot_cost_ledger', dateKey),
                fields: encodeFsFields(nextPayload),
              },
              updateTransforms: [
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
            },
          ],
        }),
        cache: 'no-store',
      });

      if (writeRes.ok) {
        const nextState: PersistentCostLedgerState = {
          ...nextPayload,
          source: 'firestore',
        };
        if (!globalFirestoreTestHooks.__deshiGeeCostLedgerCache) {
          globalFirestoreTestHooks.__deshiGeeCostLedgerCache = new Map();
        }
        globalFirestoreTestHooks.__deshiGeeCostLedgerCache.set(dateKey, {
          expiresAt: Date.now() + COST_LEDGER_CACHE_TTL_MS,
          state: nextState,
        });
        if (capHit && !existing?.capHit) {
          console.warn(
            JSON.stringify({
              event: 'chatbot_cost_cap_reached',
              dateKey,
              totalUsd: nextTotal,
              capUsd: add.capUsd,
            })
          );
        }
        return nextState;
      }
    } catch {
      // Retry or fall through
    }
  }

  if (!globalFirestoreTestHooks.__deshiGeeCostLedgerMemory) {
    globalFirestoreTestHooks.__deshiGeeCostLedgerMemory = new Map();
  }
  const prev = globalFirestoreTestHooks.__deshiGeeCostLedgerMemory.get(dateKey) || {
    dateKey,
    totalUsd: 0,
    requestCount: 0,
    promptTokens: 0,
    outputTokens: 0,
    capHit: false,
    source: 'fallback_memory' as const,
  };
  const nextTotal = Number((prev.totalUsd + safeCost).toFixed(6));
  const fallbackState: PersistentCostLedgerState = {
    dateKey,
    totalUsd: nextTotal,
    requestCount: prev.requestCount + 1,
    promptTokens: prev.promptTokens + safePrompt,
    outputTokens: prev.outputTokens + safeOutput,
    capHit: add.capUsd !== null ? nextTotal >= add.capUsd : prev.capHit,
    source: 'fallback_memory',
  };
  globalFirestoreTestHooks.__deshiGeeCostLedgerMemory.set(dateKey, fallbackState);
  return fallbackState;
}

export async function checkServerFirestoreHealth(
  timeoutMs = 3500
): Promise<{ reachable: boolean; latencyMs: number; detail: string }> {
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeFirestoreHealthOverride
  ) {
    return globalFirestoreTestHooks.__deshiGeeFirestoreHealthOverride();
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${BASE_DOC_URL}/store_settings/main?key=${encodeURIComponent(API_KEY)}`;
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;

    if (res.status === 200) {
      return {
        reachable: true,
        latencyMs,
        detail: 'Firestore REST reachable (store_settings/main readable)',
      };
    }
    if (res.status === 404) {
      return {
        reachable: true,
        latencyMs,
        detail: 'Firestore REST reachable (store_settings/main not yet seeded)',
      };
    }
    return {
      reachable: false,
      latencyMs,
      detail: `Firestore REST HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      reachable: false,
      latencyMs: Date.now() - startedAt,
      detail: err instanceof Error ? err.message.slice(0, 140) : 'Firestore check failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function createServerChatLog(entry: ServerChatLogInput): Promise<string> {
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const docPath = docName('chatbot_logs', logId);
  const maskedUserMsg = maskSensitivePii(entry.userMessage).slice(0, 1000) || '(empty)';
  const maskedReply = maskSensitivePii(entry.assistantReply).slice(0, 2500);
  const path: ChatbotExecutionPath = entry.path || 'fallback';
  const model = (
    entry.model ||
    (path === 'fallback' ? 'live-fallback-engine' : 'gemini')
  ).slice(0, 80);

  const payload = {
    sessionId: (entry.sessionId || 'anon_session').slice(0, 64),
    lang: entry.lang,
    userMessage: maskedUserMsg,
    assistantReply: maskedReply,
    intent: (entry.intent || 'general').slice(0, 60),
    isUnanswered: Boolean(entry.isUnanswered),
    resolved: false,
    handoverRequested: Boolean(entry.handoverRequested),
    latencyMs: Math.max(0, Math.min(120000, Math.round(entry.latencyMs || 0))),
    promptTokens: Math.max(0, Math.round(entry.promptTokens || 0)),
    outputTokens: Math.max(0, Math.round(entry.outputTokens || 0)),
    estimatedCostUsd: Math.max(0, Number(entry.estimatedCostUsd || 0)),
    errorCode: (entry.errorCode || '').slice(0, 80),
    isTestPlayground: Boolean(entry.isTestPlayground),
    path,
    model,
    isError: Boolean(entry.isError),
    finishReason: (entry.finishReason || '').slice(0, 60),
    guardCategory: (entry.guardCategory || '').slice(0, 60),
    retryCount: Math.max(0, Math.min(10, Math.round(entry.retryCount || 0))),
    toolCallCount: Math.max(0, Math.min(30, Math.round(entry.toolCallCount || 0))),
    factsVersion: (entry.factsVersion || '').slice(0, 40),
    ragMs: Math.max(0, Math.min(60000, Math.round(entry.ragMs || 0))),
    modelMs: Math.max(0, Math.min(120000, Math.round(entry.modelMs || 0))),
    toolMs: Math.max(0, Math.min(60000, Math.round(entry.toolMs || 0))),
    ragSources: (entry.ragSources || []).slice(0, 8).map((s) => String(s).slice(0, 120)),
    confidence: Math.max(0, Math.min(1, Number(entry.confidence ?? 0.9))),
  };

  // Emit structured non-PII diagnostic telemetry for server logs
  console.info(
    JSON.stringify({
      event: 'chatbot_turn',
      logId,
      path: payload.path,
      model: payload.model,
      isError: payload.isError,
      intent: payload.intent,
      confidence: payload.confidence,
      errorCode: payload.errorCode || null,
      finishReason: payload.finishReason || null,
      guardCategory: payload.guardCategory || null,
      retryCount: payload.retryCount,
      toolCallCount: payload.toolCallCount,
      ragMs: payload.ragMs,
      modelMs: payload.modelMs,
      toolMs: payload.toolMs,
      factsVersion: payload.factsVersion || null,
      latencyMs: payload.latencyMs,
      promptTokens: payload.promptTokens,
      outputTokens: payload.outputTokens,
      isTestPlayground: payload.isTestPlayground,
    })
  );

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeChatLogObserver
  ) {
    globalFirestoreTestHooks.__deshiGeeChatLogObserver({ id: logId, ...payload });
    return logId;
  }

  try {
    const res = await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: { exists: false },
            update: {
              name: docPath,
              fields: encodeFsFields(payload),
            },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        ],
      }),
      cache: 'no-store',
    });

    // Backward-compatible retry if a pre-update Firestore ruleset rejects optional telemetry fields
    if (!res.ok && (res.status === 400 || res.status === 403)) {
      const {
        path: _omitPath,
        model: _omitModel,
        isError: _omitIsError,
        finishReason: _omitFr,
        guardCategory: _omitGc,
        retryCount: _omitRc,
        toolCallCount: _omitTc,
        factsVersion: _omitFv,
        ragMs: _omitRagMs,
        modelMs: _omitModelMs,
        toolMs: _omitToolMs,
        ragSources: _omitRagSources,
        confidence: _omitConfidence,
        ...legacyPayload
      } = payload;
      await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          writes: [
            {
              currentDocument: { exists: false },
              update: {
                name: docPath,
                fields: encodeFsFields(legacyPayload),
              },
              updateTransforms: [
                { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              ],
            },
          ],
        }),
        cache: 'no-store',
      }).catch(() => {});
    }
  } catch {
    // Logging must never block chat response
  }
  return logId;
}

export async function fetchServerChatSession(sessionId: string): Promise<ChatSessionDoc | null> {
  const cleanId = String(sessionId || '').trim().slice(0, 64);
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(cleanId)) return null;

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeSessionMemoryMap
  ) {
    return globalFirestoreTestHooks.__deshiGeeSessionMemoryMap.get(cleanId) || null;
  }

  try {
    const doc = await fetchFsGet(`chat_sessions/${encodeURIComponent(cleanId)}`);
    if (!doc) return null;
    return {
      sessionId: String(doc.sessionId || cleanId),
      language: doc.language === 'bn' ? 'bn' : 'en',
      lockedLang: doc.lockedLang === 'bn' || doc.lockedLang === 'en' ? doc.lockedLang : '',
      scriptPreference:
        doc.scriptPreference === 'banglish_roman' || doc.scriptPreference === 'bn_script'
          ? doc.scriptPreference
          : 'en',
      consent: Boolean(doc.consent ?? true),
      currentIntent: String(doc.currentIntent || 'general'),
      orderDraftId: String(doc.orderDraftId || ''),
      turnCount: Number(doc.turnCount || 0),
    };
  } catch {
    return null;
  }
}

export async function upsertServerChatSession(session: ChatSessionDoc): Promise<void> {
  const cleanId = String(session.sessionId || '').trim().slice(0, 64);
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(cleanId)) return;

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeSessionMemoryMap
  ) {
    globalFirestoreTestHooks.__deshiGeeSessionMemoryMap.set(cleanId, { ...session, sessionId: cleanId });
    return;
  }

  try {
    const payload = {
      sessionId: cleanId,
      language: session.language === 'bn' ? 'bn' : 'en',
      lockedLang: session.lockedLang === 'bn' || session.lockedLang === 'en' ? session.lockedLang : '',
      scriptPreference: session.scriptPreference || (session.language === 'bn' ? 'bn_script' : 'en'),
      consent: Boolean(session.consent),
      currentIntent: String(session.currentIntent || 'general').slice(0, 60),
      orderDraftId: String(session.orderDraftId || '').slice(0, 96),
      turnCount: Math.max(0, Math.round(Number(session.turnCount) || 0)),
    };
    await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: docName('chat_sessions', cleanId),
              fields: encodeFsFields(payload),
            },
            updateTransforms: [{ fieldPath: 'lastTurnAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
      cache: 'no-store',
    }).catch(() => {});
  } catch {
    // Non-blocking
  }
}

export async function fetchServerOrderDraft(draftId: string): Promise<OrderDraftDoc | null> {
  const cleanId = String(draftId || '').trim().slice(0, 96);
  if (!/^[a-zA-Z0-9_-]{4,96}$/.test(cleanId)) return null;

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeDraftMemoryMap
  ) {
    return globalFirestoreTestHooks.__deshiGeeDraftMemoryMap.get(cleanId) || null;
  }

  try {
    const doc = await fetchFsGet(`order_drafts/${encodeURIComponent(cleanId)}`);
    if (!doc) return null;
    return {
      draftId: cleanId,
      sessionId: String(doc.sessionId || ''),
      weight:
        doc.weight === '250g' || doc.weight === '500g' || doc.weight === '1kg'
          ? doc.weight
          : undefined,
      qty: typeof doc.qty === 'number' ? doc.qty : undefined,
      qty250g: typeof doc.qty250g === 'number' ? doc.qty250g : undefined,
      qty500g: typeof doc.qty500g === 'number' ? doc.qty500g : undefined,
      qty1kg: typeof doc.qty1kg === 'number' ? doc.qty1kg : undefined,
      customerName: typeof doc.customerName === 'string' && doc.customerName ? doc.customerName : undefined,
      phone: typeof doc.phone === 'string' && doc.phone ? doc.phone : undefined,
      district: typeof doc.district === 'string' && doc.district ? doc.district : undefined,
      area: typeof doc.area === 'string' && doc.area ? doc.area : undefined,
      address: typeof doc.address === 'string' && doc.address ? doc.address : undefined,
      addressQualityNote:
        typeof doc.addressQualityNote === 'string' && doc.addressQualityNote
          ? doc.addressQualityNote
          : undefined,
      paymentMethod:
        doc.paymentMethod === 'cod' || doc.paymentMethod === 'bkash' || doc.paymentMethod === 'nagad'
          ? doc.paymentMethod
          : undefined,
      txnId: typeof doc.txnId === 'string' && doc.txnId ? doc.txnId : undefined,
      couponCode: typeof doc.couponCode === 'string' && doc.couponCode ? doc.couponCode : undefined,
      note: typeof doc.note === 'string' && doc.note ? doc.note : undefined,
      state: (doc.state as OrderDraftDoc['state']) || 'collecting_details',
      priceQuoteVersion: Number(doc.priceQuoteVersion || 1),
      validationErrors: Array.isArray(doc.validationErrors)
        ? doc.validationErrors.map((e) => String(e))
        : [],
      expiresAt: Number(doc.expiresAt || 0),
    };
  } catch {
    return null;
  }
}

export async function upsertServerOrderDraft(draft: OrderDraftDoc): Promise<void> {
  const cleanId = String(draft.draftId || '').trim().slice(0, 96);
  if (!/^[a-zA-Z0-9_-]{4,96}$/.test(cleanId)) return;

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeDraftMemoryMap
  ) {
    globalFirestoreTestHooks.__deshiGeeDraftMemoryMap.set(cleanId, { ...draft, draftId: cleanId });
    return;
  }

  try {
    const payload: Record<string, unknown> = {
      draftId: cleanId,
      sessionId: String(draft.sessionId || '').slice(0, 64),
      weight: draft.weight || '',
      qty: typeof draft.qty === 'number' ? draft.qty : 0,
      qty250g: typeof draft.qty250g === 'number' ? draft.qty250g : 0,
      qty500g: typeof draft.qty500g === 'number' ? draft.qty500g : 0,
      qty1kg: typeof draft.qty1kg === 'number' ? draft.qty1kg : 0,
      customerName: (draft.customerName || '').slice(0, 100),
      phone: (draft.phone || '').slice(0, 15),
      district: (draft.district || '').slice(0, 80),
      area: (draft.area || '').slice(0, 100),
      address: (draft.address || '').slice(0, 300),
      addressQualityNote: (draft.addressQualityNote || '').slice(0, 240),
      paymentMethod: draft.paymentMethod || '',
      txnId: (draft.txnId || '').slice(0, 64),
      couponCode: (draft.couponCode || '').slice(0, 32),
      note: (draft.note || '').slice(0, 240),
      state: draft.state || 'collecting_details',
      priceQuoteVersion: Math.max(1, Math.round(Number(draft.priceQuoteVersion) || 1)),
      validationErrors: (draft.validationErrors || []).slice(0, 8).map((e) => String(e).slice(0, 140)),
      expiresAt: Math.round(Number(draft.expiresAt) || Date.now() + 30 * 60 * 1000),
    };

    await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: docName('order_drafts', cleanId),
              fields: encodeFsFields(payload),
            },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
      cache: 'no-store',
    }).catch(() => {});
  } catch {
    // Non-blocking
  }
}

export async function fetchPublishedKnowledgeChunks(
  includeDraft: boolean,
  idToken?: string
): Promise<KnowledgeChunkRecord[]> {
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeKnowledgeChunksStore
  ) {
    return globalFirestoreTestHooks.__deshiGeeKnowledgeChunksStore.filter(
      (c) => (includeDraft || c.status === 'published') && c.accessScope !== 'internal'
    );
  }

  try {
    if (includeDraft && idToken) {
      const rows = await fetchFsCollectionList('knowledge_chunks', 200, idToken);
      return (rows as unknown as KnowledgeChunkRecord[]).filter((c) => c.accessScope !== 'internal');
    }
    const rows = await runFsStructuredQuery({
      from: [{ collectionId: 'knowledge_chunks' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'status' },
                op: 'EQUAL',
                value: { stringValue: 'published' },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'accessScope' },
                op: 'EQUAL',
                value: { stringValue: 'public' },
              },
            },
          ],
        },
      },
      limit: 160,
    });
    return rows as unknown as KnowledgeChunkRecord[];
  } catch {
    return [];
  }
}

export async function createServerChatFeedback(input: {
  sessionId: string;
  logId?: string;
  rating: 'up' | 'down';
  reason?: FeedbackReason;
  userMessage: string;
  assistantReply: string;
  lang: 'bn' | 'en';
  intent: string;
}): Promise<{ ok: boolean; feedbackId: string }> {
  const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const payload: ChatbotFeedbackDoc = {
    id: feedbackId,
    sessionId: input.sessionId.slice(0, 64),
    logId: (input.logId || '').slice(0, 128),
    rating: input.rating,
    reason: input.rating === 'up' ? '' : input.reason || 'other',
    userMessage: maskSensitivePii(input.userMessage).slice(0, 1000),
    assistantReply: maskSensitivePii(input.assistantReply).slice(0, 2500),
    lang: input.lang,
    intent: input.intent.slice(0, 60),
    resolved: input.rating === 'up',
  };

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeFeedbackObserver
  ) {
    globalFirestoreTestHooks.__deshiGeeFeedbackObserver(payload);
    return { ok: true, feedbackId };
  }

  try {
    const { id: _omitId, ...firestoreBody } = payload;
    const res = await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: { exists: false },
            update: {
              name: docName('chatbot_feedback', feedbackId),
              fields: encodeFsFields(firestoreBody),
            },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
      cache: 'no-store',
    });
    return { ok: res.ok, feedbackId };
  } catch {
    return { ok: false, feedbackId };
  }
}
