# Interim Minimal Firestore Rules Hotfix Proposal — `S0-13` (Document ONLY — NOT Applied / NOT Deployed)

> **Status:** PROPOSAL ONLY — **NOT applied to `firestore.rules` and NOT deployed to live Firestore.**
> **Target LIVE project:** `qualified-transit-lpd8p` · **Database:** `ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f`
> **Baseline reference:** `docs/LIVE_FIRESTORE_RULES_SNAPSHOT.rules` (`1550bd7:firestore.rules`)

---

## 1. Purpose of This Interim Hotfix

While the full Firebase Admin SDK migration (`docs/SERVER_AUTH_AND_ADMIN_SDK_PLAN.md`) awaits project ownership confirmation and implementation, the **LIVE** rules currently allow three critical, directly exploitable money/integrity attacks using only the public web API key:

1. **Unauthenticated `orders/{orderId}` update (L909–923):** An attacker who only guesses an order number (`DG-10001`..`DG-99999`) — **without even knowing the customer's phone** — can overwrite `district`, `area`, `address` (shipping hijack), `deliveryZone`, `deliveryFeeBdt` (down to `0`), `totalBdt`, and `estimatedDelivery` on any `pending` or `confirmed` order.
2. **Unauthenticated `order_tracking/{lookupId}` update / status forgery (L947–951):** Paired with an `orders` update, an unauthenticated client can overwrite `order_tracking.status` to ANY valid status (`shipped` / `delivered` / `cancelled`) because the rule never checks `incoming().status == getAfter(/orders/...).data.status`.
3. **Unvalidated `deliveryFeeBdt`, `discountBdt`, and `totalBdt` on `orders/{orderId}` `allow create` (L142–144, L167–189, L885–895):** A public-key attacker can create a real order with `deliveryFeeBdt: 1`, `discountBdt: subtotalBdt`, `totalBdt: 1`, `couponCode: ''`, and **zero** confirmation token. Additionally, `store_settings/main` is currently **missing (`404`)** in the live DB, causing `matchesCanonicalStorePricing` (L169–175) to fall back to hardcoded `680 / 1290 / 2480`.

---

## 2. Proposed Minimal LIVE Rules Patch (Diff Against `1550bd7:firestore.rules`)

> **Prerequisite BEFORE deploying this hotfix:** Admin must first create/seed `store_settings/main` in live Firestore with the owner-confirmed canonical prices (`price250g`, `price500g`, `price1kg`) and zone delivery fees (`insideDhakaFee`, `suburbanFee`, `outsideDhakaFee`, `remoteFee`, `freeDeliveryThresholdBdt`).

### Patch A — Validate `deliveryFeeBdt`, `discountBdt`, and `totalBdt` in `matchesCanonicalStorePricing` (`L167–189`)

