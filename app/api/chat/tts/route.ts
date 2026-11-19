import { NextResponse } from 'next/server';
import { createGeminiClient, isGeminiApiKeyConfigured } from '../../../../src/lib/gemini/client';
import {
  CHATBOT_BUILD_CONFIG,
  getOptionalDailyCostCapUsd,
} from '../../../../src/lib/chatbot/build-config';
import { checkCompositeChatRateLimit } from '../../../../src/lib/chatbot/rateLimit';
import {
  getPersistentDailyCostStatus,
  recordPersistentDailyCost,
} from '../../../../src/lib/chatbot/firestoreRest';
import { verifySignedTtsToken } from '../../../../src/lib/chatbot/orderToken';
import { getTodayBstDateKey } from '../../../../src/lib/chatbot/security';

export const dynamic = 'force-dynamic';

const TTS_MODEL = 'gemini-3.8-flash-lite-tts';
const ALLOWED_VOICES = new Set(['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr']);
const MAX_TTS_CHARS = 600;
const ESTIMATED_TTS_USD_PER_CHAR = 0.000016;

function sanitizeTextForSpeech(raw: string): string {
  return String(raw || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[Evidence ID:[^\]]+\]/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[#`*_~>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TTS_CHARS);
}

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json(
      { ok: false, error: 'Invalid storefront origin header.' },
      { status: 403 }
    );
  }

  let body: {
    text?: string;
    lang?: string;
    voiceName?: string;
    sessionId?: string;
    ttsToken?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed JSON body.' }, { status: 400 });
  }

  const rawText = String(body.text || '');
  const cleanText = sanitizeTextForSpeech(rawText);
  if (!cleanText || cleanText.length < 2) {
    return NextResponse.json(
      { ok: false, error: 'Text is required for speech synthesis.' },
      { status: 400 }
    );
  }

  // S0-08: Require a valid server-signed HMAC speech token bound to the exact assistant reply & session.
  const tokenStr = String(body.ttsToken || '').trim();
  const sessionId = String(body.sessionId || '').trim().slice(0, 80);
  if (!tokenStr || !sessionId) {
    return NextResponse.json(
      {
        ok: false,
        code: 'tts_token_required',
        error: 'Signed assistant speech token and sessionId are required.',
      },
      { status: 403 }
    );
  }

  const verifiedToken = verifySignedTtsToken({
    token: tokenStr,
    text: rawText,
    sessionId,
  });
  if (!verifiedToken.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: `tts_${verifiedToken.reason}`,
        error: 'Speech synthesis is restricted to verified assistant replies for your active session.',
      },
      { status: 403 }
    );
  }

  const ttsSessionId = `tts_${sessionId.slice(0, 48)}`;
  const rate = await checkCompositeChatRateLimit({
    request,
    sessionId: ttsSessionId,
    dailyGlobalCap: CHATBOT_BUILD_CONFIG.DAILY_MESSAGE_CAP,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      {
        ok: false,
        code: 'rate_limited',
        error:
          body.lang === 'bn'
            ? 'অনুগ্রহ করে কিছুক্ষণ পর আবার অডিও চালান।'
            : 'Please wait a moment before generating more audio.',
      },
      { status: 429 }
    );
  }

  // S0-08: Respect persistent daily cost cap before invoking Gemini TTS.
  const todayKey = getTodayBstDateKey();
  const dailyCapUsd = getOptionalDailyCostCapUsd();
  const costStatus = await getPersistentDailyCostStatus(todayKey);
  if (costStatus.capHit || (dailyCapUsd !== null && costStatus.totalUsd >= dailyCapUsd)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'daily_budget_reached',
        error:
          body.lang === 'bn'
            ? 'আজকের ভয়েস অডিও লিমিট পূর্ণ হয়েছে। অনুগ্রহ করে লিখিত উত্তরটি পড়ুন।'
            : 'Daily voice synthesis budget has been reached. Please read the text reply.',
      },
      { status: 429 }
    );
  }

  const ai = createGeminiClient();
  if (!ai) {
    return NextResponse.json(
      {
        ok: false,
        code: 'gemini_api_key_missing',
        configured: isGeminiApiKeyConfigured(),
        error:
          body.lang === 'bn'
            ? 'সার্ভারে Gemini API key না থাকায় অডিও তৈরি করা যায়নি।'
            : 'Gemini TTS requires a configured server GEMINI_API_KEY.',
      },
      { status: 503 }
    );
  }

  const envVoice = (process.env.GEMINI_TTS_VOICE || '').trim();
  const requestedVoice = String(body.voiceName || envVoice || 'Kore').trim();
  const voiceName = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : 'Kore';
  const isBangla = body.lang === 'bn' || /[\u0980-\u09FF]/.test(cleanText);

  try {
    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: cleanText,
              speechMetadata: {
                style: isBangla
                  ? 'Warm, polite, clear Bangladeshi customer support assistant speaking naturally in Bangla'
                  : 'Warm, polite, clear artisanal food customer support assistant speaking naturally',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const audioPart = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    const base64Audio = audioPart?.data;
    if (!base64Audio) {
      return NextResponse.json(
        {
          ok: false,
          code: 'tts_empty_audio',
          error: isBangla
            ? 'অডিও পাওয়া যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'No audio was returned by the speech model.',
        },
        { status: 502 }
      );
    }

    // S0-08: Record TTS usage into the persistent daily cost ledger.
    const estimatedPromptTokens = Math.max(1, Math.ceil(cleanText.length / 4));
    const estimatedOutputTokens = Math.max(10, Math.ceil(base64Audio.length / 256));
    const estimatedCostUsd = Number(
      Math.max(0.0002, cleanText.length * ESTIMATED_TTS_USD_PER_CHAR).toFixed(6)
    );
    await recordPersistentDailyCost(todayKey, {
      costUsd: estimatedCostUsd,
      promptTokens: estimatedPromptTokens,
      outputTokens: estimatedOutputTokens,
      capUsd: dailyCapUsd,
    }).catch(() => {});

    return NextResponse.json(
      {
        ok: true,
        model: TTS_MODEL,
        voiceName,
        mimeType: audioPart?.mimeType || 'audio/wav',
        audioBase64: base64Audio,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'TTS generation failed';
    return NextResponse.json(
      {
        ok: false,
        code: 'tts_generation_failed',
        error: isBangla
          ? 'এই মুহূর্তে অডিও তৈরি করা যায়নি। অনুগ্রহ করে পরে চেষ্টা করুন।'
          : `Speech synthesis failed: ${detail.slice(0, 140)}`,
      },
      { status: 502 }
    );
  }
}
