# Single-Product COD Commerce OS — Phase 01 Audit & Roadmap

**Scope:** inspect the existing Deshi Gee project against the 22-module "Single Product E-Commerce Operating System" specification, then define what to keep, what to build, and in which order.
**Status:** Phase 01 (audit) only. No product code was changed for this document.
**Method:** static review of `app/`, `src/`, `firestore.rules`, `tests/`, `docs/`, plus live inspection of the storefront and admin in the browser. Nothing below claims an integration works unless a test proves it.

---

## 0. Executive summary

The project is already a solid **single-product COD storefront with a Gemini chatbot**, built on **Next.js 16 + Firebase Admin SDK + Firestore**. About **35–40 %** of the target platform exists in some form. The largest gaps are the things that make it an *operating system* rather than a storefront: **RBAC, landing-page CMS, package model, COGS/profit, leads, COD settlement, real-time alerts, and financial reporting.**

Two facts shape the whole plan:

1. **The spec asks for a relational schema; the project runs on Firestore (NoSQL).** The spec also says *"do not blindly replace the existing stack."* The plan below therefore maps every spec table to a Firestore collection with the same integrity guarantees (transactions, snapshots, unique keys). A move to Postgres is possible but is a separate, larger decision (see §7, Decision D1).
2. **The package model is hard-coded** (`WeightKey = '250g' | '500g' | '1kg'`, stock counted in *jars*, not grams). Almost every spec module (package manager, gram-based inventory, COGS, package reports) depends on replacing this with a data-driven `packages` collection. This is the **critical-path change** and must be done with a backward-compatible migration.

---

## 1. Coverage matrix — spec modules vs. what exists

Legend: ✅ exists and works (by tests/mocks) · 🟡 partial · ❌ missing · 🔒 exists but unverified live (needs credentials / emulator).

| # | Spec module | Status | What exists today | Main gap |
|---|---|---|---|---|
| 01 | Funnel overview & daily profit | 🟡 | Admin Overview: total orders, pending, confirmed, delivered, sales; "needs attention" shortcuts | No date filters, charts, funnel, returns/cancel rates, AOV, ad spend, COGS, **no profit calculator** |
| 02 | Landing-page live CMS | ❌ | All copy/FAQ/benefits/images are hard-coded in `src/data/deshiGeeData.ts` and `HomeStorefrontView.tsx`; only price/stock/contacts editable | No section model, no draft/publish/version/preview, no reorder |
| 03 | Product & package manager | 🟡 | Price/stock/delivery form for 3 fixed sizes | Fixed 3 keys; no COGS, SKU, badges, offer price, per-package images, gram stock |
| 04 | Inventory | 🟡 | Per-size jar stock; atomic decrement/restore on order/cancel | No movements ledger, reserved/damaged/returned, batches, purchases, low-stock alerts |
| 05 | Embedded COD checkout | ✅ | COD-only drawer: name, phone, district, address; server price validation; idempotency; double-submit guard; token replay protection; stale-price 409 | Uses cart drawer (not inline one-page form); zones are fixed 4; no configurable optional fields; no Thank-You page |
| 06 | Incomplete leads | ❌ | Chatbot keeps `order_drafts`/`chat_sessions` (not leads); checkout draft only in browser `localStorage` | No progressive capture, consent notice, lead CRM, statuses, conversion |
| 07 | Order management | 🟡 | List, search, status filters, detail panel, status/payment update, courier fields, audit history, CSV export, print receipt | Statuses limited to 6 (missing packaging, ready-to-ship, out-for-delivery, failed, returned); no manual order entry, bulk update, packing slip, thermal label, assignment |
| 08 | Fake-order protection | 🟡 | Risk score + signals, duplicate fingerprint, manual-review queue, per-IP/phone rate limits | No configurable rules UI, no blocked phone/IP lists with expiry/history, no captcha |
| 09 | Courier management | 🟡🔒 | Steadfast/Pathao/RedX provider interface, booking route, webhook with signature, URL allowlist | Credentials via env only (no admin UI/test connection/sync log), no bulk booking, labels, pickup, failed-delivery/return flow; **never tested live** |
| 10 | COD collection & settlement | ❌ | `paymentStatus: cod_due` only | No collection status, no settlement records, no discrepancy handling |
| 11 | Coupons & promotions | 🟡 | `CouponRecord` (percent, min subtotal, expiry, max uses), atomic usage cap, server validation | No fixed amount, package/quantity rules, first-order, flash sale/countdown, free-delivery promos, enable toggle |
| 12 | Notification control centre | 🟡🔒 | Template editor, per-event templates, durable queue + DLQ, Telegram/Discord/WhatsApp/SMS/email adapters, history | Event set differs from spec (no lead / COD-settlement events), no recipients manager UI parity, never sent live |
| 13 | Facebook Ads & tracking | 🟡 | Client-side `ViewContent/AddToCart/InitiateCheckout/Purchase` via gtag/GTM/fbq; purchase de-dup in memory | **No Meta CAPI**, no server event IDs, no admin config/test events/logs, Pixel/GA IDs not admin-configurable |
| 14 | Daily ad spend & expenses | ❌ | — | Entire module |
| 15 | Customer & lead CRM | ❌ | Orders carry customer fields; no customer entity | Customers collection, profiles, segmentation, tags, notes |
| 16 | Staff & permissions | ❌ | Single bootstrapped owner email + `admins/{uid}` doc; every admin is full admin | No roles, permissions, staff management, field-level hiding |
| 17 | Activity logs | 🟡 | `order_audit_logs` (append-only, rules forbid update/delete) | Orders only; no product/price/publish/settings/staff logging; no UI search |
| 18 | General settings | 🟡 | Store contact/delivery/payment settings, policy draft gate, `/api/health` diagnostics | No branding, SEO, maintenance mode, backups, queue/jobs monitor, timezone/language settings |
| – | Real-time order alerts | ❌ | Admin loads data on open + manual refresh | No listener/polling, no badge/sound/notification centre |
| – | Demo-data isolation | ❌ | Test fixtures only in `tests/` | No seeded demo environment, no reset |
| – | AI chatbot (not in spec) | ✅ | Hybrid RAG, guarded Gemini, live fallback engine, 72 regression cases | Keep as a value-add; must follow new package/price source |

