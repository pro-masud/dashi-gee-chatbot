# DESHI GEE — Complete ID-by-ID Closure Matrix (139 Master IDs)

**Date:** 2026-11-20  
**Scope:** Complete 1-to-1 mapping against `PENDING_BACKLOG.md` (`S0-01..S0-14`, `ATK-A..ATK-I`, `0-01..0-13`, `1-01..1-14`, `2-01..2-14`, `3-01..3-10`, `4-01..4-05`, `5-01..5-10`, `6-01..6-10`, `X-01..X-13`, `O-01..O-18`) plus `S1-01..S1-09` from `docs/SERVER_AUTH_AND_ADMIN_SDK_PLAN.md` (139 total rows; zero IDs dropped).

**Status Legend:**
- `Done` — Implemented and verified within its test label (`mock`/`static`) with no remaining code gap.
- `Partial` — Code/tests implemented in part or verified only in `mock`/`static`; live deploy, IAM, Emulator, or remaining routes/owner review still pending.
- `Open` — Not yet implemented or documented.
- `Blocked-owner` — Requires an explicit owner business decision, approval, IAM grant, Java host, or manual deployment action.
- `Blocked-credential` — Requires a real external API key, merchant sandbox, or provider account (`GEMINI_API_KEY`, SSLCommerz/bKash, Steadfast/Pathao/RedX, Meta/WhatsApp, SMS/email).

**Label Legend:** `mock` · `static` · `emulator` (pending Java 17+) · `live` · `n/a` (not yet verified / owner-only).

> **Note on Live Infrastructure:** Zero live deploys were executed (`firestore.rules`, Cloud Run, IAM, Secret Manager untouched). Any item whose closure depends on deploying `docs/rules-proposals/firestore-final-admin-sdk.rules` or running the Firestore Emulator is marked `Partial` or `Blocked-owner`, never `Done`.

---

## Stage 0 Security Audit Findings (`S0-01`–`S0-14`)

| ID | V5 Stage Map | Status | Test Name or File (Evidence) | Label |
|---|---|---|---|---|
| S0-01 | Stage 0 | Done | `tests/stage1-p0-security.test.ts` — `S0-01: public/assets/aistudio does not exist and no internal markdown/spec/backlog docs are inside public/` | `static` |
| S0-02 | Stage 2 | Partial | API hardened (`tests/stage1-p0-security.test.ts` — `S0-02: /api/chat/session requires signed HttpOnly cookie ownership...`); rules locked in `docs/rules-proposals/firestore-final-admin-sdk.rules` (`tests/emulator/firestore-rules-final.test.ts`), **NOT deployed** & Emulator pending Java | `mock` / `static` (`emulator` pending) |
| S0-03 | Stage 2 | Partial | API hardened (`tests/stage1-p0-security.test.ts` — `S0-03: marketing_consents & refill_reminders are server-only...`); rules locked in `docs/rules-proposals/firestore-final-admin-sdk.rules`, **NOT deployed** & Emulator pending Java | `mock` / `static` (`emulator` pending) |
| S0-04 | Stage 5 | Partial | Code hardened (`tests/stage1-p0-security.test.ts` — `S0-04`; `tests/stage5-integrations.test.ts` — `stage5_1_payment_provider_lifecycle_and_ipn`); Admin SDK wired in `src/lib/server/adminRepository.ts`; live sandbox & IAM pending | `mock` (`live` pending) |
| S0-05 | Stage 0 / 2 | Done | `tests/stage1-p0-security.test.ts` — `S0-05: /api/orders/notify rejects client x-requested-with...` & `S0-05 (Storefront Server Checkout)` | `mock` |
| S0-06 | Stage 0 | Done | `tests/stage1-p0-security.test.ts` — `S0-06: /api/integrations/status and /api/notifications/status are admin-only...` | `mock` |
| S0-07 | Stage 5 | Partial | `tests/stage1-p0-security.test.ts` — `S0-07: Courier booking is idempotent...`; `tests/stage5-integrations.test.ts` — `stage5_2_courier_provider_and_4_04_url_allowlist`; live Steadfast/Pathao/RedX sandbox credentials & IAM pending | `mock` (`live` pending) |
| S0-08 | Stage 0 / 4 | Done | `tests/stage1-p0-security.test.ts` — `S0-08: /api/chat/tts rejects missing/mismatched ttsToken (403)...` | `mock` |
| S0-09 | Stage 1 | Done | `tests/stage1-p0-security.test.ts` — `S0-09: DRAFT claim templates are excluded from active chatbot claims...` | `static` |
| S0-10 | Stage 4 | Done | `tests/stage1-p0-security.test.ts` — `S0-10: /track is excluded from robots.ts and sitemap.ts...`; `tests/stage4-ui-admin.test.ts` — `stage4_seo_jsonld_owner_confirmed_gate` | `mock` / `static` |
| S0-11 | Stage 5 | Partial | `tests/stage1-p0-security.test.ts` — `S0-11: /api/channels/webhook blocks prompt injection...`; live Meta app credentials pending (`5-03`/`5-04`) | `mock` (`live` pending) |
| S0-12 | Stage 5 | Done | `tests/stage1-p0-security.test.ts` — `S0-12: BulkSMSBD sends credentials in POST form body...`; `tests/stage5-integrations.test.ts` — `stage5_3_4_5_messaging_and_refill_guards` | `mock` / `static` |
| S0-13 | Stage 2 | Partial | Final rules lock `orders` & `order_tracking` to `isAdmin()`-only (`docs/rules-proposals/firestore-final-admin-sdk.rules`, `tests/emulator/firestore-rules-final.test.ts` — `verifies rules proposal file exists...`); tracking uses 192-bit token (`tests/stage2-admin-sdk-invariants.test.ts` — `d14_tracking_token_192bit_and_uniform_404`). **NOT deployed** & Emulator pending Java | `mock` / `static` (`emulator` pending) |
| S0-14 | Stage 0 / 2 | Done | `tests/stage1-p0-security.test.ts` — `S0-14: Fail-closed test guard throws LiveFirestoreWriteBlockedInTestError...` & `Production Guard: refuses to run and logs [SECURITY_FATAL]...` + live-process probe exit 1 | `mock` / `live-process` |

