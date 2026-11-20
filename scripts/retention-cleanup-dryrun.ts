/**
 * Stage 2.8 — Scheduled Retention Cleanup Script (Dry-Run by Default)
 *
 * Usage:
 *   Dry-run (default, zero writes):  npx tsx scripts/retention-cleanup-dryrun.ts
 *   Execute deletion (requires ADC): npx tsx scripts/retention-cleanup-dryrun.ts --execute
 *
 * Retention Policy:
 *   - order_fingerprints: 24 hours (expiresAt or createdAtMs)
 *   - rate_limits:        7 days
 *   - chatbot_logs:       90 days (PII-masked logs)
 *   - support_evidence:   30 days after upload
 *   - order_drafts:       14 days inactive
 *
 * Hard safety guards:
 *   - Refuses execution in test mode without emulator/mock
 *   - Refuses startup when NODE_ENV=production && DESHI_GEE_TEST_MODE=1
 *   - Never touches orders, batches, reviews, or store_settings
 */

import { assertNoTestModeInProduction, isTestProcessRuntime } from '../src/lib/server/runtimeGuards';
import { getAdminDb, ADMIN_PROJECT_ID, ADMIN_DATABASE_ID } from '../src/lib/firebaseAdmin';

assertNoTestModeInProduction();

export interface RetentionTarget {
  collection: string;
  maxAgeDays: number;
  timestampField: string;
}

export const RETENTION_TARGETS: RetentionTarget[] = [
  { collection: 'order_fingerprints', maxAgeDays: 1, timestampField: 'expiresAt' },
  { collection: 'rate_limits', maxAgeDays: 7, timestampField: 'updatedAt' },
  { collection: 'chatbot_logs', maxAgeDays: 90, timestampField: 'createdAt' },
  { collection: 'support_evidence', maxAgeDays: 30, timestampField: 'createdAt' },
  { collection: 'order_drafts', maxAgeDays: 14, timestampField: 'updatedAt' },
];

export interface RetentionPlanRow {
  collection: string;
  maxAgeDays: number;
  cutoffIso: string;
  candidateCount: number;
  deletedCount: number;
  dryRun: boolean;
}

export async function runRetentionCleanup(options: {
  execute: boolean;
  now?: Date;
  maxBatchPerCollection?: number;
}): Promise<RetentionPlanRow[]> {
  assertNoTestModeInProduction();
  if (isTestProcessRuntime() && !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FAIL_CLOSED: retention cleanup cannot run against live Firestore in test mode.');
  }

  const now = options.now || new Date();
  const limit = Math.max(1, Math.min(500, options.maxBatchPerCollection ?? 200));
  const db = getAdminDb();
  const report: RetentionPlanRow[] = [];

  for (const target of RETENTION_TARGETS) {
    const cutoffMs = now.getTime() - target.maxAgeDays * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();
    const snap = await db.collection(target.collection).limit(limit).get();

    const expiredRefs: FirebaseFirestore.DocumentReference[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const rawVal = data[target.timestampField] ?? data.createdAtMs ?? data.updatedAt ?? data.createdAt;
      let docTimeMs = NaN;
      if (typeof rawVal === 'number') {
        docTimeMs = rawVal;
      } else if (typeof rawVal === 'string') {
        docTimeMs = Date.parse(rawVal);
      } else if (rawVal && typeof rawVal === 'object' && typeof (rawVal as { toMillis?: () => number }).toMillis === 'function') {
        docTimeMs = (rawVal as { toMillis: () => number }).toMillis();
      }
      const isExpired =
        target.timestampField === 'expiresAt'
          ? Number.isFinite(docTimeMs) && docTimeMs <= now.getTime()
          : Number.isFinite(docTimeMs) && docTimeMs <= cutoffMs;
      if (isExpired) {
        expiredRefs.push(doc.ref);
      }
    }

    let deletedCount = 0;
    if (options.execute && expiredRefs.length > 0) {
      const batch = db.batch();
      for (const ref of expiredRefs) {
        batch.delete(ref);
      }
      await batch.commit();
      deletedCount = expiredRefs.length;
    }

    report.push({
      collection: target.collection,
      maxAgeDays: target.maxAgeDays,
      cutoffIso,
      candidateCount: expiredRefs.length,
      deletedCount,
      dryRun: !options.execute,
    });
  }

  return report;
}

const isDirectCli =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('retention-cleanup-dryrun.ts');

if (isDirectCli) {
  const execute = process.argv.includes('--execute');
  console.log(
    JSON.stringify({
      event: 'retention_cleanup_start',
      projectId: ADMIN_PROJECT_ID,
      databaseId: ADMIN_DATABASE_ID,
      mode: execute ? 'EXECUTE' : 'DRY_RUN',
    })
  );
  runRetentionCleanup({ execute })
    .then((rows) => {
      console.log(JSON.stringify({ ok: true, rows }, null, 2));
    })
    .catch((err) => {
      console.error('Retention cleanup failed:', err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
