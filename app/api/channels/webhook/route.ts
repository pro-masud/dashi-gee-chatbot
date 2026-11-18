import { timingSafeEqual } from 'crypto';
import {
  buildChannelSessionId,
  checkWhatsAppComplianceWindow,
  isReplayTimestampValid,
  parseMetaInboundWebhookEvents,
  parseWhatsAppCloudEvents,
  verifyMetaWebhookSignature,
} from '../../../../src/lib/chatbot/channelEngine';
import {
  createServerChatLog,
  fetchServerBatchRecord,
  fetchServerChatbotConfig,
  fetchServerChatbotFaqs,
  fetchServerStoreSettings,
  linkSessionVerifiedPhone,
  recordOrCheckWebhookEventIdempotency,
  upsertMarketingConsent,
} from '../../../../src/lib/chatbot/firestoreRest';
import { generateLiveFallbackReply } from '../../../../src/lib/chatbot/liveFallbackEngine';
import { isValidBangladeshPhone, normalizeBangladeshPhone } from '../../../../src/lib/chatbot/orderToken';
import { validateChatbotResponse } from '../../../../src/lib/chatbot/responseValidator';
import { detectLanguageAndSignals } from '../../../../src/lib/chatbot/security';
import {
  applySlotsToOrderDraft,
  buildInitialSessionDoc,
  extractOrderSlotsFromText,
  loadSessionAndDraft,
  saveSessionAndDraft,
} from '../../../../src/lib/chatbot/sessionStore';
import {
  buildStoreFactsSnapshot,
  getSeededVerifiedMonetaryAmounts,
} from '../../../../src/lib/chatbot/storeFacts';

function timingSafeTokenMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Meta / WhatsApp Cloud Webhook verification handshake (GET).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode') || '';
  const verifyToken = url.searchParams.get('hub.verify_token') || '';
  const challenge = url.searchParams.get('hub.challenge') || '';

  const configuredToken = String(process.env.META_VERIFY_TOKEN || '').trim();
  if (
    mode === 'subscribe' &&
    configuredToken &&
    challenge &&
    timingSafeTokenMatch(verifyToken, configuredToken)
  ) {
    return new Response(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return Response.json(
    { ok: false, error: 'Webhook verification failed.' },
    { status: 403 }
  );
}

async function sendMetaOrWhatsAppReply(params: {
  channel: 'messenger' | 'instagram' | 'whatsapp';
  recipientId: string;
  text: string;
}): Promise<{ status: 'sent' | 'queued_token_missing' | 'failed'; detail: string }> {
  if (params.channel === 'whatsapp') {
    const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    if (!token || !phoneNumberId) {
      return {
        status: 'queued_token_missing',
        detail: 'WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not configured.',
      };
    }
    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: params.recipientId,
            type: 'text',
            text: { body: params.text.slice(0, 1500) },
          }),
          cache: 'no-store',
        }
      );
      return res.ok
        ? { status: 'sent', detail: 'WhatsApp Cloud message sent.' }
        : { status: 'failed', detail: `WhatsApp Graph HTTP ${res.status}` };
    } catch (err) {
      return {
        status: 'failed',
        detail: err instanceof Error ? err.message : 'WhatsApp send failed',
      };
    }
  }

  const pageToken = String(process.env.META_PAGE_ACCESS_TOKEN || '').trim();
  if (!pageToken) {
    return {
      status: 'queued_token_missing',
      detail: 'META_PAGE_ACCESS_TOKEN not configured.',
    };
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: params.recipientId },
          message: { text: params.text.slice(0, 1500) },
        }),
        cache: 'no-store',
      }
    );
    return res.ok
      ? { status: 'sent', detail: `${params.channel} Graph message sent.` }
      : { status: 'failed', detail: `Meta Graph HTTP ${res.status}` };
  } catch (err) {
    return {
      status: 'failed',
      detail: err instanceof Error ? err.message : 'Meta Graph send failed',
    };
  }
}