---

## Public-Key Attack Matrix (`ATK-A`–`ATK-I`)

| ID | V5 Stage Map | Status | Test Name or File (Evidence) | Label |
|---|---|---|---|---|
| ATK-A | Stage 2 | Partial | Server Admin SDK transaction in `src/lib/server/adminRepository.ts`; `orders` locked to `isAdmin()` in `docs/rules-proposals/firestore-final-admin-sdk.rules` (`tests/stage2-admin-sdk-invariants.test.ts` — `zero_public_key_firestore_writes`). Live closure requires rules deploy + Emulator | `static` (`emulator` / `live` pending) |
| ATK-B | Stage 2 | Partial | `chatbot_rate_buckets` locked to `isAdmin()` in `docs/rules-proposals/firestore-final-admin-sdk.rules` (`tests/emulator/firestore-rules-final.test.ts`). Live closure requires rules deploy + Emulator | `static` (`emulator` / `live` pending) |
| ATK-C | Stage 2 | Partial | `chatbot_cost_ledger` locked to `isAdmin()` in `docs/rules-proposals/firestore-final-admin-sdk.rules` (`tests/emulator/firestore-rules-final.test.ts`). Live closure requires rules deploy + Emulator | `static` (`emulator` / `live` pending) |
| ATK-D | Stage 2 | Partial | `order_audit_logs` locked to `isAdmin()` in `docs/rules-proposals/firestore-final-admin-sdk.rules` (`tests/emulator/firestore-rules-final.test.ts`). Live closure requires rules deploy + Emulator | `static` (`emulator` / `live` pending) |
| ATK-E | Stage 2 | Partial | `payment_gateway_events` locked to `isAdmin()` in `docs/rules-proposals/firestore-final-admin-sdk.rules` (`tests/emulator/firestore-rules-final.test.ts`). Live closure requires rules deploy + Emulator | `static` (`emulator` / `live` pending) |
| ATK-F | Stage 2 | Partial | `marketing_consents` locked to `isAdmin()` in `docs/rules-proposals/firestore-final-admin-sdk.rules` (`tests/emulator/firestore-rules-final.test.ts`). Live closure requires rules deploy + Emulator | `static` (`emulator` / `live` pending) |
| ATK-G | Stage 2 | Partial | `chat_sessions` & `order_drafts` locked to `isAdmin()` in `docs/rules-proposals/firestore-final-admin-sdk.rules` (`tests/stage1-p0-security.test.ts` — `S0-02`; `tests/emulator/firestore-rules-final.test.ts`). Live closure requires rules deploy + Emulator | `mock` / `static` (`emulator` / `live` pending) |
| ATK-H | Stage 2 | Partial | `support_evidence` locked to `isAdmin()` in `docs/rules-proposals/firestore-final-admin-sdk.rules`; API magic-byte check in `tests/chatbot-phase3.test.ts` (`T3.1a`). Live closure requires rules deploy + Emulator | `mock` / `static` (`emulator` / `live` pending) |
| ATK-I | Stage 1 / 2 | Blocked-owner | Code defaults strictly `unset` (`tests/stage1-truthful-storefront.test.ts` — `ui_hides_unset_store_values`) and final rules drop hardcoded fallbacks; owner must seed `store_settings/main` in `/admin` and deploy final rules | `mock` / `static` (`live` pending owner) |

---

## Admin SDK Migration Slices (`S1-01`–`S1-09` from `docs/SERVER_AUTH_AND_ADMIN_SDK_PLAN.md`)

| ID | V5 Stage Map | Status | Test Name or File (Evidence) | Label |
|---|---|---|---|---|
| S1-01 | Stage 2 | Partial | `chat_sessions` server-only via Admin SDK (`src/lib/server/adminRepository.ts`) + signed cookie (`tests/stage1-p0-security.test.ts` — `S0-02`) + locked rules proposal; Emulator + deploy pending | `mock` / `static` (`emulator` pending) |
| S1-02 | Stage 2 | Partial | `order_drafts` server-only via Admin SDK (`src/lib/server/adminRepository.ts`) + signed cookie (`tests/stage1-p0-security.test.ts` — `S0-02`) + locked rules proposal; Emulator + deploy pending | `mock` / `static` (`emulator` pending) |
| S1-03 | Stage 2 | Partial | `refill_reminders` server-only via Admin SDK + order+phone verification (`tests/ui-ux-hardening.test.ts` — `GET /api/orders/refill-reminder...`; `tests/chatbot-phase3.test.ts` — `T3.3`) + locked rules proposal; Emulator + deploy pending | `mock` / `static` (`emulator` pending) |
| S1-04 | Stage 2 | Partial | `marketing_consents` server-only via Admin SDK + phone ownership proof (`tests/stage1-p0-security.test.ts` — `S0-03`) + locked rules proposal; Emulator + deploy pending | `mock` / `static` (`emulator` pending) |
| S1-05 | Stage 2 | Partial | `chatbot_cost_ledger` & `chatbot_rate_buckets` atomic Admin SDK writes (`src/lib/server/adminRepository.ts`) + locked rules proposal; Emulator + deploy pending | `mock` / `static` (`emulator` pending) |
| S1-06 | Stage 2 / 3 | Partial | `chatbot_used_tokens`, `chatbot_order_idempotency`, `order_fingerprints` atomic in `adminDb.runTransaction()` (`tests/stage3-order-gate.test.ts` — `stock_decrement_order_token_tracking_atomic`) + locked rules proposal; Emulator + deploy pending | `mock` / `static` (`emulator` pending) |
| S1-07 | Stage 2 / 3 | Partial | `orders`, `order_tracking`, `store_settings/main`, `coupons`, `order_audit_logs` atomic in `adminDb.runTransaction()` (`tests/stage3-order-gate.test.ts`; `tests/stage2-admin-sdk-invariants.test.ts` — `d5_fail_closed_503_when_admin_sdk_unavailable`); IAM + Emulator + deploy pending | `mock` / `static` (`emulator` / `live` pending) |
| S1-08 | Stage 2 / 5 | Partial | `payment_gateway_events` & `channel_webhook_events` server-only via Admin SDK + locked rules proposal; Emulator + deploy pending | `mock` / `static` (`emulator` pending) |
| S1-09 | Stage 2 | Partial | `support_evidence`, `chatbot_logs`, `chatbot_feedback`, `chatbot_support_requests`, `order_review_claims`, `reviews`, `subscribers` via Admin SDK (`app/api/reviews/route.ts`, `app/api/reviews/helpful/route.ts`, `app/api/newsletter/route.ts`) + locked rules proposal; Emulator + deploy pending | `mock` / `static` (`emulator` pending) |

