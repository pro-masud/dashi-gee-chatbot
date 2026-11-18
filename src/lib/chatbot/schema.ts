import type { ChannelSource, FeedbackReason } from './types';

export const ALLOWED_ADMIN_GEMINI_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
] as const;

export type AllowedAdminGeminiModel = (typeof ALLOWED_ADMIN_GEMINI_MODELS)[number];

export function validateModelSelection(modelName: unknown): {
  valid: boolean;
  model: AllowedAdminGeminiModel;
} {
  const clean = String(modelName || '').trim();
  if ((ALLOWED_ADMIN_GEMINI_MODELS as readonly string[]).includes(clean)) {
    return { valid: true, model: clean as AllowedAdminGeminiModel };
  }
  return { valid: false, model: 'gemini-4-hydrogen' };
}

const VALID_CHANNELS = new Set<ChannelSource>([
  'web',
  'messenger',
  'instagram',
  'whatsapp',
  'email',
  'sms',
]);

export function sanitizeChannelSource(raw: unknown, fallback: ChannelSource = 'web'): ChannelSource {
  const clean = String(raw || '').trim().toLowerCase() as ChannelSource;
  return VALID_CHANNELS.has(clean) ? clean : fallback;
}

export interface ValidatedChatRequest {
  mode: 'published' | 'draft';
  uiLang: 'en' | 'bn';
  sessionId: string;
  isTestPlayground: boolean;
  stream: boolean;
  channel: ChannelSource;
  messages: { role: 'user' | 'assistant'; text: string }[];
}

export function validateChatRequestPayload(raw: unknown):
  | { ok: true; data: ValidatedChatRequest }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.messages) || obj.messages.length === 0) {
    return { ok: false, error: 'messages array is required and cannot be empty.' };
  }

  const parsedMessages: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const item of obj.messages) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'Each message item must be an object.' };
    }
    const m = item as Record<string, unknown>;
    if (typeof m.text !== 'string') {
      return { ok: false, error: 'Message text must be a string.' };
    }
    parsedMessages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      text: m.text,
    });
  }

  return {
    ok: true,
    data: {
      mode: obj.mode === 'draft' ? 'draft' : 'published',
      uiLang: obj.uiLang === 'bn' ? 'bn' : 'en',
      sessionId: typeof obj.sessionId === 'string' && obj.sessionId.trim() ? obj.sessionId.trim() : 'sess_anon',
      isTestPlayground: Boolean(obj.isTestPlayground),
      stream: obj.stream !== false,
      channel: sanitizeChannelSource(obj.channel, 'web'),
      messages: parsedMessages,
    },
  };
}

const VALID_FEEDBACK_REASONS = new Set<FeedbackReason>([
  'wrong_price',
  'unclear',
  'missing_info',
  'wrong_language',
  'other',
  '',
]);

export interface ValidatedFeedbackPayload {
  sessionId: string;
  logId: string;
  rating: 'up' | 'down';
  reason: FeedbackReason;
  userMessage: string;
  assistantReply: string;
  lang: 'bn' | 'en';
  intent: string;
}

export function validateFeedbackPayload(raw: unknown):
  | { ok: true; data: ValidatedFeedbackPayload }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Invalid feedback payload.' };
  }
  const obj = raw as Record<string, unknown>;
  const rating = obj.rating === 'up' ? 'up' : obj.rating === 'down' ? 'down' : null;
  if (!rating) {
    return { ok: false, error: 'rating must be "up" or "down".' };
  }
  const sessionId = String(obj.sessionId || '').trim().slice(0, 64);
  if (sessionId.length < 4 || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    return { ok: false, error: 'Valid sessionId is required.' };
  }
  const reasonRaw = String(obj.reason || '').trim() as FeedbackReason;
  const reason: FeedbackReason = VALID_FEEDBACK_REASONS.has(reasonRaw) ? reasonRaw : 'other';

  return {
    ok: true,
    data: {
      sessionId,
      logId: String(obj.logId || '').trim().slice(0, 128),
      rating,
      reason: rating === 'up' ? '' : reason,
      userMessage: String(obj.userMessage || '').trim().slice(0, 1000) || '(no message)',
      assistantReply: String(obj.assistantReply || '').trim().slice(0, 2500) || '(no reply)',
      lang: obj.lang === 'bn' ? 'bn' : 'en',
      intent: String(obj.intent || 'general').trim().slice(0, 60),
    },
  };
}
