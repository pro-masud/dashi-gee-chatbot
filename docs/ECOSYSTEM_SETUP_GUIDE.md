# Deshi Gee — AI Customer Support & Social Notification Ecosystem Guide

This guide documents the production architecture, server-side integrations, Firestore collections, environment variables, setup steps, and security controls for the Deshi Gee AI Customer Support & Social Notification Ecosystem.

---

## 1. System Architecture

```
Storefront / Payments / Support / WhatsApp Cloud Webhook
   │
   ├── Website Chatbot & Omnichannel AI Engine
   │     ├── /api/chat (Website widget, Gemini 4 + live grounded fallback)
   │     ├── /api/channels/webhook (WhatsApp Cloud + Meta Messenger/Instagram + statuses[])
   │     └── Admin Chatbot Studio & Conversation Inbox (human takeover, AI pause/resume, tickets)
   │
   └── Central Notification Engine (src/lib/notifications/engine.ts)
         ├── Deterministic Event Deduplication (notification_events/{idempotencyKey})
         ├── Per-Event Routing Matrix (notification_rules/main + integration_settings/main)
         ├── Durable Isolated Per-Channel Queue (notification_jobs/{jobId})
         │     ├── Telegram Admin Bot (src/lib/integrations/telegramBot.ts)
         │     ├── Discord 6-Channel Webhooks (src/lib/integrations/discordWebhook.ts)
         │     └── WhatsApp Business Cloud API (src/lib/integrations/whatsappCloud.ts)
         ├── Exponential Backoff Retries + Dead-Letter Queue (dead_letter)
         ├── Sanitized Delivery Audit Logs (notification_logs/{logId})
         └── Scheduled Retry & Daily Summary Worker (/api/notifications/worker)
```

### Supported Business Events
- `ORDER_CREATED` — Storefront & chat orders (`src/lib/integrations/orderNotify.ts`)
- `ORDER_UPDATED` — Address edits, admin review decisions, courier updates (`app/api/orders/manage/route.ts`)
- `ORDER_CANCELLED` — Customer confirmed cancels & admin cancels (`app/api/orders/manage/route.ts`)
- `PAYMENT_SUCCESS` — Server-verified SSLCommerz / bKash payments (`app/api/payments/callback/route.ts`)
- `PAYMENT_FAILED` — Authenticated failed/cancelled payment callbacks (`app/api/payments/callback/route.ts`)
- `SUPPORT_REQUESTED` — Customer support ticket escalations (`app/api/support/ticket/route.ts`)
- `CUSTOMER_MESSAGE_RECEIVED` — Inbound WhatsApp / Messenger / Instagram messages (`app/api/channels/webhook/route.ts`)
- `LOW_STOCK` — Inventory below configurable `lowStockThreshold` (`src/lib/integrations/orderNotify.ts`)
- `DAILY_SUMMARY` — Scheduled or Admin-triggered daily business summary (`/api/notifications/worker`, `/api/admin/notifications`)
- `SYSTEM_ERROR` — Operational / test system alerts

---

## 2. Folder & File Structure

