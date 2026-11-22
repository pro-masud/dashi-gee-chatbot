import {
  AdminSdkUnavailableError,
  BOOTSTRAPPED_ADMIN_EMAIL,
  getAdminAuth,
  getAdminDb,
  isAdminSdkCredentialOrIamError,
} from '../firebaseAdmin';
import type { Role } from '../auth/permissions';

export interface StaffRecord {
  uid: string;
  email: string;
  role: Role;
  active: boolean;
  createdByEmail: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface ActivityLogRow {
  id: string;
  action: string;
  resource: string;
  actorEmail: string;
  before: unknown;
  after: unknown;
  atIso: string;
}

type Actor = { email: string; uid: string };

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (isAdminSdkCredentialOrIamError(err)) throw new AdminSdkUnavailableError();
    throw err;
  });
}

export async function listStaff(): Promise<StaffRecord[]> {
  return wrap(async () => {
    const snap = await getAdminDb().collection('staff').limit(200).get();
    return snap.docs
      .map((d) => ({ uid: d.id, ...(d.data() as Omit<StaffRecord, 'uid'>) }))
      .sort((a, b) => a.email.localeCompare(b.email));
  });
}

export type AddStaffResult =
  | { ok: true; staff: StaffRecord }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Add a staff member by email. They must already have signed in once with that Google account so a
 * verified Firebase Auth user exists — we never create accounts or passwords for people.
 */
export async function addStaff(
  input: { email: string; role: Role },
  actor: Actor
): Promise<AddStaffResult> {
  return wrap(async () => {
    if (input.email === BOOTSTRAPPED_ADMIN_EMAIL) {
      return { ok: false, status: 409, error: 'This email belongs to the store owner.' } as const;
    }
    let user;
    try {
      user = await getAdminAuth().getUserByEmail(input.email);
    } catch (err) {
      if ((err as { code?: string })?.code === 'auth/user-not-found') {
        return {
          ok: false,
          status: 404,
          error: 'No account found. Ask them to sign in once at /admin with this Google account, then add them again.',
        } as const;
      }
      throw err;
    }
    if (!user.emailVerified) {
      return { ok: false, status: 409, error: 'That account’s email is not verified.' } as const;
    }

    const db = getAdminDb();
    const legacy = await db.collection('admins').doc(user.uid).get();
    if (legacy.exists) {
      return { ok: false, status: 409, error: 'This person is already a full admin.' } as const;
    }

    const nowIso = new Date().toISOString();
    const staff: StaffRecord = {
      uid: user.uid,
      email: input.email,
      role: input.role,
      active: true,
      createdByEmail: actor.email,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
    };
    const ref = db.collection('staff').doc(user.uid);
    await db.runTransaction(async (tx) => {
      tx.set(ref, staff);
      tx.set(db.collection('activity_logs').doc(), {
        action: 'staff.add',
        resource: `staff/${user.uid}`,
        actorEmail: actor.email,
        actorUid: actor.uid,
        before: null,
        after: { email: staff.email, role: staff.role },
        atIso: nowIso,
      });
    });
    return { ok: true, staff } as const;
  });
}

export async function updateStaff(
  uid: string,
  patch: { role?: Role; active?: boolean },
  actor: Actor
): Promise<{ ok: true; staff: StaffRecord } | { ok: false; status: 404; error: string }> {
  return wrap(async () => {
    const db = getAdminDb();
    const ref = db.collection('staff').doc(uid);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false, status: 404, error: 'Staff member not found.' } as const;
      const before = snap.data() as Omit<StaffRecord, 'uid'>;
      const nowIso = new Date().toISOString();
      const next = {
        ...before,
        ...(patch.role ? { role: patch.role } : {}),
        ...(typeof patch.active === 'boolean' ? { active: patch.active } : {}),
        updatedAtIso: nowIso,
      };
      tx.set(ref, next);
      tx.set(db.collection('activity_logs').doc(), {
        action: 'staff.update',
        resource: `staff/${uid}`,
        actorEmail: actor.email,
        actorUid: actor.uid,
        before: { role: before.role, active: before.active },
        after: { role: next.role, active: next.active },
        atIso: nowIso,
      });
      return { ok: true, staff: { uid, ...next } as StaffRecord } as const;
    });
  });
}

export async function listActivity(limit = 200): Promise<ActivityLogRow[]> {
  return wrap(async () => {
    const snap = await getAdminDb()
      .collection('activity_logs')
      .orderBy('atIso', 'desc')
      .limit(Math.min(Math.max(limit, 1), 500))
      .get();
    return snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        action: String(x.action || ''),
        resource: String(x.resource || ''),
        actorEmail: String(x.actorEmail || ''),
        before: x.before ?? null,
        after: x.after ?? null,
        atIso: String(x.atIso || ''),
      };
    });
  });
}
