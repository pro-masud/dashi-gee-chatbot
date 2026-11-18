import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { OrderRecord, StoreSettingsDoc } from '../storeTypes';
import type {
  ChannelSource,
  ChatbotLogRecord,
  ChatbotSupportRequestRecord,
  MarketingConsentDoc,
  OrderDraftDoc,
  Phase5AttributionAnalytics,
} from './types';

export interface ParsedInboundChannelMessage {
  channel: 'messenger' | 'instagram' | 'whatsapp';
  eventId: string;
  senderId: string;
  displayName?: string;
  text: string;
  timestampMs: number;
}

/**
 * Verifies Meta (Messenger / Instagram / WhatsApp Cloud) X-Hub-Signature-256 header
 * using timingSafeEqual over the raw UTF-8 request body.
 */
export function verifyMetaWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  appSecret: string;
}): boolean {
  const secret = String(params.appSecret || '').trim();
  const header = String(params.signatureHeader || '').trim();
  if (!secret || !header.startsWith('sha256=')) {
    return false;
  }
  const providedHex = header.slice('sha256='.length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(providedHex)) {
    return false;
  }
  const expectedHex = createHmac('sha256', secret)
    .update(params.rawBody, 'utf8')
    .digest('hex');

  try {
    return timingSafeEqual(
      Buffer.from(providedHex, 'hex'),
      Buffer.from(expectedHex, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Rejects stale / replayed webhook timestamps outside allowed clock skew.
 */
export function isReplayTimestampValid(
  timestampMsOrSec: number,
  nowMs = Date.now(),
  maxSkewSec = 300
): boolean {
  if (!Number.isFinite(timestampMsOrSec) || timestampMsOrSec <= 0) {
    return false;
  }
  // Normalize Unix seconds (< 1e12) vs milliseconds
  const tsMs = timestampMsOrSec < 1e12 ? timestampMsOrSec * 1000 : timestampMsOrSec;
  return Math.abs(nowMs - tsMs) <= maxSkewSec * 1000;
}

export function buildChannelSessionId(
  channel: 'messenger' | 'instagram' | 'whatsapp',
  senderId: string
): string {
  const prefix =
    channel === 'whatsapp' ? 'ch_wa_' : channel === 'instagram' ? 'ch_ig_' : 'ch_msg_';
  const digest = createHash('sha256')
    .update(`${channel}:${String(senderId || '').trim()}`)
    .digest('hex')
    .slice(0, 24);
  return `${prefix}${digest}`;
}

export function parseMetaInboundWebhookEvents(body: unknown): ParsedInboundChannelMessage[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as Record<string, unknown>;
  const objectType = String(root.object || '').toLowerCase();
  if (objectType !== 'page' && objectType !== 'instagram') {
    return [];
  }
  const channel: 'messenger' | 'instagram' =
    objectType === 'instagram' ? 'instagram' : 'messenger';
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const results: ParsedInboundChannelMessage[] = [];

  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as Record<string, unknown>;
    const entryTime = Number(entry.time || Date.now());
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const rawEvent of messaging) {
      if (!rawEvent || typeof rawEvent !== 'object') continue;
      const ev = rawEvent as Record<string, unknown>;
      const sender = ev.sender as Record<string, unknown> | undefined;
      const message = ev.message as Record<string, unknown> | undefined;
      if (!sender || !message || message.is_echo === true) continue;
      const senderId = String(sender.id || '').trim();
      const text = String(message.text || '').trim();
      const mid = String(message.mid || '').trim();
      const ts = Number(ev.timestamp || entryTime || Date.now());
      if (!senderId || !text || !mid) continue;
      results.push({
        channel,
        eventId: `${channel}_${mid}`,
        senderId,
        text: text.slice(0, 800),
        timestampMs: ts < 1e12 ? ts * 1000 : ts,
      });
    }
  }
  return results;
}

export function parseWhatsAppCloudEvents(body: unknown): ParsedInboundChannelMessage[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as Record<string, unknown>;
  if (String(root.object || '').toLowerCase() !== 'whatsapp_business_account') {
    return [];
  }
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const results: ParsedInboundChannelMessage[] = [];

  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const changes = Array.isArray((rawEntry as Record<string, unknown>).changes)
      ? ((rawEntry as Record<string, unknown>).changes as Array<Record<string, unknown>>)
      : [];
    for (const change of changes) {
      const val = (change?.value || {}) as Record<string, unknown>;
      const contacts = Array.isArray(val.contacts)
        ? (val.contacts as Array<Record<string, unknown>>)
        : [];
      const contactProfile = (contacts[0]?.profile || {}) as Record<string, unknown>;
      const displayName = String(contactProfile.name || '').trim() || undefined;
      const messages = Array.isArray(val.messages)
        ? (val.messages as Array<Record<string, unknown>>)
        : [];
      for (const msg of messages) {
        if (!msg || String(msg.type || '') !== 'text') continue;
        const senderId = String(msg.from || '').trim();
        const eventId = String(msg.id || '').trim();
        const textObj = (msg.text || {}) as Record<string, unknown>;
        const text = String(textObj.body || '').trim();
        const tsRaw = Number(msg.timestamp || Math.floor(Date.now() / 1000));
        if (!senderId || !eventId || !text) continue;
        results.push({
          channel: 'whatsapp',
          eventId: `wa_${eventId}`,
          senderId,
          displayName,
          text: text.slice(0, 800),
          timestampMs: tsRaw < 1e12 ? tsRaw * 1000 : tsRaw,
        });
      }
    }
  }
  return results;
}

/**
 * Checks whether outbound reply is within WhatsApp's 24-hour customer-care service window.
 * Outside 24 hours, approved template messages and explicit opt-in are required.
 */
export function checkWhatsAppComplianceWindow(
  lastCustomerMsgAtIso: string | undefined,
  now = new Date()
): { within24hWindow: boolean; requiresTemplate: boolean; hoursElapsed: number } {
  const parsed = lastCustomerMsgAtIso ? Date.parse(lastCustomerMsgAtIso) : NaN;
  if (!Number.isFinite(parsed)) {
    return { within24hWindow: false, requiresTemplate: true, hoursElapsed: Infinity };
  }
  const hoursElapsed = Math.max(0, (now.getTime() - parsed) / (60 * 60 * 1000));
  const within24hWindow = hoursElapsed <= 24;
  return {
    within24hWindow,
    requiresTemplate: !within24hWindow,
    hoursElapsed: Number(hoursElapsed.toFixed(2)),
  };
}

export function getDhakaHour24(now = new Date()): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    hour12: false,
  }).format(now);
  const parsed = Number(formatted);
  return Number.isFinite(parsed) ? parsed % 24 : 12;
}

