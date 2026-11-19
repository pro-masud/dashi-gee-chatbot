# DESHI GEE — CONTINUATION & REMEDIATION PROMPT (v3)

**Give this to the coding agent together with two attached files:**
1. `DESHI_GEE_MASTER_PROMPT_MERGED.md` — the standing product/engineering spec (still in force).
2. `PENDING_BACKLOG.md` — the live list of open items (107 items, IDs like `2-10`, `6-01`, `X-11`, `O-13`).

> **বাংলা নির্দেশ (মালিকের জন্য):** এই prompt-টি নতুন সেশনে এজেন্টকে দিন। এটি আগের কাজ শেষ করা, ভুল ঠিক করা এবং বাকি সব আইটেম (৯৫টি) এক এক করে সম্পন্ন করার নির্দেশ। কোনো আইটেম বাদ যাবে না। আসল প্রমাণ ছাড়া কিছু "শেষ" ধরা হবে না, আর আপনার লিখিত অনুমতি ছাড়া কিছু live deploy হবে না।

**Precedence:** where this prompt is stricter than the master prompt, this prompt wins. Where the backlog and this prompt differ in detail, follow this prompt and update the backlog.

---

# PART A — WHERE THE PROJECT STANDS (honest status)

You are continuing work on **Deshi Gee**, a single-product (Pabna grass-fed bilona cow ghee; 250g / 500g / 1kg) Bangladesh e-commerce store with an AI shopping & support chatbot (Next.js App Router, React, TypeScript, Firebase/Firestore, `@google/genai`). Previous work was done in phases. Read this status carefully — earlier reports over-claimed.

