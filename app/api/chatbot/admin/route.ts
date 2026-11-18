import { verifyServerAdminToken } from '../../../../src/lib/chatbot/firestoreRest';
import { getTodayBstDateKey } from '../../../../src/lib/chatbot/security';
import {
  getGeminiModelName,
  isGeminiApiKeyConfigured,
} from '../../../../src/lib/gemini/client';

export async function GET(request: Request) {
  const adminCheck = await verifyServerAdminToken(request.headers.get('authorization'));
  if (!adminCheck.ok) {
    return Response.json({ error: 'Unauthorized admin request.' }, { status: 401 });
  }

  return Response.json({
    ok: true,
    adminEmail: adminCheck.email,
    geminiConfigured: isGeminiApiKeyConfigured(),
    model: getGeminiModelName(),
    bstDate: getTodayBstDateKey(),
  });
}
