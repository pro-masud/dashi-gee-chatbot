import { NextResponse } from 'next/server';
import { createGeminiClient, isGeminiApiKeyConfigured } from '../../../../src/lib/gemini/client';
import { CHATBOT_BUILD_CONFIG } from '../../../../src/lib/chatbot/build-config';
import { checkCompositeChatRateLimit } from '../../../../src/lib/chatbot/rateLimit';

export const dynamic = 'force-dynamic';

const TTS_MODEL = 'gemini-3.8-flash-lite-tts';
const ALLOWED_VOICES = new Set(['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr']);
const MAX_TTS_CHARS = 600;

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

  let body: { text?: string; lang?: string; voiceName?: string; sessionId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed JSON body.' }, { status: 400 });
  }

  const cleanText = sanitizeTextForSpeech(body.text || '');
  if (!cleanText || cleanText.length < 2) {
    return NextResponse.json(
      { ok: false, error: 'Text is required for speech synthesis.' },
      { status: 400 }
    );
  }

  const ttsSessionId = `tts_${String(body.sessionId || 'anon').slice(0, 48)}`;
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
