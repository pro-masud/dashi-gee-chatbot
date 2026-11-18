import { stripUnsafeHtml } from '../../../../src/lib/chatbot/domain-guard';
import {
  fetchServerChatSession,
  fetchServerOrderDraft,
  upsertServerChatSession,
  upsertServerOrderDraft,
} from '../../../../src/lib/chatbot/firestoreRest';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = stripUnsafeHtml(searchParams.get('sessionId') || '', 64);
  if (!sessionId || !/^[a-zA-Z0-9_-]{4,64}$/.test(sessionId)) {
    return Response.json({ error: 'Valid sessionId is required.' }, { status: 400 });
  }

  const [session, draft] = await Promise.all([
    fetchServerChatSession(sessionId),
    fetchServerOrderDraft(`draft_${sessionId}`),
  ]);

  const activeDraft =
    draft && draft.expiresAt > Date.now() && draft.state !== 'cancelled' && draft.state !== 'expired'
      ? draft
      : null;

  return Response.json(
    {
      session,
      orderDraft: activeDraft,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}

export async function DELETE(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return Response.json({ error: 'Invalid request header.' }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const sessionId = stripUnsafeHtml(searchParams.get('sessionId') || '', 64);
  if (!sessionId || !/^[a-zA-Z0-9_-]{4,64}$/.test(sessionId)) {
    return Response.json({ error: 'Valid sessionId is required.' }, { status: 400 });
  }

  await Promise.all([
    upsertServerChatSession({
      sessionId,
      language: 'en',
      lockedLang: '',
      scriptPreference: 'en',
      consent: true,
      currentIntent: 'greeting',
      orderDraftId: '',
      turnCount: 0,
    }),
    upsertServerOrderDraft({
      draftId: `draft_${sessionId}`,
      sessionId,
      state: 'cancelled',
      priceQuoteVersion: 1,
      expiresAt: Date.now(),
    }),
  ]);

  return Response.json({ ok: true, sessionId }, { status: 200 });
}
