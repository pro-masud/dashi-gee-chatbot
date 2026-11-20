import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  assertNoTestModeInProduction,
  isTestProcessRuntime,
} from './server/runtimeGuards';

// Refuse startup if production mistakenly enables DESHI_GEE_TEST_MODE=1.
assertNoTestModeInProduction();

export const BOOTSTRAPPED_ADMIN_EMAIL = 'kinboni.bd@gmail.com';
export const ADMIN_PROJECT_ID = String(firebaseConfig.projectId || '').trim();
export const ADMIN_DATABASE_ID = String(firebaseConfig.firestoreDatabaseId || '').trim();

export class AdminSdkUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'admin_sdk_unavailable';
  readonly customerMessageEn =
    'Ordering is temporarily unavailable. Please try again shortly or request a callback from our team.';
  readonly customerMessageBn =
    'অর্ডার সিস্টেম সাময়িকভাবে অনুপলব্ধ। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন অথবা কলব্যাক অনুরোধ করুন।';

  constructor(detail?: string) {
    super(detail || 'Firebase Admin SDK (ADC) is unavailable or lacks IAM datastore permission.');
    this.name = 'AdminSdkUnavailableError';
  }
}

export function isAdminSdkCredentialOrIamError(err: unknown): boolean {
  if (err instanceof AdminSdkUnavailableError) return true;
  const msg = err instanceof Error ? err.message : String(err || '');
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  return (
    /could not load the default credentials/i.test(msg) ||
    /unable to detect a project id/i.test(msg) ||
    /default credentials/i.test(msg) ||
    /PERMISSION_DENIED/i.test(msg) ||
    /UNAUTHENTICATED/i.test(msg) ||
    /app\/invalid-credential/i.test(code) ||
    code === '7' ||
    code === '16'
  );
}

function assertValidAdminConfig(): void {
  assertNoTestModeInProduction();
  if (!ADMIN_PROJECT_ID) {
    throw new AdminSdkUnavailableError('Missing projectId in firebase-applet-config.json.');
  }
  if (!ADMIN_DATABASE_ID || ADMIN_DATABASE_ID === '(default)') {
    throw new AdminSdkUnavailableError(
      'Invalid firestoreDatabaseId: must target the named Deshi Gee database, never (default).'
    );
  }
}

let cachedAdminApp: App | null = null;
let cachedAdminDb: Firestore | null = null;
let cachedAdminAuth: Auth | null = null;

/**
 * Initializes Firebase Admin SDK using Application Default Credentials (ADC) ONLY.
 * Never loads or accepts service-account JSON keys (Decision D4).
 */
export function getAdminApp(): App {
  assertValidAdminConfig();
  if (cachedAdminApp) return cachedAdminApp;
  const existing = getApps();
  cachedAdminApp =
    existing.length > 0
      ? getApp()
      : initializeApp({
          projectId: ADMIN_PROJECT_ID,
        });
  return cachedAdminApp;
}

/**
 * Returns the Firestore Admin instance pinned strictly to firebaseConfig.firestoreDatabaseId.
 */
export function getAdminDb(): Firestore {
  assertValidAdminConfig();
  if (cachedAdminDb) return cachedAdminDb;
  cachedAdminDb = getFirestore(getAdminApp(), ADMIN_DATABASE_ID);
  return cachedAdminDb;
}

export function getAdminAuth(): Auth {
  assertValidAdminConfig();
  if (cachedAdminAuth) return cachedAdminAuth;
  cachedAdminAuth = getAuth(getAdminApp());
  return cachedAdminAuth;
}

export interface StrictAdminAuthResult {
  ok: boolean;
  email: string;
  uid: string;
  emailVerified: boolean;
  reason?: string;
}

type AdminAuthTestHook = (
  authHeader: string | null
) => Promise<{ ok: boolean; email: string; uid: string; emailVerified?: boolean }>;

const adminAuthGlobal = globalThis as unknown as {
  __deshiGeeStrictAdminAuthOverride?: AdminAuthTestHook | null;
  __deshiGeeAdminSdkAvailabilityOverride?: boolean | null;
};

export function setStrictAdminAuthOverrideForTests(fn: AdminAuthTestHook | null): void {
  assertNoTestModeInProduction();
  if (isTestProcessRuntime()) {
    adminAuthGlobal.__deshiGeeStrictAdminAuthOverride = fn;
  }
}

export function setAdminSdkAvailableForTests(available: boolean | null): void {
  assertNoTestModeInProduction();
  if (isTestProcessRuntime()) {
    adminAuthGlobal.__deshiGeeAdminSdkAvailabilityOverride = available;
  }
}

export function getAdminSdkTestAvailabilityOverride(): boolean | null {
  if (!isTestProcessRuntime()) return null;
  return adminAuthGlobal.__deshiGeeAdminSdkAvailabilityOverride ?? null;
}

/**
 * Strict Admin ID token verifier (Stage 2.5 / Decision D3):
 * - Verifies cryptographic signature & expiry via Firebase Admin Auth `verifyIdToken`
 * - Requires `email_verified === true`
 * - Requires allowlisted admin email (`kinboni.bd@gmail.com`) OR an explicit `admins/{uid}` document
 */
