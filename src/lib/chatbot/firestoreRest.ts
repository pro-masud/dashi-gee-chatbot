import { createHash } from 'crypto';
import firebaseConfig from '../../../firebase-applet-config.json';
import {
  DEFAULT_ACTIVE_BATCH,
  DEFAULT_STORE_SETTINGS,
  type BatchRecord,
  type CouponRecord,
  type CourierPartner,
  type DeliveryZone,
  type OrderAuditLogRecord,
  type OrderRecord,
  type StoreSettingsDoc,
  type TrackingRecord,
} from '../storeTypes';
import { dispatchWebhookWithRetry, notificationLogs } from '../serverState';
import {
  getMessagingGatewayReadiness,
  sendDirectEmail,
  sendDirectSms,
} from '../integrations/messagingGateway';
import {
  assessAddressCompleteness,
  resolveConfiguredDistrictAndZone,
  resolveZoneDeliveryFeeAndEta,
} from './orderToken';
import { maskSensitivePii } from './domain-guard';
import {
  computePhase5AttributionAnalytics,
  evaluateRetentionEligibility,
  identifyAbandonedDraftCandidates,
  isWithinDhakaQuietHours,
  type AbandonedDraftCandidate,
} from './channelEngine';
import {
  DEFAULT_CHATBOT_CONFIG,
  type ChannelSource,
  type ChannelWebhookEventDoc,
  type ChatAgentReplyItem,
  type ChatSessionDoc,
  type ChatbotConfigDoc,
  type ChatbotExecutionPath,
  type ChatbotFaqDoc,
  type ChatbotFeedbackDoc,
  type ChatbotKbDocRecord,
  type ChatbotLang,
  type ChatbotLogRecord,
  type ChatbotSupportRequestRecord,
  type FeedbackReason,
  type KnowledgeChunkRecord,
  type MarketingConsentDoc,
  type OrderDraftDoc,
  type Phase5AttributionAnalytics,
  type RefillReminderDoc,
  type SupportAgentReplyDoc,
  type SupportCategory,
  type SupportEvidenceDoc,
  type SupportPriority,
  type SupportTicketStatus,
} from './types';

const PROJECT_ID = firebaseConfig.projectId;
const DATABASE_ID = firebaseConfig.firestoreDatabaseId;
const API_KEY = firebaseConfig.apiKey;
const BASE_DOC_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;
const NATIVE_FETCH_AT_LOAD = globalThis.fetch;

/**
 * S0-14 (Fail-Closed Test Guard):
 * Thrown whenever any test runtime attempts a real network write to live Firestore
 * without an active FIRESTORE_EMULATOR_HOST, an active in-memory test mock, or a mocked globalThis.fetch.
 */
export class LiveFirestoreWriteBlockedInTestError extends Error {
  readonly code = 'FAIL_CLOSED_LIVE_FIRESTORE_WRITE';

  constructor(operation: string) {
    super(
      `FAIL_CLOSED_LIVE_FIRESTORE_WRITE: Refusing live Firestore write (${operation}) during test run without FIRESTORE_EMULATOR_HOST, an active in-memory mock, or mocked globalThis.fetch.`
    );
    this.name = 'LiveFirestoreWriteBlockedInTestError';
  }
}

export class ProductionTestModeForbiddenError extends Error {
  readonly code = 'TEST_MODE_FORBIDDEN_IN_PRODUCTION';

  constructor() {
    super(
      'CRITICAL_MISCONFIGURATION: DESHI_GEE_TEST_MODE=1 is forbidden when NODE_ENV=production. Refusing to run in-memory/test hooks in production.'
    );
    this.name = 'ProductionTestModeForbiddenError';
  }
}

export function assertNoTestModeInProduction(): void {
  if (process.env.NODE_ENV === 'production' && process.env.DESHI_GEE_TEST_MODE === '1') {
    const err = new ProductionTestModeForbiddenError();
    console.error(`[SECURITY_FATAL] ${err.message}`);
    throw err;
  }
}

// Fail fast at module evaluation if a production deployment accidentally enables DESHI_GEE_TEST_MODE=1.
assertNoTestModeInProduction();

export function isTestProcessRuntime(): boolean {
  assertNoTestModeInProduction();
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.DESHI_GEE_TEST_MODE === '1' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.execArgv.some((arg) => arg === '--test' || arg.startsWith('--test-')) ||
    process.argv.some(
      (arg) =>
        arg === '--test' ||
        arg.startsWith('--test-') ||
        /(?:^|[/\\])tests[/\\].*\.test\.[cm]?[jt]sx?$/.test(arg)
    )
  );
}

function getFirestoreBaseDocUrl(): string {
  const emulatorHost = (process.env.FIRESTORE_EMULATOR_HOST || '').trim();
  if (emulatorHost) {
    const cleanHost = emulatorHost.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    return `http://${cleanHost}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;
  }
  return BASE_DOC_URL;
}

export function assertLiveFirestoreWriteAllowed(operation: string): void {
  assertNoTestModeInProduction();
  if (!isTestProcessRuntime()) return;
  const hasEmulator = Boolean((process.env.FIRESTORE_EMULATOR_HOST || '').trim());
  const hasMockFetch = globalThis.fetch !== NATIVE_FETCH_AT_LOAD;
  if (!hasEmulator && !hasMockFetch) {
    throw new LiveFirestoreWriteBlockedInTestError(operation);
  }
}

async function firestoreCommitFetch(
  init: RequestInit,
  operation = 'firestore_commit'
): Promise<Response> {
  assertNoTestModeInProduction();
  assertLiveFirestoreWriteAllowed(operation);
  return fetch(`${getFirestoreBaseDocUrl()}:commit?key=${encodeURIComponent(API_KEY)}`, init);
}

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
  const url = `${getFirestoreBaseDocUrl()}/${path}?key=${encodeURIComponent(API_KEY)}`;
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
  const url = `${getFirestoreBaseDocUrl()}/${collectionId}?pageSize=${pageSize}&key=${encodeURIComponent(API_KEY)}`;
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
  const url = `${getFirestoreBaseDocUrl()}:runQuery?key=${encodeURIComponent(API_KEY)}`;
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
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeAdminVerifyOverride
  ) {
    return globalFirestoreTestHooks.__deshiGeeAdminVerifyOverride(authHeader);
  }
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return { ok: false, email: '', uid: '' };
  }
}

export async function fetchServerStoreSettingsWithMeta(): Promise<{
  settings: StoreSettingsDoc;
  confirmedFromDb: boolean;
  source: 'firestore' | 'test_memory' | 'default_fallback';
}> {
  assertNoTestModeInProduction();
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeTestStoreSettings
  ) {
    return {
      settings: { ...globalFirestoreTestHooks.__deshiGeeTestStoreSettings },
      confirmedFromDb: true,
      source: 'test_memory',
    };
  }
  try {
    const data = await fetchFsGet('store_settings/main');
    if (data) {
      return {
        settings: { ...DEFAULT_STORE_SETTINGS, ...(data as Partial<StoreSettingsDoc>) },
        confirmedFromDb: true,
        source: 'firestore',
      };
    }
    return {
      settings: DEFAULT_STORE_SETTINGS,
      confirmedFromDb: false,
      source: 'default_fallback',
    };
  } catch (__fsGuardErr) {
    if (
      __fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError ||
      __fsGuardErr instanceof ProductionTestModeForbiddenError
    ) {
      throw __fsGuardErr;
    }
    return {
      settings: DEFAULT_STORE_SETTINGS,
      confirmedFromDb: false,
      source: 'default_fallback',
    };
  }
}

export async function fetchServerStoreSettings(): Promise<StoreSettingsDoc> {
  const { settings } = await fetchServerStoreSettingsWithMeta();
  return settings;
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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

    const writeRes = await firestoreCommitFetch({
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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
      const res = await firestoreCommitFetch({
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
    if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return [];
  }
}

export function buildDefaultCourierTrackingUrl(
  partner: CourierPartner,
  consignmentId: string
): string {
  const cleanId = String(consignmentId || '').trim();
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(cleanId)) return '';
  if (partner === 'steadfast') {
    return `https://steadfast.com.bd/t/${encodeURIComponent(cleanId)}`;
  }
  if (partner === 'pathao') {
    return `https://merchant.pathao.com/tracking?consignment_id=${encodeURIComponent(cleanId)}`;
  }
  if (partner === 'redx') {
    return `https://redx.com.bd/track-global-parcel/?trackingId=${encodeURIComponent(cleanId)}`;
  }
  return '';
}

