# Deshi Gee — Server-Side Auth & Firebase Admin SDK Migration Plan

> **Document status:** Planning & Audit ONLY — **NO Firebase Admin SDK code has been implemented and NO live Firestore deploy has been performed.**
> **Target project:** `qualified-transit-lpd8p` · **Database ID:** `ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f`
> **Related files:** `DEPLOY_BLOCKED.md`, `docs/FIRESTORE_RULES_DIFF_PROOF.md`, `PENDING_BACKLOG.md`

---

## Section A — Code Confirmation of `S1-01..S1-09` (Unauthenticated Firestore REST / Public-API-Key Surfaces)

> **Mapping note:** The codebase (`docs/` and `PENDING_BACKLOG.md`) uses `S0-01..S0-12` and Phase IDs (`0-01..6-06`); `S1-01..S1-09` are mapped below to all 9 collection groups currently accessed via unauthenticated Firestore REST (`src/lib/chatbot/firestoreRest.ts:64`, `BASE_DOC_URL` + `?key=<public web API key>`) or public client SDK (`src/lib/firebase.ts`). Every entry below is verified directly against the current repository code and the LIVE Firestore rules (`docs/LIVE_FIRESTORE_RULES_SNAPSHOT.rules`, identical to baseline `1550bd7:firestore.rules`).

| ID | Collection(s) | Exact Code Locations (`file` · `function` · `line`) | LIVE Rules Exposure (`1550bd7:firestore.rules`) | What an Attacker with Only the Public API Key Can Do Today |
|---|---|---|---|---|
| **S1-01** | `chat_sessions` | `src/lib/chatbot/firestoreRest.ts` · `fetchServerChatSession` (L2438), `upsertServerChatSession` (L2493), `linkSessionVerifiedPhone` (L4087)<br>`app/api/chat/session/route.ts` · `POST` (L23), `GET` (L50), `DELETE` (L104)<br>`app/api/chat/route.ts` · `POST` (L260)<br>`app/api/channels/webhook/route.ts` · `POST` (L149) | L1133–1159 (`allow get: if isValidId(sessionId); allow create/update: if ...`) | Directly `GET` any known/guessed `sessionId` (leaking `linkedPhone`, `agentReplies`, `activeTicketId`, conversation summary) bypassing `/api/chat/session` cookie check; `create`/`update` arbitrary session docs. |
| **S1-02** | `order_drafts` | `src/lib/chatbot/firestoreRest.ts` · `fetchServerOrderDraft` (L2570), `upsertServerOrderDraft` (L2623)<br>`app/api/chat/session/route.ts` · `GET` (L50)<br>`app/api/chat/route.ts` · `POST` (L260) | L1161–1168 (`allow get: if isValidId(draftId); allow create, update: if isValidId(draftId) && isValidOrderDraft(incoming())`) | Directly `GET` any `draft_<sessionId>` exposing full checkout PII (`customerName`, `phone`, `district`, `area`, `address`, `txnId`, `note`) bypassing `/api/chat/session` cookie check; overwrite/poison active drafts. |
| **S1-03** | `refill_reminders` | `src/lib/chatbot/firestoreRest.ts` · `fetchRefillReminder` (L3456), `upsertRefillReminder` (L3482)<br>`app/api/orders/refill-reminder/route.ts` · `GET` (L10), `POST` (L26) | L1227–1248 (`allow get: if isValidId(reminderId); allow create/update: if ... exists(order_tracking/$(reminderId))`) | Directly `GET` `{orderNumber}_{phone}` leaking opt-in status, phone, and reminder schedule; directly `create`/`update` (`intervalDays`, `status`, `nextReminderAtIso`) bypassing API rate limit & ownership proof. |
| **S1-04** | `marketing_consents` | `src/lib/chatbot/firestoreRest.ts` · `fetchMarketingConsentByPhone` (L4174), `upsertMarketingConsent` (L4197)<br>`app/api/retention/campaigns/route.ts` · `POST` (L64)<br>`app/api/channels/webhook/route.ts` · `POST` (L149) | L1256–1279 (`allow get: if isValidId(phoneKey); allow create/update: if phoneKey == incoming().phone`) | Directly `GET` any Bangladesh phone `01XXXXXXXXX` (leaking whether the number is a customer, consent state, `customerName`, channel); directly `create`/`update` any victim's `optIn`/`unsubscribed` flag bypassing `/api/retention/campaigns` ownership proof (`S0-03`). |
| **S1-05** | `chatbot_rate_buckets`, `chatbot_cost_ledger` | `src/lib/chatbot/firestoreRest.ts` · `checkAndIncrementFirestoreRateLimit` (L446), `getPersistentDailyCostStatus` (L2053), `recordPersistentDailyCost` (L2115)<br>`app/api/chat/route.ts` · `POST` (L260) | L1097–1124 (`allow get, create, update` without auth) | DoS any user/IP rate bucket by incrementing `count` to the cap; inflate `chatbot_cost_ledger/{YYYY-MM-DD}.totalUsd` by up to `$0.50` per request until the daily AI spend cap trips (`capHit = true`), taking the chatbot offline for all shoppers. |
| **S1-06** | `chatbot_used_tokens`, `chatbot_order_idempotency`, `order_fingerprints` | `src/lib/chatbot/firestoreRest.ts` · `checkOrderIdempotency` (L527), `checkRecentOrderFingerprint` (L551), `createServerOrderAtomically` (L585; writes L755, L766, L779)<br>`app/api/order/route.ts` · `POST` (L28) | L1080–1095, L1183–1190 (`allow get` + `allow create` without auth; paired with `orders` on idempotency/fingerprint) | Probe `chatbot_used_tokens/{tokenId}`, `chatbot_order_idempotency/{idemKey}`, and `order_fingerprints/{hash}` directly; pre-occupy `chatbot_used_tokens/{tokenId}` with unauthenticated `create` (L1084 has no `orders` pairing). |
| **S1-07** | `orders`, `order_tracking`, `store_settings/main`, `order_audit_logs` | `src/lib/firebase.ts` · `createOrderAtomically` (L169), `trackOrderLookup` (L249)<br>`src/lib/chatbot/firestoreRest.ts` · `fetchServerOrderTracking` (L413), `createServerOrderAtomically` (L585), `manageServerOrder` (L923), `fetchServerOrderForPaymentValidation` (L4909), `markServerOrderPaymentVerified` (L4997)<br>`app/api/order/route.ts` (`POST` L28), `app/api/orders/manage/route.ts` (`GET` L9, `POST` L28), `app/api/payments/callback/route.ts` (`POST` L298) | L850–954 (`orders`, `order_tracking`, `store_settings`), L1192–1202 (`order_audit_logs`) | **CRITICAL (`S0-13`):** (1) Direct unauthenticated `orders/{orderId}` update of `district`, `area`, `address`, `deliveryZone`, `deliveryFeeBdt` (even to `0`!), `totalBdt`, `estimatedDelivery`, `updatedAt` on `pending`/`confirmed` orders **without even knowing `phone`** (L915–923); (2) Unauthenticated `order_tracking/{lookupId}` update of 7 fields including unchecked `status` (L947–951); (3) Unauthenticated `orders` + `store_settings/main` stock drain by submitting fake orders directly to Firestore bypassing server rate limits & confirmation tokens; (4) Unauthenticated `order_tracking/{orderNumber}_{phone}` brute-force oracle; (5) **Live breakage in `S0-04`:** `fetchServerOrderForPaymentValidation` (L4980) and `markServerOrderPaymentVerified` (L5062) cannot read/patch `orders/{orderId}` without Admin SDK because `orders` requires `isAdmin()` for `get` and `paymentStatus` update. |
| **S1-08** | `payment_gateway_events`, `channel_webhook_events` | `src/lib/chatbot/firestoreRest.ts` · `recordOrCheckWebhookEventIdempotency` (L4007), `recordPaymentGatewayEvent` (L4813)<br>`app/api/channels/webhook/route.ts` (`POST` L149), `app/api/payments/callback/route.ts` (`POST` L298), `app/api/courier/webhook/route.ts` (`POST` L11) | L1250–1254 (`channel_webhook_events`), L1281–1286 (`payment_gateway_events`) — both allow unauthenticated `create` | Spoof fake `payment_verified` records in `payment_gateway_events` for any existing `orderNumber` (bypassing SSLCommerz IPN & bKash validation), or pre-occupy `channel_webhook_events/{eventId}` to make real Meta/WhatsApp webhooks drop as `duplicate`. |
| **S1-09** | `chatbot_logs`, `chatbot_feedback`, `chatbot_support_requests`, `support_evidence`, `order_review_claims` (+ `reviews`) | `src/lib/chatbot/firestoreRest.ts` · `createServerChatLog` (L2280), `createServerChatFeedback` (L2730), `createServerSupportRequest` (L1652), `createServerSupportEvidence` (L2787), `createVerifiedDeliveryReview` (L3284)<br>`app/api/chat/route.ts` (`POST` L260), `app/api/chatbot/feedback/route.ts` (`POST` L4), `app/api/support/ticket/route.ts` (`POST` L22), `app/api/support/evidence/route.ts` (`POST` L36), `app/api/orders/review/route.ts` (`POST` L7) | L963–992 (`reviews`), L1044–1078 (`chatbot_logs`, `chatbot_support_requests`), L1170–1181 (`chatbot_feedback`), L1204–1209 (`support_evidence`), L1217–1225 (`order_review_claims`) — all allow unauthenticated `create` | Flood admin dashboards with unbounded fake chat logs, feedback, support tickets, and base64 image blobs (`support_evidence` up to 900 KB/doc — storage/cost exhaustion), bypassing API rate limits & honeypots. |

