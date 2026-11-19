import { stripUnsafeHtml } from '../../../../src/lib/chatbot/domain-guard';
import {
  fetchServerChatSession,
  fetchServerOrderDraft,
  upsertServerChatSession,
  upsertServerOrderDraft,
} from '../../../../src/lib/chatbot/firestoreRest';
import {
  buildSessionSetCookieHeader,
  checkSessionPollRateLimit,
  extractVerifiedSessionIdFromRequest,
  generateSecureSessionId,
  isValidSessionIdFormat,
  verifyRequestOwnsSession,
} from '../../../../src/lib/chatbot/sessionAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/session
 * Mints (or confirms) a >=128-bit random sessionId bound to a signed HttpOnly cookie.
 */
export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return Response.json({ error: 'Invalid request header.' }, { status: 403 });
  }

  let body: { forceNew?: boolean } = {};
  try {
    body = (await request.json()) as { forceNew?: boolean };
  } catch {
    body = {};
  }

  const existing = extractVerifiedSessionIdFromRequest(request);
  const sessionId = !body.forceNew && existing ? existing : generateSecureSessionId();
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Set-Cookie': buildSessionSetCookieHeader(sessionId),
  });

  return Response.json({ ok: true, sessionId }, { status: 200, headers });
}

/**
 * GET /api/chat/session?sessionId=...
 * Requires signed HttpOnly cookie ownership matching `sessionId`.
 * Rejects missing/mismatched cookies with a generic 403 and zero existence leak.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = stripUnsafeHtml(searchParams.get('sessionId') || '', 64);
  if (!sessionId || !isValidSessionIdFormat(sessionId)) {
    return Response.json({ error: 'Session access denied.' }, { status: 403 });
  }

  if (!verifyRequestOwnsSession(request, sessionId)) {
    return Response.json(
      { error: 'Session access denied.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const pollLimit = await checkSessionPollRateLimit({ request, sessionId });
  if (!pollLimit.allowed) {
    return Response.json(
      { error: 'Too many session refresh requests. Please slow down.' },
      {
        status: 429,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(pollLimit.retryAfterSec),
        },
      }
    );
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

/**
 * DELETE /api/chat/session?sessionId=...
 * Requires storefront header AND signed HttpOnly cookie ownership matching `sessionId`.
 */
export async function DELETE(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return Response.json({ error: 'Invalid request header.' }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const sessionId = stripUnsafeHtml(searchParams.get('sessionId') || '', 64);
  if (!sessionId || !isValidSessionIdFormat(sessionId)) {
    return Response.json({ error: 'Session access denied.' }, { status: 403 });
  }

  if (!verifyRequestOwnsSession(request, sessionId)) {
    return Response.json(
      { error: 'Session access denied.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
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

  return Response.json(
    { ok: true, sessionId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
