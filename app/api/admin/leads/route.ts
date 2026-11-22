import { normalizeBangladeshPhone } from '../../../../src/lib/leads/leads';
import { validateLeadUpdate } from '../../../../src/lib/leads/leads';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';
import { listLeadActivities, listLeads, updateLead } from '../../../../src/lib/server/leadsRepository';

export const dynamic = 'force-dynamic';

/** GET /api/admin/leads[?phone=01XXXXXXXXX] — all leads, or one lead's notes/history. */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { permission: 'leads.manage' });
  if ('response' in auth) return auth.response;
  const phoneParam = new URL(request.url).searchParams.get('phone');
  try {
    if (phoneParam) {
      const phone = normalizeBangladeshPhone(phoneParam);
      if (!/^01[3-9]\d{8}$/.test(phone)) return jsonError('Invalid phone number.', 400);
      return jsonOk({ activities: await listLeadActivities(phone) });
    }
    return jsonOk({ leads: await listLeads() });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** PATCH /api/admin/leads — body: { phone, status?, note?, followUpDate?, assignedTo? } */
export async function PATCH(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'leads.manage' });
  if ('response' in auth) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const phone = normalizeBangladeshPhone(String(body?.phone || ''));
  if (!/^01[3-9]\d{8}$/.test(phone)) return jsonError('Invalid phone number.', 400);

  const parsed = validateLeadUpdate(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  try {
    const result = await updateLead(phone, parsed.value, auth.actor);
    if (!result.ok) return jsonError(result.error, result.status);
    return jsonOk({ lead: result.lead });
  } catch (err) {
    return handleAdminError(err);
  }
}
