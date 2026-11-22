import {
  AdminSdkUnavailableError,
  getAdminDb,
  isAdminSdkCredentialOrIamError,
} from '../firebaseAdmin';
import {
  EMPTY_TRACKING,
  type MarketingLogRow,
  type TrackingSettings,
} from '../marketing/marketing';
import { decryptSecret, encryptSecret, isSecretsKeyConfigured, maskSecret } from './secrets';
import { isTestProcessRuntime } from './runtimeGuards';

type Actor = { email: string; uid: string };

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    throw err;
  });
}

export interface TrackingState {
  settings: TrackingSettings;
  hasToken: boolean;
  tokenHint: string;
  encryptionConfigured: boolean;
}

export async function readTrackingState(): Promise<TrackingState> {
  return wrap(async () => {
    const snap = await getAdminDb().collection('integrations').doc('marketing').get();
    const d = snap.data() || {};
    return {
      settings: {
        ...EMPTY_TRACKING,
        pixelId: String(d.pixelId || ''),
        ga4Id: String(d.ga4Id || ''),
        gtmId: String(d.gtmId || ''),
        googleAdsId: String(d.googleAdsId || ''),
        capiEnabled: d.capiEnabled === true,
        testEventCode: String(d.testEventCode || ''),
      },
      hasToken: typeof d.capiTokenEnc === 'string' && d.capiTokenEnc.length > 0,
      tokenHint: String(d.capiTokenHint || ''),
      encryptionConfigured: isSecretsKeyConfigured(),
    };
  });
}

/** Public ids for the storefront. Empty (no tracking) when unreachable or not configured. */
export async function readPublicTrackingBestEffort(): Promise<TrackingSettings | null> {
  if (isTestProcessRuntime()) return null;
  try {
    return (await readTrackingState()).settings;
  } catch {
    return null;
  }
}

export async function saveTrackingState(
  settings: TrackingSettings,
  token: { set?: string; clear?: boolean },
  actor: Actor
): Promise<TrackingState> {
  return wrap(async () => {
    const db = getAdminDb();
    const ref = db.collection('integrations').doc('marketing');
    const before = await readTrackingState();
    const nowIso = new Date().toISOString();
    const update: Record<string, unknown> = { ...settings, updatedAtIso: nowIso, updatedBy: actor.email };
    if (token.clear) {
      update.capiTokenEnc = '';
      update.capiTokenHint = '';
    } else if (token.set) {
      update.capiTokenEnc = encryptSecret(token.set); // throws SecretsKeyMissingError if no key
      update.capiTokenHint = maskSecret(token.set);
    }
    await db.runTransaction(async (tx) => {
      tx.set(ref, update, { merge: true });
      tx.set(db.collection('activity_logs').doc(), {
        action: 'marketing.update',
        resource: 'integrations/marketing',
        actorEmail: actor.email,
        actorUid: actor.uid,
        // secrets are never written to the audit trail
        before: { ...before.settings, hasToken: before.hasToken },
        after: { ...settings, tokenChanged: Boolean(token.set || token.clear) },
        atIso: nowIso,
      });
    });
    return readTrackingState();
  });
}

/** Decrypted CAPI token for server-side sending only. Null when not configured or undecryptable. */
export async function readCapiTokenServerOnly(): Promise<string | null> {
  try {
    const snap = await getAdminDb().collection('integrations').doc('marketing').get();
    const enc = snap.data()?.capiTokenEnc;
    if (typeof enc !== 'string' || !enc) return null;
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

export async function hasSentEvent(eventId: string): Promise<boolean> {
  const snap = await getAdminDb().collection('marketing_event_logs').doc(eventId).get();
  return snap.exists && snap.data()?.ok === true;
}

export async function writeEventLog(row: MarketingLogRow): Promise<void> {
  await getAdminDb().collection('marketing_event_logs').doc(row.id).set(row);
}

export async function listEventLogs(limit = 50): Promise<MarketingLogRow[]> {
  return wrap(async () => {
    const snap = await getAdminDb()
      .collection('marketing_event_logs')
      .orderBy('atIso', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data() as MarketingLogRow);
  });
}