/**
 * Quiet hours in Bangladesh (22:00 - 08:00 Asia/Dhaka): proactive retention/recovery nudges
 * are held until daytime hours to respect customer rest and anti-spam rules.
 */
export function isWithinDhakaQuietHours(now = new Date()): boolean {
  const hour = getDhakaHour24(now);
  return hour >= 22 || hour < 8;
}

export function evaluateRetentionEligibility(params: {
  subscriber: MarketingConsentDoc;
  now?: Date;
  minCooldownHours?: number;
  maxCampaignsTotal?: number;
}): {
  eligible: boolean;
  reason: 'eligible' | 'opted_out' | 'unsubscribed' | 'quiet_hours' | 'frequency_cap';
} {
  const now = params.now ?? new Date();
  const minCooldownHours = params.minCooldownHours ?? 72;
  const maxCampaignsTotal = params.maxCampaignsTotal ?? 12;

  if (params.subscriber.unsubscribed) {
    return { eligible: false, reason: 'unsubscribed' };
  }
  if (!params.subscriber.optIn) {
    return { eligible: false, reason: 'opted_out' };
  }
  if (params.subscriber.quietHoursRespect && isWithinDhakaQuietHours(now)) {
    return { eligible: false, reason: 'quiet_hours' };
  }
  const count = params.subscriber.campaignCount ?? 0;
  if (count >= maxCampaignsTotal) {
    return { eligible: false, reason: 'frequency_cap' };
  }
  if (params.subscriber.lastCampaignAtIso) {
    const lastMs = Date.parse(params.subscriber.lastCampaignAtIso);
    if (Number.isFinite(lastMs)) {
      const hoursSince = (now.getTime() - lastMs) / (60 * 60 * 1000);
      if (hoursSince < minCooldownHours) {
        return { eligible: false, reason: 'frequency_cap' };
      }
    }
  }
  return { eligible: true, reason: 'eligible' };
}