---

## Phase 0 — Foundation (`0-01`–`0-13`)

| ID | V5 Stage Map | Status | Test Name or File (Evidence) | Label |
|---|---|---|---|---|
| 0-01 | Stage 0 | Done | `tests/chatbot-runtime-health.test.ts` — `GET /api/health returns minimal redacted liveness payload...` & `GET /api/health?refresh=1 rate-limits excessive admin refresh probes with HTTP 429` | `mock` |
| 0-02 | Stage 4 / 5 | Blocked-credential | Model allowlist & config validated statically (`tests/chatbot-runtime-health.test.ts`, `tests/stage4-ui-admin.test.ts` — `d20_gemini4_thinking_level_low_no_budget`), but live Google Models List API check requires real `GEMINI_API_KEY` | `static` (`live` pending key) |
| 0-03 | Stage 5 | Done | `tests/stage5-integrations.test.ts` — `stage5_6_gemini_failover_auth_retirement_cost_table` (`GEMINI_MODEL_COST_RATES_JSON` + env rate overrides in `src/lib/gemini/client.ts`) | `mock` |
| 0-04 | Stage 5 | Done | `tests/stage5-integrations.test.ts` — `stage5_6_gemini_failover_auth_retirement_cost_table` (`classifyGeminiError` flags 404 with `adminAlertCode: 'gemini_model_retired'`) | `mock` |
| 0-05 | Stage 5 / 7 | Done | Env-only model rollback documented in `docs/RUNBOOK_OPERATIONS.md`, `docs/DEPLOY_RUNBOOK.md`, and verified in `tests/stage5-integrations.test.ts` (`GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL`) | `static` |
| 0-06 | Stage 5 | Blocked-credential | Mock failover verified (`tests/chatbot-runtime-health.test.ts` — `POST /api/chat streaming fails over cleanly...`; `tests/stage5-integrations.test.ts`), but live forced-failover smoke test requires real `GEMINI_API_KEY` | `mock` (`live` pending key) |
| 0-07 | Stage 0 / 3 | Done | `tests/chatbot-phase0-guards.test.ts` — `T0.2` (tamper, expiry, missing secret 503) & `T0.5` (tool round cap + dedupe); `tests/stage3-order-gate.test.ts` — `token_replay_rejected` | `mock` |
| 0-08 | Stage 1 / 3 | Done | Documented in `DECISIONS_MADE.md` (coupon amounts strictly server/tool-grounded via `validate_coupon` / `computeOrderPricingInPoisha`) & verified in `tests/chatbot-phase0-guards.test.ts` (`T0.6 & T0.7`) | `mock` / `static` |
| 0-09 | Stage 1 / 4 | Done | Admin-editable rate limits in `ChatbotConfigDoc` (`src/lib/chatbot/types.ts`, `src/components/AdminChatbotPanel.tsx`); session draft persistence in `tests/chatbot-phase1.test.ts` (`Session lockedLang persists across turns...`) | `mock` / `static` |
| 0-10 | Stage 2 | Done | Atomic `FieldValue.increment` in `src/lib/server/adminRepository.ts` (`incrementDailyCostLedgerAdmin`); concurrency guard tested in `tests/chatbot-phase0-guards.test.ts` (`T0.12`) | `mock` / `static` |
| 0-11 | Stage 2 / 7 | Blocked-owner | 25-case Emulator suite prepared at `tests/emulator/firestore-rules-final.test.ts` (`npm run test:rules` static pass); Emulator run skipped (`PENDING_EMULATOR`) — Java 17+ not installed in container | `static` (`emulator` pending Java) |
| 0-12 | Stage 4 / 6 | Partial | Admin failure-code breakdown & F22 queue exist in `src/components/AdminChatbotPanel.tsx`; live production log review requires live traffic + Admin SDK read access | `static` (`live` pending) |
| 0-13 | Stage 4 | Blocked-credential | Root cause addressed (`ThinkingLevel.LOW`, no `thinkingBudget`, tools omitted on greeting — `tests/chatbot-runtime-health.test.ts`, `tests/stage4-ui-admin.test.ts`, `scripts/latency-benchmark.ts`), but mock latency (`p50=5.5ms`) is **not meaningful**; live p50/p95 requires `GEMINI_API_KEY` | `mock` (`live` pending key) |

---

## Phase 1 — Reliable Answers (`1-01`–`1-14`)

