# Deshi Gee — Owner Deployment & Rollback Runbook (Cloud Run + Firestore)

> **Important**: No infrastructure, IAM, Firestore rules, or hosting deployment has been executed automatically. The owner executes these steps in order after reviewing `FINAL_REPORT.md` and `OWNER_ACTIONS.md`.

## Identifiers
- **GCP / Firebase Project ID**: `qualified-transit-lpd8p`
- **Firestore Named Database ID**: `ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f` (NEVER `(default)`)
- **Admin Owner Email**: `kinboni.bd@gmail.com` (`email_verified == true` required)
- **AI Studio Preview Runtime SA**: `ais-sandbox@ais-asia-northeast1-51d7c07c6b.iam.gserviceaccount.com`
- **Production Cloud Run Region**: `asia-southeast1` (or `asia-south1`, closest to Dhaka)

---

## Step 1 — Grant Least-Privilege Firestore IAM Role (`roles/datastore.user`)
Grant **only** `roles/datastore.user` (never Owner/Editor, never JSON service-account key files) to both the Preview SA (if testing in preview) and your dedicated Cloud Run runtime SA (e.g., `deshigee-web@qualified-transit-lpd8p.iam.gserviceaccount.com`):

```bash
# Preview sandbox SA (for live Admin SDK testing in AI Studio preview)
gcloud projects add-iam-policy-binding qualified-transit-lpd8p \
  --member="serviceAccount:ais-sandbox@ais-asia-northeast1-51d7c07c6b.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Production Cloud Run SA (create once if not existing)
gcloud iam service-accounts create deshigee-web \
  --project=qualified-transit-lpd8p \
  --display-name="Deshi Gee Cloud Run Runtime"

gcloud projects add-iam-policy-binding qualified-transit-lpd8p \
  --member="serviceAccount:deshigee-web@qualified-transit-lpd8p.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```
**Rollback**: Replace `add-iam-policy-binding` with `remove-iam-policy-binding`.

---

## Step 2 — Store Server Secrets in Google Cloud Secret Manager
Generate high-entropy 32+ byte random values for every signing secret (never reuse across purposes) and store them in Secret Manager:

```bash
# Required core secrets
printf '%s' "$GEMINI_API_KEY"        | gcloud secrets create deshigee-gemini-api-key --data-file=- --project=qualified-transit-lpd8p
openssl rand -hex 32                 | gcloud secrets create deshigee-order-token-secret --data-file=- --project=qualified-transit-lpd8p
openssl rand -hex 32                 | gcloud secrets create deshigee-tracking-token-secret --data-file=- --project=qualified-transit-lpd8p
openssl rand -hex 32                 | gcloud secrets create deshigee-channel-session-secret --data-file=- --project=qualified-transit-lpd8p
openssl rand -hex 32                 | gcloud secrets create deshigee-cron-secret --data-file=- --project=qualified-transit-lpd8p

# Grant Cloud Run SA read access to secrets
for S in deshigee-gemini-api-key deshigee-order-token-secret deshigee-tracking-token-secret deshigee-channel-session-secret deshigee-cron-secret; do
  gcloud secrets add-iam-policy-binding "$S" \
    --project=qualified-transit-lpd8p \
    --member="serviceAccount:deshigee-web@qualified-transit-lpd8p.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```
