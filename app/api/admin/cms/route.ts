import { sanitizeCms } from '../../../../src/lib/cms/cms';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';
import { publishDraft, readCmsState, restoreVersionToDraft, saveDraft } from '../../../../src/lib/server/cmsRepository';

export const dynamic = 'force-dynamic';

/** GET /api/admin/cms — draft, published copy, "unpublished changes" flag and recent versions. */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { permission: 'cms.manage' });
  if ('response' in auth) return auth.response;
  try {
    return jsonOk({ state: await readCmsState() });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** PUT /api/admin/cms — save the DRAFT (never touches the live page). */
export async function PUT(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'cms.manage' });
  if ('response' in auth) return auth.response;
  const parsed = sanitizeCms(await request.json().catch(() => null));
  if (!parsed.ok) return jsonError(parsed.error, 400);
  try {
    await saveDraft(parsed.value, auth.actor);
    return jsonOk({ state: await readCmsState() });
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * POST /api/admin/cms — { action: 'publish', label? } publishes the saved draft;
 *                       { action: 'restore', versionId } loads an old version into the draft.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'cms.manage' });
  if ('response' in auth) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    if (body?.action === 'publish') {
      const res = await publishDraft(String(body.label || ''), auth.actor);
      if (!res) return jsonError('Save a draft before publishing.', 409);
      return jsonOk({ state: await readCmsState(), versionId: res.versionId });
    }
    if (body?.action === 'restore') {
      const id = String(body.versionId || '');
      if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return jsonError('Invalid version id.', 400);
      const ok = await restoreVersionToDraft(id, auth.actor);
      if (!ok) return jsonError('Version not found.', 404);
      return jsonOk({ state: await readCmsState() });
    }
    return jsonError('Unknown action.', 400);
  } catch (err) {
    return handleAdminError(err);
  }
}