| ID | V5 Stage Map | Status | Test Name or File (Evidence) | Label |
|---|---|---|---|---|
| 1-01 | Stage 6 | Done | `src/lib/chatbot/responseContract.ts` (`StructuredChatTurnContract`, `buildStructuredChatTurnContract`) wired into `app/api/chat/route.ts` `meta.contract`; verified in `tests/chatbot-regression-50.test.ts` — `Case #70 (T1.6 Structured Response Contract)` | `mock` |
| 1-02 | Stage 6 | Blocked-credential | `src/lib/chatbot/hybridRag.ts` blends deterministic 128-dim fallback with `gemini-embedding-2` call (`generateLiveGeminiEmbedding`), but live `gemini-embedding-2` availability/cost/quota/retention and KB batch-embedding are unverified without `GEMINI_API_KEY` | `static` (`live` pending key) |
| 1-03 | Stage 6 | Blocked-owner | Automated retrieval benchmark passes on curated queries (`tests/chatbot-phase1.test.ts` — `Hybrid RAG achieves >= 90% top-3 relevance...`), but ≥50 **real owner/customer questions** require owner input (`O-05`) | `mock` (`live` pending owner) |
| 1-04 | Stage 6 | Done | `tests/chatbot-regression-50.test.ts` — mixed in/off-domain & `Case #67 (Mixed Pricing + Delivery Question)` | `mock` |
| 1-05 | Stage 1 / 6 | Done | Default `languageBehavior: 'bangla_script'` (D1) in `tests/stage1-truthful-storefront.test.ts`; 6 modes in `tests/chatbot-phase1.test.ts`; Banglish variants in `tests/chatbot-regression-50.test.ts` (`Case #68`) | `mock` |
| 1-06 | Stage 1 / 6 | Done | Explicit state machine (`collecting_details → quote_ready → awaiting_confirmation → confirmed/expired/cancelled`) in `src/lib/chatbot/types.ts` + `app/api/chat/route.ts`; correction verified in `tests/chatbot-regression-50.test.ts` (`Case #64`) | `mock` |
| 1-07 | Stage 1 / 2 | Partial | Tool telemetry & chat turn logs record `toolsUsed`, outcome, and errors in `chatbot_logs` (`src/lib/chatbot/firestoreRest.ts`); dedicated per-tool `agent_audit_logs` collection with `argumentsHash` is NOT separately provisioned | `static` |
| 1-08 | Stage 1 / 6 | Done | `tests/chatbot-phase1.test.ts` — `/api/chat streams real progressive deltas safely on prose craft turns AND blocks unapproved claims mid-stream`; `tests/chatbot-regression-50.test.ts` — `Case #66 (Streaming Claim Blocker)` | `mock` |
| 1-09 | Stage 4 | Done | `src/components/AdminChatbotPanel.tsx` queues unanswered, fallback, guard-blocked & negative-feedback turns + runnable `handleExportRegressionJson` (`Export Regression JSON`) | `static` |
| 1-10 | Stage 4 | Done | Order Summary card Edit + Confirm + expiry + welcome chips in `src/components/chatbot/ChatPanel.tsx` & `ChatMessageBubble.tsx`; verified in `tests/stage4-ui-admin.test.ts` & `tests/ui-ux-hardening.test.ts` | `static` |
| 1-11 | Stage 4 / 5 | Done | Deduplicated 6-stage funnel, AOV, variant mix, spend, channel split in `app/api/analytics/attribution/route.ts` & `src/components/AdminChatbotPanel.tsx`; verified in `tests/phase5-channels-retention.test.ts` (`T5.4/T5.5/T5.6`) | `mock` |
| 1-12 | Stage 4 | Partial | Admin Playground in `src/components/AdminChatbotPanel.tsx` runs curated draft prompt batch; running the full 72-case Node test suite from browser UI is not wired (runs via CLI `npm run test:chatbot`) | `static` |
| 1-13 | Stage 1 / 4 | Blocked-owner | Code enforces draft-only (`active: false, published: false`, `"Draft starter pack — owner review required"`, `sourceRef` on every entry — `tests/stage1-truthful-storefront.test.ts` & `tests/stage4-ui-admin.test.ts`); owner must review & approve before publishing | `static` (owner review pending) |
| 1-14 | Stage 6 | Done | `tests/chatbot-regression-50.test.ts` expanded to **72/72 pass** (`Case #63`–`Case #70`: language switch, multi-slot edit, session resume, streaming claim blocker, mixed pricing+delivery, Banglish, damaged jar, T1.6 contract) | `mock` |

---

## Phase 2 — Order Agent (`2-01`–`2-14`)

