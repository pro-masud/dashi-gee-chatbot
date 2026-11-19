# Interim Split Firestore Rules Hotfix Proposal — `S0-13` (NOT Approved / NOT Deployed)

> **Status:** **NOT APPROVED TO DEPLOY — NOT DEPLOYED TO LIVE FIRESTORE.**
> **Branch Strategy:** `master:firestore.rules` stays **untouched** (identical to LIVE `1550bd7` + DEPLOY-BLOCKED banner).
> - **Part 1 (Patches B, C, D — pure removals):** staged ONLY on git branch **`hotfix-s013-part1`**.
> - **Part 2 (Patch A — canonical fee/discount/total validation):** staged ONLY on git branch **`hotfix-s013-part2`** (branched on top of `hotfix-s013-part1`).
> **Target LIVE project:** `qualified-transit-lpd8p` · **Database:** `ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f`
> **Emulator Test Suite (owner runs locally with Java):** `tests/emulator/firestore-rules-hotfix-s013.test.ts` (`npm run test:rules:s013`)

---

## 1. Plain Disclosure — What This Interim Hotfix Does NOT Stop

> **CRITICAL LIMITATION:** Neither Part 1 nor Part 2 stops the following public-key attacks. **Only the Firebase Admin SDK migration (`docs/SERVER_AUTH_AND_ADMIN_SDK_PLAN.md`) closes them:**
>
> 1. **Fake order creation & `store_settings/main` stock drain (`ATK-A`, `S1-07`):** Because `orders` `allow create` and `store_settings/main` stock-decrement `allow update` must remain open until checkout runs via Admin SDK, an attacker with the public API key can still submit fake canonical-priced `pending` COD orders directly to Firestore REST and drain stock to `0` (bypassing server rate limits and HMAC confirmation tokens).
> 2. **`chatbot_rate_buckets` count reset / DoS (`ATK-B`, `S1-05`):** An attacker can still reset or max out rate-limit buckets directly in Firestore.
> 3. **`chatbot_cost_ledger` `capHit` kill-switch attack (`ATK-C`, `S1-05`):** An attacker can still increment `chatbot_cost_ledger/{YYYY-MM-DD}.totalUsd` by `$0.50` per write until `capHit = true`, taking the AI chatbot offline for all shoppers.
> 4. **`order_audit_logs` `actorType: 'admin'` forging (`ATK-D`, `S1-07`):** An attacker can still create fake `order_audit_logs` documents claiming `actorType: 'admin'` for any existing order.
> 5. **Direct `payment_gateway_events` creation (`ATK-E`), `marketing_consents` read/write (`ATK-F`), `chat_sessions`/`order_drafts` read/write (`ATK-G`), and `order_tracking/{DG-XXXXX}_{phone}` enumeration (`S0-13`):** Still open in LIVE rules until Admin SDK lands.

---

## 2. Split Part 1 — Patches B, C, D (Pure Removals · Branch `hotfix-s013-part1`)

Part 1 makes **zero** new `get`/`exists` calls and requires **no** `store_settings/main` seeding. It purely removes the three unauthenticated `update` branches on `orders`, `order_tracking`, and `store_settings/main`:

### Patch B — Remove Unauthenticated `orders/{orderId}` Update Branches (`L918–933`)
Removes both unauthenticated customer `cancel` and `edit_address` branches, leaving `orders/{orderId}` `allow update` strictly `isAdmin()`-only:

```firestore
      allow update: if isValidId(orderId)
        && isValidOrder(incoming())
        && incoming().createdAt == existing().createdAt
        && incoming().orderNumber == existing().orderNumber
        && isAdmin()
        && incoming().diff(existing()).affectedKeys().hasOnly([
          'status', 'paymentStatus', 'webhookStatus', 'reviewStatus',
          'courierPartner', 'consignmentId', 'courierTrackingUrl', 'dispatchedAtIso', 'updatedAt'
        ]);
```

### Patch C — Remove Unauthenticated `order_tracking/{lookupId}` Update & Status Forgery (`L957–961`)
Removes the unauthenticated 7-field update branch (which allowed forging `status: 'delivered'` without checking `orders`), leaving `order_tracking/{lookupId}` `allow update` strictly `isAdmin()`-only:

