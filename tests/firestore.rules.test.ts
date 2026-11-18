import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');
const BLUEPRINT_PATH = path.resolve(process.cwd(), 'firebase-blueprint.json');
const SPEC_PATH = path.resolve(process.cwd(), 'security_spec.md');

const rulesText = fs.readFileSync(RULES_PATH, 'utf8');
const blueprint = JSON.parse(fs.readFileSync(BLUEPRINT_PATH, 'utf8')) as {
  entities: Record<string, { properties: Record<string, unknown>; required?: string[] }>;
  firestore: Record<string, unknown>;
};
const specText = fs.readFileSync(SPEC_PATH, 'utf8');

function extractMatchBlock(collectionPath: string): string {
  const idx = rulesText.indexOf(`match ${collectionPath}`);
  assert.ok(idx !== -1, `Expected rule block for match ${collectionPath}`);
  const headerBraceIdx = rulesText.indexOf(') {', idx);
  const blockStart =
    headerBraceIdx !== -1 && headerBraceIdx < idx + collectionPath.length + 12
      ? headerBraceIdx + 2
      : rulesText.indexOf('{', idx + `match ${collectionPath}`.length);
  assert.ok(blockStart !== -1, `Expected opening brace for match ${collectionPath}`);
  let depth = 0;
  for (let i = blockStart; i < rulesText.length; i++) {
    if (rulesText[i] === '{') {
      depth += 1;
    } else if (rulesText[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return rulesText.slice(idx, i + 1);
      }
    }
  }
  return rulesText.slice(idx);
}

function extractFunctionBody(fnName: string): string {
  const idx = rulesText.indexOf(`function ${fnName}(`);
  assert.ok(idx !== -1, `Expected helper function ${fnName}`);
  let depth = 0;
  let started = false;
  for (let i = idx; i < rulesText.length; i++) {
    if (rulesText[i] === '{') {
      depth += 1;
      started = true;
    } else if (rulesText[i] === '}') {
      depth -= 1;
      if (started && depth === 0) {
        return rulesText.slice(idx, i + 1);
      }
    }
  }
  return rulesText.slice(idx);
}

