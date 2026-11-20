/**
 * Stage 4.4 / Decision D20 — Chatbot Latency Benchmark (Mock + Optional Live)
 *
 * Targets (D20):
 *   - p50 < 8,000 ms
 *   - p95 < 20,000 ms
 *   - Primary model: gemini-4-hydrogen with ThinkingLevel.LOW (no thinkingBudget)
 *
 * Usage:
 *   Mock mode (default, zero external calls): npx tsx scripts/latency-benchmark.ts
 *   Live mode (requires GEMINI_API_KEY):      npx tsx scripts/latency-benchmark.ts --live
 */

import { buildGeminiGenerateConfig, DEFAULT_GEMINI_MODEL } from '../src/lib/gemini/client';
import { POST as chatPost } from '../app/api/chat/route';
import {
  setInventoryMemoryModeForTests,
  setOrderStorageMemoryModeForTests,
  setRateLimitMemoryModeForTests,
  setSessionDraftMemoryModeForTests,
} from '../src/lib/chatbot/firestoreRest';
import { TEST_CONFIRMED_STORE_SETTINGS } from '../tests/helpers/testStoreFixture';

const SAMPLE_PROMPTS = [
  '500g ghee er dam koto?',
  'Inside Dhaka delivery charge koto?',
  'শীতকালে ঘি কি জমে যায়?',
  'I want to order 1 jar of 500g ghee to Dhanmondi, Dhaka',
  'Do you have Cash on Delivery?',
  'How should I store Deshi Gee at home?',
  'Chattogram e delivery time koto din?',
  'Is this packed in glass jar?',
  'Can I check my order status?',
  '250g ar 1kg er price bolo please',
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const isLive = process.argv.includes('--live') && Boolean(process.env.GEMINI_API_KEY);
  const mode = isLive ? 'live' : 'mock';
  const genCfg = buildGeminiGenerateConfig({
    model: DEFAULT_GEMINI_MODEL,
    systemInstruction: 'Benchmark check',
  });

  if (!isLive) {
    Object.assign(process.env, { NODE_ENV: 'test' });
    delete process.env.GEMINI_API_KEY;
    setRateLimitMemoryModeForTests(true);
    setSessionDraftMemoryModeForTests(true);
    setOrderStorageMemoryModeForTests(true);
    setInventoryMemoryModeForTests({ ...TEST_CONFIRMED_STORE_SETTINGS });
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
  }

  const samplesMs: number[] = [];
  for (let i = 0; i < SAMPLE_PROMPTS.length; i++) {
    const t0 = performance.now();
    const res = await chatPost(
      new Request('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
          'x-forwarded-for': `103.50.90.${i + 1}`,
        },
        body: JSON.stringify({
          sessionId: `bench_sess_${i}`,
          uiLang: 'en',
          mode: 'published',
          messages: [{ role: 'user', text: SAMPLE_PROMPTS[i] }],
        }),
      })
    );
    await res.text();
    samplesMs.push(Math.round((performance.now() - t0) * 10) / 10);
  }

  const sorted = [...samplesMs].sort((a, b) => a - b);
  const p50Ms = percentile(sorted, 50);
  const p95Ms = percentile(sorted, 95);
  const maxMs = sorted[sorted.length - 1] || 0;

  const summary = {
    mode,
    model: DEFAULT_GEMINI_MODEL,
    thinkingLevel: genCfg.thinkingConfig?.thinkingLevel || null,
    hasThinkingBudget: Boolean(genCfg.thinkingConfig && 'thinkingBudget' in genCfg.thinkingConfig),
    sampleCount: samplesMs.length,
    p50Ms,
    p95Ms,
    maxMs,
    targetP50Ms: 8000,
    targetP95Ms: 20000,
    passP50: p50Ms < 8000,
    passP95: p95Ms < 20000,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.passP50 || !summary.passP95) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