**Reported complete (not all verified):**
- **Phase 0 foundation:** health diagnostics, dedicated `ORDER_TOKEN_SECRET`, model env config + failover, output-budget/empty-reply handling, tool-loop finalization, grounded price guard, shared negation-aware claim validator, honest error logging, Store Facts snapshot, 50+ case regression harness (56 tests), CGNAT-safe rate limiting, Firestore cost ledger, bounded deadline + honest loading, domain-guard/retrieval fixes, rules tests (static only).
- **Phase 1:** hybrid RAG (BM25 + custom 128-dim vectors), secure document ingestion, intent router, language modes, `chat_sessions` / `order_drafts`, guarded streaming, product comparison cards, feedback, admin studio upgrades, starter KB pack.
- **Phase 2:** mixed-variant cart, button-only confirmation, live revalidation + stock lock, 64 districts + fuzzy matching, duplicate fingerprints, 4 delivery zones, coupons, COD adapter ("not configured"), risk queue, pre-dispatch cancel / address edit, `order_audit_logs`, tool catalog grown to 21+.
- **Phase 3:** private evidence uploads, consented tickets with SLA, admin human inbox with AI auto-pause/resume, payment/delay diagnostics, one-click reorder, verified review prompt, opt-in refill reminder.
- **"Phase 4" (agent's own scope, NOT the master plan):** manual courier fields (partner + consignment ID + tracking URL), refill-reminder dispatch endpoint, support SLA analytics, safe CSV export, dev-server port fixes, streaming timeout/failover.
- **Phase 5:** **started and interrupted by a usage limit — no completion report, no test or build result.** Files touched include the channel engine, `/api/channels/webhook`, `/api/retention/campaigns`, `/api/analytics/attribution`, schema.org in the layout, robots, sitemap, rules, blueprint, `app/api/order/route.ts`, `app/api/chat/route.ts`, the session store and a new test file. Treat Phase 5 as **unverified**.

**Known problems (all tracked in `PENDING_BACKLOG.md`):**
- The master-plan **Phase 4 (payments + real courier APIs) is not done** — only manual fields exist.
- Several **business facts were chosen by the agent, not the owner**: a 2 PM BST dispatch cutoff, suburban/remote zone fees and ETAs, risk thresholds.
- **Cancel / address-change are write actions exposed to the model** with no proven explicit-Confirm step.
- **Firestore rules were deployed live at least seven times (including Phases 5 and 6) without the owner's written approval**, with no Emulator test; deploy state for Phases 4–5 is unclear.
- Session ownership for `/api/chat/session` (polled every 6 s, carries drafts and agent replies) is unproven.
- T1.6 (structured response contract), T0.0 (full feature matrix), F22 (admin gaps), the Part-7 mapping, git, docs and market research were never delivered.
- Most "Gemini" tests use mocks; embeddings are not real; a 36-second greeting turn was observed live.
- The claim "no features left" was false.

---

# PART A2 — LATEST UPDATE (after Phase 5 completion and the agent's extra "Phase 6")

A later agent session (a different model) reported the following. **None of it is verified against real credentials or official docs.**
- **Phase 5 "complete":** channel webhooks (WhatsApp / Messenger / Instagram) with signature + replay guards, funnel + attribution dashboard, abandoned-draft recovery, inbox channel filter + AI draft reply, Bangla/English voice dictation, AggregateOffer JSON-LD, dynamic robots/sitemap. Reported 9 suites, 108/108 tests, build and typecheck pass.
- **Extra work ("Phase 6"):** Gemini **TTS** route and Listen button; **SSLCommerz + bKash** server code (`src/lib/integrations/paymentGateway.ts`, `/api/payments/initiate`, `/api/payments/callback`); **courier auto-booking + webhook** for Steadfast / Pathao / RedX (`src/lib/integrations/courierApi.ts`, `/api/courier/book`, `/api/courier/webhook`); direct **SMS / email** gateways (BulkSMSBD, Twilio, Resend; `messagingGateway.ts`); an integrations **readiness matrix** (`/api/integrations/status`, `/api/notifications/status`); owner claim templates (+BSTI, +Lab PDF). Reported 10 suites, 113 then 114 tests.
- **Runtime fixes:** timeouts raised to 15 s per request / 28 s per turn, 60-second primary-model circuit breaker, error-classifier changes (including failover on model-level 403), contact-intent tool narrowing.
- **Rules were deployed live again** in Phases 5 and 6.
- The agent again claimed "no code-level work remains." **That is false:** nothing in the 95 original backlog items is shown as addressed (cancel/edit Confirm gate, invented cutoff/fees, session ownership, structured response, git, Emulator tests, docs…), and the new integration code has no sandbox or live evidence.

**What this changes:**
1. Stage 4 is no longer "build from scratch" — it is **"audit, harden and test what the agent already wrote"** against current official docs and mocks.
2. A new **Stage 4B** lists the new risks (items `6-01` … `6-10`).
3. Stage 0 must also produce a **Phase 5–6 reality table**.
4. No integration may be described to customers or the owner as **live** until a real sandbox/live end-to-end test passes. Without credentials every one of them must show **"Not configured"** and be inert.

---

# PART B — NON-NEGOTIABLE RULES

## B1. Process rules (these were violated before — treat as hard stops)
1. **NO live deploy of any kind** (Firestore rules, hosting, indexes, functions, secrets) without the owner's **written approval for that specific deploy.** Code change and deploy are separate steps. If a tool offers one-click deploy, do not use it. Before asking, show: what changes, which project, the Emulator test results, and the rollback step.
2. **No "complete" without evidence.** Evidence = the exact command run + its real output summary + commit ID. Mocks must be labeled "mock"; anything needing a real key, Java, credentials or a browser must be labeled "not verified" and kept open.
3. **Never invent business facts** — cutoffs, fees, ETAs, thresholds, claims (organic, A2, BSTI, certified, lab-tested, purity, medical), ratings, reviews, contact numbers, merchant numbers, stock, batch data, policies. Missing owner value → **no promise to the customer**, an "owner input required" flag in Admin, and a safe fallback ("I can't confirm this; I'll connect you with our team").
4. **Keep master-plan task IDs.** "Phase 4" means payments + courier APIs. Do not relabel other work.
5. **One item at a time, one commit per item** (message: `<ID>: <summary>`). Run typecheck, lint, tests and build after each item. Update `PENDING_BACKLOG.md` (tick `[x]` only with evidence; never delete items).
6. **Stop and ask only** for a genuinely blocking owner decision, a missing credential, or anything destructive / irreversible / costing money. Otherwise use a documented safe default (never a business fact) and continue.
7. **Do not pause between items** for approval unless blocked; give a summary at the end of each stage.

## B2. Engineering rules (carried from the master prompt)
- **Inspect before changing.** Reuse the existing architecture. Do not rebuild. Preserve all working behavior listed in Part C.
- **Never expose secrets.** Never print, log, commit, echo or put in client code the value of any key, token, signing secret, webhook URL or credential. Use variable names only; keep `.env.example` as placeholders. Keep `.env.local` out of git.
- **No fabricated success:** never say an order is placed, payment verified/paid, refund processed, order cancelled, parcel booked/shipped, or a message sent unless backend/provider state confirms it.
- **Security before convenience:** money, stock, payment status, order creation, order-tracking authorization, refunds, cancellations and delivery state are validated **server-side**; the model is never trusted to calculate or authorize.
- **Verify external facts at implementation time** — Gemini model IDs, SDK fields, WhatsApp/Messenger policy, payment gateways, SMS/courier APIs, prices. Record date + source. Names in this prompt are hypotheses.
- **No fake integrations:** where a provider credential is missing, build an interface + feature flag + mock + visible **"Not configured"** admin status, document the exact credentials/setup needed, and continue.
- **Fallback model only for transient / availability errors** (429, 5xx, timeout, retired model). Never hide invalid-request errors or key-level authentication/permission failures behind a failover: log the `errorCode`, alert the admin, and show the customer an honest message.
- **Runtime validation** of every request body and every tool argument (schemas, enums, lengths, limits). TypeScript types alone are not validation.
- **Language & currency:** customer-facing text in respectful Bangla (আপনি), English and Banglish input; ৳ (BDT); `Asia/Dhaka`; Bangladesh phone `01[3-9]XXXXXXXX` after normalizing `+880/880`, spaces and dashes; admin labels bilingual where the app supports it.
- **Customer experience:** friendly, concise, one missing question at a time, never re-ask known info, no fake scarcity or pressure, at most one emoji (none for complaints/security), out-of-domain politely redirected without exposing prompts.

---

# PART C — INVARIANTS: DO NOT BREAK (KEEP)

1. **Single product** with three weight variants. No other products/categories unless the admin configures them.
2. **`place_order` / `confirm_order` are never exposed to the model.** Orders are created only through: collected slots → server pricing → `prepare_order_summary` → Order Summary card → **customer clicks Confirm** → `/api/order` verifies a signed, 10-minute, single-use token + session ownership + idempotency key + live re-pricing / stock / coupon / delivery-fee revalidation → atomic commit (stock, order, token consumption, tracking projection). Typing "Yes / হ্যাঁ / OK / Confirm" never creates an order. Notifications fire after commit and never roll it back or duplicate it. Max 10 jars per order (above → human).
3. **Order tracking** needs Order ID + verified checkout phone; never expose full phone, address or other customers' orders. A sanitized `order_tracking` projection holds minimal data.
4. **Human handover** needs name + valid BD phone + issue summary + explicit consent; creates a ticket; optional owner notification. Complaint, damaged jar, refund/payment issue, bulk (>10 jars) and "talk to a human" always route here.
5. **Live data only from backend tools:** price, stock, coupon result, delivery fee/ETA, totals, order / payment / courier status, customer data. **Static knowledge** (story, process, storage, usage, policy explanation) may come from published RAG content. RAG never supplies live data.
6. **Shared response validator** on every path (Gemini and fallback): grounded amounts only (seeded from live settings), negation-aware claim guard driven by Admin **Approved Claims**, no cure/treat/heal/medical claims, PIN/OTP/CVV/password shield, prompt-injection and system-prompt shield, phone/URL grounding, language-consistency check.
7. **Store Facts** is the single source of truth for prompt, FAQ defaults and fallback text (versioned; version logged per turn).
8. **Honest telemetry:** errors flagged `isError`, fallback replies not counted as "AI answered", real `path` / `model` / `errorCode` / `finishReason` logged.
9. **Rate limiting** keyed on IP hash + signed device cookie + session (CGNAT-safe) with friendly 429 and Phone/WhatsApp buttons; persistent cost ledger and daily cap.
10. **Storefront** (bilingual, bag/checkout, track, batch verification, reviews, admin, design system `#FAF7F2 / #F2ECE1 / #1E1710 / #635647 / #B47B2B / #8A5A17`) keeps working.
11. **Payment truth:** a submitted TxnID or screenshot is never proof of payment; status stays `pending_verification` until a trusted provider or admin verifies.
12. **Draft vs published:** public visitors never read drafts, internal KB, chat logs, private orders, evidence or admin settings.

---

# PART D — THE WORK PLAN (do in this order; every ID maps to `PENDING_BACKLOG.md`)

Each item lists **what to do → acceptance → tests**. Where an item needs a real key, Java, credentials or a browser, build everything possible, mark the rest `🔒 not verified`, and keep it open.

---

## STAGE 0 — FREEZE AND VERIFY (no new features)

| ID | Do | Acceptance |
|---|---|---|
| **5-01** | Run `npm run lint`, `npm test`, `npm run test:chatbot`, `npm run build`. Produce a **"Phase 5–6 reality" table**: every file changed in Phases 5–6 (including `src/lib/integrations/*`, `/api/payments/*`, `/api/courier/*`, `/api/chat/tts`, `/api/integrations/status`, `/api/notifications/status`) → complete / partial / stub / broken, with test coverage. If the build is broken, make the smallest fix or put the unfinished piece behind a feature flag that defaults **off**. | The four commands pass, or their failing output is reported verbatim with a fix plan |
| **X-04** | `git init` (if not initialized); confirm `.gitignore` covers `.env*`; run `git status` and confirm no secret file would be committed (report names only); make a **baseline commit** ("baseline: state before remediation"). Per-task backfill is impossible — note this in the log; from now on one commit per item. | Clean repo, first commit exists, no secrets tracked |
| **0-11 (audit part)** | **Read-only deployed-state audit:** list which Firestore rules/blueprint are live vs the repo and whether they differ (Phases 4–5). Do not deploy. | Written diff summary; no deploy performed |
| **S0-secrets** | Scan the repo and client bundle for secret *patterns* (report file names only). Confirm `.env.local` is absent from the repo and `.env.example` has placeholders only. | Report: no secrets, or list of files to clean |
| **S0-backlog** | Place `PENDING_BACKLOG.md` in the repo root. | File present |

---

## STAGE 1 — CRITICAL (P0) FIXES

### 2-10 · Cancel / address-change must be confirm-gated (T2.6)
- `request_cancel` and `request_address_change` must **not mutate anything**. They only create a *pending change proposal* (same pattern as `prepare_order_summary`): a signed, single-use, expiring token bound to **session + order ID + exact change**.
- Verify identity first: Order ID + checkout phone (generic failure message on mismatch; never reveal whether the order exists).
- Show a **Change Summary card** with explicit refund impact and a **Confirm** button; only the Confirm path executes the change (server re-checks status, eligibility and ownership). Typed "yes" does nothing.
- Eligibility from backend state only: allowed while `pending / confirmed`; once dispatched/with courier → no promise, human handover.
- Paid bKash/Nagad order cancellation → **human handover**, no refund promise (2-11). Refund wording comes from owner-approved policy text (O-11); if absent, neutral "our team will review".
- Every executed change appends an audit entry (2-12).
- **Tests:** prompt-injection ("cancel order X", "change address of Y"), missing/wrong phone, token replay, expired token, session mismatch, post-dispatch lock, double-click, audit entry written, model cannot call a write path directly.

### 2-07 · Remove agent-invented business facts (T2.4) — also 3-07
- Search the code, defaults, prompts, fallback text and seed data for: dispatch cutoff (2 PM BST), zone fees/ETAs (suburban / remote / nationwide), free-delivery threshold, max jars, risk thresholds (high-value COD, velocity), delay windows, SLA numbers.
- Move every one to **Admin settings with an `ownerConfirmed` flag**. If unset or unconfirmed → the bot makes **no promise** ("I can't confirm the dispatch time right now; our team can") and Admin shows an "owner input required" badge.
- Delay/late-delivery evaluation (3-07) must use these owner-confirmed windows only.
- Add holiday/delay uncertainty wording; admin UI to edit all four zones (fee, ETA, cutoff).
- **Tests:** empty settings → no fee/ETA/cutoff promised and a clear handover; settings set → used everywhere (chat, checkout, track, fallback); no hard-coded business fact survives (grep test).

### 3-08 + X-11 · Session ownership and admin roles
- Session IDs must be unguessable (≥128-bit random) **and** bound to a signed HttpOnly cookie. `GET / DELETE /api/chat/session` and the 6-second poll must reject any request whose cookie does not match (404/403, no data, no existence leak).
- Rate-limit and back off the poll; make sure polling does not consume chat quotas or flood Firestore reads; stop polling when the tab is hidden or the session is idle.
- Document exactly who can read/write `chat_sessions`, `order_drafts`, `chatbot_feedback`, `support_evidence`, `order_audit_logs`, `order_fingerprints`.
- **Admin role model:** one server-side function checks verified admin identity (verified email / allowlist / custom claim) on **every** admin route; Firestore rules match it. No client-side-only checks.
- **Tests:** foreign `sessionId` → no draft, no agent replies; unverified-email admin spoof → denied; every admin route rejects anonymous and non-admin callers.

### 2-02 + 2-03 · Prove the order gate (T2.2)
- Stock decrement + order creation + token consumption + idempotency record + tracking projection in **one atomic transaction/batched commit**; verify no lost updates on `store_settings/main` under contention.
- Named tests (must appear by name in the report): `retry_creates_one_order`, `double_click_one_order`, `token_replay_rejected`, `typed_yes_creates_no_order`, `concurrent_last_unit_one_winner` (N parallel requests for the last unit → exactly one order, others 409 `outOfStock`), `stale_price_409_with_fresh_token`, `coupon_usage_cap_atomic`.
- **Acceptance:** zero duplicate orders in the retry/concurrency tests; typing Yes never creates an order.

### 5-02 · Re-verify the order route touched in Phase 5
- Review the full diff of `app/api/order/route.ts` (and `chat/route.ts`, session store, `firestoreRest.ts`). Any change must be non-authoritative (e.g. attribution fields). If a change affects pricing, stock, token, idempotency or commit logic, revert it or justify it.
- Re-run all 2-02/2-03 tests plus the full suite.

### 0-01 · Split the health endpoint (T0.1)
- Public `/api/health`: only `ok` + coarse status. Model names, SDK version, warnings, probes and `?refresh=1` → **admin-authenticated only**; rate-limit probes and cache results so outsiders cannot burn API quota. No secret or value ever returned.
- **Tests:** anonymous gets minimal body; admin gets full diagnostics; anonymous `?refresh=1` does not trigger a probe.

### 3-01 · Identity checks on retention routes
- `/api/orders/reorder`, `/api/orders/review`, `/api/orders/refill-reminder` (and any new order-related route) require Order ID + checkout phone (or signed customer session) and rate limiting; generic failure on mismatch.
- **Tests:** wrong phone, missing phone, other customer's order, delivered-only gate for reviews, duplicate review blocked.

### 4-05 · Production-safe `start` script
- `scripts/next-cli.mjs` port-killing / lock-cleaning behavior is **development only**. Production `start` must be a plain `next start` honoring `PORT`/host and must never kill processes.
- **Test:** script test showing `start` contains no process-killing logic.

### 1-13 · Starter KB pack governance (T1.11/T1.12)
- Rename the button "Draft starter pack — owner review required". Everything seeded is **draft**; public RAG must never retrieve drafts. Add a **source/provenance** field per entry (where the fact came from in the repo/owner data); entries without provenance are flagged "unverified".
- Never auto-publish; publishing requires an explicit admin action and writes an audit entry. Owner reviews every entry (O-04/O-03/O-05).
- **Tests:** draft never retrieved by public chat; publish flow audited; unverified flag visible.

### O-13 guard · Placeholder store facts must never reach customers
- Strings like "Configure in Admin", empty `googleMapsUrl`, placeholder bKash/Nagad/support/WhatsApp numbers must **never** be shown or used. Store Facts conflict/placeholder detector flags them in Admin; the bot says it can't confirm and offers handover; checkout shows no payment number until configured.
- **Tests:** placeholder values → no number in any reply, card or page.

### 0-11 · Emulator rules suite + 5-10 · Deploy hold
- Write Firestore rules tests that run with the Emulator (e.g. `firebase emulators:exec`) for: the **12 adversarial cases** in `security_spec.md` (expected `PERMISSION_DENIED`) **plus every collection added later** (chat_sessions, order_drafts, knowledge_chunks, chatbot_feedback, support_evidence, order_fingerprints, order_audit_logs, order_review_claims, refill reminders, campaigns, channel/webhook collections, cost ledger). Include append-only audit logs and no-public-read evidence.
- Java is not installed in the sandbox: write the tests so the **owner can run them locally**, include exact run instructions, and keep the item open (🔒 Java).
- **5-10:** do not deploy any rules/blueprint. When tests pass, present the deploy request (Process rule 1).

**Stage 1 exit:** summary report + updated backlog + all P0 items either `[x]` with evidence or explicitly `🔒`.

---

## STAGE 2 — PHASE 0 AND PHASE 1 GAPS

| ID | Do | Acceptance / tests |
|---|---|---|
| **0-02** | Verify `gemini-4-hydrogen` and `gemini-3.1-flash-lite` with the **models list API** (SDK compatibility ≠ availability); record date + source. 🔒 key | Health/admin shows verified yes/no per model |
| **0-03** | Update `estimateGeminiCostUsd` rates from official pricing as config/env values | Unit test of cost math; rates not hard-coded |
| **0-04** | Classify retired-model 404 as `gemini_model_retired` with admin-visible message | Mock 404 → correct code + banner |
| **0-05** | README rollback plan: switch model by env only, no code redeploy | Doc present |
| **0-06** | Real forced-failover smoke test (primary error → fallback). 🔒 key | Log of real run, or "not verified" |
| **0-07** | Named tests: token tamper, replay, expiry, session mismatch; tool rounds 0 / 1 / 4 / 5 / >5 | Tests listed by name |
| **0-08** | Decide and document whether coupon amounts are seeded into verified amounts or tool-grounded only | Documented decision + test |
| **0-09** | Rate-limit values editable from admin/config; verify order draft survives session rollover | Tests incl. CGNAT (many users, one IP) |
| **0-10** | Prove cost ledger uses atomic increments (Firestore increment/transaction) | Concurrency test |
| **0-12** | Review existing admin chat logs; quantify top failure codes | Short report with counts |
| **0-13** | Find root cause of the **36-second greeting turn** (model, thinking level, tools on greeting, cold start); measure p50/p95 with a real key; set a target and enforce it | Latency report; 🔒 key |
| **1-01** | **T1.6 Structured Response Contract:** Gemini returns schema `replyText, intent, confidence, needsHuman, sources, suggestedReplies, productCardIds, orderDraftStatus, actions`; price, total, coupon outcome, order ID, payment status and tracking are populated by the backend only; model-supplied values are rejected. (Check whether `src/lib/chatbot/schema.ts` is this or schema.org and separate them.) | Schema-validation tests; forged money fields rejected |
| **1-02** | Real embeddings (Gemini embedding model): verify name, cost, quota, regional availability, retention; keep the custom vector as offline fallback. 🔒 key | Retrieval benchmark rerun with both |
| **1-03** | Retrieval benchmark ≥ 50 built from the owner's **real** questions (O-05); report top-3 accuracy honestly | Benchmark file + result |
| **1-04** | Tests for mixed in/off-domain questions (answer only the Deshi Gee part + polite boundary note) | Bangla / Banglish / English cases |
| **1-05** | Confirm default `languageBehavior` (target: Bangla-script; owner decides O-09); add a Banglish detector test set (spelling variants, Dhaka/Chattogram) | Test set + documented default |
| **1-06** | Make the state machine explicit: `collecting_details → quote_ready → awaiting_confirmation → confirmed / expired / cancelled`; test correction ("earlier number was wrong, use this one") | State-transition tests |
| **1-07** | Audit-log every tool call in `agent_audit_logs` (sessionId, toolName, argumentsHash, outcome, actor, timestamp) | Log written per tool call, no PII in hash |
| **1-08** | Confirm streaming uses real `generateContentStream`; prove prices, phones, claims, secrets and success claims are never streamed before validation | Tests with unsafe content mid-stream |
| **1-09** | Admin queue also receives unanswered, low-confidence, guard-blocked and fallback answers; "Export Regression JSON" creates a **runnable** test case | Round-trip test |
| **1-10** | Order Summary card: Edit + Confirm + expiry; welcome chips; accessibility pass (keyboard, labels, contrast) | UI test / checklist |
| **1-11** | Analytics: chat→order funnel, summary→confirm, AOV, variant mix, AI spend per chat/order, checkout abandonment, channel split (coordinate with 5-07) | Deduplicated events; no retries counted |
| **1-12** | Playground runs the full saved test suite | One-click run + report |
| **1-14** | Add Phase 1 cases to `npm run test:chatbot`: correction, multi-slot, language switch, session resume, streaming claim block, mixed questions, Banglish | Count grows beyond 56 |

---

## STAGE 3 — PHASE 2 AND PHASE 3 GAPS

| ID | Do | Acceptance / tests |
|---|---|---|
| **2-01** | Prove the 12-step journey: privacy reassurance before phone/address; owner notification event; customer confirmation message; Track Order link + support path; success only after persisted order ID; **max 10 jars across mixed variants** (above → human) | End-to-end test per step |
| **2-04** | District typo → **ask the customer** ("Did you mean Chattogram?"); never silently map and price from a guess | Tests: Chitagong, Shylet, unknown |
| **2-05** | Collect and validate thana / upazila; controlled suggestions where data exists | Tests |
| **2-06** | Duplicate flow: customer is **asked** or routed to review, not blocked; `order_fingerprints` use **keyed HMAC** (plain phone hashes are brute-forceable); retention/cleanup rule | Tests + rule |
| **2-08** | Coupon `usedCount` atomic with order creation; reasons shown (expired / inactive / minimum not met / cap reached) | Concurrency + message tests |
| **2-09** | COD verification stays "Not configured" until a provider is chosen (O-10); risk thresholds admin-configurable and owner-confirmed; low-risk path not slowed; transparent reasons, human/appeal path, retention limits; never auto-reject or blacklist | Tests |
| **2-11** | Paid-order cancellation → handover; no refund promise (see 2-10) | Tests |
| **2-12** | `order_audit_logs` append-only in rules (no update/delete/public read) | Emulator test |
| **2-13** | Order-flow cases in `test:chatbot`: multi-variant, correction, price change, out-of-stock, duplicate, cancel, address edit, zone typo, coupon reasons | Count grows |
| **2-14** | Tool catalog (now > 26): runtime schema validation, timeout, audit log on **every** tool; no tool can create an order or run a write without the Confirm path | Table of tools × controls |
| **3-02** | Return/refund eligibility questionnaire from real policy + order data; product-complaint category flow (quality/safety allegation → human, no verdicts) | Tests |
| **3-03** | Ticket carries summary + order ID + validated phone + issue category so customers don't repeat; transcript attached only with consent; `assignedTo` + priority fields; response-time expectation only from Admin-configured SLA | Tests |
| **3-04** | `support_evidence`: retention/deletion rule; no public read/list; size/type/signature checks; Emulator test. 🔒 Java | Rule + test |
| **3-05** | Refill reminder: quiet hours, frequency cap, suppression/opt-out list, consent record | Tests |
| **3-06** | Add Phase 3 conversations (payment dispute, damaged jar, late delivery, human request, refund claim) to `test:chatbot` | Count grows |
| **3-09** | CSV export (orders, tickets): admin-only, audited, minimal PII, formula-safe | Tests |
| **3-10** | Refill webhook payload minimizes customer PII; failures stay retryable; no schedule advance on failure | Tests |

---

## STAGE 4 — MASTER-PLAN PHASE 4: PAYMENTS AND COURIER (interfaces + mocks now; live later)

Live integration needs merchant/API credentials (O-15). **Do not fake it.** Build the provider layer, feature flags, mocks and test fixtures; show **"Not configured"** in Admin until real credentials exist and a real sandbox test passes.

**UPDATE:** the agent has already written live-gateway code for SSLCommerz, bKash, Steadfast, Pathao, RedX, BulkSMSBD, Twilio and Resend. Do **not** rebuild it. **Audit, harden and test it** (Stage 4B), add the provider interfaces, mocks and fixtures that are missing, and keep every integration inert and labeled "Not configured" until a real sandbox test passes. The requirements below remain the acceptance criteria.

### 4-01 · Payments (T4.1)
- Provider interface (`PaymentProvider`): `createCheckoutSession`, `verifyPayment`, `getPaymentStatus`, `requestRefund`, `verifyWebhook`. Implementations: `Manual` (current bKash/Nagad merchant number + TxnID, status `pending_verification`), `Mock` (for tests), and stubs for bKash, Nagad, SSLCommerz, ShurjoPay. **Check current official docs for each before coding; record date + source.**
- `payments` collection: `paymentId, orderId, provider, txnId, amount, currency, verificationStatus, webhookEventId, createdAt, verifiedBy`.
- Webhook handler: signature verification, timestamp check, **event-ID dedupe**, order-reference + amount + currency + merchant-account validation, idempotent processing, reconciliation job. Replay or malformed events rejected.
- Chat tools: `get_payment_status` (read), `verify_payment` / `request_refund` (server-only / human-approved); the bot never says "paid" or "refunded" from a TxnID or from its own reasoning.
- Never collect PIN / OTP / CVV / card number in chat; remind customers never to share them.
- **Tests:** signature valid/invalid, replay, duplicate event, amount mismatch, TxnID alone ≠ verified, provider not configured.

### 4-03 · Payment lifecycle, receipts, review queue (T4.3)
- States: `unpaid, pending, verification_required, paid, failed, expired, refunded, partially_refunded` (map onto the current schema safely, with migration).
- Optional receipt screenshot: strict type / size / magic-byte / filename checks, private storage, retention rule, admin-only access; vision/text extraction never counts as verification.
- Admin **payment-review queue**: evidence, status, timestamps, actor, audit history; refund / replacement workflow with audit.
- Payment-failure recovery instructions that never mark an order paid.
- **Tests:** state transitions, receipt validation (spoofed MIME), access control, audit written.

### 4-02 · Courier (T4.2)
- `CourierProvider` interface: `createConsignment`, `getTracking`, `verifyWebhook`, `requestRedelivery`. Priority **Steadfast → Pathao → RedX**; others only after official API validation. Keep `Manual` mode (current fields) and a `Mock`.
- `shipments` collection with `courier, consignmentId, trackingNumber, status, scanEvents[], bookingPayloadRef`; idempotent webhook/poll sync; failed-delivery, returned-to-origin and delay flows → customer notice + human option; COD-collection sync and reconciliation; admin retry for failed bookings; credentials only in server env/secret manager.
- Order number and courier tracking number shown separately. **Never say "on the way", give an ETA, or invent scan events without a tracking number and live status.**
- **Tests:** idempotent webhook, status mapping, failed delivery, no-tracking-number wording, provider not configured.

### 4-04 · Courier link safety
- Tracking URLs entered by admins: `https://` only **and** an allowlist of courier domains (configurable); reject everything else; render with `rel="noopener noreferrer"`.
- **Tests:** `javascript:`, `http:`, look-alike domains, unicode tricks.

---

## STAGE 4B — AUDIT OF THE AGENT-ADDED INTEGRATIONS (Phase 6 items)

| ID | Do | Acceptance / tests |
|---|---|---|
| **6-01** | **Payments code audit** (`paymentGateway.ts`, `/api/payments/initiate`, `/api/payments/callback`). Verify every endpoint, field, hash and signature rule against the **current official SSLCommerz and bKash docs** (record date + source) and run in the provider **sandbox** (🔒 credentials). Amount, currency and order reference always come from the server; the callback validates signature/hash, order reference, amount, currency and merchant/store ID, then confirms with the provider's server-to-server validation API; a browser redirect never marks an order paid; processing is idempotent by transaction/event ID; replay rejected; a TxnID alone is never "verified"; the order-creation path is untouched; unconfigured → buttons hidden / "Not configured" | Tests: forged callback, replay, amount mismatch, wrong order, duplicate IPN, redirect without IPN, unconfigured, provider timeout |
| **6-02** | **Courier auto-book + webhook audit** (`courierApi.ts`, `/api/courier/book`, `/api/courier/webhook`). Verify against current official Steadfast / Pathao / RedX docs (date + source). Booking is admin-only, audited and **idempotent** (no double booking on retry/double click); payload built from server order data; COD amount = server total; webhook authenticated with a timing-safe secret compare plus replay/dedupe and status mapping; a failure leaves the order unchanged and retryable; never state "booked / shipped / on the way" unless the provider returned a consignment ID and live status; tracking-URL domain allowlist (4-04) | Tests: double click, provider failure, forged webhook, replay, status mapping, no-consignment wording, unconfigured |
| **6-03** | **SMS / email gateways** (`messagingGateway.ts`): consent + opt-out + suppression list, quiet hours, frequency caps, DND awareness, approved templates, PII minimization, cost cap, delivery status logged; never ask for wallet PIN/OTP; unconfigured → inert | Tests: suppressed user not messaged, quiet hours respected, cap enforced |
| **6-04** | **TTS route** (`/api/chat/tts`): rate limit + device cookie, text-length cap, only already-validated assistant text (never raw user input, secrets or PII), cost ledger + daily cap, honest failure message, caching without personal data | Tests: abuse burst blocked, oversize rejected, cost counted |
| **6-05** | **Voice dictation:** browser speech APIs may send audio to third parties → show a privacy notice; transcript visible and editable before sending; an order-affecting transcript is never auto-submitted | UI test |
| **6-06** | **Claim templates** (+BSTI, +Lab PDF): create **draft** entries that require owner evidence + expiry; never auto-approved; the guard keeps blocking until approved; audit history written | Test: template entry does not unlock a claim |
| **6-07** | **Latency:** timeouts were raised to 15 s per request / 28 s per turn with a 60 s circuit breaker. Re-measure p50/p95 with a real key, set an acceptable target, keep an honest loading state; test circuit-breaker open/close and fallback across tool rounds (ties to 0-13) 🔒 key | Latency report |
| **6-08** | **Status routes** (`/api/integrations/status`, `/api/notifications/status`) and the readiness matrix: admin-only; never return secret values or URLs; no probe amplification | Test: anonymous denied |
| **6-09** | **Rules deploys:** Phases 5 and 6 deployed rules without approval (≥ 7 total). Freeze deploys; read-only diff live vs repo; Emulator tests before any further deploy (links 0-11, 5-10) | Diff report; no deploy |
| **6-10** | **Gemini error classification / failover:** the agent added failover on model-level 403 and a circuit breaker. Fallback only for transient / availability errors; a key-level 401/403 must raise an admin alert and an honest customer message, not be hidden by failover; `errorCode` logged on every switch | Tests: 400, 401, 403-key, 403-model, 404-retired, 429, 5xx, timeout |

---

## STAGE 5 — PHASE 5: CHANNELS AND RETENTION (finish after Stage 0 verification)

Without Meta credentials the channels must show **"Not configured"** and be inert. The agent now reports Phase 5 as complete (108 tests, build pass): **verify each row below by name** (signature, replay, consent, auth) instead of accepting that claim.

| ID | Do | Acceptance / tests |
|---|---|---|
| **5-03** | **Messenger / Instagram (T5.1):** official Meta APIs only; `X-Hub-Signature-256` verification, replay/duplicate dedupe by event ID, retries, message-status handling, per-channel rate limits, consent; reuse the same tools, guards, order draft and handover; no scraping or browser automation | Signature valid/invalid, replay, duplicate, rate-limit, unconfigured |
| **5-04** | **WhatsApp Cloud API (T5.2):** first **verify the current official policy** (task-specific customer-support bots only; general-purpose assistants not allowed), template categories and pricing, opt-in, 24-hour service window; keep the bot strictly Deshi Gee shopping/support; link a WhatsApp/Messenger identity to an order **only after phone verification** | Policy note with date + source; window/template tests |
| **5-05** | **Consent-based retention (T5.3):** abandoned chat/cart recovery, reorder nudge, broadcasts — opt-in/out, suppression list, frequency caps, quiet hours, audience filtering, template compliance; `/api/retention/campaigns` **admin-authenticated**; no manipulative urgency | Tests incl. unauthenticated call denied |
| **5-06** | **schema.org / SEO (T5.4):** Product / Organization / FAQ markup using **only owner-approved facts** (no invented ratings, reviews, certifications); `robots.ts` and sitemap exclude `/admin`, `/api`, `/track` and any private route | Test of generated JSON-LD and robots output |
| **5-07** | **Funnel + attribution (T5.5):** chat started → product info → order intent → summary → confirm → delivered; deduplicated; no retries/duplicates/unconfirmed orders counted as conversions; revenue attribution by channel | Dedupe tests |
| **5-08** | **Shared omnichannel inbox (T5.6):** web + Messenger + Instagram + WhatsApp in one admin inbox; identity matching only when safe; AI pause/resume per conversation; assignment, tags, internal notes, SLA | Tests |
| **5-09** | Optional, lowest priority: Bangla voice input, image understanding of customer photos (never proof of authenticity or payment), staff reply-assist, email/SMS notifications (check provider cost / DND / consent), agentic-commerce readiness (UCP/ACP — only after current workflows are stable) | Do last, only if time |

Do not change anything on the order-creation path while doing Phase 5 (see 5-02).

---

## STAGE 6 — CROSS-CUTTING WORK

| ID | Do | Acceptance |
|---|---|---|
| **X-01** | **T0.0:** full Feature Coverage Matrix with columns `Category · Feature · Existing state (Exists & verified / Exists but needs repair / Missing / Future) · Evidence/file · Gap or bug · Priority · Dependency · Proposed action · Test required`, covering every feature in the master prompt; plus a ranked root-cause report (severity, exact file/function/line, evidence, confirmed vs suspected, customer impact, fix, regression test) | Two documents committed |
| **X-02** | **F22 admin gaps:** product master (name BN/EN, description, ingredients, usage, origin, packaging, storage, shelf life, approved claims, images), variants & inventory (SKU, weight, price, stock, low-stock threshold, active/inactive, stock-adjustment audit trail), delivery rules, policy lifecycle (owner, version, language, effective date, review date, status), agent-skill switches (enable/disable order, tracking, returns, handover), staged publish + rollback, analytics widgets | Each module present or explicitly marked missing |
| **X-03** | **Part-7 mapping:** a table showing which task covers each of: admin modules (§A), data model (§B), tool catalog (§C), security (§D), KPIs (§E), QA (§F), market research (§G), Bangladesh rules (§H), and the acceptance criteria | Table with no empty rows |
| **X-05** | Architecture diagrams (Mermaid): chat flow, order flow, payment flow, courier flow, handover flow | Diagrams in docs |
| **X-06** | Docs: architecture, environment guide (names only), admin setup guide, KB format, payment / courier / channel integration guides, security + data-retention guide, test/evaluation guide, **deployment + rollback checklist**; README notes (env names, how to generate `ORDER_TOKEN_SECRET` with `openssl rand -hex 32`) | Docs committed |
| **X-07** | Market comparison research (Tidio/Lyro, Intercom Fin, Gorgias, Bitespeed, Sobot, Alhena, SeloraX, Pathao Commerce, F-commerce platforms): compare by capability; separate official documentation / independent evidence / vendor-reported claims; no vendor uplift or market-size claim presented as fact; dated sources | Short research doc |
| **X-08** | App Check or CAPTCHA on public write routes; origin/CSRF validation; payload limits; abuse monitoring that does not punish shared-IP users | Tests |
| **X-09** | Data retention / deletion / export, backups, incident-response notes; update Privacy / Terms copy for chatbot data and consent (draft for owner review, O-16) | Policy doc + cleanup jobs |
| **X-10** | Production hosting plan (host, domain, HTTPS, Firebase authorized domains, secrets storage, rollback). The AI Studio preview is **not** production. Present options and wait for the owner (O-17) | Decision recorded |
| **X-12** | Load test ≈ 100 concurrent users on chat and order paths (p50/p95, error rate, rate-limit behavior, cost); real-phone / mobile-network checklist for the owner | Report |
| **X-13** | Grow `test:chatbot` well beyond 56; run it in CI before every deploy. It must include at least these scenarios: language (দাম কত?, dam koto?, How much is 500g?), variant mapping (অর্ধেক কেজি, 1 kilo ase?), stock 0, price change mid-chat, coupon reasons, delivery zone + typo, multi-slot message, correction, typed "Yes" without button, duplicate/retry, MFS TxnID pending (never "paid"), tracking with wrong phone, handover, damaged jar, prompt injection, unsupported claim, negated claim, paraphrase retrieval (5–10 variants), empty knowledge, outage fallback, multi-turn + refresh, `MAX_TOKENS`/empty reply, tool-limit, guard grounding, cancel/address-change injection, session theft, CGNAT, webhook duplicate, forged/replayed payment callback, forged courier webhook, TTS abuse | Count + category table in the report |

---

## STAGE 7 — RELEASE READINESS

- Run the full suite, build, load test and the Emulator rules suite (owner-run if Java is missing); publish a **final report** (Part G).
- Walk the **Go-live checklist** in `PENDING_BACKLOG.md` §9 with the owner. Recommend a **7–14 day limited-traffic pilot** with daily review of bad answers, unanswered questions, guard blocks, fallback rate, latency and spend; a responsible person assigned to tickets; daily cost cap verified.
- Prepare the **owner operations guide**: how to switch models, update Approved Claims, handle tickets, read the dashboard, rotate secrets, roll back.

---

# PART E — OWNER ACTIONS (the agent cannot do these — remind, never fake)

At the start and end of every stage, print the list of owner items that are still open, with the exact instruction to complete each.

| ID | Owner must |
|---|---|
| **O-01** | Create a **test Gemini API key** and put it only in `.env.local` / hosting secrets |
| **O-02** | Install **Java** (or provide a machine) so the Firestore Emulator suite can run |
| **O-03** | Confirm **BSTI license / lab PDF, A2 / Organic claims, Eid/festival dispatch cutoff, verified Dhaka pickup Google Maps URL** |
| **O-04** | Provide delivery zones: fee + ETA for Dhaka, suburban (Savar/Ashulia…), nationwide, remote; the daily dispatch cutoff; free-delivery threshold; max jars per order |
| **O-05** | Provide 20–30 real customer questions with correct answers (benchmark + KB) |
| **O-06** | Set production `ORDER_TOKEN_SECRET` (32+ random characters), the Gemini key and `CRON_SECRET` |
| **O-07** | Rotate any key ever shared in a zip, repo or chat |
| **O-08** | Appoint a person responsible for tickets and handover |
| **O-09** | Decide the default `languageBehavior` (Bangla script vs mirror Banglish) |
| **O-10** | Choose a COD-confirmation provider (or keep it off); set the high-value-COD threshold |
| **O-11** | Approve refund wording for bKash/Nagad cancellations |
| **O-12** | Confirm the SLA targets (chosen earlier: Standard 2 h / Urgent 30 min, business hours) are the real ones |
| **O-13** | Replace placeholders in Admin: `bkashNumber`, `nagadNumber`, `supportPhone`, `whatsappNumber`, `businessAddress`, `googleMapsUrl` |
| **O-14** | Set a scheduler that calls the refill dispatch endpoint daily (with `CRON_SECRET`); set webhook URLs (`OWNER_WEBHOOK_URL`, `WHATSAPP_WEBHOOK_URL`, `EMAIL_WEBHOOK_URL`, `GOOGLE_SHEETS_WEBHOOK_URL`) if wanted |
| **O-15** | Obtain provider access when ready: bKash / Nagad / SSLCommerz / ShurjoPay merchant credentials; Steadfast / Pathao / RedX API keys; Meta app + WhatsApp Business setup |
| **O-16** | Review Privacy / Terms / Return-policy pages for chatbot data, consent and refund wording |
| **O-17** | Decide the production hosting target (X-10) |
| **O-18** | Provide credentials **only via server env / secret manager (never in chat or git)** when ready: SSLCommerz (store ID/password), bKash (app key/secret, username/password), Steadfast / Pathao / RedX API keys, BulkSMSBD / Twilio / Resend keys, Meta + WhatsApp (`META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`), `NEXT_PUBLIC_SITE_URL`, optional `GEMINI_DAILY_COST_CAP_USD`. Run each provider's sandbox first. |

**Owner spot checks before launch:** place one real test order end to end; confirm logged-out visitors cannot read `orders`, `order_audit_logs`, chat logs or evidence; try typing "Yes" without clicking Confirm.

---

# PART F — EVIDENCE AND TESTING POLICY

- **Evidence** = command + real output summary (counts, exit code) + commit ID. Paste actual numbers. Never write "tests passed" without running them.
- Label every test **mock**, **offline-static** or **live**. Mock/static results never close an item that requires live proof; keep it open as "not verified".
- Required automated coverage: unit (pricing, delivery, coupon, number formatting, normalization, phone validation, claim guard, domain guard, language detection, monetary guard); tool schema + execution for **every** tool; integration (prepare → confirm → persistence → tracking projection); token replay, idempotency, race and concurrent-stock; Firestore rules (Emulator); webhook signature / replay / idempotency; KB chunking, retrieval, publish isolation, access control; load and latency; a regression test for every bug fixed.
- After every item run: `npm run lint` (typecheck), `npm test`, `npm run test:chatbot`, `npm run build`. Report failures verbatim.
- Metrics hygiene: do not count retries, repeated messages, duplicate events or unconfirmed orders as conversions; deduplicate; privacy-conscious identifiers.

---

# PART G — REPORTING

**After every item** (short):
`ID · files changed · behavior change · tests added/run (command + result + label mock/static/live) · commit · risks · what is still open`

**After every stage:** a summary table (items closed / still open / blocked), release-gate checks pass/fail, the updated `PENDING_BACKLOG.md`, and the open Owner-actions list.

**Final report** (end of Stage 7):
1. What changed (with file references) · 2. Updated feature matrix with verified statuses · 3. Bugs fixed · 4. Features added vs still missing · 5. Test commands and real results · 6. Production build status · 7. Environment variables / third-party credentials still needed (names only) · 8. Items skipped or blocked and why · 9. Database / rules migration steps · 10. Security risks and remaining limitations · 11. Recommended next phase · 12. Owner operations guide.

---

# PART H — FINAL ACCEPTANCE (do not call the project production-ready until all pass)

**AI answers:** price, stock, delivery, payment, policy, contact and hours grounded in backend data; Bangla / Banglish / English behave per policy; no fabricated claims, prices, contacts, order/payment/courier statuses or delivery promises; injection and secret requests refused; valid negated claims not blocked; tool loops and `MAX_TOKENS` never end in an empty or misleading reply; outages give a clear, logged, friendly fallback.

**Orders & payments:** no order from typed "Yes"; token cannot be replayed; duplicate submissions create one order; price/discount/fee/stock/total revalidated server-side; payment stays pending until a trusted provider or admin verifies; cancel / address-change only via identity check + Confirm click; status never fabricated or shown to the wrong person.

**Service:** return / replacement / payment / damaged-item cases route per policy; handover tickets carry consent and context; courier statuses come only from the provider or verified admin input; channel consent and opt-out respected.

**Admin & security:** public visitors cannot read private orders, drafts, internal KB, chat logs, evidence or admin settings; every admin route authenticated, authorized and audited; no secrets in bundles, logs or git; rate limits fair to shared IPs; uploads, callbacks, webhooks and provider events validated and idempotent; **no live deploy happened without written approval.**

**Engineering:** lint / test / build reported truthfully; regression tests cover every repaired defect; 50+ (growing) multilingual cases runnable in CI; no critical known issue silently ignored; documentation explains configuration, deploy and rollback.

---

# PART I — FIRST RESPONSE (do this now)

1. Confirm you have both attached files and list the files you actually inspected.
2. Do **Stage 0** completely and report (including the Phase 5–6 reality table). **Do not deploy.**
3. Print the Owner-actions list (Part E) with what is blocking you right now.
4. Proceed through Stage 1 → Stage 7 in order, one item at a time, one commit per item, updating `PENDING_BACKLOG.md` with evidence. Ask a question only for a genuinely blocking owner decision or a missing credential; otherwise use a documented safe default (never a business fact) and continue.
5. Never claim an integration is live without a real end-to-end test. Never claim a phase is complete without evidence.

**FINAL RULE:** preserve every working capability in Part C; fix before you extend; verify instead of assuming; mark anything unverified as unverified; and never invent business facts, expose secrets, deploy without written approval, or bypass the customer's explicit Confirm click.
