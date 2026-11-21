# DESHI GEE — PENDING BACKLOG (v2, organized)

**Last updated:** 2026-11-19 · **Open items:** 94 · **Code-done, awaiting live proof `[m]`:** 60 · **Reality check:** Phases 0–5 reported complete by the agent (114 tests, build pass) and an extra "Phase 6" of integrations (payments, courier API, SMS/email, TTS) was added — **all unverified against real credentials / official docs**; most of the original 95 items show no evidence of being addressed.

Keep this file in the repo root. The coding agent must update it at the end of every phase. **Never delete an item** — mark it `[x]` with date, real evidence (command + result) and commit ID.

> **বাংলা:** যা কমপ্লিট হয়েছে তা এখানে নেই। এখানে শুধু বাকি, আংশিক ও আটকে থাকা কাজ। সবচেয়ে জরুরিগুলো (🔴) আগে করতে হবে। কাজ শেষ হলে আসল প্রমাণ ছাড়া টিক দেওয়া যাবে না।

**Legend** — Priority: 🔴 P0 must-fix before go-live (security / money / trust) · 🟠 P1 important · 🟡 P2 should · 🟢 P3 later.
Who: 🤖 coding agent · 👤 owner · 🔒 blocked by something external (API key, Java, credentials, quota).
Status: `[ ]` open · `[m]` **code done, verified with mock/static tests only — still needs live / Emulator proof (do not treat as finished)** · `[x]` verified with real evidence.

---

## 1. WHAT TO DO NEXT (in this order)

| Step | Who | Action |
|---|---|---|
| 0 | 🤖 | **Server identity + rules lockdown plan (S1-10 / S1-11)** — owner approval before any rules change; see Section 2B |
| 1 | 👤 | Create a **test Gemini key** and a 32+ char `ORDER_TOKEN_SECRET` in `.env.local` / hosting secrets (never in chat, zip or repo). Install **Java** for the Firestore Emulator. |
| 2 | 👤 | Decide the business facts the agent invented or left as placeholders: **zone fees + ETAs, dispatch cutoff, free-delivery threshold, max jars, bKash/Nagad/support/WhatsApp numbers, address** (items O-04, O-10, O-13). |
| 3 | 🤖 🔒 | When the agent's quota resets: run `npm run lint`, `npm test`, `npm run test:chatbot`, `npm run build`; list what Phase 5 really contains (5-01). **No deploy.** |
| 4 | 🤖 | Fix the 🔴 items in Section 2 (cancel/edit Confirm click, session ownership, order-route re-test, health endpoint, `start` script). |
| 5 | 🤖 | Build the payment + courier **interfaces with mocks and "Not configured"** status (4-01 to 4-03), T1.6 structured response, git, docs. |
| 6 | 👤 | Read and approve the starter KB pack, then run the Go-live checklist (Section 9) and a 7–14 day limited pilot. |

---

## 2. 🔴 CRITICAL LIST (P0) — quick view

| ID | Why it is critical |
|---|---|
| 2-10 | Cancel / address-change are **write actions given to the model**; need identity check + explicit Confirm click + prompt-injection tests |
| 2-07 | Dispatch cutoff (2 PM), zone fees/ETAs and risk thresholds were **chosen by the agent**, not the owner → false promises to customers |
| 3-08 / X-11 | Session ownership unknown; agent replies and order drafts (name, phone, address) are fetched by `sessionId` polling every 6 s |
| 2-02 / 2-03 | Phase 2 gate not proven: duplicate order, token replay, "Yes"-creates-no-order, concurrent stock, atomic commit |
| 5-02 | Phase 5 edited `app/api/order/route.ts` (the money path) with no test result |
| 5-01 | Phase 5 is unverified; build may be broken |
| 0-11 / 5-10 | Rules deployed live five times without approval; no Emulator test; Phase 4/5 deploy state unclear |
| 0-01 | `/api/health` exposes model/SDK details and lets outsiders trigger paid probes |
| 3-01 | Identity check on reorder / review / refill routes not confirmed |
| 4-05 | `start` script kills whatever owns port 3000 — dev-only behaviour must not reach production |
| 1-13 | "Seed Verified KB Pack" answers were written by the agent; owner must verify before publishing |
| O-13 | Placeholder payment numbers / phone / address in store settings (wrong bKash/Nagad number = lost money) |

---

## 2B. 🔴 SECURITY FINDINGS FROM STAGE 0 AND THE LIVE-RULES REVIEW (do first)

**Root cause (confirmed by the agent):** `firestoreRest.ts` writes to Firestore with the public Web API key and no identity, so the live rules must allow public writes; Next.js protections (confirm token, idempotency, rate limits, cost cap) are bypassable by direct Firestore REST calls. Live rules = Stage 0 baseline (0 differences). Two repo rules patches (S0-02, S0-03) are **not deployed** and would break customer routes (403) until the server has an identity — keep them on a branch.