export interface ManageOrderParams {
  action:
    | 'check'
    | 'cancel'
    | 'edit_address'
    | 'admin_review_approve'
    | 'admin_review_reject'
    | 'admin_cancel'
    | 'admin_update_courier';
  orderNumber: string;
  phone?: string;
  district?: string;
  area?: string;
  address?: string;
  reason?: string;
  courierPartner?: CourierPartner;
  consignmentId?: string;
  courierTrackingUrl?: string;
  markShipped?: boolean;
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
  currentTotalBdt?: number;
  currentSubtotalBdt?: number;
  currentDiscountBdt?: number;
  suggestedDistrict?: string;
  updatedTotalBdt?: number;
  updatedDeliveryFeeBdt?: number;
  updatedZone?: DeliveryZone;
  updatedDistrict?: string;
  estimatedDelivery?: string;
  courierPartner?: CourierPartner;
  consignmentId?: string;
  courierTrackingUrl?: string;
  dispatchedAtIso?: string;
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
    params.action === 'admin_cancel' ||
    params.action === 'admin_update_courier';

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
      currentTotalBdt: Number(tracking.totalBdt || 0),
      currentSubtotalBdt: Number(tracking.subtotalBdt ?? tracking.totalBdt ?? 0),
      currentDiscountBdt: Number(tracking.discountBdt ?? 0),
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
      if (resolved.needsClarification && resolved.suggestedDistrict) {
        return {
          ok: false,
          eligible: true,
          code: 'district_typo_confirmation_required',
          orderNumber: cleanOrder,
          currentStatus,
          suggestedDistrict: resolved.suggestedDistrict,
          messageEn: `Did you mean ${resolved.suggestedDistrict}? Please confirm the district name before updating the delivery address.`,
          messageBn: `আপনি কি ${resolved.suggestedDistrict} বোঝাতে চেয়েছেন? ঠিকানা আপডেট করার আগে অনুগ্রহ করে জেলার নাম নিশ্চিত করুন।`,
        };
      }
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
      const res = await firestoreCommitFetch({
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
      const res = await firestoreCommitFetch({
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

  if (params.action === 'admin_update_courier') {
    const partnerRaw = String(params.courierPartner || '').trim().toLowerCase();
    if (
      partnerRaw !== 'steadfast' &&
      partnerRaw !== 'pathao' &&
      partnerRaw !== 'redx' &&
      partnerRaw !== 'manual'
    ) {
      return {
        ok: false,
        eligible: false,
        code: 'invalid_courier_partner',
        orderNumber: cleanOrder,
        messageEn: 'Courier partner must be steadfast, pathao, redx, or manual.',
        messageBn: 'কুরিয়ার পার্টনার steadfast, pathao, redx অথবা manual হতে হবে।',
      };
    }
    const partner = partnerRaw as CourierPartner;
    const consignmentId = String(params.consignmentId || '').trim().slice(0, 80);
    const rawTrackingUrl = String(params.courierTrackingUrl || '').trim().slice(0, 300);

    if (rawTrackingUrl && !/^https:\/\/[^\s]+$/i.test(rawTrackingUrl)) {
      return {
        ok: false,
        eligible: false,
        code: 'invalid_tracking_url',
        orderNumber: cleanOrder,
        messageEn: 'Courier tracking URL must start with https://',
        messageBn: 'কুরিয়ার ট্র্যাকিং লিংক অবশ্যই https:// দিয়ে শুরু হতে হবে।',
      };
    }

    const courierTrackingUrl =
      rawTrackingUrl || buildDefaultCourierTrackingUrl(partner, consignmentId);
    const markShipped = params.markShipped !== false;
    const nextStatus =
      markShipped && currentStatus !== 'delivered' && currentStatus !== 'cancelled'
        ? 'shipped'
        : currentStatus;
    const dispatchedAtIso =
      adminOrderDoc?.dispatchedAtIso ||
      tracking.dispatchedAtIso ||
      (nextStatus === 'shipped' || consignmentId ? new Date().toISOString() : '');

    if (memEnabled) {
      const mem = globalFirestoreTestHooks.__deshiGeeOrderMemoryState!;
      const ord = mem.orders.get(cleanOrder);
      if (ord) {
        ord.courierPartner = partner;
        ord.consignmentId = consignmentId;
        ord.courierTrackingUrl = courierTrackingUrl;
        if (dispatchedAtIso) ord.dispatchedAtIso = dispatchedAtIso;
        ord.status = nextStatus;
      }
      tracking.courierPartner = partner;
      tracking.consignmentId = consignmentId;
      tracking.courierTrackingUrl = courierTrackingUrl;
      if (dispatchedAtIso) tracking.dispatchedAtIso = dispatchedAtIso;
      tracking.status = nextStatus;

      mem.auditLogs.push({
        id: auditId,
        orderNumber: cleanOrder,
        action: 'courier_updated',
        actorType: 'admin',
        summary: `Courier ${partner}${consignmentId ? ` (${consignmentId})` : ''} assigned by ${params.actorEmail || 'admin'}.`.slice(
          0,
          300
        ),
        previousStatus: currentStatus,
        nextStatus,
        metadata: { partner, consignmentId },
        createdAt: new Date().toISOString(),
      });
    } else if (params.adminIdToken) {
      const updateFields: Record<string, unknown> = {
        courierPartner: partner,
        consignmentId,
        courierTrackingUrl,
        status: nextStatus,
      };
      if (dispatchedAtIso) {
        updateFields.dispatchedAtIso = dispatchedAtIso;
      }
      const fieldPaths = Object.keys(updateFields);
      const res = await firestoreCommitFetch({
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
                fields: encodeFsFields(updateFields),
              },
              updateMask: { fieldPaths },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              currentDocument: { exists: true },
              update: {
                name: docName('order_tracking', `${cleanOrder}_${effectivePhone}`),
                fields: encodeFsFields(updateFields),
              },
              updateMask: { fieldPaths },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              currentDocument: { exists: false },
              update: {
                name: docName('order_audit_logs', auditId),
                fields: encodeFsFields({
                  orderNumber: cleanOrder,
                  action: 'courier_updated',
                  actorType: 'admin',
                  summary: `Courier ${partner}${consignmentId ? ` (${consignmentId})` : ''} updated by admin.`.slice(
                    0,
                    300
                  ),
                  previousStatus: currentStatus,
                  nextStatus,
                  metadata: { partner, consignmentId },
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
          code: 'courier_update_failed',
          orderNumber: cleanOrder,
          messageEn: 'Could not update courier consignment details.',
          messageBn: 'কুরিয়ার কনসাইনমেন্ট তথ্য আপডেট করা যায়নি।',
        };
      }
    }

    return {
      ok: true,
      eligible: true,
      orderNumber: cleanOrder,
      currentStatus,
      nextStatus,
      courierPartner: partner,
      consignmentId,
      courierTrackingUrl,
      dispatchedAtIso,
      messageEn: `Courier updated (${partner.toUpperCase()}${consignmentId ? ` · ${consignmentId}` : ''}).`,
      messageBn: `কুরিয়ার তথ্য আপডেট হয়েছে (${partner.toUpperCase()}${consignmentId ? ` · ${consignmentId}` : ''})।`,
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
    const res = await firestoreCommitFetch({
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

export interface CreateSupportRequestInput {
  sessionId: string;
  customerName: string;
  phone: string;
  issueSummary: string;
  orderNumber?: string;
  category?: SupportCategory;
  priority?: SupportPriority;
  contextSummary?: string;
  transcriptExcerpt?: string;
  consentGranted?: boolean;
  evidenceIds?: string[];
  paymentStatusSnapshot?: string;
  orderStatusSnapshot?: string;
  slaMinutes?: number;
  slaDueAtIso?: string;
  slaWindowLabelEn?: string;
  slaWindowLabelBn?: string;
  channel?: ChannelSource;
  externalThreadId?: string;
}

export async function createServerSupportRequest(
  input: CreateSupportRequestInput
): Promise<{ ok: boolean; requestId?: string; ticketNumber?: string; error?: string }> {
  const cleanPhone = input.phone.replace(/[\s-]/g, '');
  if (!/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
    return { ok: false, error: 'Valid Bangladesh mobile number (01XXXXXXXXX) is required.' };
  }
  const cleanName = input.customerName.trim().slice(0, 100);
  const cleanSummary = input.issueSummary.trim().slice(0, 500);
  if (cleanName.length < 2 || cleanSummary.length < 4) {
    return { ok: false, error: 'Customer name and issue summary are required.' };
  }

  const reqId = `sup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ticketNumber = `TK-${String(Date.now()).slice(-6)}`;
  const docPath = docName('chatbot_support_requests', reqId);

  const cleanOrder = input.orderNumber ? input.orderNumber.trim().toUpperCase() : '';
  const safeEvidenceIds = Array.isArray(input.evidenceIds)
    ? input.evidenceIds
        .map((id) => String(id || '').trim())
        .filter((id) => /^[a-zA-Z0-9_-]{4,96}$/.test(id))
        .slice(0, 6)
    : undefined;

  const payload: Record<string, unknown> = {
    sessionId: input.sessionId.slice(0, 64),
    customerName: cleanName,
    phone: cleanPhone,
    issueSummary: cleanSummary,
    status: 'open',
    ticketNumber,
  };
  if (cleanOrder && /^DG-[0-9]{4,8}$/.test(cleanOrder)) {
    payload.orderNumber = cleanOrder;
  }
  if (input.category) {
    payload.category = input.category;
  }
  if (input.priority) {
    payload.priority = input.priority;
  }
  if (input.contextSummary) {
    payload.contextSummary = maskSensitivePii(input.contextSummary.trim()).slice(0, 1000);
  }
  if (input.consentGranted !== undefined) {
    payload.consentGranted = Boolean(input.consentGranted);
  }
  if (input.transcriptExcerpt && input.consentGranted !== false) {
    payload.transcriptExcerpt = maskSensitivePii(input.transcriptExcerpt.trim()).slice(0, 2000);
  }
  if (safeEvidenceIds && safeEvidenceIds.length > 0) {
    payload.evidenceIds = safeEvidenceIds;
  }
  if (input.paymentStatusSnapshot) {
    payload.paymentStatusSnapshot = String(input.paymentStatusSnapshot).slice(0, 40);
  }
  if (input.orderStatusSnapshot) {
    payload.orderStatusSnapshot = String(input.orderStatusSnapshot).slice(0, 40);
  }
  if (typeof input.slaMinutes === 'number' && Number.isFinite(input.slaMinutes)) {
    payload.slaMinutes = Math.max(5, Math.min(2880, Math.round(input.slaMinutes)));
  }
  if (input.slaDueAtIso) {
    payload.slaDueAtIso = String(input.slaDueAtIso).slice(0, 48);
  }
  if (input.slaWindowLabelEn) {
    payload.slaWindowLabelEn = String(input.slaWindowLabelEn).slice(0, 240);
  }
  if (input.slaWindowLabelBn) {
    payload.slaWindowLabelBn = String(input.slaWindowLabelBn).slice(0, 300);
  }
  if (input.channel) {
    payload.channel = input.channel;
  }
  if (input.externalThreadId) {
    payload.externalThreadId = String(input.externalThreadId).slice(0, 128);
  }

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeSupportMemoryState?.enabled
  ) {
    const nowIso = new Date().toISOString();
    globalFirestoreTestHooks.__deshiGeeSupportMemoryState.tickets.set(reqId, {
      ...(payload as unknown as ChatbotSupportRequestRecord),
      id: reqId,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    return { ok: true, requestId: reqId, ticketNumber };
  }

  try {
    const res = await firestoreCommitFetch({
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
    return { ok: true, requestId: reqId, ticketNumber };
  } catch (err) {
    if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
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
  channel?: ChannelSource;
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
  __deshiGeeSupportMemoryState?: {
    enabled: boolean;
    tickets: Map<string, ChatbotSupportRequestRecord>;
    evidence: Map<string, SupportEvidenceDoc>;
    agentReplies: SupportAgentReplyDoc[];
  } | null;
  __deshiGeeRetentionMemoryState?: {
    enabled: boolean;
    reviewClaims: Map<string, { orderNumber: string; createdAt: string }>;
    reviews: Map<string, Record<string, unknown>>;
    refillReminders: Map<string, RefillReminderDoc>;
  } | null;
  __deshiGeeChannelMemoryState?: {
    enabled: boolean;
    webhookEvents: Map<string, ChannelWebhookEventDoc>;
    marketingConsents: Map<string, MarketingConsentDoc>;
    chatLogs: ChatbotLogRecord[];
  } | null;
  __deshiGeeAdminVerifyOverride?:
    | ((authHeader: string | null) => Promise<{ ok: boolean; email: string; uid: string }>)
    | null;
};

export function setAdminAuthOverrideForTests(
  fn: ((authHeader: string | null) => Promise<{ ok: boolean; email: string; uid: string }>) | null
): void {
  assertNoTestModeInProduction();
  if (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') {
    globalFirestoreTestHooks.__deshiGeeAdminVerifyOverride = fn;
  }
}

export function setSupportInboxMemoryModeForTests(enabled: boolean): void {
  assertNoTestModeInProduction();
  if (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') {
    globalFirestoreTestHooks.__deshiGeeSupportMemoryState = enabled
      ? {
          enabled: true,
          tickets: new Map(),
          evidence: new Map(),
          agentReplies: [],
        }
      : null;
  }
}

export function getSupportInboxMemoryStateForTests() {
  return globalFirestoreTestHooks.__deshiGeeSupportMemoryState || null;
}

export function setRetentionMemoryModeForTests(enabled: boolean): void {
  assertNoTestModeInProduction();
  if (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') {
    globalFirestoreTestHooks.__deshiGeeRetentionMemoryState = enabled
      ? {
          enabled: true,
          reviewClaims: new Map(),
          reviews: new Map(),
          refillReminders: new Map(),
        }
      : null;
  }
}

export function getRetentionMemoryStateForTests() {
  return globalFirestoreTestHooks.__deshiGeeRetentionMemoryState || null;
}

export function setChannelMemoryModeForTests(enabled: boolean): void {
  assertNoTestModeInProduction();
  if (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') {
    globalFirestoreTestHooks.__deshiGeeChannelMemoryState = enabled
      ? {
          enabled: true,
          webhookEvents: new Map(),
          marketingConsents: new Map(),
          chatLogs: [],
        }
      : null;
  }
}

export function getChannelMemoryStateForTests() {
  return globalFirestoreTestHooks.__deshiGeeChannelMemoryState || null;
}

export function setInventoryMemoryModeForTests(
  settingsOverride: Partial<StoreSettingsDoc> | null
): void {
  assertNoTestModeInProduction();
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
  assertNoTestModeInProduction();
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
  assertNoTestModeInProduction();
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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

      const writeRes = await firestoreCommitFetch({
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
    } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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
    if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
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
    channel: entry.channel || 'web',
  };

  // Emit structured non-PII diagnostic telemetry for server logs
  const telemetryLog: Record<string, unknown> = {
    event: 'chatbot_turn',
    logId,
    channel: payload.channel,
    path: payload.path,
    model: payload.model,
    status: payload.isError ? 'failed' : 'ok',
    intent: payload.intent,
    confidence: payload.confidence,
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
  };
  if (payload.isError || payload.errorCode) {
    telemetryLog.failureCode = payload.errorCode || 'unknown';
  }
  if (payload.isError) {
    console.warn(JSON.stringify(telemetryLog));
  } else {
    console.info(JSON.stringify(telemetryLog));
  }

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeChannelMemoryState?.enabled
  ) {
    globalFirestoreTestHooks.__deshiGeeChannelMemoryState.chatLogs.push({
      id: logId,
      ...payload,
      createdAt: new Date().toISOString(),
    });
  }

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeChatLogObserver
  ) {
    globalFirestoreTestHooks.__deshiGeeChatLogObserver({ id: logId, ...payload });
    return logId;
  }

  try {
    const res = await firestoreCommitFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: { exists: false },
            update: {
              name: docName('chatbot_logs', logId),
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
        channel: _omitChannel,
        ...legacyPayload
      } = payload;
      await firestoreCommitFetch({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          writes: [
            {
              currentDocument: { exists: false },
              update: {
                name: docName('chatbot_logs', logId),
                fields: encodeFsFields(legacyPayload),
              },
              updateTransforms: [
                { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              ],
            },
          ],
        }),
        cache: 'no-store',
      }).catch((err) => {
        if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
      });
    }
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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
    const rawReplies = Array.isArray(doc.agentReplies) ? doc.agentReplies : [];
    const agentReplies: ChatAgentReplyItem[] = rawReplies
      .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
      .map((r) => ({
        id: String(r.id || '').slice(0, 64),
        agentName: String(r.agentName || 'Deshi Gee Support').slice(0, 80),
        text: String(r.text || '').slice(0, 2000),
        createdAtIso: String(r.createdAtIso || ''),
      }))
      .filter((r) => r.text.length > 0)
      .slice(-25);

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
      aiPaused: Boolean(doc.aiPaused ?? false),
      activeTicketId: typeof doc.activeTicketId === 'string' ? doc.activeTicketId : '',
      assignedAgentName: typeof doc.assignedAgentName === 'string' ? doc.assignedAgentName : '',
      agentReplies,
      channel:
        typeof doc.channel === 'string' &&
        ['web', 'messenger', 'instagram', 'whatsapp', 'email', 'sms'].includes(doc.channel)
          ? (doc.channel as ChannelSource)
          : 'web',
      externalUserId: typeof doc.externalUserId === 'string' ? doc.externalUserId : '',
      linkedPhone: typeof doc.linkedPhone === 'string' ? doc.linkedPhone : '',
    };
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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
    const prev = globalFirestoreTestHooks.__deshiGeeSessionMemoryMap.get(cleanId);
    globalFirestoreTestHooks.__deshiGeeSessionMemoryMap.set(cleanId, {
      ...prev,
      ...session,
      sessionId: cleanId,
      aiPaused: session.aiPaused ?? prev?.aiPaused ?? false,
      activeTicketId: session.activeTicketId ?? prev?.activeTicketId ?? '',
      assignedAgentName: session.assignedAgentName ?? prev?.assignedAgentName ?? '',
      agentReplies: session.agentReplies ?? prev?.agentReplies ?? [],
      channel: session.channel ?? prev?.channel ?? 'web',
      externalUserId: session.externalUserId ?? prev?.externalUserId ?? '',
      linkedPhone: prev?.linkedPhone || session.linkedPhone || '',
    });
    return;
  }

  try {
    // Only write visitor-owned fields so admin-owned human handover fields cannot be tampered with
    const payload: Record<string, unknown> = {
      sessionId: cleanId,
      language: session.language === 'bn' ? 'bn' : 'en',
      lockedLang: session.lockedLang === 'bn' || session.lockedLang === 'en' ? session.lockedLang : '',
      scriptPreference: session.scriptPreference || (session.language === 'bn' ? 'bn_script' : 'en'),
      consent: Boolean(session.consent),
      currentIntent: String(session.currentIntent || 'general').slice(0, 60),
      orderDraftId: String(session.orderDraftId || '').slice(0, 96),
      turnCount: Math.max(0, Math.round(Number(session.turnCount) || 0)),
      channel: session.channel || 'web',
    };
    const fieldPaths = [
      'sessionId',
      'language',
      'lockedLang',
      'scriptPreference',
      'consent',
      'currentIntent',
      'orderDraftId',
      'turnCount',
      'channel',
    ];
    if (session.externalUserId) {
      payload.externalUserId = String(session.externalUserId).slice(0, 128);
      fieldPaths.push('externalUserId');
    }

    await firestoreCommitFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: docName('chat_sessions', cleanId),
              fields: encodeFsFields(payload),
            },
            updateMask: {
              fieldPaths,
            },
            updateTransforms: [{ fieldPath: 'lastTurnAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
      cache: 'no-store',
    }).catch((err) => {
      if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
    });
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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

    await firestoreCommitFetch({
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
    }).catch((err) => {
      if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
    });
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
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
    const res = await firestoreCommitFetch({
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
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return { ok: false, feedbackId };
  }
}

export async function createServerSupportEvidence(input: {
  sessionId: string;
  orderNumber?: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  filename: string;
  sizeBytes: number;
  dataBase64: string;
  purpose: 'damage_claim' | 'payment_dispute' | 'general';
}): Promise<{ ok: boolean; evidenceId?: string; error?: string }> {
  const cleanSession = String(input.sessionId || 'track_anon').trim().slice(0, 64);
  const cleanOrder = input.orderNumber ? input.orderNumber.trim().toUpperCase() : '';
  const evidenceId = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const payload: Record<string, unknown> = {
    sessionId: /^[a-zA-Z0-9_-]{4,64}$/.test(cleanSession) ? cleanSession : 'track_anon',
    mimeType: input.mimeType,
    filename: String(input.filename || 'evidence.jpg').slice(0, 120),
    sizeBytes: Math.round(Number(input.sizeBytes) || 0),
    dataBase64: input.dataBase64,
    purpose: input.purpose || 'general',
  };
  if (cleanOrder && /^DG-[0-9]{4,8}$/.test(cleanOrder)) {
    payload.orderNumber = cleanOrder;
  }

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeSupportMemoryState?.enabled
  ) {
    globalFirestoreTestHooks.__deshiGeeSupportMemoryState.evidence.set(evidenceId, {
      id: evidenceId,
      sessionId: payload.sessionId as string,
      orderNumber: cleanOrder || undefined,
      mimeType: input.mimeType,
      filename: payload.filename as string,
      sizeBytes: payload.sizeBytes as number,
      dataBase64: input.dataBase64,
      purpose: input.purpose,
      createdAt: new Date().toISOString(),
    });
    return { ok: true, evidenceId };
  }

  try {
    const res = await firestoreCommitFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: { exists: false },
            update: {
              name: docName('support_evidence', evidenceId),
              fields: encodeFsFields(payload),
            },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, evidenceId };
  } catch (err) {
    if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to store evidence' };
  }
}

export async function fetchAdminSupportEvidence(
  evidenceId: string,
  adminIdToken?: string
): Promise<SupportEvidenceDoc | null> {
  const cleanId = String(evidenceId || '').trim();
  if (!/^[a-zA-Z0-9_-]{4,96}$/.test(cleanId)) return null;

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeSupportMemoryState?.enabled
  ) {
    return globalFirestoreTestHooks.__deshiGeeSupportMemoryState.evidence.get(cleanId) || null;
  }

  if (!adminIdToken) return null;
  try {
    const doc = await fetchFsGet(`support_evidence/${encodeURIComponent(cleanId)}`, adminIdToken);
    return doc ? (doc as unknown as SupportEvidenceDoc) : null;
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return null;
  }
}

export async function fetchAdminSupportTickets(
  adminIdToken?: string
): Promise<ChatbotSupportRequestRecord[]> {
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeSupportMemoryState?.enabled
  ) {
    return Array.from(globalFirestoreTestHooks.__deshiGeeSupportMemoryState.tickets.values()).sort(
      (a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
    );
  }
  if (!adminIdToken) return [];
  try {
    const rows = await fetchFsCollectionList('chatbot_support_requests', 200, adminIdToken);
    return (rows as unknown as ChatbotSupportRequestRecord[]).sort((a, b) =>
      String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
    );
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return [];
  }
}

export async function setAdminSessionAiPause(input: {
  sessionId: string;
  aiPaused: boolean;
  ticketId?: string;
  agentName?: string;
  adminIdToken?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const cleanSession = String(input.sessionId || '').trim().slice(0, 64);
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(cleanSession)) {
    return { ok: false, error: 'Invalid sessionId' };
  }

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeSessionMemoryMap
  ) {
    const existing = globalFirestoreTestHooks.__deshiGeeSessionMemoryMap.get(cleanSession);
    globalFirestoreTestHooks.__deshiGeeSessionMemoryMap.set(cleanSession, {
      sessionId: cleanSession,
      language: existing?.language || 'bn',
      lockedLang: existing?.lockedLang || '',
      scriptPreference: existing?.scriptPreference || 'bn_script',
      consent: existing?.consent ?? true,
      currentIntent: existing?.currentIntent || 'human_help',
      orderDraftId: existing?.orderDraftId || '',
      turnCount: existing?.turnCount || 0,
      agentReplies: existing?.agentReplies || [],
      ...existing,
      aiPaused: input.aiPaused,
      activeTicketId: input.ticketId !== undefined ? input.ticketId : existing?.activeTicketId || '',
      assignedAgentName:
        input.agentName !== undefined ? input.agentName : existing?.assignedAgentName || '',
    });
    return { ok: true };
  }

  if (!input.adminIdToken) return { ok: false, error: 'Admin token required' };
  try {
    const existingDoc = await fetchFsGet(`chat_sessions/${encodeURIComponent(cleanSession)}`, input.adminIdToken);
    const updateFields: Record<string, unknown> = {
      aiPaused: Boolean(input.aiPaused),
      activeTicketId: String(input.ticketId ?? existingDoc?.activeTicketId ?? '').slice(0, 96),
      assignedAgentName: String(input.agentName ?? existingDoc?.assignedAgentName ?? '').slice(0, 80),
    };
    if (!existingDoc) {
      updateFields.sessionId = cleanSession;
      updateFields.language = 'bn';
      updateFields.lockedLang = '';
      updateFields.scriptPreference = 'bn_script';
      updateFields.consent = true;
      updateFields.currentIntent = 'human_help';
      updateFields.orderDraftId = '';
      updateFields.turnCount = 0;
    }
    const res = await firestoreCommitFetch({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.adminIdToken}`,
      },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: docName('chat_sessions', cleanSession),
              fields: encodeFsFields(updateFields),
            },
            updateMask: { fieldPaths: Object.keys(updateFields) },
            updateTransforms: [{ fieldPath: 'lastTurnAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
      cache: 'no-store',
    });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to toggle AI pause' };
  }
}

export async function updateAdminSupportTicket(input: {
  ticketId: string;
  status?: SupportTicketStatus;
  priority?: SupportPriority;
  assignedTo?: string;
  tags?: string[];
  resolutionReason?: string;
  internalNotes?: string;
  resumeAiOnResolve?: boolean;
  adminIdToken?: string;
  actorEmail?: string;
}): Promise<{ ok: boolean; ticket?: ChatbotSupportRequestRecord; error?: string }> {
  const cleanTicket = String(input.ticketId || '').trim();
  if (!/^[a-zA-Z0-9_-]{4,96}$/.test(cleanTicket)) {
    return { ok: false, error: 'Invalid ticketId' };
  }

  const nowIso = new Date().toISOString();

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeSupportMemoryState?.enabled
  ) {
    const ticket = globalFirestoreTestHooks.__deshiGeeSupportMemoryState.tickets.get(cleanTicket);
    if (!ticket) return { ok: false, error: 'Ticket not found' };
    if (input.status) ticket.status = input.status;
    if (input.priority) ticket.priority = input.priority;
    if (input.assignedTo !== undefined) ticket.assignedTo = input.assignedTo.slice(0, 120);
    if (input.tags !== undefined) {
      ticket.tags = input.tags.map((t) => String(t).trim().slice(0, 32)).filter(Boolean).slice(0, 10);
    }
    if (input.resolutionReason !== undefined) {
      ticket.resolutionReason = input.resolutionReason.slice(0, 240);
    }
    if (input.internalNotes !== undefined) {
      ticket.internalNotes = input.internalNotes.slice(0, 1000);
    }
    if (!ticket.firstRespondedAtIso && input.status && input.status !== 'open') {
      ticket.firstRespondedAtIso = nowIso;
    }
    if (input.status === 'resolved') {
      ticket.resolvedAtIso = nowIso;
      if (input.resumeAiOnResolve !== false && ticket.sessionId) {
        await setAdminSessionAiPause({
          sessionId: ticket.sessionId,
          aiPaused: false,
          ticketId: cleanTicket,
        });
      }
    }
    ticket.updatedAt = nowIso;
    return { ok: true, ticket };
  }

  if (!input.adminIdToken) return { ok: false, error: 'Admin token required' };

  try {
    const existing = await fetchFsGet(
      `chatbot_support_requests/${encodeURIComponent(cleanTicket)}`,
      input.adminIdToken
    );
    if (!existing) return { ok: false, error: 'Ticket not found' };

    const updateFields: Record<string, unknown> = {};
    if (input.status) updateFields.status = input.status;
    if (input.priority) updateFields.priority = input.priority;
    if (input.assignedTo !== undefined) updateFields.assignedTo = input.assignedTo.slice(0, 120);
    if (input.tags !== undefined) {
      updateFields.tags = input.tags
        .map((t) => String(t).trim().slice(0, 32))
        .filter(Boolean)
        .slice(0, 10);
    }
    if (input.resolutionReason !== undefined) {
      updateFields.resolutionReason = input.resolutionReason.slice(0, 240);
    }
    if (input.internalNotes !== undefined) {
      updateFields.internalNotes = input.internalNotes.slice(0, 1000);
    }
    if (!existing.firstRespondedAtIso && input.status && input.status !== 'open') {
      updateFields.firstRespondedAtIso = nowIso;
    }
    if (input.status === 'resolved') {
      updateFields.resolvedAtIso = nowIso;
    }

    if (Object.keys(updateFields).length === 0) {
      return { ok: true, ticket: existing as unknown as ChatbotSupportRequestRecord };
    }

    const res = await firestoreCommitFetch({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.adminIdToken}`,
      },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: { exists: true },
            update: {
              name: docName('chatbot_support_requests', cleanTicket),
              fields: encodeFsFields(updateFields),
            },
            updateMask: { fieldPaths: Object.keys(updateFields) },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
      cache: 'no-store',
    });

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    if (input.status === 'resolved' && input.resumeAiOnResolve !== false && typeof existing.sessionId === 'string') {
      await setAdminSessionAiPause({
        sessionId: existing.sessionId,
        aiPaused: false,
        ticketId: cleanTicket,
        adminIdToken: input.adminIdToken,
      });
    }

    return {
      ok: true,
      ticket: {
        ...(existing as unknown as ChatbotSupportRequestRecord),
        ...(updateFields as Partial<ChatbotSupportRequestRecord>),
        updatedAt: nowIso,
      },
    };
  } catch (err) {
    if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
    return { ok: false, error: err instanceof Error ? err.message : 'Ticket update failed' };
  }
}

export async function postAdminAgentReply(input: {
  ticketId: string;
  sessionId: string;
  agentEmail: string;
  agentName: string;
  text: string;
  adminIdToken?: string;
}): Promise<{ ok: boolean; reply?: ChatAgentReplyItem; error?: string }> {
  const cleanTicket = String(input.ticketId || '').trim();
  const cleanSession = String(input.sessionId || '').trim();
  const cleanText = String(input.text || '').trim().slice(0, 2000);
  const cleanAgentName = String(input.agentName || 'Deshi Gee Support').trim().slice(0, 80);

  if (!/^[a-zA-Z0-9_-]{4,96}$/.test(cleanTicket) || !/^[a-zA-Z0-9_-]{4,64}$/.test(cleanSession)) {
    return { ok: false, error: 'Valid ticketId and sessionId are required.' };
  }
  if (!cleanText) {
    return { ok: false, error: 'Reply message cannot be empty.' };
  }

  const replyId = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const nowIso = new Date().toISOString();
  const replyItem: ChatAgentReplyItem = {
    id: replyId,
    agentName: cleanAgentName,
    text: cleanText,
    createdAtIso: nowIso,
  };

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeSupportMemoryState?.enabled
  ) {
    const supportMem = globalFirestoreTestHooks.__deshiGeeSupportMemoryState;
    supportMem.agentReplies.push({
      id: replyId,
      ticketId: cleanTicket,
      sessionId: cleanSession,
      agentEmail: input.agentEmail,
      agentName: cleanAgentName,
      text: cleanText,
      createdAtIso: nowIso,
      createdAt: nowIso,
    });
    const ticket = supportMem.tickets.get(cleanTicket);
    if (ticket) {
      if (!ticket.firstRespondedAtIso) ticket.firstRespondedAtIso = nowIso;
      if (!ticket.assignedTo) ticket.assignedTo = input.agentEmail || cleanAgentName;
      if (ticket.status === 'open' || ticket.status === 'pending') {
        ticket.status = 'contacted';
      }
      ticket.updatedAt = nowIso;
    }
    if (globalFirestoreTestHooks.__deshiGeeSessionMemoryMap) {
      const prev = globalFirestoreTestHooks.__deshiGeeSessionMemoryMap.get(cleanSession);
      const nextReplies = [...(prev?.agentReplies || []), replyItem].slice(-25);
      globalFirestoreTestHooks.__deshiGeeSessionMemoryMap.set(cleanSession, {
        sessionId: cleanSession,
        language: prev?.language || 'bn',
        lockedLang: prev?.lockedLang || '',
        scriptPreference: prev?.scriptPreference || 'bn_script',
        consent: prev?.consent ?? true,
        currentIntent: prev?.currentIntent || 'human_help',
        orderDraftId: prev?.orderDraftId || '',
        turnCount: prev?.turnCount || 0,
        ...prev,
        aiPaused: true,
        activeTicketId: cleanTicket,
        assignedAgentName: cleanAgentName,
        agentReplies: nextReplies,
      });
    }
    return { ok: true, reply: replyItem };
  }

  if (!input.adminIdToken) return { ok: false, error: 'Admin token required' };

  try {
    const [existingTicket, existingSession] = await Promise.all([
      fetchFsGet(`chatbot_support_requests/${encodeURIComponent(cleanTicket)}`, input.adminIdToken),
      fetchServerChatSession(cleanSession),
    ]);

    const prevReplies = existingSession?.agentReplies || [];
    const nextReplies = [...prevReplies, replyItem].slice(-25);

    const sessionFields: Record<string, unknown> = {
      sessionId: cleanSession,
      language: existingSession?.language || 'bn',
      lockedLang: existingSession?.lockedLang || '',
      scriptPreference: existingSession?.scriptPreference || 'bn_script',
      consent: existingSession?.consent ?? true,
      currentIntent: existingSession?.currentIntent || 'human_help',
      orderDraftId: existingSession?.orderDraftId || '',
      turnCount: existingSession?.turnCount || 0,
      aiPaused: true,
      activeTicketId: cleanTicket,
      assignedAgentName: cleanAgentName,
      agentReplies: nextReplies,
    };

    const ticketUpdateFields: Record<string, unknown> = {
      assignedTo: String(existingTicket?.assignedTo || input.agentEmail || cleanAgentName).slice(0, 120),
      status:
        existingTicket?.status === 'open' || existingTicket?.status === 'pending'
          ? 'contacted'
          : String(existingTicket?.status || 'contacted'),
    };
    if (!existingTicket?.firstRespondedAtIso) {
      ticketUpdateFields.firstRespondedAtIso = nowIso;
    }

    const writes: Record<string, unknown>[] = [
      {
        currentDocument: { exists: false },
        update: {
          name: docName('support_agent_replies', replyId),
          fields: encodeFsFields({
            ticketId: cleanTicket,
            sessionId: cleanSession,
            agentEmail: String(input.agentEmail || '').slice(0, 160),
            agentName: cleanAgentName,
            text: cleanText,
            createdAtIso: nowIso,
          }),
        },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      },
      {
        update: {
          name: docName('chat_sessions', cleanSession),
          fields: encodeFsFields(sessionFields),
        },
        updateTransforms: [{ fieldPath: 'lastTurnAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ];

    if (existingTicket) {
      writes.push({
        currentDocument: { exists: true },
        update: {
          name: docName('chatbot_support_requests', cleanTicket),
          fields: encodeFsFields(ticketUpdateFields),
        },
        updateMask: { fieldPaths: Object.keys(ticketUpdateFields) },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      });
    }

    const res = await firestoreCommitFetch({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.adminIdToken}`,
      },
      body: JSON.stringify({ writes }),
      cache: 'no-store',
    });

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, reply: replyItem };
  } catch (err) {
    if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to post reply' };
  }
}

export async function createVerifiedDeliveryReview(input: {
  orderNumber: string;
  phone: string;
  customerName: string;
  district?: string;
  rating: number;
  comment: string;
  photoData?: string;
}): Promise<{ ok: boolean; reviewId?: string; code?: string; messageEn: string; messageBn: string }> {
  const cleanOrder = String(input.orderNumber || '').trim().toUpperCase();
  const cleanPhone = String(input.phone || '').replace(/[\s-]/g, '');
  const cleanName = String(input.customerName || '').trim().slice(0, 80);
  const cleanComment = String(input.comment || '').trim().slice(0, 600);
  const rating = Math.round(Number(input.rating));

  if (!/^DG-[0-9]{4,8}$/.test(cleanOrder) || !/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
    return {
      ok: false,
      code: 'invalid_credentials',
      messageEn: 'Valid order number (DG-XXXXX) and 11-digit checkout phone are required.',
      messageBn: 'সঠিক অর্ডার নম্বর ও ১১ সংখ্যার মোবাইল নম্বর দিন।',
    };
  }
  if (cleanName.length < 2 || cleanComment.length < 6 || !(rating >= 1 && rating <= 5)) {
    return {
      ok: false,
      code: 'invalid_review_fields',
      messageEn: 'Please provide your name, a 1-5 star rating, and at least 6 characters of feedback.',
      messageBn: 'অনুগ্রহ করে আপনার নাম, ১-৫ রেটিং এবং অন্তত ৬ অক্ষরের রিভিউ লিখুন।',
    };
  }

  const tracking = await fetchServerOrderTracking(cleanOrder, cleanPhone);
  if (!tracking) {
    return {
      ok: false,
      code: 'order_not_found',
      messageEn: 'No matching order was found for that order number and phone.',
      messageBn: 'এই অর্ডার নম্বর ও ফোনের সাথে কোনো অর্ডার পাওয়া যায়নি।',
    };
  }

  if (tracking.status !== 'delivered') {
    return {
      ok: false,
      code: 'not_delivered',
      messageEn: 'Verified purchase reviews can only be submitted once your order is delivered.',
      messageBn: 'ভেরিফায়েড রিভিউ কেবল অর্ডার ডেলিভারি সম্পন্ন হওয়ার পর জমা দেওয়া যায়।',
    };
  }

  const reviewId = `rev_${cleanOrder}`;
  const cleanDistrict = String(input.district || tracking.district || 'Dhaka').trim().slice(0, 80) || 'Dhaka';
  const cleanPhoto =
    typeof input.photoData === 'string' && input.photoData.startsWith('data:image/')
      ? input.photoData.slice(0, 180000)
      : '';

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeRetentionMemoryState?.enabled
  ) {
    const mem = globalFirestoreTestHooks.__deshiGeeRetentionMemoryState;
    if (mem.reviewClaims.has(cleanOrder) || mem.reviews.has(reviewId)) {
      return {
        ok: false,
        code: 'already_reviewed',
        messageEn: 'A verified review has already been submitted for this order.',
        messageBn: 'এই অর্ডারের জন্য ইতিমধ্যে একটি ভেরিফায়েড রিভিউ জমা দেওয়া হয়েছে।',
      };
    }
    const nowIso = new Date().toISOString();
    mem.reviewClaims.set(cleanOrder, { orderNumber: cleanOrder, createdAt: nowIso });
    mem.reviews.set(reviewId, {
      id: reviewId,
      customerName: cleanName,
      district: cleanDistrict,
      rating,
      comment: cleanComment,
      orderNumber: cleanOrder,
      verifiedPurchase: true,
      helpfulCount: 0,
      photoData: cleanPhoto,
      status: 'pending',
      createdAt: nowIso,
    });
    return {
      ok: true,
      reviewId,
      messageEn: 'Thank you! Your verified review has been submitted for moderation.',
      messageBn: 'ধন্যবাদ! আপনার ভেরিফায়েড রিভিউটি অনুমোদনের জন্য জমা হয়েছে।',
    };
  }

  try {
    const existingClaim = await fetchFsGet(`order_review_claims/${encodeURIComponent(cleanOrder)}`);
    if (existingClaim) {
      return {
        ok: false,
        code: 'already_reviewed',
        messageEn: 'A verified review has already been submitted for this order.',
        messageBn: 'এই অর্ডারের জন্য ইতিমধ্যে একটি ভেরিফায়েড রিভিউ জমা দেওয়া হয়েছে।',
      };
    }

    const res = await firestoreCommitFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: { exists: false },
            update: {
              name: docName('order_review_claims', cleanOrder),
              fields: encodeFsFields({ orderNumber: cleanOrder }),
            },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            currentDocument: { exists: false },
            update: {
              name: docName('reviews', reviewId),
              fields: encodeFsFields({
                customerName: cleanName,
                district: cleanDistrict,
                rating,
                comment: cleanComment,
                orderNumber: cleanOrder,
                verifiedPurchase: true,
                helpfulCount: 0,
                photoData: cleanPhoto,
                status: 'pending',
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
        code: res.status === 409 ? 'already_reviewed' : 'submit_failed',
        messageEn:
          res.status === 409
            ? 'A verified review has already been submitted for this order.'
            : 'Could not save review right now.',
        messageBn:
          res.status === 409
            ? 'এই অর্ডারের জন্য ইতিমধ্যে একটি ভেরিফায়েড রিভিউ জমা দেওয়া হয়েছে।'
            : 'এই মুহূর্তে রিভিউ সংরক্ষণ করা যায়নি।',
      };
    }

    return {
      ok: true,
      reviewId,
      messageEn: 'Thank you! Your verified review has been submitted for moderation.',
      messageBn: 'ধন্যবাদ! আপনার ভেরিফায়েড রিভিউটি অনুমোদনের জন্য জমা হয়েছে।',
    };
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return {
      ok: false,
      code: 'submit_failed',
      messageEn: 'Could not save review right now.',
      messageBn: 'এই মুহূর্তে রিভিউ সংরক্ষণ করা যায়নি।',
    };
  }
}

export async function fetchRefillReminder(
  orderNumber: string,
  phone: string
): Promise<RefillReminderDoc | null> {
  const cleanOrder = String(orderNumber || '').trim().toUpperCase();
  const cleanPhone = String(phone || '').replace(/[\s-]/g, '');
  if (!/^DG-[0-9]{4,8}$/.test(cleanOrder) || !/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
    return null;
  }
  const key = `${cleanOrder}_${cleanPhone}`;

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeRetentionMemoryState?.enabled
  ) {
    return globalFirestoreTestHooks.__deshiGeeRetentionMemoryState.refillReminders.get(key) || null;
  }

  try {
    const doc = await fetchFsGet(`refill_reminders/${encodeURIComponent(key)}`);
    return doc ? (doc as unknown as RefillReminderDoc) : null;
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return null;
  }
}

export async function upsertRefillReminder(input: {
  orderNumber: string;
  phone: string;
  intervalDays?: 30 | 45 | 60 | 90;
  status?: 'active' | 'paused' | 'opted_out';
  consentGranted?: boolean;
  customerName?: string;
}): Promise<{ ok: boolean; reminder?: RefillReminderDoc; code?: string; messageEn: string; messageBn: string }> {
  const cleanOrder = String(input.orderNumber || '').trim().toUpperCase();
  const cleanPhone = String(input.phone || '').replace(/[\s-]/g, '');
  if (!/^DG-[0-9]{4,8}$/.test(cleanOrder) || !/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
    return {
      ok: false,
      code: 'invalid_credentials',
      messageEn: 'Valid order number and 11-digit phone are required.',
      messageBn: 'সঠিক অর্ডার নম্বর ও ১১ সংখ্যার মোবাইল নম্বর দিন।',
    };
  }

  const tracking = await fetchServerOrderTracking(cleanOrder, cleanPhone);
  if (!tracking) {
    return {
      ok: false,
      code: 'order_not_found',
      messageEn: 'Order could not be verified.',
      messageBn: 'অর্ডারটি যাচাই করা যায়নি।',
    };
  }

  const key = `${cleanOrder}_${cleanPhone}`;
  const existing = await fetchRefillReminder(cleanOrder, cleanPhone);

  if (!existing && input.consentGranted !== true) {
    return {
      ok: false,
      code: 'consent_required',
      messageEn: 'Explicit opt-in consent is required to enable refill reminders.',
      messageBn: 'রিফিল রিমাইন্ডার চালু করতে আপনার স্পষ্ট সম্মতি প্রয়োজন।',
    };
  }

  const validIntervals = [30, 45, 60, 90] as const;
  const intervalDays: 30 | 45 | 60 | 90 =
    input.intervalDays && (validIntervals as readonly number[]).includes(input.intervalDays)
      ? input.intervalDays
      : existing?.intervalDays || 45;
  const nextStatus: 'active' | 'paused' | 'opted_out' =
    input.status === 'active' || input.status === 'paused' || input.status === 'opted_out'
      ? input.status
      : existing?.status || 'active';

  const nextReminderAtIso = new Date(Date.now() + intervalDays * 86_400_000).toISOString();
  const payload: Omit<RefillReminderDoc, 'id' | 'createdAt' | 'updatedAt'> = {
    orderNumber: cleanOrder,
    phone: cleanPhone,
    customerName: String(input.customerName || existing?.customerName || 'Customer').slice(0, 100),
    weight: tracking.weight,
    intervalDays,
    status: nextStatus,
    consentGranted: existing ? existing.consentGranted : true,
    nextReminderAtIso,
  };

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeRetentionMemoryState?.enabled
  ) {
    const nowIso = new Date().toISOString();
    const doc: RefillReminderDoc = {
      id: key,
      ...payload,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    globalFirestoreTestHooks.__deshiGeeRetentionMemoryState.refillReminders.set(key, doc);
    return {
      ok: true,
      reminder: doc,
      messageEn:
        nextStatus === 'active'
          ? `Refill reminder set for every ${intervalDays} days.`
          : `Refill reminder ${nextStatus}.`,
      messageBn:
        nextStatus === 'active'
          ? `প্রতি ${intervalDays} দিন পর রিফিল রিমাইন্ডার সেট করা হয়েছে।`
          : `রিফিল রিমাইন্ডার ${nextStatus === 'paused' ? 'বিরতি দেওয়া' : 'বন্ধ করা'} হয়েছে।`,
    };
  }

  try {
    const writes = existing
      ? [
          {
            currentDocument: { exists: true },
            update: {
              name: docName('refill_reminders', key),
              fields: encodeFsFields({
                intervalDays,
                status: nextStatus,
                nextReminderAtIso,
              }),
            },
            updateMask: { fieldPaths: ['intervalDays', 'status', 'nextReminderAtIso'] },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ]
      : [
          {
            currentDocument: { exists: false },
            update: {
              name: docName('refill_reminders', key),
              fields: encodeFsFields(payload as unknown as Record<string, unknown>),
            },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        ];

    const res = await firestoreCommitFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes }),
      cache: 'no-store',
    });

    if (!res.ok) {
      return {
        ok: false,
        code: 'save_failed',
        messageEn: 'Could not save refill reminder setting.',
        messageBn: 'রিফিল রিমাইন্ডার সংরক্ষণ করা যায়নি।',
      };
    }

    return {
      ok: true,
      reminder: { id: key, ...payload },
      messageEn:
        nextStatus === 'active'
          ? `Refill reminder set for every ${intervalDays} days.`
          : `Refill reminder ${nextStatus}.`,
      messageBn:
        nextStatus === 'active'
          ? `প্রতি ${intervalDays} দিন পর রিফিল রিমাইন্ডার সেট করা হয়েছে।`
          : `রিফিল রিমাইন্ডার ${nextStatus === 'paused' ? 'বিরতি দেওয়া' : 'বন্ধ করা'} হয়েছে।`,
    };
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return {
      ok: false,
      code: 'save_failed',
      messageEn: 'Could not save refill reminder setting.',
      messageBn: 'রিফিল রিমাইন্ডার সংরক্ষণ করা যায়নি।',
    };
  }
}

export async function buildVerifiedReorderPayload(
  orderNumber: string,
  phone: string
): Promise<{
  ok: boolean;
  code?: string;
  orderNumber?: string;
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  subtotalBdt?: number;
  adjustedForStock?: boolean;
  reorderQuery?: string;
  reorderUrl?: string;
  itemsSummary?: string;
  messageEn: string;
  messageBn: string;
}> {
  const cleanOrder = String(orderNumber || '').trim().toUpperCase();
  const cleanPhone = String(phone || '').replace(/[\s-]/g, '');
  if (!/^DG-[0-9]{4,8}$/.test(cleanOrder) || !/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
    return {
      ok: false,
      code: 'invalid_credentials',
      messageEn: 'Valid order number and 11-digit phone are required.',
      messageBn: 'সঠিক অর্ডার নম্বর ও ১১ সংখ্যার মোবাইল নম্বর দিন।',
    };
  }

  const [tracking, settings] = await Promise.all([
    fetchServerOrderTracking(cleanOrder, cleanPhone),
    fetchServerStoreSettings(),
  ]);

  if (!tracking) {
    return {
      ok: false,
      code: 'order_not_found',
      messageEn: 'No matching order found for that order number and phone.',
      messageBn: 'এই অর্ডার নম্বর ও ফোনের সাথে কোনো অর্ডার পাওয়া যায়নি।',
    };
  }

  const req250 = Number(tracking.qty250g ?? (tracking.weight === '250g' ? tracking.qty : 0));
  const req500 = Number(tracking.qty500g ?? (tracking.weight === '500g' ? tracking.qty : 0));
  const req1k = Number(tracking.qty1kg ?? (tracking.weight === '1kg' ? tracking.qty : 0));

  const qty250g = Math.max(0, Math.min(req250, settings.stock250g));
  const qty500g = Math.max(0, Math.min(req500, settings.stock500g));
  const qty1kg = Math.max(0, Math.min(req1k, settings.stock1kg));

  if (qty250g + qty500g + qty1kg === 0) {
    return {
      ok: false,
      code: 'out_of_stock',
      orderNumber: cleanOrder,
      messageEn: 'Sorry, all jar sizes from that previous order are currently out of stock.',
      messageBn: 'দুঃখিত, আগের অর্ডারের জার সাইজগুলো বর্তমানে স্টকে নেই।',
    };
  }

  const adjustedForStock = qty250g !== req250 || qty500g !== req500 || qty1kg !== req1k;
  const subtotalBdt =
    qty250g * settings.price250g + qty500g * settings.price500g + qty1kg * settings.price1kg;

  const parts: string[] = [];
  const summaryParts: string[] = [];
  if (qty250g > 0) {
    parts.push(`250g:${qty250g}`);
    summaryParts.push(`${qty250g}x 250g`);
  }
  if (qty500g > 0) {
    parts.push(`500g:${qty500g}`);
    summaryParts.push(`${qty500g}x 500g`);
  }
  if (qty1kg > 0) {
    parts.push(`1kg:${qty1kg}`);
    summaryParts.push(`${qty1kg}x 1kg`);
  }

  const reorderQuery = parts.join(',');
  const reorderUrl = `/?reorder=${encodeURIComponent(reorderQuery)}`;
  const itemsSummary = summaryParts.join(', ');

  return {
    ok: true,
    orderNumber: cleanOrder,
    qty250g,
    qty500g,
    qty1kg,
    subtotalBdt,
    adjustedForStock,
    reorderQuery,
    reorderUrl,
    itemsSummary,
    messageEn: adjustedForStock
      ? `Prepared reorder (${itemsSummary}, current subtotal ৳${subtotalBdt}) adjusted to live stock.`
      : `Prepared reorder (${itemsSummary}, current subtotal ৳${subtotalBdt}) matching your previous order.`,
    messageBn: adjustedForStock
      ? `বর্তমান স্টক অনুযায়ী রিঅর্ডার (${itemsSummary}, বর্তমান মূল্য ৳${subtotalBdt}) প্রস্তুত করা হয়েছে।`
      : `আপনার আগের অর্ডারের (${itemsSummary}, বর্তমান মূল্য ৳${subtotalBdt}) রিঅর্ডার লিংক প্রস্তুত হয়েছে।`,
  };
}

export async function fetchAdminRefillReminders(
  adminIdToken?: string
): Promise<RefillReminderDoc[]> {
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeRetentionMemoryState?.enabled
  ) {
    return Array.from(
      globalFirestoreTestHooks.__deshiGeeRetentionMemoryState.refillReminders.values()
    ).sort((a, b) => Date.parse(a.nextReminderAtIso) - Date.parse(b.nextReminderAtIso));
  }

