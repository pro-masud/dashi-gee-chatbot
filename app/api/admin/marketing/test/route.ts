import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../../src/lib/server/adminApi';
import { sendTestEvent } from '../../../../../src/lib/server/metaCapi';

export const dynamic = 'force-dynamic';

/** POST /api/admin/marketing/test — sends a real test event to Meta with the saved credentials. */
export async function POST(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'marketing.manage' });
  if ('response' in auth) return auth.response;
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const result = await sendTestEvent(siteUrl);
    if (result.skipped) return jsonError(result.detail, 409, result.skipped);
    return jsonOk({ result });
  } catch (err) {
    return handleAdminError(err);
  }
}