/**
 * Inbound Meta (Messenger / Instagram) and WhatsApp Cloud webhook handler (POST).
 */
export async function POST(request: Request) {
  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  let parsedBody: Record<string, unknown> = {};
  try {
    parsedBody = JSON.parse(rawBody || '{}') as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: 'Malformed JSON body.' }, { status: 400 });
  }

  const objectType = String(parsedBody.object || '').toLowerCase();
  const isWhatsApp = objectType === 'whatsapp_business_account';
  const appSecret = isWhatsApp
    ? String(process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET || '').trim()
    : String(process.env.META_APP_SECRET || '').trim();

  const signatureValid = verifyMetaWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get('x-hub-signature-256'),
    appSecret,
  });

  if (!signatureValid) {
    return Response.json(
      { ok: false, error: 'Invalid or missing X-Hub-Signature-256.' },
      { status: 403 }
    );
  }

  const inboundEvents = isWhatsApp
    ? parseWhatsAppCloudEvents(parsedBody)
    : parseMetaInboundWebhookEvents(parsedBody);

  if (inboundEvents.length === 0) {
    return Response.json({ ok: true, processed: 0, results: [] });
  }

  const [config, settings, faqs] = await Promise.all([
    fetchServerChatbotConfig('published'),
    fetchServerStoreSettings(),
    fetchServerChatbotFaqs(false),
  ]);
  const batch = await fetchServerBatchRecord(settings.activeBatchCode);
  const facts = buildStoreFactsSnapshot({ settings, batch, config });

  const results: Array<Record<string, unknown>> = [];
  const nowMs = Date.now();

  for (const ev of inboundEvents) {
    if (!isReplayTimestampValid(ev.timestampMs, nowMs, 300)) {
      await recordOrCheckWebhookEventIdempotency({
        channel: ev.channel,
        eventId: ev.eventId,
        senderId: ev.senderId,
        status: 'rejected',
      });
      results.push({
        eventId: ev.eventId,
        channel: ev.channel,
        status: 'rejected_replay',
      });
      continue;
    }

    const phoneMatch = ev.text.match(/(?:\+?88)?(01[3-9][-\s]?\d{8})/);
    const candidatePhone = phoneMatch ? normalizeBangladeshPhone(phoneMatch[0]) : '';
    const senderNormalized = ev.channel === 'whatsapp' ? normalizeBangladeshPhone(ev.senderId) : '';
    const verifiedPhone = isValidBangladeshPhone(candidatePhone)
      ? candidatePhone
      : isValidBangladeshPhone(senderNormalized)
        ? senderNormalized
        : '';

    const idem = await recordOrCheckWebhookEventIdempotency({
      channel: ev.channel,
      eventId: ev.eventId,
      senderId: ev.senderId,
      verifiedPhone: verifiedPhone || undefined,
      status: 'processed',
    });

    if (idem.isDuplicate) {
      results.push({
        eventId: ev.eventId,
        channel: ev.channel,
        status: 'duplicate',
      });
      continue;
    }

    const sessionId = buildChannelSessionId(ev.channel, ev.senderId);
    const sessionState = await loadSessionAndDraft(sessionId);

    if (verifiedPhone) {
      await linkSessionVerifiedPhone({
        sessionId,
        phone: verifiedPhone,
        channel: ev.channel,
        externalUserId: ev.senderId,
      });

      if (/^(stop|unsubscribe|opt\s*out|বন্ধ)\b/i.test(ev.text.trim())) {
        await upsertMarketingConsent({
          phone: verifiedPhone,
          customerName: ev.displayName,
          channel: ev.channel,
          optIn: false,
          unsubscribed: true,
          source: ev.channel === 'whatsapp' ? 'whatsapp' : 'chat',
        });
      }
    }

    const langRes = detectLanguageAndSignals(
      ev.text,
      config.languageBehavior,
      'bn',
      sessionState.session?.lockedLang
    );

    if (sessionState.session?.aiPaused) {
      results.push({
        eventId: ev.eventId,
        sessionId,
        channel: ev.channel,
        status: 'paused_for_human',
        verifiedPhone: verifiedPhone || undefined,
      });
      continue;
    }

    const extracted = extractOrderSlotsFromText(ev.text, sessionState.draft);
    const hasOrderCue =
      Boolean(sessionState.draft) ||
      Boolean(extracted.phone || extracted.address || extracted.weight || extracted.qty);
    const nextDraft = hasOrderCue
      ? applySlotsToOrderDraft({
          sessionId,
          currentDraft: sessionState.draft,
          extracted,
          settings,
        }).draft
      : sessionState.draft;

    const fallback = generateLiveFallbackReply({
      userMessage: ev.text,
      replyLang: langRes.replyLang,
      settings,
      batch,
      config,
      matchedFaqs: faqs,
      activeDraft: nextDraft,
      facts,
    });

    const verifiedAmounts = getSeededVerifiedMonetaryAmounts(facts);
    for (const amt of fallback.extraVerifiedAmounts || []) {
      if (Number.isFinite(amt) && amt > 0) {
        verifiedAmounts.add(Math.round(amt));
      }
    }

    const guard = validateChatbotResponse({
      replyText: fallback.replyText,
      replyLang: langRes.replyLang,
      settings,
      config,
      verifiedMonetaryAmounts: Array.from(verifiedAmounts),
      hasPreparedOrderSummary: false,
      customerPhoneInTurn: verifiedPhone || sessionState.session?.linkedPhone || undefined,
      isMixedQuestion: false,
    });
    const safeReply = guard.passed
      ? fallback.replyText
      : langRes.replyLang === 'bn'
        ? config.fallbackMessageBn
        : config.fallbackMessageEn;

    const sessionDoc = buildInitialSessionDoc(sessionId, sessionState.session, {
      replyLang: langRes.replyLang,
      explicitSwitchRequested: langRes.explicitSwitchRequested,
      scriptPreference: langRes.scriptPreference,
      intent: fallback.intent,
      orderDraftId: nextDraft?.draftId,
      channel: ev.channel,
      externalUserId: ev.senderId,
      linkedPhone: verifiedPhone || sessionState.session?.linkedPhone || '',
    });

    await Promise.all([
      saveSessionAndDraft({ session: sessionDoc, draft: nextDraft }),
      createServerChatLog({
        sessionId,
        channel: ev.channel,
        lang: langRes.detectedInputLang,
        userMessage: ev.text,
        assistantReply: safeReply,
        intent: fallback.intent,
        isUnanswered: Boolean(fallback.noVerifiedInfo),
        isError: false,
        handoverRequested: false,
        latencyMs: Math.max(1, Date.now() - nowMs),
        promptTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        errorCode: '',
        isTestPlayground: false,
        path: 'fallback',
        model: `channel-${ev.channel}-engine`,
        factsVersion: fallback.factsVersion,
        confidence: 0.9,
      }),
    ]);

    let delivery: { status: string; detail: string } = {
      status: 'skipped_outside_24h_window',
      detail: 'Outside WhatsApp 24-hour customer care window.',
    };

    const waWindow =
      ev.channel === 'whatsapp'
        ? checkWhatsAppComplianceWindow(new Date(ev.timestampMs).toISOString(), new Date(nowMs))
        : { within24hWindow: true };

    if (waWindow.within24hWindow) {
      delivery = await sendMetaOrWhatsAppReply({
        channel: ev.channel,
        recipientId: ev.senderId,
        text: safeReply,
      });
    }

    results.push({
      eventId: ev.eventId,
      sessionId,
      channel: ev.channel,
      intent: fallback.intent,
      replyText: safeReply,
      verifiedPhone: verifiedPhone || sessionDoc.linkedPhone || undefined,
      deliveryStatus: delivery.status,
      deliveryDetail: delivery.detail,
      status: 'processed',
    });
  }

  return Response.json({
    ok: true,
    processed: results.filter((r) => r.status === 'processed').length,
    results,
  });
}