| Path | Responsibility |
|---|---|
| `src/lib/notifications/types.ts` | Client-safe event/rule/job/log types, defaults, phone masking, secret/URL error sanitizer |
| `src/lib/notifications/store.ts` | Firestore Admin SDK repository (`integration_settings`, `notification_rules`, `notification_events`, `notification_jobs`, `notification_logs`) with fail-closed test write guard & in-memory test harness |
| `src/lib/notifications/engine.ts` | `publishBusinessEvent`, `publishBusinessEventSafe`, `processNotificationQueue`, `retryNotificationJob`, `buildAndPublishDailySummaryEvent` |
| `src/lib/integrations/telegramBot.ts` | Official Telegram Bot API (`sendMessage` HTML-escaped, `getMe` connection test, multi-chat support) |
| `src/lib/integrations/discordWebhook.ts` | Official Discord Webhook rich embeds mapped to 6 channels (`#new-orders`, `#payments`, `#customer-support`, `#inventory-alerts`, `#daily-reports`, `#system-alerts`) |
| `src/lib/integrations/whatsappCloud.ts` | Official Meta WhatsApp Cloud API outgoing text & approved utility templates (24h window + opt-in enforcement), delivery receipt parser, Graph connection test |
| `app/api/admin/integrations/route.ts` | Admin-only GET/POST for non-secret settings, rules & readiness |
| `app/api/admin/integrations/test/route.ts` | Admin-only live connection tester (returns honest `503` when credentials missing) |
| `app/api/admin/notifications/route.ts` | Admin-only paginated logs/jobs/DLQ viewer, manual retry, queue runner, daily summary trigger |
| `app/api/notifications/worker/route.ts` | Authenticated worker endpoint (`NOTIFICATION_WORKER_SECRET` / `CRON_SECRET` / Admin Bearer) |
| `src/components/AdminEcosystemPanel.tsx` | Admin **Integrations & Alerts** dashboard tab |

---

## 3. Firestore Collections & Security

All 5 collections live in the named Firestore database (`ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f`) and are locked strictly to `isVerifiedAdmin()` in `docs/rules-proposals/firestore-final-admin-sdk.rules` (and documented in `firebase-blueprint.json`):

1. `integration_settings/main` — Non-secret toggles, optional Telegram chat ID override, WhatsApp template names, last connected/error timestamps. **Secrets are NEVER written to Firestore.**
2. `notification_rules/main` — Per-event channel routing toggles, `maxRetries` (1–8), `baseBackoffSeconds` (5–600), `lowStockThreshold` (0–100).
3. `notification_events/{idempotencyKey}` — Deduplicated business event ledger.
4. `notification_jobs/{jobId}` — Durable per-channel queue (`queued`, `processing`, `sent`, `failed_retrying`, `dead_letter`, `skipped_disabled`).
5. `notification_logs/{logId}` — Append-only delivery attempt audit trail with sanitized error messages.

---

## 4. Environment Variables (Server-Only Secrets)

Store all secrets in Google Cloud Secret Manager (mounted as Cloud Run env vars). Never prefix with `NEXT_PUBLIC_`.

| Variable | Required For | How to Obtain / Generate |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram Admin Bot | Create bot with `@BotFather` (`/newbot`) |
| `TELEGRAM_CHAT_ID` | Telegram Admin Bot | Numeric chat/group ID (comma-separated for multiple admins; use `@userinfobot` or `getUpdates`) |
| `DISCORD_WEBHOOK_URL` | Discord (fallback) | Discord Server Settings → Integrations → Webhooks (`https://discord.com/api/webhooks/...`) |
| `DISCORD_WEBHOOK_ORDERS` | `#new-orders` | Dedicated Discord channel webhook URL |
| `DISCORD_WEBHOOK_PAYMENTS` | `#payments` | Dedicated Discord channel webhook URL |
| `DISCORD_WEBHOOK_SUPPORT` | `#customer-support` | Dedicated Discord channel webhook URL |
| `DISCORD_WEBHOOK_INVENTORY` | `#inventory-alerts` | Dedicated Discord channel webhook URL |
| `DISCORD_WEBHOOK_REPORTS` | `#daily-reports` | Dedicated Discord channel webhook URL |
| `DISCORD_WEBHOOK_SYSTEM` | `#system-alerts` | Dedicated Discord channel webhook URL |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Cloud API | Meta Business Manager → System User permanent token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API | Meta App Dashboard → WhatsApp → API Setup |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WhatsApp Cloud API | Meta App Dashboard → WhatsApp Business Account ID |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp Webhook | `openssl rand -hex 24` |
| `WHATSAPP_APP_SECRET` | Webhook HMAC-SHA256 | Meta App Dashboard → Settings → Basic → App Secret |
| `NOTIFICATION_WORKER_SECRET` | Scheduled Retry Worker | `openssl rand -hex 32` |
| `GEMINI_API_KEY` | Live Gemini AI Support | Google AI Studio / Vertex API key |

