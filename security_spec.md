# Deshi Gee Security Specification & Invariants

## 1. Data Invariants
1. **PII Isolation**: Customer names, phone numbers, and street addresses stored in `/orders/{orderId}`, `/chatbot_logs/{logId}`, and `/chatbot_support_requests/{reqId}` are strictly unreadable (`get` and `list`) to unauthenticated users and non-admin users. Public order tracking reads only `/order_tracking/{orderNumber_phone}` via exact document `get` (never `list`) and contains zero PII.
2. **Initial Order & Payment Integrity**: Newly created orders must enforce `status == 'pending'`, valid Bangladesh mobile format `^01[3-9][0-9]{8}$`, valid weight variant (`250g`, `500g`, `1kg`), positive BDT totals, and `paymentStatus != 'verified'` (customers can never mark their own bKash/Nagad transaction as verified).
3. **Batch Atomicity**: Creating an order in `/orders/{orderId}` must atomically create its matching `/order_tracking/{orderId}_{phone}` record in the same write batch (`existsAfter`).
4. **Review Moderation Gate**: Publicly submitted reviews must enter with `status == 'pending'` and `helpfulCount == 0`. Public `list`/`get` queries only expose `status == 'approved'` reviews. Only Admin can approve/reject reviews, and public helpful-vote updates may only increment `helpfulCount` by `+1` on already approved reviews.
5. **Chatbot Draft vs Published Isolation**: Only `/chatbot_config/published`, active+published `/chatbot_faqs`, and `status == 'published'` `/chatbot_kb_docs` are readable by storefront/API clients. Draft config, version snapshots, unpublished FAQs/docs, and conversation logs require verified Admin permissions.
6. **Append-Only Chat Telemetry & Handover Gate**: Visitors/server may append new `/chatbot_logs` with `resolved == false` and `/chatbot_support_requests` with `status == 'open'` + valid BD phone format, and cannot read, list, tamper with, or delete logs from other sessions.
7. **Admin Verification**: Admin privileges require `request.auth != null && request.auth.token.email_verified == true` and either the bootstrapped owner email or an `/admins/{uid}` document.
8. **Temporal Integrity & Strict Key Bounds**: All `createdAt` and `updatedAt` fields must match `request.time`, and every write validates `keys().hasAll(...)` + `keys().hasOnly(...)` + explicit `.size()` bounds.
9. **Confirmation Token Replay & Persistent Rate Buckets**: Confirmed chatbot orders require a signed confirmation token recorded atomically inside `/chatbot_used_tokens/{tokenId}` alongside `/chatbot_order_idempotency/{idemKey}` in the same Firestore batch commit as `/orders/{orderId}` (`existsAfter`), preventing replay and duplicate order creation. Rate buckets in `/chatbot_rate_buckets/{bucketId}` use hashed keys and strictly enforce monotonic count increments (`+1` or reset `1`).
10. **Knowledge Chunk Scope & Internal Doc Isolation**: `/chatbot_kb_docs/{docId}` and `/knowledge_chunks/{chunkId}` strictly block public `get`/`list` whenever `accessScope == 'internal'` or `status == 'draft'`. Internal operational notes are never returned to storefront retrieval or prompt context.
11. **Session Language & Order Draft TTL Integrity**: `/chat_sessions/{sessionId}` and `/order_drafts/{draftId}` disallow unauthenticated collection `list` (`allow list: if isAdmin()`), enforce `sessionId` / `draftId` exact binding (`draft_${sessionId}`), bound `priceQuoteVersion`, and reject tampered writes missing `request.time`.
12. **Feedback Queue Protection**: `/chatbot_feedback/{feedbackId}` enforces strict enum values (`rating in ['up', 'down']`, bounded `reason` allowlist), `createdAt == request.time`, and Admin-only `get`/`list`/`update` triage.
13. **Atomic Inventory Decrement & Restore**: Customer order creation and pre-dispatch/admin cancellation pair `/orders/{orderId}` with `/store_settings/main` stock updates in the same Firestore batch (`existsAfter` + exact variant delta matching `qty250g`, `qty500g`, and `qty1kg`), preventing negative stock and oversell races.
14. **Pre-Dispatch Customer Lock & Audit Immutability**: Customers may edit delivery address or cancel only when `existing().status in ['pending', 'confirmed']` alongside synced `/order_tracking` updates and recalculated pricing. Post-dispatch (`processing`/`shipped`/`delivered`) edits require Admin. Every order mutation appends an immutable `/order_audit_logs/{logId}` (`allow update, delete: if false;`).
15. **Zero-PII Duplicate Fingerprint Isolation**: `/order_fingerprints/{fingerprintId}` stores only SHA-256 fingerprint hashes, `orderNumber`, and `createdAtMs` without phone numbers, names, or street addresses; collection `list` is Admin-only.

## 2. Dirty Dozen Adversarial Payloads (Must All Fail with PERMISSION_DENIED)
1. **Unauthenticated Order List Scrape**: `GET /orders` -> Denied (`allow list: if isAdmin()`).
2. **Order Tracking List Scrape**: `LIST /order_tracking` -> Denied (`allow list: if isAdmin()`).
3. **Self-Verified bKash Payment**: `CREATE /orders/DG-9999` with `paymentStatus: 'verified'` -> Denied.
4. **Shadow Ghost Field Injection**: `CREATE /orders/DG-9999` with extra field `isAdminBypass: true` -> Denied by `keys().hasOnly(...)`.
5. **Orphaned Order Without Tracking Projection**: `CREATE /orders/DG-9999` outside a batch without `/order_tracking/DG-9999_{phone}` -> Denied by `existsAfter(...)`.
6. **Invalid Bangladesh Phone Pattern**: `CREATE /orders/DG-9999` with `phone: '12345'` -> Denied by regex guard.
7. **Auto-Approved Review Injection**: `CREATE /reviews/rev1` with `status: 'approved'` -> Denied (`status == 'pending'` enforced).
8. **Chatbot Draft & Internal KB Read Leak**: `GET /chatbot_config/draft` or `GET /knowledge_chunks/{id}` with `accessScope: 'internal'` by unauthenticated visitor -> Denied.
9. **Chatbot Log / Session / Feedback Scraping**: `LIST /chatbot_logs`, `LIST /chat_sessions`, `LIST /order_drafts`, or `LIST /chatbot_feedback` by visitor -> Denied (`allow list: if isAdmin()`).
10. **Unpublished FAQ Scraping**: `GET /chatbot_faqs/{id}` where `published: false` by visitor -> Denied.
11. **Unverified Email Admin Spoof**: Admin request with matching email string where `email_verified: false` -> Denied.
12. **Oversized Document ID Poisoning**: `CREATE /chatbot_logs/<200-char-id>` -> Denied by `isValidId()`.
