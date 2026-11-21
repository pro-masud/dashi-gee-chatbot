import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { GoogleGenAI } from '@google/genai';
import { GET as healthGet } from '../app/api/health/route';
import { POST as chatPost } from '../app/api/chat/route';
import {
  clearGeminiHealthCacheForTests,
  redactPotentialSecrets,
  setGeminiClientFactoryForTests,
  validateGeminiModelCapability,
} from '../src/lib/gemini/client';
import {
  setAdminAuthOverrideForTests,
  setChatLogObserverForTests,
  setCostLedgerOverrideForTests,
  setFirestoreHealthOverrideForTests,
  setRateLimitMemoryModeForTests,
  setSessionDraftMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import { setAdminSdkAvailableForTests } from '../src/lib/firebaseAdmin';

const ORIGINAL_ENV = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_FALLBACK_MODEL: process.env.GEMINI_FALLBACK_MODEL,
  ORDER_TOKEN_SECRET: process.env.ORDER_TOKEN_SECRET,
};

function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

async function parseNdjsonResponse(res: Response): Promise<{
  text: string;
  meta: Record<string, unknown> | null;
}> {
  const raw = await res.text();
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let text = '';
  let meta: Record<string, unknown> | null = null;
  for (const line of lines) {
    const ev = JSON.parse(line) as Record<string, unknown>;
    if (ev.type === 'delta' && typeof ev.text === 'string') {
      text += ev.text;
    } else if (ev.type === 'meta') {
      meta = ev;
    }
  }
  return { text, meta };
}