| ID | V5 Stage Map | Status | Test Name or File (Evidence) | Label |
|---|---|---|---|---|
| 2-01 | Stage 3 | Done | `tests/stage3-order-gate.test.ts` — `stage3_extras_max_jars_d13_typo_d12_paid_cancel_cod_threshold` (max 10 jars across mixed variants, privacy/confirm/track flow); `tests/stage1-p0-security.test.ts` (`S0-05` owner notification) | `mock` |
| 2-02 | Stage 3 | Done | `tests/stage3-order-gate.test.ts` — `retry_creates_one_order`, `double_click_one_order`, `token_replay_rejected`, `typed_yes_creates_no_order`, `concurrent_last_unit_one_winner`, `stale_price_409_with_fresh_token` | `mock` |
| 2-03 | Stage 2 / 3 | Done | `tests/stage3-order-gate.test.ts` — `stock_decrement_order_token_tracking_atomic` & `src/lib/server/adminRepository.ts` (`adminDb.runTransaction`) | `mock` |
| 2-04 | Stage 3 | Done | `tests/chatbot-regression-50.test.ts` — `Case #60 (Zone Typo Clarification)`; `tests/stage3-order-gate.test.ts` — `stage3_extras_max_jars_d13_typo_d12_paid_cancel_cod_threshold` | `mock` |
| 2-05 | Stage 3 | Done | Area/thana collection & address completeness validation in `src/lib/chatbot/orderToken.ts` (`assessAddressCompleteness`), enforced in `app/api/orders/storefront/route.ts` & `tests/chatbot-phase2.test.ts` (`T2.3`) | `mock` |
| 2-06 | Stage 2 / 3 | Done | Duplicate order flags `reviewStatus` rather than hard-blocking (`tests/chatbot-phase2.test.ts` — `T2.3`); keyed HMAC fingerprints verified in `tests/stage2-admin-sdk-invariants.test.ts` (`d16_keyed_hmac_channel_session_and_fingerprints`) | `mock` |
| 2-07 | Stage 1 | Partial | All agent-chosen zone fees, ETAs & dispatch cutoff defaults removed (`tests/stage1-truthful-storefront.test.ts` — `ui_hides_unset_store_values`); 4-zone Admin UI ready in `src/components/AdminDashboardView.tsx`; owner must enter real values (`O-04`) | `mock` / `static` (owner input pending) |
| 2-08 | Stage 3 | Done | `tests/stage3-order-gate.test.ts` — `coupon_usage_cap_atomic`; `tests/chatbot-phase2.test.ts` — `T2.4` (expired / inactive / min spend / cap reached reason messages) | `mock` |
| 2-09 | Stage 3 | Done | `tests/chatbot-phase2.test.ts` — `T2.5: Honest UnconfiguredCodVerificationProvider & transparent fraud signal manual_review queueing`; `tests/stage3-order-gate.test.ts` (`codHighValueThresholdBdt` / `codRiskThresholdScore` admin-configurable) | `mock` |
| 2-10 | Stage 3 | Partial | Chat cancel/address-change require Order ID + phone check AND signed single-use Confirm click, never triggered by plain text or prompt injection (`tests/chatbot-regression-50.test.ts` — `Case #58`, `Case #59`, `Case #61`, `Case #62`). Remains Partial pending owner approval of bKash/Nagad refund wording (`O-11`) & live Admin SDK IAM | `mock` (`live` / owner pending) |
| 2-11 | Stage 3 | Partial | Code blocks automatic refund promises & routes paid-order cancellations to human handover (`tests/stage3-order-gate.test.ts` — `stage3_extras_max_jars_d13_typo_d12_paid_cancel_cod_threshold`; `tests/chatbot-phase3.test.ts` — `T3.1d`); owner approval of exact wording pending (`O-11`) | `mock` (owner wording pending) |
| 2-12 | Stage 2 | Blocked-owner | `order_audit_logs` locked to `isAdmin()`-only (append-only server writes) in `docs/rules-proposals/firestore-final-admin-sdk.rules` (`tests/emulator/firestore-rules-final.test.ts`); Emulator run pending Java 17+ | `static` (`emulator` pending Java) |
| 2-13 | Stage 6 | Done | `tests/chatbot-regression-50.test.ts` expanded from 56 → **72 passing cases** including stock, price change, duplicate, cancel, address edit, zone typo, two-step Confirm cards, multi-slot edit | `mock` |
| 2-14 | Stage 1 / 3 | Done | Tool catalog schema & no-direct-order-creation invariant in `src/lib/gemini/tools.ts`, verified by `tests/stage3-order-gate.test.ts` (`typed_yes_creates_no_order`) & `tests/chatbot-phase2.test.ts` (`T2.6`) | `mock` / `static` |

---

## Phase 3 — Post-Purchase (`3-01`–`3-10`)

| ID | V5 Stage Map | Status | Test Name or File (Evidence) | Label |
|---|---|---|---|---|
| 3-01 | Stage 0 / 2 | Done | Order ID + phone verification enforced on `/api/orders/reorder`, `/api/orders/review`, `/api/orders/refill-reminder` (`tests/chatbot-phase3.test.ts` — `T3.3`; `tests/ui-ux-hardening.test.ts` — `GET /api/orders/refill-reminder...`) | `mock` |
| 3-02 | Stage 3 / 6 | Done | Quality/safety complaint triage & policy-grounded non-promissory refund handling in `src/lib/chatbot/supportEngine.ts`, verified in `tests/chatbot-phase3.test.ts` (`T3.1d`, `T3.2`) & `tests/chatbot-regression-50.test.ts` (`Case #69`) | `mock` |
| 3-03 | Stage 3 | Done | `tests/chatbot-phase3.test.ts` — `T3.2: enforces ticket consent + order verification, auto-pauses AI on Admin claim, delivers live agent replies, and auto-resumes AI on resolve` | `mock` |
| 3-04 | Stage 2 | Blocked-owner | `support_evidence` locked to `isAdmin()`-only in `docs/rules-proposals/firestore-final-admin-sdk.rules` + API GET admin-only (`tests/chatbot-phase3.test.ts` — `T3.1a`); Emulator test pending Java 17+ | `mock` / `static` (`emulator` pending Java) |
| 3-05 | Stage 5 | Done | `tests/phase5-channels-retention.test.ts` — `T5.3: Enforces customer consent, instant unsubscribe suppression, Asia/Dhaka quiet hours (22:00-08:00), and 72h frequency cap...`; `tests/stage5-integrations.test.ts` — `stage5_3_4_5_messaging_and_refill_guards` | `mock` / `static` |
| 3-06 | Stage 6 | Done | Phase 3 conversations included in `tests/chatbot-regression-50.test.ts` (72/72 pass, including `Case #69` damaged jar, payment dispute, late delivery, human handover, refund claim) | `mock` |
| 3-07 | Stage 1 / 3 | Done | Delay check reads owner-confirmed zone ETA windows from `store_settings/main` (no hardcoded promises when unset) in `src/lib/chatbot/supportEngine.ts` (`tests/chatbot-phase3.test.ts` — `T3.1c`) | `mock` |
| 3-08 | Stage 2 | Partial | `/api/chat/session` enforces ≥128-bit ID + signed HttpOnly cookie + rate limit + hidden/idle poll pause (`tests/stage1-p0-security.test.ts` — `S0-02`); locked rules proposal pending Emulator & deploy | `mock` (`emulator` / `live` pending) |
| 3-09 | Stage 4 | Done | Admin-only formula-injection-safe CSV export (`tests/phase4-operations.test.ts` — `T4.3: Computes accurate Support SLA analytics and exports formula-injection-safe Orders & Support CSVs`) | `mock` |
| 3-10 | Stage 5 | Done | Refill webhook dispatch verified in `tests/phase4-operations.test.ts` (`T4.2`) & `tests/stage5-integrations.test.ts` (`stage5_3_4_5_messaging_and_refill_guards`) | `mock` / `static` |

---

## Phase 4 — Payments & Courier APIs (`4-01`–`4-05`)

