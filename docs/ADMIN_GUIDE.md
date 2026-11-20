# Deshi Gee — Admin Operations Guide

## 1. Signing In to the Admin Console
1. Open `/admin` in your browser.
2. Sign in with Google using the verified owner account (`kinboni.bd@gmail.com`).
3. Server routes verify your Firebase ID token using Firebase Admin Auth and require `email_verified === true` plus either the owner email or an entry in `admins/{uid}`.

## 2. First-Time Setup (Required Before Taking Customer Orders)
Deshi Gee ships with **zero invented business facts**. Until you confirm values in Admin → **Store Settings**, prices, delivery fees, ETAs, stock, bKash/Nagad numbers, and contact info stay hidden and checkout refuses orders with `503`.

Fill and save all confirmed values using `docs/OWNER_DATA_TEMPLATE.md`:
1. **Jar Prices (BDT)**: `250g`, `500g`, `1kg` (must be > 0).
2. **Delivery Fees & ETAs**: Inside Dhaka fee & ETA, Outside Dhaka fee & ETA, dispatch cut-off time (if confirmed), free-delivery threshold (0 if none).
3. **Stock Counts**: Current physical jar counts for `250g`, `500g`, `1kg` (automatically decremented atomically on each order).
4. **Payment Channels**: Toggle COD; enter verified bKash / Nagad merchant/personal numbers only if active.
5. **Contact Channels**: Phone, WhatsApp (`+880...`), email, showroom/dispatch address, and Google Maps link (leave blank to hide).

## 3. Managing Orders & Fulfillment
- **Reviewing Orders**: Filter by status (`pending`, `confirmed`, `processing`, `shipped`, `delivered`, `cancelled`) or export CSV.
- **COD Risk Review**: Orders flagged by the risk threshold appear for manual confirmation before dispatch.
- **Courier Booking**: Book Steadfast, Pathao, or RedX directly from an order row once courier API keys are configured. Booking is idempotent — clicking twice will not create a duplicate parcel.
- **Manual Payment Verification**: Verify manual bKash/Nagad transaction IDs before marking `paymentStatus = verified`. Never refund automatically via chat; process refunds manually and update the order status.

## 4. Managing the AI Shopping & Support Agent (`/admin` → Chatbot Tab)
- **System Config**: Configure bot name, Bangla/English welcome messages, quick questions, `languageBehavior` (`bangla_script` default), and `enableVoiceFeatures` (`false` default).
- **Starter Knowledge Pack (D11)**: Built-in starter FAQs start as **DRAFT (`active: false, published: false`)**. Review each item against your real business policies before publishing.
- **Draft vs. Published**: Test changes in the Admin Playground (`draft`) before publishing to live shoppers (`published`).
- **Bad-Answer Review Queue (F22)**: Filter unresolved customer thumbs-down turns and unanswered queries, add verified FAQs to fix gaps, and click **Export Regression JSON** to export cases for `tests/chatbot-regression-50.test.ts`.
- **Diagnostics & Health**: View `/api/health` diagnostics inside the Admin Console to verify Admin SDK readiness, Gemini model reachability, and cost ledger totals.

## 5. Reviews, Batches, Coupons & Retention
- **Reviews**: Customer submissions enter `pending` status and are hidden until approved by Admin.
- **Batches**: Only publish a batch record (`batches/{batchCode}`) when real production/harvest details are confirmed.
- **Coupons**: Set `code`, `discountPct`, `minSubtotalBdt`, `maxUses`, and `expiresAt`. Usage counts increment atomically at checkout.
- **Retention Campaigns**: Always run `dryRun: true` first to inspect eligible consented recipients. Respects Dhaka quiet hours (22:00–08:00 BST) and customer unsubscribe preferences automatically.