```firestore
    function canonicalDeliveryFeeForZone(settings, zone, subtotal) {
      return (subtotal >= settings.freeDeliveryThresholdBdt)
        ? 0
        : (
            zone == 'dhaka' ? settings.insideDhakaFee
            : (zone == 'suburban' && 'suburbanFee' in settings ? settings.suburbanFee
              : (zone == 'remote' && 'remoteFee' in settings ? settings.remoteFee
                : settings.outsideDhakaFee))
          );
    }

    function matchesCanonicalStorePricing(data) {
      let hasSettings = exists(/databases/$(database)/documents/store_settings/main);
      let s = hasSettings ? get(/databases/$(database)/documents/store_settings/main).data : null;
      let expectedSubtotal = hasSettings
        ? ((data.qty250g * s.price250g) + (data.qty500g * s.price500g) + (data.qty1kg * s.price1kg))
        : ((data.qty250g * 680) + (data.qty500g * 1290) + (data.qty1kg * 2480));
      let expectedUnit = hasSettings
        ? (data.weight == '250g' ? s.price250g : (data.weight == '500g' ? s.price500g : s.price1kg))
        : (data.weight == '250g' ? 680 : (data.weight == '500g' ? 1290 : 2480));
      let expectedFee = hasSettings
        ? canonicalDeliveryFeeForZone(s, data.deliveryZone, data.subtotalBdt)
        : (data.subtotalBdt >= 2500 ? 0 : (data.deliveryZone == 'dhaka' ? 80 : 130));
      let validDiscount = (data.discountBdt == 0 && data.couponCode == '')
        || (
          data.couponCode.size() >= 3
          && exists(/databases/$(database)/documents/coupons/$(data.couponCode))
          && get(/databases/$(database)/documents/coupons/$(data.couponCode)).data.active == true
          && data.subtotalBdt >= get(/databases/$(database)/documents/coupons/$(data.couponCode)).data.minOrderBdt
          && data.discountBdt <= (
            get(/databases/$(database)/documents/coupons/$(data.couponCode)).data.type == 'flat'
              ? get(/databases/$(database)/documents/coupons/$(data.couponCode)).data.value
              : (data.subtotalBdt * get(/databases/$(database)/documents/coupons/$(data.couponCode)).data.value) / 100
          )
        );
      return data.subtotalBdt == expectedSubtotal
        && data.unitPriceBdt == expectedUnit
        && data.deliveryFeeBdt == expectedFee
        && validDiscount
        && data.totalBdt == data.subtotalBdt + data.deliveryFeeBdt - data.discountBdt
        && data.totalBdt > 0;
    }
```

> **Note:** Also check `order_tracking/{lookupId}` `allow create` (L931–935) to verify `getAfter(/orders/$(incoming().orderNumber)).data.totalBdt == incoming().totalBdt` and `lookupId == incoming().orderNumber + '_' + getAfter(/orders/$(incoming().orderNumber)).data.phone`, so forged tracking projections cannot diverge from the order document.

### Patch B — Close Unauthenticated `orders/{orderId}` Update (`L896–924`)

Remove both unauthenticated customer update branches (`L908–923`), leaving **Admin-only updates**:

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

### Patch C — Close Unauthenticated `order_tracking/{lookupId}` Update & Status Forgery (`L936–952`)

Remove the unauthenticated update branch (`L947–951`), leaving **Admin-only updates**:

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

### Patch D — Close Unauthenticated Stock-Restore Abuse on `store_settings/main` (`L869–878`)

Remove the unauthenticated cancel-restore branch (`L869–878`) from `store_settings/{docId}` `allow update` (since unauthenticated order cancellation is disabled by Patch B). Keep only admin updates + atomic decrement paired with new `orders/{lastOrderNumber}` creation until Admin SDK moves order creation server-side.

---

## 3. Exact Impact Matrix — What Breaks vs What Keeps Working Until Admin SDK Exists

| Feature / Flow | Status After Interim Hotfix | Exact Details |
|---|---|---|
| **Customer self-serve Address Edit** (`POST /api/orders/manage`, `action: 'update_address'`, Track page & Chatbot) | ❌ **BREAKS (by design)** | Returns Firestore `403` because `orders` & `order_tracking` `allow update` becomes `isAdmin()`-only. **Interim UX mitigation:** display a clear message directing customers to WhatsApp/phone support for address changes, and admins perform edits via Admin Dashboard until Admin SDK is live. |
| **Customer self-serve Order Cancel** (`POST /api/orders/manage`, `action: 'cancel'`, Track page & Chatbot) | ❌ **BREAKS (by design)** | Returns Firestore `403` for the same reason. **Interim UX mitigation:** route cancel requests to a support ticket / WhatsApp handover so staff cancel from Admin Dashboard until Admin SDK is live. |
| **Storefront Checkout Order Placement** (`BagCheckoutDrawer` → `createOrderAtomically`) | ✅ **Works** *(requires `store_settings/main` seeded + client fee matching canonical formula)* | `orders` + `order_tracking` `allow create` remains open for valid canonical-priced orders. |
| **Chatbot Order Placement** (`POST /api/order` → `createServerOrderAtomically`) | ✅ **Works** *(requires `store_settings/main` seeded)* | Server computes canonical prices, zone fees, and valid coupons matching Patch A. |
| **Order Tracking Lookup** (`/track` → `trackOrderLookup` / `fetchServerOrderTracking`) | ✅ **Works** | `order_tracking` `allow get` is unchanged in this interim hotfix (replaced by unguessable lookup tokens in §4 + Admin SDK server route). |
| **Admin Dashboard Order Management** (status, payment verification, courier dispatch, review approval) | ✅ **Works** | `isAdmin()` update branches on `orders`, `order_tracking`, and `store_settings/main` remain intact. |