```firestore
      allow update: if isValidId(lookupId)
        && isValidOrderTracking(incoming())
        && incoming().orderNumber == existing().orderNumber
        && isAdmin()
        && incoming().diff(existing()).affectedKeys().hasOnly([
          'status', 'paymentStatus', 'estimatedDelivery', 'reviewStatus',
          'courierPartner', 'consignmentId', 'courierTrackingUrl', 'dispatchedAtIso', 'updatedAt'
        ]);
```

### Patch D — Remove Unauthenticated Cancel Stock-Restore Branch on `store_settings/main` (`L879–886`)
Removes the unauthenticated `cancelled` stock-restore branch on `store_settings/main` (because unauthenticated cancellation is closed by Patch B). Also refactors the remaining stock-decrement check into a `let`-bound helper (`matchesNewOrderStockDecrement`) cutting `store_settings/main` rule reads from 5 down to 3.

---

## 3. Exhaustive Part 1 Caller Impact Matrix (Every Server Route & Client Path)

Audited across the entire `app/` and `src/` tree before any Part 1 deploy:

| Feature / Flow | Exact Server Route & Client Code Path | Auth Token Sent to Firestore | Relies on Unauth Update Branch Removed in Part 1? | Status After Part 1 Deploy |
|---|---|---|---|---|
| **Customer Self-Serve Cancel** (Track page & Chatbot Confirm card) | `src/components/TrackOrderView.tsx:325`, `src/components/chatbot/ChatPanel.tsx:1031` → `POST /api/orders/manage` (`action: 'cancel'`) → `src/lib/chatbot/firestoreRest.ts:1052, 1408–1467` (`manageServerOrder`) | None (public API key) | **YES** — updates `orders` (unauth cancel), `order_tracking` (unauth update), and `store_settings/main` (unauth stock-restore) | ❌ **BREAKS (by design)** until Admin SDK. Customers must cancel via WhatsApp/Phone + Admin Dashboard. |
| **Customer Self-Serve Address Edit** (Track page & Chatbot Confirm card) | `src/components/TrackOrderView.tsx:384`, `src/components/chatbot/ChatPanel.tsx:1031` → `POST /api/orders/manage` (`action: 'edit_address'`) → `src/lib/chatbot/firestoreRest.ts:1052, 1276` (`manageServerOrder`) | None (public API key) | **YES** — updates `orders` (unauth address-edit) and `order_tracking` (unauth update) | ❌ **BREAKS (by design)** until Admin SDK. Customers must request address change via WhatsApp/Phone + Admin Dashboard. |
| **Courier Booking (Admin)** | `src/components/AdminDashboardView.tsx` → `POST /api/courier/book` (`app/api/courier/book/route.ts:139`) → `manageServerOrder({ action: 'dispatch_courier', adminIdToken })` (`firestoreRest.ts:1623`) | **Verified Admin Firebase ID token (`isAdmin()`)** | **NO** — uses `isAdmin()` update branch on `orders` + `order_tracking` | ✅ **Works** |
| **Courier Webhook Status Sync** | `POST /api/courier/webhook` (`app/api/courier/webhook/route.ts:97`) → `applyValidatedCourierStatusToOrder` (`firestoreRest.ts:5284–5365`) | None (public API key) | **NO (already blocked on LIVE!)** — `orders` already requires `isAdmin()` for `processing`/`shipped`/`delivered` transitions. Webhook event audit record (`payment_gateway_events`) still writes, while order patch awaits Admin SDK. | ⚠️ **Unchanged (already requires Admin SDK)** |
| **Payment Gateway Callback (SSLCommerz / bKash)** | `POST /api/payments/callback` (`app/api/payments/callback/route.ts:244`) → `fetchServerOrderForPaymentValidation` & `markServerOrderPaymentVerified` (`firestoreRest.ts:5177, 5196`) | None (public API key) | **NO (already blocked on LIVE!)** — `orders` `get` and `paymentStatus: 'verified'` update already require `isAdmin()`. | ⚠️ **Unchanged (already requires Admin SDK)** |
| **Verified Delivery Review** | `src/components/TrackOrderView.tsx:588` → `POST /api/orders/review` → `createVerifiedDeliveryReview` (`firestoreRest.ts`) | None (public API key) | **NO** — creates `reviews/{rev_DG-...}` + `order_review_claims/{orderNumber}` (`allow create`, reads `orders.status == 'delivered'`). Zero updates to `orders`/`order_tracking`/`store_settings`. | ✅ **Works** |
| **Admin Dashboard (Order Status, Review Decision, Store Settings)** | `src/components/AdminDashboardView.tsx:304, 359` → `POST /api/orders/manage` (`adminIdToken`); `src/lib/firebase.ts:160` (`saveStoreSettings`); `src/lib/firebase.ts:412` (`updateOrderStatus`) | **Verified Admin Firebase ID token (`isAdmin()`)** | **NO** — all use `isAdmin()` update branches on `orders`, `order_tracking`, and `store_settings/main`. | ✅ **Works** |
| **Storefront Checkout** | `src/components/BagCheckoutDrawer.tsx:405` → `POST /api/orders/storefront` (`app/api/orders/storefront/route.ts:288`) → `createServerOrderAtomically` (`firestoreRest.ts:708`) | None (public API key) | **NO** — uses `orders` `allow create`, `order_tracking` `allow create`, and `store_settings/main` **decrement** `allow update` (all kept in Part 1). | ✅ **Works** |
| **Chatbot Checkout** | `src/components/chatbot/ChatPanel.tsx:833` → `POST /api/order` (`app/api/order/route.ts:483`) → `createServerOrderAtomically` (`firestoreRest.ts:708`) | None (public API key) | **NO** — uses `orders` `allow create`, `order_tracking` `allow create`, and `store_settings/main` **decrement** `allow update` (all kept in Part 1). | ✅ **Works** |
| **Order Tracking Read (`/track`)** | `src/lib/firebase.ts:260` (`trackOrderLookup`) & `firestoreRest.ts:549` (`fetchServerOrderTracking`) | None (public API key) | **NO** — uses `order_tracking` `allow get` (unchanged in Part 1). | ✅ **Works** |

