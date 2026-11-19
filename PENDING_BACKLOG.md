# DESHI GEE — PENDING BACKLOG (v2, organized)

**Last updated:** 2026-11-19 · **Open items:** 119 *(105 remaining from v2 + 5 open Stage 0 findings `S0-02`–`S0-04`, `S0-07`, `S0-13` + 9 tracked public-key attack items `ATK-A`–`ATK-I`; `5-01`, `X-04`, `S0-01`, `S0-05`, `S0-06`, `S0-08`–`S0-12` & `S0-14` closed)* · **Reality check:** Code-only Stage 1 security hardening (`S0-01`, `S0-05`–`S0-12`, `S0-14`, Case #60 typo clarification, Cases #61–#62 two-step Confirm cards) is verified in mock/unit tests (`npm test` 137/137, `npm run test:chatbot` 64/64, `npm run build` exit 0); **ZERO live deploys executed**. Live Firestore rules lock-downs (`S0-02`, `S0-03`, `S0-13`, `ATK-A`–`ATK-I`) await Firebase Admin SDK migration + local Java Emulator verification + explicit owner approval.

Keep this file in the repo root. The coding agent must update it at the end of every phase. **Never delete an item** — mark it `[x]` with date, real evidence (command + result) and commit ID.

> **বাংলা:** যা কমপ্লিট হয়েছে তা এখানে নেই। এখানে শুধু বাকি, আংশিক ও আটকে থাকা কাজ। সবচেয়ে জরুরিগুলো (🔴) আগে করতে হবে। কাজ শেষ হলে আসল প্রমাণ ছাড়া টিক দেওয়া যাবে না।

**Legend** — Priority: 🔴 P0 must-fix before go-live (security / money / trust) · 🟠 P1 important · 🟡 P2 should · 🟢 P3 later.
Who: 🤖 coding agent · 👤 owner · 🔒 blocked by something external (API key, Java, credentials, quota).

---

## 1. WHAT TO DO NEXT (in this order)

| Step | Who | Action |
|---|---|---|
| 1 | 👤 | Create a **test Gemini key** and a 32+ char `ORDER_TOKEN_SECRET` in `.env.local` / hosting secrets (never in chat, zip or repo). Install **Java** for the Firestore Emulator. |
| 2 | 👤 | Decide the business facts the agent invented or left as placeholders: **zone fees + ETAs, dispatch cutoff, free-delivery threshold, max jars, bKash/Nagad/support/WhatsApp numbers, address** (items O-04, O-10, O-13). |
| 3 | 🤖 | Fix `S0-01` to `S0-06` (Stage 0 P0 findings) first, then the V3 Stage 1 P0 items (`2-10`, `2-07`, `3-08`/`X-11`, `2-02`/`2-03`, `5-02`, `0-01`, `3-01`, `4-05`, `1-13`, `O-13 guard`, `0-11`). **No deploy without written approval.** |
| 4 | 🤖 | Build/harden Stage 2–4B items (`S0-07`–`S0-12`, payment + courier interfaces/mocks with "Not configured" status, T1.6 structured response, docs). |
| 5 | 👤 | Read and approve the starter KB pack, run Emulator rules tests + approve rules deploy, then run the Go-live checklist (Section 9) and a 7–14 day limited pilot. |

---

## 2. 🔴 CRITICAL LIST (P0) — quick view

| ID | Why it is critical |
|---|---|
| S0-01 | Internal prompt/backlog/master-spec docs in `public/assets/aistudio/` are web-served publicly |
| S0-02 | Live Firestore rules allow anonymous `get` on `chat_sessions` and `order_drafts` by ID |
| S0-03 | Live Firestore rules allow anonymous `get` on `marketing_consents/{phone}` and `refill_reminders/{order_phone}` (leaks consent/PII); consent/unsubscribe lacks phone ownership proof |
| S0-04 | `/api/payments/callback` falls back to `expectedAmountBdt = 1`, lacks SSLCommerz IPN hash check, allows unauthenticated `fail`/`cancel`, lacks rate limit, does not update order/payment status |
| S0-05 | `/api/orders/notify` is callable from any client with static header `x-requested-with` (SMS/email/webhook spam vector) |
| S0-06 | `/api/integrations/status` and `/api/notifications/status` are public GET (leaks `recentLogs`) instead of admin-only |
| S0-13 | Unauthenticated Firestore update on `orders/{orderId}` (8 fields incl. `address` & `deliveryFeeBdt` to `0` WITHOUT even knowing `phone`) and `order_tracking/{lookupId}` (7 fields incl. unchecked `status`); guessable `{orderNumber}_{phone}` acts as un-rate-limited enumeration oracle |
| S0-14 | Test runs without `DESHI_GEE_TEST_MODE=1` or missing per-store mocks silently wrote test docs to live Firestore; fail-closed test guard now throws `LiveFirestoreWriteBlockedInTestError` unless emulator or mock is active |
| 2-10 | Cancel / address-change are **write actions given to the model**; need identity check + explicit Confirm click + prompt-injection tests |
| 2-07 | Dispatch cutoff (2 PM), zone fees/ETAs and risk thresholds were **chosen by the agent**, not the owner → false promises to customers |
| 3-08 / X-11 | Session ownership unknown; agent replies and order drafts (name, phone, address) are fetched by `sessionId` polling every 6 s |
| 2-02 / 2-03 | Phase 2 gate not proven: duplicate order, token replay, "Yes"-creates-no-order, concurrent stock, atomic commit |
| 5-02 | Phase 5 edited `app/api/order/route.ts` (the money path) with no test result |
| 0-11 / 5-10 | Rules deployed live without approval; no Emulator test; Phase 4–6 deploy state needs Emulator verification before any deploy |
| 0-01 | `/api/health` exposes model/SDK details and lets outsiders trigger paid probes |
| 3-01 | Identity check on reorder / review / refill routes not confirmed |
| 4-05 | `start` script kills whatever owns port 3000 — dev-only behaviour must not reach production |
| 1-13 | "Seed Verified KB Pack" answers were written by the agent; owner must verify before publishing |
| O-13 | Placeholder payment numbers / phone / address in store settings (wrong bKash/Nagad number = lost money) |

---

## 3. OPEN WORK BY PHASE

### Stage 0 Audit Findings (added 2026-11-19 — `S0-01`..`S0-06` are FIRST in Stage 1)

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [x] | S0-01 | Stage 0 | Internal docs removed from `public/assets/aistudio/`, moved to `docs/`, added `public/assets/aistudio/` to `.gitignore` (2026-11-19: `npm run lint` exit 0; `npm test` 115/115 pass; `npm run test:chatbot` 56/56 pass; `npm run build` exit 0; production `next start` returned HTTP 404 for all former `/assets/aistudio/*`, `/PENDING_BACKLOG.md`, and `/docs/*` URLs) | 🔴 | 🤖 |
| [ ] | S0-02 | Stage 0 | **DEPLOY-BLOCKED** (rules patch on branch `rules-admin-only-pending-sdk`, see `DEPLOY_BLOCKED.md`; `master:firestore.rules` restored to LIVE `1550bd7` so running REST code does not break). API-layer protections active on `master`: `/api/chat/session` mints ≥128-bit IDs bound to signed HttpOnly cookie, verifies cookie ownership on GET/DELETE, rate-limits polls; ChatPanel pauses polls when hidden/idle. *(Open pending Firebase Admin SDK migration + Emulator exec `🔒 Java` + owner deploy approval)* | 🔴 | 🤖 🔒 Admin SDK / Java |
| [ ] | S0-03 | Stage 0 | **DEPLOY-BLOCKED** (rules patch on branch `rules-admin-only-pending-sdk`, see `DEPLOY_BLOCKED.md`; `master:firestore.rules` restored to LIVE `1550bd7`). API-layer protections active on `master`: `/api/retention/campaigns` consent/unsubscribe rate-limited (20/min/IP) and requires phone ownership proof (matching Order ID + phone, valid signed unsubscribe token, or verified Admin). *(Open pending Firebase Admin SDK migration + Emulator exec `🔒 Java` + owner deploy approval)* | 🔴 | 🤖 🔒 Admin SDK / Java |
| [ ] | S0-04 | Stage 0 | Payment callback/initiate code hardened (mock/unit verified): removed `expectedAmountBdt = 1` fallback, added SSLCommerz IPN MD5 `verify_sign` + Validation API check, strict bKash `merchantInvoiceNumber`, ignored unauth `fail`/`cancel`, IP+order rate limits, `503 "Not configured"` when env missing, updates `paymentStatus` only after validation. *(Still open for live mode: `fetchServerOrderForPaymentValidation` / `markServerOrderPaymentVerified` need Firebase Admin SDK to read/patch `isAdmin()`-only `orders/{orderId}` + live gateway sandbox credentials)* | 🔴 | 🤖 🔒 Admin SDK / credentials |
| [x] | S0-05 | Stage 0 | `/api/orders/notify` hardened (admin Bearer or `x-internal-notify-secret`, IP rate-limited `20/min/IP`); storefront checkout routed through `POST /api/orders/storefront` which persists atomically and invokes shared server-internal `dispatchOrderNotificationsServerSide` directly without reopening `/api/orders/notify` to browsers (2026-11-19: `npm run lint` exit 0, `npm test` 137/137 pass, `npm run build` exit 0) | 🔴 | 🤖 |
| [x] | S0-06 | Stage 0 | `/api/integrations/status` and `/api/notifications/status` locked to verified Admin Bearer token (`401` unauth; `recentLogs` never exposed publicly); created minimal public `/api/payments/methods` returning only enabled payment method names & gateway booleans; updated checkout/track/admin callers (2026-11-19: `npm run lint` exit 0, `npm test` 137/137 pass, `npm run build` exit 0) | 🔴 | 🤖 |
| [ ] | S0-07 | 6-02 | **Code hardened & unit-verified (2026-11-19, `npm test` 137/137 pass):** `/api/courier/book` idempotent (returns existing `consignmentId` without double-booking + in-flight lock), Pathao requires explicit `recipientCityId`/`recipientZoneId` (fail-fast before OAuth), RedX requires explicit `deliveryAreaId` (no hardcoded `1`), `/api/courier/webhook` validates server order + consignment match (`409` on mismatch) and applies mapped status via `applyValidatedCourierStatusToOrder`. *(Remains open for live verification: Steadfast/Pathao/RedX sandbox credentials + Admin SDK for live webhook `orders` patch `🔒 credentials / Admin SDK`)* | 🟠 | 🤖 🔒 credentials |
| [x] | S0-08 | 6-04 | `/api/chat/tts` requires HMAC-signed assistant-reply `ttsToken` bound to `sessionId` + SHA-256 hash of validated assistant reply text (`403` on missing/mismatched/tampered token), enforces persistent daily cost cap (`429`), and records estimated TTS token/USD usage into `chatbot_cost_ledger` (2026-11-19: `npm run lint` exit 0, `npm test` 137/137 pass, `npm run build` exit 0) | 🟠 | 🤖 |
| [x] | S0-09 | 6-06 | Claim templates (+BSTI, +Lab PDF) create `status: 'draft'` entries only in `AdminChatbotPanel`; `sanitizeApprovedClaimsMetaForPublish`, `sanitizeApprovedClaimsStringForPublish`, `getActiveApprovedClaimsText`, and `publishChatbotChanges` strip all draft/placeholder claim entries before publishing or runtime evaluation (2026-11-19: `npm run lint` exit 0, `npm test` 137/137 pass, `npm run build` exit 0) | 🟠 | 🤖 |
| [x] | S0-10 | 5-06 | `app/robots.ts` disallows `/track` and `/track/`, `app/sitemap.ts` excludes `/track`; `src/lib/seo.ts` (`buildStorefrontStructuredData`) reads live `store_settings/main` via `fetchServerStoreSettingsWithMeta` and omits Product `offers` entirely when `confirmedFromDb` is false (2026-11-19: `npm run lint` exit 0, `npm test` 137/137 pass, `npm run build` exit 0) | 🟠 | 🤖 |
| [x] | S0-11 | 5-03 | `/api/channels/webhook` enforces per-sender rate limiting (`15/min`, `120/day`) and runs shared pre-generation guards (`detectSensitiveSecret`, `detectPromptInjection`, `classifyDomainRequest`) + post-generation `validateChatbotResponse` before returning or sending replies (2026-11-19: `npm run lint` exit 0, `npm test` 137/137 pass, `npm run build` exit 0; live Meta app credentials tracked under `5-03`/`5-04`) | 🟠 | 🤖 |
| [x] | S0-12 | 6-03 | BulkSMSBD sends `api_key`, `senderid`, `number`, `message` in `application/x-www-form-urlencoded` POST body (never URL query string); `sanitizeGatewayDetail` scrubs URLs and credential key/value pairs from all gateway error/log details (2026-11-19: `npm run lint` exit 0, `npm test` 137/137 pass, `npm run build` exit 0) | 🟡 | 🤖 |
| [ ] | S0-13 | Stage 0 / Audit | `order_tracking` & `orders` unauthenticated updates + enumeration oracle (see `docs/SERVER_AUTH_AND_ADMIN_SDK_PLAN.md` §E and split hotfix proposal `docs/INTERIM_S0_13_HOTFIX_PROPOSAL.md`, **NOT DEPLOYED**): split into **Part 1** (`hotfix-s013-part1` / `docs/rules-proposals/hotfix-s013-part1.rules`, Patches B/C/D pure removals + exhaustive caller impact matrix) and **Part 2** (`hotfix-s013-part2` / `docs/rules-proposals/hotfix-s013-part2.rules`, `let`-bound Patch A fee/discount/total validation — 3–5 calls/doc vs 10 limit, 11–14 calls/batch vs 20 limit; requires `store_settings/main` seeded). Local Java Emulator suite ready at `tests/emulator/firestore-rules-hotfix-s013.test.ts` (`npm run test:rules:s013`). `master:firestore.rules` stays untouched. Full fix (including unguessable lookup tokens + stopping fake orders/stock drain) requires Firebase Admin SDK. | 🔴 | 🤖 🔒 Admin SDK / Java |
| [x] | S0-14 | Stage 0 / Audit | Fail-closed Firestore test write guard (`LiveFirestoreWriteBlockedInTestError` across all 26 commit sites) + production startup refusal (`ProductionTestModeForbiddenError` + `[SECURITY_FATAL]` whenever `DESHI_GEE_TEST_MODE=1` under `NODE_ENV=production`) + Section D live-DB pollution audit (`chatbot_cost_ledger/2026-11-18` & `2026-11-19` read-only GET audit in `docs/SERVER_AUTH_AND_ADMIN_SDK_PLAN.md`) (2026-11-19: `npm run lint` exit 0, `npm run test:chatbot` 64/64 pass, `npm test` 137/137 pass, `NODE_ENV=production DESHI_GEE_TEST_MODE=1` probe exit 1 with `[SECURITY_FATAL]`, `npm run build` exit 0) | 🔴 | 🤖 |

### Public-Key Firestore Attack Matrix (`ATK-A`..`ATK-I` — distinct from `S1-01`..`S1-09`)

> Renamed from `(a)–(i)` to **`ATK-A..ATK-I`** so IDs do not collide with `S1-01..S1-09` (`docs/SERVER_AUTH_AND_ADMIN_SDK_PLAN.md`). All `YES` items below require Firebase Admin SDK migration + `isAdmin()`-only rules + Emulator verification to close completely (interim `S0-13` hotfix Part 1/2 only narrows `ATK-A` fee/discount manipulation, NOT fake order creation or `ATK-B`–`ATK-G`).

| ☐ | ID | Attack Vector (Public API Key / Unauthenticated Client) | Live Status | Full Closure Requirement | Pri | Who |
|---|---|---|---|---|---|---|
| [ ] | ATK-A | Create `orders` with `deliveryFeeBdt=1` / `discountBdt=subtotal` with no confirmation token (and drain `store_settings/main` stock) | **YES** (LIVE) | Part 2 hotfix validates fee/discount/total, but stopping fake orders & stock drain requires Admin SDK (`orders` `allow create: if isAdmin()`) | 🔴 | 🤖 🔒 Admin SDK |
| [ ] | ATK-B | Reset or overwrite `chatbot_rate_buckets` counts directly in Firestore | **YES** (LIVE) | Admin SDK + lock `chatbot_rate_buckets` to `isAdmin()`-only | 🔴 | 🤖 🔒 Admin SDK |
| [ ] | ATK-C | Inflate `chatbot_cost_ledger/{YYYY-MM-DD}.totalUsd` to trigger `capHit: true` kill switch | **YES** (LIVE) | Admin SDK + lock `chatbot_cost_ledger` to `isAdmin()`-only | 🔴 | 🤖 🔒 Admin SDK |
| [ ] | ATK-D | Forge `order_audit_logs` entries with `actorType: 'admin'` for any existing order | **YES** (LIVE) | Admin SDK + lock `order_audit_logs` to `isAdmin()`-only | 🔴 | 🤖 🔒 Admin SDK |
| [ ] | ATK-E | Create `payment_gateway_events` with `verified: true` (callback code does **not** trust it as paid, only dedupes `eventId` — DoS/audit pollution risk) | **YES** (LIVE) | Admin SDK + lock `payment_gateway_events` to `isAdmin()`-only | 🟠 | 🤖 🔒 Admin SDK |
| [ ] | ATK-F | Read/write `marketing_consents/{phone}` by phone number | **YES** (LIVE) | Admin SDK + merge `rules-admin-only-pending-sdk` (`S0-03`) | 🔴 | 🤖 🔒 Admin SDK |
| [ ] | ATK-G | Guess/read/write `chat_sessions/{id}` and `order_drafts/{id}` by ID (API now mints ≥128-bit IDs, but rules still allow `get`/`write`) | **PARTIAL** (LIVE) | Admin SDK + merge `rules-admin-only-pending-sdk` (`S0-02`) | 🔴 | 🤖 🔒 Admin SDK |
| [ ] | ATK-H | Bypass `support_evidence` MIME/size check directly via Firestore REST (`dataUrl` regex checks prefix only; API validates magic bytes) | **PARTIAL** (LIVE) | Admin SDK + lock `support_evidence` `allow create` to `isAdmin()`-only | 🟠 | 🤖 🔒 Admin SDK |
| [ ] | ATK-I | `store_settings/main` missing in live DB while LIVE rules fall back to hardcoded `680 / 1290 / 2480` | **YES** (LIVE) | Owner seeds `store_settings/main` with verified prices/fees/stock + Part 2 / Admin SDK removes hardcoded fallback | 🔴 | 👤 + 🤖 |

### Phase 0 — Foundation

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [ ] | 0-01 | T0.1 | `/api/health`: public response only `ok` + general status. Model names, SDK version, warnings, probes, `?refresh=1` → admin-authenticated only; rate-limit probes so outsiders cannot burn API quota | 🔴 | 🤖 |
| [ ] | 0-02 | T0.3 | Verify `gemini-4-hydrogen` + `gemini-3.1-flash-lite` via the **models list API** (SDK compatibility ≠ availability). Live preview appears to reach Gemini, but formal verification is not recorded | 🟠 | 🤖 🔒 key |
| [ ] | 0-03 | T0.3 | Update `estimateGeminiCostUsd` rates from official pricing (config/env values) | 🟠 | 🤖 |
| [ ] | 0-04 | T0.3 | Classify retired-model 404 as `gemini_model_retired` with admin-visible message | 🟡 | 🤖 |
| [ ] | 0-05 | T0.3 | Rollback plan in README (switch model by env only, no code redeploy) | 🟡 | 🤖 |
| [ ] | 0-06 | T0.3 | Real forced-failover smoke test (primary error → fallback) with a real key | 🟠 | 🤖 🔒 key |
| [ ] | 0-07 | T0.2 / T0.5 | Named tests: token tamper, replay, expiry, session mismatch; tool rounds 0 / 1 / 4 / 5 / >5 | 🟠 | 🤖 |
| [ ] | 0-08 | T0.6 | Decide + document: coupon amounts seeded into verified amounts, or tool-grounded only (currently tool-grounded) | 🟡 | 🤖 |
| [ ] | 0-09 | T0.11 | Rate-limit values editable from admin/config; verify order draft survives session rollover | 🟡 | 🤖 |
| [ ] | 0-10 | T0.12 | Prove the cost ledger uses atomic increments (concurrent requests must not lose counts) | 🟠 | 🤖 |
| [ ] | 0-11 | T0.15 | Run the 12 adversarial Firestore rules cases on the **Emulator** (real `PERMISSION_DENIED`), plus every new collection (sessions, drafts, evidence, fingerprints, audit logs, courier fields, campaigns, channels) | 🔴 | 🤖 🔒 Java |
| [ ] | 0-12 | T0.15 | Review existing admin chat logs and quantify top failure codes | 🟡 | 🤖 |
| [ ] | 0-13 | T0.13 | Latency: a **36-second greeting turn** was observed. Find root cause (model, thinking level, tools on greeting), record p50/p95 with the real key, set a target | 🟠 | 🤖 🔒 key |

### Phase 1 — Reliable answers

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [ ] | 1-01 | T1.6 | **Structured Response Contract** — Gemini returns schema (`replyText, intent, confidence, needsHuman, sources, suggestedReplies, productCardIds, orderDraftStatus, actions`); price, total, coupon, order ID, payment status, tracking only from backend; model-supplied values rejected. *(Skipped entirely; check whether `src/lib/chatbot/schema.ts` is this or schema.org)* | 🟠 | 🤖 |
| [ ] | 1-02 | T1.1 | Real embeddings (Gemini embedding model). Current "semantic" = custom 128-dim vector. Verify `gemini-embedding-2` name, cost, quota, retention | 🟠 | 🤖 🔒 key |
| [ ] | 1-03 | T1.1 | Retrieval benchmark ≥50 from **real customer questions** (current 15/15 was agent-written) | 🟠 | 👤 + 🤖 |
| [ ] | 1-04 | T1.2 | Tests for mixed in/off-domain questions (answer only the Deshi Gee part + polite boundary note) | 🟡 | 🤖 |
| [ ] | 1-05 | T1.3 | Confirm default `languageBehavior` (target: Bangla-script); add Banglish detector test set (spelling variants, Dhaka/Chattogram) | 🟡 | 🤖 + 👤 |
| [ ] | 1-06 | T1.4 | Show explicit state machine `collecting_details → quote_ready → awaiting_confirmation → confirmed / expired / cancelled`; test correction ("earlier number was wrong, use this one") | 🟠 | 🤖 |
| [ ] | 1-07 | T1.5 | Audit-log every tool call (`agent_audit_logs`: sessionId, toolName, argumentsHash, outcome, actor, timestamp) | 🟠 | 🤖 |
| [ ] | 1-08 | T1.7 | Clarify streaming is real `generateContentStream`; tests proving prices / phones / claims / secrets are never streamed before validation | 🟠 | 🤖 |
| [ ] | 1-09 | T1.8 | Send unanswered, low-confidence, guard-blocked and fallback answers to the admin queue (not only negative feedback); "Export Regression JSON" must create a runnable test | 🟡 | 🤖 |
| [ ] | 1-10 | T1.9 | Confirm Order Summary card has Edit + Confirm + expiry; welcome chips; accessibility pass | 🟠 | 🤖 |
| [ ] | 1-11 | T1.13 | Analytics: chat→order funnel, summary→confirm, AOV, variant mix, AI spend per chat/order, checkout abandonment, channel split (check overlap with 5-07) | 🟡 | 🤖 |
| [ ] | 1-12 | T1.14 | Playground can run the full saved test suite (currently 10 prompts) | 🟡 | 🤖 |
| [ ] | 1-13 | T1.11 / T1.12 | **Owner reviews every starter KB answer.** Rename button "Draft starter pack — owner review required"; everything defaults to draft; each answer lists its source | 🔴 | 👤 |
| [ ] | 1-14 | — | Add Phase 1 cases to `npm run test:chatbot`: correction, multi-slot, language switch, session resume, streaming claim block, mixed questions, Banglish | 🟠 | 🤖 |

### Phase 2 — Order agent

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [ ] | 2-01 | T2.1 | Prove the 12-step journey: privacy reassurance before phone/address, owner notification event, customer confirmation message, Track link + support path, success only after persisted order ID; **max 10 jars across mixed variants** (above → human) | 🟠 | 🤖 |
| [ ] | 2-02 | T2.2 | Named gate tests: double-click / network retry = **one** order; token replay rejected; typed "Yes/হ্যাঁ" creates no order; stock race with **truly concurrent** requests; stale-price 409 flow | 🔴 | 🤖 |
| [ ] | 2-03 | T2.2 | Stock decrement + order + token consumption + tracking projection in **one atomic commit**; no lost updates on `store_settings/main` | 🔴 | 🤖 |
| [x] | 2-04 | T2.3 | District typo → **ask the customer** ("Did you mean Chattogram?"); never silently map and price from a guess (2026-11-19: `resolveConfiguredDistrictAndZone`, `quote_delivery`, `prepare_order_summary`, `request_address_change`, and `liveFallbackEngine` return `needsClarification: true` + `suggestedDistrict`; verified in Case #60 + T2.3, `npm run test:chatbot` 64/64 pass, `npm test` 137/137 pass) | 🟠 | 🤖 |
| [ ] | 2-05 | T2.3 | Thana / upazila collection and validation | 🟡 | 🤖 |
| [ ] | 2-06 | T2.3 | Duplicate flow: customer is asked / routed to review, not blocked; `/order_fingerprints` must use keyed HMAC (plain phone hashes are brute-forceable) + retention cleanup | 🟠 | 🤖 |
| [ ] | 2-07 | T2.4 | Zone fees, ETAs, dispatch cutoff **only from owner-confirmed admin settings**; remove agent-chosen defaults; empty value = no promise to customers; holiday/delay wording; admin UI for the 4 zones | 🔴 | 👤 + 🤖 |
| [ ] | 2-08 | T2.4 | Coupon `usedCount` atomic with order creation; show reason messages (expired / inactive / min spend / cap reached) | 🟠 | 🤖 |
| [ ] | 2-09 | T2.5 | COD verification stays "Not configured" until a provider is chosen; risk thresholds admin-configurable; low-risk path not slowed; human/appeal path; transparent reasons; retention limits | 🟡 | 👤 + 🤖 |
| [ ] | 2-10 | T2.6 | **Code hardened & unit-verified (2026-11-19, Cases #58, #59, #61, #62 pass):** `request_cancel` and `request_address_change` NEVER mutate directly — they emit an interactive Confirm card with a signed single-use HMAC `actionToken` (`POST /api/orders/manage` verifies session + single-use replay protection). *(Remains open pending owner approval of bKash/Nagad refund wording `O-11` + Admin SDK for live post-Part-1 writes)* | 🔴 | 🤖 + 👤 |
| [ ] | 2-11 | T2.6 | bKash/Nagad refund wording must not promise a refund; paid-order cancellation → human handover | 🟠 | 🤖 + 👤 |
| [ ] | 2-12 | T2.6 | `/order_audit_logs` append-only in rules (no update/delete/public read) — Emulator-tested | 🟠 | 🤖 |
| [ ] | 2-13 | — | Order-flow cases in `test:chatbot` (now **64** passing — added Cases #55–#62 covering stock, price change, duplicate, cancel, address edit, zone typo clarification, and chat two-step Confirm cards; multi-variant & coupon reason scenarios still to expand) | 🟠 | 🤖 |
| [ ] | 2-14 | — | Tool catalog (now >26): runtime schema validation, timeout, audit log on every tool; no tool lets the model create an order | 🟠 | 🤖 |

### Phase 3 — Post-purchase (reported complete)

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [ ] | 3-01 | T3.1 | Identity verification on `/api/orders/reorder`, `/review`, `/refill-reminder` | 🔴 | 🤖 |
| [ ] | 3-02 | T3.1 | Return/refund eligibility questionnaire from real policy + order data; product-complaint category flow (quality/safety allegation → human) | 🟡 | 🤖 |
| [ ] | 3-03 | T3.2 | Ticket carries summary + order ID + issue category so customers don't repeat; transcript only with consent; `assignedTo` + priority fields | 🟠 | 🤖 |
| [ ] | 3-04 | T3.1 | `support_evidence`: retention/deletion rule; no public read/list (Emulator-tested) | 🟠 | 🤖 🔒 Java |
| [ ] | 3-05 | T3.3 | Refill reminder: quiet hours, frequency cap, suppression/opt-out list, consent record | 🟡 | 🤖 |
| [ ] | 3-06 | — | Add Phase 3 conversations (payment dispute, damaged jar, late delivery, human request, refund claim) to `test:chatbot` | 🟡 | 🤖 |
| [ ] | 3-07 | T3.1 | Delay check uses zone ETA windows → must use owner-confirmed values (depends on 2-07) | 🟠 | 🤖 |
| [ ] | 3-08 | T3.2 | Chat polls `/api/chat/session` every 6 s: confirm it cannot be read with another person's `sessionId`; ensure polling doesn't burn rate limits or Firestore quota | 🔴 | 🤖 |
| [ ] | 3-09 | T4.3* | CSV export (orders, tickets): admin-only, audited, minimal PII | 🟡 | 🤖 |
| [ ] | 3-10 | T3.3 | Refill webhook payload: minimize customer PII; failure handling already retryable | 🟡 | 🤖 |

### Phase 4 — agent's version ≠ master plan ⚠️

Agent delivered: manual courier fields (partner, consignment ID, https tracking link), refill dispatch endpoint, SLA analytics + CSV. **Payments and real courier APIs are NOT done.**

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [ ] | 4-01 | T4.1 | Payment provider **interface + mock + "Not configured"** (bKash / Nagad / SSLCommerz / ShurjoPay): `create_checkout_session`, `verify_payment`, `get_payment_status`, `request_refund`; `payments` collection; signed webhook, timestamp check, event-ID dedupe, reconciliation. TxnID never = verified | 🟠 | 🤖 (live: 🔒 credentials) |
| [ ] | 4-02 | T4.2 | Courier provider **interface + mock** (Steadfast → Pathao → RedX): consignment, `shipments` + `scanEvents`, idempotent webhook/poll, failed-delivery/return flows, COD collection sync. Never say "on the way" without tracking number + live status | 🟠 | 🤖 (live: 🔒 credentials) |
| [ ] | 4-03 | T4.3 | Payment lifecycle (`unpaid, pending, verification_required, paid, failed, expired, refunded, partially_refunded`), receipt upload with strict checks, admin payment-review queue + audit, refund/replacement workflow | 🟠 | 🤖 |
| [ ] | 4-04 | T4.1 | Courier tracking URL: https-only **plus allowlist of courier domains** (no phishing links shown to customers) | 🟠 | 🤖 |
| [ ] | 4-05 | — | `scripts/next-cli.mjs` kills processes on port 3000 and is used by `start` → make it **dev-only**; production `start` must never kill processes | 🔴 | 🤖 |

### Phase 5 — interrupted, UNVERIFIED

Edited: channel engine, `/api/channels/webhook`, `/api/retention/campaigns`, `/api/analytics/attribution`, schema.org in layout, robots, sitemap, **`app/api/order/route.ts`**, `app/api/chat/route.ts`, session store, rules, blueprint, new test file. **No completion report, no test/build result.**

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [x] | 5-01 | — | Run lint, tests, regression, build; produce Phase 5–6 reality table (2026-11-19: `npm run lint` exit 0; `npm test` exit 0, 114/114 pass [mock/static]; `npm run test:chatbot` exit 0, 56/56 pass [mock/static]; `npm run build` exit 0; Phase 5–6 reality table delivered in Stage 0 report) | 🔴 | 🤖 |
| [ ] | 5-02 | — | Review the diff of `app/api/order/route.ts`; re-run token replay / idempotency / atomic-commit / price-revalidation tests | 🔴 | 🤖 |
| [ ] | 5-03 | T5.1 | Messenger/Instagram webhook: `X-Hub-Signature-256`, replay/duplicate dedupe, per-channel rate limit, reuse guards/draft/handover, "Not configured" without Meta credentials | 🟠 | 🤖 🔒 Meta app |
| [ ] | 5-04 | T5.2 | WhatsApp Cloud API: **verify current policy** (task-specific bots only), templates, opt-in, 24-hour window; link identity to an order only after phone verification | 🟠 | 🤖 🔒 Meta app |
| [ ] | 5-05 | T5.3 | Consent-based recovery/campaigns: opt-in/out, suppression list, frequency caps, quiet hours; `/api/retention/campaigns` admin-authenticated | 🟠 | 🤖 |
| [ ] | 5-06 | T5.4 | schema.org (Product / Organization / FAQ) uses only owner-approved facts (no invented rating/claims); `robots.ts`/sitemap exclude `/admin`, `/api`, `/track` | 🟠 | 🤖 |
| [ ] | 5-07 | T5.5 | Funnel + attribution (chat started → info → intent → summary → confirm → delivered), deduplicated | 🟡 | 🤖 |
| [ ] | 5-08 | T5.6 | Shared omnichannel admin inbox (web + Messenger + Instagram + WhatsApp), identity matching, AI pause per conversation | 🟡 | 🤖 |
| [ ] | 5-09 | T5.4 | Optional later: Bangla voice, image understanding, staff reply-assist, email/SMS notifications, agentic-commerce readiness (UCP/ACP — low priority) | 🟢 | 🤖 |
| [ ] | 5-10 | — | **Rules/blueprint changes: do not deploy** until Emulator tests pass and the owner approves in writing | 🔴 | 🤖 + 👤 |

### Phase 6 — agent-added integrations (UNVERIFIED, added after the last report)

| ☐ | ID | Item | Pri | Who |
|---|---|---|---|---|
| [ ] | 6-01 | Audit **SSLCommerz + bKash** code against current official docs; sandbox test; server-side amount/order/merchant validation, signature, idempotency, replay, redirect ≠ paid | 🔴 | 🤖 🔒 credentials |
| [ ] | 6-02 | Audit **courier auto-book + webhook** (Steadfast / Pathao / RedX): admin-only, audited, idempotent booking; authenticated webhook + dedupe; never say "booked/shipped" without provider response | 🔴 | 🤖 🔒 credentials |
| [ ] | 6-03 | **SMS / email gateways** (BulkSMSBD, Twilio, Resend): consent, opt-out, quiet hours, frequency caps, DND, PII minimization, cost cap | 🟠 | 🤖 |
| [ ] | 6-04 | **TTS route**: rate limit, length cap, only validated assistant text, cost ledger, honest failure | 🟠 | 🤖 |
| [ ] | 6-05 | **Voice dictation**: privacy notice; transcript editable before send; never auto-submit order-affecting text | 🟡 | 🤖 |
| [ ] | 6-06 | **Claim templates** (+BSTI / +Lab PDF) create drafts only; never auto-approved | 🟠 | 🤖 |
| [ ] | 6-07 | Timeouts raised to 15 s / 28 s + 60 s circuit breaker: re-measure p50/p95, set a target (ties to 0-13) | 🟠 | 🤖 🔒 key |
| [ ] | 6-08 | `/api/integrations/status` and `/api/notifications/status` admin-only; no secret values/URLs | 🟠 | 🤖 |
| [ ] | 6-09 | Rules deployed again in Phases 5 and 6 (≥ 7 total, never approved): freeze, diff live vs repo, Emulator tests first | 🔴 | 🤖 + 👤 |
| [ ] | 6-10 | Failover on model-level 403 / circuit breaker: fallback only for transient errors; key-level auth errors must alert admin, not be hidden | 🟠 | 🤖 |

---

## 4. CROSS-CUTTING WORK (not yet in any phase)

| ☐ | ID | Item | Pri | Who |
|---|---|---|---|---|
| [ ] | X-01 | T0.0 full Feature Coverage Matrix + ranked root-cause report (exact file / function / line) | 🟠 | 🤖 |
| [ ] | X-02 | **F22** admin gaps: product master, variants/inventory, delivery rules, policy lifecycle, agent-skill switches, staged publish/rollback, analytics | 🟠 | 🤖 |
| [ ] | X-03 | **Part 7 mapping** — which task covers each of §A admin, §B data model, §C tool catalog, §D security, §E KPIs, §F QA, §H Bangladesh rules, Acceptance criteria | 🟠 | 🤖 |
| [x] | X-04 | Git: `git init` verified (`1550bd7` baseline + Stage 0 baseline commit), `.gitignore` covers `.env*` + `!.env.example` + `.aistudio/` + `tsconfig.tsbuildinfo`, `git status` confirms no secret files tracked. *(Per-task historical backfill before git init is impossible; one commit per item `<ID>: <summary>` enforced from Stage 1 onward.)* | 🟠 | 🤖 |
| [ ] | X-05 | Architecture diagrams (Mermaid): chat flow, order flow, payment flow, courier flow, handover flow | 🟡 | 🤖 |
| [ ] | X-06 | Docs: env guide, admin setup, KB format, payment/courier/channel guides, security + retention guide, test guide, **deploy + rollback checklist** | 🟠 | 🤖 |
| [ ] | X-07 | Market comparison research doc (dates + sources; official vs independent vs vendor claims) | 🟢 | 🤖 |
| [ ] | X-08 | App Check or CAPTCHA, origin/CSRF validation on write routes (Part 7 §D) | 🟠 | 🤖 |
| [ ] | X-09 | Data retention / deletion / export, backups, incident-response notes; update Privacy / Terms text for chatbot data and consent | 🟠 | 🤖 + 👤 |
| [ ] | X-10 | **Production hosting decision** (the AI Studio preview is not production): host, domain, HTTPS, Firebase authorized domains, secrets storage, rollback | 🟠 | 👤 |
| [ ] | X-11 | Admin role model: who is an admin, server-side role checks on every admin route, unverified-email spoof test | 🔴 | 🤖 |
| [ ] | X-12 | Load test ~100 concurrent users; real phone + mobile-network test | 🟡 | 🤖 + 👤 |
| [ ] | X-13 | Grow `test:chatbot` well beyond 56 (items 1-14, 2-13, 3-06 feed it) and run in CI before every deploy | 🟠 | 🤖 |

---

## 5. OWNER ACTIONS 👤

| ☐ | ID | Item | Pri |
|---|---|---|---|
| [ ] | O-01 | Test Gemini key into `.env.local` only | 🟠 |
| [ ] | O-02 | Install Java (or provide a machine) for Firestore Emulator tests | 🔴 |
| [ ] | O-03 | Confirm **BSTI license / lab PDF, A2 / Organic claims, Eid / festival dispatch cutoff, verified Dhaka pickup Google Maps URL** | 🟠 |
| [ ] | O-04 | Confirm zones: fee + ETA for Dhaka, suburban (Savar / Ashulia…), nationwide, remote; daily dispatch cutoff; free-delivery threshold; max jars | 🔴 |
| [ ] | O-05 | 20–30 real customer questions with correct answers (benchmark + KB) | 🟠 |
| [ ] | O-06 | Production `ORDER_TOKEN_SECRET` (32+ random chars), Gemini key, `CRON_SECRET` | 🔴 |
| [ ] | O-07 | Rotate any key ever shared in a zip, repo or chat | 🔴 |
| [ ] | O-08 | Appoint a person responsible for support tickets and handover | 🟠 |
| [ ] | O-09 | Decide default `languageBehavior` (Bangla script vs mirror Banglish) | 🟡 |
| [ ] | O-10 | Choose a COD-confirmation provider (or keep off); set high-value-COD threshold | 🟡 |
| [ ] | O-11 | Approve refund wording for bKash/Nagad cancellations | 🟠 |
| [ ] | O-12 | Confirm SLA targets (chosen in agent's question: Standard 2 h / Urgent 30 min, business hours) are the real ones | 🟡 |
| [ ] | O-13 | Replace placeholders in Admin: `bkashNumber`, `nagadNumber`, `supportPhone`, `whatsappNumber`, `businessAddress`, `googleMapsUrl` | 🔴 |
| [ ] | O-14 | Set a scheduler that calls the refill dispatch endpoint daily (with `CRON_SECRET`); webhook URLs (`OWNER_WEBHOOK_URL`, `WHATSAPP_WEBHOOK_URL`, `EMAIL_WEBHOOK_URL`, `GOOGLE_SHEETS_WEBHOOK_URL`) if wanted | 🟡 |
| [ ] | O-15 | Provider access when ready: bKash / Nagad / SSLCommerz / ShurjoPay merchant credentials; Steadfast / Pathao / RedX API keys; Meta app + WhatsApp Business setup | 🟢 |
| [ ] | O-16 | Review Privacy / Terms / Return policy pages for chatbot data, consent and refund wording | 🟠 |
| [ ] | O-17 | Decide the production hosting target (see X-10) | 🟠 |
| [ ] | O-18 | Provide gateway credentials only via server env / secret manager when ready (SSLCommerz, bKash, Steadfast/Pathao/RedX, BulkSMSBD/Twilio/Resend, Meta/WhatsApp, `NEXT_PUBLIC_SITE_URL`, optional `GEMINI_DAILY_COST_CAP_USD`); sandbox first | 🟡 |

---

## 6. PROCESS RULES FOR THE AGENT (violated before — enforce)

- [ ] **No live deploy (Firestore rules or anything else) without the owner's written approval.** Code change and deploy are separate steps. Rules were deployed live in T0.1, T0.15, Phase 1, Phase 2 and Phase 3 despite this rule. List what is live vs the repo.
- [ ] **Do not claim "complete" without evidence** (real command + result). The claim "no new features left" is contradicted by this file.
- [ ] **Do not invent business facts** (cutoffs, fees, ETAs, thresholds, claims, ratings). Missing value → no customer promise + owner-input flag.
- [ ] **Keep task IDs from the master plan.** Phase 4 = payments + courier APIs; do not relabel other work as Phase 4.
- [ ] **Owner spot check:** place one test order end to end; confirm logged-out visitors cannot read `orders`, `order_audit_logs`, chat logs or evidence.

---

## 7. CLOSED / ANSWERED

| ☐ | Item | Note |
|---|---|---|
| [x] | `.env.local` existence | Agent reported it does **not** exist in the workspace (only `.env.example`); owner must create it / set hosting secrets (O-01, O-06) |
| [x] | SLA defaults and Phase 3 design choices | Owner picked in the agent's question: private Firestore evidence docs, auto-pause AI on claim, Standard 2 h / Urgent 30 min, reorder + review prompt + opt-in refill reminder |

---

## 8. PHASE STATUS SUMMARY

| Phase | Agent says | Reality |
|---|---|---|
| 0 Foundation | Complete | Mostly done; real-key and Emulator checks open (Section 3) |
| 1 Reliable answers | Complete | T1.6 missing; embeddings, owner KB review, tests open |
| 2 Order agent | Complete | Gate not proven; invented cutoff/fees; cancel/edit risk open |
| 3 Post-purchase | Complete | Done; identity checks on new routes + session polling security to confirm |
| 4 Payments + courier | "Complete" (different scope), later gateway code added | Gateway/courier code exists but **unverified** (no sandbox, docs not checked); lifecycle + review queue still open |
| 5 Channels + retention | Complete (108 tests) | Claim not verified item by item; order route touched; no credentials |
| 6 Integrations (TTS, payments, courier, SMS/email) | Complete (114 tests) | **Unverified**; see Phase 6 table |

---

## 9. GO-LIVE CHECKLIST (all must be ✅ before opening to all customers)

- [ ] 1. 20 real questions (Bangla / Banglish / English) tested by the owner with a real Gemini key
- [ ] 2. Wrong price, fake claim and prompt-injection ("show system prompt") attempts are blocked
- [ ] 3. One test order end to end (Confirm button, order ID, tracking); typing "Yes" creates no order
- [ ] 4. Logged-out visitors cannot read others' orders, chat logs, evidence (Emulator test included)
- [ ] 5. `ORDER_TOKEN_SECRET` + Gemini key set in production; `/api/health` healthy and not leaking details
- [ ] 6. Any key ever shared has been rotated
- [ ] 7. Product, policy, delivery, claim and payment-number data verified by the owner
- [ ] 8. A responsible person is assigned to tickets
- [ ] 9. Daily cost cap configured and working
- [ ] 10. Real phone + mobile network test; load test with ~100 concurrent users
- [ ] 11. Cancel / address-change cannot be triggered without identity check + Confirm click
- [ ] 12. Payment, courier, SMS/email and channel integrations tested in each provider's **sandbox** before any live credential is used
- [ ] 13. 7–14 day limited-traffic pilot with daily review of bad answers, unanswered questions, guard blocks, fallback rate and spend

---

## 10. UPDATE LOG

| Date | Phase | What changed | Evidence |
|---|---|---|---|
| — | End of Phase 1 | Backlog created | — |
| — | End of Phase 2 | Phase 2 items, owner decisions, security notes added | — |
| — | Phases 3–5 | Phase 3 gaps, Phase 4 scope drift, Phase 5 unverified added | — |
| 2026-11-19 | Phases 5–6 reported | Added Phase 6 items 6-01…6-10, O-17, O-18, sandbox go-live step; Phase 5/6 marked unverified | — |
| 2026-11-18 | v2 reorganization | Prioritized (🔴🟠🟡🟢), unique IDs, "what to do next", critical list, new items: session polling security (3-08), order-route re-test (5-02), admin role model (X-11), App Check/CAPTCHA (X-08), retention/privacy (X-09), hosting decision (X-10), CSV/PII (3-09), courier URL allowlist (4-04), latency (0-13), health split, process rules | — |
| 2026-11-19 | Stage 0 (Freeze & Verify) | Placed v2 107-item `PENDING_BACKLOG.md` at repo root (`S0-backlog`); verified lint/test/chatbot/build + Phase 5–6 reality table (`5-01`); hardened `.gitignore` (`.env*`, `!.env.example`) & committed Stage 0 baseline (`X-04`); scanned repo + `.next/static` for secret patterns (`S0-secrets`, no server secrets); ran read-only Firestore rules/blueprint audit (`0-11` audit part; NO deploy performed; `0-11`/`5-10`/`6-09` stay open `🔒 Java`). | `npm run lint` exit 0; `npm test` exit 0 (114/114 mock/static); `npm run test:chatbot` exit 0 (56/56 mock/static); `npm run build` exit 0; `npx eslint firestore.rules` exit 0 |
| 2026-11-19 | Stage 1 Follow-ups (Items 1–7, NO DEPLOY) | Closed code-only `S0-08`..`S0-12` & hardened `S0-07`; added `POST /api/orders/storefront` with direct server-side notifications (`S0-05`); split `S0-13` hotfix into `hotfix-s013-part1` & `hotfix-s013-part2` branches + `docs/rules-proposals/` + caller impact matrix + Patch A call-count audit + `npm run test:rules:s013` Emulator suite + plain limitations disclosure; audited live `chatbot_cost_ledger` read-only & added `NODE_ENV=production` + `DESHI_GEE_TEST_MODE=1` `[SECURITY_FATAL]` startup refusal; fixed Case #60 typo clarification (`2-04`) and added two-step signed single-use Confirm cards for chat cancel & address edit (Cases #61–#62); added `ATK-A`–`ATK-I` attack table. `master:firestore.rules` untouched; ZERO deploys. | `npm run lint` exit 0; `npm run build` exit 0; `npx eslint firestore.rules docs/rules-proposals/*.rules` exit 0; `npm run test:chatbot` 64/64 pass; `npm test` 137/137 pass; `NODE_ENV=production DESHI_GEE_TEST_MODE=1` probe exit 1 (`[SECURITY_FATAL]`) |
