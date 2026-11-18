import { GoogleGenAI } from '@google/genai';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const FALLBACK_GEMINI_MODEL = 'gemini-2.0-flash';

export function getGeminiModelName(): string {
  const configured = (process.env.GEMINI_MODEL || '').trim();
  if (
    configured &&
    !configured.includes('3.1') &&
    !configured.includes('hydrogen')
  ) {
    return configured;
  }
  return DEFAULT_GEMINI_MODEL;
}

export function isGeminiApiKeyConfigured(): boolean {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  return key.length > 10;
}

export function createGeminiClient(): GoogleGenAI | null {
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

export function estimateGeminiCostUsd(promptTokens: number, outputTokens: number): number {
  const inputCost = (promptTokens / 1_000_000) * 0.15;
  const outputCost = (outputTokens / 1_000_000) * 0.6;
  return Number((inputCost + outputCost).toFixed(6));
}

export function classifyGeminiError(err: unknown): {
  code: string;
  friendlyEn: string;
  friendlyBn: string;
} {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();

  if (msg.includes('abort') || msg.includes('timeout')) {
    return {
      code: 'gemini_timeout',
      friendlyEn:
        'Our assistant took a bit too long to respond. Please try again or reach us on WhatsApp.',
      friendlyBn:
        'উত্তর দিতে একটু সময় বেশি লাগছে। অনুগ্রহ করে আবার চেষ্টা করুন অথবা WhatsApp-এ যোগাযোগ করুন।',
    };
  }
  if (msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted')) {
    return {
      code: 'gemini_quota_exceeded',
      friendlyEn:
        'Many customers are chatting right now. Please retry in a moment or message us on WhatsApp.',
      friendlyBn:
        'এই মুহূর্তে অনেক ক্রেতা চ্যাট করছেন। কিছুক্ষণ পর আবার চেষ্টা করুন বা WhatsApp-এ মেসেজ দিন।',
    };
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('api_key') || msg.includes('permission_denied')) {
    return {
      code: 'gemini_auth_error',
      friendlyEn:
        'The AI assistant is temporarily unavailable. Please contact our customer support directly.',
      friendlyBn:
        'AI অ্যাসিস্ট্যান্ট সাময়িকভাবে অনুপলব্ধ রয়েছে। অনুগ্রহ করে সরাসরি আমাদের কাস্টমার সাপোর্টে যোগাযোগ করুন।',
    };
  }
  if (msg.includes('404') || msg.includes('model')) {
    return {
      code: 'gemini_model_error',
      friendlyEn:
        'The AI assistant configuration is updating. Please reach us directly via Phone or WhatsApp.',
      friendlyBn:
        'AI অ্যাসিস্ট্যান্ট আপডেট হচ্ছে। অনুগ্রহ করে ফোন বা WhatsApp-এ যোগাযোগ করুন।',
    };
  }
  return {
    code: 'gemini_unavailable',
    friendlyEn:
      'Sorry, the assistant encountered a brief hiccup. Please try again or reach our support team.',
    friendlyBn:
      'দুঃখিত, সাময়িক কারিগরি সমস্যার কারণে উত্তর দেওয়া যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।',
  };
}