---

## 4. Split Part 2 — Patch A (Fee / Discount / Total Validation · Branch `hotfix-s013-part2`)

> **MANDATORY PREREQUISITE BEFORE DEPLOYING PART 2:**
> Admin **MUST** seed `store_settings/main` in live Firestore (`qualified-transit-lpd8p` / `ai-studio-deshigee-...`) with the owner-confirmed canonical prices (`price250g`, `price500g`, `price1kg`), stock counts, zone delivery fees (`insideDhakaFee`, `dhakaSuburbanFee`, `outsideDhakaFee`, `remoteDistrictFee`, `freeDeliveryThreshold`), and `advanceDiscountPct`. Note that `isValidStoreSettings` (`firestore.rules:49–111`) uses exact field names **`freeDeliveryThreshold`**, **`dhakaSuburbanFee`**, **`remoteDistrictFee`**, **`advanceDiscountPct`**, and `isValidCoupon` (`firestore.rules:282–299`) uses **`active`**, **`minSubtotalBdt`**, **`discountPct`**, **`stackableWithAdvance`**.

### Patch A Rule Logic (`let`-Bound to Respect Firestore Rules Call Limits)

```firestore
    function canonicalDeliveryFeeForZone(s, zone, subtotal) {
      return subtotal >= s.freeDeliveryThreshold
        ? 0
        : (
            zone == 'dhaka' ? s.insideDhakaFee
            : (zone == 'suburban' ? ('dhakaSuburbanFee' in s ? s.dhakaSuburbanFee : 90)
              : (zone == 'remote' ? ('remoteDistrictFee' in s ? s.remoteDistrictFee : 180)
                : s.outsideDhakaFee))
          );
    }

    function isValidOrderDiscount(data, advancePct) {
      let advanceDisc = (data.paymentMethod in ['bkash', 'nagad'] && advancePct > 0)
        ? math.round((data.subtotalBdt * advancePct) / 100.0)
        : 0;
      let hasCouponCode = data.couponCode.size() >= 3;
      let couponExists = hasCouponCode && exists(/databases/$(database)/documents/coupons/$(data.couponCode));
      let c = couponExists ? get(/databases/$(database)/documents/coupons/$(data.couponCode)).data : null;
      let couponEligible = couponExists
        && c.active == true
        && data.subtotalBdt >= c.minSubtotalBdt;
      let couponDisc = couponEligible
        ? math.round((data.subtotalBdt * c.discountPct) / 100.0)
        : 0;
      let stackable = couponEligible && (!('stackableWithAdvance' in c) || c.stackableWithAdvance == true);
      let expectedDiscount = !hasCouponCode
        ? (data.couponCode == '' ? advanceDisc : -1)
        : (
            couponEligible
              ? (stackable ? math.min(data.subtotalBdt, advanceDisc + couponDisc) : math.max(advanceDisc, couponDisc))
              : -1
          );
      return expectedDiscount >= 0 && data.discountBdt == expectedDiscount;
    }

    function matchesCanonicalStorePricing(data) {
      let hasSettings = exists(/databases/$(database)/documents/store_settings/main);
      let s = hasSettings ? get(/databases/$(database)/documents/store_settings/main).data : null;
      let p250 = hasSettings ? s.price250g : 680;
      let p500 = hasSettings ? s.price500g : 1290;
      let p1kg = hasSettings ? s.price1kg : 2480;
      let expectedSubtotal = (data.qty250g * p250) + (data.qty500g * p500) + (data.qty1kg * p1kg);
      let expectedUnit = data.weight == '250g' ? p250 : (data.weight == '500g' ? p500 : p1kg);
      let expectedFee = hasSettings
        ? canonicalDeliveryFeeForZone(s, data.deliveryZone, data.subtotalBdt)
        : (data.subtotalBdt >= 2500 ? 0 : (data.deliveryZone == 'dhaka' ? 80 : (data.deliveryZone == 'suburban' ? 90 : (data.deliveryZone == 'remote' ? 180 : 130))));
      let advancePct = hasSettings ? s.advanceDiscountPct : 5;
      return data.subtotalBdt == expectedSubtotal
        && data.unitPriceBdt == expectedUnit
        && data.deliveryFeeBdt == expectedFee
        && isValidOrderDiscount(data, advancePct)
        && data.totalBdt == data.subtotalBdt + data.deliveryFeeBdt - data.discountBdt
        && data.totalBdt > 0;
    }
```