| ID | V5 Stage Map | Status | Test Name or File (Evidence) | Label |
|---|---|---|---|---|
| 4-01 | Stage 5 | Partial | `PaymentProvider` interface + mock provider + `"Not configured"` (`503`) + SSLCommerz/bKash IPN & validation hardened (`tests/stage5-integrations.test.ts` — `stage5_1_payment_provider_lifecycle_and_ipn`; `tests/stage1-p0-security.test.ts` — `S0-04`). Live merchant sandbox credentials pending | `mock` (`live` pending credentials) |
| 4-02 | Stage 5 | Partial | `CourierProvider` interface + mock provider + Steadfast/Pathao/RedX idempotent booking & fail-closed webhooks (`tests/stage5-integrations.test.ts` — `stage5_2_courier_provider_and_4_04_url_allowlist`; `tests/stage1-p0-security.test.ts` — `S0-07`). Live courier sandbox credentials pending | `mock` (`live` pending credentials) |
| 4-03 | Stage 5 | Done | Full 8-state `PAYMENT_LIFECYCLE_STATES` + `derivePaymentLifecycleState` (`src/lib/integrations/paymentGateway.ts`, `tests/stage5-integrations.test.ts` — `stage5_1_payment_provider_lifecycle_and_ipn`) + Admin review & audit UI in `src/components/AdminDashboardView.tsx` | `mock` / `static` |
| 4-04 | Stage 5 | Done | Strict HTTPS allowlist (`isSafeCourierTrackingUrl`, `sanitizeCourierTrackingUrl`) rejecting `javascript:`, `http:`, and non-allowlisted domains (`tests/stage5-integrations.test.ts` — `stage5_2_courier_provider_and_4_04_url_allowlist`; `tests/stage2-admin-sdk-invariants.test.ts` — `d14_tracking_token_192bit_and_uniform_404`) | `mock` |
| 4-05 | Stage 0 | Done | `package.json` `start` uses `next start` directly; `scripts/next-cli.mjs` restricts port cleanup to `dev` only (`tests/ui-ux-hardening.test.ts` — `4-05 production start script uses next start directly...`) | `static` |

---

## Phase 5 — Channels, Retention & Attribution (`5-01`–`5-10`)

| ID | V5 Stage Map | Status | Test Name or File (Evidence) | Label |
|---|---|---|---|---|
| 5-01 | Stage 0 | Done | Baseline & final lint/test/chatbot/build suite + Phase 5–6 reality audit (`docs/EVIDENCE/baseline.txt`, `docs/EVIDENCE/final.txt`) | `mock` / `static` |
| 5-02 | Stage 3 | Done | `app/api/order/route.ts` audited and covered by full Stage 3 Order Gate (`tests/stage3-order-gate.test.ts` — 9/9 pass: retry, double-click, replay, stock race, stale price 409, atomic commit) | `mock` |
| 5-03 | Stage 5 | Partial | Meta Messenger/Instagram webhook HMAC `X-Hub-Signature-256`, replay dedupe, per-sender rate limit, shared guards (`tests/phase5-channels-retention.test.ts` — `T5.1/T5.2a`, `T5.1/T5.2b`; `tests/stage1-p0-security.test.ts` — `S0-11`). Live Meta app credentials pending | `mock` (`live` pending credentials) |
| 5-04 | Stage 5 | Open | WhatsApp webhook code & phone-verified linking exist (`tests/phase5-channels-retention.test.ts` — `T5.1/T5.2b`), **but formal dated verification of current official Meta WhatsApp Business API policy (with date + official source URLs) has NOT been written**, and live Meta/WhatsApp credentials are pending | `mock` (policy doc Open; `live` pending credentials) |
| 5-05 | Stage 5 | Done | Consent, suppression, Dhaka quiet hours, 72h cap, admin/CRON auth (`tests/phase5-channels-retention.test.ts` — `T5.3`; `tests/stage1-p0-security.test.ts` — `S0-03`) | `mock` |
| 5-06 | Stage 4 | Done | `app/robots.ts` & `app/sitemap.ts` exclude `/admin`, `/api`, `/track`; JSON-LD gated on `ownerConfirmed` (`tests/stage1-p0-security.test.ts` — `S0-10`; `tests/stage4-ui-admin.test.ts` — `stage4_seo_jsonld_owner_confirmed_gate`) | `mock` / `static` |
| 5-07 | Stage 5 / 6 | Done | 6-stage deduplicated funnel & channel attribution (`tests/phase5-channels-retention.test.ts` — `T5.4/T5.5/T5.6`) | `mock` |
| 5-08 | Stage 4 / 5 | Done | Shared omnichannel inbox UI (`AdminChatbotPanel.tsx`), phone-verified identity linking & AI pause/resume (`tests/chatbot-phase3.test.ts` — `T3.2`; `tests/phase5-channels-retention.test.ts` — `T5.1/T5.2b`) | `mock` / `static` |
| 5-09 | Stage 4 | Partial | Optional P3 features: voice/TTS gated OFF by default (D15), SMS/email adapters built (unconfigured without keys), UCP/ACP deferred to `FUTURE_IDEAS.md` | `static` |
| 5-10 | Stage 2 / 7 | Blocked-owner | Root `firestore.rules` frozen & untouched; hardened rules staged at `docs/rules-proposals/firestore-final-admin-sdk.rules`; zero deploys executed; awaiting Java 17+ Emulator run + written owner approval | `static` (`emulator` & approval pending) |

---

## Phase 6 — Integrations Audit (`6-01`–`6-10`)

