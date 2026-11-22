import { NextResponse } from 'next/server';
import { readPublishedBestEffort } from '../../../../src/lib/server/cmsRepository';

export const dynamic = 'force-dynamic';

/** GET /api/cms/published — the live landing-page content (plain text only; null = use defaults). */
export async function GET() {
  const content = await readPublishedBestEffort();
  return NextResponse.json(
    { ok: true, content },
    { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' } }
  );
}