export interface AbandonedDraftCandidate {
  draftId: string;
  sessionId: string;
  phone: string;
  customerName: string;
  weightLabel: string;
  idleMinutes: number;
  recoveryMessageBn: string;
  recoveryMessageEn: string;
}

/**
 * Identifies incomplete order drafts with valid BD phone numbers that have not resulted
 * in a completed order, strictly adhering to single-product non-spam recovery messaging.
 */
export function identifyAbandonedDraftCandidates(params: {
  drafts: OrderDraftDoc[];
  orders: OrderRecord[];
  suppressedPhones?: Set<string>;
  now?: Date;
  minIdleMinutes?: number;
}): AbandonedDraftCandidate[] {
  const nowMs = (params.now ?? new Date()).getTime();
  const minIdleMs = (params.minIdleMinutes ?? 30) * 60 * 1000;
  const recentOrderPhones = new Set(
    params.orders
      .filter((o) => o.status !== 'cancelled')
      .map((o) => String(o.phone || '').trim())
      .filter(Boolean)
  );
  const suppressed = params.suppressedPhones ?? new Set<string>();
  const out: AbandonedDraftCandidate[] = [];

  for (const d of params.drafts) {
    const phone = String(d.phone || '').trim();
    if (!/^01[3-9][0-9]{8}$/.test(phone)) continue;
    if (d.state === 'confirmed' || d.state === 'cancelled' || d.state === 'expired') continue;
    if (recentOrderPhones.has(phone) || suppressed.has(phone)) continue;

    const updatedMs =
      typeof d.updatedAt === 'number'
        ? d.updatedAt
        : typeof d.updatedAt === 'string'
          ? Date.parse(d.updatedAt)
          : d.expiresAt - 30 * 60 * 1000;
    const referenceMs = Number.isFinite(updatedMs) ? updatedMs : nowMs - minIdleMs;
    const idleMs = nowMs - referenceMs;
    if (idleMs < minIdleMs) continue;

    const qtySummary = [
      d.qty250g ? `${d.qty250g}x 250g` : '',
      d.qty500g ? `${d.qty500g}x 500g` : '',
      d.qty1kg ? `${d.qty1kg}x 1kg` : '',
    ]
      .filter(Boolean)
      .join(', ');
    const weightLabel = qtySummary || (d.weight ? `${d.qty || 1}x ${d.weight}` : 'Deshi Gee Jar');
    const name = (d.customerName || '').trim() || 'Customer';

    out.push({
      draftId: d.draftId,
      sessionId: d.sessionId,
      phone,
      customerName: name,
      weightLabel,
      idleMinutes: Math.max(1, Math.round(idleMs / 60000)),
      recoveryMessageBn: `আসসালামু আলাইকুম ${name}, আপনার ${weightLabel} পাবনার বিলোনার খাঁটি দেশী ঘি-এর অর্ডার ড্রাফটটি এখনো অপেক্ষমাণ আছে। চাইলে ওয়েবসাইটে ফিরে এসে অর্ডার কনফার্ম করতে পারেন।`,
      recoveryMessageEn: `Hello ${name}, your Deshi Gee (${weightLabel}) jar order draft is still saved if you would like to complete checkout whenever convenient.`,
    });
  }
  return out;
}

