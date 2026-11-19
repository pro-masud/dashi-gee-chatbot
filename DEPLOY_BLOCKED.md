# DEPLOY-BLOCKED — Firestore Rules (`S0-02` & `S0-03`)

**Status:** 🚫 **DO NOT DEPLOY `rules-admin-only-pending-sdk` TO LIVE FIRESTORE** until server-side Firebase Admin SDK (or equivalent authenticated server identity) is implemented, verified against the Firestore Emulator, and explicitly approved for deployment by the owner.

## Blocked Commits & Branch

| Commit | Item | What Changed | Disposition |
|---|---|---|---|
| `a9b83d4` | `S0-02` | Restricted `/chat_sessions/{sessionId}` and `/order_drafts/{draftId}` in `firestore.rules` to `isAdmin()` only | **Rules patch moved to branch `rules-admin-only-pending-sdk`.** API-layer signed HttpOnly cookie ownership + ≥128-bit session IDs + rate limits remain active on `master`. |
| `03b61fb` | `S0-03` | Restricted `/refill_reminders/{reminderId}` and `/marketing_consents/{phoneKey}` in `firestore.rules` to `isAdmin()` only | **Rules patch moved to branch `rules-admin-only-pending-sdk`.** API-layer phone ownership proof (Order ID + phone, signed unsubscribe token, or verified Admin) + rate limit remain active on `master`. |

## Why Deploying the `S0-02` / `S0-03` Rules Today Breaks Production

All server-side Next.js API routes currently read and write Firestore via `src/lib/chatbot/firestoreRest.ts` using the **unauthenticated Firestore REST API + public web API key** (`?key=<NEXT_PUBLIC_FIREBASE_API_KEY>`, no `Authorization: Bearer <token>` on customer/server flows).

Because Firestore evaluates REST calls made with only `?key=...` as `request.auth == null`:
- Deploying `isAdmin()`-only rules on `chat_sessions`, `order_drafts`, `refill_reminders`, and `marketing_consents` immediately returns `403 PERMISSION_DENIED` on:
  - `/api/chat` and `/api/chat/session` (breaks chatbot session persistence & order draft save/resume)
  - `/api/channels/webhook` (breaks WhatsApp/Messenger session linking & STOP unsubscribe persistence)
  - `/api/orders/refill-reminder` (breaks customer refill reminder opt-in & lookup)
  - `/api/retention/campaigns` (breaks customer consent/unsubscribe persistence)

## What `master` Contains Today

- `master:firestore.rules` matches the **LIVE** Firestore rules (`1550bd7` baseline, 0 functional rule changes) plus a top comment banner referencing this file. This guarantees `master` stays compatible with the currently running REST + API key server code.
- The hardened `S0-02` & `S0-03` admin-only rules live intact on branch **`rules-admin-only-pending-sdk`** (commit `03b61fb`), ready to merge only after the Firebase Admin SDK migration is completed.
- The **API-layer** protections from `S0-02` (signed HttpOnly cookie session ownership, ≥128-bit IDs, poll rate limits) and `S0-03` (phone ownership proof via Order ID + phone or signed unsubscribe token, IP rate limits) remain active on `master`.

## Unblocking Checklist (Required Before Any Live Rules Deploy)

1. Owner confirms Firebase project ownership (`qualified-transit-lpd8p`: user-owned vs AI Studio Starter Tier) and approves the migration plan in `docs/SERVER_AUTH_AND_ADMIN_SDK_PLAN.md`.
2. Migrate server-side reads/writes in `src/lib/chatbot/firestoreRest.ts` to Firebase Admin SDK with Application Default Credentials (ADC) — never JSON key files — and enforce every invariant in server code (see `docs/SERVER_AUTH_AND_ADMIN_SDK_PLAN.md`, Section B).
3. Merge `rules-admin-only-pending-sdk` (plus the remaining `S1-01..S1-09` and `S0-13` `order_tracking`/`orders` rules lock-downs).
4. Execute the full Firestore Emulator adversarial test suite (requires Java) proving `"attacker with the public API key cannot do X"` for every collection AND verifying legitimate customer/admin flows pass through Next.js API routes.
5. Receive explicit written owner approval for the specific Firestore rules deployment.
