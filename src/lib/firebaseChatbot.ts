'use client';

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  DEFAULT_CHATBOT_CONFIG,
  ChatbotConfigDoc,
  ChatbotFaqDoc,
  ChatbotFeedbackDoc,
  ChatbotKbDocRecord,
  ChatbotLogRecord,
  ChatbotSupportRequestRecord,
  ChatbotVersionRecord,
  type FeedbackReason,
} from './chatbot/types';
import { buildOverlappingChunks } from './chatbot/hybridRag';
import { ALLOWED_ADMIN_GEMINI_MODELS } from './chatbot/schema';
import {
  sanitizeApprovedClaimsMetaForPublish,
  sanitizeApprovedClaimsStringForPublish,
} from './chatbot/storeFacts';
import { OperationType, db, handleFirestoreError } from './firebase';

function sanitizeConfigPayload(cfg: ChatbotConfigDoc): Record<string, unknown> {
  return {
    enabled: Boolean(cfg.enabled),
    maintenanceMode: Boolean(cfg.maintenanceMode),
    maintenanceMessageEn: String(cfg.maintenanceMessageEn || '').slice(0, 300),
    maintenanceMessageBn: String(cfg.maintenanceMessageBn || '').slice(0, 400),
    botName: (String(cfg.botName || 'Deshi Gee Assistant').trim() || 'Deshi Gee Assistant').slice(0, 60),
    brandName: (String(cfg.brandName || 'Deshi Gee').trim() || 'Deshi Gee').slice(0, 80),
    brandIntro: String(cfg.brandIntro || '').slice(0, 800),
    brandStory: String(cfg.brandStory || '').slice(0, 2500),
    brandMission: String(cfg.brandMission || '').slice(0, 1000),
    founderInfo: String(cfg.founderInfo || '').slice(0, 1000),
    productDescription: String(cfg.productDescription || '').slice(0, 1500),
    ingredients: String(cfg.ingredients || '').slice(0, 600),
    taste: String(cfg.taste || '').slice(0, 400),
    aroma: String(cfg.aroma || '').slice(0, 400),
    texture: String(cfg.texture || '').slice(0, 400),
    productionMethod: String(cfg.productionMethod || '').slice(0, 1200),
    shelfLife: String(cfg.shelfLife || '').slice(0, 300),
    storageInstructions: String(cfg.storageInstructions || '').slice(0, 800),
    approvedClaims: String(cfg.approvedClaims || '').slice(0, 1200),
    blockedClaims: String(cfg.blockedClaims || '').slice(0, 800),
    approvedClaimsMeta: (Array.isArray(cfg.approvedClaimsMeta) ? cfg.approvedClaimsMeta : [])
      .slice(0, 20)
      .map((item) => ({
        claim: String(item?.claim || '').trim().slice(0, 200),
        evidenceNote: String(item?.evidenceNote || '').trim().slice(0, 300),
        expiresAt: String(item?.expiresAt || '').trim().slice(0, 32),
        status: (item?.status === 'draft' ? 'draft' : 'approved') as 'draft' | 'approved',
        updatedAt: String(item?.updatedAt || '').trim().slice(0, 40),
        updatedBy: String(item?.updatedBy || '').trim().slice(0, 120),
      }))
      .filter((item) => item.claim.length > 0),
    claimAuditHistory: (Array.isArray(cfg.claimAuditHistory) ? cfg.claimAuditHistory : [])
      .slice(0, 30)
      .map((entry) => ({
        timestamp: String(entry?.timestamp || '').trim().slice(0, 40),
        actor: String(entry?.actor || '').trim().slice(0, 120),
        action: String(entry?.action || '').trim().slice(0, 60),
        summary: String(entry?.summary || '').trim().slice(0, 240),
      }))
      .filter((entry) => entry.summary.length > 0),
    currentOffers: String(cfg.currentOffers || '').slice(0, 800),
    district: String(cfg.district || '').slice(0, 80),
    city: String(cfg.city || '').slice(0, 80),
    googleMapsUrl: String(cfg.googleMapsUrl || '').slice(0, 300),
    directionsUrl: String(cfg.directionsUrl || '').slice(0, 300),
    businessHours: String(cfg.businessHours || '').slice(0, 200),
    openHourBst: Math.max(0, Math.min(23, Math.round(Number(cfg.openHourBst) || 0))),
    closeHourBst: Math.max(0, Math.min(23, Math.round(Number(cfg.closeHourBst) || 0))),
    closedDays: String(cfg.closedDays || '').slice(0, 80),
    supportAvailabilityNote: String(cfg.supportAvailabilityNote || '').slice(0, 300),
    humanSupportEnabled: cfg.humanSupportEnabled !== false,
    slaStandardMinutes: Math.max(
      15,
      Math.min(1440, Math.round(Number(cfg.slaStandardMinutes ?? 120) || 120))
    ),
    slaUrgentMinutes: Math.max(
      5,
      Math.min(720, Math.round(Number(cfg.slaUrgentMinutes ?? 30) || 30))
    ),
    deliveryPolicy: String(cfg.deliveryPolicy || '').slice(0, 1200),
    returnPolicy: String(cfg.returnPolicy || '').slice(0, 1200),
    replacementPolicy: String(cfg.replacementPolicy || '').slice(0, 1200),
    otherPaymentInfo: String(cfg.otherPaymentInfo || '').slice(0, 800),
    supportInstructions: String(cfg.supportInstructions || '').slice(0, 1200),
    customInstructions: String(cfg.customInstructions || '').slice(0, 4000),
    responseTone: ['warm', 'concise', 'formal'].includes(cfg.responseTone)
      ? cfg.responseTone
      : 'warm',
    responseLength: ['short', 'balanced', 'detailed'].includes(cfg.responseLength)
      ? cfg.responseLength
      : 'short',
    languageBehavior: [
      'auto',
      'prefer_bn',
      'prefer_en',
      'always_bn',
      'mirror',
      'customer_choice',
    ].includes(cfg.languageBehavior)
      ? cfg.languageBehavior
      : 'auto',
    synonyms: Object.fromEntries(
      Object.entries(cfg.synonyms || {})
        .slice(0, 40)
        .map(([k, arr]) => [
          String(k).trim().slice(0, 40),
          (Array.isArray(arr) ? arr : [])
            .map((v) => String(v).trim().slice(0, 40))
            .filter(Boolean)
            .slice(0, 12),
        ])
        .filter(([k, arr]) => (k as string).length > 0 && (arr as string[]).length > 0)
    ),
    primaryModel: (ALLOWED_ADMIN_GEMINI_MODELS as readonly string[]).includes(
      String(cfg.primaryModel || '')
    )
      ? cfg.primaryModel
      : 'gemini-4-hydrogen',
    fallbackModel: (ALLOWED_ADMIN_GEMINI_MODELS as readonly string[]).includes(
      String(cfg.fallbackModel || '')
    )
      ? cfg.fallbackModel
      : 'gemini-3.1-flash-lite',
    fallbackMessageBn: String(cfg.fallbackMessageBn || '').slice(0, 400),
    fallbackMessageEn: String(cfg.fallbackMessageEn || '').slice(0, 400),
    welcomeMessageBn: String(cfg.welcomeMessageBn || '').slice(0, 500),
    welcomeMessageEn: String(cfg.welcomeMessageEn || '').slice(0, 500),
    quickQuestionsBn: (cfg.quickQuestionsBn || [])
      .map((q) => String(q).trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 8),
    quickQuestionsEn: (cfg.quickQuestionsEn || [])
      .map((q) => String(q).trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 8),
    retentionDays: Math.max(1, Math.min(365, Math.round(Number(cfg.retentionDays) || 90))),
    dailyRequestLimit: Math.max(
      10,
      Math.min(100000, Math.round(Number(cfg.dailyRequestLimit) || 2000))
    ),
    version: Math.max(1, Math.round(Number(cfg.version) || 1)),
    lastSyncStatus: String(cfg.lastSyncStatus || 'Published').slice(0, 160),
  };
}