  try {
    const rows = await fetchFsCollectionList('refill_reminders', 200, adminIdToken);
    return (rows as unknown as RefillReminderDoc[]).sort(
      (a, b) => Date.parse(a.nextReminderAtIso) - Date.parse(b.nextReminderAtIso)
    );
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return [];
  }
}

export interface RefillDispatchItemResult {
  id: string;
  orderNumber: string;
  customerName?: string;
  weight?: string;
  intervalDays: number;
  previousDueAtIso: string;
  nextReminderAtIso: string;
  reminderCount: number;
  status: 'dry_run_due' | 'dispatched' | 'logged_no_webhook' | 'failed';
  detail?: string;
}

export interface RefillDispatchSummary {
  ok: boolean;
  dryRun: boolean;
  evaluatedAtIso: string;
  totalReminders: number;
  totalActive: number;
  dueCount: number;
  dispatchedCount: number;
  skippedCount: number;
  failedCount: number;
  items: RefillDispatchItemResult[];
}

export async function dispatchDueRefillReminders(options?: {
  now?: Date;
  dryRun?: boolean;
  adminIdToken?: string;
  reminderIds?: string[];
}): Promise<RefillDispatchSummary> {
  const now = options?.now || new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const dryRun = Boolean(options?.dryRun);
  const all = await fetchAdminRefillReminders(options?.adminIdToken);
  const filterSet =
    options?.reminderIds && options.reminderIds.length > 0
      ? new Set(options.reminderIds.map((id) => id.trim()))
      : null;

  const activeReminders = all.filter(
    (r) => r.status === 'active' && r.consentGranted === true
  );
  const dueReminders = activeReminders.filter((r) => {
    if (filterSet && !filterSet.has(r.id) && !filterSet.has(r.orderNumber)) {
      return false;
    }
    const dueMs = Date.parse(r.nextReminderAtIso);
    return Number.isFinite(dueMs) && dueMs <= nowMs;
  });

  const webhookTargets = [
    { channel: 'whatsapp_api', url: process.env.WHATSAPP_WEBHOOK_URL },
    { channel: 'email_api', url: process.env.EMAIL_WEBHOOK_URL },
    { channel: 'owner_webhook', url: process.env.OWNER_WEBHOOK_URL },
  ].filter((t) => Boolean(t.url));

  const memEnabled =
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeRetentionMemoryState?.enabled;

  const items: RefillDispatchItemResult[] = [];
  let dispatchedCount = 0;
  let failedCount = 0;

  for (const r of dueReminders) {
    const nextReminderAtIso = new Date(nowMs + r.intervalDays * 86_400_000).toISOString();
    const prevCount = Number(r.reminderCount || 0);
    const nextCount = prevCount + 1;

    if (dryRun) {
      items.push({
        id: r.id,
        orderNumber: r.orderNumber,
        customerName: r.customerName,
        weight: r.weight,
        intervalDays: r.intervalDays,
        previousDueAtIso: r.nextReminderAtIso,
        nextReminderAtIso,
        reminderCount: prevCount,
        status: 'dry_run_due',
        detail: 'Eligible for refill reminder dispatch',
      });
      continue;
    }

    let deliveryStatus: 'dispatched' | 'logged_no_webhook' | 'failed' = 'logged_no_webhook';
    let detail = 'No webhook or direct SMS/Email gateway configured; schedule advanced.';
    const directReadiness = getMessagingGatewayReadiness();
    const smsText = `Assalamu Alaikum ${r.customerName || 'Customer'}, Deshi Gee (${r.weight || '500g'}) refill reminder! Order fresh Pabna bilona ghee anytime at ${process.env.NEXT_PUBLIC_SITE_URL || 'https://deshigee.com'}/?reorder=${encodeURIComponent(`${r.weight || '500g'}:1`)}`;

    if (webhookTargets.length > 0 || directReadiness.anyDirectSms || directReadiness.anyDirectEmail) {
      const payload = {
        event: 'refill_reminder_due',
        orderNumber: r.orderNumber,
        customerName: r.customerName || 'Customer',
        phone: r.phone,
        weight: r.weight || '500g',
        intervalDays: r.intervalDays,
        reminderCount: nextCount,
        reorderUrl: `/?reorder=${encodeURIComponent(`${r.weight || '500g'}:1`)}`,
      };
      const tasks = webhookTargets.map((target) =>
        dispatchWebhookWithRetry(target.url as string, `refill_${target.channel}`, payload, 1)
      );
      if (directReadiness.anyDirectSms && r.phone) {
        tasks.push(sendDirectSms({ toPhone: r.phone, message: smsText, orderNumber: r.orderNumber }));
      }
      if (directReadiness.anyDirectEmail && process.env.OWNER_NOTIFICATION_EMAIL) {
        tasks.push(
          sendDirectEmail({
            toEmail: process.env.OWNER_NOTIFICATION_EMAIL,
            subject: `Deshi Gee Refill Reminder Due — ${r.orderNumber}`,
            text: `${smsText}\nCustomer Phone: ${r.phone}\nInterval: ${r.intervalDays} days`,
            orderNumber: r.orderNumber,
          })
        );
      }
      const results = await Promise.all(tasks);
      for (const res of results) {
        notificationLogs.unshift(res);
        if (notificationLogs.length > 50) notificationLogs.pop();
      }
      const anySent = results.some((res) => res.status === 'sent');
      if (anySent) {
        deliveryStatus = 'dispatched';
        detail = 'Notification delivered via configured channel(s)';
      } else {
        deliveryStatus = 'failed';
        detail = results.map((res) => `${res.channel}: ${res.detail}`).join('; ');
      }
    }

    if (deliveryStatus === 'failed') {
      failedCount += 1;
      items.push({
        id: r.id,
        orderNumber: r.orderNumber,
        customerName: r.customerName,
        weight: r.weight,
        intervalDays: r.intervalDays,
        previousDueAtIso: r.nextReminderAtIso,
        nextReminderAtIso: r.nextReminderAtIso,
        reminderCount: prevCount,
        status: 'failed',
        detail,
      });
      continue;
    }

    // Persist schedule advance
    if (memEnabled) {
      const mem = globalFirestoreTestHooks.__deshiGeeRetentionMemoryState!;
      const existing = mem.refillReminders.get(r.id);
      if (existing) {
        existing.lastNotifiedAtIso = nowIso;
        existing.reminderCount = nextCount;
        existing.nextReminderAtIso = nextReminderAtIso;
        existing.updatedAt = nowIso;
      }
    } else if (options?.adminIdToken) {
      const res = await firestoreCommitFetch({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.adminIdToken}`,
        },
        body: JSON.stringify({
          writes: [
            {
              currentDocument: { exists: true },
              update: {
                name: docName('refill_reminders', r.id),
                fields: encodeFsFields({
                  lastNotifiedAtIso: nowIso,
                  reminderCount: nextCount,
                  nextReminderAtIso,
                }),
              },
              updateMask: {
                fieldPaths: ['lastNotifiedAtIso', 'reminderCount', 'nextReminderAtIso'],
              },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
          ],
        }),
        cache: 'no-store',
      });
      if (!res.ok) {
        failedCount += 1;
        items.push({
          id: r.id,
          orderNumber: r.orderNumber,
          customerName: r.customerName,
          weight: r.weight,
          intervalDays: r.intervalDays,
          previousDueAtIso: r.nextReminderAtIso,
          nextReminderAtIso: r.nextReminderAtIso,
          reminderCount: prevCount,
          status: 'failed',
          detail: `Firestore update HTTP ${res.status}`,
        });
        continue;
      }
    }

    dispatchedCount += 1;
    items.push({
      id: r.id,
      orderNumber: r.orderNumber,
      customerName: r.customerName,
      weight: r.weight,
      intervalDays: r.intervalDays,
      previousDueAtIso: r.nextReminderAtIso,
      nextReminderAtIso,
      reminderCount: nextCount,
      status: deliveryStatus,
      detail,
    });
  }

  return {
    ok: failedCount === 0,
    dryRun,
    evaluatedAtIso: nowIso,
    totalReminders: all.length,
    totalActive: activeReminders.length,
    dueCount: dueReminders.length,
    dispatchedCount,
    skippedCount: Math.max(0, all.length - dueReminders.length),
    failedCount,
    items,
  };
}

// =========================================================================
// Phase 5: Omnichannel Webhooks, Identity Linking, Consent Retention & Attribution
// =========================================================================

export async function recordOrCheckWebhookEventIdempotency(input: {
  channel: 'messenger' | 'instagram' | 'whatsapp';
  eventId: string;
  senderId: string;
  verifiedPhone?: string;
  status?: 'processed' | 'duplicate' | 'rejected';
}): Promise<{ ok: boolean; isDuplicate: boolean; docId: string }> {
  const docId =
    String(input.eventId || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 128) || `evt_${Date.now()}`;
  const nowIso = new Date().toISOString();

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeChannelMemoryState?.enabled
  ) {
    const store = globalFirestoreTestHooks.__deshiGeeChannelMemoryState.webhookEvents;
    if (store.has(docId)) {
      return { ok: true, isDuplicate: true, docId };
    }
    store.set(docId, {
      id: docId,
      channel: input.channel,
      eventId: docId,
      senderId: String(input.senderId || '').slice(0, 128),
      verifiedPhone:
        input.verifiedPhone && /^01[3-9][0-9]{8}$/.test(input.verifiedPhone)
          ? input.verifiedPhone
          : undefined,
      status: input.status || 'processed',
      createdAtIso: nowIso,
    });
    return { ok: true, isDuplicate: false, docId };
  }

  try {
    const existing = await fetchFsGet(`channel_webhook_events/${encodeURIComponent(docId)}`);
    if (existing) {
      return { ok: true, isDuplicate: true, docId };
    }

    const payload: Record<string, unknown> = {
      channel: input.channel,
      eventId: docId,
      senderId: String(input.senderId || '').slice(0, 128) || 'unknown_sender',
      status: input.status || 'processed',
      createdAtIso: nowIso,
    };
    if (input.verifiedPhone && /^01[3-9][0-9]{8}$/.test(input.verifiedPhone)) {
      payload.verifiedPhone = input.verifiedPhone;
    }

    const res = await firestoreCommitFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            currentDocument: { exists: false },
            update: {
              name: docName('channel_webhook_events', docId),
              fields: encodeFsFields(payload),
            },
            updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
      cache: 'no-store',
    });
    if (res.status === 409) {
      return { ok: true, isDuplicate: true, docId };
    }
    return { ok: res.ok, isDuplicate: false, docId };
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return { ok: false, isDuplicate: false, docId };
  }
}

export async function linkSessionVerifiedPhone(input: {
  sessionId: string;
  phone: string;
  channel?: ChannelSource;
  externalUserId?: string;
}): Promise<{ ok: boolean; linkedPhone?: string }> {
  const cleanSession = String(input.sessionId || '').trim().slice(0, 64);
  const cleanPhone = String(input.phone || '').replace(/[\s-]/g, '');
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(cleanSession) || !/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
    return { ok: false };
  }

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeSessionMemoryMap
  ) {
    const prev = globalFirestoreTestHooks.__deshiGeeSessionMemoryMap.get(cleanSession);
    const effectivePhone = prev?.linkedPhone || cleanPhone;
    globalFirestoreTestHooks.__deshiGeeSessionMemoryMap.set(cleanSession, {
      sessionId: cleanSession,
      language: prev?.language || 'bn',
      lockedLang: prev?.lockedLang || '',
      scriptPreference: prev?.scriptPreference || 'bn_script',
      consent: prev?.consent ?? true,
      currentIntent: prev?.currentIntent || 'general',
      orderDraftId: prev?.orderDraftId || '',
      turnCount: prev?.turnCount || 0,
      aiPaused: prev?.aiPaused ?? false,
      activeTicketId: prev?.activeTicketId || '',
      assignedAgentName: prev?.assignedAgentName || '',
      agentReplies: prev?.agentReplies || [],
      ...prev,
      channel: input.channel || prev?.channel || 'web',
      externalUserId: input.externalUserId || prev?.externalUserId || '',
      linkedPhone: effectivePhone,
    });
    return { ok: true, linkedPhone: effectivePhone };
  }

  try {
    const existing = await fetchServerChatSession(cleanSession);
    if (existing?.linkedPhone) {
      return { ok: true, linkedPhone: existing.linkedPhone };
    }
    const fields: Record<string, unknown> = existing
      ? {
          linkedPhone: cleanPhone,
          channel: input.channel || existing.channel || 'web',
          ...(input.externalUserId ? { externalUserId: input.externalUserId.slice(0, 128) } : {}),
        }
      : {
          sessionId: cleanSession,
          language: 'bn',
          lockedLang: '',
          scriptPreference: 'bn_script',
          consent: true,
          currentIntent: 'general',
          orderDraftId: '',
          turnCount: 0,
          channel: input.channel || 'web',
          externalUserId: String(input.externalUserId || '').slice(0, 128),
          linkedPhone: cleanPhone,
        };

    const res = await firestoreCommitFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: docName('chat_sessions', cleanSession),
              fields: encodeFsFields(fields),
            },
            updateMask: { fieldPaths: Object.keys(fields) },
            updateTransforms: [{ fieldPath: 'lastTurnAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
      cache: 'no-store',
    });
    return { ok: res.ok, linkedPhone: cleanPhone };
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return { ok: false };
  }
}

export async function fetchMarketingConsentByPhone(
  phone: string
): Promise<MarketingConsentDoc | null> {
  const cleanPhone = String(phone || '').replace(/[\s-]/g, '');
  if (!/^01[3-9][0-9]{8}$/.test(cleanPhone)) return null;

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeChannelMemoryState?.enabled
  ) {
    return (
      globalFirestoreTestHooks.__deshiGeeChannelMemoryState.marketingConsents.get(cleanPhone) || null
    );
  }

  try {
    const doc = await fetchFsGet(`marketing_consents/${encodeURIComponent(cleanPhone)}`);
    return doc ? (doc as unknown as MarketingConsentDoc) : null;
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return null;
  }
}

export async function upsertMarketingConsent(input: {
  phone: string;
  customerName?: string;
  channel: ChannelSource;
  optIn: boolean;
  unsubscribed: boolean;
  source: MarketingConsentDoc['source'];
  quietHoursRespect?: boolean;
}): Promise<{ ok: boolean; record?: MarketingConsentDoc; error?: string }> {
  const cleanPhone = String(input.phone || '').replace(/[\s-]/g, '');
  if (!/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
    return { ok: false, error: 'Valid 11-digit Bangladesh mobile number (01XXXXXXXXX) is required.' };
  }

  const nowIso = new Date().toISOString();
  const quietHoursRespect = input.quietHoursRespect ?? true;

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeChannelMemoryState?.enabled
  ) {
    const store = globalFirestoreTestHooks.__deshiGeeChannelMemoryState.marketingConsents;
    const prev = store.get(cleanPhone);
    const nextDoc: MarketingConsentDoc = {
      id: cleanPhone,
      phone: cleanPhone,
      customerName: String(input.customerName || prev?.customerName || '').slice(0, 100) || undefined,
      channel: input.channel || prev?.channel || 'web',
      optIn: input.unsubscribed ? false : Boolean(input.optIn),
      unsubscribed: Boolean(input.unsubscribed),
      source: input.source,
      quietHoursRespect,
      consentTimestampIso: nowIso,
      lastCampaignAtIso: prev?.lastCampaignAtIso,
      campaignCount: prev?.campaignCount ?? 0,
      createdAt: prev?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    store.set(cleanPhone, nextDoc);
    return { ok: true, record: nextDoc };
  }

  try {
    const existing = await fetchMarketingConsentByPhone(cleanPhone);
    const nextOptIn = input.unsubscribed ? false : Boolean(input.optIn);
    const writes = existing
      ? [
          {
            currentDocument: { exists: true },
            update: {
              name: docName('marketing_consents', cleanPhone),
              fields: encodeFsFields({
                optIn: nextOptIn,
                unsubscribed: Boolean(input.unsubscribed),
                quietHoursRespect,
                channel: input.channel || existing.channel || 'web',
                source: input.source,
                consentTimestampIso: nowIso,
              }),
            },
            updateMask: {
              fieldPaths: [
                'optIn',
                'unsubscribed',
                'quietHoursRespect',
                'channel',
                'source',
                'consentTimestampIso',
              ],
            },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ]
      : [
          {
            currentDocument: { exists: false },
            update: {
              name: docName('marketing_consents', cleanPhone),
              fields: encodeFsFields({
                phone: cleanPhone,
                ...(input.customerName
                  ? { customerName: String(input.customerName).slice(0, 100) }
                  : {}),
                channel: input.channel || 'web',
                optIn: nextOptIn,
                unsubscribed: Boolean(input.unsubscribed),
                source: input.source,
                quietHoursRespect,
                consentTimestampIso: nowIso,
                campaignCount: 0,
              }),
            },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          },
        ];

    const res = await firestoreCommitFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes }),
      cache: 'no-store',
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return {
      ok: true,
      record: {
        id: cleanPhone,
        phone: cleanPhone,
        customerName: input.customerName || existing?.customerName,
        channel: input.channel || existing?.channel || 'web',
        optIn: nextOptIn,
        unsubscribed: Boolean(input.unsubscribed),
        source: input.source,
        quietHoursRespect,
        consentTimestampIso: nowIso,
        lastCampaignAtIso: existing?.lastCampaignAtIso,
        campaignCount: existing?.campaignCount ?? 0,
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
      },
    };
  } catch (err) {
    if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
    return { ok: false, error: err instanceof Error ? err.message : 'Consent update failed' };
  }
}

export async function fetchAdminMarketingConsents(
  adminIdToken?: string
): Promise<MarketingConsentDoc[]> {
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeChannelMemoryState?.enabled
  ) {
    return Array.from(
      globalFirestoreTestHooks.__deshiGeeChannelMemoryState.marketingConsents.values()
    ).sort((a, b) => b.consentTimestampIso.localeCompare(a.consentTimestampIso));
  }
  if (!adminIdToken) return [];
  try {
    const rows = await fetchFsCollectionList('marketing_consents', 200, adminIdToken);
    return (rows as unknown as MarketingConsentDoc[]).sort((a, b) =>
      String(b.consentTimestampIso || '').localeCompare(String(a.consentTimestampIso || ''))
    );
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return [];
  }
}

export async function fetchPhase5AttributionAnalyticsSnapshot(
  adminIdToken?: string
): Promise<Phase5AttributionAnalytics> {
  const isTestMem = process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1';

  let logs: ChatbotLogRecord[] = [];
  let drafts: OrderDraftDoc[] = [];
  let orders: OrderRecord[] = [];
  let supportRequests: ChatbotSupportRequestRecord[] = [];

  if (isTestMem && globalFirestoreTestHooks.__deshiGeeChannelMemoryState?.enabled) {
    logs = globalFirestoreTestHooks.__deshiGeeChannelMemoryState.chatLogs;
  } else if (adminIdToken) {
    const rows = await fetchFsCollectionList('chatbot_logs', 200, adminIdToken).catch(() => []);
    logs = rows as unknown as ChatbotLogRecord[];
  }

  if (isTestMem && globalFirestoreTestHooks.__deshiGeeDraftMemoryMap) {
    drafts = Array.from(globalFirestoreTestHooks.__deshiGeeDraftMemoryMap.values());
  } else if (adminIdToken) {
    const rows = await fetchFsCollectionList('order_drafts', 200, adminIdToken).catch(() => []);
    drafts = rows as unknown as OrderDraftDoc[];
  }

  if (isTestMem && globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled) {
    orders = Array.from(globalFirestoreTestHooks.__deshiGeeOrderMemoryState.orders.values());
  } else if (adminIdToken) {
    const rows = await fetchFsCollectionList('orders', 200, adminIdToken).catch(() => []);
    orders = rows as unknown as OrderRecord[];
  }

  if (isTestMem && globalFirestoreTestHooks.__deshiGeeSupportMemoryState?.enabled) {
    supportRequests = Array.from(
      globalFirestoreTestHooks.__deshiGeeSupportMemoryState.tickets.values()
    );
  } else if (adminIdToken) {
    supportRequests = await fetchAdminSupportTickets(adminIdToken);
  }

  return computePhase5AttributionAnalytics({ logs, drafts, orders, supportRequests });
}

export interface RetentionCampaignItemResult {
  phone: string;
  customerName: string;
  segment: 'abandoned_drafts' | 'subscribed_customers';
  channel: string;
  status:
    | 'dry_run_eligible'
    | 'dispatched'
    | 'logged_no_channel_token'
    | 'skipped_quiet_hours'
    | 'skipped_suppressed'
    | 'skipped_frequency_cap'
    | 'failed';
  detail: string;
  draftId?: string;
}

export interface RetentionCampaignSummary {
  ok: boolean;
  dryRun: boolean;
  segment: 'abandoned_drafts' | 'subscribed_customers';
  channel: 'whatsapp' | 'email' | 'sms' | 'messenger' | 'instagram';
  withinDhakaQuietHours: boolean;
  evaluatedAtIso: string;
  totalCandidates: number;
  eligibleCount: number;
  sentCount: number;
  skippedQuietHours: number;
  skippedSuppressed: number;
  skippedFrequencyCap: number;
  failedCount: number;
  abandonedCandidates: AbandonedDraftCandidate[];
  items: RetentionCampaignItemResult[];
}

export async function dispatchConsentRetentionCampaign(options: {
  segment: 'abandoned_drafts' | 'subscribed_customers';
  channel?: 'whatsapp' | 'email' | 'sms' | 'messenger' | 'instagram';
  dryRun?: boolean;
  now?: Date;
  adminIdToken?: string;
}): Promise<RetentionCampaignSummary> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const dryRun = Boolean(options.dryRun);
  const channel = options.channel || 'whatsapp';
  const quietNow = isWithinDhakaQuietHours(now);
  const isTestMem = process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1';

  const [consents, orders, drafts] = await Promise.all([
    fetchAdminMarketingConsents(options.adminIdToken),
    isTestMem && globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled
      ? Promise.resolve(
          Array.from(globalFirestoreTestHooks.__deshiGeeOrderMemoryState.orders.values())
        )
      : options.adminIdToken
        ? (fetchFsCollectionList('orders', 200, options.adminIdToken).catch(
            () => []
          ) as Promise<unknown> as Promise<OrderRecord[]>)
        : Promise.resolve([] as OrderRecord[]),
    isTestMem && globalFirestoreTestHooks.__deshiGeeDraftMemoryMap
      ? Promise.resolve(Array.from(globalFirestoreTestHooks.__deshiGeeDraftMemoryMap.values()))
      : options.adminIdToken
        ? (fetchFsCollectionList('order_drafts', 200, options.adminIdToken).catch(
            () => []
          ) as Promise<unknown> as Promise<OrderDraftDoc[]>)
        : Promise.resolve([] as OrderDraftDoc[]),
  ]);

  const consentMap = new Map<string, MarketingConsentDoc>();
  const suppressedPhones = new Set<string>();
  for (const c of consents) {
    consentMap.set(c.phone, c);
    if (c.unsubscribed || !c.optIn) {
      suppressedPhones.add(c.phone);
    }
  }

  const abandonedCandidates = identifyAbandonedDraftCandidates({
    drafts,
    orders,
    suppressedPhones,
    now,
    minIdleMinutes: 30,
  });

  const targetList: Array<{
    phone: string;
    customerName: string;
    messageBn: string;
    messageEn: string;
    draftId?: string;
    subscriber?: MarketingConsentDoc;
  }> = [];

  if (options.segment === 'abandoned_drafts') {
    for (const c of abandonedCandidates) {
      targetList.push({
        phone: c.phone,
        customerName: c.customerName,
        messageBn: c.recoveryMessageBn,
        messageEn: c.recoveryMessageEn,
        draftId: c.draftId,
        subscriber: consentMap.get(c.phone),
      });
    }
  } else {
    for (const sub of consents) {
      targetList.push({
        phone: sub.phone,
        customerName: sub.customerName || 'Valued Customer',
        messageBn:
          'আসসালামু আলাইকুম! পাবনার বিলোনার নতুন ব্যাচের খাঁটি দেশী গাওয়া ঘি এখন স্টকে রয়েছে। চাইলে ওয়েবসাইট থেকে অর্ডার করতে পারেন।',
        messageEn:
          'Hello from Deshi Gee! A fresh small-batch harvest of Pabna pure bilona ghee is now available if you would like to restock.',
        subscriber: sub,
      });
    }
  }

  const webhookUrl =
    channel === 'whatsapp'
      ? process.env.WHATSAPP_WEBHOOK_URL
      : channel === 'email'
        ? process.env.EMAIL_WEBHOOK_URL
        : undefined;

  const items: RetentionCampaignItemResult[] = [];
  let eligibleCount = 0;
  let sentCount = 0;
  let skippedQuietHours = 0;
  let skippedSuppressed = 0;
  let skippedFrequencyCap = 0;
  let failedCount = 0;

  for (const target of targetList) {
    const subscriber: MarketingConsentDoc = target.subscriber || {
      id: target.phone,
      phone: target.phone,
      customerName: target.customerName,
      channel,
      optIn: options.segment === 'abandoned_drafts' && !suppressedPhones.has(target.phone),
      unsubscribed: suppressedPhones.has(target.phone),
      source: 'chat',
      quietHoursRespect: true,
      consentTimestampIso: nowIso,
      campaignCount: 0,
    };

    const elig = evaluateRetentionEligibility({
      subscriber,
      now,
      minCooldownHours: 72,
      maxCampaignsTotal: 12,
    });

    if (!elig.eligible) {
      if (elig.reason === 'quiet_hours') {
        skippedQuietHours += 1;
        items.push({
          phone: target.phone,
          customerName: target.customerName,
          segment: options.segment,
          channel,
          draftId: target.draftId,
          status: 'skipped_quiet_hours',
          detail: 'Held by Asia/Dhaka quiet hours (22:00–08:00 BST).',
        });
      } else if (elig.reason === 'unsubscribed' || elig.reason === 'opted_out') {
        skippedSuppressed += 1;
        items.push({
          phone: target.phone,
          customerName: target.customerName,
          segment: options.segment,
          channel,
          draftId: target.draftId,
          status: 'skipped_suppressed',
          detail: elig.reason === 'unsubscribed' ? 'Unsubscribed suppression active.' : 'No marketing opt-in.',
        });
      } else {
        skippedFrequencyCap += 1;
        items.push({
          phone: target.phone,
          customerName: target.customerName,
          segment: options.segment,
          channel,
          draftId: target.draftId,
          status: 'skipped_frequency_cap',
          detail: '72h cooldown or campaign cap active.',
        });
      }
      continue;
    }

    eligibleCount += 1;

    if (dryRun) {
      items.push({
        phone: target.phone,
        customerName: target.customerName,
        segment: options.segment,
        channel,
        draftId: target.draftId,
        status: 'dry_run_eligible',
        detail: 'Eligible for polite single-product retention nudge.',
      });
      continue;
    }

    let status: 'dispatched' | 'logged_no_channel_token' | 'failed' = 'logged_no_channel_token';
    let detail = `Channel delivery webhook/token for ${channel} not configured; recorded in dispatch preview.`;
    const directMessaging = getMessagingGatewayReadiness();

    if (webhookUrl) {
      const dispatchRes = await dispatchWebhookWithRetry(
        webhookUrl,
        `retention_${channel}`,
        {
          event:
            options.segment === 'abandoned_drafts'
              ? 'abandoned_draft_recovery'
              : 'retention_restock_nudge',
          phone: target.phone,
          customerName: target.customerName,
          draftId: target.draftId,
          messageBn: target.messageBn,
          messageEn: target.messageEn,
        },
        1
      );
      notificationLogs.unshift(dispatchRes);
      if (notificationLogs.length > 50) notificationLogs.pop();
      if (dispatchRes.status === 'sent') {
        status = 'dispatched';
        detail = 'Retention message dispatched via configured webhook.';
      } else {
        status = 'failed';
        detail = dispatchRes.detail;
      }
    } else if (channel === 'sms' && directMessaging.anyDirectSms) {
      const smsRes = await sendDirectSms({
        toPhone: target.phone,
        message: target.messageBn || target.messageEn,
      });
      notificationLogs.unshift(smsRes);
      if (notificationLogs.length > 50) notificationLogs.pop();
      if (smsRes.status === 'sent') {
        status = 'dispatched';
        detail = smsRes.detail;
      } else {
        status = 'failed';
        detail = smsRes.detail;
      }
    } else if (
      channel === 'email' &&
      directMessaging.anyDirectEmail &&
      process.env.OWNER_NOTIFICATION_EMAIL
    ) {
      const emailRes = await sendDirectEmail({
        toEmail: process.env.OWNER_NOTIFICATION_EMAIL,
        subject: `Deshi Gee Retention (${options.segment}) — ${target.customerName}`,
        text: `${target.messageBn}\n\n${target.messageEn}\nPhone: ${target.phone}`,
      });
      notificationLogs.unshift(emailRes);
      if (notificationLogs.length > 50) notificationLogs.pop();
      if (emailRes.status === 'sent') {
        status = 'dispatched';
        detail = emailRes.detail;
      } else {
        status = 'failed';
        detail = emailRes.detail;
      }
    }

    if (status === 'failed') {
      failedCount += 1;
      items.push({
        phone: target.phone,
        customerName: target.customerName,
        segment: options.segment,
        channel,
        draftId: target.draftId,
        status: 'failed',
        detail,
      });
      continue;
    }

    const nextCount = Number(subscriber.campaignCount || 0) + 1;
    if (isTestMem && globalFirestoreTestHooks.__deshiGeeChannelMemoryState?.enabled) {
      const store = globalFirestoreTestHooks.__deshiGeeChannelMemoryState.marketingConsents;
      const prev = store.get(target.phone);
      if (prev) {
        store.set(target.phone, {
          ...prev,
          lastCampaignAtIso: nowIso,
          campaignCount: nextCount,
          updatedAt: nowIso,
        });
      } else {
        store.set(target.phone, {
          ...subscriber,
          lastCampaignAtIso: nowIso,
          campaignCount: nextCount,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    } else if (options.adminIdToken && target.subscriber) {
      await firestoreCommitFetch({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.adminIdToken}`,
        },
        body: JSON.stringify({
          writes: [
            {
              currentDocument: { exists: true },
              update: {
                name: docName('marketing_consents', target.phone),
                fields: encodeFsFields({
                  lastCampaignAtIso: nowIso,
                  campaignCount: nextCount,
                }),
              },
              updateMask: { fieldPaths: ['lastCampaignAtIso', 'campaignCount'] },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
          ],
        }),
        cache: 'no-store',
      }).catch((err) => {
        if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
      });
    }

    sentCount += 1;
    items.push({
      phone: target.phone,
      customerName: target.customerName,
      segment: options.segment,
      channel,
      draftId: target.draftId,
      status,
      detail,
    });
  }

  return {
    ok: failedCount === 0,
    dryRun,
    segment: options.segment,
    channel,
    withinDhakaQuietHours: quietNow,
    evaluatedAtIso: nowIso,
    totalCandidates: targetList.length,
    eligibleCount,
    sentCount,
    skippedQuietHours,
    skippedSuppressed,
    skippedFrequencyCap,
    failedCount,
    abandonedCandidates,
    items,
  };
}

