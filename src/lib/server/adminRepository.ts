import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  ADMIN_DATABASE_ID,
  ADMIN_PROJECT_ID,
  AdminSdkUnavailableError,
  getAdminDb,
  getAdminSdkTestAvailabilityOverride,
  isAdminSdkCredentialOrIamError,
} from '../firebaseAdmin';
import {
  DEFAULT_CHATBOT_CONFIG,
  type ChatbotConfigDoc,
} from '../chatbot/types';
import {
  hashTrackingToken,
  isSafeCourierTrackingUrl,
  timingSafeHexEqual,
} from './requestSecurity';
import type { TrackingRecord } from '../storeTypes';
import {
  isTestProcessRuntime,
  LiveFirestoreWriteBlockedInTestError,
} from './runtimeGuards';

const DOC_NAME_PREFIX = `projects/${ADMIN_PROJECT_ID}/databases/${ADMIN_DATABASE_ID}/documents/`;

export interface FsValueWire {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  arrayValue?: { values?: FsValueWire[] };
  mapValue?: { fields?: Record<string, FsValueWire> };
}

export interface FsWriteOp {
  update?: {
    name: string;
    fields?: Record<string, FsValueWire>;
  };
  delete?: string;
  updateMask?: {
    fieldPaths?: string[];
  };
  currentDocument?: {
    exists?: boolean;
    updateTime?: string;
  };
}

function decodeWireValue(val: FsValueWire | undefined): unknown {
  if (!val) return undefined;
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return Number(val.integerValue);
  if (val.doubleValue !== undefined) return Number(val.doubleValue);
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.timestampValue !== undefined) return val.timestampValue;
  if (val.nullValue === null) return null;
  if (val.arrayValue !== undefined) {
    return (val.arrayValue.values || []).map((v) => decodeWireValue(v));
  }
  if (val.mapValue !== undefined) {
    return decodeWireFields(val.mapValue.fields);
  }
  return undefined;
}

function decodeWireFields(fields?: Record<string, FsValueWire>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    const decoded = decodeWireValue(v);
    if (decoded !== undefined) {
      out[k] = decoded;
    }
  }
  return out;
}

function normalizeAdminData(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((v) => normalizeAdminData(v));
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (typeof rec.toDate === 'function') {
      try {
        return (rec.toDate as () => Date)().toISOString();
      } catch {
        // ignore
      }
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      out[k] = normalizeAdminData(v);
    }
    return out;
  }
  return value;
}

function extractRelativeDocPath(fullName: string): string {
  if (fullName.startsWith(DOC_NAME_PREFIX)) {
    return fullName.slice(DOC_NAME_PREFIX.length);
  }
  const idx = fullName.indexOf('/documents/');
  if (idx >= 0) {
    return fullName.slice(idx + '/documents/'.length);
  }
  return fullName.replace(/^\/+/, '');
}

function ensureAdminAvailable(): void {
  if (getAdminSdkTestAvailabilityOverride() === false) {
    throw new AdminSdkUnavailableError('Admin SDK unavailable (fail-closed test override).');
  }
}

function ensureLiveWriteAllowedInTest(operation: string): void {
  if (isTestProcessRuntime() && !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new LiveFirestoreWriteBlockedInTestError(
      `[SECURITY_GUARD] Blocked live Firestore write in test mode (${operation}) — enable in-memory mock or FIRESTORE_EMULATOR_HOST.`
    );
  }
}

export interface AdminCommitResult {
  ok: boolean;
  status: number;
  errorText?: string;
}

/**
 * Executes an array of Firestore commit writes inside an atomic Admin SDK `runTransaction`
 * on the named database (`firebaseConfig.firestoreDatabaseId`).
 * Fails closed with `AdminSdkUnavailableError` (503) if ADC / IAM is missing (Decision D5).
 */
