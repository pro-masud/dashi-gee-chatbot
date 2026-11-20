# Deshi Gee — Real-Device QA & Smoke Test Checklist

Run this checklist on real physical devices (Android Chrome + iOS Safari + Desktop Chrome/Safari) against the live Cloud Run URL after completing `docs/DEPLOY_RUNBOOK.md`.

## 1. Mobile Viewport & Touch (360×800 Android & 390×844 iOS Safari)
- [ ] Hero headline, jar selector, and CTA render cleanly above the fold with zero horizontal overflow (`scrollWidth <= innerWidth`).
- [ ] Unified mobile sticky Buy bar + Chat trigger has zero overlap with page content or system safe-area bottom inset.
- [ ] Unconfirmed store fields remain completely hidden (zero placeholder phones, zero fake prices, zero unapproved claims).
- [ ] Opening the Chat Panel (`ChatPanel`) displays clean Bangla/English welcome, quick chips, and NO voice dictation / TTS buttons (unless explicitly enabled in Admin).
- [ ] Pressing `Escape` or Back closes modals/drawers cleanly without trapping focus or causing React hook errors.

## 2. Storefront Checkout & Order Tracking
- [ ] Add `500g` jar to Bag → open Checkout Drawer → verify live confirmed subtotal + Inside/Outside Dhaka delivery fee.
- [ ] Place a real test COD order → verify `200 OK`, Order Number (`DG-...`), and private `/track?token=...` link.
- [ ] Open `/track?token=...` in a fresh incognito window → verify order status loads automatically with masked phone (`017•••••678`) and zero full address leak.
- [ ] Open `/track` manually → enter Order ID + wrong phone → verify uniform `404` error; enter matching phone → verify order loads.

## 3. AI Shopping & Support Agent
- [ ] Ask `"500g ghee er dam koto?"` → verify Bangla script reply (D1) with confirmed DB price.
- [ ] Ask `"Chitagong delivery charge koto?"` → verify bot asks `"Did you mean Chattogram?"` (D13) without silently rewriting.
- [ ] Walk through an order in chat → type `"yes confirm order"` in text box → verify **ZERO** order is created until clicking the signed **Confirm Order** button.
- [ ] Click **Confirm Order** → verify single order created; rapidly click again → verify idempotent duplicate prevention (no second order, no double stock decrement).
- [ ] Request order cancellation on an unpaid COD order in chat → verify two-step signed **Confirm** card; test on a paid order → verify human handover with zero refund promise.
- [ ] Measure live latency via `npx tsx scripts/latency-benchmark.ts --live` (target: p50 < 8s, p95 < 20s).

## 4. Admin Console (`/admin`)
- [ ] Unauthenticated visitor sees sign-in gate only (zero order/customer PII rendered).
- [ ] Non-admin Google account is rejected (`403`).
- [ ] Owner (`kinboni.bd@gmail.com`) signs in → mobile drawer navigation works cleanly on 360px & 768px tablet viewports.
- [ ] Update a jar price in Admin → verify storefront and chatbot reflect the new price immediately.
- [ ] Verify `/api/health` admin diagnostics shows `adminSdk.reachable = true` and `gemini` reachability `ok`.
- [ ] Verify F22 Bad-Answer Queue renders and **Export Regression JSON** downloads valid JSON.

## 5. Security & Error Boundary Checks
- [ ] Confirm browser DevTools Network tab shows zero `?key=` calls to `firestore.googleapis.com`.
- [ ] Confirm `GET /api/chatbot/public-config` returns ONLY `{ enabled, botName, welcomeMessage, quickQuestions, enableVoiceFeatures }`.
- [ ] Confirm `GET /api/health` without auth returns minimal `{ ok: true, status: 'ok' }` only.
