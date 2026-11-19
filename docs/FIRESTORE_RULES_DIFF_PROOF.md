# Firestore Rules Diff Proof (Read-Only Audit — NO Deploy)

**Generated:** 2026-11-19
**Firebase Project:** `qualified-transit-lpd8p`
**Firestore Database:** `ai-studio-deshigee-20fc0392-83a6-4282-be32-68447c38436f`
**Live snapshot file:** `docs/LIVE_FIRESTORE_RULES_SNAPSHOT.rules` (copied verbatim from Firebase Console; byte-for-byte identical to baseline `1550bd7:firestore.rules`)

## Summary Line Counts

| File / Revision | Lines (`wc -l`) | Diff vs LIVE (`diff -u` line count) |
|---|---:|---:|
| `docs/LIVE_FIRESTORE_RULES_SNAPSHOT.rules` (LIVE Console) | 1289 | — |
| `1550bd7:firestore.rules` (Stage 0 baseline) | 1289 | 0 lines (identical) |
| `rules-admin-only-pending-sdk:firestore.rules` (`03b61fb`, `S0-02`+`S0-03` DEPLOY-BLOCKED) | 1253 | 115 lines |
| Current `master:firestore.rules` (LIVE rules + DEPLOY-BLOCKED comment banner only) | 1299 | 16 lines |

---

## 1. LIVE vs Baseline `1550bd7:firestore.rules`

Command:
```bash
diff -u docs/LIVE_FIRESTORE_RULES_SNAPSHOT.rules <(git show 1550bd7:firestore.rules)
```

Output (`0` lines — exit code `0`, byte-for-byte identical):
```diff
(empty — 0 bytes difference)
```

---

## 2. LIVE vs Branch `rules-admin-only-pending-sdk` (`03b61fb`, `S0-02` + `S0-03`)

Command:
```bash
diff -u docs/LIVE_FIRESTORE_RULES_SNAPSHOT.rules <(git show rules-admin-only-pending-sdk:firestore.rules)
```

