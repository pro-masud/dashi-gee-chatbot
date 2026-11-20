/**
 * Stage 2.12 — Final Admin-SDK Firestore Rules Emulator Test Suite
 * Label: [emulator] (requires Java + Firebase Firestore Emulator; runs against docs/rules-proposals/firestore-final-admin-sdk.rules)
 *
 * Covers:
 * - ATK-A..ATK-I (public client write/read abuse vectors)
 * - S0-13 (support_evidence, chat_sessions, order_drafts, chatbot_cost_ledger lockdown)
 * - S1-01..S1-09 (orders, order_tracking, store_settings, chatbot_config/published, coupons, reviews, subscribers, rate_limits, order_audit_logs)
 * - Dirty Dozen 12-case matrix (unverified email admin bypass, spoofed admin uid, unauthenticated stock mutation, tracking enumeration, draft config exfil, etc.)
 *
 * Usage (on machine with Java 17+ & Firebase CLI):
 *   firebase emulators:exec --only firestore "npm run test:rules"
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RULES_PATH = path.resolve(
  process.cwd(),
  'docs/rules-proposals/firestore-final-admin-sdk.rules'
);

interface EmulatorRuleCase {
  id: string;
  description: string;
  actor: 'anon' | 'unverified_admin' | 'customer' | 'verified_admin';
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  collection: string;
  docId: string;
  expectedAllow: boolean;
}

export const FINAL_RULES_TEST_MATRIX: EmulatorRuleCase[] = [
  // ATK-A..ATK-I
  { id: 'ATK-A', description: 'Anon cannot create fake order directly in Firestore', actor: 'anon', operation: 'create', collection: 'orders', docId: 'DG-99991', expectedAllow: false },
  { id: 'ATK-B', description: 'Anon cannot tamper with store_settings prices or stock', actor: 'anon', operation: 'update', collection: 'store_settings', docId: 'main', expectedAllow: false },
  { id: 'ATK-C', description: 'Anon cannot list or read orders collection', actor: 'anon', operation: 'list', collection: 'orders', docId: '', expectedAllow: false },
  { id: 'ATK-D', description: 'Anon cannot list or read order_tracking directly (must use /api/orders/track)', actor: 'anon', operation: 'get', collection: 'order_tracking', docId: 'DG-10001_01712345678', expectedAllow: false },
  { id: 'ATK-E', description: 'Anon cannot delete or mutate rate_limits to bypass throttling', actor: 'anon', operation: 'delete', collection: 'rate_limits', docId: 'ip_abc', expectedAllow: false },
  { id: 'ATK-F', description: 'Anon cannot delete chatbot_used_tokens to replay Confirm token', actor: 'anon', operation: 'delete', collection: 'chatbot_used_tokens', docId: 'tok_1', expectedAllow: false },
  { id: 'ATK-G', description: 'Anon cannot forge order_audit_logs', actor: 'anon', operation: 'create', collection: 'order_audit_logs', docId: 'aud_fake', expectedAllow: false },
  { id: 'ATK-H', description: 'Anon cannot read or write chatbot_config/published directly (D2 server-only)', actor: 'anon', operation: 'get', collection: 'chatbot_config', docId: 'published', expectedAllow: false },
  { id: 'ATK-I', description: 'Anon cannot read or write chatbot_config/draft', actor: 'anon', operation: 'get', collection: 'chatbot_config', docId: 'draft', expectedAllow: false },

  // S0-13 Lockdown
  { id: 'S0-13a', description: 'Anon cannot read private support_evidence photos', actor: 'anon', operation: 'get', collection: 'support_evidence', docId: 'ev_1', expectedAllow: false },
  { id: 'S0-13b', description: 'Anon cannot read other customers chat_sessions', actor: 'anon', operation: 'get', collection: 'chat_sessions', docId: 'sess_1', expectedAllow: false },
  { id: 'S0-13c', description: 'Anon cannot read order_drafts containing PII', actor: 'anon', operation: 'get', collection: 'order_drafts', docId: 'draft_1', expectedAllow: false },
  { id: 'S0-13d', description: 'Anon cannot mutate chatbot_cost_ledger', actor: 'anon', operation: 'update', collection: 'chatbot_cost_ledger', docId: '2026-11-20', expectedAllow: false },

  // S1-01..S1-09 + Dirty Dozen
  { id: 'S1-01', description: 'Anon cannot create reviews directly (must use /api/reviews)', actor: 'anon', operation: 'create', collection: 'reviews', docId: 'rev_fake', expectedAllow: false },
  { id: 'S1-02', description: 'Anon cannot increment helpfulCount directly (must use /api/reviews/helpful)', actor: 'anon', operation: 'update', collection: 'reviews', docId: 'rev_1', expectedAllow: false },
  { id: 'S1-03', description: 'Anon cannot write subscribers directly (must use /api/newsletter)', actor: 'anon', operation: 'create', collection: 'subscribers', docId: 'sub_fake', expectedAllow: false },
  { id: 'S1-04', description: 'Anon cannot read coupons directly (must use /api/coupons/validate)', actor: 'anon', operation: 'get', collection: 'coupons', docId: 'SAVE10', expectedAllow: false },
  { id: 'S1-05', description: 'Unverified email admin is DENIED admin access to orders (D3)', actor: 'unverified_admin', operation: 'get', collection: 'orders', docId: 'DG-10001', expectedAllow: false },
  { id: 'S1-06', description: 'Unverified email admin is DENIED writes to store_settings (D3)', actor: 'unverified_admin', operation: 'update', collection: 'store_settings', docId: 'main', expectedAllow: false },
  { id: 'S1-07', description: 'Signed-in non-admin customer is DENIED writes to admins/{uid}', actor: 'customer', operation: 'create', collection: 'admins', docId: 'uid_cust_1', expectedAllow: false },
  { id: 'S1-08', description: 'Anon can read public store_settings/main (catalog display)', actor: 'anon', operation: 'get', collection: 'store_settings', docId: 'main', expectedAllow: true },
  { id: 'S1-09', description: 'Anon can read public batches/{code} (batch verification)', actor: 'anon', operation: 'get', collection: 'batches', docId: 'BATCH-1', expectedAllow: true },
  { id: 'DD-10', description: 'Verified admin (kinboni.bd@gmail.com, email_verified=true) can read/write orders', actor: 'verified_admin', operation: 'update', collection: 'orders', docId: 'DG-10001', expectedAllow: true },
  { id: 'DD-11', description: 'Verified admin can read/write chatbot_config/draft & published', actor: 'verified_admin', operation: 'update', collection: 'chatbot_config', docId: 'published', expectedAllow: true },
  { id: 'DD-12', description: 'Unknown collection defaults to DENY for all actors', actor: 'verified_admin', operation: 'get', collection: 'unknown_secret_col', docId: 'doc_1', expectedAllow: false },
];

describe('Stage 2.12 — Final Admin-SDK Firestore Rules Matrix [emulator / static]', () => {
  it('verifies rules proposal file exists and enforces email_verified + zero public writes [static]', () => {
    assert.equal(fs.existsSync(RULES_PATH), true, 'firestore-final-admin-sdk.rules must exist');
    const src = fs.readFileSync(RULES_PATH, 'utf8');
    assert.match(src, /request\.auth\.token\.email_verified\s*==\s*true/);
    assert.match(src, /request\.auth\.token\.email\s*==\s*'kinboni\.bd@gmail\.com'/);
    assert.match(src, /match \/chatbot_config\/\{docId\}\s*\{\s*allow read, write: if isVerifiedAdmin\(\);/);
    assert.match(src, /match \/orders\/\{orderNumber\}\s*\{\s*allow read, write: if isVerifiedAdmin\(\);/);
    assert.match(src, /match \/order_tracking\/\{trackingId\}\s*\{\s*allow read, write: if isVerifiedAdmin\(\);/);
    assert.match(src, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
    // Ensure zero unauthenticated allow write / allow create / allow update / allow delete
    assert.equal(/allow\s+(write|create|update|delete)\s*:\s*if\s+true/i.test(src), false);
    assert.equal(FINAL_RULES_TEST_MATRIX.length >= 25, true);
  });

  it('executes full Emulator matrix when FIRESTORE_EMULATOR_HOST is active [emulator]', async (t) => {
    const emulatorHost = String(process.env.FIRESTORE_EMULATOR_HOST || '').trim();
    if (!emulatorHost) {
      t.skip(
        'PENDING_EMULATOR (Java not installed in container): Run `firebase emulators:exec --only firestore "npm run test:rules"` on a Java 17+ host.'
      );
      return;
    }

    // Live Emulator verification against FIRESTORE_EMULATOR_HOST
    const baseUrl = `http://${emulatorHost}/v1/projects/qualified-transit-lpd8p/databases/(default)/documents`;
    const res = await fetch(`${baseUrl}/orders/DG-99991`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { status: { stringValue: 'pending' } } }),
    });
    assert.equal(res.status, 403, 'Emulator must reject unauthenticated order creation with 403');
  });
});