---

## 5. Provider Setup Checklists

### A. Telegram Admin Bot Setup
1. Open Telegram, message `@BotFather`, run `/newbot`, and copy the bot token into `TELEGRAM_BOT_TOKEN`.
2. Start a conversation with your bot (or add it to a private Admin Ops group).
3. Fetch the numeric chat ID via `https://api.telegram.org/bot<TOKEN>/getUpdates` and set `TELEGRAM_CHAT_ID`.
4. Open `/admin` → **Integrations & Alerts** → **Telegram** → click **Send Test Ping**.

### B. Discord 6-Channel Webhook Setup
1. Create channels in your private operations Discord server: `#new-orders`, `#payments`, `#customer-support`, `#inventory-alerts`, `#daily-reports`, `#system-alerts`.
2. For each channel: **Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL**.
3. Mount each URL into the matching `DISCORD_WEBHOOK_*` server secret (or mount a single `DISCORD_WEBHOOK_URL` fallback).
4. Open `/admin` → **Integrations & Alerts** → **Discord** → click **Test** on each channel.

### C. WhatsApp Business Cloud API Setup
1. In Meta Developers Console, add the **WhatsApp** product to your Business App.
2. Configure the Webhook Callback URL to `https://<your-domain>/api/channels/webhook` and enter your `WHATSAPP_VERIFY_TOKEN`.
3. Subscribe to the `messages` webhook field (which delivers both inbound messages and `statuses[]` delivery receipts).
4. Create and submit Meta-approved **Utility** templates for proactive notifications outside the 24-hour customer care window (e.g. `order_confirmed_utility`, `order_status_update`), then save their exact names in `/admin` → **Integrations & Alerts** → **WhatsApp**.

### D. Durable Retry & Daily Summary Worker (Cloud Scheduler)
Create two Cloud Scheduler jobs (owner deploys manually — never auto-deployed):
1. **Queue Retry Sweeper (every 2 minutes)**:
   - `POST https://<your-domain>/api/notifications/worker`
   - Header: `x-worker-secret: <NOTIFICATION_WORKER_SECRET>`
   - Body: `{"action":"process_queue","limit":25}`
2. **Daily Operations Summary (daily 22:00 BST / 16:00 UTC)**:
   - `POST https://<your-domain>/api/notifications/worker`
   - Header: `x-worker-secret: <NOTIFICATION_WORKER_SECRET>`
   - Body: `{"action":"daily_summary"}`

---

## 6. Security Notes & Production Checklist

- **Zero Secrets in Client / Firestore / Logs**: All API tokens and Discord webhook URLs remain server-only. `sanitizeNotificationError()` redacts URLs, Telegram bot tokens, and Bearer strings before logging.
- **Admin Authorization**: Every `/api/admin/*` route enforces `verifyAdminIdTokenStrict` (`email_verified === true` + allowlisted admin `kinboni.bd@gmail.com` or `admins/{uid}`).
- **WhatsApp Policy Compliance**: Proactive notifications outside the 24-hour window are blocked unless `whatsappOptIn === true` AND an approved Meta utility template name is configured.
- **Per-Channel Failure Isolation**: A Telegram outage never blocks Discord delivery or customer checkout (`publishBusinessEventSafe` is non-blocking).
- **Pre-Launch Owner Gate**:
  1. Grant `roles/datastore.user` to the Cloud Run service account on project `qualified-transit-lpd8p`.
  2. Deploy `docs/rules-proposals/firestore-final-admin-sdk.rules` via `docs/DEPLOY_RUNBOOK.md`.
  3. Mount desired provider secrets (`TELEGRAM_*`, `DISCORD_WEBHOOK_*`, `WHATSAPP_*`, `NOTIFICATION_WORKER_SECRET`, `GEMINI_API_KEY`).
  4. Verify each active channel with **Test Connection** in `/admin` → **Integrations & Alerts**.
