/**
 * Deshi Gee 100-Concurrent Mock Chat Load Test (Stage 6.4)
 *
 * Fires 100 concurrent mock requests against POST /api/chat across rotating
 * synthetic IPs and sessions (memory-only, zero live Firestore writes, zero live Gemini calls).
 * Reports success count, 429 rate-limit count, error count, and p50/p95/max latency.
 */
import { POST as chatPost } from '../app/api/chat/route';
import {
  setChatLogObserverForTests,
  setInventoryMemoryModeForTests,
  setOrderStorageMemoryModeForTests,
  setRateLimitMemoryModeForTests,
  setSessionDraftMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import { setGeminiClientFactoryForTests } from '../src/lib/gemini/client';
import { TEST_CONFIRMED_STORE_SETTINGS } from '../tests/helpers/testStoreFixture';

const CONCURRENCY = 100;
const PROMPTS = [
  '৫০০ গ্রাম ঘির দাম কত?',
  'ঢাকার বাইরে ডেলিভারি চার্জ কত?',
  '250g, 500g, 1kg prices please',
  'Cash on delivery available?',
  'আমি ১ কেজি ঘি অর্ডার করতে চাই',
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(1));
}

async function main() {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DESHI_GEE_TEST_MODE: '1',
    ORDER_TOKEN_SECRET: 'load_test_secret_min_32_characters_value_00001',
  });
  delete process.env.GEMINI_API_KEY;

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('firestore.googleapis.com')) {
      return new Response(JSON.stringify({ writeResults: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return realFetch(input);
  }) as typeof fetch;

  setGeminiClientFactoryForTests(() => null);
  setChatLogObserverForTests(() => {});
  setInventoryMemoryModeForTests({ ...TEST_CONFIRMED_STORE_SETTINGS });
  setOrderStorageMemoryModeForTests(true);
  setSessionDraftMemoryModeForTests(true);
  setRateLimitMemoryModeForTests(true);

  const startedAll = performance.now();
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, i) => {
      const prompt = PROMPTS[i % PROMPTS.length];
      const reqStart = performance.now();
      try {
        const res = await chatPost(
          new Request('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-requested-with': 'DeshiGeeStorefront',
              'x-forwarded-for': `103.99.${Math.floor(i / 20) + 1}.${(i % 20) + 1}`,
            },
            body: JSON.stringify({
              sessionId: `load_sess_${i}`,
              uiLang: i % 2 === 0 ? 'bn' : 'en',
              messages: [{ role: 'user', text: prompt }],
            }),
          })
        );
        await res.text();
        return {
          status: res.status,
          latencyMs: performance.now() - reqStart,
          error: res.status >= 500,
        };
      } catch {
        return {
          status: 500,
          latencyMs: performance.now() - reqStart,
          error: true,
        };
      }
    })
  );

  const totalWallMs = Number((performance.now() - startedAll).toFixed(1));
  const okCount = results.filter((r) => r.status === 200).length;
  const rateLimitedCount = results.filter((r) => r.status === 429).length;
  const errorCount = results.filter((r) => r.error || (r.status !== 200 && r.status !== 429)).length;
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);

  const report = {
    mode: 'mock',
    concurrency: CONCURRENCY,
    totalWallMs,
    okCount,
    rateLimitedCount,
    errorCount,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    maxMs: percentile(latencies, 100),
    pass: errorCount === 0 && okCount + rateLimitedCount === CONCURRENCY,
  };

  console.log(JSON.stringify(report, null, 2));

  setGeminiClientFactoryForTests(null);
  setInventoryMemoryModeForTests(null);
  setOrderStorageMemoryModeForTests(false);
  setSessionDraftMemoryModeForTests(false);
  setRateLimitMemoryModeForTests(false);

  if (!report.pass) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
