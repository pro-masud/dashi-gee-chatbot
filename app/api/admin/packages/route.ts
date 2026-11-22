import { packageEconomics, validatePackagesInput, PACKAGE_SLOTS } from '../../../../src/lib/packages/packages';
import { handleAdminError, jsonError, jsonOk, requireAdmin } from '../../../../src/lib/server/adminApi';
import { readPackages, savePackages } from '../../../../src/lib/server/packagesRepository';

export const dynamic = 'force-dynamic';

/** GET /api/admin/packages — packages with economics (owner only: includes cost of goods). */
export async function GET(request: Request) {
  const auth = await requireAdmin(request, { permission: 'catalog.manage' });
  if ('response' in auth) return auth.response;
  try {
    const packages = await readPackages();
    const economics = Object.fromEntries(PACKAGE_SLOTS.map((s) => [s, packageEconomics(packages[s])]));
    return jsonOk({ packages, economics });
  } catch (err) {
    return handleAdminError(err);
  }
}

/** PUT /api/admin/packages — save all three packages (prices, cost, stock, badges, enabled, default). */
export async function PUT(request: Request) {
  const auth = await requireAdmin(request, { mutation: true, permission: 'catalog.manage' });
  if ('response' in auth) return auth.response;

  const parsed = validatePackagesInput(await request.json().catch(() => null));
  if (!parsed.ok) return jsonError(parsed.error, 400);

  try {
    const packages = await savePackages(parsed.value, auth.actor);
    const economics = Object.fromEntries(PACKAGE_SLOTS.map((s) => [s, packageEconomics(packages[s])]));
    return jsonOk({ packages, economics });
  } catch (err) {
    return handleAdminError(err);
  }
}