export async function fetchServerOrderForAdmin(
  orderNumber: string,
  adminIdToken: string
): Promise<OrderRecord | null> {
  const cleanOrder = String(orderNumber || '').trim().toUpperCase();
  if (!/^DG-\d{4,8}$/.test(cleanOrder)) return null;

  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled
  ) {
    return globalFirestoreTestHooks.__deshiGeeOrderMemoryState.orders.get(cleanOrder) || null;
  }

  try {
    const res = await fetch(
      `${BASE_DOC_URL}/orders/${encodeURIComponent(cleanOrder)}?key=${encodeURIComponent(API_KEY)}`,
      {
        headers: {
          Authorization: `Bearer ${adminIdToken}`,
        },
        cache: 'no-store',
      }
    );
    if (!res.ok) return null;
    const raw = (await res.json()) as { fields?: Record<string, FsValue> };
    if (!raw.fields) return null;
    return decodeFsFields(raw.fields) as unknown as OrderRecord;
  } catch (__fsGuardErr) {
    if (__fsGuardErr instanceof LiveFirestoreWriteBlockedInTestError) throw __fsGuardErr;
    return null;
  }
}

export interface PaymentGatewayEventInput {
  eventId: string;
  provider: 'sslcommerz' | 'bkash' | 'steadfast' | 'pathao' | 'redx';
  eventType: 'payment_verified' | 'payment_failed' | 'payment_cancelled' | 'courier_status';
  orderNumber: string;
  externalRef: string;
  amountBdt?: number;
  rawStatus: string;
  verified: boolean;
  auditAction?: 'payment_gateway_verified' | 'courier_webhook_synced';
  auditSummary?: string;
}

