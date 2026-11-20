# DESHI GEE — New Secrets & Environment Variables Checklist (Names Only)

**Rule:** Never commit, print, or paste real secret values into chat, git, or ZIP archives. Store all production secrets in Google Cloud Secret Manager and attach them to Cloud Run at deploy time. **Never create or use service-account JSON keys** (Admin SDK uses Application Default Credentials via IAM `roles/datastore.user`).

---

## 1. Required BEFORE First Production Deploy

| Variable Name | Type | Required Before 1st Deploy? | How to Generate / Obtain | Purpose |
|---|---|---|---|---|
| `GEMINI_API_KEY` | Secret | **YES** (for live AI replies; without it chat stays in deterministic fallback mode) | Google AI Studio / GCP Console API key (restrict to Generative Language API; rotate any previously shared key) | Server-side Gemini 4 (`gemini-4-hydrogen`) + fallback (`gemini-3.1-flash-lite`) calls |
| `ORDER_TOKEN_SECRET` | Secret | **YES** (production fails closed `503` without ≥16 chars; recommend 64 hex chars) | `openssl rand -hex 32` | HMAC-SHA256 signing of order Confirm tokens, cancel/address-edit action tokens & duplicate order fingerprints |
| `TRACKING_TOKEN_SECRET` | Secret | **YES** (falls back to `ORDER_TOKEN_SECRET` if unset, dedicated secret recommended) | `openssl rand -hex 32` | Keyed HMAC-SHA256 hashing of 192-bit CSPRNG `/track?token=...` tracking tokens (D14) |
| `CHANNEL_SESSION_SECRET` | Secret | **YES** (falls back to `ORDER_TOKEN_SECRET` if unset, dedicated secret recommended) | `openssl rand -hex 32` | Keyed HMAC-SHA256 derivation of omnichannel session IDs (D16) |
| `SESSION_COOKIE_SECRET` | Secret | **YES** (recommended dedicated secret; otherwise falls back to `ORDER_TOKEN_SECRET` / `RATE_LIMIT_SALT`) | `openssl rand -hex 32` | Signs the `HttpOnly` chat session ownership cookie (`S0-02` / `3-08`) |
| `RATE_LIMIT_SALT` | Secret | **YES** (recommended dedicated salt for hashed IP/phone rate-limit bucket keys) | `openssl rand -hex 32` | Salted hashing of IP/phone rate-limit keys in `chatbot_rate_buckets` |
| `NEXT_PUBLIC_SITE_URL` | Non-secret config | **YES** | Set to your exact production HTTPS origin (e.g., `https://deshigee.com`) | Same-origin CSRF host allowlist, canonical URLs, SEO JSON-LD, payment callback URLs |
| `NODE_ENV` | Runtime config | **YES** | Set to `production` by Cloud Run / `next start` | Enables production fail-closed secret & test-mode guards (`DESHI_GEE_TEST_MODE=1` refuses to start) |

---

## 2. Optional Before First Deploy (Recommended / Operations)

| Variable Name | Type | Required Before 1st Deploy? | How to Generate / Obtain | Purpose |
|---|---|---|---|---|
| `CRON_SECRET` | Secret | No (required only if enabling Cloud Scheduler refill/retention cron) | `openssl rand -hex 32` | Bearer auth for `/api/orders/refill-reminder/dispatch` & `/api/retention/campaigns` |
| `INTERNAL_NOTIFY_SECRET` | Secret | No (falls back to `CRON_SECRET` if unset) | `openssl rand -hex 32` | Internal server-to-server auth for `/api/orders/notify` |
| `GEMINI_MODEL` | Config | No (defaults to `gemini-4-hydrogen`) | Plain string (`gemini-4-hydrogen`) | Primary Gemini model (env-only rollback switch) |
| `GEMINI_FALLBACK_MODEL` | Config | No (defaults to `gemini-3.1-flash-lite`) | Plain string (`gemini-3.1-flash-lite`) | Fallback Gemini model on transient 429/5xx/timeout |
| `GEMINI_DAILY_COST_CAP_USD` | Config | No (recommended — e.g. `5` or `10`) | Decimal USD string | Daily spend kill-switch tracked in `chatbot_cost_ledger` |
| `GEMINI_MODEL_COST_RATES_JSON` | Config | No | JSON map of `{ "<model>": { "inputPerMillion": <n>, "outputPerMillion": <n> } }` from official Gemini pricing | Per-model cost ledger rates (overrides scalar `GEMINI_INPUT_COST_PER_M_TOKENS` / `GEMINI_OUTPUT_COST_PER_M_TOKENS`) |
| `GEMINI_MAX_OUTPUT_TOKENS` | Config | No (defaults to `1800`) | Integer string | Output token cap |
| `NEXT_PUBLIC_ENABLE_POLICY_DRAFTS` | Config | No (keep `false` until owner legal review completes) | `false` or `true` | Controls visibility of DRAFT policy modals (D10) |
| `APP_CHECK_ENFORCE` | Config | No (keep `false` until Firebase App Check client SDK + reCAPTCHA Enterprise key are configured) | `false` or `true` | Enforces `X-Firebase-AppCheck` token verification on wired public write routes |
| `GEMINI_TTS_VOICE` | Config | No (defaults to `Kore`; TTS is OFF by default per D15) | One of `Kore`, `Puck`, `Charon`, `Fenrir`, `Zephyr` | Voice preset when admin explicitly enables `enableVoiceFeatures` |

---

## 3. Optional External Integrations (Leave Unset Until Sandbox Verified — Safe `"Not configured"` / `503`)

- **Owner Webhooks:** `OWNER_WEBHOOK_URL`, `GOOGLE_SHEETS_WEBHOOK_URL`, `WHATSAPP_WEBHOOK_URL`, `EMAIL_WEBHOOK_URL` (from your own automation/Zapier/Make/Apps Script endpoints)
- **SSLCommerz / bKash:** `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWD`, `SSLCOMMERZ_IS_LIVE`, `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD`, `BKASH_IS_LIVE` (from merchant sandbox/live portals)
- **Couriers (Steadfast / Pathao / RedX):** `STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY`, `PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`, `PATHAO_USERNAME`, `PATHAO_PASSWORD`, `PATHAO_STORE_ID`, `PATHAO_IS_LIVE`, `PATHAO_CITY_ZONE_MAP_JSON`, `REDX_API_TOKEN`, `REDX_IS_LIVE`, `REDX_AREA_ID_MAP_JSON`, `COURIER_WEBHOOK_SECRET` (generate `COURIER_WEBHOOK_SECRET` with `openssl rand -hex 32`)
- **SMS / Email:** `BULKSMSBD_API_KEY`, `BULKSMSBD_SENDER_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `OWNER_NOTIFICATION_EMAIL` (from respective provider dashboards)
- **Meta Messenger / Instagram / WhatsApp Cloud API:** `META_APP_SECRET`, `META_VERIFY_TOKEN` (`openssl rand -hex 24`), `META_PAGE_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (from Meta Developers console)

> **Never set in production:** `DESHI_GEE_TEST_MODE` (setting `DESHI_GEE_TEST_MODE=1` under `NODE_ENV=production` immediately aborts startup with `[SECURITY_FATAL]`).
