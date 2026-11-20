# Deshi Gee — Feature Matrix

| Area | Feature | Status | Verification Mode | Owner Action Required |
| --- | --- | --- | --- | --- |
| **Storefront** | Single-product Deshi Gee storefront (250g / 500g / 1kg) | Built | `mock` / `static` | Confirm real jar prices & stock in Admin Console |
| **Storefront** | Truthful `unset` hiding (no invented prices, fees, ETAs, contacts, stock, or claims) | Built | `mock` / `static` | None (enforced automatically) |
| **Storefront** | Bag checkout drawer with atomic server order creation (`POST /api/orders/storefront`) | Built | `mock` | Grant `roles/datastore.user` to runtime SA so Admin SDK writes succeed |
| **Storefront** | Private order tracking via 192-bit token (`/track?token=...`) + Order ID & phone fallback | Built | `mock` / `static` | None |
| **Storefront** | Policy modals (`NEXT_PUBLIC_ENABLE_POLICY_DRAFTS`) | Gated (OFF by default) | `static` | Review `docs/POLICY_REVIEW_LIST.md` before enabling |
| **Storefront** | JSON-LD structured data gated per `ownerConfirmedFields` | Built | `mock` | Confirm variant prices in Admin Console |
| **AI Agent** | Bilingual Bangla / English / Banglish shopping assistant (`gemini-4-hydrogen` + `gemini-3.1-flash-lite` failover) | Built | `mock` / `static` | Set `GEMINI_API_KEY` in Cloud Run Secret Manager & run live latency check |
| **AI Agent** | Banglish → Bangla script default (D1) | Built | `mock` | Configurable in Admin Console (`languageBehavior`) |
| **AI Agent** | Strict two-step order placement (signed `prepare_order_summary` token + explicit Confirm click; typed `"yes"` never creates an order) | Built | `mock` | Set `ORDER_TOKEN_SECRET` (≥ 32 chars) in Secret Manager |
| **AI Agent** | Atomic stock decrement, duplicate suppression, stale price 409 refresh, coupon usage cap | Built | `mock` | None |
| **AI Agent** | Two-step signed chat cancel & address edit (paid orders → human handover, no refund promise) | Built | `mock` | None |
| **AI Agent** | Typo clarification on misspelled districts (`needsClarification: true`, never silent auto-fix) | Built | `mock` | None |
| **AI Agent** | Voice dictation & TTS playback (D15) | OFF by default | `static` | Opt-in via Admin Console (`enableVoiceFeatures`) |
| **AI Agent** | Hybrid RAG + Draft Starter Knowledge Pack (D11 — `active: false, published: false`) | Built | `mock` / `static` | Owner reviews & explicitly publishes KB/FAQ items |
| **AI Agent** | T1.6 Structured Chat Turn Contract (`meta.contract` with backend-only money/status/orderId) | Built | `mock` | None |
| **Admin Console** | Strict Admin RBAC (`kinboni.bd@gmail.com` with `email_verified === true` or `admins/{uid}`) | Built | `mock` / `static` | None |
| **Admin Console** | Orders, Inventory, Store Settings, Coupons, Batches, Reviews, Audit Log, Chatbot Config & Analytics | Built | `mock` / `static` | Populate real store facts via `docs/OWNER_DATA_TEMPLATE.md` |
| **Admin Console** | F22 Bad-Answer Review Queue & Export Regression JSON | Built | `static` | None |
| **Security** | Firebase Admin SDK via ADC (`roles/datastore.user`), pinned to named Firestore DB (`ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f`) | Built | `mock` / `static` | Grant IAM role to preview & Cloud Run service accounts |
| **Security** | Fail-closed `503 admin_sdk_unavailable` on customer writes if Admin SDK/ADC unavailable | Built | `mock` / `static` | None |
| **Security** | Zero `?key=` public-key Firestore REST writes in `src/` & `app/` | Built | `static` | None |
| **Security** | Hardened Firestore rules proposal (`docs/rules-proposals/firestore-final-admin-sdk.rules`) | Prepared (NOT deployed) | `static` (`emulator` pending Java) | Run emulator suite on Java 17+ host, then deploy per `docs/DEPLOY_RUNBOOK.md` |
| **Security** | `DESHI_GEE_TEST_MODE=1` + `NODE_ENV=production` fail-closed refusal | Built | `static` / live-process proof | None |
| **Integrations** | Payment gateway (`PaymentProvider` interface + SSLCommerz / bKash + mock provider + full lifecycle states) | Built (unconfigured until secrets added) | `mock` | Add SSLCommerz / bKash credentials in Secret Manager when ready |
| **Integrations** | Courier API (`CourierProvider` interface + Steadfast / Pathao / RedX + strict URL allowlist + idempotent booking) | Built (unconfigured until secrets added) | `mock` | Add courier credentials + `COURIER_WEBHOOK_SECRET` when ready |
| **Integrations** | SMS / Email (BulkSMSBD POST body, Twilio, Resend) & Refill/Retention Cron (`CRON_SECRET`, Dhaka quiet hours, consent, dry-run default) | Built (unconfigured until secrets added) | `mock` / `static` | Add provider keys & configure Cloud Scheduler if desired |