| ID | V5 Stage Map | Status | Test Name or File (Evidence) | Label |
|---|---|---|---|---|
| 6-01 | Stage 5 | Blocked-credential | SSLCommerz + bKash code audited & unit-tested (`tests/stage1-p0-security.test.ts` — `S0-04`; `tests/phase6-integrations-tts.test.ts`; `tests/stage5-integrations.test.ts` — `stage5_1_payment_provider_lifecycle_and_ipn`); live sandbox testing blocked on merchant credentials | `mock` (`live` pending credentials) |
| 6-02 | Stage 5 | Blocked-credential | Steadfast / Pathao / RedX code audited & unit-tested (`tests/stage1-p0-security.test.ts` — `S0-07`; `tests/phase6-integrations-tts.test.ts`; `tests/stage5-integrations.test.ts` — `stage5_2_courier_provider_and_4_04_url_allowlist`); live sandbox testing blocked on courier credentials | `mock` (`live` pending credentials) |
| 6-03 | Stage 5 | Partial | BulkSMSBD POST body, secret redaction, quiet hours, consent & status auth verified (`tests/stage1-p0-security.test.ts` — `S0-12`; `tests/phase6-integrations-tts.test.ts`; `tests/stage5-integrations.test.ts` — `stage5_3_4_5_messaging_and_refill_guards`); live provider credentials pending | `mock` / `static` (`live` pending credentials) |
| 6-04 | Stage 4 / 5 | Done | `/api/chat/tts` signed token, rate limit, length cap, cost ledger & D15 OFF-by-default gate (`tests/stage1-p0-security.test.ts` — `S0-08`; `tests/phase6-integrations-tts.test.ts`; `tests/stage4-ui-admin.test.ts` — `d15_voice_features_off_by_default`) | `mock` / `static` |
| 6-05 | Stage 4 | Done | Voice dictation gated OFF by default (D15), editable transcript before send, never auto-submits (`src/components/chatbot/ChatPanel.tsx`, `tests/stage4-ui-admin.test.ts` — `d15_voice_features_off_by_default`) | `static` |
| 6-06 | Stage 1 / 4 | Done | `+BSTI` / `+Lab PDF` templates create `draft` entries only and are stripped prior to publish (`tests/stage1-p0-security.test.ts` — `S0-09`) | `static` |
| 6-07 | Stage 4 / 5 | Blocked-credential | Timeouts & circuit breaker implemented (`src/lib/gemini/client.ts`); mock benchmark runs (`scripts/latency-benchmark.ts` — mock not meaningful); live p50/p95 requires `GEMINI_API_KEY` | `mock` (`live` pending key) |
| 6-08 | Stage 0 | Done | `/api/integrations/status` & `/api/notifications/status` admin-only with secret redaction (`tests/stage1-p0-security.test.ts` — `S0-06`, `S0-12`) | `mock` |
| 6-09 | Stage 0 / 2 | Blocked-owner | Rules frozen & diffed (`docs/FIRESTORE_RULES_DIFF_PROOF.md`, `docs/LIVE_FIRESTORE_RULES_SNAPSHOT.rules`); zero deploys run; Emulator run pending Java 17+ + owner approval | `static` (`emulator` pending Java) |
| 6-10 | Stage 5 | Done | Transient 429/5xx/timeout failover only; 401 & billing/key 403 set `shouldFailover: false` + `adminAlertCode: 'gemini_auth_failed'` (`tests/stage5-integrations.test.ts` — `stage5_6_gemini_failover_auth_retirement_cost_table`) | `mock` |

---

## Cross-Cutting Work (`X-01`–`X-13`)

| ID | V5 Stage Map | Status | Test Name or File (Evidence) | Label |
|---|---|---|---|---|
| X-01 | Stage 6 | Partial | High-level coverage matrix created at `docs/FEATURE_MATRIX.md` + this `docs/CLOSURE_MATRIX.md`; ranked file/function/line root-cause table from T0.0 is not separately written | `static` |
| X-02 | Stage 4 | Done | Admin Console (`AdminDashboardView.tsx` + `AdminChatbotPanel.tsx`) covers product/variants/inventory, 4-zone delivery rules, draft/publish policy & claims lifecycle, agent controls, staged draft/publish, and analytics | `static` |
| X-03 | — | Open | Standalone Part-7 mapping table (§A admin, §B data model, §C tool catalog, §D security, §E KPIs, §F QA, §G market research, §H Bangladesh rules, Acceptance criteria) has **NOT** been created yet | `n/a` |
| X-04 | Stage 0 / Post-7 | Done | `.git` re-initialized (`snapshot: stages 1-7`), `.gitignore` covers `.env*` (`!.env.example`) & `public/assets/aistudio/`, zero secrets tracked, one commit per item enforced | `static` |
| X-05 | — | Open | Architecture Mermaid diagrams (chat flow, order flow, payment flow, courier flow, handover flow) have **NOT** been created yet | `n/a` |
| X-06 | Stage 6 / 7 | Done | Operational docs complete: `docs/ADMIN_GUIDE.md`, `docs/RUNBOOK_OPERATIONS.md`, `docs/DEPLOY_RUNBOOK.md`, `docs/OWNER_DATA_TEMPLATE.md`, `docs/ADMIN_ROUTE_INVENTORY.md`, `docs/ENV_AND_SECRETS_CHECKLIST.md` | `static` |
| X-07 | — | Open | Market comparison research doc (dated sources separating official / independent / vendor claims) has **NOT** been created yet | `n/a` |
| X-08 | Stage 2 | Partial | `enforcePublicMutationGuards` (same-origin CSRF + optional Firebase App Check `APP_CHECK_ENFORCE=true` via `firebase-admin/app-check`) exists in `src/lib/server/requestSecurity.ts` and is wired on 4 routes (`/api/orders/track`, `/api/reviews`, `/api/reviews/helpful`, `/api/newsletter`), **but NOT yet wired on `/api/order`, `/api/orders/storefront`, `/api/orders/manage`, `/api/chat`, `/api/support/ticket`, `/api/support/evidence`, `/api/coupons/validate`, `/api/chatbot/feedback`**, and no CAPTCHA or live App Check site key is configured | `static` |
| X-09 | Stage 1 / 6 | Partial | Operational retention/incident notes in `docs/RUNBOOK_OPERATIONS.md`; policy drafts gated behind `NEXT_PUBLIC_ENABLE_POLICY_DRAFTS` (`docs/POLICY_REVIEW_LIST.md`); owner legal review pending (`O-16`) | `static` (owner legal review pending) |
| X-10 | Stage 7 | Blocked-owner | Cloud Run deployment architecture documented in `docs/DEPLOY_RUNBOOK.md`; final hosting/domain/HTTPS/authorized-domains decision & execution belong to the owner | `static` (owner action pending) |
| X-11 | Stage 2 | Done | Strict Admin RBAC (`verifyAdminIdTokenStrict` requiring `email_verified === true` + allowlist/`admins/{uid}`) mapped across all 35 routes in `docs/ADMIN_ROUTE_INVENTORY.md`; unverified-email spoof tested in `tests/stage2-admin-sdk-invariants.test.ts` (`d3_strict_admin_email_verified`) | `mock` / `static` |
| X-12 | Stage 6 / 7 | Partial | 100-concurrent mock load test passes (`scripts/load-test-chat.ts` — 100/100 ok, 0 errors); real phone + mobile-network test pending owner (`docs/REAL_DEVICE_CHECKLIST.md`) | `mock` (`live` pending devices) |
| X-13 | Stage 6 | Done | `npm run test:chatbot` expanded from 56 → 64 → **72 passing cases** (`tests/chatbot-regression-50.test.ts`); CI/pre-deploy command listed in `docs/DEPLOY_RUNBOOK.md` | `mock` |