export async function executeAdminFirestoreCommit(
  writes: FsWriteOp[]
): Promise<AdminCommitResult> {
  ensureLiveWriteAllowedInTest('executeAdminFirestoreCommit');
  ensureAdminAvailable();
  try {
    const db = getAdminDb();
    await db.runTransaction(async (tx) => {
      // Phase 1: Read all documents that carry preconditions before any write.
      const precheckedRefs: Array<{
        op: FsWriteOp;
        path: string;
        snap?: FirebaseFirestore.DocumentSnapshot;
      }> = [];

      for (const op of writes) {
        const targetName = op.update?.name || op.delete || '';
        const relPath = extractRelativeDocPath(targetName);
        if (!relPath) continue;
        if (op.currentDocument) {
          const snap = await tx.get(db.doc(relPath));
          precheckedRefs.push({ op, path: relPath, snap });
        } else {
          precheckedRefs.push({ op, path: relPath });
        }
      }

      // Phase 2: Validate preconditions.
      for (const item of precheckedRefs) {
        const pre = item.op.currentDocument;
        if (!pre || !item.snap) continue;
        if (pre.exists === false && item.snap.exists) {
          const err = new Error('ALREADY_EXISTS') as Error & { httpStatus?: number };
          err.httpStatus = 409;
          throw err;
        }
        if (pre.exists === true && !item.snap.exists) {
          const err = new Error('NOT_FOUND') as Error & { httpStatus?: number };
          err.httpStatus = 404;
          throw err;
        }
        if (pre.updateTime) {
          const actualIso = item.snap.updateTime
            ? item.snap.updateTime.toDate().toISOString()
            : '';
          if (!item.snap.exists || (actualIso && actualIso !== pre.updateTime)) {
            const err = new Error('FAILED_PRECONDITION') as Error & { httpStatus?: number };
            err.httpStatus = 409;
            throw err;
          }
        }
      }

      // Phase 3: Apply atomic writes.
      for (const item of precheckedRefs) {
        const ref = db.doc(item.path);
        if (item.op.delete) {
          tx.delete(ref);
        } else if (item.op.update) {
          const decoded = decodeWireFields(item.op.update.fields);
          const mask = item.op.updateMask?.fieldPaths;
          if (mask && mask.length > 0) {
            const subset: Record<string, unknown> = {};
            for (const field of mask) {
              if (field in decoded) {
                subset[field] = decoded[field];
              }
            }
            tx.set(ref, subset, { merge: true });
          } else {
            tx.set(ref, decoded);
          }
        }
      }
    });

    return { ok: true, status: 200 };
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) {
      throw new AdminSdkUnavailableError(
        err instanceof Error ? err.message : 'Admin SDK transaction unavailable'
      );
    }
    const status =
      typeof err === 'object' && err !== null && 'httpStatus' in err
        ? Number((err as { httpStatus?: number }).httpStatus || 500)
        : 500;
    return {
      ok: false,
      status,
      errorText: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function adminGetDocumentWithMeta(
  path: string
): Promise<{ data: Record<string, unknown>; updateTime?: string } | null> {
  ensureAdminAvailable();
  if (isTestProcessRuntime() && !process.env.FIRESTORE_EMULATOR_HOST) {
    return null;
  }
  try {
    const db = getAdminDb();
    const snap = await db.doc(path).get();
    if (!snap.exists) return null;
    const raw = (normalizeAdminData(snap.data() || {}) as Record<string, unknown>) || {};
    return {
      data: {
        id: snap.id,
        ...raw,
      },
      updateTime: snap.updateTime ? snap.updateTime.toDate().toISOString() : undefined,
    };
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) {
      throw new AdminSdkUnavailableError(
        err instanceof Error ? err.message : 'Admin SDK read unavailable'
      );
    }
    return null;
  }
}

export async function adminListCollection(
  collectionId: string,
  pageSize = 200
): Promise<Record<string, unknown>[]> {
  ensureAdminAvailable();
  if (isTestProcessRuntime() && !process.env.FIRESTORE_EMULATOR_HOST) {
    return [];
  }
  try {
    const db = getAdminDb();
    const snap = await db.collection(collectionId).limit(pageSize).get();
    return snap.docs.map((d) => ({
      id: d.id,
      ...((normalizeAdminData(d.data() || {}) as Record<string, unknown>) || {}),
    }));
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) {
      throw new AdminSdkUnavailableError(
        err instanceof Error ? err.message : 'Admin SDK list unavailable'
      );
    }
    return [];
  }
}

const OP_MAP: Record<string, FirebaseFirestore.WhereFilterOp> = {
  EQUAL: '==',
  NOT_EQUAL: '!=',
  LESS_THAN: '<',
  LESS_THAN_OR_EQUAL: '<=',
  GREATER_THAN: '>',
  GREATER_THAN_OR_EQUAL: '>=',
  ARRAY_CONTAINS: 'array-contains',
  IN: 'in',
};

