import { NextResponse } from 'next/server';
import { fetchServerChatbotConfig } from '../../../../src/lib/chatbot/firestoreRest';
import { projectPublicChatbotConfig } from '../../../../src/lib/server/adminRepository';

export const dynamic = 'force-dynamic';

/**
 * Decision D2 (Stage 2.9):
 * Public chatbot config endpoint returns ONLY the minimal safe storefront UI fields:
 * `{ enabled, botName, welcomeMessage, quickQuestions, enableVoiceFeatures }`.
 * System prompts, internal rules, contacts, SLA settings, and admin flags remain server-only.
 */
export async function GET() {
  try {
    const cfg = await fetchServerChatbotConfig('published');
    const payload = projectPublicChatbotConfig(cfg);
    return NextResponse.json(payload, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
    });
  } catch {
    return NextResponse.json(projectPublicChatbotConfig(null), {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
