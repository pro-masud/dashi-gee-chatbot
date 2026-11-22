import { NextResponse } from 'next/server';
import { toPublicTracking } from '../../../../src/lib/marketing/marketing';
import { readPublicTrackingBestEffort } from '../../../../src/lib/server/marketingRepository';

export const dynamic = 'force-dynamic';

/** GET /api/tracking/config — public tracking ids only. Never includes the CAPI token or test code. */
export async function GET() {
  const s = await readPublicTrackingBestEffort();
  return NextResponse.json(
    { ok: true, tracking: s ? toPublicTracking(s) : null },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } }
  );
}