export async function adminRunStructuredQuery(
  structuredQuery: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
  ensureAdminAvailable();
  if (isTestProcessRuntime() && !process.env.FIRESTORE_EMULATOR_HOST) {
    return [];
  }
  try {
    const fromArr = structuredQuery.from as Array<{ collectionId?: string }> | undefined;
    const collectionId = fromArr?.[0]?.collectionId;
    if (!collectionId) return [];

    const db = getAdminDb();
    let q: FirebaseFirestore.Query = db.collection(collectionId);

    const applyFilter = (filter: Record<string, unknown>) => {
      if (filter.fieldFilter && typeof filter.fieldFilter === 'object') {
        const ff = filter.fieldFilter as {
          field?: { fieldPath?: string };
          op?: string;
          value?: FsValueWire;
        };
        const fieldPath = ff.field?.fieldPath;
        const op = OP_MAP[String(ff.op || '')];
        const val = decodeWireValue(ff.value);
        if (fieldPath && op && val !== undefined) {
          q = q.where(fieldPath, op, val);
        }
      } else if (filter.compositeFilter && typeof filter.compositeFilter === 'object') {
        const cf = filter.compositeFilter as {
          filters?: Record<string, unknown>[];
        };
        for (const child of cf.filters || []) {
          applyFilter(child);
        }
      }
    };

    if (structuredQuery.where && typeof structuredQuery.where === 'object') {
      applyFilter(structuredQuery.where as Record<string, unknown>);
    }

    const orderByArr = structuredQuery.orderBy as
      | Array<{ field?: { fieldPath?: string }; direction?: string }>
      | undefined;
    if (orderByArr) {
      for (const ob of orderByArr) {
        if (ob.field?.fieldPath) {
          q = q.orderBy(
            ob.field.fieldPath,
            ob.direction === 'DESCENDING' ? 'desc' : 'asc'
          );
        }
      }
    }

    if (typeof structuredQuery.limit === 'number' && structuredQuery.limit > 0) {
      q = q.limit(structuredQuery.limit);
    }

    const snap = await q.get();
    return snap.docs.map((d) => ({
      id: d.id,
      ...((normalizeAdminData(d.data() || {}) as Record<string, unknown>) || {}),
    }));
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) {
      throw new AdminSdkUnavailableError(
        err instanceof Error ? err.message : 'Admin SDK query unavailable'
      );
    }
    return [];
  }
}

export interface PublicChatbotConfigPayload {
  enabled: boolean;
  botName: string;
  welcomeMessage: string;
  quickQuestions: string[];
  enableVoiceFeatures: boolean;
}

/**
 * Decision D2: Strict minimal public projection of chatbot_config/published.
 * Never returns system prompts, internal contacts, escalation thresholds, or cost settings.
 */
export function projectPublicChatbotConfig(
  cfg: Partial<ChatbotConfigDoc> | null | undefined
): PublicChatbotConfigPayload {
  const merged = { ...DEFAULT_CHATBOT_CONFIG, ...(cfg || {}) };
  const rawQuestions = Array.isArray(merged.quickQuestionsBn)
    ? merged.quickQuestionsBn
    : Array.isArray(merged.quickQuestionsEn)
      ? merged.quickQuestionsEn
      : [];
  const quickQuestions = rawQuestions
    .map((q) => String(q || '').trim())
    .filter(Boolean)
    .slice(0, 6);
  return {
    enabled: merged.enabled !== false,
    botName: String(merged.botName || DEFAULT_CHATBOT_CONFIG.botName).slice(0, 80),
    welcomeMessage: String(
      merged.welcomeMessageBn ||
        merged.welcomeMessageEn ||
        DEFAULT_CHATBOT_CONFIG.welcomeMessageBn
    ).slice(0, 400),
    quickQuestions,
    enableVoiceFeatures: merged.enableVoiceFeatures === true,
  };
}

export function maskBangladeshPhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

/**
 * Sanitizes a tracking record before returning to a customer:
 * - Masks phone number
 * - Filters courierTrackingUrl through strict domain allowlist (4-04)
 * - Strips internal hashes/secrets
 */