> **What this interim hotfix does NOT fix (still requires Admin SDK):**
> - Public-key attackers can still create fake `pending` orders directly via Firestore REST (now at canonical prices only — no more `৳1` orders), still read `order_tracking/{DG-XXXXX}_{phone}` without rate limits, and still access `S1-01..S1-09` collections until Admin SDK lands.

---

## 4. Proposal: Unguessable Order Lookup Tokens (Replacing `DG-<5 digits>` + Phone-Only Lookup)

### Why `{orderNumber}_{phone}` Fails
- Sequential/short `DG-XXXXX` order numbers (`10,000`–`99,999`) have only ~16.5 bits of entropy.
- Direct Firestore `allow get` on `order_tracking/{orderNumber}_{phone}` has zero rate limiting, turning it into a brute-force oracle for both phone→orders and order→phone enumeration.

### Proposed Design

1. **Mint a 192-bit CSPRNG Lookup Token at Order Creation (`src/lib/chatbot/orderToken.ts`):**
   - `const trackingToken = randomBytes(24).toString('base64url');` (32 URL-safe chars, **192 bits of entropy** — computationally infeasible to guess or enumerate).
   - Store `trackingTokenHash = hmacSha256(ORDER_TOKEN_SECRET, trackingToken)` on `orders/{orderId}` (admin-only) and store the public projection at `order_tracking/{trackingToken}` (or, once Admin SDK is live, make `order_tracking` `isAdmin()`-only and look up via server API).
2. **Customer Confirmation & Magic Link:**
   - Send the customer `/track?t=<trackingToken>` in the on-screen confirmation receipt, SMS, email, and WhatsApp order confirmation.
   - `/track` sets `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and is excluded from `robots.ts` & `sitemap.ts` (`S0-10`) so tracking tokens never leak via search indexes or `Referer` headers.
   - The tracking response returns ONLY non-PII status fields (`orderNumber`, `status`, `paymentMethod`, `paymentStatus`, `itemsSummary`, `totalBdt`, `district`, `estimatedDelivery`, `courierPartner`, `consignmentId`, masked phone `017****3344` — **never** full street address or full phone).
3. **Fallback Lookup When Customer Loses the Link (Admin SDK Phase):**
   - Remove direct client `order_tracking` Firestore `get` completely (`allow get, list: if isAdmin();`).
   - Provide `POST /api/orders/track` accepting EITHER `{ trackingToken }` OR `{ orderNumber, phone }` behind strict server-side rate limiting:
     - **5 attempts / 15 min per IP** AND **5 attempts / 15 min per `orderNumber`** (uniform `404` / generic error message for both missing order and wrong phone so it cannot act as a phone oracle).
4. **Migration Path for Existing Legacy Orders:**
   - Existing `order_tracking/{DG-XXXXX}_{phone}` documents continue to work through `/api/orders/track` (rate-limited `orderNumber + phone` match) once Admin SDK is active; optionally backfill `trackingToken` on open (`pending`/`confirmed`/`processing`/`shipped`) orders via a one-time owner-approved admin script.
