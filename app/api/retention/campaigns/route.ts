import { isWithinDhakaQuietHours } from '../../../../src/lib/chatbot/channelEngine';
import {
  checkAndIncrementFirestoreRateLimit,
  dispatchConsentRetentionCampaign,
  fetchAdminMarketingConsents,
  fetchServerChatbotConfig,
  fetchServerOrderTracking,
  upsertMarketingConsent,
  verifyServerAdminToken,
} from '../../../../src/lib/chatbot/firestoreRest';
import { isValidBangladeshPhone, normalizeBangladeshPhone } from '../../../../src/lib/chatbot/orderToken';
import { extractClientIp, hashIdentifier } from '../../../../src/lib/chatbot/rateLimit';
import { sanitizeChannelSource } from '../../../../src/lib/chatbot/schema';
import { verifySignedUnsubscribeToken } from '../../../../src/lib/chatbot/sessionAuth';
import type { MarketingConsentDoc } from '../../../../src/lib/chatbot/types';

function isAuthorizedCronOrAdmin(authHeader: string | null): boolean {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }
  return false;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const isCron = isAuthorizedCronOrAdmin(authHeader);
  const adminCheck = isCron
    ? { ok: true, email: 'cron-job', uid: 'cron' }
    : await verifyServerAdminToken(authHeader);

  if (!adminCheck.ok) {
    return Response.json(
      { ok: false, error: 'Admin authentication or CRON_SECRET required.' },
      { status: 401 }
    );
  }

  const adminToken = !isCron && authHeader ? authHeader.slice(7).trim() : undefined;
  const [consents, previewSummary] = await Promise.all([
    fetchAdminMarketingConsents(adminToken),
    dispatchConsentRetentionCampaign({
      segment: 'abandoned_drafts',
      channel: 'whatsapp',
      dryRun: true,
      adminIdToken: adminToken,
    }),
  ]);

  const suppressedCount = consents.filter((c) => c.unsubscribed || !c.optIn).length;
  const optedInCount = consents.filter((c) => !c.unsubscribed && c.optIn).length;

  return Response.json({
    ok: true,
    withinDhakaQuietHours: isWithinDhakaQuietHours(),
    optedInCount,
    suppressedCount,
    consents,
    abandonedCandidates: previewSummary.abandonedCandidates,
    previewSummary,
  });
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: 'Malformed JSON payload.' }, { status: 400 });
  }

  const action = String(body.action || 'dispatch').trim();

  if (action === 'consent' || action === 'unsubscribe') {
    const ipHash = hashIdentifier(`ret_consent_ip:${extractClientIp(request)}`);
    const rl = await checkAndIncrementFirestoreRateLimit(`ret_consent_min_${ipHash}`, 20, 60_000);
    if (!rl.allowed) {
      return Response.json(
        { ok: false, error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.max(15, rl.retryAfterSec)) },
        }
      );
    }

    const authHeader = request.headers.get('authorization');
    const adminCheck = authHeader ? await verifyServerAdminToken(authHeader) : { ok: false };

    if (!adminCheck.ok && request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
      return Response.json(
        { ok: false, error: 'Invalid storefront origin header.' },
        { status: 403 }
      );
    }

    const phone = normalizeBangladeshPhone(String(body.phone || ''));
    if (!isValidBangladeshPhone(phone)) {
      return Response.json(
        { ok: false, error: 'Valid 11-digit Bangladesh mobile number (01XXXXXXXXX) is required.' },
        { status: 400 }
      );
    }

    // S0-03: Require phone ownership proof unless called by a verified Admin.
    // Proof must be either a valid signed unsubscribe/consent token bound to `phone`
    // OR an existing Order ID + matching checkout phone verified server-side.
    let ownershipVerified = adminCheck.ok;
    if (!ownershipVerified) {
      const signedToken = String(body.unsubscribeToken || body.consentToken || '').trim();
      if (signedToken && verifySignedUnsubscribeToken(signedToken, phone)) {
        ownershipVerified = true;
      }
    }
    if (!ownershipVerified) {
      const orderNumber = String(body.orderNumber || '').trim().toUpperCase();
      if (/^DG-\d{4,8}$/.test(orderNumber)) {
        const tracking = await fetchServerOrderTracking(orderNumber, phone);
        if (tracking) {
          ownershipVerified = true;
        }
      }
    }

    if (!ownershipVerified) {
      return Response.json(
        {
          ok: false,
          error:
            'Phone ownership verification failed. Provide a matching Order ID + phone or a valid signed token.',
        },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const channel = sanitizeChannelSource(body.channel, 'web');
    const sourceRaw = String(body.source || 'track_order').trim();
    const validSources = new Set<MarketingConsentDoc['source']>([
      'checkout',
      'chat',
      'track_order',
      'whatsapp',
      'admin',
    ]);
    const source: MarketingConsentDoc['source'] = validSources.has(
      sourceRaw as MarketingConsentDoc['source']
    )
      ? (sourceRaw as MarketingConsentDoc['source'])
      : 'track_order';

    const unsubscribed = action === 'unsubscribe' || body.unsubscribed === true;
    const optIn = unsubscribed ? false : body.optIn !== false;

    const result = await upsertMarketingConsent({
      phone,
      customerName: typeof body.customerName === 'string' ? body.customerName : undefined,
      channel,
      optIn,
      unsubscribed,
      source,
      quietHoursRespect: body.quietHoursRespect !== false,
    });

    if (!result.ok) {
      return Response.json({ ok: false, error: result.error || 'Could not update consent.' }, { status: 400 });
    }

    return Response.json({
      ok: true,
      unsubscribed,
      record: result.record,
    });
  }

  // Admin or Cron campaign dispatch / dry-run preview
  const authHeader = request.headers.get('authorization');
  const isCron = isAuthorizedCronOrAdmin(authHeader);
  const adminCheck = isCron
    ? { ok: true, email: 'cron-job', uid: 'cron' }
    : await verifyServerAdminToken(authHeader);

  if (!adminCheck.ok) {
    return Response.json(
      { ok: false, error: 'Admin authentication or CRON_SECRET required.' },
      { status: 401 }
    );
  }

  const adminToken = !isCron && authHeader ? authHeader.slice(7).trim() : undefined;
  const segment =
    body.segment === 'subscribed_customers' ? 'subscribed_customers' : 'abandoned_drafts';
  const chRaw = sanitizeChannelSource(body.channel, 'whatsapp');
  const channel = chRaw === 'web' ? 'whatsapp' : chRaw;
  const dryRun = body.dryRun !== false;
  const now =
    typeof body.nowIso === 'string' && Number.isFinite(Date.parse(body.nowIso))
      ? new Date(body.nowIso)
      : new Date();

  await fetchServerChatbotConfig('published');

  const summary = await dispatchConsentRetentionCampaign({
    segment,
    channel,
    dryRun,
    now,
    adminIdToken: adminToken,
  });

  return Response.json(summary);
}
