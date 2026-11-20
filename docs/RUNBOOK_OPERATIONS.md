# Deshi Gee — Operations Runbook

## 1. Runtime Architecture
- **App Hosting**: Google Cloud Run (Next.js App Router standalone server, port `3000`).
- **Database**: Cloud Firestore named database `ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f` in project `qualified-transit-lpd8p` (never `(default)`).
- **Server Persistence**: Firebase Admin SDK using Application Default Credentials (ADC) with least-privilege role `roles/datastore.user` (zero JSON key files).
- **AI Engine**: Google Gemini (`gemini-4-hydrogen` primary with `ThinkingLevel.LOW`, `gemini-3.1-flash-lite` failover) + deterministic live fallback engine.

## 2. Health Checks & Monitoring
- **Public Liveness**: `GET /api/health` returns `{ ok: true, status: 'ok' }` with zero internal secrets.
- **Authenticated Admin Diagnostics**: `GET /api/health` with `Authorization: Bearer <admin-id-token>` reports:
  - `adminSdk`: `{ initialized, databaseId, reachable, errorCode }`
  - `gemini`: primary/fallback model reachability, latency, and `adminAlertCode` (`gemini_auth_failed` or `gemini_model_retired`)
  - `integrations`: readiness booleans for SSLCommerz, bKash, Steadfast, Pathao, RedX, BulkSMSBD, Twilio, Resend.

## 3. Incident Playbooks

### A. Customer Checkout Returns `503 admin_sdk_unavailable`
- **Cause**: Cloud Run or preview service account lacks `roles/datastore.user` or ADC is unavailable. Customer writes fail closed intentionally (never fall back to public-key writes).
- **Fix**:
  1. Verify the Cloud Run service account has `roles/datastore.user` on project `qualified-transit-lpd8p`.
  2. Confirm `firebase-applet-config.json` `firestoreDatabaseId` equals `ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f`.
  3. Re-check authenticated `GET /api/health`.

### B. Gemini Auth Failure (`gemini_auth_failed`) or Model Retirement (`gemini_model_retired`)
- **Cause**: Invalid/expired `GEMINI_API_KEY`, billing disabled, or upstream model deprecated.
- **Immediate Mitigation (Env-Only Rollback — No Code Deploy)**:
  - Update Cloud Run env vars `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL` (e.g., `GEMINI_MODEL=gemini-3.1-flash-lite`) or rotate `GEMINI_API_KEY` in Secret Manager and trigger a new Cloud Run revision.
  - While Gemini is degraded, the server automatically serves verified prices/delivery/order-drafting through the deterministic fallback engine.

### C. Elevated Order / Chat Traffic or Abuse
- Per-IP and per-session Firestore rate limit buckets automatically enforce `429 Retry-After`.
- To enable Firebase App Check enforcement on public mutations, set `APP_CHECK_ENFORCE=true` once client App Check tokens are wired.

### D. Secret Rotation
Rotate secrets in Google Cloud Secret Manager and deploy a new Cloud Run revision:
- `ORDER_TOKEN_SECRET` (invalidates in-flight chat order confirmation buttons; customers simply click re-quote)
- `TRACKING_TOKEN_SECRET` (new orders receive tokens under the new key)
- `CHANNEL_SESSION_SECRET` (re-hashes channel session keys cleanly)
- `CRON_SECRET`, `COURIER_WEBHOOK_SECRET`, `GEMINI_API_KEY`, payment/courier/SMS credentials.

## 4. Data Retention Cleanup
- Run dry-run audit (safe, zero deletes):
  ```bash
  npx tsx scripts/retention-cleanup-dryrun.ts
  ```
- Inspect listed expired `order_fingerprints`, `chatbot_used_tokens`, and stale rate-limit buckets before ever passing `--execute` with explicit owner approval.
- Never run cleanup or test scripts with `DESHI_GEE_TEST_MODE=1` in production (the runtime refuses to start and logs `[SECURITY_FATAL]`).