Output (`115` lines):
```diff
--- LIVE (Firebase Console snapshot)
+++ branch rules-admin-only-pending-sdk (03b61fb):firestore.rules
@@ -1130,38 +1130,21 @@
       allow delete: if isValidId(chunkId) && isAdmin();
     }
 
+    // S0-02: Server-only session & draft storage (zero anonymous/client direct read or write).
+    // Customer access goes strictly through /api/chat/session with signed HttpOnly cookie ownership.
     match /chat_sessions/{sessionId} {
-      allow get: if isValidId(sessionId);
-      allow list: if isAdmin();
-      allow create: if isValidId(sessionId)
-        && isValidChatSession(incoming())
-        && incoming().sessionId == sessionId
-        && (
-          isAdmin()
-          || (
-            (!('aiPaused' in incoming()) || incoming().aiPaused == false)
-            && (!('activeTicketId' in incoming()) || incoming().activeTicketId == '')
-            && (!('assignedAgentName' in incoming()) || incoming().assignedAgentName == '')
-            && (!('agentReplies' in incoming()) || incoming().agentReplies.size() == 0)
-          )
-        );
-      allow update: if isValidId(sessionId)
+      allow get, list: if isAdmin();
+      allow create, update: if isValidId(sessionId)
+        && isAdmin()
         && isValidChatSession(incoming())
-        && incoming().sessionId == sessionId
-        && (
-          isAdmin()
-          || (
-            !incoming().diff(existing()).affectedKeys().hasAny(['aiPaused', 'activeTicketId', 'assignedAgentName', 'agentReplies'])
-            && (!('linkedPhone' in existing()) || existing().linkedPhone == '' || incoming().linkedPhone == existing().linkedPhone)
-          )
-        );
+        && incoming().sessionId == sessionId;
       allow delete: if isValidId(sessionId) && isAdmin();
     }
 
     match /order_drafts/{draftId} {
-      allow get: if isValidId(draftId);
-      allow list: if isAdmin();
+      allow get, list: if isAdmin();
       allow create, update: if isValidId(draftId)
+        && isAdmin()
         && isValidOrderDraft(incoming())
         && incoming().draftId == draftId;
       allow delete: if isValidId(draftId) && isAdmin();
@@ -1224,26 +1207,18 @@
       allow update, delete: if isValidId(orderNumber) && isAdmin();
     }
 
+    // S0-03: Server-only refill reminder & marketing consent records (zero anonymous/client read or write).
     match /refill_reminders/{reminderId} {
-      allow get: if isValidId(reminderId);
-      allow list: if isAdmin();
+      allow get, list: if isAdmin();
       allow create: if isValidId(reminderId)
+        && isAdmin()
         && isValidRefillReminder(incoming())
         && incoming().createdAt == request.time
-        && reminderId == incoming().orderNumber + '_' + incoming().phone
-        && exists(/databases/$(database)/documents/order_tracking/$(reminderId));
+        && reminderId == incoming().orderNumber + '_' + incoming().phone;
       allow update: if isValidId(reminderId)
+        && isAdmin()
         && isValidRefillReminder(incoming())
-        && incoming().createdAt == existing().createdAt
-        && (
-          isAdmin()
-          || (
-            reminderId == existing().orderNumber + '_' + existing().phone
-            && incoming().diff(existing()).affectedKeys().hasOnly([
-              'intervalDays', 'status', 'nextReminderAtIso', 'updatedAt'
-            ])
-          )
-        );
+        && incoming().createdAt == existing().createdAt;
       allow delete: if isValidId(reminderId) && isAdmin();
     }
 
@@ -1254,27 +1229,16 @@
     }
 
     match /marketing_consents/{phoneKey} {
-      allow get: if isValidId(phoneKey);
-      allow list: if isAdmin();
+      allow get, list: if isAdmin();
       allow create: if isValidId(phoneKey)
+        && isAdmin()
         && isValidMarketingConsent(incoming())
         && incoming().createdAt == request.time
-        && phoneKey == incoming().phone
-        && (!('campaignCount' in incoming()) || incoming().campaignCount == 0)
-        && !('lastCampaignAtIso' in incoming());
+        && phoneKey == incoming().phone;
       allow update: if isValidId(phoneKey)
+        && isAdmin()
         && isValidMarketingConsent(incoming())
-        && incoming().createdAt == existing().createdAt
-        && (
-          isAdmin()
-          || (
-            phoneKey == existing().phone
-            && incoming().diff(existing()).affectedKeys().hasOnly([
-              'optIn', 'unsubscribed', 'quietHoursRespect', 'channel',
-              'source', 'consentTimestampIso', 'updatedAt'
-            ])
-          )
-        );
+        && incoming().createdAt == existing().createdAt;
       allow delete: if isValidId(phoneKey) && isAdmin();
     }
 
```

---

## 3. LIVE vs Current `master:firestore.rules` (Restored for Running Code + DEPLOY-BLOCKED Banner)

Command:
```bash
diff -u docs/LIVE_FIRESTORE_RULES_SNAPSHOT.rules firestore.rules
```

Output (`16` lines — comment header only, zero functional rule differences):
```diff
--- LIVE (Firebase Console snapshot)
+++ current master:firestore.rules
@@ -1,3 +1,13 @@
+// ============================================================================
+// DEPLOY-BLOCKED NOTICE (see /DEPLOY_BLOCKED.md)
+// Commits a9b83d4 (S0-02) and 03b61fb (S0-03) restricted chat_sessions,
+// order_drafts, refill_reminders, and marketing_consents to isAdmin()-only.
+// Those hardened rules are STAGED on branch `rules-admin-only-pending-sdk`
+// and are DEPLOY-BLOCKED until server-side Firebase Admin SDK (ADC) replaces
+// unauthenticated REST calls in src/lib/chatbot/firestoreRest.ts and passes
+// Firestore Emulator tests + explicit owner deployment approval.
+// `master` intentionally keeps rules matching LIVE (1550bd7) and running code.
+// ============================================================================
 rules_version = '2';
 service cloud.firestore {
   match /databases/{database}/documents {
```