---

## Section B — Ordered Migration Plan to Firebase Admin SDK + ADC

### Prerequisites (Gate Before Writing Any Admin SDK Code)
- **Step 0 — Project Ownership & IAM Decision (Owner Action Required):** Confirm whether `qualified-transit-lpd8p` is a **user-owned GCP/Firebase project** or an **AI Studio Google-hosted (Starter Tier)** project (see Section C). Admin SDK server-side Firestore reads/writes **cannot** run on a Starter Tier project until it is upgraded ("grown out") or hosted on a user-owned GCP/Firebase project.

### Ordered Implementation Steps

1. **Step 1 — Add `firebase-admin` & Centralized Admin Firestore Singleton (`src/lib/firebaseAdmin.ts`)**
   - Install `firebase-admin` via `install_applet_package`.
   - Initialize **once** using Application Default Credentials (ADC) — **NEVER** download, request, or commit a service account JSON key file:
     ```ts
     import { getApp, getApps, initializeApp } from 'firebase-admin/app';
     import { getFirestore } from 'firebase-admin/firestore';
     import firebaseConfig from '../../firebase-applet-config.json';

     const app = getApps().length
       ? getApp()
       : initializeApp({ projectId: firebaseConfig.projectId });

     export const adminDb =
       firebaseConfig.firestoreDatabaseId &&
       firebaseConfig.firestoreDatabaseId !== '(default)'
         ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
         : getFirestore(app);
     ```
   - Guard against remix placeholder values (`projectId`, `firestoreDatabaseId`) before initializing.
   - Keep `DESHI_GEE_TEST_MODE=1` / `NODE_ENV === 'test'` in-memory test harnesses working cleanly so unit tests NEVER hit live Firestore even if someone runs `tsx --test` directly (also harden the test-mode guard so test files fail loudly instead of silently hitting live Firestore!).

