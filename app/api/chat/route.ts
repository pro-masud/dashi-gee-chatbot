import { type Content } from '@google/genai';
import {
  CHATBOT_BUILD_CONFIG,
  getOptionalDailyCostCapUsd,
} from '../../../src/lib/chatbot/build-config';
import {
  classifyDomainRequest,
  stripUnsafeHtml,
} from '../../../src/lib/chatbot/domain-guard';
import {
  checkAndIncrementFirestoreRateLimit,
  createServerChatLog,
  fetchServerBatchRecord,
  fetchServerChatbotConfig,
  fetchServerChatbotFaqs,
  fetchServerChatbotKbDocs,
  fetchServerStoreSettings,
  verifyServerAdminToken,
} from '../../../src/lib/chatbot/firestoreRest';
import {
  detectLanguageAndSignals,
  detectPromptInjection,
  detectSensitiveSecret,
  getTodayBstDateKey,
  retrieveRelevantKnowledge,
} from '../../../src/lib/chatbot/security';
import type { ChatActionItem, OrderSummaryCard } from '../../../src/lib/chatbot/types';
import { generateLiveFallbackReply } from '../../../src/lib/chatbot/liveFallbackEngine';
import {
  FALLBACK_GEMINI_MODEL,
  classifyGeminiError,
  createGeminiClient,
  estimateGeminiCostUsd,
  getGeminiModelName,
  isGeminiApiKeyConfigured,
} from '../../../src/lib/gemini/client';
import { validateGeminiResponse } from '../../../src/lib/gemini/response-guard';
import { buildSystemPrompt } from '../../../src/lib/gemini/system-instructions';
import {
  CHATBOT_FUNCTION_DECLARATIONS,
  type ToolRuntimeContext,
  executeChatbotTool,
} from '../../../src/lib/gemini/tools';

interface IncomingMessage {
  role: 'user' | 'assistant';
  text: string;
}

const globalCostTracker = globalThis as unknown as {
  __deshiGeeDailyCostTracker?: { dateKey: string; totalUsd: number };
};

function trackAndCheckDailyCostCap(addedUsd = 0): boolean {
  const cap = getOptionalDailyCostCapUsd();
  const today = getTodayBstDateKey();
  if (
    !globalCostTracker.__deshiGeeDailyCostTracker ||
    globalCostTracker.__deshiGeeDailyCostTracker.dateKey !== today
  ) {
    globalCostTracker.__deshiGeeDailyCostTracker = { dateKey: today, totalUsd: 0 };
  }
  if (addedUsd > 0) {
    globalCostTracker.__deshiGeeDailyCostTracker.totalUsd += addedUsd;
  }
  if (cap === null) return false;
  return globalCostTracker.__deshiGeeDailyCostTracker.totalUsd >= cap;
}

