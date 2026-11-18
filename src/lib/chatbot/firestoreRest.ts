import { createHash } from 'crypto';
import firebaseConfig from '../../../firebase-applet-config.json';
import {
  DEFAULT_ACTIVE_BATCH,
  DEFAULT_STORE_SETTINGS,
  type BatchRecord,
  type CouponRecord,
  type OrderRecord,
  type StoreSettingsDoc,
  type TrackingRecord,
} from '../storeTypes';
import { maskSensitivePii } from './domain-guard';
import {
  DEFAULT_CHATBOT_CONFIG,
  type ChatbotConfigDoc,
  type ChatbotFaqDoc,
  type ChatbotKbDocRecord,
  type ChatbotLang,
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

async function fetchFsGet(
  path: string,
  idToken?: string
): Promise<Record<string, unknown> | null> {
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
  if (res.status === 404 || res.status === 403) {
    return null;
  }
  if (!res.ok) {
    return null;
  }
  const doc = (await res.json()) as FsDocument;
  if (!doc.fields) return null;
  return {
    id: extractDocId(doc.name),
    ...decodeFsFields(doc.fields),
  };
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
  const data = await fetchFsGet(`order_tracking/${encodeURIComponent(lookupId)}`);
  return data ? (data as unknown as TrackingRecord) : null;
}

export async function fetchServerCouponByCode(code: string): Promise<CouponRecord | null> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(clean)) return null;
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

export async function createServerOrderAtomically(
  order: Omit<OrderRecord, 'createdAt' | 'updatedAt'>,
  tokenMeta?: { tokenId: string; sessionId: string; idemKey: string }
): Promise<{ ok: boolean; error?: string; conflict?: boolean }> {
  const orderPath = docName('orders', order.orderNumber);
  const trackingPath = docName('order_tracking', `${order.orderNumber}_${order.phone}`);

  const trackingPayload = {
    orderNumber: order.orderNumber,
    weight: order.weight,
    qty: order.qty,
    itemsSummary: order.itemsSummary,
    totalBdt: order.totalBdt,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    status: order.status,
    estimatedDelivery: order.estimatedDelivery,
  };

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
  ];

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
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        ],
      },
      {
        currentDocument: { exists: false },
        update: {
          name: docName('chatbot_order_idempotency', tokenMeta.idemKey),
          fields: encodeFsFields({
            orderNumber: order.orderNumber,
          }),
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        ],
      }
    );
  }

  try {
    const res = await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const conflict =
        res.status === 409 ||
        errText.includes('ALREADY_EXISTS') ||
        errText.includes('FAILED_PRECONDITION');
      return { ok: false, conflict, error: errText.slice(0, 220) || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Order write failed',
    };
  }
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

export async function createServerChatLog(entry: {
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
}): Promise<void> {
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const docPath = docName('chatbot_logs', logId);
  const maskedUserMsg = maskSensitivePii(entry.userMessage).slice(0, 1000) || '(empty)';
  const maskedReply = maskSensitivePii(entry.assistantReply).slice(0, 2500);

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
  };

  try {
    await fetch(`${BASE_DOC_URL}:commit?key=${encodeURIComponent(API_KEY)}`, {
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
  } catch {
    // Logging must never block chat response
  }
}