---

## 2. Findings by severity

### Critical
| ID | Finding | Evidence | Impact |
|---|---|---|---|
| C1 | **Live Firestore rules are the weak set**; the locked Admin-SDK rules exist only as a proposal | `firestore.rules` vs `docs/rules-proposals/firestore-final-admin-sdk.rules` (~1,400 diff lines); root rules still allow client `create` on `orders`, `order_tracking` `get`, etc. | Anyone with the public Firebase config can write/read paths the server assumes are private. Must be fixed **before** storing leads/finance data |
| C2 | **No role-based access control** — every admin is a super admin | `firebaseAdmin.ts` (`BOOTSTRAPPED_ADMIN_EMAIL`, `admins/{uid}`); no role field | Spec requires call-agent/accountant/delivery roles that cannot see profit or secrets |
| C3 | **Admin dashboard talks to Firestore from the browser** with the client SDK | `src/lib/firebase.ts`, `adminRepository.ts`, `AdminDashboardView.tsx` | Permission checks (RBAC, field hiding, audit) cannot be enforced; blocks locking the rules down |
| C4 | **Production runtime not verified**: Admin SDK/IAM missing in dev ⇒ checkout and reviews return `503` | `/api/orders/storefront`, `/api/reviews/helpful` → 503 in browser | Orders cannot be placed until ADC + `roles/datastore.user` are configured |
| C5 | **Hard-coded package model** (`WeightKey`) | `src/lib/storeTypes.ts`, `orderToken.ts`, `firestoreRest.ts`, `tools.ts`, UI | Blocks package manager, gram inventory, COGS, reporting |

### High
| ID | Finding | Evidence |
|---|---|---|
| H1 | No COGS / cost snapshot on orders; no revenue-vs-cash separation | `OrderRecord` has `totalBdt` only |
| H2 | Order status model too small; status, collection and settlement not separated | `OrderStatus` has 6 values |
| H3 | All landing content hard-coded (CMS missing) | `deshiGeeData.ts`, `HomeStorefrontView.tsx` |
| H4 | No Meta CAPI / server-side tracking; Purchase de-dup is per-tab memory only | `src/lib/analytics.ts` |
| H5 | Courier & notification integrations never exercised against real providers | `PENDING_BACKLOG.md` (60 items "code done, live proof pending"); tests are mocks |
| H6 | `x-requested-with` header is the only guard on some public POSTs (not a security boundary); `cod-verify` had no throttling (fixed in commit `702a92b`) | `requestSecurity.ts` |
| H7 | Integration secrets are environment variables only; the spec requires admin-editable but **encrypted** credentials | `.env.example` |
| H8 | `firestoreRest.ts` is 5,500 lines and mixes every concern (name is historical; it uses the Admin SDK now) | `src/lib/chatbot/firestoreRest.ts` |

