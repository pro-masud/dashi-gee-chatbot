import { type Content } from '@google/genai';
import {
  CHATBOT_BUILD_CONFIG,
  getConfiguredMaxOutputTokens,
  getOptionalDailyCostCapUsd,
} from '../../../src/lib/chatbot/build-config';
import {
  classifyDomainRequest,
  stripUnsafeHtml,
} from '../../../src/lib/chatbot/domain-guard';
import {
  createServerChatLog,
  fetchPublishedKnowledgeChunks,
  fetchServerBatchRecord,
  fetchServerChatbotConfig,
  fetchServerChatbotFaqs,
  fetchServerChatbotKbDocs,
  fetchServerStoreSettings,
  getPersistentDailyCostStatus,
  recordPersistentDailyCost,
  verifyServerAdminToken,
} from '../../../src/lib/chatbot/firestoreRest';
import { runHybridKnowledgeSearch } from '../../../src/lib/chatbot/hybridRag';
import {
  buildContextualSuggestedReplies,
  buildProductComparisonCards,
  classifyTurnIntent,
} from '../../../src/lib/chatbot/intentRouter';
import { generateLiveFallbackReply } from '../../../src/lib/chatbot/liveFallbackEngine';
import { checkCompositeChatRateLimit } from '../../../src/lib/chatbot/rateLimit';
import { validateChatbotResponse } from '../../../src/lib/chatbot/responseValidator';
import { validateChatRequestPayload } from '../../../src/lib/chatbot/schema';
import {
  detectLanguageAndSignals,
  detectPromptInjection,
  detectSensitiveSecret,
  getTodayBstDateKey,
} from '../../../src/lib/chatbot/security';
import {
  applySlotsToOrderDraft,
  buildDraftPromptSummary,
  buildInitialSessionDoc,
  extractOrderSlotsFromText,
  isTypedConfirmationOnly,
  loadSessionAndDraft,
  saveSessionAndDraft,
} from '../../../src/lib/chatbot/sessionStore';
import {
  buildStoreFactsSnapshot,
  getSeededVerifiedMonetaryAmounts,
  type StoreFactsSnapshot,
} from '../../../src/lib/chatbot/storeFacts';
import type {
  ChatActionItem,
  ChatDiagnosticsMeta,
  ChatbotExecutionPath,
  KnowledgeSourceRef,
  OrderDraftDoc,
  OrderSummaryCard,
  ProductCardItem,
  TrackingCardData,
} from '../../../src/lib/chatbot/types';
import {
  buildGeminiGenerateConfig,
  classifyGeminiError,
  createGeminiClient,
  estimateGeminiCostUsd,
  isGeminiApiKeyConfigured,
  resolveConfiguredChatModels,
  validateGeminiModelCapability,
} from '../../../src/lib/gemini/client';
import { buildSystemPrompt } from '../../../src/lib/gemini/system-instructions';
import {
  CHATBOT_FUNCTION_DECLARATIONS,
  type ToolRuntimeContext,
  executeChatbotTool,
} from '../../../src/lib/gemini/tools';

const SAFETY_BLOCK_FINISH_REASONS = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'RECITATION',
]);

const STREAM_HOLD_BACK_RX =
  /(৳|\bbdt\b|\btk\b|\btaka\b|\d|01[3-9]|\ba2\b|organic|bsti|lab[\s-]|100%|pure|cure|treat|heal|diagnose)/i;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function buildContactActions(
  settings: { supportPhone?: string; whatsappNumber?: string },
  replyLang: 'bn' | 'en'
): ChatActionItem[] {
  const actions: ChatActionItem[] = [];
  const phone = String(settings.supportPhone || '').trim();
  const wa = String(settings.whatsappNumber || '').trim();
  const phoneDigits = phone.replace(/[^0-9]/g, '');
  const waDigits = wa.replace(/[^0-9]/g, '');

  if (phone && !phone.toLowerCase().includes('configurable') && phoneDigits.length >= 10) {
    const normalizedPhone = phoneDigits.startsWith('01') ? `88${phoneDigits}` : phoneDigits;
    actions.push({
      type: 'call',
      labelEn: 'Call Support',
      labelBn: 'ফোন করুন',
      value: phone,
      href: `tel:+${normalizedPhone}`,
    });
  }
  if (wa && !wa.toLowerCase().includes('configurable') && waDigits.length >= 10) {
    const normalizedWa = waDigits.startsWith('01') ? `88${waDigits}` : waDigits;
    const msg = encodeURIComponent(
      replyLang === 'bn'
        ? 'আসসালামু আলাইকুম, দেশী ঘি সম্পর্কে সহায়তা চাই।'
        : 'Hello, I would like assistance with Deshi Gee.'
    );
    actions.push({
      type: 'whatsapp',
      labelEn: 'Chat on WhatsApp',
      labelBn: 'WhatsApp-এ যোগাযোগ',
      value: wa,
      href: `https://wa.me/${normalizedWa}?text=${msg}`,
    });
  }
  return actions;
}

function detectUnansweredHeuristic(reply: string, fallbackBn: string, fallbackEn: string): boolean {
  const r = reply.toLowerCase();
  return (
    r.includes(fallbackBn.toLowerCase().slice(0, 22)) ||
    r.includes(fallbackEn.toLowerCase().slice(0, 26)) ||
    r.includes('এই তথ্যটা আমার কাছে নেই') ||
    r.includes('তথ্য এই মুহূর্তে আমার কাছে নেই') ||
    r.includes("don't have verified information") ||
    r.includes('do not have verified information')
  );
}

async function generateWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Gemini request timeout exceeded'));
    }, timeoutMs);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function jsonWithCookie(
  body: Record<string, unknown>,
  status: number,
  setCookieHeader?: string
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (setCookieHeader) {
    headers['Set-Cookie'] = setCookieHeader;
  }
  return new Response(JSON.stringify(body), { status, headers });
}

interface NdjsonReplyPayload {
  text: string;
  actions?: ChatActionItem[];
  orderSummary?: OrderSummaryCard;
  productCards?: ProductCardItem[];
  trackingCard?: TrackingCardData;
  suggestedReplies?: string[];
  sources?: KnowledgeSourceRef[];
  diagnostics?: ChatDiagnosticsMeta;
  logId?: string;
  lockedLang?: 'bn' | 'en' | '';
  intent?: string;
  path?: ChatbotExecutionPath;
  model?: string;
  isError?: boolean;
  errorCode?: string;
  factsVersion?: string;
}

function encodeMetaEvent(payload: NdjsonReplyPayload): string {
  return `${JSON.stringify({
    type: 'meta',
    actions: payload.actions || [],
    orderSummary: payload.orderSummary || null,
    productCards: payload.productCards || [],
    trackingCard: payload.trackingCard || null,
    suggestedReplies: payload.suggestedReplies || [],
    sources: payload.sources || [],
    diagnostics: payload.diagnostics || null,
    logId: payload.logId || '',
    lockedLang: payload.lockedLang || '',
    intent: payload.intent || 'general',
    path: payload.path || 'fallback',
    model: payload.model || '',
    isError: Boolean(payload.isError),
    errorCode: payload.errorCode || '',
    factsVersion: payload.factsVersion || '',
  })}\n`;
}

