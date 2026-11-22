import { validateTrackingSettings } from '../../../../src/lib/marketing/marketing';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';
import { listEventLogs, readTrackingState, saveTrackingState } from '../../../../src/lib/server/marketingRepository';
import { SecretsKeyMissingError } from '../../../../src/lib/server/secrets';

export const dynamic = 'force-dynamic';

/** GET /api/admin/marketing — tracking ids, whether a CAPI token exists (hint only), recent event log. */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { permission: 'marketing.manage' });
  if ('response' in auth) return auth.response;
  try {
    const [state, logs] = await Promise.all([readTrackingState(), listEventLogs(50)]);
    return jsonOk({ state, logs });
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * PUT /api/admin/marketing — body: { settings, token?: string, clearToken?: boolean }
 * The token is encrypted at rest and is never returned to the browser again (only a ••••1234 hint).
 */
export async function PUT(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'marketing.manage' });
  if ('response' in auth) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = validateTrackingSettings(body?.settings);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (token && (token.length < 20 || token.length > 600 || /\s/.test(token))) {
    return jsonError('That does not look like a valid access token.', 400);
  }

  try {
    const state = await saveTrackingState(parsed.value, { set: token || undefined, clear: body?.clearToken === true }, auth.actor);
    return jsonOk({ state });
  } catch (err) {
    if (err instanceof SecretsKeyMissingError) {
      return jsonError('Cannot store the token: INTEGRATION_SECRET_KEY (32+ characters) is not set on the server.', 409, err.code);
    }
    return handleAdminError(err);
  }
}