---

## Owner Actions (`O-01`–`O-18`)

| ID | V5 Stage Map | Status | Test Name or File (Evidence) | Label |
|---|---|---|---|---|
| O-01 | `OA-04` | Blocked-owner | `OWNER_ACTIONS.md` / `docs/ENV_AND_SECRETS_CHECKLIST.md` — add test/prod `GEMINI_API_KEY` via `.env.local` or Secret Manager | `n/a` |
| O-02 | `OA-02` | Blocked-owner | `OWNER_ACTIONS.md` — run `firebase emulators:exec --only firestore "npm run test:rules"` on a Java 17+ host | `emulator` pending Java |
| O-03 | `OA-07` | Blocked-owner | `docs/OWNER_DATA_TEMPLATE.md` / `docs/POLICY_REVIEW_LIST.md` — confirm BSTI/lab/A2/organic claims, festival cutoffs, Maps URL | `n/a` |
| O-04 | `OA-07` | Blocked-owner | `docs/OWNER_DATA_TEMPLATE.md` — enter confirmed 4-zone fees, ETAs, dispatch cutoff, free-delivery threshold, max jars in `/admin` | `n/a` |
| O-05 | `OA-09` | Blocked-owner | `OWNER_ACTIONS.md` — provide 20–30 real customer Q&As for retrieval benchmark & KB | `n/a` |
| O-06 | `OA-04` | Blocked-owner | `docs/ENV_AND_SECRETS_CHECKLIST.md` — generate & store `ORDER_TOKEN_SECRET`, `TRACKING_TOKEN_SECRET`, `CHANNEL_SESSION_SECRET`, `GEMINI_API_KEY`, `CRON_SECRET` in Secret Manager | `n/a` |
| O-07 | `OA-04` | Blocked-owner | `OWNER_ACTIONS.md` — rotate any key ever shared in chat, zip, or repo | `n/a` |
| O-08 | `OA-08` | Blocked-owner | `docs/ADMIN_GUIDE.md` — assign support ticket / handover owner | `n/a` |
| O-09 | `OA-07` | Blocked-owner | `DECISIONS_MADE.md` (D1 defaults to `bangla_script`); owner confirms or changes in `/admin` | `n/a` |
| O-10 | `OA-07` | Blocked-owner | `OWNER_ACTIONS.md` — choose COD-verification provider (or keep off) & set high-value COD threshold | `n/a` |
| O-11 | `OA-08` | Blocked-owner | `docs/POLICY_REVIEW_LIST.md` — approve bKash/Nagad cancellation & refund wording | `n/a` |
| O-12 | `OA-08` | Blocked-owner | `OWNER_ACTIONS.md` — confirm Standard 2 h / Urgent 30 min business-hours SLA targets | `n/a` |
| O-13 | `OA-07` | Blocked-owner | `docs/OWNER_DATA_TEMPLATE.md` — replace `unset` contacts/payment numbers (`bkashNumber`, `nagadNumber`, `supportPhone`, `whatsappNumber`, `businessAddress`, `googleMapsUrl`) in `/admin` | `n/a` |
| O-14 | `OA-11` | Blocked-owner | `docs/DEPLOY_RUNBOOK.md` — configure Cloud Scheduler for refill dispatch (`CRON_SECRET`) & optional owner webhooks | `n/a` |
| O-15 | `OA-10` | Blocked-credential | `OWNER_ACTIONS.md` — obtain merchant/sandbox credentials for payment, courier & Meta/WhatsApp providers when ready | `n/a` |
| O-16 | `OA-08` | Blocked-owner | `docs/POLICY_REVIEW_LIST.md` — legal review of Privacy / Terms / Return drafts before setting `NEXT_PUBLIC_ENABLE_POLICY_DRAFTS` or publishing | `n/a` |
| O-17 | `OA-05` | Blocked-owner | `docs/DEPLOY_RUNBOOK.md` — confirm Cloud Run production hosting target, custom domain & Firebase authorized domains | `n/a` |
| O-18 | `OA-10` | Blocked-credential | `docs/ENV_AND_SECRETS_CHECKLIST.md` — provision gateway/SMS/email/Meta keys in Secret Manager (sandbox first) | `n/a` |

---

## Summary Counts (139 Total Master IDs — 0 Dropped)

- **Done (`mock` / `static` verified):** 62
- **Partial (code hardened; live deploy / IAM / Emulator / credentials / remaining wiring pending):** 39
- **Blocked-owner:** 25 (`ATK-I`, `0-11`, `1-03`, `1-13`, `2-12`, `3-04`, `5-10`, `6-09`, `X-10`, `O-01`–`O-14`, `O-16`, `O-17`)
- **Blocked-credential:** 9 (`0-02`, `0-06`, `0-13`, `1-02`, `6-01`, `6-02`, `6-07`, `O-15`, `O-18`)
- **Open (not yet created/verified):** 4 (`5-04`, `X-03`, `X-05`, `X-07`)