function ndjsonReply(payload: NdjsonReplyPayload, setCookieHeader?: string): Response {
  const encoder = new TextEncoder();
  const words = payload.text.split(/(\s+)/);
  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';
      for (let i = 0; i < words.length; i++) {
        buffer += words[i];
        if (buffer.length >= 18 || i === words.length - 1) {
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ type: 'delta', text: buffer })}\n`)
          );
          buffer = '';
        }
      }
      controller.enqueue(encoder.encode(encodeMetaEvent(payload)));
      controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'done' })}\n`));
      controller.close();
    },
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (setCookieHeader) {
    headers['Set-Cookie'] = setCookieHeader;
  }

  return new Response(stream, { status: 200, headers });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestDeadlineAt = startedAt + CHATBOT_BUILD_CONFIG.REQUEST_DEADLINE_MS;

  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return Response.json({ error: 'Invalid request origin header.' }, { status: 403 });
  }

  // 1. Enforce max body size (16 KB)
  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (Buffer.byteLength(rawBody, 'utf8') > CHATBOT_BUILD_CONFIG.MAX_BODY_BYTES) {
    return Response.json(
      { error: 'Request payload exceeds body size limit.' },
      { status: 413 }
    );
  }

  let rawJson: unknown = {};
  try {
    rawJson = JSON.parse(rawBody || '{}');
  } catch {
    return Response.json({ error: 'Malformed JSON body.' }, { status: 400 });
  }

  const parsedReq = validateChatRequestPayload(rawJson);
  if (!parsedReq.ok) {
    return Response.json({ error: parsedReq.error }, { status: 400 });
  }
  const reqData = parsedReq.data;

  const mode = reqData.mode;
  const uiLang = reqData.uiLang;
  const sessionId =
    stripUnsafeHtml(reqData.sessionId || 'sess_anon', 64) || 'sess_anon';

  if (reqData.messages.length > CHATBOT_BUILD_CONFIG.MAX_CLIENT_MESSAGES_WINDOW) {
    const limitMsg =
      uiLang === 'bn'
        ? 'এই কথোপকথনে অনেকগুলো বার্তা জমা হয়েছে। অনুগ্রহ করে রিসেট করে নতুন সেশন শুরু করুন।'
        : 'This conversation payload has too many messages. Please reset to start a fresh thread.';
    return Response.json({ error: limitMsg }, { status: 400 });
  }

  const rawLastUser =
    [...reqData.messages].reverse().find((m) => m.role === 'user')?.text || '';
  const strippedLastRaw = stripUnsafeHtml(String(rawLastUser), 1400);
  if (!strippedLastRaw) {
    return Response.json({ error: 'Message text is required.' }, { status: 400 });
  }
  if (strippedLastRaw.length > CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS) {
    const tooLong =
      uiLang === 'bn'
        ? `অনুগ্রহ করে বার্তাটি ${CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS} অক্ষরের মধ্যে রাখুন।`
        : `Please keep your message within ${CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS} characters.`;
    return Response.json({ error: tooLong }, { status: 400 });
  }

  // Only keep the last MAX_CONTEXT_MESSAGES turns
  const messages = reqData.messages
    .slice(-CHATBOT_BUILD_CONFIG.MAX_CONTEXT_MESSAGES)
    .map((m) => ({
      role: m.role,
      text: stripUnsafeHtml(String(m.text || ''), CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS),
    }))
    .filter((m) => m.text.length > 0);

  const lastUserMessage =
    [...messages].reverse().find((m) => m.role === 'user')?.text || '';

  // Verify admin authorization if requesting Draft Playground mode
  const authHeader = request.headers.get('authorization');
  let adminToken = '';
  let isTestPlayground = reqData.isTestPlayground;
  if (mode === 'draft') {
    const adminCheck = await verifyServerAdminToken(authHeader);
    if (!adminCheck.ok) {
      return Response.json(
        { error: 'Admin authentication required for Draft Playground.' },
        { status: 401 }
      );
    }
    adminToken = (authHeader || '').slice(7).trim();
    isTestPlayground = true;
  }

  const [config, settings, sessionState] = await Promise.all([
    fetchServerChatbotConfig(mode, adminToken),
    fetchServerStoreSettings(),
    loadSessionAndDraft(sessionId),
  ]);

  if (mode === 'published' && (!config.enabled || config.maintenanceMode)) {
    const msg = uiLang === 'bn' ? config.maintenanceMessageBn : config.maintenanceMessageEn;
    const maintenanceCode = !config.enabled ? 'chatbot_disabled' : 'maintenance_mode';
    return ndjsonReply({
      text: msg,
      actions: buildContactActions(settings, uiLang),
      intent: 'maintenance',
      path: 'fallback',
      model: 'maintenance-guard',
      errorCode: maintenanceCode,
    });
  }

  // 2. CGNAT-safe composite rate limits & daily cost ledger
  const bstDate = getTodayBstDateKey();
  const dailyCap = Math.min(
    CHATBOT_BUILD_CONFIG.DAILY_MESSAGE_CAP,
    Number(config.dailyRequestLimit || CHATBOT_BUILD_CONFIG.DAILY_MESSAGE_CAP)
  );

  const [rateCheck, costLedger] = await Promise.all([
    checkCompositeChatRateLimit({
      request,
      sessionId,
      dailyGlobalCap: dailyCap,
    }),
    getPersistentDailyCostStatus(bstDate),
  ]);

  if (!rateCheck.allowed) {
    const rateMsg =
      uiLang === 'bn'
        ? 'এই মুহূর্তে অনেক অনুরোধ পাঠানো হয়েছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন অথবা সরাসরি ফোন ও WhatsApp-এ যোগাযোগ করুন।'
        : 'Too many messages right now. Please wait a moment and try again or reach our team via Phone or WhatsApp below.';
    return jsonWithCookie(
      {
        error: rateMsg,
        code: rateCheck.reason || 'rate_limit',
        retryAfterSec: rateCheck.retryAfterSec,
        actions: buildContactActions(settings, uiLang),
      },
      429,
      rateCheck.setCookieHeader
    );
  }

  const langResolution = detectLanguageAndSignals(
    lastUserMessage,
    config.languageBehavior,
    uiLang,
    sessionState.session?.lockedLang
  );
  const {
    detectedInputLang,
    replyLang,
    explicitSwitchRequested,
    scriptPreference,
  } = langResolution;

  const dailyCostCapUsd = getOptionalDailyCostCapUsd();
  const costCapReached =
    dailyCostCapUsd !== null && (costLedger.totalUsd >= dailyCostCapUsd || costLedger.capHit);

  if (!rateCheck.globalAllowed || costCapReached) {
    const capErrorCode = !rateCheck.globalAllowed
      ? 'daily_global_cap_reached'
      : 'daily_cost_cap_reached';
    const batch = await fetchServerBatchRecord(settings.activeBatchCode);
    const facts = buildStoreFactsSnapshot({ settings, batch, config });
    const capCtx: ToolRuntimeContext = {
      sessionId,
      replyLang,
      settings,
      config,
      batch,
      facts,
      faqs: [],
      kbDocs: [],
      isTestPlayground,
      collectedActions: [],
      orderState: 'collecting_details',
      handoverTriggered: false,
      detectedIntent: 'global_cap_fallback',
      verifiedMonetaryAmounts: getSeededVerifiedMonetaryAmounts(facts),
    };
    await executeChatbotTool('get_business_contact', {}, capCtx);
    const capMsg =
      replyLang === 'bn'
        ? 'আজকের AI চ্যাট লিমিট পূর্ণ হয়েছে। সরাসরি অর্ডার বা সহায়তার জন্য নিচের ফোন ও WhatsApp বাটন ব্যবহার করুন।'
        : 'Daily assistant limit reached. Please use the Phone or WhatsApp buttons below to reach our team directly.';

    const logId = await createServerChatLog({
      sessionId,
      lang: detectedInputLang,
      userMessage: lastUserMessage,
      assistantReply: capMsg,
      intent: 'global_cap_fallback',
      isUnanswered: false,
      isError: false,
      handoverRequested: false,
      latencyMs: Date.now() - startedAt,
      promptTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      errorCode: capErrorCode,
      isTestPlayground,
      path: 'fallback',
      model: 'cap-guard',
      factsVersion: facts.factsVersion,
      confidence: 1,
    });

    return ndjsonReply(
      {
        text: capMsg,
        actions: capCtx.collectedActions,
        logId,
        intent: 'global_cap_fallback',
        path: 'fallback',
        model: 'cap-guard',
        errorCode: capErrorCode,
        factsVersion: facts.factsVersion,
      },
      rateCheck.setCookieHeader
    );
  }

  // 3. Shield 1: Never allow PIN / OTP / Card / Password capture
  if (detectSensitiveSecret(lastUserMessage)) {
    const shieldReply =
      replyLang === 'bn'
        ? 'নিরাপত্তার স্বার্থে কখনোই আপনার bKash/Nagad PIN, OTP, কার্ড নম্বর বা পাসওয়ার্ড এখানে শেয়ার করবেন না। পেমেন্ট যাচাইয়ের জন্য শুধু Transaction ID দিন অথবা সাপোর্টে যোগাযোগ করুন।'
        : 'For your security, please never share your bKash/Nagad PIN, OTP, card number, or password here. Only a Transaction ID (TxnID) is needed for bKash/Nagad orders.';

    const logId = await createServerChatLog({
      sessionId,
      lang: detectedInputLang,
      userMessage: '[REDACTED_SENSITIVE_INPUT]',
      assistantReply: shieldReply,
      intent: 'security_credential_shield',
      isUnanswered: false,
      isError: false,
      handoverRequested: false,
      latencyMs: Date.now() - startedAt,
      promptTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      errorCode: 'sensitive_secret_blocked',
      guardCategory: 'sensitive_secret_blocked',
      isTestPlayground,
      path: 'fallback',
      model: 'security-guard',
      confidence: 1,
    });
    return ndjsonReply(
      {
        text: shieldReply,
        actions: buildContactActions(settings, replyLang),
        logId,
        intent: 'security_credential_shield',
        path: 'fallback',
        model: 'security-guard',
        errorCode: 'sensitive_secret_blocked',
      },
      rateCheck.setCookieHeader
    );
  }

  // 4. Shield 2: Prompt injection defense
  if (detectPromptInjection(lastUserMessage)) {
    const injectionReply =
      replyLang === 'bn'
        ? 'দুঃখিত, আমি শুধু Deshi Gee এবং আমাদের খাঁটি পাবনার ঘি নিয়ে সাহায্য করতে পারি। দাম, সাইজ অথবা অর্ডার নিয়ে কিছু জানতে চান?'
        : 'Sorry, I can only assist with Deshi Gee — our Pabna cow ghee, prices, delivery, and customer support. How can I help you today?';

    const logId = await createServerChatLog({
      sessionId,
      lang: detectedInputLang,
      userMessage: lastUserMessage,
      assistantReply: injectionReply,
      intent: 'prompt_injection_blocked',
      isUnanswered: false,
      isError: false,
      handoverRequested: false,
      latencyMs: Date.now() - startedAt,
      promptTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      errorCode: 'prompt_injection_blocked',
      guardCategory: 'prompt_injection_blocked',
      isTestPlayground,
      path: 'fallback',
      model: 'security-guard',
      confidence: 1,
    });
    return ndjsonReply(
      {
        text: injectionReply,
        logId,
        intent: 'prompt_injection_blocked',
        path: 'fallback',
        model: 'security-guard',
        errorCode: 'prompt_injection_blocked',
      },
      rateCheck.setCookieHeader
    );
  }

  // 4b. T2.1 Typed Confirmation Guard: never create/commit an order from typed text like "Yes"/"হ্যাঁ"/"OK"
  if (
    (sessionState.draft?.state === 'awaiting_confirmation' ||
      Boolean(sessionState.draft?.lastSummary)) &&
    isTypedConfirmationOnly(lastUserMessage)
  ) {
    const guardReply =
      replyLang === 'bn'
        ? 'আপনার অর্ডার সামারি কার্ডটি ইতিমধ্যে তৈরি আছে। চ্যাটে "হ্যাঁ" বা "Confirm" লিখে অর্ডার চূড়ান্ত হয় না—অনুগ্রহ করে নিচের সামারি কার্ডের **"অর্ডার কনফার্ম করুন"** বাটনটিতে ক্লিক করুন (অথবা কোনো তথ্য পরিবর্তন করতে চাইলে সেটি লিখে জানান)।'
        : 'Your order summary card is already ready. Typing "Yes" or "Confirm" does not place an order automatically—please click the **"Confirm Order"** button on the summary card below (or let me know if you want to edit any detail).';

    const sessionToSave = buildInitialSessionDoc(sessionId, sessionState.session, {
      replyLang,
      explicitSwitchRequested,
      scriptPreference,
      intent: 'order',
      orderDraftId: sessionState.draft?.draftId,
    });

    const [logId] = await Promise.all([
      createServerChatLog({
        sessionId,
        lang: detectedInputLang,
        userMessage: lastUserMessage,
        assistantReply: guardReply,
        intent: 'order',
        isUnanswered: false,
        isError: false,
        handoverRequested: false,
        latencyMs: Date.now() - startedAt,
        promptTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        errorCode: 'typed_confirmation_requires_button',
        guardCategory: 'typed_confirmation_guard',
        isTestPlayground,
        path: 'fallback',
        model: 'confirmation-button-guard',
        confidence: 1,
      }),
      saveSessionAndDraft({ session: sessionToSave, draft: sessionState.draft }),
    ]);

    return ndjsonReply(
      {
        text: guardReply,
        orderSummary: sessionState.draft?.lastSummary,
        suggestedReplies:
          replyLang === 'bn'
            ? ['ডেলিভারি ঠিকানা পরিবর্তন করব', 'অর্ডার বাতিল করুন']
            : ['Edit delivery address', 'Cancel draft'],
        logId,
        lockedLang: sessionToSave.lockedLang,
        intent: 'order',
        path: 'fallback',
        model: 'confirmation-button-guard',
        errorCode: 'typed_confirmation_requires_button',
      },
      rateCheck.setCookieHeader
    );
  }

  // 5. Shield 3: Domain guard with active session draft context
  const hasActiveOrderContext =
    Boolean(
      sessionState.draft &&
        (sessionState.draft.state === 'collecting_details' ||
          sessionState.draft.state === 'quote_ready' ||
          sessionState.draft.state === 'awaiting_confirmation')
    ) ||
    messages
      .slice(0, -1)
      .some((m) =>
        /(size|sizes|weight|weights|সাইজ|ওজন|250g|500g|1kg|অর্ডার|order|address|ঠিকানা|phone|নম্বর)/i.test(
          m.text
        )
      );
  const domainCheck = classifyDomainRequest(lastUserMessage, hasActiveOrderContext);

  if (domainCheck.category === 'disallowed_off_topic') {
    const domainReply =
      replyLang === 'bn'
        ? 'দুঃখিত, আমি শুধু Deshi Gee এবং আমাদের পণ্য নিয়ে সাহায্য করতে পারি। দাম, সাইজ অথবা অর্ডার নিয়ে কিছু জানতে চান?'
        : 'Sorry, I can only help with Deshi Gee, our product, and customer support. Would you like to know about our ghee or ordering process?';

    const sessionToSave = buildInitialSessionDoc(sessionId, sessionState.session, {
      replyLang,
      explicitSwitchRequested,
      scriptPreference,
      intent: 'off_topic_refusal',
      orderDraftId: sessionState.draft?.draftId,
    });

    const [logId] = await Promise.all([
      createServerChatLog({
        sessionId,
        lang: detectedInputLang,
        userMessage: lastUserMessage,
        assistantReply: domainReply,
        intent: 'off_topic_refusal',
        isUnanswered: false,
        isError: false,
        handoverRequested: false,
        latencyMs: Date.now() - startedAt,
        promptTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        errorCode: 'domain_guard_blocked',
        guardCategory: 'domain_guard_blocked',
        isTestPlayground,
        path: 'fallback',
        model: 'domain-guard',
        confidence: 0.99,
      }),
      saveSessionAndDraft({ session: sessionToSave, draft: sessionState.draft }),
    ]);

    return ndjsonReply(
      {
        text: domainReply,
        logId,
        lockedLang: sessionToSave.lockedLang,
        intent: 'off_topic_refusal',
        path: 'fallback',
        model: 'domain-guard',
        errorCode: 'domain_guard_blocked',
      },
      rateCheck.setCookieHeader
    );
  }

  // Prepare sanitized last user prompt (if mixed_question, ONLY Deshi Gee clauses go to Gemini/RAG)
  const effectiveMessages = messages.map((m, idx) =>
    idx === messages.length - 1 && m.role === 'user'
      ? { ...m, text: domainCheck.filteredPromptForGemini }
      : m
  );

  // Extract & update server-side OrderDraft slots when in an order flow or when customer provides order slots
  const extractedSlots = extractOrderSlotsFromText(
    domainCheck.filteredPromptForGemini,
    sessionState.draft
  );
  const startsOrContinuesOrder =
    Boolean(sessionState.draft) ||
    Boolean(extractedSlots.cancelOrderRequested) ||
    Boolean(extractedSlots.phone || extractedSlots.address || extractedSlots.txnId) ||
    (/(\border\b|অর্ডার|কিনব|কিনতে|নিব|নিবো|lagbe|লাগবে|buy|purchase|checkout)/i.test(
      domainCheck.filteredPromptForGemini
    ) &&
      !/(দাম|কত|price|dam|daam|koto|taka|cost|how\s+much|how to place|কীভাবে অর্ডার)/i.test(
        domainCheck.filteredPromptForGemini
      ));

  let activeDraft: OrderDraftDoc | null = sessionState.draft;
  if (startsOrContinuesOrder) {
    const applied = applySlotsToOrderDraft({
      sessionId,
      currentDraft: sessionState.draft,
      extracted: extractedSlots,
      settings,
    });
    activeDraft = applied.draft.state === 'cancelled' ? applied.draft : applied.draft;
  }

  const intentClass = classifyTurnIntent(domainCheck.filteredPromptForGemini, activeDraft);

  const includeDraftKnowledge = mode === 'draft';
  const [batch, faqs, kbDocs, storedChunks] = await Promise.all([
    fetchServerBatchRecord(settings.activeBatchCode),
    fetchServerChatbotFaqs(includeDraftKnowledge, adminToken),
    fetchServerChatbotKbDocs(includeDraftKnowledge, adminToken),
    fetchPublishedKnowledgeChunks(includeDraftKnowledge, adminToken),
  ]);

  const facts: StoreFactsSnapshot = buildStoreFactsSnapshot({ settings, batch, config });
  if (facts.conflicts.length > 0) {
    console.warn(
      JSON.stringify({
        event: 'store_fact_conflicts',
        factsVersion: facts.factsVersion,
        conflicts: facts.conflicts,
      })
    );
  }

  const ai = createGeminiClient();
  const ragResult = await runHybridKnowledgeSearch({
    query: domainCheck.filteredPromptForGemini,
    faqs,
    kbDocs,
    storedChunks,
    replyLang,
    synonyms: config.synonyms,
    ai,
  });

  const matchedFaqs = ragResult.faqs;
  const kbSnippets = ragResult.kbSnippets;
  const ragMs = ragResult.ragMs;

  const runtimeCtx: ToolRuntimeContext = {
    sessionId,
    replyLang,
    settings,
    config,
    batch,
    facts,
    faqs,
    kbDocs,
    storedChunks,
    isTestPlayground,
    collectedActions: [],
    priceQuoteVersion: activeDraft?.priceQuoteVersion || 1,
    orderState: 'collecting_details',
    handoverTriggered: false,
    detectedIntent: domainCheck.mixedNoticeNeeded ? 'mixed_domain_handled' : intentClass.intent,
    verifiedMonetaryAmounts: getSeededVerifiedMonetaryAmounts(facts),
  };

  function validateUnifiedReply(replyText: string) {
    return validateChatbotResponse({
      replyText,
      replyLang,
      settings,
      config,
      verifiedMonetaryAmounts: Array.from(runtimeCtx.verifiedMonetaryAmounts),
      verifiedOrderTrackingStatus: runtimeCtx.verifiedOrderTrackingStatus,
      hasPreparedOrderSummary: Boolean(runtimeCtx.collectedOrderSummary),
      customerPhoneInTurn: runtimeCtx.customerPhoneInTurn,
      isMixedQuestion: domainCheck.mixedNoticeNeeded,
    });
  }

  function runValidatedFallback(fallbackErrorCode: string, logAsError: boolean) {
    const fallbackResult = generateLiveFallbackReply({
      userMessage: domainCheck.filteredPromptForGemini || lastUserMessage,
      replyLang,
      settings,
      batch,
      config,
      matchedFaqs,
      matchedKbSnippets: kbSnippets,
      activeDraft,
      facts,
    });
    for (const amt of fallbackResult.extraVerifiedAmounts || []) {
      if (Number.isFinite(amt) && amt > 0) {
        runtimeCtx.verifiedMonetaryAmounts.add(Math.round(amt));
      }
    }
    for (const a of fallbackResult.actions) {
      if (!runtimeCtx.collectedActions.some((x) => x.type === a.type && x.value === a.value)) {
        runtimeCtx.collectedActions.push(a);
      }
    }
    if (fallbackResult.productCards && !runtimeCtx.collectedProductCards) {
      runtimeCtx.collectedProductCards = fallbackResult.productCards;
    }

    const fallbackGuard = validateUnifiedReply(fallbackResult.replyText);
    if (fallbackGuard.passed) {
      return {
        replyText: fallbackResult.replyText,
        intent: fallbackResult.intent,
        guardCategory: '',
        errorCode: fallbackErrorCode,
        isError: logAsError,
        isUnanswered: Boolean(fallbackResult.noVerifiedInfo),
        suggestedReplies: fallbackResult.suggestedReplies,
      };
    }

    if (runtimeCtx.collectedActions.length === 0) {
      for (const a of buildContactActions(settings, replyLang)) {
        runtimeCtx.collectedActions.push(a);
      }
    }
    return {
      replyText: replyLang === 'bn' ? config.fallbackMessageBn : config.fallbackMessageEn,
      intent: fallbackResult.intent,
      guardCategory: fallbackGuard.errorCategory || 'unapproved_claim',
      errorCode: fallbackErrorCode || `fallback_guard_${fallbackGuard.errorCategory || 'blocked'}`,
      isError: true,
      isUnanswered: true,
      suggestedReplies: buildContextualSuggestedReplies(intentClass.intent, replyLang, activeDraft),
    };
  }

  const scopedDeclarations = CHATBOT_FUNCTION_DECLARATIONS.filter((decl) =>
    Boolean(decl.name && intentClass.allowedToolNames.includes(decl.name))
  );
  const { primaryModel: primaryModelName, fallbackModel: fallbackModelName } =
    resolveConfiguredChatModels(config);

  const primaryModelCheck = validateGeminiModelCapability(primaryModelName, {
    role: 'primary',
    functionDeclarationsCount: scopedDeclarations.length,
  });
  const fallbackModelCheck = validateGeminiModelCapability(fallbackModelName, {
    role: 'fallback',
    functionDeclarationsCount: scopedDeclarations.length,
  });
  const hasSupportedModel = primaryModelCheck.supported || fallbackModelCheck.supported;

  // Deterministic live storefront fallback when GEMINI_API_KEY is missing or no supported model is configured
  if (!ai || !isGeminiApiKeyConfigured() || !hasSupportedModel) {
    const fallbackErrorCode = !hasSupportedModel
      ? 'no_supported_model_configured'
      : 'gemini_api_key_missing';
    const safeFallback = runValidatedFallback(fallbackErrorCode, !hasSupportedModel);
    const totalMs = Date.now() - startedAt;

    const sessionToSave = buildInitialSessionDoc(sessionId, sessionState.session, {
      replyLang,
      explicitSwitchRequested,
      scriptPreference,
      intent: safeFallback.intent,
      orderDraftId: activeDraft?.draftId,
    });

    const diagnostics: ChatDiagnosticsMeta = {
      intent: safeFallback.intent,
      confidence: intentClass.confidence,
      model: 'live-fallback-engine',
      path: 'fallback',
      toolsUsed: [],
      sources: ragResult.sources,
      guardStatus: safeFallback.guardCategory || 'passed',
      ragMs,
      modelMs: 0,
      toolMs: 0,
      totalMs,
      promptTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      streamedRealTokens: false,
      factsVersion: facts.factsVersion,
    };

    const [logId] = await Promise.all([
      createServerChatLog({
        sessionId,
        lang: detectedInputLang,
        userMessage: lastUserMessage,
        assistantReply: safeFallback.replyText,
        intent: safeFallback.intent,
        isUnanswered: safeFallback.isUnanswered,
        isError: safeFallback.isError,
        handoverRequested: false,
        latencyMs: totalMs,
        promptTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        errorCode: safeFallback.errorCode,
        guardCategory: safeFallback.guardCategory,
        factsVersion: facts.factsVersion,
        isTestPlayground,
        path: 'fallback',
        model: 'live-fallback-engine',
        ragMs,
        modelMs: 0,
        toolMs: 0,
        ragSources: ragResult.sources.map((s) => `${s.sourceType}:${s.id}`).slice(0, 8),
        confidence: intentClass.confidence,
      }),
      saveSessionAndDraft({ session: sessionToSave, draft: activeDraft }),
    ]);

    return ndjsonReply(
      {
        text: safeFallback.replyText,
        actions: runtimeCtx.collectedActions,
        productCards: runtimeCtx.collectedProductCards,
        suggestedReplies: safeFallback.suggestedReplies,
        sources: ragResult.sources,
        diagnostics,
        logId,
        lockedLang: sessionToSave.lockedLang,
        intent: safeFallback.intent,
        path: 'fallback',
        model: 'live-fallback-engine',
        isError: safeFallback.isError,
        errorCode: safeFallback.errorCode,
        factsVersion: facts.factsVersion,
      },
      rateCheck.setCookieHeader
    );
  }

  let totalPromptTokens = 0;
  let totalOutputTokens = 0;
  let finalReply = '';
  let errorCode = '';
  let guardCategory = '';
  let isError = false;
  let isUnanswered = false;
  let retryCount = 0;
  let toolCallCount = 0;
  const toolsUsed: string[] = [];
  let modelMs = 0;
  let toolMs = 0;
  let lastFinishReason = '';
  let failoverReason = '';
  let activePath: ChatbotExecutionPath = 'gemini';
  let activeModelUsed = primaryModelCheck.supported ? primaryModelName : fallbackModelName;
  let streamedRealTokens = false;

  const executedToolCache = new Map<string, Record<string, unknown>>();
  let handoverTicketResult: Record<string, unknown> | null = null;
  let preparedSummaryResult: Record<string, unknown> | null = null;

  async function executeToolIdempotently(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const cacheKey = `${toolName}:${stableStringify(args)}`;
    const cached = executedToolCache.get(cacheKey);
    if (cached) return cached;

    if (toolName === 'submit_support_handover' && handoverTicketResult) {
      return handoverTicketResult;
    }
    if (toolName === 'prepare_order_summary' && preparedSummaryResult) {
      return preparedSummaryResult;
    }

    const t0 = Date.now();
    toolCallCount += 1;
    if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName);
    const result = await executeChatbotTool(toolName, args, runtimeCtx);
    toolMs += Date.now() - t0;

    executedToolCache.set(cacheKey, result);
    if (toolName === 'submit_support_handover' && result.submitted) {
      handoverTicketResult = result;
    }
    if (toolName === 'prepare_order_summary' && result.ready) {
      preparedSummaryResult = result;
      if (runtimeCtx.collectedOrderSummary) {
        if (!activeDraft) {
          activeDraft = {
            draftId: sessionState.session?.orderDraftId || `draft_${sessionId}`,
            sessionId,
            weight: runtimeCtx.collectedOrderSummary.weight,
            qty: runtimeCtx.collectedOrderSummary.qty,
            qty250g: runtimeCtx.collectedOrderSummary.qty250g,
            qty500g: runtimeCtx.collectedOrderSummary.qty500g,
            qty1kg: runtimeCtx.collectedOrderSummary.qty1kg,
            customerName: runtimeCtx.collectedOrderSummary.customerName,
            phone: runtimeCtx.collectedOrderSummary.phone,
            district: runtimeCtx.collectedOrderSummary.district,
            area: runtimeCtx.collectedOrderSummary.area,
            address: runtimeCtx.collectedOrderSummary.address,
            paymentMethod: runtimeCtx.collectedOrderSummary.paymentMethod,
            couponCode: runtimeCtx.collectedOrderSummary.couponCode,
            state: 'awaiting_confirmation',
            priceQuoteVersion: runtimeCtx.priceQuoteVersion,
            expiresAt: Date.now() + 30 * 60 * 1000,
            lastSummary: runtimeCtx.collectedOrderSummary,
          };
        } else {
          activeDraft.lastSummary = runtimeCtx.collectedOrderSummary;
          activeDraft.state = 'awaiting_confirmation';
        }
      }
    }
    return result;
  }

  async function invokeModelAttempt(
    modelName: string,
    contents: Content[],
    systemInstruction: string,
    opts: { maxOutputTokens?: number; lowThinkingMode?: boolean; disableTools?: boolean }
  ) {
    const remainingMs = requestDeadlineAt - Date.now();
    if (remainingMs < 1000) {
      throw new Error('Request deadline exceeded');
    }
    const timeoutMs = Math.min(CHATBOT_BUILD_CONFIG.GEMINI_TIMEOUT_MS, Math.max(1000, remainingMs));
    const controller = new AbortController();
    const t0 = Date.now();
    try {
      const configPayload = buildGeminiGenerateConfig({
        model: modelName,
        systemInstruction,
        functionDeclarations: scopedDeclarations,
        maxOutputTokens: opts.maxOutputTokens ?? getConfiguredMaxOutputTokens(),
        lowThinkingMode: opts.lowThinkingMode,
        disableTools: opts.disableTools,
        abortSignal: controller.signal,
      });

      const response = await generateWithTimeout(
        ai!.models.generateContent({
          model: modelName,
          contents,
          config: configPayload,
        }),
        timeoutMs
      );
      modelMs += Date.now() - t0;
      return response;
    } catch (err) {
      controller.abort();
      modelMs += Date.now() - t0;
      throw err;
    }
  }

  async function runGeminiPass(passOpts?: {
    correctiveHint?: string;
    maxOutputTokens?: number;
    lowThinkingMode?: boolean;
  }): Promise<{ text: string; finishReason: string; safetyBlocked: boolean }> {
    const systemInstruction = buildSystemPrompt({
      config,
      settings,
      batch,
      facts,
      replyLang,
      scriptPreference,
      matchedFaqs,
      matchedKbSnippets: kbSnippets,
      isMixedQuestion: domainCheck.mixedNoticeNeeded,
      correctiveHint: passOpts?.correctiveHint,
      draftSummary: buildDraftPromptSummary(activeDraft),
      noVerifiedKnowledgeMatch: ragResult.noVerifiedMatch,
    });

    let activeModel = primaryModelCheck.supported ? primaryModelName : fallbackModelName;
    activeModelUsed = activeModel;
    const contents: Content[] = effectiveMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));

    let assembled = '';
    let passFinishReason = '';
    let safetyBlocked = false;

    for (let round = 0; round < CHATBOT_BUILD_CONFIG.MAX_TOOL_CALLS_PER_TURN; round++) {
      let response;
      try {
        response = await invokeModelAttempt(activeModel, contents, systemInstruction, {
          maxOutputTokens: passOpts?.maxOutputTokens,
          lowThinkingMode: passOpts?.lowThinkingMode,
          disableTools: false,
        });
      } catch (innerErr) {
        const classified = classifyGeminiError(innerErr);
        const remainingMs = requestDeadlineAt - Date.now();
        if (
          classified.shouldFailover &&
          round === 0 &&
          activeModel !== fallbackModelName &&
          fallbackModelCheck.supported &&
          remainingMs >= 1500
        ) {
          failoverReason = classified.code;
          activeModel = fallbackModelName;
          activeModelUsed = activeModel;
          response = await invokeModelAttempt(activeModel, contents, systemInstruction, {
            maxOutputTokens: passOpts?.maxOutputTokens,
            lowThinkingMode: passOpts?.lowThinkingMode,
            disableTools: false,
          });
        } else {
          throw innerErr;
        }
      }

      totalPromptTokens += response.usageMetadata?.promptTokenCount || 0;
      totalOutputTokens += response.usageMetadata?.candidatesTokenCount || 0;

      const blockReason = String(
        (response as { promptFeedback?: { blockReason?: string } }).promptFeedback?.blockReason || ''
      );
      passFinishReason = String(response.candidates?.[0]?.finishReason || '');
      lastFinishReason = passFinishReason || blockReason || lastFinishReason;

      if (blockReason || SAFETY_BLOCK_FINISH_REASONS.has(passFinishReason)) {
        safetyBlocked = true;
        assembled = '';
        break;
      }

      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) {
        assembled = (response.text || '').trim();
        break;
      }

      if (response.candidates?.[0]?.content) {
        contents.push(response.candidates[0].content);
      }

      const fnResponseParts = [];
      for (const call of functionCalls.slice(0, CHATBOT_BUILD_CONFIG.MAX_TOOL_CALLS_PER_TURN)) {
        const result = await executeToolIdempotently(
          call.name || '',
          (call.args as Record<string, unknown>) || {}
        );
        fnResponseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name,
            response: { result },
          },
        });
      }

      contents.push({
        role: 'user',
        parts: fnResponseParts,
      });

      if (round === CHATBOT_BUILD_CONFIG.MAX_TOOL_CALLS_PER_TURN - 1) {
        if (requestDeadlineAt - Date.now() >= 1200) {
          const finalRes = await invokeModelAttempt(activeModel, contents, systemInstruction, {
            maxOutputTokens: passOpts?.maxOutputTokens,
            lowThinkingMode: true,
            disableTools: true,
          });
          totalPromptTokens += finalRes.usageMetadata?.promptTokenCount || 0;
          totalOutputTokens += finalRes.usageMetadata?.candidatesTokenCount || 0;
          const finalBlock = String(
            (finalRes as { promptFeedback?: { blockReason?: string } }).promptFeedback?.blockReason || ''
          );
          passFinishReason = String(finalRes.candidates?.[0]?.finishReason || '');
          lastFinishReason = passFinishReason || finalBlock || lastFinishReason;
          if (finalBlock || SAFETY_BLOCK_FINISH_REASONS.has(passFinishReason)) {
            safetyBlocked = true;
            assembled = '';
          } else {
            assembled = (finalRes.text || '').trim();
          }
        }
      }
    }

    return { text: assembled, finishReason: passFinishReason, safetyBlocked };
  }

  // Safe conditional real Gemini streaming (only for tool-free / prose turns; numbers/claims always held for pre-send guard)
  const canAttemptLiveStream =
    reqData.stream &&
    intentClass.canStreamSafely &&
    !domainCheck.mixedNoticeNeeded &&
    typeof ai.models?.generateContentStream === 'function';

  if (canAttemptLiveStream) {
    const encoder = new TextEncoder();
    const systemInstruction = buildSystemPrompt({
      config,
      settings,
      batch,
      facts,
      replyLang,
      scriptPreference,
      matchedFaqs,
      matchedKbSnippets: kbSnippets,
      isMixedQuestion: false,
      draftSummary: buildDraftPromptSummary(activeDraft),
      noVerifiedKnowledgeMatch: ragResult.noVerifiedMatch,
    });
    const contents: Content[] = effectiveMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));

    const stream = new ReadableStream({
      async start(controller) {
        let flushedLen = 0;
        let accumulated = '';
        let heldDueToRisk = false;
        let sawToolCall = false;
        let streamSafetyBlocked = false;
        let streamFinishReason = '';

        const flushDelta = (chunk: string) => {
          if (!chunk) return;
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'delta', text: chunk })}\n`));
        };

        try {
          const streamT0 = Date.now();
          const configPayload = buildGeminiGenerateConfig({
            model: activeModelUsed,
            systemInstruction,
            functionDeclarations: scopedDeclarations,
            maxOutputTokens: getConfiguredMaxOutputTokens(),
            lowThinkingMode: false,
            disableTools: false,
          });

          const asyncStream = await ai.models.generateContentStream({
            model: activeModelUsed,
            contents,
            config: configPayload,
          });

          for await (const chunk of asyncStream) {
            totalPromptTokens = chunk.usageMetadata?.promptTokenCount || totalPromptTokens;
            totalOutputTokens = chunk.usageMetadata?.candidatesTokenCount || totalOutputTokens;

            const blockReason = String(
              (chunk as { promptFeedback?: { blockReason?: string } }).promptFeedback?.blockReason || ''
            );
            const fReason = String(chunk.candidates?.[0]?.finishReason || '');
            if (fReason) streamFinishReason = fReason;
            if (blockReason || SAFETY_BLOCK_FINISH_REASONS.has(fReason)) {
              streamSafetyBlocked = true;
              break;
            }
            if (chunk.functionCalls && chunk.functionCalls.length > 0) {
              sawToolCall = true;
              break;
            }
            const partText = chunk.text || '';
            if (partText) {
              accumulated += partText;
              if (!heldDueToRisk && STREAM_HOLD_BACK_RX.test(accumulated)) {
                heldDueToRisk = true;
              }
              if (!heldDueToRisk && flushedLen < accumulated.length) {
                const delta = accumulated.slice(flushedLen);
                flushedLen = accumulated.length;
                streamedRealTokens = true;
                flushDelta(delta);
              }
            }
          }
          modelMs += Date.now() - streamT0;
          lastFinishReason = streamFinishReason || lastFinishReason;

          if (sawToolCall || streamSafetyBlocked || !accumulated.trim()) {
            // Re-run cleanly through guarded multi-round pass when tools are invoked or stream was empty
            const passRes = sawToolCall ? await runGeminiPass() : { text: '', finishReason: streamFinishReason, safetyBlocked: streamSafetyBlocked };
            if (passRes.safetyBlocked) {
              isError = true;
              isUnanswered = true;
              errorCode = 'safety_blocked';
              await executeToolIdempotently('get_business_contact', {});
              finalReply =
                replyLang === 'bn'
                  ? 'দুঃখিত, নিরাপত্তার কারণে এই অনুরোধটির উত্তর দেওয়া যাচ্ছে না। Deshi Gee সম্পর্কে জানতে অনুগ্রহ করে সরাসরি ফোন বা WhatsApp-এ যোগাযোগ করুন।'
                  : 'Sorry, I cannot answer that request due to safety policies. Please contact our support team via Phone or WhatsApp for Deshi Gee help.';
            } else if (!passRes.text) {
              const safeFallback = runValidatedFallback('empty_stream_fallback', false);
              activePath = 'fallback';
              activeModelUsed = 'live-fallback-engine';
              finalReply = safeFallback.replyText;
              errorCode = safeFallback.errorCode;
              isUnanswered = safeFallback.isUnanswered;
            } else {
              finalReply = passRes.text;
            }
          } else {
            finalReply = accumulated.trim();
          }

          const guard = validateUnifiedReply(finalReply);
          if (!guard.passed) {
            guardCategory = guard.errorCategory || 'response_guard_blocked';
            if (flushedLen === 0 && requestDeadlineAt - Date.now() >= 2000) {
              retryCount += 1;
              const retryPass = await runGeminiPass({
                correctiveHint: guard.correctiveHint || guard.reason,
                lowThinkingMode: true,
              });
              if (retryPass.text && validateUnifiedReply(retryPass.text).passed) {
                finalReply = retryPass.text;
              } else {
                isUnanswered = true;
                errorCode = `response_guard_${guardCategory}`;
                await executeToolIdempotently('get_business_contact', {});
                finalReply =
                  replyLang === 'bn' ? config.fallbackMessageBn : config.fallbackMessageEn;
              }
            } else if (flushedLen === 0) {
              isUnanswered = true;
              errorCode = `response_guard_${guardCategory}`;
              await executeToolIdempotently('get_business_contact', {});
              finalReply =
                replyLang === 'bn' ? config.fallbackMessageBn : config.fallbackMessageEn;
            }
          }
        } catch (err) {
          if (flushedLen === 0) {
            activePath = 'fallback';
            activeModelUsed = 'live-fallback-engine';
            isError = true;
            isUnanswered = true;
            const classified = classifyGeminiError(err);
            const safeFallback = runValidatedFallback(classified.code, true);
            finalReply = safeFallback.replyText;
            errorCode = safeFallback.errorCode || classified.code;
            guardCategory = safeFallback.guardCategory || '';
          }
        }

        if (flushedLen < finalReply.length) {
          flushDelta(flushedLen === 0 ? finalReply : finalReply.slice(flushedLen));
        }

        isUnanswered =
          isError ||
          isUnanswered ||
          detectUnansweredHeuristic(
            finalReply,
            config.fallbackMessageBn,
            config.fallbackMessageEn
          );

        const latencyMs = Date.now() - startedAt;
        const estimatedCostUsd = estimateGeminiCostUsd(totalPromptTokens, totalOutputTokens);
        const sessionToSave = buildInitialSessionDoc(sessionId, sessionState.session, {
          replyLang,
          explicitSwitchRequested,
          scriptPreference,
          intent: runtimeCtx.detectedIntent,
          orderDraftId: activeDraft?.draftId,
        });

        const [, logId] = await Promise.all([
          recordPersistentDailyCost(bstDate, {
            costUsd: estimatedCostUsd,
            promptTokens: totalPromptTokens,
            outputTokens: totalOutputTokens,
            capUsd: dailyCostCapUsd,
          }),
          createServerChatLog({
            sessionId,
            lang: detectedInputLang,
            userMessage: lastUserMessage,
            assistantReply: finalReply,
            intent: runtimeCtx.detectedIntent,
            isUnanswered,
            isError,
            handoverRequested: runtimeCtx.handoverTriggered,
            latencyMs,
            promptTokens: totalPromptTokens,
            outputTokens: totalOutputTokens,
            estimatedCostUsd,
            errorCode,
            guardCategory,
            retryCount,
            toolCallCount,
            finishReason: lastFinishReason,
            factsVersion: facts.factsVersion,
            isTestPlayground,
            path: activePath,
            model: activeModelUsed,
            ragMs,
            modelMs,
            toolMs,
            ragSources: ragResult.sources.map((s) => `${s.sourceType}:${s.id}`).slice(0, 8),
            confidence: intentClass.confidence,
          }),
          saveSessionAndDraft({ session: sessionToSave, draft: activeDraft }),
        ]);

        const diagnostics: ChatDiagnosticsMeta = {
          intent: runtimeCtx.detectedIntent,
          confidence: intentClass.confidence,
          model: activeModelUsed,
          path: activePath,
          toolsUsed,
          sources: ragResult.sources,
          guardStatus: guardCategory || 'passed',
          ragMs,
          modelMs,
          toolMs,
          totalMs: latencyMs,
          promptTokens: totalPromptTokens,
          outputTokens: totalOutputTokens,
          estimatedCostUsd,
          streamedRealTokens,
          factsVersion: facts.factsVersion,
        };

        controller.enqueue(
          encoder.encode(
            encodeMetaEvent({
              text: finalReply,
              actions: runtimeCtx.collectedActions,
              orderSummary: runtimeCtx.collectedOrderSummary,
              productCards: runtimeCtx.collectedProductCards,
              trackingCard: runtimeCtx.collectedTrackingCard,
              suggestedReplies: buildContextualSuggestedReplies(
                intentClass.intent,
                replyLang,
                activeDraft
              ),
              sources: ragResult.sources,
              diagnostics,
              logId,
              lockedLang: sessionToSave.lockedLang,
              intent: runtimeCtx.detectedIntent,
              path: activePath,
              model: activeModelUsed,
              isError,
              errorCode,
              factsVersion: facts.factsVersion,
            })
          )
        );
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'done' })}\n`));
        controller.close();
      },
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    };
    if (rateCheck.setCookieHeader) {
      headers['Set-Cookie'] = rateCheck.setCookieHeader;
    }
    return new Response(stream, { status: 200, headers });
  }

  // Guarded execution path (pricing, stock, order, tracking, complaint, mixed, or stream=false)
  try {
    let passResult = await runGeminiPass();

    if (
      !passResult.safetyBlocked &&
      (!passResult.text || passResult.finishReason === 'MAX_TOKENS') &&
      requestDeadlineAt - Date.now() >= 2000
    ) {
      retryCount += 1;
      passResult = await runGeminiPass({
        maxOutputTokens: CHATBOT_BUILD_CONFIG.GEMINI_RETRY_MAX_OUTPUT_TOKENS,
        lowThinkingMode: true,
        correctiveHint:
          'Provide a concise, complete final answer to the customer right now using only verified Deshi Gee facts.',
      });
    }

    if (passResult.safetyBlocked) {
      isError = true;
      isUnanswered = true;
      errorCode = 'safety_blocked';
      await executeToolIdempotently('get_business_contact', {});
      finalReply =
        replyLang === 'bn'
          ? 'দুঃখিত, নিরাপত্তার কারণে এই অনুরোধটির উত্তর দেওয়া যাচ্ছে না। Deshi Gee সম্পর্কে জানতে অনুগ্রহ করে সরাসরি ফোন বা WhatsApp-এ যোগাযোগ করুন।'
          : 'Sorry, I cannot answer that request due to safety policies. Please contact our support team via Phone or WhatsApp for Deshi Gee help.';
    } else if (!passResult.text) {
      isError = true;
      isUnanswered = true;
      errorCode =
        passResult.finishReason === 'MAX_TOKENS' ? 'max_tokens_exhausted' : 'empty_reply';
      await executeToolIdempotently('get_business_contact', {});
      finalReply =
        replyLang === 'bn'
          ? 'দুঃখিত, এই মুহূর্তে পুরো উত্তরটি তৈরি করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন অথবা নিচের ফোন বা WhatsApp-এ যোগাযোগ করুন।'
          : 'Sorry, I could not finish generating that reply right now. Please try again or reach our team via Phone or WhatsApp below.';
    } else {
      finalReply = passResult.text;

      // 6. MANDATORY PRE-SEND RESPONSE GUARD VALIDATION
      const guard = validateUnifiedReply(finalReply);
      if (!guard.passed) {
        guardCategory = guard.errorCategory || 'response_guard_blocked';
        const canRetryGuard = requestDeadlineAt - Date.now() >= 2000;
        let resolvedGuard = guard;
        let candidateReply = finalReply;

        if (canRetryGuard) {
          retryCount += 1;
          const retryPass = await runGeminiPass({
            correctiveHint: guard.correctiveHint || guard.reason,
            lowThinkingMode: true,
          });
          if (retryPass.text) {
            candidateReply = retryPass.text;
            resolvedGuard = validateUnifiedReply(candidateReply);
          }
        }

        if (resolvedGuard.passed) {
          finalReply = candidateReply;
        } else {
          guardCategory = resolvedGuard.errorCategory || guardCategory;
          if (runtimeCtx.collectedOrderSummary) {
            errorCode = `response_guard_${guardCategory}`;
            finalReply =
              replyLang === 'bn'
                ? 'আপনার অর্ডার সারাংশ তৈরি হয়েছে। অনুগ্রহ করে নিচের Order Summary কার্ডটি যাচাই করে **অর্ডার কনফার্ম করুন / Confirm Order** বাটনে ক্লিক করুন, অথবা পরিবর্তনের জন্য **Edit** চাপুন।'
                : 'Your Order Summary is ready below. Please review the details and click the Confirm Order button to submit, or click Edit to make changes.';
          } else {
            errorCode = `response_guard_${guardCategory}`;
            isUnanswered = true;
            await executeToolIdempotently('get_business_contact', {});
            finalReply =
              replyLang === 'bn'
                ? config.fallbackMessageBn ||
                  'দুঃখিত, এই তথ্যটা আমার কাছে নেই। সঠিক তথ্যের জন্য আমাদের কাস্টমার সাপোর্টের সঙ্গে যোগাযোগ করতে পারেন।'
                : config.fallbackMessageEn ||
                  "Sorry, I don't have verified information about that. Please contact our customer support team.";
          }
        }
      }
    }
  } catch (err) {
    activePath = 'fallback';
    activeModelUsed = 'live-fallback-engine';
    isError = true;
    isUnanswered = true;
    const classified = classifyGeminiError(err);
    const safeFallback = runValidatedFallback(classified.code, true);
    finalReply = safeFallback.replyText;
    errorCode = safeFallback.errorCode || classified.code;
    if (safeFallback.guardCategory) {
      guardCategory = safeFallback.guardCategory;
    }
  }

  if (runtimeCtx.errorCode && !errorCode) {
    errorCode = runtimeCtx.errorCode;
  }

  isUnanswered =
    isError ||
    isUnanswered ||
    detectUnansweredHeuristic(
      finalReply,
      config.fallbackMessageBn,
      config.fallbackMessageEn
    );

  // Attach interactive comparison product cards when helpful and no order summary is already shown
  if (
    !runtimeCtx.collectedProductCards &&
    !runtimeCtx.collectedOrderSummary &&
    !isError &&
    !isUnanswered &&
    intentClass.needsProductCards
  ) {
    runtimeCtx.collectedProductCards = buildProductComparisonCards(
      settings,
      activeDraft?.weight || '500g'
    );
  }

  const latencyMs = Date.now() - startedAt;
  const estimatedCostUsd = estimateGeminiCostUsd(totalPromptTokens, totalOutputTokens);
  const sessionToSave = buildInitialSessionDoc(sessionId, sessionState.session, {
    replyLang,
    explicitSwitchRequested,
    scriptPreference,
    intent: runtimeCtx.detectedIntent,
    orderDraftId: activeDraft?.draftId,
  });

  const [, logId] = await Promise.all([
    recordPersistentDailyCost(bstDate, {
      costUsd: estimatedCostUsd,
      promptTokens: totalPromptTokens,
      outputTokens: totalOutputTokens,
      capUsd: dailyCostCapUsd,
    }),
    createServerChatLog({
      sessionId,
      lang: detectedInputLang,
      userMessage: lastUserMessage,
      assistantReply: finalReply,
      intent: runtimeCtx.detectedIntent,
      isUnanswered,
      isError,
      handoverRequested: runtimeCtx.handoverTriggered,
      latencyMs,
      promptTokens: totalPromptTokens,
      outputTokens: totalOutputTokens,
      estimatedCostUsd,
      errorCode,
      guardCategory,
      retryCount,
      toolCallCount,
      finishReason: lastFinishReason,
      factsVersion: facts.factsVersion,
      isTestPlayground,
      path: activePath,
      model: activeModelUsed,
      ragMs,
      modelMs,
      toolMs,
      ragSources: ragResult.sources.map((s) => `${s.sourceType}:${s.id}`).slice(0, 8),
      confidence: intentClass.confidence,
    }),
    saveSessionAndDraft({ session: sessionToSave, draft: activeDraft }),
  ]);

  const diagnostics: ChatDiagnosticsMeta = {
    intent: runtimeCtx.detectedIntent,
    confidence: intentClass.confidence,
    model: activeModelUsed,
    path: activePath,
    toolsUsed,
    sources: ragResult.sources,
    guardStatus: guardCategory || 'passed',
    ragMs,
    modelMs,
    toolMs,
    totalMs: latencyMs,
    promptTokens: totalPromptTokens,
    outputTokens: totalOutputTokens,
    estimatedCostUsd,
    streamedRealTokens,
    factsVersion: facts.factsVersion,
  };

  console.info(
    JSON.stringify({
      event: 'chatbot_timing',
      path: activePath,
      model: activeModelUsed,
      intent: runtimeCtx.detectedIntent,
      confidence: intentClass.confidence,
      ragMs,
      modelMs,
      toolMs,
      totalMs: latencyMs,
      retryCount,
      toolCallCount,
      failoverReason: failoverReason || null,
      guardCategory: guardCategory || null,
      factsVersion: facts.factsVersion,
    })
  );

  return ndjsonReply(
    {
      text: finalReply,
      actions: runtimeCtx.collectedActions,
      orderSummary: runtimeCtx.collectedOrderSummary,
      productCards: runtimeCtx.collectedProductCards,
      trackingCard: runtimeCtx.collectedTrackingCard,
      suggestedReplies: buildContextualSuggestedReplies(
        intentClass.intent,
        replyLang,
        activeDraft
      ),
      sources: ragResult.sources,
      diagnostics,
      logId,
      lockedLang: sessionToSave.lockedLang,
      intent: runtimeCtx.detectedIntent,
      path: activePath,
      model: activeModelUsed,
      isError,
      errorCode,
      factsVersion: facts.factsVersion,
    },
    rateCheck.setCookieHeader
  );
}
