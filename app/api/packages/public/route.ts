import { NextResponse } from 'next/server';
import { toPublicPackages } from '../../../../src/lib/packages/packages';
import { readPackagesBestEffort } from '../../../../src/lib/server/packagesRepository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/packages/public — customer-safe package display data (badges, regular vs selling price,
 * enabled, default). Never exposes cost of goods or stock counts.
 */
export async function GET() {
  const state = await readPackagesBestEffort();
  return NextResponse.json(
    { ok: true, packages: state ? toPublicPackages(state) : null },
    { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' } }
  );
}
