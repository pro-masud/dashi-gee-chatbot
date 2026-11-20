# DESHI GEE — Owner Actions Required Before Go-Live

Every item below requires owner credentials, owner business confirmation, or owner infrastructure action. The codebase is built so each item only flips a config/env/IAM/admin setting — no code rewrite required.

---

## 1. Infrastructure & IAM (Required for Admin SDK + Production)

- [ ] **OA-01 (D4 / S1-01):** Grant `roles/datastore.user` (only — no Owner/Editor, no JSON key file) to the preview runtime service account `ais-sandbox@ais-asia-northeast1-51d7c07c6b.iam.gserviceaccount.com` on GCP project `qualified-transit-lpd8p` (or your dedicated Cloud Run runtime SA for production). See `docs/DEPLOY_RUNBOOK.md` Step 1.
- [ ] **OA-02 (O-02 / 0-11):** Install Java 17+ locally (or in CI) and run `npm run test:rules` and `npm run test:rules:s013` against the Firebase Firestore Emulator to verify all `ATK-A..ATK-I`, `S0-13`, `S1-01..S1-09`, and 12 Dirty Dozen security rules cases with real `PERMISSION_DENIED`.
- [ ] **OA-03 (5-10 / 6-09):** After Emulator tests pass (`firebase emulators:exec --only firestore "npm run test:rules"`) and Admin SDK IAM is verified, explicitly approve and deploy `docs/rules-proposals/firestore-final-admin-sdk.rules` (copied to `firestore.rules`) to database `ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f` (never `(default)`). See `docs/DEPLOY_RUNBOOK.md` Steps 5–6.
- [ ] **OA-04 (X-10 / D6):** Deploy production service to Google Cloud Run with a dedicated service account (`roles/datastore.user` + `roles/secretmanager.secretAccessor`), custom domain HTTPS, Firebase Authorized Domains, and Secret Manager secrets. See `docs/DEPLOY_RUNBOOK.md` Steps 1–3.

## 2. Secrets & Environment Variables (Server-Only / Secret Manager)

- [ ] **OA-05 (O-01 / O-06 / O-07):** Provision and rotate any previously shared keys; set in Secret Manager / `.env.local` (never in git or chat):
  - `GEMINI_API_KEY` (required for live AI replies + live model list / latency check)
  - `ORDER_TOKEN_SECRET` (32+ random bytes; signs order confirmation tokens, action tokens, session cookies, and duplicate fingerprints)
  - `TRACKING_TOKEN_SECRET` (32+ random bytes; hashes 192-bit order tracking tokens)
  - `CHANNEL_SESSION_SECRET` (32+ random bytes; keys omnichannel session HMAC IDs)
  - `CRON_SECRET` (32+ random bytes; authenticates scheduled refill/retention endpoints)
  - `NEXT_PUBLIC_SITE_URL` (canonical HTTPS production URL)
  - `GEMINI_DAILY_COST_CAP_USD` (daily AI spend circuit breaker) and optional `GEMINI_MODEL_COST_RATES_JSON`
- [ ] **OA-06 (O-18 / Paid Integrations — Optional, stays "Not configured" until set):**
  - Payment gateways (sandbox first): SSLCommerz (`SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWD`) and/or bKash (`BKASH_*`)
  - Couriers (sandbox first): Steadfast, Pathao, RedX API credentials + `COURIER_WEBHOOK_SECRET`
  - Messaging / Channels: BulkSMSBD, Twilio, Resend, Meta Messenger/Instagram/WhatsApp webhook secrets & tokens

## 3. Owner-Confirmed Business Facts (Enter in `/admin` & Mark `Owner Confirmed`)

> All unconfirmed fields stay `unset` and are hidden on the storefront and never promised by the chatbot (D7, D8, D9).

- [ ] **OA-07 (O-04 / 2-07):** Enter and confirm in Admin Store Settings (`store_settings/main`):
  - Jar prices (`250g`, `500g`, `1kg`) and current jar stock counts
  - 4 Bangladesh delivery zone fees & ETA windows (Dhaka Metro, Dhaka Suburbs, Nationwide, Remote)
  - Daily dispatch cut-off time (BDT), free-delivery threshold, max jars per order, advance payment discount %
  - High-value COD verification threshold (O-10)
- [ ] **OA-08 (O-13 / D18):** Enter real contact & manual payment values (currently `unset` / hidden):
  - `bkashNumber`, `nagadNumber`, `supportPhone`, `whatsappNumber`, `supportEmail`, `businessAddress`, `googleMapsUrl`
- [ ] **OA-09 (O-03 / D9):** Confirm or leave omitted: BSTI license, Lab test PDF/report, A2/Organic claims, batch numbers (`batches` collection), shelf-life / storage guidance, and Eid/festival dispatch cutoffs.
- [ ] **OA-10 (O-11 / O-12 / O-16 / 1-13 / D10 / D11):**
  - Review every entry in `docs/POLICY_REVIEW_LIST.md` (Privacy, Terms, Delivery, Return/Refund including bKash/Nagad cancellation wording) before enabling `NEXT_PUBLIC_ENABLE_POLICY_DRAFTS` or publishing final text.
  - Review and approve Draft Starter KB pack items in `/admin` before publishing (never auto-published).
  - Confirm real support SLA targets & business hours and assign a support operator (O-08).
- [ ] **OA-11 (O-05):** Provide 20–30 real customer questions with approved answers for the retrieval benchmark (`1-03`).
- [ ] **OA-12 (Live Data Audit — Section D):** Inspect any historical test documents in `chatbot_cost_ledger` (`2026-11-18`, `2026-11-19`) listed in `docs/SERVER_AUTH_AND_ADMIN_SDK_PLAN.md` and decide whether to delete them (agent never deletes live data).
- [ ] **OA-13 (Real Device & Pilot — X-12):** Complete `docs/REAL_DEVICE_CHECKLIST.md` on a real Android/iPhone over mobile network and run a 7–14 day limited pilot before opening full traffic.
