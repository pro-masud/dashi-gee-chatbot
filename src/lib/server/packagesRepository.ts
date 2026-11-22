import { FieldValue } from 'firebase-admin/firestore';
import {
  AdminSdkUnavailableError,
  getAdminDb,
  isAdminSdkCredentialOrIamError,
} from '../firebaseAdmin';
import {
  PACKAGE_SLOTS,
  defaultPackagesState,
  sellingPrice,
  type PackageSlot,
  type PackagesState,
} from '../packages/packages';
import { isTestProcessRuntime } from './runtimeGuards';

type Actor = { email: string; uid: string };

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    throw err;
  });
}

const priceKey = (s: PackageSlot) => `price${s}` as const;
const stockKey = (s: PackageSlot) => `stock${s}` as const;
const cogsKey = (s: PackageSlot) => `cogs${s}` as const;

/**
 * Merge the three sources into one editable view:
 *  - store_settings/main   → selling price + stock (what the order engine reads)
 *  - packages/{slot}       → regular price, badge, enabled, default, description
 *  - finance_settings/main → cost of goods
 */
export async function readPackages(): Promise<PackagesState> {
  return wrap(async () => {
    const db = getAdminDb();
    const [store, fin, pkgs] = await Promise.all([
      db.collection('store_settings').doc('main').get(),
      db.collection('finance_settings').doc('main').get(),
      db.collection('packages').get(),
    ]);
    const s = store.exists ? store.data() || {} : {};
    const f = fin.exists ? fin.data() || {} : {};
    const meta = new Map(pkgs.docs.map((d) => [d.id, d.data()]));
    const anyDefault = pkgs.docs.some((d) => d.data().isDefault === true);
    const out = defaultPackagesState();
    for (const slot of PACKAGE_SLOTS) {
      const m = (meta.get(slot) || {}) as Record<string, unknown>;
      const selling = Number(s[priceKey(slot)]) || 0;
      const regular = Number(m.regularPrice) || selling;
      out[slot] = {
        slot,
        regularPrice: regular,
        offerPrice: regular > selling && selling > 0 ? selling : 0,
        cogs: Number(f[cogsKey(slot)]) || 0,
        stock: Number(s[stockKey(slot)]) || 0,
        badge: ((m.badge as string) || '') as PackagesState[PackageSlot]['badge'],
        enabled: m.enabled !== false,
        isDefault: m.isDefault === true || (!anyDefault && slot === '500g'),
        description: String(m.description || ''),
      };
    }
    return out;
  });
}

/** Public subset without secrets; safe defaults when the database is unreachable. */
export async function readPackagesBestEffort(): Promise<PackagesState | null> {
  if (isTestProcessRuntime()) return null;
  try {
    return await readPackages();
  } catch {
    return null;
  }
}

export async function savePackages(next: PackagesState, actor: Actor): Promise<PackagesState> {
  return wrap(async () => {
    const db = getAdminDb();
    const before = await readPackages();
    const nowIso = new Date().toISOString();

    await db.runTransaction(async (tx) => {
      const storeRef = db.collection('store_settings').doc('main');
      const finRef = db.collection('finance_settings').doc('main');
      const storeSnap = await tx.get(storeRef);
      const confirmed = { ...((storeSnap.data()?.ownerConfirmedFields as Record<string, boolean>) || {}) };

      const storeUpdate: Record<string, unknown> = {};
      const finUpdate: Record<string, unknown> = { updatedAtIso: nowIso, updatedBy: actor.email };
      for (const slot of PACKAGE_SLOTS) {
        const p = next[slot];
        storeUpdate[priceKey(slot)] = sellingPrice(p);
        storeUpdate[stockKey(slot)] = p.stock;
        confirmed[priceKey(slot)] = true;
        confirmed[stockKey(slot)] = true;
        finUpdate[cogsKey(slot)] = p.cogs;
        tx.set(db.collection('packages').doc(slot), {
          slot,
          regularPrice: p.regularPrice,
          badge: p.badge,
          enabled: p.enabled,
          isDefault: p.isDefault,
          description: p.description,
          updatedAtIso: nowIso,
        });
      }
      storeUpdate.ownerConfirmedFields = confirmed;
      storeUpdate.updatedAt = FieldValue.serverTimestamp();

      if (storeSnap.exists) tx.update(storeRef, storeUpdate);
      else tx.set(storeRef, storeUpdate, { merge: true });
      tx.set(finRef, finUpdate, { merge: true });
      tx.set(db.collection('activity_logs').doc(), {
        action: 'packages.update',
        resource: 'packages',
        actorEmail: actor.email,
        actorUid: actor.uid,
        before,
        after: next,
        atIso: nowIso,
      });
    });
    return next;
  });
}

/** Which package slots can currently be ordered. Defaults to all enabled if the data cannot be read. */
export async function getEnabledSlotsBestEffort(): Promise<Record<PackageSlot, boolean>> {
  const all: Record<PackageSlot, boolean> = { '250g': true, '500g': true, '1kg': true };
  const state = await readPackagesBestEffort();
  if (!state) return all;
  for (const slot of PACKAGE_SLOTS) all[slot] = state[slot].enabled;
  return all;
}