| ☐ | ID | Item | Pri | Who |
|---|---|---|---|---|
| [ ] | S1-10 | **Server identity:** Admin SDK + service account on an owner-controlled Blaze project, **or** interim Firebase-Auth "server user" + ID token on Firestore REST (`isServer()` rule). Design doc, owner approval, implement behind a flag, verify every route | 🔴 | 🤖 + 👤 |
| [ ] | S1-11 | Rules lockdown on branch `rules-lockdown` (server-only for sessions, drafts, buckets, ledger, idempotency, tokens, fingerprints, evidence, support, logs, feedback, audit, events, consents, reminders, orders create/update, tracking writes); drift check; Emulator tests per attack; rollback ruleset; **deploy only with written approval** | 🔴 | 🤖 🔒 Java |
| [ ] | S1-01 | `orders`: client can forge a ~1-taka order (fee/discount unchecked, no confirm token) | 🔴 | 🤖 |
| [ ] | S1-02 | `chatbot_rate_buckets` count resettable by anyone | 🔴 | 🤖 |
| [ ] | S1-03 | `chatbot_cost_ledger` inflatable → daily-cap DoS (one write can set `capHit: true` and switch the chatbot off for everyone) | 🔴 | 🤖 |
| [ ] | S1-04 | `order_audit_logs` forgeable (incl. `actorType: admin`) | 🔴 | 🤖 |
| [ ] | S1-05 | `payment_gateway_events` forgeable with `verified: true`; check callback usage | 🔴 | 🤖 |
| [ ] | S1-06 | `marketing_consents` forgeable + readable by phone | 🔴 | 🤖 |
| [ ] | S1-07 | `chat_sessions` / `order_drafts` readable & writable by guessable ID; `linkedPhone` spoofable | 🔴 | 🤖 |
| [ ] | S1-08 | Unlimited public writes: evidence, support requests, logs, feedback, subscribers; evidence MIME unverified | 🟠 | 🤖 |
| [ ] | S1-09 | `store_settings/main` missing in live DB; rules hardcode 680/1290/2480 → seed from Admin; remove hardcoded prices | 🟠 | 🤖 + 👤 |
| [ ] | S1-12 | Agent test docs in the live DB are listed in `docs/` (e.g. `chat_sessions/sess_501`, `sess_502`, `ch_wa_*`, `order_drafts/draft_sess_*`, `marketing_consents/01711223344`…); before S0-14 every `npm test` also wrote rate buckets, sessions, drafts and cost-ledger docs; no deletion without approval; separate dev/test project or prefix + cleanup; reset the cost ledger | 🟠 | 🤖 + 👤 |
| [ ] | S1-13 | Confirm who owns hardcoded admin `kinboni.bd@gmail.com`; second admin; 2-step verification | 🟠 | 👤 |
| [ ] | S1-14 | `chatbot_config/published` is public and holds `customInstructions` + admin emails → split public projection / private config | 🟠 | 🤖 |
| [ ] | S1-15 | `order_tracking`: client reads/writes by `{order}_{phone}` → server-only writes; rate-limited lookup route | 🟠 | 🤖 |
| [x] | S0-01 | Internal docs web-served from `public/assets/aistudio/` → move out, `.gitignore`, verify 404 in prod build (AI Studio attachments land in `public/`) — **DONE: commit ea0c9e1, production build returns 404 for all former URLs** | 🔴 | 🤖 |
| [ ] | S0-02 | `chat_sessions` / `order_drafts` ID-readable: patch exists, **keep on branch, do not deploy before S1-10** | 🔴 | 🤖 |
| [ ] | S0-03 | `marketing_consents` / `refill_reminders` ID-readable: same; unsubscribe needs ownership proof or signed token | 🔴 | 🤖 |
| [ ] | S0-04 | Payment callback: remove `expectedAmountBdt = 1` fallback, SSLCommerz IPN hash + validation API, status only after validation, authenticate/ignore fail/cancel (code + mock tests done, commit 45fc2aa; live mode blocked on S1-10) | 🔴 | 🤖 |
| [x] | S0-05 | `/api/orders/notify` callable with a static header → internal/admin-only + rate limit — **DONE: commit ece49da (admin token or `INTERNAL_NOTIFY_SECRET`, IP rate limit). Follow-up: use a secret separate from `CRON_SECRET`** | 🔴 | 🤖 |
| [x] | S0-06 | Status routes admin-only; minimal public payment-methods endpoint; no `recentLogs` publicly — **DONE: commit ece49da; new `/api/payments/methods`** | 🔴 | 🤖 |
| [ ] | S0-07 | Courier: idempotent booking, validated webhook updates status, fix RedX/Pathao IDs, inert until verified | 🟠 | 🤖 |
| [m] | S0-08 | TTS only validated assistant text + cost ledger | 🟠 | 🤖 |
| [m] | S0-09 | Claim templates create drafts only | 🟠 | 🤖 |
| [m] | S0-10 | robots/sitemap exclude `/track`; JSON-LD from live Store Facts | 🟠 | 🤖 |
| [ ] | S0-11 | Channel-webhook replies pass shared validator + guards + rate limit | 🟠 | 🤖 |
| [m] | S0-12 | BulkSMSBD: no API key in GET URL; never log request URLs | 🟡 | 🤖 |
| [ ] | S0-13 | **Orders hijack:** unauthenticated client can edit address/zone/fee/total of any pending/confirmed order (guessing `DG-xxxxx` is enough; fee can be set to 0) and forge `order_tracking.status`; tracking readable by `{order}_{phone}` with no rate limit → prepare rules hotfix diff (do not deploy) + Emulator tests; final fix via S1-10/S1-11 | 🔴 | 🤖 + 👤 |
| [x] | S1-16 | **Test safety:** a test run without `DESHI_GEE_TEST_MODE=1` wrote fixtures into the live DB. Make tests fail closed against live Firestore + prove it with a test — **DONE (agent's S0-14, commit d313995): fail-closed guard + proof test; it caught 3 tests that wrote to the live DB on every `npm test`. Owner deletion of test docs → O-21** | 🟠 | 🤖 + 👤 |
| [ ] | S1-17 | **Guessable session IDs:** omnichannel IDs are an unkeyed `sha256(channel:senderId)` → anyone who knows a WhatsApp number can compute that customer's `chat_sessions`/`order_drafts` IDs (confirmed live); client fallback IDs `dg_${Date.now()}…` and `dg_init` are guessable → keyed HMAC and server-minted IDs only | 🔴 | 🤖 |
| [ ] | S1-18 | **Unguessable order lookup:** 192-bit tracking token (`/track?t=`, only its HMAC stored, `no-store`, `no-referrer`, excluded from robots/sitemap); Order ID + phone fallback only through a rate-limited `POST /api/orders/track` (5 attempts / 15 min per IP and per order) with one uniform 404; lock `order_tracking` | 🟠 | 🤖 |
| [ ] | S0-15 | `INTERNAL_NOTIFY_SECRET` still falls back to `CRON_SECRET` → make it a separate required secret; never reuse one secret for two purposes | 🟠 | 🤖 |

---

## 3. OPEN WORK BY PHASE

### Phase 0 — Foundation

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [m] | 0-01 | T0.1 | `/api/health`: public response only `ok` + general status. Model names, SDK version, warnings, probes, `?refresh=1` → admin-authenticated only; rate-limit probes so outsiders cannot burn API quota | 🔴 | 🤖 |
| [ ] | 0-02 | T0.3 | Verify `gemini-4-hydrogen` + `gemini-3.1-flash-lite` via the **models list API** (SDK compatibility ≠ availability). Live preview appears to reach Gemini, but formal verification is not recorded | 🟠 | 🤖 🔒 key |
| [m] | 0-03 | T0.3 | Update `estimateGeminiCostUsd` rates from official pricing (config/env values) | 🟠 | 🤖 |
| [m] | 0-04 | T0.3 | Classify retired-model 404 as `gemini_model_retired` with admin-visible message | 🟡 | 🤖 |
| [m] | 0-05 | T0.3 | Rollback plan in README (switch model by env only, no code redeploy) | 🟡 | 🤖 |
| [ ] | 0-06 | T0.3 | Real forced-failover smoke test (primary error → fallback) with a real key | 🟠 | 🤖 🔒 key |
| [m] | 0-07 | T0.2 / T0.5 | Named tests: token tamper, replay, expiry, session mismatch; tool rounds 0 / 1 / 4 / 5 / >5 | 🟠 | 🤖 |
| [m] | 0-08 | T0.6 | Decide + document: coupon amounts seeded into verified amounts, or tool-grounded only (currently tool-grounded) | 🟡 | 🤖 |
| [m] | 0-09 | T0.11 | Rate-limit values editable from admin/config; verify order draft survives session rollover | 🟡 | 🤖 |
| [m] | 0-10 | T0.12 | Prove the cost ledger uses atomic increments (concurrent requests must not lose counts) | 🟠 | 🤖 |
| [ ] | 0-11 | T0.15 | Run the 12 adversarial Firestore rules cases on the **Emulator** (real `PERMISSION_DENIED`), plus every new collection (sessions, drafts, evidence, fingerprints, audit logs, courier fields, campaigns, channels) | 🔴 | 🤖 🔒 Java |
| [ ] | 0-12 | T0.15 | Review existing admin chat logs and quantify top failure codes | 🟡 | 🤖 |
| [ ] | 0-13 | T0.13 | Latency: a **36-second greeting turn** was observed. Find root cause (model, thinking level, tools on greeting), record p50/p95 with the real key, set a target | 🟠 | 🤖 🔒 key |

### Phase 1 — Reliable answers

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [m] | 1-01 | T1.6 | **Structured Response Contract** — Gemini returns schema (`replyText, intent, confidence, needsHuman, sources, suggestedReplies, productCardIds, orderDraftStatus, actions`); price, total, coupon, order ID, payment status, tracking only from backend; model-supplied values rejected. *(Skipped entirely; check whether `src/lib/chatbot/schema.ts` is this or schema.org)* | 🟠 | 🤖 |
| [ ] | 1-02 | T1.1 | Real embeddings (Gemini embedding model). Current "semantic" = custom 128-dim vector. Verify `gemini-embedding-2` name, cost, quota, retention | 🟠 | 🤖 🔒 key |
| [ ] | 1-03 | T1.1 | Retrieval benchmark ≥50 from **real customer questions** (current 15/15 was agent-written) | 🟠 | 👤 + 🤖 |
| [m] | 1-04 | T1.2 | Tests for mixed in/off-domain questions (answer only the Deshi Gee part + polite boundary note) | 🟡 | 🤖 |
| [m] | 1-05 | T1.3 | Confirm default `languageBehavior` (target: Bangla-script); add Banglish detector test set (spelling variants, Dhaka/Chattogram) | 🟡 | 🤖 + 👤 |
| [m] | 1-06 | T1.4 | Show explicit state machine `collecting_details → quote_ready → awaiting_confirmation → confirmed / expired / cancelled`; test correction ("earlier number was wrong, use this one") | 🟠 | 🤖 |
| [ ] | 1-07 | T1.5 | Audit-log every tool call (`agent_audit_logs`: sessionId, toolName, argumentsHash, outcome, actor, timestamp) | 🟠 | 🤖 |
| [m] | 1-08 | T1.7 | Clarify streaming is real `generateContentStream`; tests proving prices / phones / claims / secrets are never streamed before validation | 🟠 | 🤖 |
| [m] | 1-09 | T1.8 | Send unanswered, low-confidence, guard-blocked and fallback answers to the admin queue (not only negative feedback); "Export Regression JSON" must create a runnable test | 🟡 | 🤖 |
| [m] | 1-10 | T1.9 | Confirm Order Summary card has Edit + Confirm + expiry; welcome chips; accessibility pass | 🟠 | 🤖 |
| [m] | 1-11 | T1.13 | Analytics: chat→order funnel, summary→confirm, AOV, variant mix, AI spend per chat/order, checkout abandonment, channel split (check overlap with 5-07) | 🟡 | 🤖 |
| [ ] | 1-12 | T1.14 | Playground can run the full saved test suite (currently 10 prompts) | 🟡 | 🤖 |
| [ ] | 1-13 | T1.11 / T1.12 | **Owner reviews every starter KB answer.** Rename button "Draft starter pack — owner review required"; everything defaults to draft; each answer lists its source | 🔴 | 👤 |
| [m] | 1-14 | — | Add Phase 1 cases to `npm run test:chatbot`: correction, multi-slot, language switch, session resume, streaming claim block, mixed questions, Banglish | 🟠 | 🤖 |

### Phase 2 — Order agent

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [m] | 2-01 | T2.1 | Prove the 12-step journey: privacy reassurance before phone/address, owner notification event, customer confirmation message, Track link + support path, success only after persisted order ID; **max 10 jars across mixed variants** (above → human) | 🟠 | 🤖 |
| [m] | 2-02 | T2.2 | Named gate tests: double-click / network retry = **one** order; token replay rejected; typed "Yes/হ্যাঁ" creates no order; stock race with **truly concurrent** requests; stale-price 409 flow | 🔴 | 🤖 |
| [m] | 2-03 | T2.2 | Stock decrement + order + token consumption + tracking projection in **one atomic commit**; no lost updates on `store_settings/main` | 🔴 | 🤖 |
| [m] | 2-04 | T2.3 | District typo → **ask the customer** ("Did you mean Chattogram?"); never silently map and price from a guess (regression case #60 still auto-maps Chitagong → Chattogram) | 🟠 | 🤖 |
| [m] | 2-05 | T2.3 | Thana / upazila collection and validation | 🟡 | 🤖 |
| [m] | 2-06 | T2.3 | Duplicate flow: customer is asked / routed to review, not blocked; `/order_fingerprints` must use keyed HMAC (plain phone hashes are brute-forceable) + retention cleanup | 🟠 | 🤖 |
| [ ] | 2-07 | T2.4 | Zone fees, ETAs, dispatch cutoff **only from owner-confirmed admin settings**; remove agent-chosen defaults; empty value = no promise to customers; holiday/delay wording; admin UI for the 4 zones | 🔴 | 👤 + 🤖 |
| [m] | 2-08 | T2.4 | Coupon `usedCount` atomic with order creation; show reason messages (expired / inactive / min spend / cap reached) | 🟠 | 🤖 |
| [m] | 2-09 | T2.5 | COD verification stays "Not configured" until a provider is chosen; risk thresholds admin-configurable; low-risk path not slowed; human/appeal path; transparent reasons; retention limits | 🟡 | 👤 + 🤖 |
| [ ] | 2-10 | T2.6 | **Cancel / address-change need identity check (Order ID + checkout phone) + explicit Confirm button + refund-impact explanation.** Model must not execute them from plain text or prompt injection ("cancel order X") — add tests | 🔴 | 🤖 |
| [ ] | 2-11 | T2.6 | bKash/Nagad refund wording must not promise a refund; paid-order cancellation → human handover | 🟠 | 🤖 + 👤 |
| [ ] | 2-12 | T2.6 | `/order_audit_logs` append-only in rules (no update/delete/public read) — Emulator-tested | 🟠 | 🤖 |
| [m] | 2-13 | — | Order-flow cases in `test:chatbot` (now 62: stock, price change, duplicate, cancel, address edit, zone typo added; multi-variant, correction, coupon reasons still missing) | 🟠 | 🤖 |
| [m] | 2-14 | — | Tool catalog (now >26): runtime schema validation, timeout, audit log on every tool; no tool lets the model create an order | 🟠 | 🤖 |

### Phase 3 — Post-purchase (reported complete)

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [m] | 3-01 | T3.1 | Identity verification on `/api/orders/reorder`, `/review`, `/refill-reminder` | 🔴 | 🤖 |
| [m] | 3-02 | T3.1 | Return/refund eligibility questionnaire from real policy + order data; product-complaint category flow (quality/safety allegation → human) | 🟡 | 🤖 |
| [m] | 3-03 | T3.2 | Ticket carries summary + order ID + issue category so customers don't repeat; transcript only with consent; `assignedTo` + priority fields | 🟠 | 🤖 |
| [ ] | 3-04 | T3.1 | `support_evidence`: retention/deletion rule; no public read/list (Emulator-tested) | 🟠 | 🤖 🔒 Java |
| [m] | 3-05 | T3.3 | Refill reminder: quiet hours, frequency cap, suppression/opt-out list, consent record | 🟡 | 🤖 |
| [m] | 3-06 | — | Add Phase 3 conversations (payment dispute, damaged jar, late delivery, human request, refund claim) to `test:chatbot` | 🟡 | 🤖 |
| [m] | 3-07 | T3.1 | Delay check uses zone ETA windows → must use owner-confirmed values (depends on 2-07) | 🟠 | 🤖 |
| [ ] | 3-08 | T3.2 | Chat polls `/api/chat/session` every 6 s: confirm it cannot be read with another person's `sessionId`; ensure polling doesn't burn rate limits or Firestore quota | 🔴 | 🤖 |
| [m] | 3-09 | T4.3* | CSV export (orders, tickets): admin-only, audited, minimal PII | 🟡 | 🤖 |
| [m] | 3-10 | T3.3 | Refill webhook payload: minimize customer PII; failure handling already retryable | 🟡 | 🤖 |

### Phase 4 — agent's version ≠ master plan ⚠️

Agent delivered: manual courier fields (partner, consignment ID, https tracking link), refill dispatch endpoint, SLA analytics + CSV. **Payments and real courier APIs are NOT done.**

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [ ] | 4-01 | T4.1 | Payment provider **interface + mock + "Not configured"** (bKash / Nagad / SSLCommerz / ShurjoPay): `create_checkout_session`, `verify_payment`, `get_payment_status`, `request_refund`; `payments` collection; signed webhook, timestamp check, event-ID dedupe, reconciliation. TxnID never = verified | 🟠 | 🤖 (live: 🔒 credentials) |
| [ ] | 4-02 | T4.2 | Courier provider **interface + mock** (Steadfast → Pathao → RedX): consignment, `shipments` + `scanEvents`, idempotent webhook/poll, failed-delivery/return flows, COD collection sync. Never say "on the way" without tracking number + live status | 🟠 | 🤖 (live: 🔒 credentials) |
| [m] | 4-03 | T4.3 | Payment lifecycle (`unpaid, pending, verification_required, paid, failed, expired, refunded, partially_refunded`), receipt upload with strict checks, admin payment-review queue + audit, refund/replacement workflow | 🟠 | 🤖 |
| [m] | 4-04 | T4.1 | Courier tracking URL: https-only **plus allowlist of courier domains** (no phishing links shown to customers) | 🟠 | 🤖 |
| [m] | 4-05 | — | `scripts/next-cli.mjs` kills processes on port 3000 and is used by `start` → make it **dev-only**; production `start` must never kill processes | 🔴 | 🤖 |

### Phase 5 — interrupted, UNVERIFIED

Edited: channel engine, `/api/channels/webhook`, `/api/retention/campaigns`, `/api/analytics/attribution`, schema.org in layout, robots, sitemap, **`app/api/order/route.ts`**, `app/api/chat/route.ts`, session store, rules, blueprint, new test file. **No completion report, no test/build result.**

| ☐ | ID | Ref | Item | Pri | Who |
|---|---|---|---|---|---|
| [m] | 5-01 | — | Run lint, tests, regression, build; list what actually exists vs half-written | 🔴 | 🤖 🔒 quota |
| [m] | 5-02 | — | Review the diff of `app/api/order/route.ts`; re-run token replay / idempotency / atomic-commit / price-revalidation tests | 🔴 | 🤖 |
| [ ] | 5-03 | T5.1 | Messenger/Instagram webhook: `X-Hub-Signature-256`, replay/duplicate dedupe, per-channel rate limit, reuse guards/draft/handover, "Not configured" without Meta credentials | 🟠 | 🤖 🔒 Meta app |
| [ ] | 5-04 | T5.2 | WhatsApp Cloud API: **verify current policy** (task-specific bots only), templates, opt-in, 24-hour window; link identity to an order only after phone verification | 🟠 | 🤖 🔒 Meta app |
| [m] | 5-05 | T5.3 | Consent-based recovery/campaigns: opt-in/out, suppression list, frequency caps, quiet hours; `/api/retention/campaigns` admin-authenticated | 🟠 | 🤖 |
| [m] | 5-06 | T5.4 | schema.org (Product / Organization / FAQ) uses only owner-approved facts (no invented rating/claims); `robots.ts`/sitemap exclude `/admin`, `/api`, `/track` | 🟠 | 🤖 |
| [m] | 5-07 | T5.5 | Funnel + attribution (chat started → info → intent → summary → confirm → delivered), deduplicated | 🟡 | 🤖 |
| [m] | 5-08 | T5.6 | Shared omnichannel admin inbox (web + Messenger + Instagram + WhatsApp), identity matching, AI pause per conversation | 🟡 | 🤖 |
| [ ] | 5-09 | T5.4 | Optional later: Bangla voice, image understanding, staff reply-assist, email/SMS notifications, agentic-commerce readiness (UCP/ACP — low priority) | 🟢 | 🤖 |
| [ ] | 5-10 | — | **Rules/blueprint changes: do not deploy** until Emulator tests pass and the owner approves in writing | 🔴 | 🤖 + 👤 |

### Phase 6 — agent-added integrations (UNVERIFIED, added after the last report)

| ☐ | ID | Item | Pri | Who |
|---|---|---|---|---|
| [ ] | 6-01 | Audit **SSLCommerz + bKash** code against current official docs; sandbox test; server-side amount/order/merchant validation, signature, idempotency, replay, redirect ≠ paid | 🔴 | 🤖 🔒 credentials |
| [ ] | 6-02 | Audit **courier auto-book + webhook** (Steadfast / Pathao / RedX): admin-only, audited, idempotent booking; authenticated webhook + dedupe; never say "booked/shipped" without provider response | 🔴 | 🤖 🔒 credentials |
| [ ] | 6-03 | **SMS / email gateways** (BulkSMSBD, Twilio, Resend): consent, opt-out, quiet hours, frequency caps, DND, PII minimization, cost cap | 🟠 | 🤖 |
| [m] | 6-04 | **TTS route**: rate limit, length cap, only validated assistant text, cost ledger, honest failure | 🟠 | 🤖 |
| [m] | 6-05 | **Voice dictation**: privacy notice; transcript editable before send; never auto-submit order-affecting text | 🟡 | 🤖 |
| [m] | 6-06 | **Claim templates** (+BSTI / +Lab PDF) create drafts only; never auto-approved | 🟠 | 🤖 |
| [ ] | 6-07 | Timeouts raised to 15 s / 28 s + 60 s circuit breaker: re-measure p50/p95, set a target (ties to 0-13) | 🟠 | 🤖 🔒 key |
| [m] | 6-08 | `/api/integrations/status` and `/api/notifications/status` admin-only; no secret values/URLs | 🟠 | 🤖 |
| [ ] | 6-09 | Rules deployed again in Phases 5 and 6 (≥ 7 total, never approved): freeze, diff live vs repo, Emulator tests first | 🔴 | 🤖 + 👤 |
| [m] | 6-10 | Failover on model-level 403 / circuit breaker: fallback only for transient errors; key-level auth errors must alert admin, not be hidden | 🟠 | 🤖 |

---

## 4. CROSS-CUTTING WORK (not yet in any phase)

| ☐ | ID | Item | Pri | Who |
|---|---|---|---|---|
| [ ] | X-01 | T0.0 full Feature Coverage Matrix + ranked root-cause report (exact file / function / line) | 🟠 | 🤖 |
| [m] | X-02 | **F22** admin gaps: product master, variants/inventory, delivery rules, policy lifecycle, agent-skill switches, staged publish/rollback, analytics | 🟠 | 🤖 |
| [ ] | X-03 | **Part 7 mapping** — which task covers each of §A admin, §B data model, §C tool catalog, §D security, §E KPIs, §F QA, §H Bangladesh rules, Acceptance criteria | 🟠 | 🤖 |
| [m] | X-04 | Git: `git init`, `.gitignore` covers `.env*`, `git status` shows no secrets, backfill one commit per task | 🟠 | 🤖 |
| [ ] | X-05 | Architecture diagrams (Mermaid): chat flow, order flow, payment flow, courier flow, handover flow | 🟡 | 🤖 |
| [m] | X-06 | Docs: env guide, admin setup, KB format, payment/courier/channel guides, security + retention guide, test guide, **deploy + rollback checklist** | 🟠 | 🤖 |
| [ ] | X-07 | Market comparison research doc (dates + sources; official vs independent vs vendor claims) | 🟢 | 🤖 |
| [ ] | X-08 | App Check or CAPTCHA, origin/CSRF validation on write routes (Part 7 §D) | 🟠 | 🤖 |
| [ ] | X-09 | Data retention / deletion / export, backups, incident-response notes; update Privacy / Terms text for chatbot data and consent | 🟠 | 🤖 + 👤 |
| [ ] | X-10 | **Production hosting decision** (the AI Studio preview is not production): host, domain, HTTPS, Firebase authorized domains, secrets storage, rollback | 🟠 | 👤 |
| [m] | X-11 | Admin role model: who is an admin, server-side role checks on every admin route, unverified-email spoof test | 🔴 | 🤖 |
| [ ] | X-12 | Load test ~100 concurrent users; real phone + mobile-network test | 🟡 | 🤖 + 👤 |
| [m] | X-13 | Grow `test:chatbot` well beyond 56 (items 1-14, 2-13, 3-06 feed it) and run in CI before every deploy | 🟠 | 🤖 |
| [ ] | X-14 | **Live verification pass** once Java + IAM exist: re-run the order gate (2-02/2-03/5-02), atomic ledger (0-10), session/draft/consent flows and the 25 rules tests against the **Firestore Emulator** and then a staging project; mock "concurrency" tests do not prove Firestore transaction behaviour | 🔴 | 🤖 + 👤 |
| [ ] | X-15 | Before deploying locked rules: prove with the browser network tab and a code scan that the storefront/track/chat/admin make **no direct client Firestore reads/writes** that the locked rules would block (store settings, reviews, newsletter, batches) | 🔴 | 🤖 |
| [ ] | X-16 | **ID reconciliation:** the agent's closure matrix (139 rows) used an older backlog copy; it lacks `S1-10 … S1-18` and `O-19 … O-22`, and renamed attacks (a)–(i) to `ATK-A…I`. Add the 13 missing IDs (substance mostly done: Admin SDK, rules proposal, tracking token, keyed session IDs, public config projection) and keep this file as the only master | 🟠 | 🤖 |
| [ ] | X-17 | App Check / CAPTCHA: `enforcePublicMutationGuards` is wired on 4 routes only; add it to `/api/order`, `/api/orders/storefront`, `/api/orders/manage`, `/api/chat`, `/api/support/*`, `/api/coupons/validate`, `/api/chatbot/feedback`; decide CAPTCHA vs App Check (see X-08) | 🟠 | 🤖 + 👤 |
| [ ] | X-18 | **Notification privacy:** messages sent to Telegram/Discord/WhatsApp must carry the minimum (order ID, total, status, admin link; masked phone; **no full address**); private chat/server only; mention these processors in the Privacy policy; Discord webhook URLs and the Telegram token are credentials (secret store only) | 🟠 | 🤖 + 👤 |
| [ ] | X-19 | **Notification durability:** confirm the event is **enqueued (awaited) before the customer response returns** — no fire-and-forget promise on serverless; retries need a scheduler calling `/api/notifications/worker` (Cloud Scheduler) — for the pilot also send once immediately with a short timeout; `NOTIFICATION_WORKER_SECRET` must not fall back to `CRON_SECRET` | 🟠 | 🤖 |
| [m] | X-20 | Notification ecosystem (central engine + Telegram + Discord + WhatsApp Cloud + admin "Integrations & Alerts" + worker; commits 6e88095…a53c32f; 192 tests, mock only; rules for 5 new collections are in the **undeployed** proposal). Live verification pending: provider credentials, Emulator, scheduler | 🟡 | 🤖 + 👤 |
| [ ] | X-21 | **Credentials in the Admin UI:** API keys/tokens/secrets must NOT be stored in Firestore in plain form and NEVER returned to the browser (no show/hide of saved secrets). Secrets stay in Secret Manager / server env; the UI shows only Configured / Not configured, instructions and Test buttons. Non-secret IDs (Page ID, Phone Number ID) may be stored. If write-only secret entry is ever required: server-side encryption with a key held outside the DB, audit log, no read-back — **report says secrets stay in server env only; the list of fields the admin UI stores is still to be provided** | 🔴 | 🤖 |
| [ ] | X-22 | **Auth override check:** the agent's log shows "Auth override signature check". Confirm any auth/override path is test-only, refuses to run in production (like the test-mode guard) and cannot act as an admin bypass | 🔴 | 🤖 |
| [ ] | X-23 | **Unexplained manual edits** (package.json, scripts/test-cli.mjs, firebaseAdmin.ts, notifications/store.ts, adminRepository.ts, 2 test files): owner confirms who made them; agent summarises each change and re-runs the full suite | 🟠 | 🤖 + 👤 |
| [ ] | X-24 | **Git lost again** (no `.git` in the workspace): re-init + snapshot commit; one source of truth = AI Studio workspace; push to a private GitHub repo after every stage (one-way); never pull over newer work without a file-by-file comparison | 🔴 | 🤖 + 👤 |
| [ ] | X-25 | **Template events vs real events:** the template editor lists 10 events (e.g. REFUND_REQUESTED, COMPLAINT_REPORTED, CUSTOMER_INQUIRY, HUMAN_HANDOFF_REQUESTED) whose names differ from the engine's emitted events; show a table mapping each template to a real emitter and remove templates with no source. Customer-scope messages (SMS/WhatsApp/email) only to customers with consent, outside quiet hours; test sends go to the admin only | 🟠 | 🤖 |
| [ ] | X-26 | **Admin click-through before the pilot:** the owner opens every admin tab, every ⓘ help modal and every Test button in a browser (desktop + phone); help text is agent-written and provider screens change, so verify the steps on first use; "reset to defaults" must never touch prices/stock/contacts without a confirmation | 🟠 | 👤 + 🤖 |
| [m] | X-27 | Admin help/config system (ⓘ modals with 3 tabs, storefront impact preview, credential readiness + webhook URLs, notification template editor, diagnostics suite): code done, mock/static only (199 tests, 72 regression) | 🟡 | 🤖 |

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
| [ ] | O-19 | **Approve the server-identity approach (S1-10)**. Project is **AI Studio Starter tier** (console banner): choose (1) upgrade this project to pay-as-you-go, (2) new owner-owned Firebase project on Blaze (clean DB), or (3) interim Firebase-Auth server user. Check an international card works for billing; set budget alerts | 🔴 |
| [ ] | O-20 | Confirm owner of `kinboni.bd@gmail.com`, enable 2-step verification, then seed Store Settings from Admin with real values after the lockdown is live | 🟠 |
| [ ] | O-21 | Delete the agent's test documents in the Firebase console (list in `docs/`; also check `orders` for "Salma Begum" / 01911000601, `channel_webhook_events/whatsapp_wamid_*`, test `chatbot_logs` / `chatbot_rate_buckets`) — or abandon the old project if you move to a new one | 🟡 |
| [ ] | O-22 | Decide `chatbot_config/published` visibility. Recommendation: restrict the full config to server/admin and expose only a public-safe projection (welcome text, quick questions, hours) through a server route (S1-14) | 🟠 |
| [ ] | O-23 | **Back up after every stage:** AI Studio → Download app (ZIP) and/or Save to GitHub (private); the container lost `.git` once. Check the ZIP contains no `.env.local` before sharing or uploading | 🔴 |

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
| 2026-11-20 | Admin help/config report | Reported done (199 tests); added X-25, X-26, X-27; X-21 awaiting stored-fields list | — |
| 2026-11-20 | Admin help/config prompt in progress | Added X-21 (no secrets in UI), X-22 (auth override check), X-23 (manual edits), X-24 (git lost again) | — |
| 2026-11-19 | Ecosystem prompt delivered | Notification ecosystem added (mock-tested); new items X-18, X-19, X-20; recommendation: feature freeze until pilot | — |
| 2026-11-19 | Final report + closure matrix | 62 items reported Done (mock/static) → marked `[m]`; 4 Open (5-04, X-03, X-05, X-07); added X-14…X-17, S0-15, O-23; git re-initialised (snapshot 766272f) | — |
| 2026-11-19 | Stage 1A report 2 | S0-01, S0-05, S0-06, S1-16 closed with evidence; S0-13 hotfix proposal documented (not applied); attack matrix (a)–(i) confirmed; added S1-17, S1-18, O-21, O-22; 127 tests / 62 regression cases | — |
| 2026-11-19 | Stage 1A report | S0-01 verified (404 proof); rules patches parked on branch; S0-13 (orders hijack) and S1-16 (test safety) added; project confirmed Starter tier | — |
| 2026-11-19 | Stage 0 + live-rules review | Added Section 2B (S0-01…S0-12, S1-01…S1-15), O-19, O-20; root cause: server has no Firestore identity | — |
| 2026-11-19 | Phases 5–6 reported | Added Phase 6 items 6-01…6-10, O-17, O-18, sandbox go-live step; Phase 5/6 marked unverified | — |
| 2026-11-18 | v2 reorganization | Prioritized (🔴🟠🟡🟢), unique IDs, "what to do next", critical list, new items: session polling security (3-08), order-route re-test (5-02), admin role model (X-11), App Check/CAPTCHA (X-08), retention/privacy (X-09), hosting decision (X-10), CSV/PII (3-09), courier URL allowlist (4-04), latency (0-13), health split, process rules | — |