### Medium
| ID | Finding |
|---|---|
| M1 | Checkout lives in a cart drawer; the spec wants an inline one-page form (cart concept is unnecessary for one product) |
| M2 | Delivery zones fixed to four; no custom district charges or package-based free delivery |
| M3 | Customer entity absent; repeat-buyer data is derived ad hoc |
| M4 | Dashboard reads *all* orders client-side — will not scale past a few thousand orders; no pagination, no server filtering |
| M5 | In-memory duplicate/rate maps (`serverState.ts`) are not shared across serverless instances (Firestore rate limiter exists as backup) |
| M6 | Images 800 KB–1 MB, `images.unoptimized: true`, no WebP |
| M7 | `lint` script is only `tsc`; no ESLint, no CI |
| M8 | Unused deps already removed; `bun.lock` stale |

### Low
| ID | Finding |
|---|---|
| L1 | `package.json` name is `material-flask` |
| L2 | Owner email hard-coded in code and rules |
| L3 | Theme script triggers a React "script tag" console warning |
| L4 | Demo/test review ("asdfasdf") present in live data |
| L5 | Docs claim "glass jar" in places; sanitised in code, may remain in stored KB/FAQ documents |

---

## 3. What to preserve (do not rewrite)

- Order engine: transactional create, idempotency keys, token replay protection, stale-price refresh, atomic coupon cap, stock decrement/restore, tracking token hashing. (Covered by `stage3-order-gate` tests.)
- Admin SDK server layer (`firebaseAdmin.ts`, `adminRepository.ts`), fail-closed 503 behaviour.
- Notification engine & queue (`src/lib/notifications/*`), courier provider interface (`courierApi.ts`), webhook verification, risk scoring.
- Chatbot stack and its regression suite.
- 203 passing tests — they become the safety net for the migration.

---

## 4. Target architecture on the existing stack

### 4.1 Spec table → Firestore collection

Relational integrity is replaced by: Admin-SDK **transactions**, **deterministic document IDs as unique keys**, **order-time snapshots**, and **composite indexes** declared in `firestore.indexes.json`.

| Spec table(s) | Firestore collection(s) | Notes |
|---|---|---|
| users, staff_users, roles, permissions, role_permissions, user_role_assignments | `staff/{uid}`, `roles/{roleId}` | Role = list of permission keys; user doc stores `roleId` + overrides; mirrored into **custom claims** for fast checks |
| site_settings | `site_settings/main` | Extend existing `store_settings/main` |
| landing_sections, landing_section_versions | `landing_sections/{sectionKey}` (draft+published), `landing_versions/{versionId}` | Publish = copy draft → published in a transaction + new version doc |
| media_assets | `media_assets/{id}` | Metadata only; files in Cloud Storage; signed upload |
| faqs, reviews, testimonials | `faqs`, `reviews` (exists) | `reviews` gains `source`, `mediaType`, `verified`, `order`, `visible` |
| products, product_packages | `products/main`, `packages/{packageId}` | One flagship product; packages are first-class |
| inventory, inventory_movements, product_batches | `inventory/main`, `inventory_movements/{id}`, `batches/{id}` | Base unit = grams; movement ledger is append-only |
| customers | `customers/{phoneNormalised}` | Deterministic key = unique phone |
| orders, order_items, order_status_history | `orders/{id}` (+ embedded `items[]` snapshot), `order_status_history/{id}` | `items[]` snapshot holds package name/price/COGS/qty |
| incomplete_leads, lead_activities, customer_notes | `leads/{phoneNormalised}` (+ `activities` subcollection), `customer_notes` | Upsert by phone ⇒ no duplicates |
| courier_providers, courier_shipments, courier_tracking_events | `courier_providers/{id}` (encrypted creds), `shipments/{id}`, `tracking_events/{id}` | Real provider response required before "booked" |
| cod_collections, cod_settlements, cod_settlement_items | `cod_collections/{orderId}`, `cod_settlements/{id}` | Reference unique per courier ⇒ duplicate settlement blocked |
| coupons, coupon_usage | `coupons` (exists), `coupon_usage` | Extend rule fields |
| daily_expenses, ad_spend_records, financial_adjustments | `expenses/{id}`, `financial_adjustments/{id}` | Daily rollup docs `daily_stats/{yyyy-mm-dd}` for fast dashboards |
| notification_templates, settings, logs | existing notification collections | Add lead/COD events |
| blocked_users | `blocklist/{id}` | Phone/IP hash, reason, expiry, history |
| integration_settings, webhook_events | `integrations/{id}` (secrets AES-256-GCM encrypted), `webhook_events` (exists as `channel_webhook_events`, `payment_gateway_events`) | Key from env, never in client |
| activity_logs | `activity_logs/{id}` | Append-only; rules and server both forbid update/delete |
| automation_rules/logs | `automation_rules`, `automation_logs` | Optional, last |