function detectUnansweredHeuristic(reply: string, fallbackBn: string, fallbackEn: string): boolean {
  const r = reply.toLowerCase();
  return (
    r.includes(fallbackBn.toLowerCase().slice(0, 22)) ||
    r.includes(fallbackEn.toLowerCase().slice(0, 26)) ||
    r.includes('এই তথ্যটা আমার কাছে নেই') ||
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

function streamNdjsonReply(payload: {
  text: string;
  actions?: ChatActionItem[];
  orderSummary?: OrderSummaryCard;
  intent?: string;
  isError?: boolean;
  errorCode?: string;
}): Response {
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
      controller.enqueue(
        encoder.encode(
          `${JSON.stringify({
            type: 'meta',
            actions: payload.actions || [],
            orderSummary: payload.orderSummary || null,
            intent: payload.intent || 'general',
            isError: Boolean(payload.isError),
            errorCode: payload.errorCode || '',
          })}\n`
        )
      );
      controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'done' })}\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return Response.json({ error: 'Invalid request origin header.' }, { status: 403 });
  }

  // 1. Enforce 10 KB max body size
  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (Buffer.byteLength(rawBody, 'utf8') > CHATBOT_BUILD_CONFIG.MAX_BODY_BYTES) {
    return Response.json(
      { error: 'Request payload exceeds 10 KB limit.' },
      { status: 413 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody || '{}') as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Malformed JSON body.' }, { status: 400 });
  }

  const mode: 'published' | 'draft' = body.mode === 'draft' ? 'draft' : 'published';
  const uiLang: 'en' | 'bn' = body.uiLang === 'bn' ? 'bn' : 'en';
  const sessionId =
    stripUnsafeHtml(String(body.sessionId || 'sess_anon'), 64) || 'sess_anon';

  const rawMessages = Array.isArray(body.messages) ? (body.messages as IncomingMessage[]) : [];
  if (rawMessages.length > CHATBOT_BUILD_CONFIG.SESSION_MAX_MESSAGES) {
    const limitMsg =
      uiLang === 'bn'
        ? 'এই চ্যাট সেশনের সর্বোচ্চ ৪০টি মেসেজের সীমা পূর্ণ হয়েছে। অনুগ্রহ করে নতুন চ্যাট শুরু করুন অথবা আমাদের সাপোর্টে যোগাযোগ করুন।'
        : 'This chat session reached the 40-message limit. Please clear conversation to start fresh or contact support.';
    return Response.json({ error: limitMsg }, { status: 429 });
  }

  const rawLastUser = [...rawMessages].reverse().find((m) => m.role === 'user')?.text || '';
  const strippedLastRaw = stripUnsafeHtml(String(rawLastUser), 1200);
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

  // Only keep the last MAX_CONTEXT_MESSAGES (10) turns
  const messages = rawMessages
    .slice(-CHATBOT_BUILD_CONFIG.MAX_CONTEXT_MESSAGES)
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      text: stripUnsafeHtml(String(m.text || ''), CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS),
    }))
    .filter((m) => m.text.length > 0);

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.text || '';

  // Verify admin authorization if requesting Draft Playground mode
  const authHeader = request.headers.get('authorization');
  let adminToken = '';
  let isTestPlayground = Boolean(body.isTestPlayground);
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

  const [config, settings] = await Promise.all([
    fetchServerChatbotConfig(mode, adminToken),
    fetchServerStoreSettings(),
  ]);

  if (mode === 'published' && (!config.enabled || config.maintenanceMode)) {
    const msg = uiLang === 'bn' ? config.maintenanceMessageBn : config.maintenanceMessageEn;
    return streamNdjsonReply({ text: msg, intent: 'maintenance' });
  }

  // 2. Persistent Firestore rate limits (IP/min=15, IP/day=100, Global/day=2000)
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || sessionId;
  const bstDate = getTodayBstDateKey();
  const dailyCap = Math.min(
    CHATBOT_BUILD_CONFIG.DAILY_MESSAGE_CAP,
    Number(config.dailyRequestLimit || CHATBOT_BUILD_CONFIG.DAILY_MESSAGE_CAP)
  );

  const [ipMinCheck, ipDayCheck, globalDayCheck] = await Promise.all([
    checkAndIncrementFirestoreRateLimit(
      `chat_ip_min_${clientIp}`,
      CHATBOT_BUILD_CONFIG.IP_PER_MIN,
      60_000
    ),
    checkAndIncrementFirestoreRateLimit(
      `chat_ip_day_${clientIp}_${bstDate}`,
      CHATBOT_BUILD_CONFIG.IP_PER_DAY,
      24 * 60 * 60 * 1000
    ),
    checkAndIncrementFirestoreRateLimit(
      `chat_global_day_${bstDate}`,
      dailyCap,
      24 * 60 * 60 * 1000
    ),
  ]);

  if (!ipMinCheck.allowed || !ipDayCheck.allowed) {
    const rateMsg =
      uiLang === 'bn'
        ? 'এই মুহূর্তে অনেক অনুরোধ পাঠানো হয়েছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন অথবা WhatsApp-এ যোগাযোগ করুন।'
        : 'Too many messages right now. Please wait a moment and try again or reach us on WhatsApp.';
    return Response.json({ error: rateMsg }, { status: 429 });
  }

  const { detectedInputLang, replyLang } = detectLanguageAndSignals(
    lastUserMessage,
    config.languageBehavior,
    uiLang
  );

  // Switch gracefully to contact mode if global daily cap or optional Gemini cost cap is reached
  if (!globalDayCheck.allowed || trackAndCheckDailyCostCap(0)) {
    const capCtx: ToolRuntimeContext = {
      sessionId,
      replyLang,
      settings,
      config,
      batch: await fetchServerBatchRecord(settings.activeBatchCode),
      faqs: [],
      kbDocs: [],
      isTestPlayground,
      collectedActions: [],
      orderState: 'collecting_details',
      handoverTriggered: false,
      detectedIntent: 'global_cap_fallback',
      verifiedMonetaryAmounts: new Set(),
    };
    await executeChatbotTool('get_business_contact', {}, capCtx);
    const capMsg =
      replyLang === 'bn'
        ? 'আজকের চ্যাট লিমিট পূর্ণ হয়েছে। সরাসরি অর্ডার বা সহায়তার জন্য নিচের ফোন ও WhatsApp বাটন ব্যবহার করুন।'
        : 'Daily assistant limit reached. Please use the Phone or WhatsApp buttons below to reach our team directly.';
    return streamNdjsonReply({
      text: capMsg,
      actions: capCtx.collectedActions,
      intent: 'global_cap_fallback',
    });
  }

  // 3. Shield 1: Never allow PIN / OTP / Card / Password capture
  if (detectSensitiveSecret(lastUserMessage)) {
    const shieldReply =
      replyLang === 'bn'
        ? 'নিরাপত্তার স্বার্থে কখনোই আপনার bKash/Nagad PIN, OTP, কার্ড নম্বর বা পাসওয়ার্ড এখানে শেয়ার করবেন না। পেমেন্ট যাচাইয়ের জন্য শুধু Transaction ID দিন অথবা সাপোর্টে যোগাযোগ করুন।'
        : 'For your security, please never share your bKash/Nagad PIN, OTP, card number, or password here. Only a Transaction ID (TxnID) is needed for bKash/Nagad orders.';

    await createServerChatLog({
      sessionId,
      lang: detectedInputLang,
      userMessage: '[REDACTED_SENSITIVE_INPUT]',
      assistantReply: shieldReply,
      intent: 'security_credential_shield',
      isUnanswered: false,
      handoverRequested: false,
      latencyMs: Date.now() - startedAt,
      promptTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      errorCode: 'sensitive_secret_blocked',
      isTestPlayground,
    });
    return streamNdjsonReply({ text: shieldReply, intent: 'security_credential_shield' });
  }

  // 4. Shield 2: Prompt injection defense
  if (detectPromptInjection(lastUserMessage)) {
    const injectionReply =
      replyLang === 'bn'
        ? 'দুঃখিত, আমি শুধু Deshi Gee এবং আমাদের খাঁটি পাবনার ঘি নিয়ে সাহায্য করতে পারি। দাম, সাইজ অথবা অর্ডার নিয়ে কিছু জানতে চান?'
        : 'Sorry, I can only assist with Deshi Gee — our Pabna cow ghee, prices, delivery, and customer support. How can I help you today?';

    await createServerChatLog({
      sessionId,
      lang: detectedInputLang,
      userMessage: lastUserMessage,
      assistantReply: injectionReply,
      intent: 'prompt_injection_blocked',
      isUnanswered: false,
      handoverRequested: false,
      latencyMs: Date.now() - startedAt,
      promptTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      errorCode: 'prompt_injection_blocked',
      isTestPlayground,
    });
    return streamNdjsonReply({ text: injectionReply, intent: 'prompt_injection_blocked' });
  }

  // 5. Shield 3: Backend Domain Guard (Pure off-topic refusal + Mixed-question isolation)
  const hasActiveOrderContext = messages
    .slice(0, -1)
    .some((m) => /(size|sizes|weight|weights|সাইজ|ওজন|250g|500g|1kg|অর্ডার|order|address|ঠিকানা|phone|নম্বর)/i.test(m.text));
  const domainCheck = classifyDomainRequest(lastUserMessage, hasActiveOrderContext);

  if (domainCheck.category === 'disallowed_off_topic') {
    const domainReply =
      replyLang === 'bn'
        ? 'দুঃখিত, আমি শুধু Deshi Gee এবং আমাদের পণ্য নিয়ে সাহায্য করতে পারি। দাম, সাইজ অথবা অর্ডার নিয়ে কিছু জানতে চান?'
        : 'Sorry, I can only help with Deshi Gee, our product, and customer support. Would you like to know about our ghee or ordering process?';

    await createServerChatLog({
      sessionId,
      lang: detectedInputLang,
      userMessage: lastUserMessage,
      assistantReply: domainReply,
      intent: 'off_topic_refusal',
      isUnanswered: false,
      handoverRequested: false,
      latencyMs: Date.now() - startedAt,
      promptTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      errorCode: 'domain_guard_blocked',
      isTestPlayground,
    });
    return streamNdjsonReply({ text: domainReply, intent: 'off_topic_refusal' });
  }

  // Prepare sanitized last user prompt (if mixed_question, ONLY Deshi Gee clauses go to Gemini)
  const effectiveMessages = messages.map((m, idx) =>
    idx === messages.length - 1 && m.role === 'user'
      ? { ...m, text: domainCheck.filteredPromptForGemini }
      : m
  );

  const includeDraftKnowledge = mode === 'draft';
  const [batch, faqs, kbDocs] = await Promise.all([
    fetchServerBatchRecord(settings.activeBatchCode),
    fetchServerChatbotFaqs(includeDraftKnowledge, adminToken),
    fetchServerChatbotKbDocs(includeDraftKnowledge, adminToken),
  ]);

  const { faqs: matchedFaqs, kbSnippets } = retrieveRelevantKnowledge(
    domainCheck.filteredPromptForGemini,
    faqs,
    kbDocs,
    replyLang,
    6
  );

  const runtimeCtx: ToolRuntimeContext = {
    sessionId,
    replyLang,
    settings,
    config,
    batch,
    faqs,
    kbDocs,
    isTestPlayground,
    collectedActions: [],
    orderState: 'collecting_details',
    handoverTriggered: false,
    detectedIntent: domainCheck.mixedNoticeNeeded ? 'mixed_domain_handled' : 'general',
    verifiedMonetaryAmounts: new Set<number>(),
  };

  // Intelligent Live Storefront fallback when GEMINI_API_KEY is not configured
  const ai = createGeminiClient();
  if (!ai || !isGeminiApiKeyConfigured()) {
    const fallbackResult = generateLiveFallbackReply({
      userMessage: lastUserMessage,
      replyLang,
      settings,
      batch,
      config,
      matchedFaqs,
    });

    await createServerChatLog({
      sessionId,
      lang: detectedInputLang,
      userMessage: lastUserMessage,
      assistantReply: fallbackResult.replyText,
      intent: fallbackResult.intent,
      isUnanswered: false,
      handoverRequested: false,
      latencyMs: Date.now() - startedAt,
      promptTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      errorCode: '',
      isTestPlayground,
    });

    return streamNdjsonReply({
      text: fallbackResult.replyText,
      actions: fallbackResult.actions,
      intent: fallbackResult.intent,
    });
  }

  let totalPromptTokens = 0;
  let totalOutputTokens = 0;
  let finalReply = '';
  let errorCode = '';
  let isError = false;

  async function runGeminiPass(correctiveHint?: string): Promise<string> {
    const systemInstruction = buildSystemPrompt({
      config,
      settings,
      batch,
      replyLang,
      matchedFaqs,
      matchedKbSnippets: kbSnippets,
      isMixedQuestion: domainCheck.mixedNoticeNeeded,
      correctiveHint,
    });

    const modelName = getGeminiModelName();
    let activeModel = modelName;
    const contents: Content[] = effectiveMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));

    let assembled = '';
    for (let round = 0; round < CHATBOT_BUILD_CONFIG.MAX_TOOL_CALLS_PER_TURN; round++) {
      let response;
      try {
        response = await generateWithTimeout(
          ai!.models.generateContent({
            model: activeModel,
            contents,
            config: {
              systemInstruction,
              temperature: CHATBOT_BUILD_CONFIG.GEMINI_TEMPERATURE,
              maxOutputTokens: CHATBOT_BUILD_CONFIG.GEMINI_MAX_OUTPUT_TOKENS,
              tools: [{ functionDeclarations: CHATBOT_FUNCTION_DECLARATIONS }],
            },
          }),
          CHATBOT_BUILD_CONFIG.GEMINI_TIMEOUT_MS
        );
      } catch (innerErr) {
        if (round === 0 && activeModel !== FALLBACK_GEMINI_MODEL) {
          activeModel = FALLBACK_GEMINI_MODEL;
          response = await generateWithTimeout(
            ai!.models.generateContent({
              model: activeModel,
              contents,
              config: {
                systemInstruction,
                temperature: CHATBOT_BUILD_CONFIG.GEMINI_TEMPERATURE,
                maxOutputTokens: CHATBOT_BUILD_CONFIG.GEMINI_MAX_OUTPUT_TOKENS,
                tools: [{ functionDeclarations: CHATBOT_FUNCTION_DECLARATIONS }],
              },
            }),
            CHATBOT_BUILD_CONFIG.GEMINI_TIMEOUT_MS
          );
        } else {
          throw innerErr;
        }
      }

      totalPromptTokens += response.usageMetadata?.promptTokenCount || 0;
      totalOutputTokens += response.usageMetadata?.candidatesTokenCount || 0;

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
        const result = await executeChatbotTool(
          call.name || '',
          (call.args as Record<string, unknown>) || {},
          runtimeCtx
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
    }
    return assembled;
  }

  try {
    finalReply = await runGeminiPass();

    // 6. MANDATORY PRE-SEND RESPONSE GUARD VALIDATION
    let guard = validateGeminiResponse({
      replyText: finalReply,
      replyLang,
      settings,
      config,
      verifiedMonetaryAmounts: Array.from(runtimeCtx.verifiedMonetaryAmounts),
      verifiedOrderTrackingStatus: runtimeCtx.verifiedOrderTrackingStatus,
      hasPreparedOrderSummary: Boolean(runtimeCtx.collectedOrderSummary),
      customerPhoneInTurn: runtimeCtx.customerPhoneInTurn,
      isMixedQuestion: domainCheck.mixedNoticeNeeded,
    });

    if (!guard.passed) {
      // Controlled single retry with corrective hint
      const retried = await runGeminiPass(guard.correctiveHint || guard.reason);
      const retryGuard = validateGeminiResponse({
        replyText: retried,
        replyLang,
        settings,
        config,
        verifiedMonetaryAmounts: Array.from(runtimeCtx.verifiedMonetaryAmounts),
        verifiedOrderTrackingStatus: runtimeCtx.verifiedOrderTrackingStatus,
        hasPreparedOrderSummary: Boolean(runtimeCtx.collectedOrderSummary),
        customerPhoneInTurn: runtimeCtx.customerPhoneInTurn,
        isMixedQuestion: domainCheck.mixedNoticeNeeded,
      });

      if (retryGuard.passed) {
        finalReply = retried;
      } else if (runtimeCtx.collectedOrderSummary) {
        errorCode = `response_guard_${retryGuard.errorCategory || 'blocked'}`;
        finalReply =
          replyLang === 'bn'
            ? 'আপনার অর্ডার সারাংশ তৈরি হয়েছে। অনুগ্রহ করে নিচের Order Summary কার্ডটি যাচাই করে **অর্ডার কনফার্ম করুন / Confirm Order** বাটনে ক্লিক করুন, অথবা পরিবর্তনের জন্য **Edit** চাপুন।'
            : 'Your Order Summary is ready below. Please review the details and click the Confirm Order button to submit, or click Edit to make changes.';
      } else {
        errorCode = `response_guard_${retryGuard.errorCategory || 'blocked'}`;
        await executeChatbotTool('get_business_contact', {}, runtimeCtx);
        finalReply =
          replyLang === 'bn'
            ? config.fallbackMessageBn ||
              'দুঃখিত, এই তথ্যটা আমার কাছে নেই। সঠিক তথ্যের জন্য আমাদের কাস্টমার সাপোর্টের সঙ্গে যোগাযোগ করতে পারেন।'
            : config.fallbackMessageEn ||
              "Sorry, I don't have verified information about that. Please contact our customer support team.";
      }
    }

    if (!finalReply) {
      finalReply =
        replyLang === 'bn' ? config.fallbackMessageBn : config.fallbackMessageEn;
    }
  } catch (err) {
    const fallback = generateLiveFallbackReply({
      userMessage: lastUserMessage,
      replyLang,
      settings,
      batch,
      config,
      matchedFaqs,
    });
    finalReply = fallback.replyText;
    for (const a of fallback.actions) {
      if (!runtimeCtx.collectedActions.some((x) => x.type === a.type && x.value === a.value)) {
        runtimeCtx.collectedActions.push(a);
      }
    }
    const classified = classifyGeminiError(err);
    errorCode = classified.code;
  }

  const isUnanswered =
    isError ||
    detectUnansweredHeuristic(
      finalReply,
      config.fallbackMessageBn,
      config.fallbackMessageEn
    );

  const latencyMs = Date.now() - startedAt;
  const estimatedCostUsd = estimateGeminiCostUsd(totalPromptTokens, totalOutputTokens);
  trackAndCheckDailyCostCap(estimatedCostUsd);

  await createServerChatLog({
    sessionId,
    lang: detectedInputLang,
    userMessage: lastUserMessage,
    assistantReply: finalReply,
    intent: runtimeCtx.detectedIntent,
    isUnanswered,
    handoverRequested: runtimeCtx.handoverTriggered,
    latencyMs,
    promptTokens: totalPromptTokens,
    outputTokens: totalOutputTokens,
    estimatedCostUsd,
    errorCode,
    isTestPlayground,
  });

  return streamNdjsonReply({
    text: finalReply,
    actions: runtimeCtx.collectedActions,
    orderSummary: runtimeCtx.collectedOrderSummary,
    intent: runtimeCtx.detectedIntent,
    isError,
    errorCode,
  });
}
