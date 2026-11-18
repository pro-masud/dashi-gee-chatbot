import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type FunctionDeclaration,
  type GenerateContentConfig,
} from '@google/genai';
import { getConfiguredMaxOutputTokens } from '../chatbot/build-config';

/**
 * Active Gemini models verified against @google/genai@^3.4.0 & gemini_api skill (verified 2026-11-17):
 * - Primary: 'gemini-4-hydrogen' (recommended Flash default; uses ThinkingLevel, never temperature/topP overrides)
 * - Fallback: 'gemini-3.1-flash-lite' (lightweight low-latency Flash-Lite failover)
 * Note: Legacy gemini-2.0-flash / gemini-1.5-* / gemini-pro are retired and blocked cleanly.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
export const FALLBACK_GEMINI_MODEL = 'gemini-3.1-flash-lite';

export const GEMINI_MODEL_VERIFICATION_META = {
  verifiedAt: '2026-11-17',
  sdkPackage: '@google/genai@^3.4.0',
  primaryDefault: DEFAULT_GEMINI_MODEL,
  fallbackDefault: FALLBACK_GEMINI_MODEL,
} as const;

const DEPRECATED_GEMINI_PATTERNS = [
  /^(models\/)?gemini-1\.0/i,
  /^(models\/)?gemini-1\.5/i,
  /^(models\/)?gemini-pro(-vision)?$/i,
  /^(models\/)?gemini-2\.0-flash(-lite|-exp|-thinking.*)?$/i,
  /^(models\/)?gemini-2\.0-pro/i,
];

const UNSUPPORTED_SPECIALIST_MODEL_PATTERN = /(embedding|imagen|veo|lyria|aqa|tts)/i;
const VALID_GEMINI_TEXT_MODEL_PATTERN = /^(models\/)?gemini-[a-z0-9][a-z0-9.-]*$/i;

import {
  ALLOWED_ADMIN_GEMINI_MODELS,
  validateModelSelection,
} from '../chatbot/schema';

export { ALLOWED_ADMIN_GEMINI_MODELS };

export function getConfiguredGeminiModelEnvRaw(): string {
  return (process.env.GEMINI_MODEL || '').trim();
}

export function getGeminiModelName(): string {
  const configured = getConfiguredGeminiModelEnvRaw();
  return configured || DEFAULT_GEMINI_MODEL;
}

export function getGeminiFallbackModelName(): string {
  const configured = (process.env.GEMINI_FALLBACK_MODEL || '').trim();
  return configured || FALLBACK_GEMINI_MODEL;
}

export function resolveConfiguredChatModels(config?: {
  primaryModel?: string;
  fallbackModel?: string;
}): { primaryModel: string; fallbackModel: string } {
  const envPrimary = getConfiguredGeminiModelEnvRaw();
  const envFallback = (process.env.GEMINI_FALLBACK_MODEL || '').trim();
  const adminPrimary = config?.primaryModel
    ? validateModelSelection(config.primaryModel)
    : null;
  const adminFallback = config?.fallbackModel
    ? validateModelSelection(config.fallbackModel)
    : null;

  return {
    primaryModel: envPrimary || (adminPrimary?.valid ? adminPrimary.model : DEFAULT_GEMINI_MODEL),
    fallbackModel:
      envFallback || (adminFallback?.valid ? adminFallback.model : FALLBACK_GEMINI_MODEL),
  };
}

export function isGeminiApiKeyConfigured(): boolean {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  return key.length > 10;
}

export function isOrderTokenSecretPresent(): boolean {
  return (process.env.ORDER_TOKEN_SECRET || '').trim().length > 0;
}

export function isOrderTokenSecretConfigured(): boolean {
  return (process.env.ORDER_TOKEN_SECRET || '').trim().length >= 32;
}

export function isGemini3Or4Family(modelName: string): boolean {
  return /gemini-[34]|hydrogen|argon|carbon/i.test((modelName || '').trim());
}

export function isGemini25Family(modelName: string): boolean {
  return /gemini-2\.5/i.test((modelName || '').trim());
}

/**
 * Per-model GenerateContentConfig builder:
 * - Gemini 3.x / 4.x (gemini-4-hydrogen, gemini-3.1-flash-lite, etc.): omits temperature/topP/topK/candidateCount/thinkingBudget; sets ThinkingLevel.LOW (never MINIMAL).
 * - Gemini 2.5 (if explicitly selected via env): keeps small bounded thinkingBudget (default 256) so thinking never consumes maxOutputTokens.
 * - When disableTools is true after MAX_TOOL_CALLS_PER_TURN, sets FunctionCallingConfigMode.NONE while keeping declarations attached so history functionCall parts stay valid.
 */
