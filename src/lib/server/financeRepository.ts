import { Timestamp } from 'firebase-admin/firestore';
import {
  AdminSdkUnavailableError,
  getAdminDb,
  isAdminSdkCredentialOrIamError,
} from '../firebaseAdmin';
import {
  DEFAULT_FINANCE_SETTINGS,
  type ExpenseRecord,
  type ExpenseType,
  type FinanceSettings,
  type ProfitOrderInput,
} from '../finance/profit';
import { isTestProcessRuntime } from './runtimeGuards';

/**
 * Server-only persistence for finance data (Admin SDK). These collections are not reachable from
 * browsers: firestore.rules denies everything outside explicitly allowed paths.
 */

function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (isAdminSdkCredentialOrIamError(err)) {
      throw new AdminSdkUnavailableError();
    }
    throw err;
  });
}

const DHAKA_OFFSET = '+06:00';

export function dhakaRangeToDates(from: string, to: string): { start: Date; endExclusive: Date } {
  const start = new Date(`${from}T00:00:00${DHAKA_OFFSET}`);
  const endExclusive = new Date(new Date(`${to}T00:00:00${DHAKA_OFFSET}`).getTime() + 24 * 3600 * 1000);
  return { start, endExclusive };
}

export async function getFinanceSettings(): Promise<FinanceSettings> {
  return wrap(async () => {
    const snap = await getAdminDb().collection('finance_settings').doc('main').get();
    if (!snap.exists) return { ...DEFAULT_FINANCE_SETTINGS };
    const d = snap.data() || {};
    return {
      cogs250g: Number(d.cogs250g) || 0,
      cogs500g: Number(d.cogs500g) || 0,
      cogs1kg: Number(d.cogs1kg) || 0,
    };
  });
}

export async function saveFinanceSettings(
  next: FinanceSettings,
  actor: { email: string; uid: string }
): Promise<FinanceSettings> {
  return wrap(async () => {
    const db = getAdminDb();
    const ref = db.collection('finance_settings').doc('main');
    const before = await getFinanceSettings();
    await db.runTransaction(async (tx) => {
      tx.set(ref, { ...next, updatedAtIso: new Date().toISOString(), updatedBy: actor.email });
      tx.set(db.collection('activity_logs').doc(), {
        action: 'finance_settings.update',
        resource: 'finance_settings/main',
        actorEmail: actor.email,
        actorUid: actor.uid,
        before,
        after: next,
        atIso: new Date().toISOString(),
      });
    });
    return next;
  });
}

export async function listExpenses(from: string, to: string): Promise<ExpenseRecord[]> {
  return wrap(async () => {
    const snap = await getAdminDb()
      .collection('expenses')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .orderBy('date', 'desc')
      .limit(1000)
      .get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        date: String(d.date || ''),
        type: String(d.type || 'other') as ExpenseType,
        amountBdt: Number(d.amountBdt) || 0,
        description: String(d.description || ''),
        createdByEmail: String(d.createdByEmail || ''),
        createdAtIso: String(d.createdAtIso || ''),
      };
    });
  });
}

export async function createExpense(
  input: { date: string; type: ExpenseType; amountBdt: number; description: string },
  actor: { email: string; uid: string }
): Promise<ExpenseRecord> {
  return wrap(async () => {
    const db = getAdminDb();
    const ref = db.collection('expenses').doc();
    const record: ExpenseRecord = {
      id: ref.id,
      ...input,
      createdByEmail: actor.email,
      createdAtIso: new Date().toISOString(),
    };
    await db.runTransaction(async (tx) => {
      tx.set(ref, record);
      tx.set(db.collection('activity_logs').doc(), {
        action: 'expense.create',
        resource: `expenses/${ref.id}`,
        actorEmail: actor.email,
        actorUid: actor.uid,
        before: null,
        after: record,
        atIso: record.createdAtIso,
      });
    });
    return record;
  });
}

export async function deleteExpense(
  id: string,
  actor: { email: string; uid: string }
): Promise<boolean> {
  return wrap(async () => {
    const db = getAdminDb();
    const ref = db.collection('expenses').doc(id);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      tx.delete(ref);
      tx.set(db.collection('activity_logs').doc(), {
        action: 'expense.delete',
        resource: `expenses/${id}`,
        actorEmail: actor.email,
        actorUid: actor.uid,
        before: snap.data(),
        after: null,
        atIso: new Date().toISOString(),
      });
      return true;
    });
  });
}

export async function listOrdersForProfit(from: string, to: string): Promise<ProfitOrderInput[]> {
  return wrap(async () => {
    const { start, endExclusive } = dhakaRangeToDates(from, to);
    const snap = await getAdminDb()
      .collection('orders')
      .where('createdAt', '>=', Timestamp.fromDate(start))
      .where('createdAt', '<', Timestamp.fromDate(endExclusive))
      .orderBy('createdAt', 'asc')
      .limit(5000)
      .get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      const created = d.createdAt && typeof d.createdAt.toDate === 'function' ? d.createdAt.toDate() : null;
      return {
        orderNumber: String(d.orderNumber || doc.id),
        status: String(d.status || ''),
        totalBdt: Number(d.totalBdt) || 0,
        cogsBdt: typeof d.cogsBdt === 'number' ? d.cogsBdt : undefined,
        createdAtIso: created ? created.toISOString() : '',
      };
    });
  });
}

/**
 * Best-effort cost settings for the order path. Never blocks or fails an order:
 * returns defaults in test runtimes or when the settings cannot be read.
 */
export async function getFinanceSettingsBestEffort(): Promise<FinanceSettings> {
  if (isTestProcessRuntime()) return { ...DEFAULT_FINANCE_SETTINGS };
  try {
    return await getFinanceSettings();
  } catch {
    return { ...DEFAULT_FINANCE_SETTINGS };
  }
}
