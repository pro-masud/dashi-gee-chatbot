import { NextResponse } from 'next/server';
import { buildRuntimeHealthReport } from '../../../src/lib/chatbot/runtimeHealth';
import {
  checkAndIncrementFirestoreRateLimit,
  verifyServerAdminToken,
} from '../../../src/lib/chatbot/firestoreRest';
import { hashIdentifier } from '../../../src/lib/chatbot/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * 0-01 Hardened Health Endpoint:
 * - Unauthenticated callers receive only minimal liveness `{ ok, status, timestamp }`
 *   and cannot trigger `?refresh=1` remote paid probes or inspect internal model/SDK details.
 * - Authenticated Admin callers (Bearer Firebase ID token) receive the full diagnostic
 *   RuntimeHealthReport and may trigger rate-limited `?refresh=1` probes.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const wantsRefresh = url.searchParams.get('refresh') === '1';
  const authHeader = request.headers.get('authorization');

  const adminCheck = authHeader
    ? await verifyServerAdminToken(authHeader)
    : { ok: false, email: '', uid: '' };

  if (adminCheck.ok && wantsRefresh) {
    const adminHash = hashIdentifier(`health_refresh:${adminCheck.uid || adminCheck.email}`);
    const rl = await checkAndIncrementFirestoreRateLimit(`health_ref_${adminHash}`, 6, 300_000);
    if (!rl.allowed) {
      return NextResponse.json(
        {
          ok: false,
          code: 'rate_limited',
          error: 'Too many health refresh probes. Please wait a few minutes.',
        },
        {
          status: 429,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }
  }

  const report = await buildRuntimeHealthReport({
    bypassCache: adminCheck.ok && wantsRefresh,
  });
  const httpStatus =
    !report.supportedModelConfigured || !report.checks.sdk.compatible ? 503 : 200;

  if (!adminCheck.ok) {
    return NextResponse.json(
      {
        ok: report.ok,
        status: report.status,
        timestamp: report.timestamp,
      },
      {
        status: httpStatus,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  return NextResponse.json(report, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