export async function fetchPublishedChatbotConfig(): Promise<ChatbotConfigDoc> {
  try {
    const res = await fetch('/api/chatbot/public-config', {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) {
      return DEFAULT_CHATBOT_CONFIG;
    }
    const pub = (await res.json()) as {
      enabled?: boolean;
      botName?: string;
      welcomeMessage?: string;
      quickQuestions?: string[];
      enableVoiceFeatures?: boolean;
    };
    return {
      ...DEFAULT_CHATBOT_CONFIG,
      enabled: pub.enabled !== false,
      botName: pub.botName || DEFAULT_CHATBOT_CONFIG.botName,
      welcomeMessageBn: pub.welcomeMessage || DEFAULT_CHATBOT_CONFIG.welcomeMessageBn,
      quickQuestionsBn: Array.isArray(pub.quickQuestions) && pub.quickQuestions.length > 0
        ? pub.quickQuestions
        : DEFAULT_CHATBOT_CONFIG.quickQuestionsBn,
      enableVoiceFeatures: pub.enableVoiceFeatures === true,
    };
  } catch {
    return DEFAULT_CHATBOT_CONFIG;
  }
}

export async function fetchDraftChatbotConfig(): Promise<ChatbotConfigDoc> {
  try {
    const snap = await getDoc(doc(db, 'chatbot_config', 'draft'));
    if (snap.exists()) {
      return { ...DEFAULT_CHATBOT_CONFIG, ...(snap.data() as Partial<ChatbotConfigDoc>) };
    }
    const pubSnap = await getDoc(doc(db, 'chatbot_config', 'published'));
    if (pubSnap.exists()) {
      return { ...DEFAULT_CHATBOT_CONFIG, ...(pubSnap.data() as Partial<ChatbotConfigDoc>) };
    }
    return DEFAULT_CHATBOT_CONFIG;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'chatbot_config/draft');
  }
}