### 4.2 Order model (additive, backward compatible)

```
status:            lead | pending | confirmed | packaging | ready_to_ship | sent_to_courier
                   | out_for_delivery | delivered | delivery_failed | returned | cancelled
collectionStatus:  awaiting | collected | partial | failed
settlementStatus:  pending | partial | settled | disputed
items[]:           { packageId, packageName, weightGrams, qty, unitPrice, offerPrice, cogsUnit }
totals:            subtotal, packageDiscount, couponDiscount, deliveryCharge, codAmount
source:            web | facebook_inbox | whatsapp | phone | manual | chatbot
```
Existing `OrderStatus` values stay valid; new values are added; legacy fields (`weight`, `qty250g`…) are kept readable during migration.

### 4.3 Package & inventory model
`packages/{id}`: name, weightGrams, regularPrice, offerPrice, cogs, sku, stockDeductionGrams, image, badges, default, enabled, freeDelivery. Inventory is stored in **grams**; available = total − reserved. Confirmation deducts `qty × weightGrams` in one transaction; cancel/return restores only after condition check.

### 4.4 Profit rule (as specified)
`Net = DeliveredRevenue − COGS(snapshot) − Packaging − Courier − AdSpend − OtherExpenses − Refunds`. Delivered ≠ cash received: COD receivable and settlement are shown separately. Estimates are labelled *Estimated*; manual corrections write `financial_adjustments` + `activity_logs`.

### 4.5 API groups (to be documented endpoint-by-endpoint in Phase 02)
`/api/admin/{dashboard,products,packages,inventory,cms,orders,leads,customers,risk,couriers,cod,settlements,expenses,marketing,notifications,staff,logs,settings}` and public `/api/checkout`, `/api/leads`, `/api/cms/published`. Every admin route: session auth → permission check → validation → rate limit → audit log. Pagination and server-side filters on all list routes.

### 4.6 Real-time alerts
Firestore `onSnapshot` on a small `admin_signals/orders` counter doc (written in the order transaction) → badge + toast + optional sound (user gesture gated). Avoids streaming PII to the browser.

---

## 5. Phased roadmap (re-ordered for dependencies)

Estimates are for one focused engineer; each phase ends with tests and a short QA note (Passed / Failed / Not configured / Needs manual verification).

| Phase | Goal | Depends on | Size |
|---|---|---|---|
| **0 – Foundations (new)** | Deploy locked Firestore rules after emulator tests; configure ADC/IAM; fix `503`; move admin reads/writes behind server APIs; session auth | — | M |
| **1 – Audit** | This document | — | done |
| **2 – Data & API architecture** | Collections, indexes, migration plan, endpoint docs, permission matrix | 0 | M |
| **3 – Admin design system** | Sidebar groups, top bar, search, charts, tables, forms, dark/light | 2 | M (partly done) |
| **4 – RBAC & activity logs** *(pulled forward)* | Roles, permissions, backend enforcement, full audit log | 0,2 | M |
| **5 – Packages & inventory** | `packages`, gram stock, COGS, movements, batches; migrate order engine | 2,4 | **L** |
| **6 – Checkout & leads** | Inline COD form, progressive lead capture + consent, phone/duplicate rules, thank-you page | 5 | L |
| **7 – Orders & customers** | New pipeline, manual orders, bulk, invoice/packing/thermal label, CRM | 5,6 | L |
| **8 – Courier & COD settlement** | Provider admin UI + test connection, booking/sync, collection & settlement | 7 | L |
| **9 – Dashboard, profit & expenses** | KPIs, filters, charts, daily profit, expense manager, daily_stats rollups | 5,7,8 | L |
| **10 – Landing CMS** | Sections, reorder, draft/publish/versions, previews, media | 2,4 | **L** |
| **11 – Marketing & notifications** | Pixel/GA/GTM settings, **Meta CAPI**, event IDs, new notification events, coupons v2 | 7 | M |
| **12 – Demo data & final QA** | Isolated demo seed/reset, E2E journey, security pass, performance, final report | all | M |