2. **Step 2 — Grant Least-Privilege IAM Role to the Runtime Service Account (Owner Action)**
   - In Google Cloud IAM for `qualified-transit-lpd8p`, grant **only** `roles/datastore.user` (never `Owner` or `Editor`) to the preview runtime service account email (retrieved in Section C).
   - Verify connectivity with a single server-side smoke check (no metadata endpoint in app code).

3. **Step 3 — Migrate Server Storage Layer (`src/lib/chatbot/firestoreRest.ts` → Admin SDK)**
   - Migrate in 4 safe vertical slices, keeping every route's external contract intact:
     1. **Slice A (`S1-01`–`S1-04`):** `chat_sessions`, `order_drafts`, `refill_reminders`, `marketing_consents` (unblocks `S0-02` & `S0-03`).
     2. **Slice B (`S1-05`, `S1-08`, `S1-09`):** `chatbot_rate_buckets`, `chatbot_cost_ledger` (using true Firestore `runTransaction` atomic increment — also fixes `0-10`!), `payment_gateway_events`, `channel_webhook_events`, `chatbot_logs`, `chatbot_feedback`, `chatbot_support_requests`, `support_evidence`, `order_review_claims`.
     3. **Slice C (`S1-06`, `S1-07`):** `orders`, `order_tracking`, `store_settings/main`, `chatbot_used_tokens`, `chatbot_order_idempotency`, `order_fingerprints`, `order_audit_logs` — using `adminDb.runTransaction()` so stock decrement, order creation, token consumption, coupon `usedCount`, and tracking projection execute atomically with server-enforced invariants (also unblocks `S0-04` live `markServerOrderPaymentVerified` and `2-03`!).
     4. **Slice D (Storefront Checkout & Tracking Client Migration):** Route browser checkout (`src/lib/firebase.ts:createOrderAtomically` L169) and browser tracking (`src/lib/firebase.ts:trackOrderLookup` L249) through server API routes (`/api/order` and `/api/orders/track`) instead of direct client Firestore SDK calls, so `orders`, `order_tracking`, and `store_settings/main` writes can be locked to `isAdmin()`-only in `firestore.rules`.

4. **Step 4 — Implement Server-Side Invariant Enforcement (Replacing Bypassed `firestore.rules`)**
   - Because **Firebase Admin SDK bypasses `firestore.rules` completely**, every invariant that `firestore.rules` previously enforced MUST be explicitly enforced and unit-tested in server TypeScript code BEFORE loosening/replacing client paths:

| Collection / Flow | What `firestore.rules` Previously Enforced | Mandatory Server-Side Validation Under Admin SDK |
|---|---|---|
| `chat_sessions`, `order_drafts` (`S1-01`, `S1-02`) | `isValidChatSession`, `isValidOrderDraft`, `sessionId`/`draftId` match, visitor cannot touch `aiPaused`/`activeTicketId`/`assignedAgentName`/`agentReplies` or change `linkedPhone` | Verify signed HttpOnly cookie (`verifySessionCookieValue`) matches `sessionId`; enforce ≥128-bit IDs; reject/strip admin-only fields (`aiPaused`, `activeTicketId`, `assignedAgentName`, `agentReplies`) on all non-admin mutations; enforce `linkedPhone` immutability once verified; validate schema & `expiresAt` bounds. |
| `refill_reminders` (`S1-03`) | `exists(/order_tracking/$(orderNumber + '_' + phone))`, `reminderId == orderNumber + '_' + phone`, customer cannot modify `reminderCount` / `lastNotifiedAtIso` | **Explicitly read `orders/{orderNumber}` (or `order_tracking/{orderNumber}_{phone}`) inside server route** and verify: (a) order exists, (b) `order.phone === normalizedPhone`, (c) `order.status === 'delivered'` (or eligible state); enforce canonical doc ID `${orderNumber}_${phone}`; allow customer routes to modify only `intervalDays`, `status`, `nextReminderAtIso`, `updatedAt` (never `reminderCount` / `lastNotifiedAtIso`). |
| `marketing_consents` (`S1-04`) | `phoneKey == incoming().phone`, BD phone regex `^01[3-9][0-9]{8}$`, customer cannot modify `campaignCount` / `lastCampaignAtIso` | Verify phone ownership proof (`orders/{orderNumber}.phone === phone`, valid non-expired HMAC unsubscribe token bound to `phone`, verified WhatsApp/Meta webhook signature for that sender, or verified Admin ID token); validate BD phone regex; strip `campaignCount` & `lastCampaignAtIso` on non-admin writes. |
| `orders` + `order_tracking` + `store_settings/main` + `coupons` + `chatbot_used_tokens` (`S1-06`, `S1-07`, `S0-13`) | `isValidOrder`, `matchesCanonicalStorePricing`, `paymentStatus in ['cod_due', 'pending_verification']`, `status == 'pending'`, `txnId.size() >= 4` for bKash/Nagad, `existsAfter(order_tracking)`, stock decrement formula, single-use token, pre-dispatch lock on cancel/edit | Run inside a single `adminDb.runTransaction()`: (1) verify HMAC confirmation token & check `chatbot_used_tokens/{tokenId}` does not exist; (2) read `store_settings/main` and compute canonical `unitPriceBdt`, `subtotalBdt`, `deliveryFeeBdt` (by verified zone/district — never client-supplied!), `discountBdt` (validate active coupon + `usedCount < maxUses` + expiry), and `totalBdt`; (3) check `stock250g/500g/1kg >= qty` and decrement atomically; (4) write `orders`, `order_tracking`, `chatbot_used_tokens`, `chatbot_order_idempotency`, `order_fingerprints` (keyed HMAC), and `order_audit_logs` in the same transaction. On self-serve cancel/address-edit (`/api/orders/manage`): require verified `orderNumber + phone` match + rate limit + check `order.status in ['pending', 'confirmed']`, recompute `deliveryFeeBdt` & `totalBdt` from `store_settings/main` (preventing `0`-fee hijack!), restore stock atomically on cancel, and sync `orders` + `order_tracking` together. |
| `orders/{orderId}.paymentStatus` (`S0-04`) | `isAdmin()` only | Update `orders` + `order_tracking` `paymentStatus = 'verified'` ONLY inside `/api/payments/callback` after: (a) SSLCommerz IPN MD5 `verify_sign` + Validation API `VALID`/`VALIDATED` + exact `amount == order.totalBdt` + `currency == 'BDT'`, OR (b) bKash `execute` `statusCode == '0000'` + `transactionStatus == 'Completed'` + exact `merchantInvoiceNumber == orderNumber` + exact `amount == order.totalBdt`. Write immutable `payment_gateway_events` & `order_audit_logs` inside the same transaction. |
| `order_review_claims` + `reviews` (`S1-09`) | `orders/{orderNumber}.status == 'delivered'`, atomic claim + review with `status == 'pending'`, one claim per order | Run `adminDb.runTransaction()`: verify `orders/{orderNumber}` exists, `order.phone === phone`, `order.status === 'delivered'`, and `order_review_claims/{orderNumber}` does not yet exist; force `review.status = 'pending'` (never `'approved'`). |
| `chatbot_cost_ledger` & `chatbot_rate_buckets` (`S1-05`) | Monotonic `requestCount + 1`, USD delta `<= 0.5` | Atomic `adminDb.runTransaction()` increment using server-computed token cost only; zero client-supplied cost or bucket override. |
| Admin endpoints (`/api/chatbot/admin`, `/api/analytics/attribution`, `/api/courier/book`, etc.) | `isAdmin()` (`email_verified == true && (email == ... || exists(/admins/$(uid)))`) | Verify Firebase ID token via `getAuth(app).verifyIdToken(idToken)` (note: `verifyIdToken(token)` requires no IAM; `verifyIdToken(token, true)` requires `roles/firebaseauth.viewer`), verify `email_verified === true`, and verify allowlisted email or `admins/{uid}` document via `adminDb`. |

