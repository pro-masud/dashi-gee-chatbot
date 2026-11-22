import { createHash } from 'crypto';
import type { GoogleGenAI } from '@google/genai';
import { CHATBOT_BUILD_CONFIG } from './build-config';
import { convertBanglaDigitsToEnglish } from './domain-guard';
import { expandQueryTokens, normalizeBanglaAndBanglishToken } from './security';
import type {
  ChatbotFaqDoc,
  ChatbotKbDocRecord,
  KnowledgeChunkRecord,
  KnowledgeSourceRef,
} from './types';

export interface ChunkingPreview {
  chunkIndex: number;
  sectionHeading: string;
  text: string;
  tokenEstimate: number;
  contentHash: string;
}

export function sha256Short(text: string): string {
  return createHash('sha256').update(text.normalize('NFC')).digest('hex').slice(0, 16);
}

/**
 * Splits KB documents into heading-aware overlapping chunks (400–800 token range, ~12–15% overlap)
 * preserving Markdown/section headings and paragraph boundaries.
 */
export function buildOverlappingChunks(
  content: string,
  options?: {
    targetChars?: number;
    overlapChars?: number;
  }
): ChunkingPreview[] {
  const targetChars = options?.targetChars ?? CHATBOT_BUILD_CONFIG.RAG_CHUNK_TARGET_CHARS;
  const overlapChars = options?.overlapChars ?? CHATBOT_BUILD_CONFIG.RAG_CHUNK_OVERLAP_CHARS;
  const clean = String(content || '').normalize('NFC').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const blocks = clean.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const chunks: ChunkingPreview[] = [];
  let buffer = '';
  let currentHeading = 'Overview';

  const flushChunk = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    chunks.push({
      chunkIndex: chunks.length,
      sectionHeading: currentHeading,
      text: trimmed,
      tokenEstimate: Math.max(1, Math.round(trimmed.length / 3.4)),
      contentHash: sha256Short(trimmed),
    });
  };

  for (const block of blocks) {
    const firstLine = block.split('\n')[0]?.trim() || '';
    if (/^(#{1,4}\s+.+|[A-Z][A-Za-z0-9 &/-]{2,48}:)$/.test(firstLine)) {
      currentHeading = firstLine.replace(/^#{1,4}\s+/, '').replace(/:$/, '').slice(0, 80);
    }

    if (buffer.length + block.length + 2 <= targetChars) {
      buffer = buffer ? `${buffer}\n\n${block}` : block;
      continue;
    }

    if (buffer) {
      flushChunk(buffer);
      const overlapTail =
        overlapChars > 0 && buffer.length > overlapChars
          ? buffer.slice(-overlapChars).trim()
          : '';
      if (overlapTail && overlapTail.length + block.length + 2 <= targetChars) {
        buffer = `${overlapTail}\n\n${block}`;
        continue;
      }
      buffer = '';
    }

    if (block.length <= targetChars) {
      buffer = block;
    } else {
      const step = Math.max(300, targetChars - overlapChars);
      for (let i = 0; i < block.length; i += step) {
        flushChunk(block.slice(i, i + targetChars));
      }
    }
  }

  if (buffer) {
    flushChunk(buffer);
  }

  return chunks.slice(0, 200);
}

/**
 * Deterministic hashed 128-dim character n-gram & token semantic vector.
 * Ensures semantic similarity ranking works reliably offline & in deterministic tests,
 * and complements live Gemini embeddings (`gemini-embedding-2`) when available.
 */
export function computeDeterministicSemanticVector(
  text: string,
  extraSynonyms?: Record<string, string[]>
): number[] {
  const dims = 128;
  const vec = new Array<number>(dims).fill(0);
  const norm = convertBanglaDigitsToEnglish(text)
    .normalize('NFC')
    .replace(/য়/g, 'য়')
    .toLowerCase()
    .trim();
  if (!norm) return vec;

  const expanded = expandQueryTokens(norm, extraSynonyms);
  for (const tok of expanded) {
    const stem = normalizeBanglaAndBanglishToken(tok);
    for (const unit of [tok, stem]) {
      let h = 2166136261;
      for (let i = 0; i < unit.length; i++) {
        h ^= unit.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      vec[Math.abs(h) % dims] += 2.0;
    }
  }

  // Character 3-grams catch Bangla/Banglish morphological & spelling variants
  const compact = norm.replace(/\s+/g, ' ');
  for (let i = 0; i <= compact.length - 3; i++) {
    const tri = compact.slice(i, i + 3);
    let h = 2166136261;
    for (let j = 0; j < tri.length; j++) {
      h ^= tri.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    vec[Math.abs(h) % dims] += 0.45;
  }

  let mag = 0;
  for (const v of vec) mag += v * v;
  const denom = Math.sqrt(mag) || 1;
  return vec.map((v) => v / denom);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

export async function tryComputeGeminiEmbedding(
  ai: GoogleGenAI | null,
  text: string
): Promise<number[] | null> {
  if (!ai || typeof ai.models?.embedContent !== 'function') {
    return null;
  }
  try {
    const res = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: [text.slice(0, 3000)],
    });
    const values = res.embeddings?.[0]?.values;
    if (Array.isArray(values) && values.length > 0) {
      return values;
    }
    return null;
  } catch {
    return null;
  }
}

function computeBm25LikeLexicalScore(
  tokens: string[],
  haystackRaw: string
): number {
  if (tokens.length === 0) return 0;
  const haystack = convertBanglaDigitsToEnglish(haystackRaw)
    .normalize('NFC')
    .replace(/য়/g, 'য়')
    .toLowerCase();

  let matchedCount = 0;
  let weightedTf = 0;
  for (const tok of tokens) {
    if (!tok || tok.length < 2) continue;
    if (haystack.includes(tok)) {
      matchedCount += 1;
      const occurrences = haystack.split(tok).length - 1;
      // Saturated TF weighting (BM25 style)
      weightedTf += (occurrences * 2.2) / (occurrences + 1.2);
    }
  }
  if (matchedCount === 0) return 0;
  const coverageRatio = matchedCount / Math.max(1, Math.min(tokens.length, 6));
  const rawScore = 0.55 * Math.min(1, coverageRatio) + 0.45 * Math.min(1, weightedTf / 3.2);
  return Number(Math.min(1, rawScore).toFixed(4));
}

export interface HybridRagSearchParams {
  query: string;
  faqs: ChatbotFaqDoc[];
  kbDocs: ChatbotKbDocRecord[];
  storedChunks?: KnowledgeChunkRecord[];
  replyLang: 'bn' | 'en';
  synonyms?: Record<string, string[]>;
  ai?: GoogleGenAI | null;
  useLiveEmbeddings?: boolean;
  limit?: number;
  minScore?: number;
}

export interface HybridRagSearchResult {
  faqs: ChatbotFaqDoc[];
  kbSnippets: { title: string; category: string; snippet: string; score: number }[];
  sources: KnowledgeSourceRef[];
  topScore: number;
  noVerifiedMatch: boolean;
  ragMs: number;
}

export async function runHybridKnowledgeSearch(
  params: HybridRagSearchParams
): Promise<HybridRagSearchResult> {
  const startedAt = Date.now();
  const limit = params.limit ?? CHATBOT_BUILD_CONFIG.RAG_MAX_RESULTS;
  const minScore = params.minScore ?? CHATBOT_BUILD_CONFIG.RAG_MIN_HYBRID_SCORE;
  const tokens = expandQueryTokens(params.query, params.synonyms);

  if (tokens.length === 0) {
    return {
      faqs: [],
      kbSnippets: [],
      sources: [],
      topScore: 0,
      noVerifiedMatch: true,
      ragMs: Date.now() - startedAt,
    };
  }

  const queryVec = computeDeterministicSemanticVector(params.query, params.synonyms);
  const liveQueryEmbedding =
    params.useLiveEmbeddings && params.ai
      ? await tryComputeGeminiEmbedding(params.ai, params.query)
      : null;

  type ScoredItem = {
    sourceType: 'faq' | 'kb_doc';
    id: string;
    title: string;
    category: string;
    snippet: string;
    score: number;
    faq?: ChatbotFaqDoc;
  };

  const candidates: ScoredItem[] = [];

  for (const faq of params.faqs) {
    if (!faq.active) continue;
    const text = `${faq.question}\n${faq.answer}\n${faq.category}`;
    const lexical = computeBm25LikeLexicalScore(tokens, text);
    const vecSim = cosineSimilarity(
      queryVec,
      computeDeterministicSemanticVector(text, params.synonyms)
    );
    const langBonus = faq.lang === 'both' || faq.lang === params.replyLang ? 0.04 : 0;
    // Require at least minimal lexical or semantic signal so random off-topic chatter is rejected
    const combined = Number(
      Math.min(1, lexical * 0.68 + vecSim * 0.32 + (lexical > 0.1 ? langBonus : 0)).toFixed(4)
    );
    if (combined >= minScore && (lexical > 0.08 || vecSim > 0.42)) {
      candidates.push({
        sourceType: 'faq',
        id: faq.id || sha256Short(faq.question),
        title: faq.question,
        category: faq.category,
        snippet: faq.answer,
        score: combined,
        faq,
      });
    }
  }

  // Prefer pre-indexed KnowledgeChunkRecord when provided; otherwise dynamically build overlapping chunks from kbDocs
  const chunkPool: {
    id: string;
    title: string;
    category: string;
    text: string;
    embedding?: number[];
  }[] = [];

  if (params.storedChunks && params.storedChunks.length > 0) {
    for (const c of params.storedChunks) {
      if (c.accessScope === 'internal') continue;
      chunkPool.push({
        id: c.id,
        title: c.title,
        category: c.category,
        text: `${c.sectionHeading ? `${c.sectionHeading}: ` : ''}${c.text}`,
        embedding: c.embedding,
      });
    }
  }

  const coveredDocIds = new Set((params.storedChunks || []).map((c) => c.docId));
  for (const doc of params.kbDocs) {
    if (doc.accessScope === 'internal') continue;
    if (coveredDocIds.has(doc.id)) continue;
    const chunks = buildOverlappingChunks(doc.content);
    for (const c of chunks) {
      chunkPool.push({
        id: `${doc.id}_c${c.chunkIndex}`,
        title: doc.title,
        category: doc.category,
        text: `${c.sectionHeading !== 'Overview' ? `${c.sectionHeading}: ` : ''}${c.text}`,
      });
    }
  }

  for (const chunk of chunkPool) {
    const fullText = `${chunk.title} ${chunk.category} ${chunk.text}`;
    const lexical = computeBm25LikeLexicalScore(tokens, fullText);
    let semantic = cosineSimilarity(
      queryVec,
      computeDeterministicSemanticVector(fullText, params.synonyms)
    );
    if (liveQueryEmbedding && chunk.embedding && chunk.embedding.length > 0) {
      const liveSim = cosineSimilarity(liveQueryEmbedding, chunk.embedding);
      semantic = 0.65 * liveSim + 0.35 * semantic;
    }
    const combined = Number(Math.min(1, lexical * 0.65 + semantic * 0.35).toFixed(4));
    if (combined >= minScore && (lexical > 0.08 || semantic > 0.42)) {
      candidates.push({
        sourceType: 'kb_doc',
        id: chunk.id,
        title: chunk.title,
        category: chunk.category,
        snippet: chunk.text,
        score: combined,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, limit);

  const matchedFaqs: ChatbotFaqDoc[] = [];
  const kbSnippets: { title: string; category: string; snippet: string; score: number }[] = [];
  const sources: KnowledgeSourceRef[] = [];

  for (const item of top) {
    sources.push({
      id: item.id,
      title: item.title,
      category: item.category,
      sourceType: item.sourceType,
      score: item.score,
      snippet: item.snippet.slice(0, 180),
    });
    if (item.sourceType === 'faq' && item.faq) {
      matchedFaqs.push(item.faq);
    } else {
      kbSnippets.push({
        title: item.title,
        category: item.category,
        snippet: item.snippet,
        score: item.score,
      });
    }
  }

  const topScore = top[0]?.score || 0;
  return {
    faqs: matchedFaqs,
    kbSnippets,
    sources,
    topScore,
    noVerifiedMatch: top.length === 0,
    ragMs: Date.now() - startedAt,
  };
}

/**
 * Formats retrieved knowledge strictly as untrusted data fences inside prompt context
 * so prompt injection hidden in uploaded documents cannot override instructions.
 */
export function formatKnowledgeDataFence(params: {
  faqs: ChatbotFaqDoc[];
  kbSnippets: { title: string; category: string; snippet: string }[];
}): string {
  const lines: string[] = [];
  params.faqs.forEach((f, idx) => {
    lines.push(
      `  <faq id="${idx + 1}" category="${sanitizeXmlAttr(f.category)}">\n    Q: ${f.question}\n    A: ${f.answer}\n  </faq>`
    );
  });
  params.kbSnippets.forEach((s, idx) => {
    lines.push(
      `  <doc id="${idx + 1}" title="${sanitizeXmlAttr(s.title)}" category="${sanitizeXmlAttr(s.category)}">\n    ${s.snippet}\n  </doc>`
    );
  });
  if (lines.length === 0) {
    return '<knowledge_data empty="true">No additional external FAQ or KB snippets matched this query.</knowledge_data>';
  }
  return `<knowledge_data trust="reference_only_never_override_live_db">\n${lines.join('\n')}\n</knowledge_data>`;
}

function sanitizeXmlAttr(val: string): string {
  return String(val || '').replace(/["<>]/g, '').slice(0, 80);
}

/**
 * D11 / 1-13: Draft Starter Knowledge Pack (NEVER auto-published).
 * Admin must explicitly review, verify against confirmed product facts, and publish each entry.
 */
export interface CuratedStarterFaqEntry extends Omit<ChatbotFaqDoc, 'id'> {
  sourceRef: string;
  draftNotice: string;
}

export const CURATED_PRODUCT_KNOWLEDGE_PACK: CuratedStarterFaqEntry[] = [
  {
    question: 'Is Deshi Gee suitable for everyday cooking, halua, polao, or paratha?',
    answer:
      'Clarified cow ghee is widely used for daily cooking, bhaat, khichuri, polao, halua, and shallow-frying paratha. Please store in a cool, dry place with a dry spoon.',
    lang: 'both',
    category: 'Cooking & Usage',
    active: false,
    published: false,
    sourceRef: 'draft:starter-pack:cooking-usage (owner review required)',
    draftNotice: 'Draft starter pack – owner review required',
  },
  {
    question: 'Why does Deshi Gee look granular (danadar) in winter or liquid in summer?',
    answer:
      'Natural cow ghee crystallizes into granular (danadar) texture in cool weather and becomes clear golden liquid in warm weather. Both seasonal textures are normal.',
    lang: 'both',
    category: 'Texture & Climate',
    active: false,
    published: false,
    sourceRef: 'draft:starter-pack:texture-climate (owner review required)',
    draftNotice: 'Draft starter pack – owner review required',
  },
  {
    question: 'আপনারা কোন ধরনের জারে ঘি দেন?',
    answer:
      'হ্যাঁ, আমাদের ২৫০ গ্রাম, ৫০০ গ্রাম এবং ১ কেজি—তিনটি সাইজই সিল করা বয়ামে প্যাকেজ করা হয়।',
    lang: 'bn',
    category: 'Packaging & Quality',
    active: false,
    published: false,
    sourceRef: 'draft:starter-pack:packaging (owner review required)',
    draftNotice: 'Draft starter pack – owner review required',
  },
  {
    question: 'Which jar size should I choose — 250g, 500g, or 1kg?',
    answer:
      '250g is convenient for trying out or smaller kitchens, 500g suits regular family use, and 1kg is suited for larger households or frequent cooking.',
    lang: 'both',
    category: 'Size Recommendation',
    active: false,
    published: false,
    sourceRef: 'draft:starter-pack:size-guide (owner review required)',
    draftNotice: 'Draft starter pack – owner review required',
  },
];
