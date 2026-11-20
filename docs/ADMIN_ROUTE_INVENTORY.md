# DESHI GEE — Complete API & Admin Route Security Inventory (Stage 2.5)

Generated as part of Stage 2 (Admin SDK + Strict Auth Lockdown).
All admin routes enforce `verifyServerAdminToken` -> `verifyAdminIdTokenStrict` (`firebase-admin/auth` `verifyIdToken` + `email_verified === true` + allowlist `kinboni.bd@gmail.com` or `admins/{uid}`).

| Route | Methods | Classification | Auth / Security Gate | Notes |
|---|---|---|---|---|
| `/api/analytics/attribution` | GET | Admin | `verifyAdminIdTokenStrict` (401/403) | Attribution funnel analytics |
| `/api/channels/webhook` | GET, POST | Webhook | Meta HMAC-SHA256 `x-hub-signature-256` + verify token + timestamp replay check | Keyed-HMAC channel session IDs (D16) |
| `/api/chat` | POST | Public / Admin Draft | CSRF header, session cookie, IP+session rate limit; `mode=draft` requires `verifyAdminIdTokenStrict` | Gemini 4 + server tool calling |
| `/api/chat/session` | GET | Public (Signed Session) | HMAC-signed `HttpOnly` session cookie | Returns customer's own session only |
| `/api/chat/tts` | POST | Public (Signed TTS Token) | CSRF + short-lived HMAC TTS token + rate limit | Gated behind `enableVoiceFeatures` (D15) |
| `/api/chatbot/admin` | GET, POST | Admin | `verifyAdminIdTokenStrict` | Human inbox, KB/FAQ, tickets, reviews |
| `/api/chatbot/feedback` | POST | Public | CSRF + rate limit | Logs thumbs up/down + reason |
| `/api/chatbot/parse-doc` | POST | Admin | `verifyAdminIdTokenStrict` + CSRF | PDF/DOCX/CSV/TXT parser |
| `/api/chatbot/public-config` | GET | Public Read-Only | Minimal projection ONLY (D2) | `{ enabled, botName, welcomeMessage, quickQuestions, enableVoiceFeatures }` |
| `/api/coupons/validate` | POST | Public | CSRF + rate limit (guess throttling) | Server-side coupon validation (EN/BN) |
| `/api/courier/book` | POST | Admin | `verifyAdminIdTokenStrict` | Idempotent courier booking |
| `/api/courier/webhook` | POST | Webhook | Courier signature / secret header + consignment match | Allowlisted courier domains only (4-04) |
| `/api/health` | GET | Public Liveness / Admin Diagnostics | Unauthenticated: `{ ok, status, timestamp }` only; Admin: full report + `adminSdk` readiness + rate-limited `?refresh=1` | 0-01 hardened |
| `/api/integrations/status` | GET | Admin | `verifyAdminIdTokenStrict` | Gateway/courier/channel readiness |
| `/api/newsletter` | POST | Public | `enforcePublicMutationGuards` + IP rate limit | Admin SDK write to `subscribers` (Stage 2.3) |
| `/api/notifications/status` | GET | Admin | `verifyAdminIdTokenStrict` | Recent webhook dispatch logs |
| `/api/order` | POST | Public (Signed Confirm Token) | CSRF + single-use HMAC Confirm token + session match + IP/phone rate limits | Admin SDK atomic `runTransaction`; fail-closed 503 (D5) |
| `/api/orders/cod-verify` | POST | Admin / Customer | CSRF + rate limit + order+phone verification | Admin configurable COD threshold |
| `/api/orders/manage` | GET, POST | Customer (Signed Action Token) / Admin | Customer cancel/address-edit requires signed Confirm token (D12); Admin actions require `verifyAdminIdTokenStrict` | Atomic stock restore on cancel |
| `/api/orders/notify` | POST | Admin | `verifyAdminIdTokenStrict` | Manual notification retry |
| `/api/orders/prepare` | POST | Public | CSRF + rate limit | Generates signed order summary token |
| `/api/orders/refill-reminder` | GET, POST | Public (Order+Phone Verified) | CSRF + orderNumber & phone match + consent | Bilingual errors, opt-in only |
| `/api/orders/refill-reminder/dispatch` | POST | Cron / Admin | `CRON_SECRET` Bearer or `verifyAdminIdTokenStrict` | Dry-run default, quiet hours, unsubscribe token |
| `/api/orders/reorder` | POST | Public (Order+Phone Verified) | CSRF + orderNumber & phone match | Clamped to live stock |
| `/api/orders/review` | POST | Public (Delivered Order Verified) | CSRF + delivered orderNumber & phone match | Duplicate-protected |
| `/api/orders/storefront` | POST | Public | CSRF + IP/phone rate limit + confirmed prices gate | Admin SDK atomic `runTransaction`; fail-closed 503 (D5) |
| `/api/orders/track` | POST | Public | `enforcePublicMutationGuards` + IP rate limit | 192-bit CSPRNG token OR Order ID + phone; uniform 404 (D14) |
| `/api/payments/callback` | GET, POST | Gateway Webhook / Admin | Gateway signature / server verification + Admin auth for manual reconciliation | Idempotent event ledger |
| `/api/payments/initiate` | POST | Public (Order Verified) | CSRF + order verification + server amount lookup | Never trusts client amount |
| `/api/payments/methods` | GET | Public Read-Only | Safe configured method list only | Hides unconfigured gateways/numbers (D18) |
| `/api/retention/campaigns` | GET, POST | Cron / Admin | `CRON_SECRET` Bearer or `verifyAdminIdTokenStrict` | Dry-run default, consent + quiet hours + suppression |
| `/api/reviews` | POST | Public | `enforcePublicMutationGuards` + IP rate limit | Admin SDK write to `reviews` as `pending` (Stage 2.3) |
| `/api/reviews/helpful` | POST | Public | `enforcePublicMutationGuards` + IP rate limit | Admin SDK atomic `FieldValue.increment(1)` (Stage 2.3) |
| `/api/support/evidence` | GET, POST | POST: Public / GET: Admin | POST: CSRF + magic bytes + size cap; GET: `verifyAdminIdTokenStrict` | Private evidence uploads |
| `/api/support/ticket` | POST | Public | CSRF + explicit consent + optional order+phone check | BST SLA + Human Inbox creation + `SUPPORT_REQUESTED` alert |
| `/api/admin/integrations` | GET, POST | Admin | `verifyAdminIdTokenStrict` (401/403) | Non-secret integration settings, rules & readiness (zero secrets returned) |
| `/api/admin/integrations/test` | POST | Admin | `verifyAdminIdTokenStrict` (401/403) | Live connection test for Telegram, Discord, WhatsApp, and Gemini (503 if unconfigured) |
| `/api/admin/notifications` | GET, POST | Admin | `verifyAdminIdTokenStrict` (401/403) | Paginated notification logs/jobs, DLQ manual retry, queue processor, daily summary |
| `/api/notifications/worker` | GET, POST | Worker / Admin | `NOTIFICATION_WORKER_SECRET` / `CRON_SECRET` (timing-safe) or `verifyAdminIdTokenStrict` | Durable retry worker & scheduled daily summary endpoint |