export async function saveDraftChatbotConfig(cfg: ChatbotConfigDoc): Promise<void> {
  try {
    await setDoc(doc(db, 'chatbot_config', 'draft'), {
      ...sanitizeConfigPayload(cfg),
      lastSyncStatus: 'Draft saved (unpublished)',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'chatbot_config/draft');
  }
}

export async function publishChatbotChanges(
  cfg: ChatbotConfigDoc,
  adminEmail: string,
  summary: string
): Promise<number> {
  const nextVersion = Math.max(1, (Number(cfg.version) || 0) + 1);
  const payload = {
    ...sanitizeConfigPayload({
      ...cfg,
      version: nextVersion,
      lastSyncStatus: `Published v${nextVersion}`,
    }),
  };

  const publishedPayload = {
    ...payload,
    // S0-09: Draft claim templates must NEVER enter the published chatbot config.
    approvedClaims: sanitizeApprovedClaimsStringForPublish(cfg.approvedClaims),
    approvedClaimsMeta: sanitizeApprovedClaimsMetaForPublish(cfg.approvedClaimsMeta),
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'chatbot_config', 'draft'), {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'chatbot_config', 'published'), {
      ...publishedPayload,
      updatedAt: serverTimestamp(),
    });
    const versionId = `v${nextVersion}_${Date.now()}`;
    batch.set(doc(db, 'chatbot_config_versions', versionId), {
      version: nextVersion,
      publishedBy: adminEmail.slice(0, 160),
      summary: (summary || `Published v${nextVersion}`).slice(0, 200),
      snapshot: publishedPayload,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return nextVersion;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'chatbot_config/published');
  }
}

export async function fetchChatbotVersions(): Promise<ChatbotVersionRecord[]> {
  try {
    const q = query(
      collection(db, 'chatbot_config_versions'),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.slice(0, 20).map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ChatbotVersionRecord, 'id'>),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'chatbot_config_versions');
  }
}

export async function fetchAdminChatbotFaqs(): Promise<ChatbotFaqDoc[]> {
  try {
    const q = query(collection(db, 'chatbot_faqs'), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ChatbotFaqDoc, 'id'>),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'chatbot_faqs');
  }
}

export async function fetchPublicChatbotFaqs(): Promise<ChatbotFaqDoc[]> {
  try {
    const q = query(
      collection(db, 'chatbot_faqs'),
      where('active', '==', true),
      where('published', '==', true)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ChatbotFaqDoc, 'id'>),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'chatbot_faqs');
  }
}

