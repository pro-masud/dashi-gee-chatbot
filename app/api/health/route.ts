import { NextResponse } from 'next/server';
import { buildRuntimeHealthReport } from '../../../src/lib/chatbot/runtimeHealth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bypassCache = url.searchParams.get('refresh') === '1';

  const report = await buildRuntimeHealthReport({ bypassCache });
  const httpStatus =
    !report.supportedModelConfigured || !report.checks.sdk.compatible ? 503 : 200;

  return NextResponse.json(report, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