describe('T0.1 Gemini runtime configuration & health diagnostics', () => {
  beforeEach(() => {
    clearGeminiHealthCacheForTests();
    setGeminiClientFactoryForTests(null);
    setChatLogObserverForTests(() => {});
    setRateLimitMemoryModeForTests(true);
    setSessionDraftMemoryModeForTests(true);
    setCostLedgerOverrideForTests({
      get: async (dateKey: string) => ({
        dateKey,
        totalUsd: 0,
        requestCount: 0,
        promptTokens: 0,
        outputTokens: 0,
        capHit: false,
        source: 'fallback_memory',
      }),
      record: async (dateKey, add) => ({
        dateKey,
        totalUsd: add.costUsd,
        requestCount: 1,
        promptTokens: add.promptTokens,
        outputTokens: add.outputTokens,
        capHit: add.capUsd !== null && add.costUsd >= add.capUsd,
        source: 'fallback_memory',
      }),
    });
    setFirestoreHealthOverrideForTests(async () => ({
      reachable: true,
      latencyMs: 12,
      detail: 'Firestore mock reachable for test',
    }));
    setAdminSdkAvailableForTests(true);
  });

  afterEach(() => {
    restoreEnv();
    clearGeminiHealthCacheForTests();
    setGeminiClientFactoryForTests(null);
    setAdminAuthOverrideForTests(null);
    setAdminSdkAvailableForTests(null);
    setChatLogObserverForTests(null);
    setRateLimitMemoryModeForTests(false);
    setSessionDraftMemoryModeForTests(false);
    setCostLedgerOverrideForTests(null);
    setFirestoreHealthOverrideForTests(null);
  });

  it('validates supported vs deprecated models, tool declarations, thinking config, and output limits', () => {
    const valid25 = validateGeminiModelCapability('gemini-2.5-flash', {
      role: 'primary',
      functionDeclarationsCount: 13,
      maxOutputTokens: 1600,
    });
    assert.equal(valid25.configured, true);
    assert.equal(valid25.supported, true);
    assert.equal(valid25.supportsTools, true);
    assert.equal(valid25.thinkingConfig.supported, true);
    assert.equal(valid25.outputLimits.valid, true);
    assert.equal(valid25.sdkCompatible, true);

    const validGen4 = validateGeminiModelCapability('gemini-4-hydrogen', {
      role: 'primary',
      functionDeclarationsCount: 13,
      maxOutputTokens: 1600,
    });
    assert.equal(validGen4.supported, true);
    assert.equal(validGen4.thinkingConfig.status, 'ok');

    const deprecated20 = validateGeminiModelCapability('gemini-2.0-flash', {
      role: 'fallback',
      functionDeclarationsCount: 13,
    });
    assert.equal(deprecated20.supported, false);
    assert.equal(deprecated20.errorCode, 'gemini_model_deprecated');

    const deprecated15 = validateGeminiModelCapability('gemini-1.5-pro', {
      role: 'primary',
      functionDeclarationsCount: 13,
    });
    assert.equal(deprecated15.supported, false);
    assert.equal(deprecated15.errorCode, 'gemini_model_deprecated');
  });

  it('GET /api/health returns minimal redacted liveness payload for unauthenticated callers and ignores ?refresh=1', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.ORDER_TOKEN_SECRET;
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    process.env.GEMINI_FALLBACK_MODEL = 'gemini-2.0-flash';

    const res = await healthGet(new Request('http://localhost:3000/api/health?refresh=1'));
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;

    assert.equal(body.ok, true);
    assert.equal(body.status, 'degraded');
    assert.equal(typeof body.timestamp, 'string');
    assert.equal('checks' in body, false);
    assert.equal('activePath' in body, false);
    assert.equal('warnings' in body, false);
    assert.equal('errorCode' in body, false);
  });

  it('GET /api/health reports fallback diagnostics to authenticated admins without leaking secrets when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.ORDER_TOKEN_SECRET;
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    process.env.GEMINI_FALLBACK_MODEL = 'gemini-2.0-flash';
    setAdminAuthOverrideForTests(async () => ({ ok: true, email: 'kinboni.bd@gmail.com', uid: 'admin_health_1' }));

    const res = await healthGet(
      new Request('http://localhost:3000/api/health', {
        headers: { Authorization: 'Bearer test-admin-token' },
      })
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, any>;

    assert.equal(body.ok, true);
    assert.equal(body.status, 'degraded');
    assert.equal(body.activePath, 'fallback');
    assert.equal(body.errorCode, 'gemini_api_key_missing');
    assert.equal(body.checks.geminiApiKeyConfigured, 'no');
    assert.equal(body.checks.tokenSecretConfigured, 'no');
    assert.equal(body.checks.firestoreReachable, 'yes');
    assert.equal(body.checks.primaryModel.reachable, 'no');
    assert.equal(body.checks.primaryModel.supportsTools, true);
    assert.equal(body.checks.sdk.compatible, true);
    assert.equal(body.checks.sdk.functionDeclarationsCount, 26);
  });

  it('GET /api/health reports healthy Gemini reachability to authenticated admins and never leaks key/secret values', async () => {
    const fakeKey = 'AIzaSyTestSecretKeyValue1234567890';
    const fakeOrderSecret = 'super-secret-order-token-signing-key-32chars';
    process.env.GEMINI_API_KEY = fakeKey;
    process.env.ORDER_TOKEN_SECRET = fakeOrderSecret;
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    process.env.GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash-lite';
    setAdminAuthOverrideForTests(async () => ({ ok: true, email: 'kinboni.bd@gmail.com', uid: 'admin_health_2' }));

    setGeminiClientFactoryForTests(() => ({
      models: {
        get: async ({ model }: { model: string }) => ({
          name: `models/${model}`,
          displayName: `Mock ${model}`,
        }),
      },
    }) as unknown as GoogleGenAI);

    const res = await healthGet(
      new Request('http://localhost:3000/api/health?refresh=1', {
        headers: { Authorization: 'Bearer test-admin-token' },
      })
    );
    assert.equal(res.status, 200);
    const rawJson = await res.text();
    const body = JSON.parse(rawJson) as Record<string, any>;

    assert.equal(body.ok, true);
    assert.equal(body.status, 'healthy');
    assert.equal(body.activePath, 'gemini');
    assert.equal(body.checks.geminiApiKeyConfigured, 'yes');
    assert.equal(body.checks.tokenSecretConfigured, 'yes');
    assert.equal(body.checks.primaryModel.reachable, 'yes');
    assert.equal(body.checks.fallbackModel.reachable, 'yes');
    assert.equal(rawJson.includes(fakeKey), false);
    assert.equal(rawJson.includes(fakeOrderSecret), false);
    assert.equal(redactPotentialSecrets(`err with ${fakeKey}`).includes(fakeKey), false);
  });

  it('GET /api/health fails diagnostically with HTTP 503 when no supported model is configured (redacted for public, full for admin)', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKeyValue1234567890';
    process.env.GEMINI_MODEL = 'gemini-1.5-flash';
    process.env.GEMINI_FALLBACK_MODEL = 'gemini-2.0-flash';

    setGeminiClientFactoryForTests(() => ({
      models: {
        get: async () => {
          throw new Error('404 model not found');
        },
      },
    }) as unknown as GoogleGenAI);

    // Unauthenticated still gets HTTP 503 with redacted body
    const pubRes = await healthGet(new Request('http://localhost:3000/api/health'));
    assert.equal(pubRes.status, 503);
    const pubBody = (await pubRes.json()) as Record<string, any>;
    assert.equal(pubBody.ok, false);
    assert.equal(pubBody.status, 'unhealthy');
    assert.equal('errorCode' in pubBody, false);

    // Admin gets full diagnostic breakdown
    setAdminAuthOverrideForTests(async () => ({ ok: true, email: 'kinboni.bd@gmail.com', uid: 'admin_health_3' }));
    const adminRes = await healthGet(
      new Request('http://localhost:3000/api/health?refresh=1', {
        headers: { Authorization: 'Bearer test-admin-token' },
      })
    );
    assert.equal(adminRes.status, 503);
    const body = (await adminRes.json()) as Record<string, any>;

    assert.equal(body.ok, false);
    assert.equal(body.status, 'unhealthy');
    assert.equal(body.supportedModelConfigured, false);
    assert.equal(body.errorCode, 'no_supported_model_configured');
  });

  it('GET /api/health?refresh=1 rate-limits excessive admin refresh probes with HTTP 429', async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    const fixedUid = `admin_rl_${Date.now()}`;
    setAdminAuthOverrideForTests(async () => ({
      ok: true,
      email: 'kinboni.bd@gmail.com',
      uid: fixedUid,
    }));

    let lastStatus = 200;
    for (let i = 0; i < 7; i++) {
      const r = await healthGet(
        new Request('http://localhost:3000/api/health?refresh=1', {
          headers: { Authorization: 'Bearer test-admin-token' },
        })
      );
      lastStatus = r.status;
    }
    assert.equal(lastStatus, 429);
  });

  it('POST /api/chat logs path=fallback and errorCode=gemini_api_key_missing when key is unset', async () => {
    delete process.env.GEMINI_API_KEY;
    const capturedLogs: Record<string, unknown>[] = [];
    setChatLogObserverForTests((payload) => capturedLogs.push(payload));

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'DeshiGeeStorefront',
      },
      body: JSON.stringify({
        mode: 'published',
        uiLang: 'en',
        sessionId: 'test_sess_fallback_01',
        messages: [{ role: 'user', text: 'What jar sizes do you have?' }],
      }),
    });

    const res = await chatPost(req);
    assert.equal(res.status, 200);
    const { text, meta } = await parseNdjsonResponse(res);

    assert.ok(text.length > 10);
    assert.equal(meta?.path, 'fallback');
    assert.equal(meta?.errorCode, 'gemini_api_key_missing');
    assert.equal(capturedLogs.length, 1);
    assert.equal(capturedLogs[0].path, 'fallback');
    assert.equal(capturedLogs[0].errorCode, 'gemini_api_key_missing');
  });

  it('POST /api/chat logs path=gemini when a valid Gemini client responds cleanly', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKeyValue1234567890';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    const capturedLogs: Record<string, unknown>[] = [];
    setChatLogObserverForTests((payload) => capturedLogs.push(payload));

    setGeminiClientFactoryForTests(() => ({
      models: {
        generateContent: async () => ({
          text: 'Deshi Gee is crafted in Pabna using traditional wooden bilona churning and sealed in 250g, 500g, and 1kg glass jars.',
          usageMetadata: {
            promptTokenCount: 120,
            candidatesTokenCount: 28,
          },
          functionCalls: [],
        }),
      },
    }) as unknown as GoogleGenAI);

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'DeshiGeeStorefront',
      },
      body: JSON.stringify({
        mode: 'published',
        uiLang: 'en',
        sessionId: 'test_sess_gemini_01',
        messages: [{ role: 'user', text: 'How is Deshi Gee made?' }],
      }),
    });

    const res = await chatPost(req);
    assert.equal(res.status, 200);
    const { text, meta } = await parseNdjsonResponse(res);

    assert.ok(text.includes('Pabna'));
    assert.equal(meta?.path, 'gemini');
    assert.equal(meta?.model, 'gemini-2.5-flash');
    assert.equal(capturedLogs.length, 1);
    assert.equal(capturedLogs[0].path, 'gemini');
    assert.equal(capturedLogs[0].model, 'gemini-2.5-flash');
    assert.equal(capturedLogs[0].errorCode, '');
  });

  it('POST /api/chat falls back safely and logs path=fallback + diagnostic errorCode when Gemini throws', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKeyValue1234567890';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    const capturedLogs: Record<string, unknown>[] = [];
    setChatLogObserverForTests((payload) => capturedLogs.push(payload));

    setGeminiClientFactoryForTests(() => ({
      models: {
        generateContent: async () => {
          throw new Error('Gemini request timeout exceeded');
        },
      },
    }) as unknown as GoogleGenAI);

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'DeshiGeeStorefront',
      },
      body: JSON.stringify({
        mode: 'published',
        uiLang: 'en',
        sessionId: 'test_sess_gemini_err_01',
        messages: [{ role: 'user', text: 'Tell me about your delivery time' }],
      }),
    });

    const res = await chatPost(req);
    assert.equal(res.status, 200);
    const { text, meta } = await parseNdjsonResponse(res);

    assert.ok(text.length > 10);
    assert.equal(meta?.path, 'fallback');
    assert.equal(meta?.errorCode, 'gemini_timeout');
    assert.equal(capturedLogs.length, 1);
    assert.equal(capturedLogs[0].path, 'fallback');
    assert.equal(capturedLogs[0].errorCode, 'gemini_timeout');
  });

  it('POST /api/chat streaming greeting attaches abortSignal, omits unnecessary tools, and logs clean status=ok telemetry', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKeyValue1234567890';
    process.env.GEMINI_MODEL = 'gemini-4-hydrogen';
    const capturedInfoLines: string[] = [];
    const origInfo = console.info;
    console.info = (...args: unknown[]) => {
      capturedInfoLines.push(args.map((a) => String(a)).join(' '));
      origInfo(...args);
    };

    let sawAbortSignal = false;
    let sawToolsOnGreeting = false;
    try {
      setGeminiClientFactoryForTests(() => ({
        models: {
          generateContentStream: async ({ config }: { config?: { abortSignal?: AbortSignal; tools?: unknown[] } }) => {
            sawAbortSignal = Boolean(config?.abortSignal);
            sawToolsOnGreeting = Boolean(config?.tools && config.tools.length > 0);
            async function* gen() {
              yield {
                text: 'Assalamu Alaikum! Welcome to Deshi Gee. How can I help you today?',
                usageMetadata: { promptTokenCount: 410, candidatesTokenCount: 16 },
                candidates: [{ finishReason: 'STOP' }],
              };
            }
            return gen();
          },
        },
      }) as unknown as GoogleGenAI);

      const req = new Request('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          mode: 'published',
          uiLang: 'en',
          stream: true,
          sessionId: 'test_sess_stream_greet_01',
          messages: [{ role: 'user', text: 'hi' }],
        }),
      });

      const res = await chatPost(req);
      assert.equal(res.status, 200);
      const { text, meta } = await parseNdjsonResponse(res);
      assert.ok(text.includes('Deshi Gee'));
      assert.equal(meta?.path, 'gemini');
      assert.equal(sawAbortSignal, true);
      assert.equal(sawToolsOnGreeting, false);

      const turnLine = capturedInfoLines.find((line) => line.includes('"event":"chatbot_turn"'));
      assert.ok(turnLine);
      assert.equal(turnLine.includes('"status":"ok"'), true);
      assert.equal(/error/i.test(turnLine), false);
    } finally {
      console.info = origInfo;
    }
  });

  it('POST /api/chat streaming fails over cleanly to fallback model when primary stream times out before flushing', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKeyValue1234567890';
    process.env.GEMINI_MODEL = 'gemini-4-hydrogen';
    process.env.GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

    const calledModels: string[] = [];
    setGeminiClientFactoryForTests(() => ({
      models: {
        generateContentStream: async ({ model }: { model: string }) => {
          calledModels.push(`stream:${model}`);
          throw new Error('Gemini request timeout exceeded');
        },
        generateContent: async ({ model }: { model: string }) => {
          calledModels.push(`generate:${model}`);
          return {
            text: 'Welcome to Deshi Gee! Our artisanal Pabna bilona cow ghee is ready in 250g, 500g, and 1kg sealed glass jars.',
            usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 24 },
            candidates: [{ finishReason: 'STOP' }],
          };
        },
      },
    }) as unknown as GoogleGenAI);

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'DeshiGeeStorefront',
      },
      body: JSON.stringify({
        mode: 'published',
        uiLang: 'en',
        stream: true,
        sessionId: 'test_sess_stream_failover_01',
        messages: [{ role: 'user', text: 'hello' }],
      }),
    });

    const res = await chatPost(req);
    assert.equal(res.status, 200);
    const { text, meta } = await parseNdjsonResponse(res);
    assert.ok(text.includes('Deshi Gee'));
    assert.equal(meta?.path, 'gemini');
    assert.equal(meta?.model, 'gemini-3.1-flash-lite');
    assert.deepEqual(calledModels, [
      'stream:gemini-4-hydrogen',
      'generate:gemini-3.1-flash-lite',
    ]);
  });

  it('classifyGeminiError checks timeouts before numeric status codes and POST /api/chat fails over cleanly on round 1 after tool calls', async () => {
    const { classifyGeminiError } = await import('../src/lib/gemini/client');
    const { classifyTurnIntent } = await import('../src/lib/chatbot/intentRouter');

    assert.equal(
      classifyGeminiError(new Error('Model probe timeout after 4000ms')).code,
      'gemini_timeout'
    );
    assert.equal(
      classifyGeminiError({ status: 403, message: '403 PERMISSION_DENIED on model' }).shouldFailover,
      true
    );
    assert.equal(
      classifyGeminiError({ status: 401, message: '401 API_KEY_INVALID' }).shouldFailover,
      false
    );

    const contactIntent = classifyTurnIntent('আপনাদের যোগাযোগের ঠিকানা কী?');
    assert.ok(contactIntent.allowedToolNames.includes('get_business_contact'));
    assert.ok(contactIntent.allowedToolNames.length <= 4);

    process.env.GEMINI_API_KEY = 'AIzaSyTestSecretKeyValue1234567890';
    process.env.GEMINI_MODEL = 'gemini-4-hydrogen';
    process.env.GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

    const calls: string[] = [];
    setGeminiClientFactoryForTests(() => ({
      models: {
        generateContent: async ({ model }: { model: string }) => {
          calls.push(model);
          if (calls.length === 1) {
            return {
              functionCalls: [{ id: 'c1', name: 'get_business_contact', args: {} }],
              candidates: [
                {
                  finishReason: 'STOP',
                  content: {
                    role: 'model',
                    parts: [{ functionCall: { id: 'c1', name: 'get_business_contact', args: {} } }],
                  },
                },
              ],
              usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 12 },
            };
          }
          if (calls.length === 2 && model === 'gemini-4-hydrogen') {
            throw new Error('Gemini request timeout exceeded');
          }
          return {
            text: 'আপনি আমাদের পাবনা ও ঢাকা অফিসের ঠিকানা এবং সাপোর্টের জন্য নিচের ফোন ও WhatsApp বাটন ব্যবহার করতে পারেন।',
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 950, candidatesTokenCount: 30 },
          };
        },
      },
    }) as unknown as GoogleGenAI);

    const req = new Request('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'DeshiGeeStorefront',
      },
      body: JSON.stringify({
        mode: 'published',
        uiLang: 'bn',
        stream: false,
        sessionId: 'test_sess_round1_failover',
        messages: [{ role: 'user', text: 'আপনাদের যোগাযোগের ঠিকানা কী?' }],
      }),
    });

    const res = await chatPost(req);
    assert.equal(res.status, 200);
    const { text, meta } = await parseNdjsonResponse(res);
    assert.ok(text.includes('WhatsApp'));
    assert.equal(meta?.path, 'gemini');
    assert.equal(meta?.model, 'gemini-3.1-flash-lite');
    assert.deepEqual(calls, ['gemini-4-hydrogen', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']);
  });
});
