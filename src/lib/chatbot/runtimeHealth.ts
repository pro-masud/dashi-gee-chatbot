import { CHATBOT_FUNCTION_DECLARATIONS } from '../gemini/tools';
import {
  checkGenAiSdkCompatibility,
  createGeminiClient,
  getConfiguredGeminiModelEnvRaw,
  getGeminiFallbackModelName,
  getGeminiModelName,
  isGeminiApiKeyConfigured,
  isOrderTokenSecretConfigured,
  isOrderTokenSecretPresent,
  probeGeminiModelReachability,
  validateGeminiModelCapability,
} from '../gemini/client';
import { checkServerFirestoreHealth } from './firestoreRest';
import type {
  ChatbotExecutionPath,
  ModelDiagnosticSummary,
  RuntimeHealthReport,
} from './types';

function toModelDiagnosticSummary(
  validation: ReturnType<typeof validateGeminiModelCapability>,
  probe: Awaited<ReturnType<typeof probeGeminiModelReachability>>
): ModelDiagnosticSummary {
  const errorCode = validation.errorCode || probe.errorCode || '';
  const detailParts = [probe.detail];
  if (validation.warnings.length > 0) {
    detailParts.push(validation.warnings[0]);
  }
  return {
    name: validation.name,
    configured: validation.configured,
    supported: validation.supported,
    reachable: probe.reachable ? 'yes' : 'no',
    reachableOk: probe.reachable,
    supportsTools: validation.supportsTools,
    thinkingConfig: validation.thinkingConfig,
    outputLimits: validation.outputLimits,
    sdkCompatible: validation.sdkCompatible,
    latencyMs: probe.latencyMs,
    errorCode,
    detail: detailParts.filter(Boolean).join(' · '),
  };
}