Rule from the spec is kept: **a phase is complete only when its screens are wired to real backend logic and tested**, not when the UI exists.

---

## 6. QA baseline (before any new work)

| Check | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`) | Passed |
| `npm test` | **203 / 203 passed** (mock/static) |
| Firestore Emulator rules tests | Not run — Java not installed (Requires manual verification) |
| Live Gemini / courier / payment / SMS / WhatsApp | Not configured — no credentials |
| Checkout end-to-end on a real Firestore | Failed locally — Admin SDK unavailable (`503`) |

---

## 7. Decisions needed from the owner

| ID | Decision | Recommendation |
|---|---|---|
| D1 | **Keep Firestore** (adapt the relational spec) or **migrate to PostgreSQL** (Prisma/Drizzle on Neon/Supabase)? | Keep Firestore for now: orders/stock engine and 203 tests already depend on it. Reconsider Postgres only if heavy reporting becomes slow. |
| D2 | Admin auth: Firebase Auth (Google/email) with custom claims, or email+password sessions? | Firebase Auth + server session cookie + custom-claim roles. |
| D3 | Inventory base unit: grams (recommended) or jars? | Grams. |
| D4 | File storage for media/receipts: Firebase Storage or Cloudinary/S3? | Firebase Storage (same project). |
| D5 | Real-time alerts: Firestore snapshot signal (recommended) or polling? | Snapshot signal on a PII-free counter doc. |
| D6 | Languages for storefront/admin: Bangla-first with English? | Bangla-first, English secondary (already supported). |
| D7 | Is the **AI chatbot** kept as part of the product? | Keep; point it at the new package source in Phase 5. |

---

## 8. Risks

- **Package migration touches the money path** — mitigated by additive fields, dual-read period, and keeping the 203 tests green at every step.
- **Scope**: the spec is ~12 months of single-developer work if done to production depth. Phases 0, 4, 5, 6, 7, 8, 9 deliver the core business loop; CMS (10) and marketing (11) can ship after the loop works.
- **Unverified integrations**: couriers, SMS/WhatsApp, Meta CAPI cannot be called "working" until sandbox/live tests pass with real credentials the owner must supply.
- **Financial accuracy**: profit/settlement logic needs the owner's accounting rules (refund treatment, courier-cost source) confirmed before Phase 9.

---

## 9. Curated scope (owner decision: build only what improves the project)

Rule: everything is **additive** inside the existing site. Nothing that already works is replaced.

**Building, one step at a time (each finished + tested before the next):**

| Step | Deliverable | Status |
|---|---|---|
| 1 | Daily Profit & Expenses: COGS snapshot on orders, expense manager, daily profit report, audit log | **Done** (server APIs + admin page + 10 tests) |
| 2 | Order pipeline v2: new statuses (packaging, ready-to-ship, out-for-delivery, failed, returned) + separate COD collection / settlement status | **Done** (server API, transitions, stock restore on cancel, 12 tests) |
| 3 | COD collection & courier settlement records | **Done** (unique payout reference, discrepancy → disputed, 8 tests) |
| 4a | Roles (owner / call agent / delivery manager / accountant) enforced on every new admin API, staff management, activity log viewer | **Done** (10 tests) |
| 4b | Move remaining admin reads/writes (orders list, products, coupons) behind server APIs so staff can log in without client-SDK access | Planned |
| 5 | Incomplete-lead capture (with privacy notice) + lead list & conversion | **Done** (consent-gated capture, one lead per phone, auto-convert on order, admin list/notes/follow-up/CSV, 12 tests) |
| 6 | Package manager (data-driven packages, offer price, COGS, badges) with dual-read migration | Planned |
| 7 | Dashboard v2: date filters, charts, funnel, low-stock alerts, new-order polling alert | Planned |
| 8 | Landing-page CMS **lite** (hero, benefits, FAQ, reviews order, announcement bar; draft/publish/restore) | Planned |
| 9 | Meta CAPI + Pixel/GA/GTM settings with event IDs | Planned |
| 10 | Coupon v2, customer list, manual order entry, labels/invoices | Planned |

**Deliberately skipped (would make the project worse or is out of scope):** online payment gateways, advance payment, multi-vendor/marketplace features, a Postgres migration, a 22-item overcrowded sidebar, WebSocket infrastructure (polling is enough), automation-rule engine, TikTok/other ad integrations beyond manual spend entry, a full relational rewrite, and any change that breaks existing orders, checkout, chatbot or tests.
