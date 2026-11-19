import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { GoogleGenAI } from '@google/genai';
import { POST as chatPost } from '../app/api/chat/route';
import { DELETE as sessionDelete, GET as sessionGet } from '../app/api/chat/session/route';
import { SESSION_COOKIE_NAME, signSessionCookieValue } from '../src/lib/chatbot/sessionAuth';
import { POST as feedbackPost } from '../app/api/chatbot/feedback/route';
import { POST as parseDocPost } from '../app/api/chatbot/parse-doc/route';
import { classifyDomainRequest } from '../src/lib/chatbot/domain-guard';
import {
  setChatLogObserverForTests,
  setCostLedgerOverrideForTests,
  setFeedbackMemoryObserverForTests,
  setFirestoreHealthOverrideForTests,
  setKnowledgeChunkTestStore,
  setRateLimitMemoryModeForTests,
  setSessionDraftMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import {
  CURATED_PRODUCT_KNOWLEDGE_PACK,
  buildOverlappingChunks,
  runHybridKnowledgeSearch,
} from '../src/lib/chatbot/hybridRag';
import {
  buildProductComparisonCards,
  classifyTurnIntent,
  recommendJarVariant,
} from '../src/lib/chatbot/intentRouter';
import {
  validateChatRequestPayload,
  validateFeedbackPayload,
  validateModelSelection,
} from '../src/lib/chatbot/schema';
import { detectLanguageAndSignals } from '../src/lib/chatbot/security';
import {
  applySlotsToOrderDraft,
  extractOrderSlotsFromText,
  getMissingOrderDraftFields,
} from '../src/lib/chatbot/sessionStore';
import {
  DEFAULT_CHATBOT_CONFIG,
  type ChatbotFaqDoc,
  type ChatbotFeedbackDoc,
  type KnowledgeChunkRecord,
} from '../src/lib/chatbot/types';
import {
  clearGeminiHealthCacheForTests,
  setGeminiClientFactoryForTests,
} from '../src/lib/gemini/client';
import { DEFAULT_STORE_SETTINGS } from '../src/lib/storeTypes';

const ORIGINAL_ENV = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  ORDER_TOKEN_SECRET: process.env.ORDER_TOKEN_SECRET,
};
const REAL_FETCH = globalThis.fetch;