export async function verifyAdminIdTokenStrict(
  authHeader: string | null
): Promise<StrictAdminAuthResult> {
  if (isTestProcessRuntime() && adminAuthGlobal.__deshiGeeStrictAdminAuthOverride) {
    const res = await adminAuthGlobal.__deshiGeeStrictAdminAuthOverride(authHeader);
    const verified = res.emailVerified ?? res.ok;
    if (!res.ok || !verified) {
      return {
        ok: false,
        email: res.email || '',
        uid: res.uid || '',
        emailVerified: Boolean(verified),
        reason: !verified ? 'email_not_verified' : 'unauthorized',
      };
    }
    return {
      ok: true,
      email: res.email,
      uid: res.uid,
      emailVerified: true,
    };
  }

  const raw = String(authHeader || '').trim();
  if (!raw.startsWith('Bearer ')) {
    return { ok: false, email: '', uid: '', emailVerified: false, reason: 'missing_bearer_token' };
  }
  const idToken = raw.slice('Bearer '.length).trim();
  if (idToken.length < 20) {
    return { ok: false, email: '', uid: '', emailVerified: false, reason: 'invalid_token_format' };
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const email = String(decoded.email || '').trim().toLowerCase();
    const uid = String(decoded.uid || '').trim();
    const emailVerified = decoded.email_verified === true;

    if (!uid || !emailVerified) {
      return {
        ok: false,
        email,
        uid,
        emailVerified,
        reason: 'email_not_verified',
      };
    }

    if (email === BOOTSTRAPPED_ADMIN_EMAIL) {
      return { ok: true, email, uid, emailVerified: true };
    }

    // Check admins/{uid} allowlist via Admin SDK
    try {
      const adminDoc = await getAdminDb().collection('admins').doc(uid).get();
      if (adminDoc.exists) {
        return { ok: true, email, uid, emailVerified: true };
      }
    } catch {
      return { ok: false, email, uid, emailVerified: true, reason: 'admin_allowlist_lookup_failed' };
    }

    return { ok: false, email, uid, emailVerified: true, reason: 'not_an_admin' };
  } catch (err) {
    if (isAdminSdkCredentialOrIamError(err)) {
      return {
        ok: false,
        email: '',
        uid: '',
        emailVerified: false,
        reason: 'admin_sdk_unavailable',
      };
    }
    return {
      ok: false,
      email: '',
      uid: '',
      emailVerified: false,
      reason: 'token_verification_failed',
    };
  }
}

export interface AdminSdkReadinessReport {
  ok: boolean;
  mode: 'admin_sdk_adc' | 'unavailable';
  projectId: string;
  databaseId: string;
  latencyMs: number;
  code: string;
  detail: string;
}

/**
 * Non-mutating Admin SDK + ADC + IAM datastore readiness probe for Admin Diagnostics.
 */
export async function checkAdminSdkReadiness(): Promise<AdminSdkReadinessReport> {
  const started = Date.now();
  const override = getAdminSdkTestAvailabilityOverride();
  if (override === false) {
    return {
      ok: false,
      mode: 'unavailable',
      projectId: ADMIN_PROJECT_ID,
      databaseId: ADMIN_DATABASE_ID,
      latencyMs: Date.now() - started,
      code: 'admin_sdk_unavailable',
      detail: 'Simulated Admin SDK / ADC unavailability (test mode).',
    };
  }
  if (override === true) {
    return {
      ok: true,
      mode: 'admin_sdk_adc',
      projectId: ADMIN_PROJECT_ID,
      databaseId: ADMIN_DATABASE_ID,
      latencyMs: Date.now() - started,
      code: 'ok',
      detail: 'Admin SDK ADC mock active.',
    };
  }

  try {
    const db = getAdminDb();
    await db.collection('store_settings').doc('main').get();
    return {
      ok: true,
      mode: 'admin_sdk_adc',
      projectId: ADMIN_PROJECT_ID,
      databaseId: ADMIN_DATABASE_ID,
      latencyMs: Date.now() - started,
      code: 'ok',
      detail: 'Firebase Admin SDK connected via ADC with Firestore read access.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPerm = /PERMISSION_DENIED|code=7|\b7\b/i.test(msg);
    const isCred = /default credentials|UNAUTHENTICATED/i.test(msg);
    return {
      ok: false,
      mode: 'unavailable',
      projectId: ADMIN_PROJECT_ID,
      databaseId: ADMIN_DATABASE_ID,
      latencyMs: Date.now() - started,
      code: isPerm
        ? 'iam_permission_denied'
        : isCred
          ? 'adc_credentials_missing'
          : 'admin_sdk_unavailable',
      detail: isPerm
        ? 'Runtime service account lacks roles/datastore.user on project qualified-transit-lpd8p.'
        : isCred
          ? 'Application Default Credentials (ADC) not detected in this runtime.'
          : 'Firebase Admin SDK Firestore probe failed.',
    };
  }
}