export async function saveAdminChatbotFaq(faq: ChatbotFaqDoc): Promise<string> {
  const id =
    faq.id && /^[a-zA-Z0-9_-]{2,128}$/.test(faq.id)
      ? faq.id
      : `faq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  try {
    await setDoc(doc(db, 'chatbot_faqs', id), {
      question: faq.question.trim().slice(0, 300),
      answer: faq.answer.trim().slice(0, 2000),
      lang: ['bn', 'en', 'both'].includes(faq.lang) ? faq.lang : 'both',
      category: (faq.category.trim() || 'General').slice(0, 60),
      active: Boolean(faq.active),
      published: Boolean(faq.published),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `chatbot_faqs/${id}`);
  }
}

export async function deleteAdminChatbotFaq(faqId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'chatbot_faqs', faqId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `chatbot_faqs/${faqId}`);
  }
}

export async function fetchAdminChatbotKbDocs(): Promise<ChatbotKbDocRecord[]> {
  try {
    const q = query(collection(db, 'chatbot_kb_docs'), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ChatbotKbDocRecord, 'id'>),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'chatbot_kb_docs');
  }
}

export async function saveAdminChatbotKbDoc(docItem: ChatbotKbDocRecord): Promise<string> {
  const id =
    docItem.id && /^[a-zA-Z0-9_-]{2,128}$/.test(docItem.id)
      ? docItem.id
      : `kb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const cleanContent = docItem.content.trim().slice(0, 60000);
  const chunks = buildOverlappingChunks(cleanContent);
  const chunkCount = Math.max(1, Math.min(200, chunks.length || docItem.chunkCount || 1));
  const status: 'draft' | 'published' = docItem.status === 'published' ? 'published' : 'draft';
  const language = ['bn', 'en', 'both'].includes(String(docItem.language || 'both'))
    ? (docItem.language as 'bn' | 'en' | 'both')
    : 'both';
  const accessScope: 'public' | 'internal' =
    docItem.accessScope === 'internal' ? 'internal' : 'public';

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'chatbot_kb_docs', id), {
      title: docItem.title.trim().slice(0, 160),
      category: (docItem.category.trim() || 'General').slice(0, 60),
      sourceType: docItem.sourceType || 'manual',
      fileName: (docItem.fileName || 'manual-entry.txt').slice(0, 160),
      content: cleanContent,
      chunkCount,
      status,
      syncStatus: (docItem.syncStatus || 'Synced & Ready').slice(0, 120),
      version: Math.max(1, Math.min(1000, Math.round(Number(docItem.version) || 1))),
      owner: (docItem.owner || 'Admin').slice(0, 120),
      language,
      effectiveDate: (docItem.effectiveDate || '').slice(0, 32),
      reviewDate: (docItem.reviewDate || '').slice(0, 32),
      contentHash: (docItem.contentHash || '').slice(0, 64),
      accessScope,
      updatedAt: serverTimestamp(),
    });

    for (const c of chunks.slice(0, 80)) {
      const chunkId = `${id}_c${c.chunkIndex}`;
      batch.set(doc(db, 'knowledge_chunks', chunkId), {
        docId: id,
        title: docItem.title.trim().slice(0, 160),
        category: (docItem.category.trim() || 'General').slice(0, 60),
        chunkIndex: c.chunkIndex,
        sectionHeading: c.sectionHeading.slice(0, 80),
        text: c.text.slice(0, 4000),
        tokenEstimate: Math.max(1, Math.min(8000, c.tokenEstimate)),
        contentHash: c.contentHash.slice(0, 64),
        language,
        status,
        accessScope,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `chatbot_kb_docs/${id}`);
  }
}

export async function deleteAdminChatbotKbDoc(docId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'chatbot_kb_docs', docId));
    const q = query(collection(db, 'knowledge_chunks'), where('docId', '==', docId));
    const chunkSnap = await getDocs(q);
    if (!chunkSnap.empty) {
      const batch = writeBatch(db);
      chunkSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `chatbot_kb_docs/${docId}`);
  }
}

export async function fetchAdminChatbotLogs(): Promise<ChatbotLogRecord[]> {
  try {
    const q = query(collection(db, 'chatbot_logs'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.slice(0, 300).map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ChatbotLogRecord, 'id'>),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'chatbot_logs');
  }
}

export async function markChatbotLogResolved(logId: string, resolved: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'chatbot_logs', logId), {
      resolved,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `chatbot_logs/${logId}`);
  }
}

export async function deleteChatbotLogEntry(logId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'chatbot_logs', logId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `chatbot_logs/${logId}`);
  }
}

export async function fetchAdminSupportRequests(): Promise<ChatbotSupportRequestRecord[]> {
  try {
    const q = query(
      collection(db, 'chatbot_support_requests'),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ChatbotSupportRequestRecord, 'id'>),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'chatbot_support_requests');
  }
}

export async function updateSupportRequestStatus(
  reqId: string,
  status: 'open' | 'contacted' | 'resolved'
): Promise<void> {
  try {
    await updateDoc(doc(db, 'chatbot_support_requests', reqId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `chatbot_support_requests/${reqId}`);
  }
}

export async function fetchAdminChatbotFeedback(): Promise<ChatbotFeedbackDoc[]> {
  try {
    const q = query(collection(db, 'chatbot_feedback'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.slice(0, 200).map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ChatbotFeedbackDoc, 'id'>),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'chatbot_feedback');
  }
}

export async function resolveChatbotFeedback(feedbackId: string, resolved: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'chatbot_feedback', feedbackId), { resolved });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `chatbot_feedback/${feedbackId}`);
  }
}

export async function updateChatbotLogFeedback(
  logId: string,
  feedback: 'up' | 'down' | '',
  feedbackReason: FeedbackReason = ''
): Promise<void> {
  try {
    await updateDoc(doc(db, 'chatbot_logs', logId), {
      feedback,
      feedbackReason,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `chatbot_logs/${logId}`);
  }
}