export async function buildRuntimeHealthReport(options?: {
  bypassCache?: boolean;
  skipRemoteProbes?: boolean;
}): Promise<RuntimeHealthReport> {
  const fnCount = CHATBOT_FUNCTION_DECLARATIONS.length;
  const sdk = checkGenAiSdkCompatibility(fnCount);
  const geminiKeyOk = isGeminiApiKeyConfigured();
  const tokenSecretOk = isOrderTokenSecretConfigured();
  const tokenSecretPresent = isOrderTokenSecretPresent();

  const rawPrimaryEnv = getConfiguredGeminiModelEnvRaw();
  const primaryName = getGeminiModelName();
  const fallbackName = getGeminiFallbackModelName();

  const primaryValidation = validateGeminiModelCapability(primaryName, {
    role: 'primary',
    functionDeclarationsCount: fnCount,
  });
  const fallbackValidation = validateGeminiModelCapability(fallbackName, {
    role: 'fallback',
    functionDeclarationsCount: fnCount,
  });

  const ai = geminiKeyOk ? createGeminiClient() : null;

  const [primaryProbe, fallbackProbe, firestoreHealth] = options?.skipRemoteProbes
    ? [
        {
          reachable: false,
          latencyMs: 0,
          errorCode: geminiKeyOk ? 'probe_skipped' : 'gemini_api_key_missing',
          detail: geminiKeyOk ? 'Remote probe skipped' : 'GEMINI_API_KEY is not configured',
          cached: false,
          checkedAt: new Date().toISOString(),
        },
        {
          reachable: false,
          latencyMs: 0,
          errorCode: geminiKeyOk ? 'probe_skipped' : 'gemini_api_key_missing',
          detail: geminiKeyOk ? 'Remote probe skipped' : 'GEMINI_API_KEY is not configured',
          cached: false,
          checkedAt: new Date().toISOString(),
        },
        {
          reachable: true,
          latencyMs: 0,
          detail: 'Firestore probe skipped',
        },
      ]
    : await Promise.all([
        probeGeminiModelReachability(ai, primaryName, {
          bypassCache: options?.bypassCache,
        }),
        probeGeminiModelReachability(ai, fallbackName, {
          bypassCache: options?.bypassCache,
        }),
        checkServerFirestoreHealth(),
      ]);

  const primaryModel = toModelDiagnosticSummary(primaryValidation, primaryProbe);
  const fallbackModel = toModelDiagnosticSummary(fallbackValidation, fallbackProbe);

  const supportedModelConfigured =
    primaryModel.supported || fallbackModel.supported;

  const warnings: string[] = [];

  if (!geminiKeyOk) {
    warnings.push(
      'GEMINI_API_KEY is not configured in server environment variables. Live DB fallback engine is serving customer chats.'
    );
  }

  if (rawPrimaryEnv && !primaryValidation.supported) {
    warnings.push(
      `Configured GEMINI_MODEL (${rawPrimaryEnv}) is unsupported (${primaryValidation.errorCode}).`
    );
  }

  for (const w of primaryValidation.warnings) {
    warnings.push(w);
  }
  for (const w of fallbackValidation.warnings) {
    warnings.push(w);
  }

  if (geminiKeyOk && !primaryModel.reachableOk && !fallbackModel.reachableOk) {
    warnings.push(
      `Neither primary (${primaryModel.name || 'unset'}) nor fallback (${fallbackModel.name || 'unset'}) Gemini model is reachable: ${primaryProbe.detail || primaryProbe.errorCode}`
    );
  } else if (geminiKeyOk && !primaryModel.reachableOk) {
    warnings.push(
      `Primary Gemini model "${primaryModel.name}" is unreachable (${primaryProbe.errorCode}): ${primaryProbe.detail}`
    );
  }

  if (!tokenSecretPresent) {
    warnings.push(
      'ORDER_TOKEN_SECRET is missing. Configure a dedicated 32+ character random secret in server environment variables.'
    );
  } else if (!tokenSecretOk) {
    warnings.push(
      'ORDER_TOKEN_SECRET is shorter than 32 characters. Rotate to at least 32 random characters.'
    );
  }

  if (!firestoreHealth.reachable) {
    warnings.push(`Firestore connectivity check failed: ${firestoreHealth.detail}`);
  }

  if (!sdk.compatible) {
    warnings.push(sdk.detail);
  }

  let activePath: ChatbotExecutionPath = 'fallback';
  if (
    geminiKeyOk &&
    supportedModelConfigured &&
    (primaryModel.reachableOk || fallbackModel.reachableOk)
  ) {
    activePath = 'gemini';
  }

  let status: RuntimeHealthReport['status'] = 'healthy';
  let errorCode = '';
  let ok = true;

  if (!supportedModelConfigured || !sdk.compatible) {
    status = 'unhealthy';
    errorCode = !sdk.compatible ? 'gemini_sdk_incompatible' : 'no_supported_model_configured';
    ok = false;
  } else if (!geminiKeyOk) {
    status = 'degraded';
    errorCode = 'gemini_api_key_missing';
  } else if (!primaryModel.reachableOk && !fallbackModel.reachableOk) {
    status = 'degraded';
    errorCode = primaryProbe.errorCode || 'gemini_models_unreachable';
  } else if (!firestoreHealth.reachable) {
    status = 'degraded';
    errorCode = 'firestore_unreachable';
  } else if (!tokenSecretOk) {
    status = 'degraded';
    errorCode = 'order_token_secret_missing';
  } else if (!primaryModel.supported || !fallbackModel.supported) {
    status = 'degraded';
    errorCode = primaryValidation.errorCode || fallbackValidation.errorCode || '';
  }

  return {
    ok,
    status,
    service: 'deshi-gee-storefront',
    runtime: 'nextjs-app-router',
    timestamp: new Date().toISOString(),
    activePath,
    supportedModelConfigured,
    checks: {
      geminiApiKeyConfigured: geminiKeyOk ? 'yes' : 'no',
      geminiApiKeyOk: geminiKeyOk,
      primaryModel,
      fallbackModel,
      tokenSecretConfigured: tokenSecretOk ? 'yes' : 'no',
      tokenSecretOk,
      tokenSecretPresent,
      firestoreReachable: firestoreHealth.reachable ? 'yes' : 'no',
      firestoreOk: firestoreHealth.reachable,
      firestoreLatencyMs: firestoreHealth.latencyMs,
      firestoreDetail: firestoreHealth.detail,
      sdk,
    },
    errorCode,
    warnings,
  };
}