export function buildGeminiGenerateConfig(params: {
  model: string;
  systemInstruction: string;
  functionDeclarations?: FunctionDeclaration[];
  maxOutputTokens?: number;
  lowThinkingMode?: boolean;
  disableTools?: boolean;
  abortSignal?: AbortSignal;
}): GenerateContentConfig {
  const maxOutputTokens = params.maxOutputTokens ?? getConfiguredMaxOutputTokens();
  const config: GenerateContentConfig = {
    systemInstruction: params.systemInstruction,
    maxOutputTokens,
  };

  if (params.abortSignal) {
    config.abortSignal = params.abortSignal;
  }

  if (isGemini3Or4Family(params.model)) {
    config.thinkingConfig = {
      thinkingLevel: ThinkingLevel.LOW,
    };
  } else if (isGemini25Family(params.model)) {
    config.temperature = 0.3;
    config.thinkingConfig = {
      thinkingBudget: params.lowThinkingMode ? 0 : 256,
    };
  } else {
    config.temperature = 0.3;
  }

  if (params.functionDeclarations && params.functionDeclarations.length > 0) {
    config.tools = [{ functionDeclarations: params.functionDeclarations }];
    if (params.disableTools) {
      config.toolConfig = {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.NONE,
        },
      };
    }
  }

  return config;
}

const globalClientTestHook = globalThis as unknown as {
  __deshiGeeTestGeminiClientFactory?: (() => GoogleGenAI | null) | null;
};

export function setGeminiClientFactoryForTests(
  factory: (() => GoogleGenAI | null) | null
): void {
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.DESHI_GEE_TEST_MODE === '1'
  ) {
    globalClientTestHook.__deshiGeeTestGeminiClientFactory = factory;
  }
}