And on `order_tracking/{lookupId}` `allow create`, a `let`-bound helper (`matchesCreatedOrderTracking(lookupId, incoming())`) fetches `getAfter(/orders/$(data.orderNumber)).data` **once** to enforce `orderAfter.totalBdt == data.totalBdt`, `orderAfter.deliveryFeeBdt == data.deliveryFeeBdt`, and `lookupId == data.orderNumber + '_' + orderAfter.phone`.

---

## 5. Patch A Firestore Rules Call-Count Audit (Against Hard Firestore Limits)

Firestore enforces two hard limits on `get()` / `exists()` / `getAfter()` / `existsAfter()`:
- **Single-document rule evaluation limit:** **10 calls**
- **Multi-document atomic batch / transaction limit:** **20 calls**

`createServerOrderAtomically` commits a **7-document atomic batch** (chatbot checkout) or **6-document atomic batch** (storefront checkout without `chatbot_used_tokens`).

| Document in Atomic Batch | Naive (Unbound) Patch A Calls | **`let`-Bound Patch A Calls (No Coupon)** | **`let`-Bound Patch A Calls (With Coupon)** | Exact Expressions Evaluated (`let`-Bound) |
|---|---:|---:|---:|---|
| 1. `orders/{orderId}` (`create`) | **15** ❌ *(exceeds 10!)* | **3** ✅ | **5** ✅ | `exists(store_settings/main)` + `get(store_settings/main)` [+ `exists(coupons/code)` + `get(coupons/code)`] + `existsAfter(order_tracking/...)` |
| 2. `order_tracking/{lookupId}` (`create`) | 3 | **2** ✅ | **2** ✅ | `existsAfter(orders/...)` + `let o = getAfter(orders/...)` |
| 3. `store_settings/main` (`update`, decrement) | 5 *(baseline)* | **3** ✅ | **3** ✅ | `existsAfter(orders/...)` + `!exists(orders/...)` + `let o = getAfter(orders/...)` |
| 4. `chatbot_used_tokens/{tokenId}` (`create`) | 1 | **1** ✅ *(0 on storefront)* | **1** ✅ *(0 on storefront)* | `existsAfter(orders/...)` |
| 5. `chatbot_order_idempotency/{idemKey}` (`create`) | 1 | **1** ✅ | **1** ✅ | `existsAfter(orders/...)` |
| 6. `order_fingerprints/{fpHash}` (`create`) | 1 | **1** ✅ | **1** ✅ | `existsAfter(orders/...)` |
| 7. `order_audit_logs/{logId}` (`create`) | 1 | **1** ✅ | **1** ✅ | `existsAfter(orders/...)` *(short-circuits `|| exists(...)`)* |
| **Max Single-Document Calls (Limit = 10)** | **15 ❌ FAILS** | **3 / 10 ✅** | **5 / 10 ✅** | Safe (5 calls headroom) |
| **Total 6-Doc Storefront Batch (Limit = 20)** | **26 ❌ FAILS** | **11 / 20 ✅** | **13 / 20 ✅** | Safe (7–9 calls headroom) |
| **Total 7-Doc Chatbot Batch (Limit = 20)** | **27 ❌ FAILS** | **12 / 20 ✅** | **14 / 20 ✅** | Safe (6–8 calls headroom) |