describe('T0.15 Firestore Security Rules — Dirty Dozen Adversarial Verification & Blueprint Sync', () => {
  it('enforces global default-deny safety net and strict isAdmin email_verified check (Dirty Dozen #11)', () => {
    const masterGate = extractMatchBlock('/{document=**}');
    assert.match(masterGate, /allow read, write: if false;/);

    const adminFn = extractFunctionBody('isAdmin');
    assert.match(adminFn, /request\.auth != null|isSignedIn\(\)/);
    assert.match(adminFn, /request\.auth\.token\.email_verified == true/);
  });

  it('Dirty Dozen #1, #2, #3, #4, #5, #6: protects /orders & /order_tracking from scraping, self-verified payments, ghost fields, orphaned writes, and invalid phones', () => {
    const ordersBlock = extractMatchBlock('/orders/{orderId}');
    const trackingBlock = extractMatchBlock('/order_tracking/{lookupId}');
    const validOrderFn = extractFunctionBody('isValidOrder');

    // #1 & #2: PII & list scrape isolation
    assert.match(ordersBlock, /allow get, list: if isAdmin\(\);/);
    assert.match(trackingBlock, /allow list: if isAdmin\(\);/);
    assert.match(trackingBlock, /allow get: if isValidId\(lookupId\);/);

    // #3: Customer create cannot set paymentStatus to 'verified'
    assert.match(ordersBlock, /incoming\(\)\.paymentStatus == 'cod_due'/);
    assert.match(ordersBlock, /incoming\(\)\.paymentStatus == 'pending_verification'/);
    assert.doesNotMatch(
      ordersBlock.split('allow update:')[0],
      /incoming\(\)\.paymentStatus == 'verified'/
    );

    // #4: Ghost field injection blocked by hasOnly
    assert.match(validOrderFn, /data\.keys\(\)\.hasAll\(/);
    assert.match(validOrderFn, /data\.keys\(\)\.hasOnly\(/);

    // #5: Orphaned order without tracking projection blocked via existsAfter batch constraint
    assert.match(ordersBlock, /existsAfter\(\/databases\/\$\(database\)\/documents\/order_tracking\//);
    assert.match(trackingBlock, /existsAfter\(\/databases\/\$\(database\)\/documents\/orders\//);

    // #6: Bangladesh phone regex enforced
    assert.match(validOrderFn, /data\.phone\.matches\('\^01\[3-9\]\[0-9\]\{8\}\$'\)/);
  });

  it('Dirty Dozen #7, #8, #9, #10, #12: blocks auto-approved reviews, draft chatbot leaks, log scraping, unpublished FAQs, and oversized IDs', () => {
    const reviewsBlock = extractMatchBlock('/reviews/{reviewId}');
    assert.match(reviewsBlock, /incoming\(\)\.status == 'pending'/);
    assert.match(reviewsBlock, /existing\(\)\.status == 'approved' \|\| isAdmin\(\)/);

    const cfgBlock = extractMatchBlock('/chatbot_config/{docId}');
    assert.match(cfgBlock, /allow get: if isValidId\(docId\) && \(docId == 'published' \|\| isAdmin\(\)\);/);
    assert.match(cfgBlock, /allow list: if isAdmin\(\);/);

    const logsBlock = extractMatchBlock('/chatbot_logs/{logId}');
    assert.match(logsBlock, /allow get, list: if isAdmin\(\);/);
    assert.match(logsBlock, /incoming\(\)\.resolved == false/);

    const faqsBlock = extractMatchBlock('/chatbot_faqs/{faqId}');
    assert.match(faqsBlock, /\(\(existing\(\)\.active == true && existing\(\)\.published == true\) \|\| isAdmin\(\)\)/);

    // #12: Oversized doc ID poisoning blocked everywhere via isValidId()
    const validIdFn = extractFunctionBody('isValidId');
    assert.match(validIdFn, /id\.size\(\) <= 128/);
    assert.match(validIdFn, /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);

    // Confirm all 12 dirty dozen scenarios exist in security_spec.md
    for (let n = 1; n <= 12; n++) {
      assert.ok(specText.includes(`${n}. `), `Expected Dirty Dozen scenario #${n} in security_spec.md`);
    }
  });

  it('validates new chatbot_cost_ledger rules & optional claims/telemetry fields synchronized with firebase-blueprint.json', () => {
    // 1. chatbot_config optional fields keep backward-compat (hasOnly allows them, hasAll does not require them)
    const cfgKeysFn = extractFunctionBody('isValidChatbotConfigKeys');
    const cfgRequiredSection = cfgKeysFn.split('hasOnly(')[0];
    const cfgAllowedSection = cfgKeysFn.split('hasOnly(')[1];
    for (const field of ['blockedClaims', 'approvedClaimsMeta', 'claimAuditHistory']) {
      assert.equal(
        cfgRequiredSection.includes(`'${field}'`),
        false,
        `Optional field ${field} must NOT break legacy docs via hasAll`
      );
      assert.equal(
        cfgAllowedSection.includes(`'${field}'`),
        true,
        `Field ${field} must be permitted in hasOnly`
      );
    }

    // 2. chatbot_logs optional extended telemetry fields keep backward-compat
    const logFn = extractFunctionBody('isValidChatbotLog');
    const logRequired = logFn.split('hasOnly(')[0];
    const logAllowed = logFn.split('hasOnly(')[1];
    for (const field of [
      'isError',
      'finishReason',
      'guardCategory',
      'retryCount',
      'toolCallCount',
      'factsVersion',
    ]) {
      assert.equal(logRequired.includes(`'${field}'`), false);
      assert.equal(logAllowed.includes(`'${field}'`), true);
    }

    // 3. chatbot_cost_ledger enforces dateKey regex, requestCount monotonic +1, bounded USD delta (<= 0.5), admin-only list/delete
    const costBlock = extractMatchBlock('/chatbot_cost_ledger/{dateKey}');
    const costValidator = extractFunctionBody('isValidChatbotCostLedger');
    assert.match(costBlock, /allow get: if isValidId\(dateKey\);/);
    assert.match(costBlock, /allow list: if isAdmin\(\);/);
    assert.match(costBlock, /incoming\(\)\.requestCount == 1/);
    assert.match(costBlock, /incoming\(\)\.requestCount == existing\(\)\.requestCount \+ 1/);
    assert.match(costBlock, /\(incoming\(\)\.totalUsd - existing\(\)\.totalUsd\) <= 0\.5/);
    assert.match(costValidator, /\^20\[0-9\]\{2\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$/);

    // 4. Blueprint synchronization
    assert.ok(blueprint.entities.ChatbotCostLedger);
    assert.ok(blueprint.firestore['/chatbot_cost_ledger/{dateKey}']);
    assert.ok(blueprint.entities.ChatbotConfig.properties.blockedClaims);
    assert.ok(blueprint.entities.ChatbotConfig.properties.approvedClaimsMeta);
    assert.ok(blueprint.entities.ChatbotConfig.properties.claimAuditHistory);
    assert.ok(blueprint.entities.ChatbotLog.properties.factsVersion);
  });

  it('Phase 1 Rules & Blueprint Sync: enforces knowledge_chunks, chat_sessions, order_drafts, chatbot_feedback, accessScope isolation & 6-mode languageBehavior', () => {
    // 1. ChatbotConfig 6 language modes + synonyms + primaryModel + fallbackModel
    const cfgBehaviorFn = extractFunctionBody('isValidChatbotConfigBehavior');
    for (const mode of [
      'auto',
      'prefer_bn',
      'prefer_en',
      'always_bn',
      'mirror',
      'customer_choice',
    ]) {
      assert.equal(cfgBehaviorFn.includes(`'${mode}'`), true, `Missing languageBehavior '${mode}'`);
    }
    const cfgKeysFn = extractFunctionBody('isValidChatbotConfigKeys');
    for (const f of ['synonyms', 'primaryModel', 'fallbackModel']) {
      assert.equal(cfgKeysFn.split('hasOnly(')[1].includes(`'${f}'`), true);
    }

    // 2. KB Docs internal accessScope isolation
    const kbDocsBlock = extractMatchBlock('/chatbot_kb_docs/{docId}');
    assert.match(kbDocsBlock, /\(!\('accessScope' in existing\(\)\) \|\| existing\(\)\.accessScope == 'public'\)/);
    assert.match(kbDocsBlock, /existing\(\)\.status == 'published'/);

    // 3. knowledge_chunks public published read only + admin-only write
    const chunksBlock = extractMatchBlock('/knowledge_chunks/{chunkId}');
    assert.match(chunksBlock, /existing\(\)\.status == 'published'/);
    assert.match(chunksBlock, /existing\(\)\.accessScope == 'public'/);
    assert.match(chunksBlock, /allow create, update: if isValidId\(chunkId\) && isAdmin\(\) && isValidKnowledgeChunk\(incoming\(\)\);/);
    assert.match(chunksBlock, /allow delete: if isValidId\(chunkId\) && isAdmin\(\);/);

    // 4. chat_sessions & order_drafts TTL + draftId binding + admin list
    const sessBlock = extractMatchBlock('/chat_sessions/{sessionId}');
    assert.match(sessBlock, /allow get: if isValidId\(sessionId\)/);
    assert.match(sessBlock, /allow list: if isAdmin\(\)/);

    const draftBlock = extractMatchBlock('/order_drafts/{draftId}');
    const draftFn = extractFunctionBody('isValidOrderDraft');
    assert.match(draftBlock, /allow get: if isValidId\(draftId\)/);
    assert.match(draftBlock, /allow list: if isAdmin\(\)/);
    assert.match(draftBlock, /incoming\(\)\.draftId == draftId/);
    assert.match(draftFn, /data\.expiresAt is number/);

    // 5. chatbot_feedback enum & admin-only read/resolve
    const fbBlock = extractMatchBlock('/chatbot_feedback/{feedbackId}');
    assert.match(fbBlock, /allow get, list: if isAdmin\(\);/);
    assert.match(fbBlock, /isValidChatbotFeedback\(incoming\(\)\)/);
    assert.match(fbBlock, /affectedKeys\(\)\.hasOnly\(\['resolved'\]\)/);

    // 6. chatbot_logs feedback keys & admin update allowlist
    const logBlock = extractMatchBlock('/chatbot_logs/{logId}');
    assert.match(logBlock, /'resolved', 'feedback', 'feedbackReason'/);

    // 7. Blueprint entities & paths
    for (const entity of ['KnowledgeChunk', 'ChatSession', 'OrderDraft', 'ChatbotFeedback']) {
      assert.ok(blueprint.entities[entity], `Missing blueprint entity ${entity}`);
    }
    for (const colPath of [
      '/knowledge_chunks/{chunkId}',
      '/chat_sessions/{sessionId}',
      '/order_drafts/{draftId}',
      '/chatbot_feedback/{feedbackId}',
    ]) {
      assert.ok(blueprint.firestore[colPath], `Missing blueprint path ${colPath}`);
    }
  });

  it('Phase 2 Rules & Blueprint Sync: enforces 4-zone delivery, atomic stock batching, pre-dispatch locks, order_fingerprints & immutable order_audit_logs', () => {
    const validOrderFn = extractFunctionBody('isValidOrder');
    for (const zone of ['dhaka', 'suburban', 'nationwide', 'remote']) {
      assert.equal(validOrderFn.includes(`'${zone}'`), true, `Missing deliveryZone '${zone}'`);
    }
    for (const optField of ['riskScore', 'riskSignals', 'reviewStatus', 'duplicateWarning', 'codVerificationStatus']) {
      assert.equal(validOrderFn.split('hasOnly(')[0].includes(`'${optField}'`), false);
      assert.equal(validOrderFn.split('hasOnly(')[1].includes(`'${optField}'`), true);
    }

    // Store settings atomic inventory pairing
    const settingsBlock = extractMatchBlock('/store_settings/{docId}');
    assert.match(settingsBlock, /'stock250g', 'stock500g', 'stock1kg', 'lastOrderNumber', 'updatedAt'/);
    assert.match(settingsBlock, /existsAfter\(\/databases\/\$\(database\)\/documents\/orders\//);

    // Pre-dispatch customer self-serve cancel & address edit locks on orders + order_tracking
    const ordersBlock = extractMatchBlock('/orders/{orderId}');
    assert.match(ordersBlock, /existing\(\)\.status in \['pending', 'confirmed'\]/);
    assert.match(ordersBlock, /incoming\(\)\.status == 'cancelled'/);
    assert.match(ordersBlock, /'district', 'area', 'address', 'deliveryZone', 'deliveryFeeBdt', 'totalBdt', 'estimatedDelivery', 'updatedAt'/);

    const trackingBlock = extractMatchBlock('/order_tracking/{lookupId}');
    assert.match(trackingBlock, /existing\(\)\.status in \['pending', 'confirmed'\]/);
    assert.match(trackingBlock, /getAfter\(\/databases\/\$\(database\)\/documents\/orders\//);

    // Coupon lifecycle optional fields & order_drafts mixed qty optional fields
    const couponFn = extractFunctionBody('isValidCoupon');
    for (const field of ['expiresAt', 'maxUses', 'usedCount', 'stackableWithAdvance']) {
      assert.equal(couponFn.split('hasOnly(')[0].includes(`'${field}'`), false);
      assert.equal(couponFn.split('hasOnly(')[1].includes(`'${field}'`), true);
    }

    const draftFn = extractFunctionBody('isValidOrderDraft');
    for (const field of ['qty250g', 'qty500g', 'qty1kg', 'addressQualityNote']) {
      assert.equal(draftFn.split('hasOnly(')[0].includes(`'${field}'`), false);
      assert.equal(draftFn.split('hasOnly(')[1].includes(`'${field}'`), true);
    }

    // order_fingerprints zero PII & admin-only list
    const fpBlock = extractMatchBlock('/order_fingerprints/{fingerprintId}');
    const fpFn = extractFunctionBody('isValidOrderFingerprint');
    assert.match(fpBlock, /allow get: if isValidId\(fingerprintId\);/);
    assert.match(fpBlock, /allow list: if isAdmin\(\);/);
    assert.match(fpBlock, /existsAfter\(\/databases\/\$\(database\)\/documents\/orders\//);
    assert.doesNotMatch(fpFn, /phone|customerName|address/);

    // order_audit_logs append-only & immutable
    const auditBlock = extractMatchBlock('/order_audit_logs/{logId}');
    assert.match(auditBlock, /allow get, list: if isAdmin\(\);/);
    assert.match(auditBlock, /allow update, delete: if false;/);

    // Blueprint & spec sync
    assert.ok(blueprint.entities.OrderFingerprint);
    assert.ok(blueprint.entities.OrderAuditLog);
    assert.ok(blueprint.firestore['/order_fingerprints/{fingerprintId}']);
    assert.ok(blueprint.firestore['/order_audit_logs/{logId}']);
    assert.ok(specText.includes('13. **Atomic Inventory Decrement & Restore**'));
    assert.ok(specText.includes('14. **Pre-Dispatch Customer Lock & Audit Immutability**'));
    assert.ok(specText.includes('15. **Zero-PII Duplicate Fingerprint Isolation**'));
  });

  it('Phase 3 Rules & Blueprint Sync: enforces private support_evidence, Admin triage lock, AI-pause tamper protection, atomic delivered order_review_claims & refill_reminders', () => {
    // 1. support_evidence: public create validated, zero public read, admin-only get/list/update/delete
    const evBlock = extractMatchBlock('/support_evidence/{evidenceId}');
    const evFn = extractFunctionBody('isValidSupportEvidence');
    assert.match(evBlock, /allow get: if isValidId\(evidenceId\) && isAdmin\(\);/);
    assert.match(evBlock, /allow list: if isAdmin\(\);/);
    assert.match(evBlock, /allow create: if isValidId\(evidenceId\) && isValidSupportEvidence\(incoming\(\)\);/);
    assert.match(evBlock, /allow update, delete: if isValidId\(evidenceId\) && isAdmin\(\);/);
    assert.match(evFn, /'image\/jpeg', 'image\/png', 'image\/webp'/);

    // 2. support_agent_replies: admin-only read/write
    const replyBlock = extractMatchBlock('/support_agent_replies/{replyId}');
    assert.match(replyBlock, /allow get, list: if isAdmin\(\);/);
    assert.match(replyBlock, /allow create: if isValidId\(replyId\) && isAdmin\(\) && isValidSupportAgentReply\(incoming\(\)\);/);

    // 3. chat_sessions: visitor cannot set or tamper with aiPaused / activeTicketId / assignedAgentName / agentReplies
    const sessBlock = extractMatchBlock('/chat_sessions/{sessionId}');
    assert.match(sessBlock, /!incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasAny\(\['aiPaused', 'activeTicketId', 'assignedAgentName', 'agentReplies'\]\)/);

    // 4. chatbot_support_requests: visitor create enforces status=='open', optional Phase 3 triage locked to admin
    const supBlock = extractMatchBlock('/chatbot_support_requests/{reqId}');
    assert.match(supBlock, /incoming\(\)\.status == 'open'/);
    assert.match(supBlock, /!\('assignedTo' in incoming\(\)\)/);
    assert.match(supBlock, /!\('internalNotes' in incoming\(\)\)/);
    assert.match(supBlock, /allow get, list: if isAdmin\(\);/);

    // 5. order_review_claims + reviews verifiedPurchase delivered binding
    const claimBlock = extractMatchBlock('/order_review_claims/{orderNumber}');
    assert.match(claimBlock, /existsAfter\(\/databases\/\$\(database\)\/documents\/reviews\/\$\('rev_' \+ orderNumber\)\)/);
    assert.match(claimBlock, /get\(\/databases\/\$\(database\)\/documents\/orders\/\$\(orderNumber\)\)\.data\.status == 'delivered'/);

    const revBlock = extractMatchBlock('/reviews/{reviewId}');
    assert.match(revBlock, /existsAfter\(\/databases\/\$\(database\)\/documents\/order_review_claims\//);

    // 6. refill_reminders: keyed lookup only, admin-only list
    const refillBlock = extractMatchBlock('/refill_reminders/{reminderId}');
    assert.match(refillBlock, /allow get: if isValidId\(reminderId\);/);
    assert.match(refillBlock, /allow list: if isAdmin\(\);/);
    assert.match(refillBlock, /allow create: if isValidId\(reminderId\)/);

    // 7. Blueprint & Spec sync
    for (const entity of ['SupportEvidence', 'SupportAgentReply', 'OrderReviewClaim', 'RefillReminder']) {
      assert.ok(blueprint.entities[entity], `Missing blueprint entity ${entity}`);
    }
    for (const colPath of [
      '/support_evidence/{evidenceId}',
      '/support_agent_replies/{replyId}',
      '/order_review_claims/{orderNumber}',
      '/refill_reminders/{reminderId}',
    ]) {
      assert.ok(blueprint.firestore[colPath], `Missing blueprint path ${colPath}`);
    }
    assert.ok(specText.includes('16. **Private Evidence Isolation**'));
    assert.ok(specText.includes('17. **Human Handover Pause & Audit Trail**'));
    assert.ok(specText.includes('18. **Verified Delivered Review Claim Integrity & Opt-In Reminders**'));
  });

  it('Phase 4 Rules & Blueprint Sync: validates optional courier consignment fields, https tracking URLs, courier_updated audit log, and refill dispatch counters', () => {
    const validOrderFn = extractFunctionBody('isValidOrder');
    const validTrackingFn = extractFunctionBody('isValidOrderTracking');

    for (const fnBody of [validOrderFn, validTrackingFn]) {
      for (const field of ['courierPartner', 'consignmentId', 'courierTrackingUrl', 'dispatchedAtIso']) {
        assert.equal(fnBody.split('hasOnly(')[0].includes(`'${field}'`), false);
        assert.equal(fnBody.split('hasOnly(')[1].includes(`'${field}'`), true);
      }
      assert.match(fnBody, /'steadfast', 'pathao', 'redx', 'manual'/);
      assert.match(fnBody, /matches\('\^https:\/\/\.\*'\)/);
    }

    const ordersBlock = extractMatchBlock('/orders/{orderId}');
    const trackingBlock = extractMatchBlock('/order_tracking/{lookupId}');
    assert.match(ordersBlock, /'courierPartner', 'consignmentId', 'courierTrackingUrl', 'dispatchedAtIso', 'updatedAt'/);
    assert.match(trackingBlock, /'courierPartner', 'consignmentId', 'courierTrackingUrl', 'dispatchedAtIso', 'updatedAt'/);

    const auditFn = extractFunctionBody('isValidOrderAuditLog');
    assert.match(auditFn, /'courier_updated'/);

    const refillFn = extractFunctionBody('isValidRefillReminder');
    for (const field of ['lastNotifiedAtIso', 'reminderCount']) {
      assert.equal(refillFn.split('hasOnly(')[0].includes(`'${field}'`), false);
      assert.equal(refillFn.split('hasOnly(')[1].includes(`'${field}'`), true);
    }

    const refillBlock = extractMatchBlock('/refill_reminders/{reminderId}');
    assert.doesNotMatch(
      refillBlock.split('affectedKeys().hasOnly(')[1] || '',
      /reminderCount|lastNotifiedAtIso/,
      'Customers must not self-update reminderCount or lastNotifiedAtIso'
    );

    assert.ok(blueprint.entities.Order.properties.courierPartner);
    assert.ok(blueprint.entities.OrderTracking.properties.consignmentId);
    const auditActionProp = blueprint.entities.OrderAuditLog.properties.action as { enum?: string[] };
    assert.ok(auditActionProp.enum?.includes('courier_updated'));
    assert.ok(blueprint.entities.RefillReminder.properties.lastNotifiedAtIso);
    assert.ok(blueprint.entities.RefillReminder.properties.reminderCount);
    assert.ok(specText.includes('19. **Courier Consignment Integrity & Refill Dispatch Governance**'));
  });

  it('Phase 5 Rules & Blueprint Sync: enforces immutable channel_webhook_events, customer-protected marketing_consents, external session phone lock, and attribution fields', () => {
    // 1. channel_webhook_events: immutable ledger & admin-only read/list
    const webhookBlock = extractMatchBlock('/channel_webhook_events/{eventId}');
    const webhookFn = extractFunctionBody('isValidChannelWebhookEvent');
    assert.match(webhookBlock, /allow get, list: if isAdmin\(\);/);
    assert.match(webhookBlock, /allow create: if isValidId\(eventId\) && isValidChannelWebhookEvent\(incoming\(\)\);/);
    assert.match(webhookBlock, /allow update, delete: if false;/);
    assert.match(webhookFn, /'messenger', 'instagram', 'whatsapp'/);
    assert.match(webhookFn, /'processed', 'duplicate', 'rejected'/);

    // 2. marketing_consents: phoneKey==phone, admin-only list, customer blocked from spoofing campaignCount/lastCampaignAtIso
    const consentBlock = extractMatchBlock('/marketing_consents/{phoneKey}');
    const consentFn = extractFunctionBody('isValidMarketingConsent');
    assert.match(consentBlock, /allow get: if isValidId\(phoneKey\);/);
    assert.match(consentBlock, /allow list: if isAdmin\(\);/);
    assert.match(consentBlock, /phoneKey == incoming\(\)\.phone/);
    assert.match(consentBlock, /!\('lastCampaignAtIso' in incoming\(\)\)/);
    assert.doesNotMatch(
      consentBlock.split('affectedKeys().hasOnly(')[1] || '',
      /campaignCount|lastCampaignAtIso/,
      'Customers must not self-update campaignCount or lastCampaignAtIso'
    );
    assert.match(consentFn, /data\.phone\.matches\('\^01\[3-9\]\[0-9\]\{8\}\$'\)/);

    // 3. chat_sessions: external identity + visitor linkedPhone immutability once set
    const sessFn = extractFunctionBody('isValidChatSession');
    const sessBlock = extractMatchBlock('/chat_sessions/{sessionId}');
    for (const field of ['channel', 'externalUserId', 'linkedPhone']) {
      assert.equal(sessFn.split('hasOnly(')[0].includes(`'${field}'`), false);
      assert.equal(sessFn.split('hasOnly(')[1].includes(`'${field}'`), true);
    }
    assert.match(sessBlock, /!\('linkedPhone' in existing\(\)\) \|\| existing\(\)\.linkedPhone == '' \|\| incoming\(\)\.linkedPhone == existing\(\)\.linkedPhone/);

    // 4. Optional attribution & channel fields across Order, ChatbotLog, ChatbotSupportRequest
    const validOrderFn = extractFunctionBody('isValidOrder');
    for (const field of ['sourceChannel', 'attributedSessionId']) {
      assert.equal(validOrderFn.split('hasOnly(')[0].includes(`'${field}'`), false);
      assert.equal(validOrderFn.split('hasOnly(')[1].includes(`'${field}'`), true);
    }

    const logFn = extractFunctionBody('isValidChatbotLog');
    assert.equal(logFn.split('hasOnly(')[0].includes("'channel'"), false);
    assert.equal(logFn.split('hasOnly(')[1].includes("'channel'"), true);

    const supFn = extractFunctionBody('isValidSupportRequest');
    for (const field of ['channel', 'externalThreadId']) {
      assert.equal(supFn.split('hasOnly(')[0].includes(`'${field}'`), false);
      assert.equal(supFn.split('hasOnly(')[1].includes(`'${field}'`), true);
    }

    // 5. Blueprint & Spec sync
    assert.ok(blueprint.entities.ChannelWebhookEvent);
    assert.ok(blueprint.entities.MarketingConsent);
    assert.ok(blueprint.firestore['/channel_webhook_events/{eventId}']);
    assert.ok(blueprint.firestore['/marketing_consents/{phoneKey}']);
    assert.ok(blueprint.entities.Order.properties.sourceChannel);
    assert.ok(blueprint.entities.Order.properties.attributedSessionId);
    assert.ok(blueprint.entities.ChatSession.properties.linkedPhone);
    assert.ok(specText.includes('20. **Omnichannel Webhook Replay/Idempotency & Marketing Consent/Suppression**'));
    assert.ok(specText.includes('14. **Webhook Event Tampering or Marketing Campaign Counter Spoofing**'));
  });
});



