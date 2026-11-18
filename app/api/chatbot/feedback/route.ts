import { createServerChatFeedback } from '../../../../src/lib/chatbot/firestoreRest';
import { validateFeedbackPayload } from '../../../../src/lib/chatbot/schema';

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return Response.json({ error: 'Invalid request origin header.' }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: 'Malformed JSON body.' }, { status: 400 });
  }

  const parsed = validateFeedbackPayload(raw);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const saved = await createServerChatFeedback(parsed.data);
  if (!saved.ok) {
    return Response.json(
      { ok: false, error: 'Failed to store feedback right now.' },
      { status: 500 }
    );
  }

  return Response.json(
    {
      ok: true,
      feedbackId: saved.feedbackId,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