---

## 6. Running the Emulator Test Suite Locally (Owner With Java)

`tests/emulator/firestore-rules-hotfix-s013.test.ts` tests both branches directly against the Firebase Firestore Emulator REST API:

```bash
# Test Part 1 (Patches B, C, D — pure removals):
git checkout hotfix-s013-part1
firebase emulators:exec --only firestore --project qualified-transit-lpd8p "S013_HOTFIX_PART=1 npm run test:rules:s013"

# Test Part 2 (Patches B, C, D + Patch A — canonical fee/discount/total validation):
git checkout hotfix-s013-part2
firebase emulators:exec --only firestore --project qualified-transit-lpd8p "S013_HOTFIX_PART=2 npm run test:rules:s013"

# Always return to master afterward:
git checkout master
```

---

## 7. Proposal: Unguessable Order Lookup Tokens (Replacing `DG-<5 digits>` + Phone-Only Lookup)

### Why `{orderNumber}_{phone}` Fails
- Sequential/short `DG-XXXXX` order numbers (`10,000`–`99,999`) have only ~16.5 bits of entropy.
- Direct Firestore `allow get` on `order_tracking/{orderNumber}_{phone}` has zero rate limiting, turning it into a brute-force oracle for both phone→orders and order→phone enumeration.

### Proposed Design (Implemented During Admin SDK Phase)
1. **Mint a 192-bit CSPRNG Lookup Token at Order Creation (`src/lib/chatbot/orderToken.ts`):**
   - `const trackingToken = randomBytes(24).toString('base64url');` (32 URL-safe chars, **192 bits of entropy**).
   - Store `trackingTokenHash = hmacSha256(ORDER_TOKEN_SECRET, trackingToken)` on `orders/{orderId}` (admin-only).
2. **Customer Confirmation & Magic Link:**
   - Deliver `/track?t=<trackingToken>` in receipt, SMS, email, and WhatsApp confirmations.
   - `/track` is already excluded from `robots.ts` & `sitemap.ts` (`S0-10`) and should set `Cache-Control: no-store` & `Referrer-Policy: no-referrer`.
   - Response returns ONLY non-PII status fields (`orderNumber`, `status`, `paymentMethod`, `paymentStatus`, `itemsSummary`, `totalBdt`, `district`, `estimatedDelivery`, `courierPartner`, `consignmentId`, masked phone `017****3344`).
3. **Fallback Lookup When Customer Loses the Link:**
   - Lock `order_tracking` to `allow get, list: if isAdmin();`.
   - Serve `POST /api/orders/track` accepting `{ trackingToken }` OR `{ orderNumber, phone }` behind strict rate limiting (**5 attempts / 15 min per IP** AND **5 attempts / 15 min per `orderNumber`**) with uniform `404` responses.