5. **Step 5 — Lock Down `firestore.rules` (Merge `rules-admin-only-pending-sdk` + Remaining `S1-01..S1-09` & `S0-13`)**
   - Public read-only collections remain strictly scoped: `store_settings/main` (public storefront config), `batches` (active), `reviews` (`approved`), `chatbot_config/published`, `chatbot_faqs` (`active && published`), `chatbot_kb_docs` (`published && public`), `knowledge_chunks` (`published && public`), `coupons/{code}` (`get` by exact code only, or server-only).
   - **ALL** operational/PII/security collections (`chat_sessions`, `order_drafts`, `refill_reminders`, `marketing_consents`, `orders`, `order_tracking`, `chatbot_rate_buckets`, `chatbot_cost_ledger`, `chatbot_used_tokens`, `chatbot_order_idempotency`, `order_fingerprints`, `order_audit_logs`, `payment_gateway_events`, `channel_webhook_events`, `chatbot_logs`, `chatbot_feedback`, `chatbot_support_requests`, `support_evidence`, `order_review_claims`, `subscribers`) become **`allow read, write: if isAdmin();`** (or `allow update, delete: if false;` on immutable audit/event ledgers).
   - `store_settings/main` `allow update` becomes **`isAdmin()`-only** (no unauthenticated stock update path!).
   - Keep `match /{document=**} { allow read, write: if false; }` default-deny at top.

6. **Step 6 — Execute Firestore Emulator Attack Suite (`Java` required)**
   - Run every attack test in the matrix below against the local Firestore Emulator (`firebase emulators:exec --only firestore`).

7. **Step 7 — Staged Rollout & Owner-Approved Deploy**
   - Deploy application code (using Admin SDK) FIRST while keeping current rules live (zero downtime, because Admin SDK bypasses rules).
   - Smoke-test all customer & admin journeys against Admin SDK paths.
   - Request **explicit written owner approval**, then deploy the locked-down `firestore.rules`.

---

### Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Admin SDK bypasses `firestore.rules`, so a missing server validation bug can write invalid data or leak PII | 🔴 High | Centralize all Firestore writes in typed repository functions with strict runtime schema validation (Zod or strict validators) + unit tests mirroring every old rule constraint (Section B Step 4 table). |
| `firestoreDatabaseId` omitted in `getFirestore(app)` silently writes to `(default)` DB instead of `ai-studio-deshigee-...` | 🔴 High | Always pass `firebaseConfig.firestoreDatabaseId` as the 2nd argument to `getFirestore(app, dbId)`; add startup unit test asserting non-`(default)` DB binding. |
| Deploying locked `firestore.rules` before all client SDK writes (`src/lib/firebase.ts`) are migrated breaks storefront checkout or `/track` | 🔴 High | Deploy Admin SDK code & API routes first, verify zero direct unauthenticated client SDK writes in browser network tab, then deploy rules only after owner sign-off. |
| Starter Tier project cannot grant IAM roles to AI Studio SA (`7 PERMISSION_DENIED`) | 🔴 High | Gate on Step 0 ownership confirmation before writing Admin SDK code (Section C). |
| Preview AI Studio SA is shared across all of the owner's AI Studio preview apps | 🟠 Medium | Grant strictly `roles/datastore.user` (never Owner/Editor), warn owner clearly, and revoke preview SA grant after moving to production hosting (Cloud Run / Firebase App Hosting) with a dedicated per-service SA. |
| Accidental live Firestore writes during `tsx --test` if `DESHI_GEE_TEST_MODE` is unset | 🟠 Medium | Enforce a hard guard in `firebaseAdmin.ts` / `firestoreRest.ts` that refuses live network calls inside `node:test` unless an explicit opt-in flag (`ALLOW_LIVE_FIRESTORE_SMOKE=1`) is set. |