export function createGeminiClient(): GoogleGenAI | null {
  if (
    (process.env.NODE_ENV === 'test' || process.env.DESHI_GEE_TEST_MODE === '1') &&
    globalClientTestHook.__deshiGeeTestGeminiClientFactory
  ) {
    return globalClientTestHook.__deshiGeeTestGeminiClientFactory();
  }
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey.length <= 10) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function redactPotentialSecrets(text: string): string {
  let sanitized = String(text || '');
  const secrets = [
    (process.env.GEMINI_API_KEY || '').trim(),
    (process.env.ORDER_TOKEN_SECRET || '').trim(),
    (process.env.FIREBASE_API_KEY || '').trim(),
  ].filter((s) => s.length >= 6);

  for (const secret of secrets) {
    sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  sanitized = sanitized.replace(/AIzaSy[0-9A-Za-z_-]{10,}/g, '[REDACTED_KEY]');
  return sanitized.slice(0, 220);
}

export function checkGenAiSdkCompatibility(functionDeclarationsCount: number): {
  compatible: boolean;
  package: string;
  functionDeclarationsCount: number;
  detail: string;
} {
  const hasClientCtor = typeof GoogleGenAI === 'function';
  const hasSchemaTypes = Boolean(Type && typeof Type.OBJECT === 'string');
  const hasThinkingLevels = Boolean(
    ThinkingLevel &&
      ThinkingLevel.LOW &&
      ThinkingLevel.MEDIUM &&
      ThinkingLevel.HIGH
  );
  const hasToolMode = Boolean(FunctionCallingConfigMode && FunctionCallingConfigMode.NONE);
  const hasTools = functionDeclarationsCount > 0;
  const compatible = hasClientCtor && hasSchemaTypes && hasThinkingLevels && hasToolMode && hasTools;

  return {
    compatible,
    package: '@google/genai',
    functionDeclarationsCount,
    detail: compatible
      ? `GoogleGenAI SDK ready (${functionDeclarationsCount} function tools, ThinkingLevel + FunctionCallingConfigMode available)`
      : `SDK check failed (client=${hasClientCtor}, schemaType=${hasSchemaTypes}, thinkingLevel=${hasThinkingLevels}, toolMode=${hasToolMode}, tools=${functionDeclarationsCount})`,
  };
}

export interface ModelCapabilityValidation {
  name: string;
  configured: boolean;
  supported: boolean;
  supportsTools: boolean;
  thinkingConfig: {
    supported: boolean;
    status: 'ok' | 'warning' | 'unsupported';
    detail: string;
  };
  outputLimits: {
    configuredMaxOutputTokens: number;
    valid: boolean;
    detail: string;
  };
  sdkCompatible: boolean;
  errorCode: string;
  warnings: string[];
}

export function validateGeminiModelCapability(
  modelName: string,
  options?: {
    role?: 'primary' | 'fallback';
    functionDeclarationsCount?: number;
    maxOutputTokens?: number;
  }
): ModelCapabilityValidation {
  const name = (modelName || '').trim();
  const role = options?.role || 'primary';
  const fnCount = options?.functionDeclarationsCount ?? 13;
  const maxOutputTokens =
    options?.maxOutputTokens ?? getConfiguredMaxOutputTokens();
  const sdk = checkGenAiSdkCompatibility(fnCount);
  const warnings: string[] = [];

  if (!name) {
    return {
      name: '',
      configured: false,
      supported: false,
      supportsTools: false,
      thinkingConfig: {
        supported: false,
        status: 'unsupported',
        detail: `${role} model name is empty.`,
      },
      outputLimits: {
        configuredMaxOutputTokens: maxOutputTokens,
        valid: maxOutputTokens >= 128 && maxOutputTokens <= 65536,
        detail: `Configured maxOutputTokens=${maxOutputTokens}`,
      },
      sdkCompatible: sdk.compatible,
      errorCode: 'model_not_configured',
      warnings: [`${role} Gemini model is not configured.`],
    };
  }

  const isDeprecated = DEPRECATED_GEMINI_PATTERNS.some((re) => re.test(name));
  const isSpecialist = UNSUPPORTED_SPECIALIST_MODEL_PATTERN.test(name);
  const matchesGeminiPattern = VALID_GEMINI_TEXT_MODEL_PATTERN.test(name);

  if (isDeprecated) {
    warnings.push(
      `${role} model "${name}" is deprecated/retired and must be migrated to an active Gemini Flash model (e.g. ${DEFAULT_GEMINI_MODEL}).`
    );
  } else if (isSpecialist || !matchesGeminiPattern) {
    warnings.push(
      `${role} model "${name}" is not a supported Gemini text/tool-calling model.`
    );
  }

  const supported = !isDeprecated && !isSpecialist && matchesGeminiPattern;
  const supportsTools = supported && fnCount > 0;

  const isGen3Or4 = isGemini3Or4Family(name);
  const isGen25 = isGemini25Family(name);

  let thinkingStatus: 'ok' | 'warning' | 'unsupported' = supported ? 'ok' : 'unsupported';
  let thinkingDetail = supported
    ? 'Standard Gemini generation config supported.'
    : `Unsupported model "${name}".`;

  if (supported && isGen3Or4) {
    thinkingDetail = `Gemini 3/4 family uses ThinkingLevel (${ThinkingLevel.LOW}/${ThinkingLevel.MEDIUM}/${ThinkingLevel.HIGH}); temperature/topP overrides omitted automatically.`;
    if (maxOutputTokens < 1000) {
      thinkingStatus = 'warning';
      warnings.push(
        `${role} model "${name}" has low maxOutputTokens (${maxOutputTokens}); recommend >= 1500 tokens.`
      );
    }
  } else if (supported && isGen25) {
    thinkingDetail = `Gemini 2.5 family uses bounded thinkingBudget=256 within maxOutputTokens=${maxOutputTokens}.`;
    if (maxOutputTokens <= 800) {
      thinkingStatus = 'warning';
      warnings.push(
        `${role} model "${name}" has maxOutputTokens=${maxOutputTokens}, which can truncate replies when thinking consumes tokens.`
      );
    }
  }

  const outputValid =
    Number.isFinite(maxOutputTokens) && maxOutputTokens >= 128 && maxOutputTokens <= 65536;
  const outputDetail = outputValid
    ? `maxOutputTokens=${maxOutputTokens} within SDK bounds (128–65536)`
    : `Invalid maxOutputTokens=${maxOutputTokens} (expected 128–65536)`;

  if (!outputValid) {
    warnings.push(`Configured GEMINI_MAX_OUTPUT_TOKENS (${maxOutputTokens}) is out of bounds.`);
  }

  return {
    name,
    configured: true,
    supported,
    supportsTools,
    thinkingConfig: {
      supported: supported && Boolean(ThinkingLevel?.LOW),
      status: thinkingStatus,
      detail: thinkingDetail,
    },
    outputLimits: {
      configuredMaxOutputTokens: maxOutputTokens,
      valid: outputValid,
      detail: outputDetail,
    },
    sdkCompatible: sdk.compatible,
    errorCode: isDeprecated
      ? 'gemini_model_deprecated'
      : !supported
        ? 'gemini_model_unsupported'
        : '',
    warnings,
  };
}

export interface ModelProbeResult {
  reachable: boolean;
  latencyMs: number;
  errorCode: string;
  detail: string;
  cached: boolean;
  checkedAt: string;
}

const MODEL_PROBE_CACHE_TTL_MS = 45_000;
const globalHealthCache = globalThis as unknown as {
  __deshiGeeModelProbeCache?: Map<string, { expiresAt: number; result: ModelProbeResult }>;
};

export function clearGeminiHealthCacheForTests(): void {
  globalHealthCache.__deshiGeeModelProbeCache?.clear();
}

export async function probeGeminiModelReachability(
  ai: GoogleGenAI | null,
  modelName: string,
  options?: { bypassCache?: boolean; timeoutMs?: number }
): Promise<ModelProbeResult> {
  const nowIso = new Date().toISOString();
  const cleanName = (modelName || '').trim();

  if (!cleanName) {
    return {
      reachable: false,
      latencyMs: 0,
      errorCode: 'model_not_configured',
      detail: 'No model identifier configured.',
      cached: false,
      checkedAt: nowIso,
    };
  }

  if (!ai || (!isGeminiApiKeyConfigured() && !globalClientTestHook.__deshiGeeTestGeminiClientFactory)) {
    return {
      reachable: false,
      latencyMs: 0,
      errorCode: 'gemini_api_key_missing',
      detail: 'GEMINI_API_KEY is not configured; live fallback engine is active.',
      cached: false,
      checkedAt: nowIso,
    };
  }

  if (!globalHealthCache.__deshiGeeModelProbeCache) {
    globalHealthCache.__deshiGeeModelProbeCache = new Map();
  }

  const cachedEntry = globalHealthCache.__deshiGeeModelProbeCache.get(cleanName);
  if (!options?.bypassCache && cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return {
      ...cachedEntry.result,
      cached: true,
    };
  }

  const timeoutMs = options?.timeoutMs ?? 4000;
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const modelMeta = await Promise.race([
      ai.models.get({ model: cleanName }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Model probe timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);

    const latencyMs = Date.now() - startedAt;
    const result: ModelProbeResult = {
      reachable: true,
      latencyMs,
      errorCode: '',
      detail: modelMeta?.displayName
        ? `Reachable (${modelMeta.displayName})`
        : `Reachable (${cleanName})`,
      cached: false,
      checkedAt: nowIso,
    };
    globalHealthCache.__deshiGeeModelProbeCache.set(cleanName, {
      expiresAt: Date.now() + MODEL_PROBE_CACHE_TTL_MS,
      result,
    });
    return result;
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const classified = classifyGeminiError(err);
    const rawDetail = err instanceof Error ? err.message : String(err || 'Model probe failed');
    const result: ModelProbeResult = {
      reachable: false,
      latencyMs,
      errorCode: classified.code,
      detail: redactPotentialSecrets(rawDetail),
      cached: false,
      checkedAt: nowIso,
    };
    globalHealthCache.__deshiGeeModelProbeCache.set(cleanName, {
      expiresAt: Date.now() + MODEL_PROBE_CACHE_TTL_MS,
      result,
    });
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function estimateGeminiCostUsd(promptTokens: number, outputTokens: number): number {
  const inputRateRaw = Number((process.env.GEMINI_INPUT_COST_PER_M_TOKENS || '').trim());
  const outputRateRaw = Number((process.env.GEMINI_OUTPUT_COST_PER_M_TOKENS || '').trim());
  const inputRate = Number.isFinite(inputRateRaw) && inputRateRaw >= 0 ? inputRateRaw : 0.15;
  const outputRate = Number.isFinite(outputRateRaw) && outputRateRaw >= 0 ? outputRateRaw : 0.6;
  const inputCost = (promptTokens / 1_000_000) * inputRate;
  const outputCost = (outputTokens / 1_000_000) * outputRate;
  return Number((inputCost + outputCost).toFixed(6));
}

export function classifyGeminiError(err: unknown): {
  code: string;
  shouldFailover: boolean;
  friendlyEn: string;
  friendlyBn: string;
} {
  const errObj = err as { status?: number; code?: number; message?: string } | null;
  const statusNum = Number(errObj?.status || errObj?.code || 0);
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();

  if (statusNum === 400 || msg.includes('400') || msg.includes('invalid_argument') || msg.includes('bad request')) {
    return {
      code: 'gemini_invalid_request',
      shouldFailover: false,
      friendlyEn:
        'Could not process that request format right now. Please try rephrasing or contact support.',
      friendlyBn:
        'অনুরোধটি প্রক্রিয়া করা যায়নি। অনুগ্রহ করে একটু ভিন্নভাবে লিখে চেষ্টা করুন বা সাপোর্টে যোগাযোগ করুন।',
    };
  }

  if (
    statusNum === 401 ||
    statusNum === 403 ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('api_key') ||
    msg.includes('permission_denied')
  ) {
    return {
      code: 'gemini_auth_error',
      shouldFailover: false,
      friendlyEn:
        'The AI assistant is temporarily unavailable. Please contact our customer support directly.',
      friendlyBn:
        'AI অ্যাসিস্ট্যান্ট সাময়িকভাবে অনুপলব্ধ রয়েছে। অনুগ্রহ করে সরাসরি আমাদের কাস্টমার সাপোর্টে যোগাযোগ করুন।',
    };
  }

  if (
    statusNum === 404 ||
    msg.includes('404') ||
    msg.includes('not_found') ||
    msg.includes('not found') ||
    msg.includes('deprecated') ||
    msg.includes('retired')
  ) {
    return {
      code: 'gemini_model_retired',
      shouldFailover: true,
      friendlyEn:
        'Our AI assistant model is switching to a supported engine. Please reach us on WhatsApp if anything stalls.',
      friendlyBn:
        'AI মডেল আপডেট হচ্ছে। প্রয়োজনে সরাসরি WhatsApp বা ফোনে যোগাযোগ করুন।',
    };
  }

  if (msg.includes('abort') || msg.includes('timeout')) {
    return {
      code: 'gemini_timeout',
      shouldFailover: true,
      friendlyEn:
        'Our assistant took a bit too long to respond. Please try again or reach us on WhatsApp.',
      friendlyBn:
        'উত্তর দিতে একটু সময় বেশি লাগছে। অনুগ্রহ করে আবার চেষ্টা করুন অথবা WhatsApp-এ যোগাযোগ করুন।',
    };
  }

  if (statusNum === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted')) {
    return {
      code: 'gemini_quota_exceeded',
      shouldFailover: true,
      friendlyEn:
        'Many customers are chatting right now. Please retry in a moment or message us on WhatsApp.',
      friendlyBn:
        'এই মুহূর্তে অনেক ক্রেতা চ্যাট করছেন। কিছুক্ষণ পর আবার চেষ্টা করুন বা WhatsApp-এ মেসেজ দিন।',
    };
  }

  if (
    (statusNum >= 500 && statusNum <= 599) ||
    /\b50[0234]\b/.test(msg) ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('internal') ||
    msg.includes('econnreset') ||
    msg.includes('network')
  ) {
    return {
      code: 'gemini_transient_error',
      shouldFailover: true,
      friendlyEn:
        'The assistant had a brief network hiccup. Please try again or reach our support team.',
      friendlyBn:
        'সাময়িক সংযোগ সমস্যার কারণে উত্তর দেওয়া যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।',
    };
  }

  return {
    code: 'gemini_unavailable',
    shouldFailover: false,
    friendlyEn:
      'Sorry, the assistant encountered a brief hiccup. Please try again or reach our support team.',
    friendlyBn:
      'দুঃখিত, সাময়িক কারিগরি সমস্যার কারণে উত্তর দেওয়া যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।',
  };
}