*(Optional integration secrets when activated: `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWD`, `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD`, `STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY`, `PATHAO_*`, `REDX_API_TOKEN`, `COURIER_WEBHOOK_SECRET`, `BULKSMSBD_API_KEY`, `BULKSMSBD_SENDER_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.)*
**Rollback**: Disable or destroy secret version via `gcloud secrets versions disable <ver> --secret=<name>`.

---

## Step 3 — Configure Cloud Run Environment Variables & Build/Deploy Container
Deploy from the repository root with non-secret env vars and Secret Manager mounts (`NODE_ENV=production`, `DESHI_GEE_TEST_MODE` MUST NEVER be set):

```bash
gcloud run deploy deshigee-web \
  --project=qualified-transit-lpd8p \
  --region=asia-southeast1 \
  --source=. \
  --service-account=deshigee-web@qualified-transit-lpd8p.iam.gserviceaccount.com \
  --port=3000 \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,NEXT_PUBLIC_SITE_URL=https://YOUR_DOMAIN,GEMINI_MODEL=gemini-4-hydrogen,GEMINI_FALLBACK_MODEL=gemini-3.1-flash-lite,APP_CHECK_ENFORCE=false,NEXT_PUBLIC_ENABLE_POLICY_DRAFTS=false" \
  --set-secrets="GEMINI_API_KEY=deshigee-gemini-api-key:latest,ORDER_TOKEN_SECRET=deshigee-order-token-secret:latest,TRACKING_TOKEN_SECRET=deshigee-tracking-token-secret:latest,CHANNEL_SESSION_SECRET=deshigee-channel-session-secret:latest,CRON_SECRET=deshigee-cron-secret:latest"
```
**Rollback**: Route 100% traffic back to the prior known-good revision:
```bash
gcloud run services update-traffic deshigee-web --project=qualified-transit-lpd8p --region=asia-southeast1 --to-revisions=<PREVIOUS_REVISION>=100
```

---

## Step 4 — Verify Authenticated Health Diagnostics on Cloud Run
Sign in at `https://YOUR_DOMAIN/admin` as `kinboni.bd@gmail.com` and check Admin → Diagnostics (or call `GET /api/health` with your Admin Bearer token):
- Confirm `adminSdk.initialized === true`
- Confirm `adminSdk.databaseId === "ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f"`
- Confirm `adminSdk.reachable === true`
- Confirm `gemini.primary.reachable === true`

---

## Step 5 — Run Firestore Rules Emulator Test Suite on a Java 17+ Machine
The AI Studio container lacks Java, so emulator execution is pending. On your local machine or CI runner with Java 17+ and Firebase CLI installed:

```bash
npx eslint firestore.rules docs/rules-proposals/firestore-final-admin-sdk.rules
firebase emulators:exec --only firestore "npm run test:rules"
```
Confirm all **25 security matrix cases** (ATK-A..I, S0-13, S1-01..09, Dirty Dozen) pass `emulator` mode with zero failures.

---

## Step 6 — Deploy Locked-Down Firestore Rules (ONLY After Steps 3–5 Succeed)
Back up the existing `firestore.rules`, promote the verified Admin-SDK proposal, and deploy strictly to the named database:

```bash
cp firestore.rules firestore.rules.backup.$(date +%Y%m%d)
cp docs/rules-proposals/firestore-final-admin-sdk.rules firestore.rules
npx eslint firestore.rules
firebase deploy --only firestore:rules --project qualified-transit-lpd8p
```
*(Ensure `firebase.json` targets database `ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f`.)*
**Rollback**:
```bash
cp firestore.rules.backup.<YYYYMMDD> firestore.rules
firebase deploy --only firestore:rules --project qualified-transit-lpd8p
```

---

## Step 7 — Enter Confirmed Store Facts in `/admin`
Using `docs/OWNER_DATA_TEMPLATE.md`:
1. Enter confirmed `250g`, `500g`, `1kg` prices and physical stock counts.
2. Enter confirmed Inside/Outside Dhaka delivery fees and ETAs.
3. Enter verified contact details and active payment numbers.
4. Review and explicitly publish approved FAQs / KB docs and policy text (review `docs/POLICY_REVIEW_LIST.md` before toggling `NEXT_PUBLIC_ENABLE_POLICY_DRAFTS=true`).

---

## Step 8 — Run Live Latency Benchmark & Real-Device Smoke Test
1. Run the live Gemini latency check against your deployed Cloud Run URL (or locally with `GEMINI_API_KEY` set):
   ```bash
   npx tsx scripts/latency-benchmark.ts --live
   ```
   Verify `p50Ms < 8000` and `p95Ms < 20000`.
2. Complete every box in `docs/REAL_DEVICE_CHECKLIST.md` on Android Chrome, iOS Safari, and Desktop.

---

## Step 9 — Optional: Enable Integrations & Scheduled Refill Cron
- Add payment (SSLCommerz / bKash), courier (Steadfast / Pathao / RedX + `COURIER_WEBHOOK_SECRET`), and SMS/email credentials in Secret Manager.
- Optionally schedule Cloud Scheduler to POST `/api/retention/campaigns` with `Authorization: Bearer $CRON_SECRET` (`dryRun: true` first, then `dryRun: false` after verification).
- Keep `scripts/retention-cleanup-dryrun.ts` scheduled as a read-only audit before approving any deletion.