export function sanitizePublicTrackingRecord(
  record: Record<string, unknown>,
  rawPhone?: string
): TrackingRecord & { maskedPhone?: string } {
  const rawUrl = typeof record.courierTrackingUrl === 'string' ? record.courierTrackingUrl : '';
  const safeUrl = rawUrl && isSafeCourierTrackingUrl(rawUrl) ? rawUrl : '';
  const {
    trackingTokenHash: _dropHash,
    trackingToken: _dropToken,
    phone: recPhone,
    ...rest
  } = record;
  void _dropHash;
  void _dropToken;
  const phoneToMask = rawPhone || (typeof recPhone === 'string' ? recPhone : '');
  return {
    ...(rest as unknown as TrackingRecord),
    courierTrackingUrl: safeUrl || undefined,
    maskedPhone: phoneToMask ? maskBangladeshPhone(phoneToMask) : undefined,
  };
}

/**
 * Decision D14: Lookup order tracking via 192-bit CSPRNG token hash (Admin SDK).
 */
export async function adminFindTrackingByToken(
  token: string
): Promise<(TrackingRecord & { maskedPhone?: string }) | null> {
  const clean = String(token || '').trim();
  if (clean.length < 24 || clean.length > 96) return null;
  ensureAdminAvailable();
  const targetHash = hashTrackingToken(clean);
  try {
    const db = getAdminDb();
    const snap = await db
      .collection('order_tracking')
      .where('trackingTokenHash', '==', targetHash)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const docData = normalizeAdminData(snap.docs[0].data()) as Record<string, unknown>;
    const storedHash = String(docData.trackingTokenHash || '');
    if (!timingSafeHexEqual(storedHash, targetHash)) return null;
    const docId = snap.docs[0].id;
    const phonePart = docId.includes('_') ? docId.split('_').slice(1).join('_') : '';
    return sanitizePublicTrackingRecord(docData, phonePart);
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) {
      throw new AdminSdkUnavailableError(
        err instanceof Error ? err.message : 'Admin SDK tracking lookup unavailable'
      );
    }
    return null;
  }
}

export async function adminCreatePendingReview(input: {
  customerName: string;
  district: string;
  rating: number;
  comment: string;
  orderNumber: string;
  photoData: string;
}): Promise<{ id: string }> {
  ensureLiveWriteAllowedInTest('adminCreatePendingReview');
  ensureAdminAvailable();
  const id = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  try {
    const db = getAdminDb();
    await db.collection('reviews').doc(id).set({
      customerName: input.customerName.trim().slice(0, 80),
      district: input.district.trim().slice(0, 80),
      rating: Math.max(1, Math.min(5, Math.round(input.rating))),
      comment: input.comment.trim().slice(0, 600),
      orderNumber: input.orderNumber.trim().toUpperCase().slice(0, 20),
      verifiedPurchase: false,
      helpfulCount: 0,
      photoData: input.photoData.slice(0, 180000),
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    return { id };
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) {
      throw new AdminSdkUnavailableError(
        err instanceof Error ? err.message : 'Admin SDK review write unavailable'
      );
    }
    throw err;
  }
}

export async function adminIncrementReviewHelpfulAtomic(reviewId: string): Promise<boolean> {
  ensureLiveWriteAllowedInTest('adminIncrementReviewHelpfulAtomic');
  ensureAdminAvailable();
  const cleanId = String(reviewId || '').trim();
  if (!/^[a-zA-Z0-9_-]{4,96}$/.test(cleanId)) return false;
  try {
    const db = getAdminDb();
    const ref = db.collection('reviews').doc(cleanId);
    const updated = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()?.status !== 'approved') return false;
      tx.update(ref, {
        helpfulCount: FieldValue.increment(1),
      });
      return true;
    });
    return updated;
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) {
      throw new AdminSdkUnavailableError(
        err instanceof Error ? err.message : 'Admin SDK helpful update unavailable'
      );
    }
    return false;
  }
}

export async function adminSubscribeNewsletter(
  email: string,
  lang: 'en' | 'bn'
): Promise<{ id: string }> {
  ensureLiveWriteAllowedInTest('adminSubscribeNewsletter');
  ensureAdminAvailable();
  const clean = email.trim().toLowerCase();
  const id = `sub_${clean.replace(/[^a-z0-9]/g, '_').slice(0, 96)}`;
  try {
    const db = getAdminDb();
    await db.collection('subscribers').doc(id).set(
      {
        email: clean,
        lang,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { id };
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) {
      throw new AdminSdkUnavailableError(
        err instanceof Error ? err.message : 'Admin SDK subscriber write unavailable'
      );
    }
    throw err;
  }
}