---

### Rollback Plan

1. **If Admin SDK deployment fails BEFORE rules deploy:** Revert the app code commit (or redeploy previous build). Because live `firestore.rules` have not changed yet, the previous REST + API key code resumes immediately with zero data-model incompatibility.
2. **If locked `firestore.rules` deploy causes unexpected `PERMISSION_DENIED` on a missed client path:** Immediately re-deploy the known-good baseline snapshot (`docs/LIVE_FIRESTORE_RULES_SNAPSHOT.rules` / `1550bd7:firestore.rules`) after owner confirmation, restore functionality in < 1 minute, fix the missed client path to use a server API route, re-verify in Emulator, and re-deploy.
3. **If IAM grant needs revocation:** Owner removes `roles/datastore.user` from `ais-sandbox@ais-asia-northeast1-51d7c07c6b.iam.gserviceaccount.com` in Google Cloud IAM immediately.

---

### Attack-by-Attack Emulator Test Matrix (`"Attacker with the public API key cannot do X"`)

> **Java requirement legend:**
> - **☕ Requires Java (JRE/JDK 11+):** Real Firebase Firestore Emulator (`@firebase/rules-unit-testing` + `firebase emulators:exec --only firestore`) proving genuine `PERMISSION_DENIED` on every rule path.
> - **⚡ No Java needed:** Node.js unit/integration tests against Next.js route handlers & server invariant validators (runs in `npm test` today).

