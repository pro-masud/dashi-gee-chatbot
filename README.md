<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Deshi Gee — Storefront & AI Shopping Assistant

Next.js App Router storefront and Gemini-powered bilingual (বাংলা / Banglish / English) customer assistant for **Deshi Gee**.

## Run Locally

**Prerequisites:** Node.js 20+

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and configure required server environment variables (never commit `.env.local`).
3. Run the development server:
   `npm run dev`
4. Verify runtime health:
   `curl http://localhost:3000/api/health`

## Environment Variables (Names Only)

| Variable | Required | Scope | Purpose |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Required for live AI (falls back to Live DB Fallback Engine if unset) | Server only | Google Gemini API authentication |
| `GEMINI_MODEL` | Optional | Server only | Primary Gemini model ID (default `gemini-4-hydrogen`, verified `2026-11-17` with `@google/genai@^3.4.0`) |
| `GEMINI_FALLBACK_MODEL` | Optional | Server only | Secondary Gemini model ID for failover (default `gemini-3.1-flash-lite`) |
| `GEMINI_MAX_OUTPUT_TOKENS` | Optional | Server only | Output token ceiling (default `1800`, retries at `2600` on truncation) |
| `GEMINI_DAILY_COST_CAP_USD` | Optional | Server only | Persistent daily USD spend circuit breaker (`chatbot_cost_ledger`) |
| `GEMINI_INPUT_COST_PER_M_TOKENS` | Optional | Server only | Override input USD rate per 1M tokens for cost estimation |
| `GEMINI_OUTPUT_COST_PER_M_TOKENS` | Optional | Server only | Override output USD rate per 1M tokens for cost estimation |
| `ORDER_TOKEN_SECRET` | Required in production (min 32 random chars) | Server only | Dedicated HMAC signing key for order confirmation tokens (fails closed in prod if unset) |
| `NEXT_PUBLIC_SITE_URL` | Optional | Public / Server | Canonical storefront URL (default `http://localhost:3000`) |
| `FIREBASE_API_KEY` | Optional | Server only | Optional Firebase REST API key override |
| `OWNER_WEBHOOK_URL` | Optional | Server only | Primary owner notification webhook for new orders/handovers |
| `WHATSAPP_WEBHOOK_URL` | Optional | Server only | WhatsApp gateway notification relay URL |
| `EMAIL_WEBHOOK_URL` | Optional | Server only | Email notification relay URL |
| `GOOGLE_SHEETS_WEBHOOK_URL` | Optional | Server only | Google Apps Script webhook URL for order row sync |

### Generating & Rotating `ORDER_TOKEN_SECRET`

Production mode **fails closed** (HTTP `503` on `/api/order` confirmation and refresh) whenever `ORDER_TOKEN_SECRET` is missing or shorter than 32 characters. Generate a fresh 64-character secret before deploying:

```bash
openssl rand -hex 32
# or with Node.js:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

To rotate keys cleanly, deploy the new `ORDER_TOKEN_SECRET` during a low-traffic window; any unsubmitted in-chat Order Summary tokens signed under the previous key expire within 20 minutes or can be refreshed via `/api/order` refresh.

## Health & Diagnostics (`GET /api/health`)

`GET /api/health` checks (without revealing any secret values):
- `GEMINI_API_KEY` configured (`yes` / `no`)
- Primary & fallback Gemini model configuration, SDK compatibility, tool/function-calling support, thinking config compatibility, output token limits, and live reachability (`yes` / `no`)
- `ORDER_TOKEN_SECRET` configured (`yes` / `no`)
- Firestore REST reachability (`yes` / `no`)

Pass `?refresh=1` to bypass the 45-second model reachability cache. Every `/api/chat` turn also logs `path` (`gemini` | `fallback`), `model`, and diagnostic `errorCode`.

## Verification Commands

- `npm run lint` — TypeScript typecheck
- `npm test` — Full automated test suite (health, Phase 0 guards, 50+ bilingual regression cases, rules checks)
- `npm run test:chatbot` — Run the 50+ bilingual regression harness against chatbot API/guards
- `npx eslint firestore.rules` — Static security rules linter
- `npm run build` — Production build