/**
 * Generates grounded, polite Human Inbox draft replies (Agent Assist) tailored to ticket
 * category and live order/payment snapshots—never promising unverified refunds or approvals.
 */
export function generateAgentAssistSuggestion(params: {
  ticket: ChatbotSupportRequestRecord;
  settings: StoreSettingsDoc;
  lang: 'bn' | 'en';
}): string {
  const { ticket, settings, lang } = params;
  const name = ticket.customerName || (lang === 'bn' ? 'সম্মানিত গ্রাহক' : 'Valued Customer');
  const orderRef = ticket.orderNumber ? ` (${ticket.orderNumber})` : '';
  const slaLabel =
    lang === 'bn'
      ? ticket.slaWindowLabelBn || 'অফিস সময়ের মধ্যে'
      : ticket.slaWindowLabelEn || 'within configured business hours';

  if (lang === 'bn') {
    switch (ticket.category) {
      case 'damaged_jar':
        return `আসসালামু আলাইকুম ${name}, আপনার অর্ডার${orderRef}-এর ড্যামেজ/সিল সংক্রান্ত অভিযোগ ও ছবি আমরা গ্রহণ করেছি। আমাদের টিম যাচাই করে ${slaLabel} সরাসরি আপনার সাথে পরবর্তী সমাধান নিয়ে যোগাযোগ করবে।`;
      case 'payment_dispute':
        return `আসসালামু আলাইকুম ${name}, আপনার অর্ডার${orderRef}-এর পেমেন্ট ভেরিফিকেশন অনুরোধটি আমরা চেক করছি। অ্যাকাউন্টস টিম Transaction ID যাচাই সম্পন্ন করে ${slaLabel} আপডেট জানাবে।`;
      case 'late_delivery':
        return `আসসালামু আলাইকুম ${name}, আপনার অর্ডার${orderRef}-এর ডেলিভারি বিলম্বের জন্য আন্তরিকভাবে দুঃখিত। আমরা কুরিয়ার টিমের সাথে পার্সেল স্ট্যাটাস যাচাই করছি এবং ${slaLabel} আপডেট জানাব।`;
      case 'refund_return':
        return `আসসালামু আলাইকুম ${name}, আপনার অর্ডার${orderRef}-এর রিটার্ন/রিফান্ড অনুরোধটি সাপোর্ট টিম পর্যালোচনা করছে। যাচাই সম্পন্ন হওয়ার পর ${slaLabel} আপনাকে নিশ্চিত করা হবে।`;
      default:
        return `আসসালামু আলাইকুম ${name}, আমি Deshi Gee সাপোর্ট টিম থেকে বলছি। আপনার অনুরোধ${orderRef} আমরা গুরুত্বসহকারে দেখছি এবং ${slaLabel} সহায়তা করব। প্রয়োজনে সরাসরি ${settings.supportPhone}-এও কল করতে পারেন।`;
    }
  }

  switch (ticket.category) {
    case 'damaged_jar':
      return `Hello ${name}, thank you for sharing the details and photo for order${orderRef}. Our team is reviewing your case right now and will reach out ${slaLabel} with the verified next steps.`;
    case 'payment_dispute':
      return `Hello ${name}, we are verifying the payment reference for order${orderRef} with our accounts team. We will confirm the updated payment status ${slaLabel}.`;
    case 'late_delivery':
      return `Hello ${name}, we apologize for the delay on order${orderRef}. We are checking directly with our courier partner and will update you ${slaLabel}.`;
    case 'refund_return':
      return `Hello ${name}, our support team is reviewing your return request for order${orderRef} against our store policy and will follow up ${slaLabel}.`;
    default:
      return `Hello ${name}, thank you for contacting Deshi Gee Support regarding your request${orderRef}. A team member is reviewing your details and will assist you ${slaLabel}.`;
  }
}