const memoryGatewayEvents = new Map<string, PaymentGatewayEventInput>();

export function clearMemoryGatewayEventsForTests(): void {
  if (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') {
    memoryGatewayEvents.clear();
  }
}

export async function recordPaymentGatewayEvent(
  input: PaymentGatewayEventInput
): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  const safeId = input.eventId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 110);
  const nowIso = new Date().toISOString();
  const isTestMem =
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled;

  if (isTestMem) {
    if (memoryGatewayEvents.has(safeId)) {
      return { ok: true, duplicate: true };
    }
    memoryGatewayEvents.set(safeId, input);
    if (input.auditAction && input.auditSummary) {
      globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.auditLogs.push({
        id: `audit_${safeId}`,
        orderNumber: input.orderNumber,
        action: input.auditAction as OrderAuditLogRecord['action'],
        actorType: 'system',
        summary: input.auditSummary.slice(0, 300),
        createdAt: nowIso,
      });
    }
    return { ok: true, duplicate: false };
  }

  try {
    const writes: unknown[] = [
      {
        currentDocument: { exists: false },
        update: {
          name: docName('payment_gateway_events', safeId),
          fields: encodeFsFields({
            provider: input.provider,
            eventType: input.eventType,
            orderNumber: input.orderNumber,
            externalRef: input.externalRef.slice(0, 128),
            ...(typeof input.amountBdt === 'number' ? { amountBdt: input.amountBdt } : {}),
            rawStatus: input.rawStatus.slice(0, 64),
            verified: input.verified,
            createdAtIso: nowIso,
          }),
        },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ];

    if (input.auditAction && input.auditSummary) {
      const logId = `gw_${Date.now()}_${safeId.slice(0, 24)}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      writes.push({
        currentDocument: { exists: false },
        update: {
          name: docName('order_audit_logs', logId),
          fields: encodeFsFields({
            orderNumber: input.orderNumber,
            action: input.auditAction,
            actorType: 'system',
            summary: input.auditSummary.slice(0, 300),
            metadata: {
              provider: input.provider,
              externalRef: input.externalRef.slice(0, 80),
              rawStatus: input.rawStatus.slice(0, 40),
            },
          }),
        },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      });
    }

    const res = await firestoreCommitFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes }),
      cache: 'no-store',
    });

    if (res.status === 409 || res.status === 412) {
      return { ok: true, duplicate: true };
    }
    if (!res.ok) {
      return { ok: false, error: `Firestore gateway event commit failed (${res.status}).` };
    }
    return { ok: true, duplicate: false };
  } catch (err) {
    if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to record gateway event.',
    };
  }
}

/**
 * Authoritative server-side order lookup for payment validation.
 * NEVER trusts client-supplied amounts. Returns null if no server order/tracking record exists.
 */
export async function fetchServerOrderForPaymentValidation(
  orderNumber: string,
  phone?: string
): Promise<{
  orderNumber: string;
  totalBdt: number;
  phone?: string;
  status: string;
  paymentStatus: string;
  consignmentId?: string;
  courierPartner?: string;
} | null> {
  const cleanOrder = String(orderNumber || '').trim().toUpperCase();
  if (!/^DG-\d{4,8}$/.test(cleanOrder)) return null;
  const cleanPhone = String(phone || '').replace(/[\s-]/g, '');

  const isTestMem =
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled;

  if (isTestMem) {
    const mem = globalFirestoreTestHooks.__deshiGeeOrderMemoryState!;
    const order = mem.orders.get(cleanOrder);
    if (order && Number.isFinite(order.totalBdt) && order.totalBdt > 0) {
      return {
        orderNumber: cleanOrder,
        totalBdt: order.totalBdt,
        phone: order.phone,
        status: order.status,
        paymentStatus: order.paymentStatus,
        consignmentId: order.consignmentId,
        courierPartner: order.courierPartner,
      };
    }
    if (cleanPhone) {
      const tr = mem.tracking.get(`${cleanOrder}_${cleanPhone}`);
      if (tr && Number.isFinite(tr.totalBdt) && tr.totalBdt > 0) {
        return {
          orderNumber: cleanOrder,
          totalBdt: tr.totalBdt,
          phone: cleanPhone,
          status: tr.status,
          paymentStatus: tr.paymentStatus,
          consignmentId: tr.consignmentId,
          courierPartner: tr.courierPartner,
        };
      }
    }
    for (const [key, tr] of mem.tracking.entries()) {
      if (tr.orderNumber === cleanOrder && Number.isFinite(tr.totalBdt) && tr.totalBdt > 0) {
        const suffixPhone = key.includes('_') ? key.split('_').slice(1).join('_') : undefined;
        return {
          orderNumber: cleanOrder,
          totalBdt: tr.totalBdt,
          phone: suffixPhone,
          status: tr.status,
          paymentStatus: tr.paymentStatus,
          consignmentId: tr.consignmentId,
          courierPartner: tr.courierPartner,
        };
      }
    }
    return null;
  }

  if (/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
    const tr = await fetchServerOrderTracking(cleanOrder, cleanPhone);
    if (tr && Number.isFinite(tr.totalBdt) && tr.totalBdt > 0) {
      return {
        orderNumber: cleanOrder,
        totalBdt: tr.totalBdt,
        phone: cleanPhone,
        status: tr.status,
        paymentStatus: tr.paymentStatus,
        consignmentId: tr.consignmentId,
        courierPartner: tr.courierPartner,
      };
    }
  }

  // Fallback to server order document if phone wasn't passed on gateway IPN
  const orderData = await fetchFsGet(`orders/${encodeURIComponent(cleanOrder)}`);
  if (orderData && typeof orderData.totalBdt === 'number' && orderData.totalBdt > 0) {
    return {
      orderNumber: cleanOrder,
      totalBdt: orderData.totalBdt,
      phone: typeof orderData.phone === 'string' ? orderData.phone : undefined,
      status: String(orderData.status || 'pending'),
      paymentStatus: String(orderData.paymentStatus || 'pending'),
      consignmentId: typeof orderData.consignmentId === 'string' ? orderData.consignmentId : undefined,
      courierPartner: typeof orderData.courierPartner === 'string' ? orderData.courierPartner : undefined,
    };
  }

  return null;
}

/**
 * Updates order + tracking paymentStatus to 'verified' ONLY after server-side gateway validation.
 */
export async function markServerOrderPaymentVerified(input: {
  orderNumber: string;
  phone?: string;
  transactionId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const cleanOrder = String(input.orderNumber || '').trim().toUpperCase();
  const cleanTxn = String(input.transactionId || '').trim().slice(0, 80);
  const cleanPhone = String(input.phone || '').replace(/[\s-]/g, '');
  if (!/^DG-\d{4,8}$/.test(cleanOrder) || !cleanTxn) {
    return { ok: false, error: 'Invalid orderNumber or transactionId.' };
  }

  const isTestMem =
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled;

  if (isTestMem) {
    const mem = globalFirestoreTestHooks.__deshiGeeOrderMemoryState!;
    const order = mem.orders.get(cleanOrder);
    if (order) {
      order.paymentStatus = 'verified';
      order.txnId = cleanTxn;
      order.updatedAt = Date.now();
      mem.orders.set(cleanOrder, order);
    }
    for (const [key, tr] of mem.tracking.entries()) {
      if (tr.orderNumber === cleanOrder) {
        tr.paymentStatus = 'verified';
        tr.updatedAt = Date.now();
        mem.tracking.set(key, tr);
      }
    }
    return { ok: true };
  }

  try {
    const writes: unknown[] = [
      {
        update: {
          name: docName('orders', cleanOrder),
          fields: encodeFsFields({
            paymentStatus: 'verified',
            txnId: cleanTxn,
          }),
        },
        updateMask: { fieldPaths: ['paymentStatus', 'txnId'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: true },
      },
    ];

    if (/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
      writes.push({
        update: {
          name: docName('order_tracking', `${cleanOrder}_${cleanPhone}`),
          fields: encodeFsFields({
            paymentStatus: 'verified',
          }),
        },
        updateMask: { fieldPaths: ['paymentStatus'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: true },
      });
    }

    const res = await firestoreCommitFetch({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes }),
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, error: `Firestore payment status update failed (${res.status}).` };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to update order payment status.',
    };
  }
}

/**
 * S0-07: Applies a validated courier webhook status transition to orders + order_tracking.
 * Refuses regressive transitions on already-delivered orders.
 */
export async function applyValidatedCourierStatusToOrder(input: {
  orderNumber: string;
  phone?: string;
  nextStatus: OrderRecord['status'];
  courierPartner: CourierPartner;
  consignmentId?: string;
  rawStatus: string;
}): Promise<{ ok: boolean; detail: string }> {
  const cleanOrder = String(input.orderNumber || '').trim().toUpperCase();
  const cleanPhone = String(input.phone || '').replace(/[\s-]/g, '');
  if (!/^DG-\d{4,8}$/.test(cleanOrder)) {
    return { ok: false, detail: 'invalid_order_number' };
  }

  const isTestMem =
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalFirestoreTestHooks.__deshiGeeOrderMemoryState?.enabled;

  if (isTestMem) {
    const mem = globalFirestoreTestHooks.__deshiGeeOrderMemoryState!;
    const order = mem.orders.get(cleanOrder);
    if (!order) {
      return { ok: false, detail: 'order_not_found' };
    }
    if (order.status === 'delivered' && input.nextStatus !== 'delivered') {
      return { ok: false, detail: 'terminal_delivered_locked' };
    }
    order.status = input.nextStatus;
    order.courierPartner = input.courierPartner;
    if (input.consignmentId) {
      order.consignmentId = input.consignmentId;
    }
    order.updatedAt = Date.now();
    mem.orders.set(cleanOrder, order);

    for (const [key, tr] of mem.tracking.entries()) {
      if (tr.orderNumber === cleanOrder) {
        tr.status = input.nextStatus;
        tr.courierPartner = input.courierPartner;
        if (input.consignmentId) {
          tr.consignmentId = input.consignmentId;
        }
        tr.updatedAt = Date.now();
        mem.tracking.set(key, tr);
      }
    }
    return { ok: true, detail: `updated_to_${input.nextStatus}` };
  }

  try {
    const updateFields: Record<string, unknown> = {
      status: input.nextStatus,
      courierPartner: input.courierPartner,
    };
    const fieldPaths = ['status', 'courierPartner'];
    if (input.consignmentId) {
      updateFields.consignmentId = input.consignmentId.slice(0, 80);
      fieldPaths.push('consignmentId');
    }

    const writes: unknown[] = [
      {
        update: {
          name: docName('orders', cleanOrder),
          fields: encodeFsFields(updateFields),
        },
        updateMask: { fieldPaths },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: true },
      },
    ];

    if (/^01[3-9][0-9]{8}$/.test(cleanPhone)) {
      writes.push({
        update: {
          name: docName('order_tracking', `${cleanOrder}_${cleanPhone}`),
          fields: encodeFsFields(updateFields),
        },
        updateMask: { fieldPaths },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: true },
      });
    }

    const res = await firestoreCommitFetch(
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes }),
        cache: 'no-store',
      },
      'apply_validated_courier_status'
    );
    if (!res.ok) {
      return { ok: false, detail: `firestore_commit_failed_${res.status}` };
    }
    return { ok: true, detail: `updated_to_${input.nextStatus}` };
  } catch (err) {
    if (err instanceof LiveFirestoreWriteBlockedInTestError) throw err;
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'courier_status_update_failed',
    };
  }
}


