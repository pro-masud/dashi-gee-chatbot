import {
  AdminSdkUnavailableError,
  getAdminDb,
  isAdminSdkCredentialOrIamError,
} from '../firebaseAdmin';
import {
  mergeLeadCapture,
  type LeadCapture,
  type LeadDoc,
  type LeadUpdateInput,
} from '../leads/leads';
import { isTestProcessRuntime } from './runtimeGuards';

type Actor = { email: string; uid: string };

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    throw err;
  });
}

/** Create or update the single lead for this phone number (transactional, no duplicates). */
export async function upsertLead(capture: LeadCapture, ipHash?: string): Promise<{ id: string; created: boolean }> {
  return wrap(async () => {
    const db = getAdminDb();
    const ref = db.collection('leads').doc(capture.phone);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? (snap.data() as LeadDoc) : null;
      const merged = mergeLeadCapture(existing, capture, new Date().toISOString(), ipHash);
      tx.set(ref, merged);
      return { id: capture.phone, created: !existing };
    });
  });
}

/**
 * Called by the order paths after an order is created. Best effort and silent: a lead problem
 * must never fail or slow down a customer's order.
 */
export async function markLeadConvertedByPhone(phone: string, orderNumber: string): Promise<void> {
  if (isTestProcessRuntime()) return;
  try {
    const db = getAdminDb();
    const ref = db.collection('leads').doc(phone);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const nowIso = new Date().toISOString();
      tx.update(ref, { status: 'converted', convertedOrderNumber: orderNumber, updatedAtIso: nowIso });
      tx.set(ref.collection('activities').doc(), {
        type: 'converted',
        text: `Order ${orderNumber} placed`,
        byEmail: 'system',
        atIso: nowIso,
      });
    });
  } catch (err) {
    console.error('[leads] convert failed', err instanceof Error ? err.message : err);
  }
}

export async function listLeads(limit = 500): Promise<LeadDoc[]> {
  return wrap(async () => {
    const snap = await getAdminDb().collection('leads').orderBy('updatedAtIso', 'desc').limit(limit).get();
    return snap.docs.map((d) => d.data() as LeadDoc);
  });
}

export interface LeadActivityRow {
  id: string;
  type: string;
  text: string;
  byEmail: string;
  atIso: string;
}

export async function listLeadActivities(phone: string): Promise<LeadActivityRow[]> {
  return wrap(async () => {
    const snap = await getAdminDb()
      .collection('leads')
      .doc(phone)
      .collection('activities')
      .orderBy('atIso', 'desc')
      .limit(50)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LeadActivityRow, 'id'>) }));
  });
}

export async function updateLead(
  phone: string,
  patch: LeadUpdateInput,
  actor: Actor
): Promise<{ ok: true; lead: LeadDoc } | { ok: false; status: 404; error: string }> {
  return wrap(async () => {
    const db = getAdminDb();
    const ref = db.collection('leads').doc(phone);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false, status: 404, error: 'Lead not found.' } as const;
      const before = snap.data() as LeadDoc;
      const nowIso = new Date().toISOString();
      const next: LeadDoc = {
        ...before,
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.followUpDate !== undefined ? { followUpDate: patch.followUpDate } : {}),
        ...(patch.assignedTo !== undefined ? { assignedTo: patch.assignedTo } : {}),
        updatedAtIso: nowIso,
      };
      tx.set(ref, next);
      if (patch.status && patch.status !== before.status) {
        tx.set(ref.collection('activities').doc(), {
          type: 'status',
          text: `${before.status} → ${patch.status}`,
          byEmail: actor.email,
          atIso: nowIso,
        });
      }
      if (patch.note) {
        tx.set(ref.collection('activities').doc(), { type: 'note', text: patch.note, byEmail: actor.email, atIso: nowIso });
      }
      tx.set(db.collection('activity_logs').doc(), {
        action: 'lead.update',
        resource: `leads/${phone}`,
        actorEmail: actor.email,
        actorUid: actor.uid,
        before: { status: before.status, followUpDate: before.followUpDate ?? null, assignedTo: before.assignedTo ?? null },
        after: { status: next.status, followUpDate: next.followUpDate ?? null, assignedTo: next.assignedTo ?? null, noteAdded: Boolean(patch.note) },
        atIso: nowIso,
      });
      return { ok: true, lead: next } as const;
    });
  });
}