function installTestFetchStub(adminEmail = 'kinboni.bd@gmail.com') {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('identitytoolkit.googleapis.com/v1/accounts:lookup')) {
      return new Response(
        JSON.stringify({
          users: [
            {
              localId: 'uid_admin_test',
              email: adminEmail,
              emailVerified: true,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('firestore.googleapis.com')) {
      return new Response(JSON.stringify({ error: { code: 404 } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return REAL_FETCH(input);
  }) as typeof fetch;
}

async function parseNdjsonResponse(res: Response): Promise<{
  status: number;
  text: string;
  deltas: string[];
  meta: Record<string, unknown> | null;
}> {
  const raw = await res.text();
  const deltas: string[] = [];
  let meta: Record<string, unknown> | null = null;
  for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const ev = JSON.parse(line) as Record<string, unknown>;
    if (ev.type === 'delta' && typeof ev.text === 'string') {
      deltas.push(ev.text);
    } else if (ev.type === 'meta') {
      meta = ev;
    }
  }
  return { status: res.status, text: deltas.join(''), deltas, meta };
}

describe('Phase 1 — Hybrid RAG, Session Slots, Intent Router, Guards, Streaming & Feedback', () => {
  beforeEach(() => {
    installTestFetchStub();
    clearGeminiHealthCacheForTests();
    setGeminiClientFactoryForTests(null);
    setChatLogObserverForTests(null);
    setFeedbackMemoryObserverForTests(null);
    setKnowledgeChunkTestStore(null);
    setCostLedgerOverrideForTests(null);
    setRateLimitMemoryModeForTests(true);
    setSessionDraftMemoryModeForTests(true);
    setFirestoreHealthOverrideForTests(async () => ({
      reachable: true,
      latencyMs: 5,
      detail: 'mock',
    }));
  });

  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
    process.env.GEMINI_API_KEY = ORIGINAL_ENV.GEMINI_API_KEY;
    process.env.GEMINI_MODEL = ORIGINAL_ENV.GEMINI_MODEL;
    process.env.ORDER_TOKEN_SECRET = ORIGINAL_ENV.ORDER_TOKEN_SECRET;
    clearGeminiHealthCacheForTests();
    setGeminiClientFactoryForTests(null);
    setChatLogObserverForTests(null);
    setFeedbackMemoryObserverForTests(null);
    setKnowledgeChunkTestStore(null);
    setCostLedgerOverrideForTests(null);
    setRateLimitMemoryModeForTests(false);
    setSessionDraftMemoryModeForTests(false);
    setFirestoreHealthOverrideForTests(null);
  });

  it('parse-doc rejects spoofed PDF magic bytes and binary TXT null payloads, while structuring valid CSV & overlapping chunks', async () => {
    // 1. Spoofed PDF (.pdf with Windows MZ bytes)
    const spoofedFile = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03])], 'fake.pdf', {
      type: 'application/pdf',
    });
    const formBadPdf = new FormData();
    formBadPdf.append('file', spoofedFile);
    const badPdfRes = await parseDocPost(
      new Request('http://localhost:3000/api/chatbot/parse-doc', {
        method: 'POST',
        headers: {
          'x-requested-with': 'DeshiGeeStorefront',
          Authorization: 'Bearer test_valid_admin_token_1234567890',
        },
        body: formBadPdf,
      })
    );
    assert.equal(badPdfRes.status, 400);

    // 2. Binary null-byte payload disguised as .txt
    const binaryTxt = new File([new Uint8Array([0x41, 0x42, 0x00, 0x43])], 'virus.txt', {
      type: 'text/plain',
    });
    const formBadTxt = new FormData();
    formBadTxt.append('file', binaryTxt);
    const badTxtRes = await parseDocPost(
      new Request('http://localhost:3000/api/chatbot/parse-doc', {
        method: 'POST',
        headers: {
          'x-requested-with': 'DeshiGeeStorefront',
          Authorization: 'Bearer test_valid_admin_token_1234567890',
        },
        body: formBadTxt,
      })
    );
    assert.equal(badTxtRes.status, 400);

    // 3. Valid CSV formatted into structured Entry rows + SHA-256 hash + chunks
    const csvContent =
      'Topic,Detail\nPabna Bilona,Hand-churned in wooden bilona from cultured dahi\nStorage Guide,Keep sealed in cool dry cabinet without fridge';
    const csvFile = new File([csvContent], 'deshi-faq.csv', { type: 'text/csv' });
    const formCsv = new FormData();
    formCsv.append('file', csvFile);
    const okRes = await parseDocPost(
      new Request('http://localhost:3000/api/chatbot/parse-doc', {
        method: 'POST',
        headers: {
          'x-requested-with': 'DeshiGeeStorefront',
          Authorization: 'Bearer test_valid_admin_token_1234567890',
        },
        body: formCsv,
      })
    );
    assert.equal(okRes.status, 200);
    const payload = (await okRes.json()) as {
      ok: boolean;
      sourceType: string;
      content: string;
      contentHash: string;
      chunkCount: number;
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.sourceType, 'csv');
    assert.match(payload.content, /Entry 1: Topic: Pabna Bilona/);
    assert.ok(payload.contentHash.length >= 16);
    assert.ok(payload.chunkCount >= 1);

    // 4. Overlapping chunks split long docs smoothly
    const longDoc = `# Heading A\n${'Pabna grass-fed bilona cow ghee craft paragraph. '.repeat(45)}\n\n# Heading B\n${'Clear glass jar storage instructions away from heat. '.repeat(35)}`;
    const chunks = buildOverlappingChunks(longDoc, { targetChars: 1500, overlapChars: 200 });
    assert.ok(chunks.length >= 2);
    assert.ok(chunks[0].tokenEstimate > 10);
  });

  it('Hybrid RAG achieves >= 90% top-3 relevance across Bangla/Banglish/English paraphrase queries, excludes internal docs, and reports noVerifiedMatch honestly', async () => {
    const seededFaqs: ChatbotFaqDoc[] = CURATED_PRODUCT_KNOWLEDGE_PACK.map((item, idx) => ({
      id: `curated_${idx + 1}`,
      ...item,
    }));
    const storedChunks: KnowledgeChunkRecord[] = [
      {
        id: 'pub_c0',
        docId: 'pub_1',
        title: 'Pabna Fermentation & Storage Guide',
        category: 'Craft & Storage',
        chunkIndex: 0,
        sectionHeading: 'Storage',
        text: 'Store Pabna bilona ghee sealed tightly with a clean dry spoon at room temperature. Shelf life is 12 months. Do not put wet spoons inside.',
        tokenEstimate: 30,
        contentHash: 'hash_pub_1',
        language: 'both',
        status: 'published',
        accessScope: 'public',
      },
      {
        id: 'internal_c0',
        docId: 'int_1',
        title: 'Internal Margin Formula',
        category: 'Internal Finance',
        chunkIndex: 0,
        sectionHeading: 'Margins',
        text: 'Secret supplier cost per kg and internal profit margin calculation formula.',
        tokenEstimate: 20,
        contentHash: 'hash_int_1',
        language: 'en',
        status: 'published',
        accessScope: 'internal',
      },
    ];

    const benchmark: { query: string; expectedCat: string }[] = [
      { query: 'Can I cook halua or polao at high heat with Deshi Gee?', expectedCat: 'Cooking & Usage' },
      { query: 'Paratha ar khichuri ranna kora jabe?', expectedCat: 'Cooking & Usage' },
      { query: 'Why are there danadar crystals in winter inside the jar?', expectedCat: 'Texture & Climate' },
      { query: 'শীতকালে ঘি দানা বাঁধে কেন আর গরমে গলে যায় কেন?', expectedCat: 'Texture & Climate' },
      { query: 'Do you pack in plastic or glass jars?', expectedCat: 'Packaging & Quality' },
      { query: 'কাঁচের বয়াম নাকি প্লাস্টিক পাত্রে দেন?', expectedCat: 'Packaging & Quality' },
      { query: 'Which jar size should I buy for a first time trial?', expectedCat: 'Size Recommendation' },
      { query: 'কোন সাইজ নেব? ২৫০ গ্রাম নাকি ৫০০ গ্রাম?', expectedCat: 'Size Recommendation' },
      { query: 'How long is the shelf life and should I use a dry spoon?', expectedCat: 'Craft & Storage' },
      { query: 'ঘি কতদিন ভালো থাকে আর সংরক্ষণ করব কীভাবে?', expectedCat: 'Craft & Storage' },
      { query: 'Is 1kg better value for regular cooking and gift?', expectedCat: 'Size Recommendation' },
      { query: 'Is liquid melted ghee in summer normal?', expectedCat: 'Texture & Climate' },
      { query: 'high smoke point for shallow frying paratha', expectedCat: 'Cooking & Usage' },
      { query: 'airtight tamper seal clear apothecary glass jar', expectedCat: 'Packaging & Quality' },
      { query: 'Pabna bilona shelf life room temperature', expectedCat: 'Craft & Storage' },
    ];

    let hits = 0;
    for (const item of benchmark) {
      const res = await runHybridKnowledgeSearch({
        query: item.query,
        faqs: seededFaqs,
        kbDocs: [],
        storedChunks,
        replyLang: /[\u0980-\u09FF]/.test(item.query) ? 'bn' : 'en',
        synonyms: DEFAULT_CHATBOT_CONFIG.synonyms,
      });
      const top3Cats = res.sources.slice(0, 3).map((s) => s.category);
      if (top3Cats.includes(item.expectedCat)) {
        hits += 1;
      }
    }
    const accuracy = hits / benchmark.length;
    assert.ok(accuracy >= 0.9, `Expected >= 90% Top-3 RAG accuracy, got ${(accuracy * 100).toFixed(1)}%`);

    // Internal doc exclusion check
    const internalQuery = await runHybridKnowledgeSearch({
      query: 'internal supplier cost profit margin formula',
      faqs: seededFaqs,
      kbDocs: [],
      storedChunks,
      replyLang: 'en',
      synonyms: DEFAULT_CHATBOT_CONFIG.synonyms,
    });
    assert.equal(internalQuery.sources.some((s) => s.title.includes('Internal Margin')), false);

    // Zero hallucination check on unrelated domain term
    const unsupported = await runHybridKnowledgeSearch({
      query: 'cryptocurrency bitcoin mining',
      faqs: seededFaqs,
      kbDocs: [],
      storedChunks,
      replyLang: 'en',
    });
    assert.equal(unsupported.noVerifiedMatch, true);
  });

  it('Language behavior supports all 6 modes + sessionLockedLang + explicit switch', () => {
    assert.equal(
      detectLanguageAndSignals('Hello, price?', 'always_bn', 'en').replyLang,
      'bn'
    );
    assert.equal(
      detectLanguageAndSignals('ghee er dam koto?', 'mirror', 'en').replyLang,
      'bn'
    );
    assert.equal(
      detectLanguageAndSignals('Price of 500g jar?', 'customer_choice', 'bn').replyLang,
      'bn'
    );
    assert.equal(
      detectLanguageAndSignals('Price of 500g jar?', 'customer_choice', 'en').replyLang,
      'en'
    );
    const switchEn = detectLanguageAndSignals('ghee er dam koto, in English please', 'auto', 'bn');
    assert.equal(switchEn.explicitSwitchRequested, 'en');
    assert.equal(switchEn.replyLang, 'en');

    // Persisted lock overrides uiLang/auto until explicit switch
    const lockedTurn = detectLanguageAndSignals('dam koto vai?', 'auto', 'bn', 'en');
    assert.equal(lockedTurn.replyLang, 'en');
  });

  it('Order slot extraction handles Bengali digits, area/district, MFS TxnID, quote invalidation & domain continuation', () => {
    assert.equal(classifyDomainRequest('Uttara sector 7 house 12', true).category, 'allowed_ghee');

    const slot1 = extractOrderSlotsFromText('৫০০ গ্রাম ২টি জার, উত্তরা, ঢাকা, নাম করিম, 01711-223344');
    assert.equal(slot1.weight, '500g');
    assert.equal(slot1.qty, 2);
    assert.equal(slot1.district, 'Dhaka');
    assert.ok(slot1.area === 'উত্তরা' || slot1.area?.toLowerCase() === 'uttara');
    assert.equal(slot1.phone, '01711223344');

    const { draft: d1 } = applySlotsToOrderDraft({
      sessionId: 'sess_slot_test',
      currentDraft: null,
      extracted: {
        weight: '500g',
        qty: 1,
        customerName: 'Karim Uddin',
        phone: '01711223344',
        district: 'Dhaka',
        area: 'Uttara',
        address: 'Sector 7 Road 2 House 12',
        paymentMethod: 'cod',
      },
      settings: DEFAULT_STORE_SETTINGS,
    });
    assert.equal(getMissingOrderDraftFields(d1).length, 0);
    assert.equal(d1.state, 'quote_ready');

    // Attach mock prior summary, then change qty -> must invalidate lastSummary & bump priceQuoteVersion
    d1.lastSummary = {
      productName: 'Deshi Gee',
      weight: '500g',
      qty: 1,
      unitPriceBdt: 1290,
      subtotalBdt: 1290,
      deliveryFeeBdt: 80,
      discountBdt: 0,
      totalBdt: 1370,
      priceQuoteVersion: d1.priceQuoteVersion,
    };
    const { draft: d2, quoteInvalidated } = applySlotsToOrderDraft({
      sessionId: 'sess_slot_test',
      currentDraft: d1,
      extracted: { qty: 2 },
      settings: DEFAULT_STORE_SETTINGS,
    });
    assert.equal(quoteInvalidated, true);
    assert.equal(d2.lastSummary, undefined);
    assert.ok(d2.priceQuoteVersion > d1.priceQuoteVersion);

    // Explicit cancel
    const { draft: cancelled } = applySlotsToOrderDraft({
      sessionId: 'sess_slot_test',
      currentDraft: d2,
      extracted: { cancelOrderRequested: true },
      settings: DEFAULT_STORE_SETTINGS,
    });
    assert.equal(cancelled.state, 'cancelled');
  });

  it('Intent router scopes tool declarations and variant recommender handles stock fallbacks & cards', () => {
    const pricingIntent = classifyTurnIntent('What is the price of 500g?');
    assert.equal(pricingIntent.intent, 'pricing');
    assert.equal(pricingIntent.needsProductCards, true);
    assert.equal(pricingIntent.allowedToolNames.includes('prepare_order_summary'), false);

    const craftIntent = classifyTurnIntent('How is bilona makkhan ghee prepared?');
    assert.equal(craftIntent.canStreamSafely, true);

    const rec = recommendJarVariant(
      { preferredWeight: '250g' },
      { ...DEFAULT_STORE_SETTINGS, stock250g: 0 }
    );
    assert.equal(rec.recommendedWeight, '500g');
    assert.equal(rec.alternativeWeight, '500g');
    assert.ok(rec.shortfallForFreeDeliveryBdt > 0);

    const cards = buildProductComparisonCards(DEFAULT_STORE_SETTINGS, '500g');
    assert.equal(cards.length, 3);
    assert.equal(cards.find((c) => c.weight === '500g')?.recommended, true);
  });

  it('Schema validators enforce model allowlists, chat payload rules & feedback fields', () => {
    assert.equal(validateModelSelection('gemini-4-hydrogen').valid, true);
    assert.equal(validateModelSelection('gemini-unknown-99').valid, false);
    assert.equal(validateChatRequestPayload({ messages: [] }).ok, false);
    assert.equal(
      validateChatRequestPayload({
        mode: 'published',
        uiLang: 'en',
        messages: [{ role: 'user', text: 'Price?' }],
      }).ok,
      true
    );
    assert.equal(
      validateFeedbackPayload({ sessionId: 'dg_12345', rating: 'down', reason: 'wrong_price' }).ok,
      true
    );
    assert.equal(validateFeedbackPayload({ sessionId: 'ab', rating: 'maybe' }).ok, false);
  });

  it('/api/chat streams real progressive deltas safely on prose craft turns AND blocks unapproved claims mid-stream', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKeyValue1234567890';
    process.env.GEMINI_MODEL = 'gemini-4-hydrogen';

    // 1. Safe craft query streams real chunks incrementally
    setGeminiClientFactoryForTests(() => ({
      models: {
        generateContentStream: async function* () {
          yield {
            text: 'Deshi Gee is made in Pabna by culturing fresh cow milk in clay pots ',
            candidates: [{ finishReason: undefined }],
          };
          yield {
            text: 'and hand-churning with a wooden bilona before slow clarification.',
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 110, candidatesTokenCount: 28 },
          };
        },
        generateContent: async () => ({
          text: 'fallback',
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 },
        }),
      },
    }) as unknown as GoogleGenAI);

    const streamRes = await chatPost(
      new Request('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          'x-forwarded-for': '103.50.11.10',
        },
        body: JSON.stringify({
          mode: 'published',
          uiLang: 'en',
          sessionId: 'stream_ok_1',
          messages: [{ role: 'user', text: 'How is Pabna bilona ghee prepared?' }],
        }),
      })
    );
    const parsedOk = await parseNdjsonResponse(streamRes);
    assert.equal(parsedOk.status, 200);
    assert.ok(parsedOk.deltas.length >= 2);
    assert.equal(
      (parsedOk.meta?.diagnostics as Record<string, unknown> | undefined)?.streamedRealTokens,
      true
    );

    // 2. Unapproved claim ("organic", "cures diabetes") triggers buffered holdback & response guard block
    setGeminiClientFactoryForTests(() => ({
      models: {
        generateContentStream: async function* () {
          yield {
            text: 'Deshi Gee is 100% certified organic and cures diabetes!',
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 18 },
          };
        },
        generateContent: async () => ({
          text: 'Deshi Gee is certified organic and cures diabetes.',
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 18 },
        }),
      },
    }) as unknown as GoogleGenAI);

    const blockedRes = await chatPost(
      new Request('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          'x-forwarded-for': '103.50.11.11',
        },
        body: JSON.stringify({
          mode: 'published',
          uiLang: 'en',
          sessionId: 'stream_block_1',
          messages: [{ role: 'user', text: 'Tell me about Pabna bilona quality.' }],
        }),
      })
    );
    const parsedBlocked = await parseNdjsonResponse(blockedRes);
    assert.equal(parsedBlocked.status, 200);
    assert.equal(parsedBlocked.text.toLowerCase().includes('cures diabetes'), false);
    assert.equal(parsedBlocked.text.toLowerCase().includes('certified organic'), false);
  });

  it('Session lockedLang persists across turns, /api/chat/session restores & clears drafts, and /api/chatbot/feedback records ratings', async () => {
    delete process.env.GEMINI_API_KEY;
    setKnowledgeChunkTestStore([]);

    // Turn 1: Banglish query with explicit English switch + 500g order slot
    const t1 = await parseNdjsonResponse(
      await chatPost(
        new Request('http://localhost:3000/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
            'x-forwarded-for': '103.50.12.1',
          },
          body: JSON.stringify({
            mode: 'published',
            uiLang: 'bn',
            sessionId: 'sess_phase1_flow',
            messages: [
              { role: 'user', text: 'I want to order 500g jar, reply in English please' },
            ],
          }),
        })
      )
    );
    assert.equal(t1.status, 200);
    assert.equal(t1.meta?.lockedLang, 'en');

    // GET /api/chat/session verifies persisted session & active draft (with signed HttpOnly session cookie)
    const phase1Cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(signSessionCookieValue('sess_phase1_flow'))}`;
    const getRes = await sessionGet(
      new Request('http://localhost:3000/api/chat/session?sessionId=sess_phase1_flow', {
        headers: { Cookie: phase1Cookie },
      })
    );
    assert.equal(getRes.status, 200);
    const sessData = (await getRes.json()) as {
      session: { lockedLang: string } | null;
      orderDraft: { weight: string } | null;
    };
    assert.equal(sessData.session?.lockedLang, 'en');
    assert.equal(sessData.orderDraft?.weight, '500g');

    // Turn 2: Banglish message keeps English reply due to session lockedLang='en'
    const t2 = await parseNdjsonResponse(
      await chatPost(
        new Request('http://localhost:3000/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
            'x-forwarded-for': '103.50.12.1',
          },
          body: JSON.stringify({
            mode: 'published',
            uiLang: 'bn',
            sessionId: 'sess_phase1_flow',
            messages: [
              { role: 'user', text: 'I want to order 500g jar, reply in English please' },
              { role: 'assistant', text: t1.text },
              { role: 'user', text: 'ghee er dam koto?' },
            ],
          }),
        })
      )
    );
    assert.equal(t2.status, 200);
    assert.equal(t2.meta?.lockedLang, 'en');
    assert.equal(/[\u0980-\u09FF]/.test(t2.text.replace(/৳/g, '')), false);

    // Feedback submission endpoint
    const recordedFeedback: ChatbotFeedbackDoc[] = [];
    setFeedbackMemoryObserverForTests((fb) => recordedFeedback.push(fb));
    const fbRes = await feedbackPost(
      new Request('http://localhost:3000/api/chatbot/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          sessionId: 'sess_phase1_flow',
          logId: 'log_123',
          rating: 'down',
          reason: 'unclear',
          userMessage: 'ghee er dam koto?',
          assistantReply: t2.text,
          lang: 'en',
          intent: 'pricing',
        }),
      })
    );
    assert.equal(fbRes.status, 200);
    assert.equal(recordedFeedback.length, 1);
    assert.equal(recordedFeedback[0].reason, 'unclear');

    // DELETE /api/chat/session cancels active draft (with signed HttpOnly session cookie)
    const delRes = await sessionDelete(
      new Request('http://localhost:3000/api/chat/session?sessionId=sess_phase1_flow', {
        method: 'DELETE',
        headers: {
          'x-requested-with': 'DeshiGeeStorefront',
          Cookie: phase1Cookie,
        },
      })
    );
    assert.equal(delRes.status, 200);
    const getAfter = await sessionGet(
      new Request('http://localhost:3000/api/chat/session?sessionId=sess_phase1_flow', {
        headers: { Cookie: phase1Cookie },
      })
    );
    const afterJson = (await getAfter.json()) as { orderDraft: unknown };
    assert.equal(afterJson.orderDraft, null);
  });
});