export function computePhase5AttributionAnalytics(params: {
  logs: ChatbotLogRecord[];
  drafts: OrderDraftDoc[];
  orders: OrderRecord[];
  supportRequests: ChatbotSupportRequestRecord[];
}): Phase5AttributionAnalytics {
  const startedSessions = new Set<string>();
  const productInfoSessions = new Set<string>();
  const orderIntentSessions = new Set<string>();
  const summarySessions = new Set<string>();
  const sessionChannelMap = new Map<string, ChannelSource>();

  for (const log of params.logs) {
    if (log.isTestPlayground || !log.sessionId) continue;
    const ch: ChannelSource = log.channel || 'web';
    sessionChannelMap.set(log.sessionId, ch);
    startedSessions.add(log.sessionId);

    const intent = String(log.intent || '').toLowerCase();
    if (
      intent.includes('product') ||
      intent.includes('pricing') ||
      intent.includes('offer') ||
      intent.includes('delivery')
    ) {
      productInfoSessions.add(log.sessionId);
    }
    if (intent.includes('order')) {
      orderIntentSessions.add(log.sessionId);
    }
  }

  for (const draft of params.drafts) {
    if (!draft.sessionId) continue;
    if (!sessionChannelMap.has(draft.sessionId)) {
      sessionChannelMap.set(draft.sessionId, 'web');
    }
    startedSessions.add(draft.sessionId);
    orderIntentSessions.add(draft.sessionId);
    if (
      draft.state === 'quote_ready' ||
      draft.state === 'awaiting_confirmation' ||
      draft.state === 'confirmed'
    ) {
      summarySessions.add(draft.sessionId);
    }
  }

  const attributedOrders = params.orders.filter(
    (o) =>
      o.status !== 'cancelled' &&
      (Boolean(o.attributedSessionId) ||
        String(o.note || '').toLowerCase().includes('deshi gee ai assistant') ||
        Boolean(o.sourceChannel))
  );
  const deliveredOrders = attributedOrders.filter((o) => o.status === 'delivered');
  const revenueBdt = attributedOrders.reduce(
    (sum, o) => sum + (Number(o.totalBdt) || 0),
    0
  );
  const aovBdt =
    attributedOrders.length > 0 ? Math.round(revenueBdt / attributedOrders.length) : 0;
  const chatToOrderPct =
    startedSessions.size > 0
      ? Number(((attributedOrders.length / startedSessions.size) * 100).toFixed(1))
      : 0;

  const allChannels: ChannelSource[] = [
    'web',
    'messenger',
    'instagram',
    'whatsapp',
    'email',
    'sms',
  ];
  const channels = allChannels
    .map((ch) => {
      const chSessions = Array.from(sessionChannelMap.entries()).filter(
        ([, val]) => val === ch
      ).length;
      const chOrders = attributedOrders.filter(
        (o) => (o.sourceChannel || 'web') === ch
      );
      const chRev = chOrders.reduce((s, o) => s + (Number(o.totalBdt) || 0), 0);
      const chTickets = params.supportRequests.filter(
        (t) => (t.channel || 'web') === ch
      ).length;
      return {
        channel: ch,
        sessions: chSessions,
        orders: chOrders.length,
        revenueBdt: chRev,
        handoverTickets: chTickets,
        conversionPct:
          chSessions > 0 ? Number(((chOrders.length / chSessions) * 100).toFixed(1)) : 0,
      };
    })
    .filter((row) => row.channel === 'web' || row.sessions > 0 || row.orders > 0 || row.handoverTickets > 0);

  return {
    funnel: {
      chatStartedSessions: startedSessions.size,
      productInfoSessions: productInfoSessions.size,
      orderIntentSessions: orderIntentSessions.size,
      summaryShownSessions: summarySessions.size,
      confirmedOrdersCount: attributedOrders.length,
      deliveredOrdersCount: deliveredOrders.length,
      attributedRevenueBdt: revenueBdt,
      attributedAovBdt: aovBdt,
      chatToOrderPct,
    },
    channels,
  };
}