| Test ID | Attack Scenario (`"Attacker with the public API key cannot..."`) | Target Collection / Route | Verification Assertion | Needs Java? |
|---|---|---|---|---|
| **ATK-01** (`S1-01`) | ...read, create, or overwrite another user's `chat_sessions/{sessionId}` directly via Firestore REST/SDK | `/chat_sessions/{sessionId}` | `assertFails(getDoc / setDoc / updateDoc)` → `PERMISSION_DENIED` | ☕ Yes (Emulator) |
| **ATK-02** (`S1-01`) | ...read or delete another user's session via `/api/chat/session` without matching signed HttpOnly cookie | `/api/chat/session` | HTTP `403`, response contains zero PII / `agentReplies` | ⚡ No (already in `stage1-p0-security.test.ts`) |
| **ATK-03** (`S1-02`) | ...read or tamper with `order_drafts/{draftId}` (name, phone, address) directly via Firestore REST/SDK | `/order_drafts/{draftId}` | `assertFails(getDoc / setDoc / updateDoc)` → `PERMISSION_DENIED` | ☕ Yes (Emulator) |
| **ATK-04** (`S1-03`) | ...read, create, or edit `refill_reminders/{order_phone}` directly via Firestore REST/SDK | `/refill_reminders/{id}` | `assertFails(getDoc / setDoc / updateDoc)` → `PERMISSION_DENIED` | ☕ Yes (Emulator) |
| **ATK-05** (`S1-03`) | ...create a refill reminder via `/api/orders/refill-reminder` for a non-existent order or mismatched phone (replacing removed `exists()` rule) | `/api/orders/refill-reminder` | HTTP `403` / `404`, no doc written | ⚡ No (Server invariant test) |
| **ATK-06** (`S1-04`) | ...probe `marketing_consents/{phone}` or flip a victim's `optIn`/`unsubscribed` directly via Firestore REST/SDK | `/marketing_consents/{phone}` | `assertFails(getDoc / setDoc / updateDoc)` → `PERMISSION_DENIED` | ☕ Yes (Emulator) |
| **ATK-07** (`S1-04`) | ...unsubscribe or opt-in a victim's phone via `/api/retention/campaigns` without Order ID+phone proof or valid HMAC token | `/api/retention/campaigns` | HTTP `403` on phone-only, wrong order, forged/expired/mismatched token | ⚡ No (already in `stage1-p0-security.test.ts`) |
| **ATK-08** (`S1-05`) | ...inflate `chatbot_cost_ledger/{date}` to trip daily AI kill-switch or DoS `chatbot_rate_buckets/{id}` directly via Firestore | `/chatbot_cost_ledger`, `/chatbot_rate_buckets` | `assertFails(getDoc / setDoc / updateDoc)` → `PERMISSION_DENIED` | ☕ Yes (Emulator) |
| **ATK-09** (`S1-06`) | ...pre-occupy `chatbot_used_tokens/{id}` or scrape `order_fingerprints/{hash}` directly via Firestore | `/chatbot_used_tokens`, `/chatbot_order_idempotency`, `/order_fingerprints` | `assertFails(getDoc / setDoc)` → `PERMISSION_DENIED` | ☕ Yes (Emulator) |
| **ATK-10** (`S1-07`, `S0-13`) | ...hijack `address` or zero out `deliveryFeeBdt` on any `pending`/`confirmed` order in `orders/{orderId}` without knowing `phone` | `/orders/{orderId}` | `assertFails(updateDoc)` → `PERMISSION_DENIED` | ☕ Yes (Emulator) |
| **ATK-11** (`S1-07`, `S0-13`) | ...forge `status: 'delivered'` or scrape/brute-force `{orderNumber}_{phone}` directly via `order_tracking/{lookupId}` | `/order_tracking/{lookupId}` | `assertFails(getDoc / updateDoc)` → `PERMISSION_DENIED` | ☕ Yes (Emulator) |
| **ATK-12** (`S1-07`) | ...drain `store_settings/main` inventory or create fake `orders` bypassing `/api/order` confirmation token & rate limit | `/orders/{id}`, `/store_settings/main` | `assertFails(create / update)` → `PERMISSION_DENIED` | ☕ Yes (Emulator) |
| **ATK-13** (`S1-08`) | ...inject fake `payment_verified` into `payment_gateway_events` or pre-occupy `channel_webhook_events/{eventId}` directly | `/payment_gateway_events`, `/channel_webhook_events` | `assertFails(create)` → `PERMISSION_DENIED` | ☕ Yes (Emulator) |
| **ATK-14** (`S0-04`) | ...forge SSLCommerz IPN hash, spoof `amount=10` BDT, trigger unauth `fail`/`cancel`, or bypass order lookup via `/api/payments/callback` | `/api/payments/callback` | HTTP `401` / `404` / `400`, `paymentStatus` remains unchanged | ⚡ No (already in `stage1-p0-security.test.ts`) |
| **ATK-15** (`S1-09`) | ...flood `support_evidence` (900KB blobs), `chatbot_logs`, `chatbot_feedback`, `chatbot_support_requests`, or `order_review_claims` directly via Firestore | All 5 collections | `assertFails(create)` → `PERMISSION_DENIED` | ☕ Yes (Emulator) |
| **ATK-16** (Dirty Dozen #1–#12) | ...bypass `isAdmin()` (unverified email, non-admin UID), auto-approve `reviews`, read unpublished `chatbot_config/draft` / `chatbot_faqs` / internal `chatbot_kb_docs` | All collections | `assertFails(...)` on all 12 Dirty Dozen + `assertSucceeds` for verified admin & legitimate public reads | ☕ Yes (Emulator) |

---

## Section C — Can AI Studio Provide a Service Account? & Hosting Alternatives

### Direct Answer (Grounded in Firebase Admin SDK / AI Studio Architecture)

- **Yes, AI Studio's preview container already runs as an AI Studio managed service account** (via Application Default Credentials / GCE metadata server). For this preview container, the runtime service account email is:
  `ais-sandbox@ais-asia-northeast1-51d7c07c6b.iam.gserviceaccount.com`
- **NEVER generate, download, or commit a service account JSON key file.** In AI Studio / GCP, Admin SDK must use ADC (`initializeApp({ projectId })`).
- **HOWEVER, whether that service account can actually access `qualified-transit-lpd8p` depends strictly on who owns the Firebase project:**
  1. **If `qualified-transit-lpd8p` is a Google-hosted (AI Studio Starter Tier) project** (created automatically by AI Studio, no Cloud Billing account attached):
     - **Admin SDK server-side Firestore reads/writes are NOT available.** You cannot manage IAM on a Starter Tier project, so you cannot grant `ais-sandbox@...` `roles/datastore.user`, and every server-side Firestore Admin SDK call will fail with `7 PERMISSION_DENIED`.
     - **Two paths forward:**
       - **(A) Upgrade ("grow out") `qualified-transit-lpd8p`** to a standard user-owned Google Cloud project by attaching a Cloud Billing account in the Google Cloud Console (`https://console.cloud.google.com/welcome`, docs: `https://docs.cloud.google.com/docs/starter-tier`). Once upgraded, you own IAM and can grant `roles/datastore.user`.
       - **(B) Stay client-SDK-only on Starter Tier** — **NOT recommended for Deshi Gee**, because e-commerce webhooks (SSLCommerz/bKash/Meta/WhatsApp), server-side rate limiting, daily cost ledger, private sessions/drafts, and order-payment verification genuinely require trusted server-side writes that cannot be safely expressed with unauthenticated public API key rules.
  2. **If `qualified-transit-lpd8p` is already a User-owned GCP/Firebase project:**
     - Admin SDK works in AI Studio preview via ADC as soon as you grant `ais-sandbox@ais-asia-northeast1-51d7c07c6b.iam.gserviceaccount.com` the least-privilege role **`roles/datastore.user`** in IAM (plus `roles/firebaseauth.viewer` only if revocation checks via `verifyIdToken(t, true)` are added; basic `verifyIdToken(t)` needs no IAM role).
     - **Important Security Caveats of the AI Studio Preview SA:**
       - That preview SA is **shared across all of your AI Studio preview apps** — any code in any of your previews (including remixed apps) can use IAM roles granted to it.
       - Project-level `roles/datastore.user` covers **every Firestore database** in `qualified-transit-lpd8p`.
       - The grant applies to **preview only** — a published/production app runs under a different service account and must be configured separately.

> **Required Owner Question Before Any Admin SDK Work:**
> **Is Firebase project `qualified-transit-lpd8p` a project that you own (with Cloud Billing & IAM access), or is it an AI Studio Google-hosted (Starter Tier) project?**

### Hosting Alternatives & Trade-Offs (For Production Deployment)

| Hosting Option | Service Account / Credential Model | Best For | Key Trade-Offs |
|---|---|---|---|
| **Google Cloud Run** (in user-owned GCP project) | Dedicated per-service IAM Service Account via ADC (`roles/datastore.user` only, zero JSON keys) | **Recommended for production Deshi Gee** (full Next.js App Router + webhooks + payment callbacks + cron/retention) | Requires Cloud Billing account (generous free tier); full IAM isolation per service; you configure custom domain/HTTPS & env secrets in Secret Manager. |
| **Firebase App Hosting** (user-owned Firebase Blaze project) | Managed Cloud Run backend + dedicated Firebase App Hosting SA via ADC + native Secret Manager integration | Tightest Firebase + Next.js integration with git push deploys | Requires Blaze (pay-as-you-go) billing plan; slightly less low-level container tuning than raw Cloud Run. |
| **Vercel / Netlify / Fly.io** | External hosting — no GCE metadata ADC; requires Workload Identity Federation (OIDC, preferred) or injected service account credentials in encrypted platform secrets | Fast Next.js edge/DX workflows | Extra cross-cloud IAM setup (OIDC/WIF or secret rotation); cold starts / function timeout limits on free tier; data leaves GCP network boundary on every Firestore hop (slightly higher latency to Firestore). |
| **AI Studio Preview / Starter Tier** | Shared preview SA (no IAM on Starter Tier) | Prototyping & development preview | Not suitable for production e-commerce with payment webhooks, private sessions, and strict IAM isolation. |

---

## Section D — Audit of Test Documents Created/Updated in the Live Firestore DB

> **ZERO documents were deleted.** All checks below were strictly **read-only HTTP `GET`** requests against `qualified-transit-lpd8p` / `ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f`.

### Root Cause
`npm test` sets `DESHI_GEE_TEST_MODE=1`, which activates in-memory maps (`setSessionDraftMemoryModeForTests`, `setOrderStorageMemoryModeForTests`, `setChannelMemoryModeForTests`, `setRateLimitMemoryModeForTests`, `setRetentionMemoryModeForTests`). However, during `S0-03` debugging on `2026-11-19` (`~04:57–05:04 UTC`), `npx tsx --test tests/phase5-channels-retention.test.ts tests/stage1-p0-security.test.ts` was invoked directly **without** `DESHI_GEE_TEST_MODE=1` (and with `NODE_ENV` unset). Because the test-mode toggles silently no-op when `NODE_ENV !== 'test' && DESHI_GEE_TEST_MODE !== '1'`, those test runs sent real REST writes to the live Firestore database. (Timestamps also show earlier pre-Stage-0 runs on `2026-11-18T10:00Z` had previously created several of the same Phase 5 draft docs.)

### 1. Confirmed Existing Test Documents in Live DB (Verified via Read-Only `GET` → HTTP `200`)

| Collection / Document Path | `createTime` (UTC) | `updateTime` (UTC) | Source Test |
|---|---|---|---|
| `chat_sessions/sess_501` | `2026-11-19T04:58:23.666420Z` | `2026-11-19T04:58:23.666420Z` | `tests/phase5-channels-retention.test.ts` (`T5.3`) |
| `chat_sessions/sess_502` | `2026-11-19T04:58:23.779299Z` | `2026-11-19T04:58:23.779299Z` | `tests/phase5-channels-retention.test.ts` (`T5.3`) |
| `chat_sessions/ch_wa_c38bd0e07613010419afeb16` | `2026-11-19T04:58:21.823906Z` | `2026-11-19T04:58:23.556441Z` | `tests/phase5-channels-retention.test.ts` (`T5.1/T5.2b`, `from: 8801711223344`) |
| `order_drafts/draft_sess_501` | `2026-11-18T10:00:04.775396Z` | `2026-11-19T04:58:23.678529Z` | `tests/phase5-channels-retention.test.ts` (`T5.3`, fake phone `01811000501`) |
| `order_drafts/draft_sess_502` | `2026-11-18T10:01:01.129455Z` | `2026-11-19T04:58:23.780891Z` | `tests/phase5-channels-retention.test.ts` (`T5.3`, fake phone `01811000502`) |
| `order_drafts/draft_ch_wa_c38bd0e07613010419afeb16` | `2026-11-18T10:00:04.192607Z` | `2026-11-19T04:58:23.557971Z` | `tests/phase5-channels-retention.test.ts` (`T5.1/T5.2b`) |
| `marketing_consents/01711223344` | `2026-11-19T04:58:23.459470Z` | `2026-11-19T04:58:23.459470Z` | `tests/phase5-channels-retention.test.ts` (`T5.1/T5.2b` STOP) |
| `marketing_consents/01811000501` | `2026-11-19T04:58:24.153993Z` | `2026-11-19T04:58:24.153993Z` | `tests/phase5-channels-retention.test.ts` (`T5.3` opt-in) |
| `marketing_consents/01811000502` | `2026-11-19T04:58:24.530472Z` | `2026-11-19T04:58:24.530472Z` | `tests/phase5-channels-retention.test.ts` (`T5.3` unsubscribe) |
| `marketing_consents/01711888999` | `2026-11-19T04:57:48.796269Z` | `2026-11-19T05:04:20.457895Z` | `tests/stage1-p0-security.test.ts` (`S0-03` consent/unsubscribe) |
| `chatbot_cost_ledger/2026-11-19` | `2026-11-19T03:21:17.438186Z` | `2026-11-19T05:22:59.220361Z` | Live preview / chatbot runs (may include test turns) |
| `chatbot_cost_ledger/2026-11-18` | `2026-11-18T06:35:06.712554Z` | `2026-11-18T10:03:05.824988Z` | Pre-Stage-0 runs (`2026-11-18`) |

### 2. Confirmed ABSENT (Read-Only `GET` → HTTP `404`)
- `test/connection` (`404`)
- `chat_sessions/ch_msg_attribution_01`, `order_drafts/draft_ch_msg_attribution_01` (`404`)
- `order_tracking/DG-771234_01711888999`, `refill_reminders/DG-771234_01711888999` (`404`)
- `order_tracking/DG-88001_01711000111`, `order_tracking/DG-60001_01711000111`, `order_tracking/DG-50001_01711223344`, `refill_reminders/DG-50001_01711223344` (`404`)
- `marketing_consents/01811222333` (`404`)

### 3. Possible Additional Test Documents Not Directly Enumerable Without Admin `list`
Because `list` is `isAdmin()`-only on these collections and some IDs are random or time-bucketed, the owner can inspect (and decide whether to delete) the following in the Firebase Console:
- `chat_sessions/dg_<32hex>` and `order_drafts/draft_dg_<32hex>` (1–2 random IDs minted during `stage1-p0-security.test.ts` `S0-02` run at `2026-11-19T04:57–05:04Z`, containing `customerName: "Victim Customer"`, `phone: "01711000999"`).
- `channel_webhook_events/whatsapp_wamid_001` and `channel_webhook_events/whatsapp_wamid_stop_002` (admin-only `get`/`list`, written during `phase5-channels-retention.test.ts` `T5.1/T5.2b` at `2026-11-19T04:58Z`).
- `chatbot_logs/*` (1–2 random-ID logs from the `T5.1/T5.2b` WhatsApp turn `"500g Deshi Gee er dam koto? Amar number 01711223344"` at `2026-11-19T04:58Z`).
- `chatbot_rate_buckets/*` (time-windowed IP buckets for `203.0.113.30` / `unknown` from `2026-11-19T04:57–05:04Z`).
- Note on `T5.4` (`orderPost` for `Salma Begum`, `01911000601`): in `phase5-channels-retention.test.ts`, the test failed earlier on `T5.3` or `getOrderStorageMemoryStateForTests()!` — check `orders` in Firebase Console for any `customerName == "Salma Begum"` / `phone == "01911000601"` around `2026-11-19T04:58Z` just in case a single test order was committed before assertion failure.

---

## Section E — `order_tracking` & `orders` Investigation (`S0-13`, Added to `PENDING_BACKLOG.md`)

### 1. Which fields can an unauthenticated client update on `pending`/`confirmed` orders?

- **`order_tracking/{lookupId}` (`1550bd7:firestore.rules:947–951`):**
  On any `pending` or `confirmed` order, paired in a Firestore write batch with an `orders/{orderId}` update (so `getAfter(/orders/{orderNumber}).data.updatedAt == request.time`), an unauthenticated client who knows `{orderNumber}_{phone}` can update **7 fields**:
  1. `district`
  2. `deliveryZone`
  3. `deliveryFeeBdt`
  4. `totalBdt`
  5. `estimatedDelivery`
  6. `status` — **CRITICAL BUG:** The rule does **NOT** check `incoming().status == getAfter(/orders/{orderNumber}).data.status`! An attacker can batch a benign address update on `orders/{orderId}` with `status: 'delivered'` (or `'shipped'` / `'cancelled'`) on `order_tracking/{lookupId}`.
  7. `updatedAt`

- **EVEN MORE SEVERE — `orders/{orderId}` (`1550bd7:firestore.rules:915–923`):**
  The unauthenticated address-edit branch checks `existsAfter(/order_tracking/{orderId}_{existing().phone})` — which is **ALREADY true** for every existing order! Therefore, an attacker who **does NOT even know the customer's `phone`** (only a guessed `orderId` like `DG-10001`..`DG-99999`) can send a single unauthenticated `update` on `orders/{orderId}` for any `pending`/`confirmed` order and modify **8 fields**:
  1. `district`
  2. `area`
  3. `address` (**shipping address hijack!**)
  4. `deliveryZone`
  5. `deliveryFeeBdt` (**fee zeroing bug:** `matchesCanonicalStorePricing` at L167–189 only validates `subtotalBdt` & `unitPriceBdt` — it does **NOT** validate `deliveryFeeBdt` or `totalBdt == subtotalBdt + deliveryFeeBdt - discountBdt`, so an attacker can set `deliveryFeeBdt: 0` and reduce `totalBdt`!)
  6. `totalBdt`
  7. `estimatedDelivery`
  8. `updatedAt`

### 2. Can a guessable `{orderNumber}_{phone}` expose address / phone / status?

- **Fields stored in `order_tracking/{orderNumber}_{phone}` (`isValidOrderTracking`, L191–227) and directly readable via `allow get: if isValidId(lookupId)` (L929):**
  - **Exposed:** `orderNumber`, `status`, `paymentMethod`, `paymentStatus`, `reviewStatus`, `weight`, `qty`, `qty250g`/`500g`/`1kg`, `itemsSummary`, `subtotalBdt`, `deliveryFeeBdt`, `discountBdt`, `totalBdt`, `couponCode`, `deliveryZone`, `district`, `estimatedDelivery`, `courierPartner`, `consignmentId`, `courierTrackingUrl`, `dispatchedAtIso`, `updatedAt`.
  - **NOT stored in `order_tracking`** (kept in `isAdmin()`-only `orders/{orderId}`): full street `address`, `area`, `customerName`, `txnId`, `paymentProofData`, `note`, and a separate `phone` field.
- **Why this is STILL a P0 privacy/security vulnerability:**
  1. **Zero Firestore-level rate limit + guessable ID space (`DG-10001`..`DG-99999`):** Knowing a target's phone number allows rapid enumeration of sequential order numbers (`DG-XXXXX_{phone}`) directly against Firestore REST to discover **order `status`**, **`district`**, **spend (`totalBdt`)**, **`paymentStatus`**, **`consignmentId`**, and **`courierTrackingUrl`** (external courier tracking pages frequently display recipient name/area/address/phone).
  2. **Phone-to-order confirmation oracle:** Knowing an `orderNumber` lets an attacker probe candidate BD phone numbers directly against `order_tracking/{orderNumber}_{phone}` (`200` vs `404`) to confirm which phone placed that order — without hitting any server rate limit.
  3. **Remediation (Part of Admin SDK migration):** Lock `order_tracking` and `orders` to `isAdmin()`-only in `firestore.rules`, serve tracking strictly through a rate-limited server endpoint (`/api/orders/track`) with anti-enumeration delays/limits, and never allow direct client updates to `orders` or `order_tracking`.
