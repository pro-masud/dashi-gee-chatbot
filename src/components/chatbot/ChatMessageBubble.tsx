'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Edit3,
  ExternalLink,
  Headset,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  PackageCheck,
  Phone,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Truck,
  Volume2,
} from 'lucide-react';
import { formatBdt } from '../../data/deshiGeeData';
import type {
  ChatActionItem,
  ChatMessageItem,
  FeedbackReason,
  OrderSummaryCard,
} from '../../lib/chatbot/types';

function renderInlineBold(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-[#1E1710]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function FormattedMessageText({ text, isUser }: { text: string; isUser: boolean }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5 break-words text-[13.5px] leading-relaxed">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;
        const isBullet = /^[-*•]\s+/.test(trimmed);
        if (isBullet) {
          return (
            <div key={i} className="flex items-start gap-1.5 pl-0.5">
              <span className={isUser ? 'text-[#E8DFC5]' : 'text-[#B47B2B]'}>•</span>
              <span>{renderInlineBold(trimmed.replace(/^[-*•]\s+/, ''))}</span>
            </div>
          );
        }
        return <p key={i}>{renderInlineBold(line)}</p>;
      })}
    </div>
  );
}

const TRACKING_STEPS = [
  { key: 'pending', labelEn: 'Pending', labelBn: 'গৃহীত', Icon: Clock },
  { key: 'confirmed', labelEn: 'Confirmed', labelBn: 'নিশ্চিত', Icon: CheckCircle2 },
  { key: 'processing', labelEn: 'Packed', labelBn: 'প্রস্তুত', Icon: Package },
  { key: 'shipped', labelEn: 'Shipped', labelBn: 'পথে', Icon: Truck },
  { key: 'delivered', labelEn: 'Delivered', labelBn: 'পৌঁছেছে', Icon: PackageCheck },
] as const;

const FEEDBACK_REASONS: { id: Exclude<FeedbackReason, ''>; labelEn: string; labelBn: string }[] = [
  { id: 'wrong_price', labelEn: 'Wrong price/info', labelBn: 'ভুল দাম/তথ্য' },
  { id: 'unclear', labelEn: 'Unclear reply', labelBn: 'উত্তর অস্পষ্ট' },
  { id: 'missing_info', labelEn: 'Missing detail', labelBn: 'তথ্য অসম্পূর্ণ' },
  { id: 'wrong_language', labelEn: 'Wrong language', labelBn: 'ভাষা ঠিক নেই' },
  { id: 'other', labelEn: 'Other', labelBn: 'অন্যান্য' },
];

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ChatMessageBubble({
  msg,
  lang,
  onRetry,
  onNavigateTrack,
  onConfirmOrder,
  onEditOrder,
  confirmingOrderMsgId,
  showDiagnostics = false,
  isLatestAssistant = false,
  onSelectProductVariant,
  onSuggestedReply,
  onSubmitFeedback,
  onSpeakMessage,
  speakingMsgId,
  loadingAudioMsgId,
}: {
  msg: ChatMessageItem;
  lang: 'en' | 'bn';
  onRetry?: (prompt: string) => void;
  onNavigateTrack?: (orderNumber: string) => void;
  onConfirmOrder?: (msgId: string, summary: OrderSummaryCard) => void;
  onEditOrder?: (msgId: string, summary: OrderSummaryCard) => void;
  confirmingOrderMsgId?: string | null;
  showDiagnostics?: boolean;
  isLatestAssistant?: boolean;
  onSelectProductVariant?: (weight: '250g' | '500g' | '1kg') => void;
  onSuggestedReply?: (text: string) => void;
  onSubmitFeedback?: (
    msgId: string,
    rating: 'up' | 'down',
    reason?: FeedbackReason
  ) => Promise<void> | void;
  onSpeakMessage?: (msgId: string, text: string) => Promise<void> | void;
  speakingMsgId?: string | null;
  loadingAudioMsgId?: string | null;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [showReasonPicker, setShowReasonPicker] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const bn = lang === 'bn';
  const isUser = msg.role === 'user';
  const isConfirmingThis = confirmingOrderMsgId === msg.id;

  const summary = msg.orderSummary;
  const hasActiveExpiry = Boolean(
    !isUser && summary?.expiresAt && !summary.orderNumber && !summary.confirmed
  );

  useEffect(() => {
    if (!hasActiveExpiry) return;
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [hasActiveExpiry, summary?.expiresAt]);

  const remainingMs =
    hasActiveExpiry && summary?.expiresAt ? Math.max(0, summary.expiresAt - nowMs) : null;
  const isQuoteExpired = remainingMs !== null && remainingMs <= 0;

  const handleCopyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(key);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const renderActionIcon = (type: ChatActionItem['type']) => {
    switch (type) {
      case 'call':
        return <Phone className="h-3.5 w-3.5" />;
      case 'whatsapp':
        return <MessageCircle className="h-3.5 w-3.5" />;
      case 'maps':
        return <MapPin className="h-3.5 w-3.5" />;
      case 'directions':
        return <Navigation className="h-3.5 w-3.5" />;
      case 'copy_phone':
        return copiedId === 'phone' ? (
          <Check className="h-3.5 w-3.5 text-emerald-700" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        );
      case 'reorder':
        return <ShoppingBag className="h-3.5 w-3.5" />;
      case 'open_url':
        return <Truck className="h-3.5 w-3.5" />;
      default:
        return <PackageCheck className="h-3.5 w-3.5" />;
    }
  };

  const canConfirm = Boolean(
    !isUser &&
      summary &&
      !summary.orderNumber &&
      summary.confirmationToken &&
      !summary.confirmed &&
      onConfirmOrder
  );

  const trackingStatusNorm = (msg.trackingCard?.status || '').toLowerCase();
  const activeTrackIdx = TRACKING_STEPS.findIndex((s) => trackingStatusNorm.includes(s.key));
  const resolvedTrackIdx = activeTrackIdx >= 0 ? activeTrackIdx : 0;

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 shadow-xs ${
          isUser
            ? 'rounded-br-sm bg-[#1E1710] text-[#FAF7F2]'
            : msg.isError
              ? 'rounded-bl-sm border border-red-300 bg-red-50/90 text-[#1E1710]'
              : msg.isAgentReply
                ? 'rounded-bl-sm border border-emerald-300 bg-emerald-50/75 text-[#1E1710]'
                : 'rounded-bl-sm border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] text-[#1E1710]'
        }`}
      >
        {!isUser && (
          <div
            className={`mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${
              msg.isAgentReply ? 'text-emerald-800' : 'text-[#8A5A17]'
            }`}
          >
            {msg.isAgentReply ? (
              <>
                <Headset className="h-3 w-3" />
                <span>
                  {msg.agentName || (bn ? 'হিউম্যান সাপোর্ট এজেন্ট' : 'Human Support Agent')}
                </span>
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                <span>{bn ? 'দেশী ঘি অ্যাসিস্ট্যান্ট' : 'Deshi Gee Assistant'}</span>
              </>
            )}
          </div>
        )}

        <FormattedMessageText text={msg.text} isUser={isUser} />

        {/* Product Comparison & Recommendation Cards */}
        {!isUser && msg.productCards && msg.productCards.length > 0 && (
          <div className="mt-3 space-y-2">
            {msg.productCards.map((card) => (
              <div
                key={card.weight}
                className={`rounded-xl border p-2.5 text-xs transition-colors ${
                  card.recommended
                    ? 'border-[rgba(180,123,43,0.55)] bg-[#F2ECE1]/70'
                    : 'border-[rgba(30,23,16,0.12)] bg-[#FAF7F2]/80'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-[#1E1710]">
                        {bn ? card.labelBn : card.labelEn}
                      </span>
                      {card.recommended && (
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#8A5A17]">
                          · {bn ? 'প্রস্তাবিত' : 'Recommended'}
                        </span>
                      )}
                    </div>
                    {(bn ? card.reasonBn : card.reasonEn) && (
                      <p className="mt-0.5 text-[11px] text-[#635647]">
                        {bn ? card.reasonBn : card.reasonEn}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[10.5px] text-[#635647]">
                      {card.inStock
                        ? bn
                          ? `স্টক: ${card.stockJars}টি জার`
                          : `In stock: ${card.stockJars} jars`
                        : bn
                          ? 'স্টক শেষ'
                          : 'Out of stock'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm font-semibold tabular-nums text-[#8A5A17]">
                      {formatBdt(card.priceBdt)}
                    </p>
                  </div>
                </div>
                {card.inStock && onSelectProductVariant && (
                  <button
                    type="button"
                    onClick={() => onSelectProductVariant(card.weight)}
                    className="mt-2 inline-flex min-h-[40px] w-full items-center justify-center rounded-lg border border-[rgba(180,123,43,0.45)] bg-[#FFFDF9] px-3 py-1.5 text-[11px] font-semibold text-[#1E1710] transition-colors hover:bg-[#B47B2B] hover:text-[#FFFDF9]"
                  >
                    {bn ? `${card.weight} জার অর্ডার করুন` : `Order ${card.weight} Jar`}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Order Tracking Timeline Card */}
        {!isUser && msg.trackingCard && (
          <div className="mt-3 rounded-xl border border-[rgba(180,123,43,0.35)] bg-[#F2ECE1]/70 p-3 text-xs text-[#1E1710]">
            <div className="flex items-center justify-between gap-2 border-b border-[rgba(30,23,16,0.1)] pb-1.5">
              <span className="font-mono text-[11.5px] font-semibold text-[#1E1710]">
                {msg.trackingCard.orderNumber}
              </span>
              <span className="font-mono text-[11px] font-semibold tabular-nums text-[#8A5A17]">
                {formatBdt(msg.trackingCard.totalBdt)}
              </span>
            </div>
            <div className="mt-2 space-y-1 text-[11px] text-[#635647]">
              <p>
                <strong className="text-[#1E1710]">{bn ? 'পণ্য:' : 'Items:'}</strong>{' '}
                {msg.trackingCard.itemsSummary}
              </p>
              <p>
                <strong className="text-[#1E1710]">{bn ? 'পেমেন্ট:' : 'Payment:'}</strong>{' '}
                {msg.trackingCard.paymentMethod} · {msg.trackingCard.paymentStatus}
              </p>
              <p>
                <strong className="text-[#1E1710]">{bn ? 'সম্ভাব্য ডেলিভারি:' : 'ETA:'}</strong>{' '}
                {msg.trackingCard.estimatedDelivery}
              </p>
              {(msg.trackingCard.courierPartner || msg.trackingCard.consignmentId) && (
                <p>
                  <strong className="text-[#1E1710]">{bn ? 'কুরিয়ার:' : 'Courier:'}</strong>{' '}
                  <span className="font-mono uppercase text-[#1E1710]">
                    {msg.trackingCard.courierPartner || 'courier'}
                  </span>
                  {msg.trackingCard.consignmentId && (
                    <>
                      {' · '}
                      <span className="font-mono text-[#1E1710]">
                        {msg.trackingCard.consignmentId}
                      </span>
                    </>
                  )}
                </p>
              )}
              {msg.trackingCard.courierTrackingUrl &&
                /^https:\/\/[^\s]+$/i.test(msg.trackingCard.courierTrackingUrl) && (
                  <p className="pt-0.5">
                    <a
                      href={msg.trackingCard.courierTrackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-[#8A5A17] underline underline-offset-2 hover:text-[#1E1710]"
                    >
                      <Truck className="h-3 w-3" />
                      <span>{bn ? 'কুরিয়ার ট্র্যাকিং দেখুন' : 'Track on Courier'}</span>
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </p>
                )}
            </div>
            <div className="mt-3 grid grid-cols-5 gap-1">
              {TRACKING_STEPS.map((step, idx) => {
                const Icon = step.Icon;
                const done = idx <= resolvedTrackIdx;
                return (
                  <div key={step.key} className="flex flex-col items-center text-center">
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-md border ${
                        done
                          ? 'border-[#B47B2B] bg-[#B47B2B] text-[#FFFDF9]'
                          : 'border-[rgba(30,23,16,0.15)] bg-[#FFFDF9] text-[#8A7867]'
                      }`}
                    >
                      <Icon className="h-3 w-3" />
                    </div>
                    <span
                      className={`mt-1 text-[9.5px] leading-tight ${
                        done ? 'font-semibold text-[#1E1710]' : 'text-[#8A7867]'
                      }`}
                    >
                      {bn ? step.labelBn : step.labelEn}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Structured Deshi Gee Order Summary & Explicit Confirmation Card */}
        {!isUser && summary && (
          <div className="mt-3 rounded-xl border border-[rgba(180,123,43,0.35)] bg-[#F2ECE1]/75 p-3 text-xs text-[#1E1710]">
            <div className="flex items-center justify-between gap-2 border-b border-[rgba(30,23,16,0.1)] pb-1.5">
              <span className="font-semibold">
                {summary.orderNumber
                  ? bn
                    ? `অর্ডার কনফার্মড · ${summary.orderNumber}`
                    : `Order Confirmed · ${summary.orderNumber}`
                  : bn
                    ? 'দেশী ঘি অর্ডার সারাংশ'
                    : 'Deshi Gee Order Summary'}
                {summary.priceQuoteVersion && summary.priceQuoteVersion > 1
                  ? ` (v${summary.priceQuoteVersion})`
                  : ''}
              </span>
              <span className="font-mono text-[11px] font-semibold tabular-nums text-[#8A5A17]">
                {summary.variantLines && summary.variantLines.length > 0
                  ? summary.variantLines.map((v) => `${v.weight}×${v.qty}`).join(' + ')
                  : `${summary.weight} × ${summary.qty}`}
              </span>
            </div>

            {summary.duplicateWarning && (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[10.5px] font-medium text-amber-900">
                {summary.duplicateWarning}
              </div>
            )}

            {summary.addressWarning && (
              <div className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[10.5px] font-medium text-amber-900">
                {summary.addressWarning}
              </div>
            )}

            {remainingMs !== null && (
              <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-[#635647]">
                <span>
                  {isQuoteExpired
                    ? bn
                      ? 'প্রাইস কোটের মেয়াদ শেষ'
                      : 'Price quote expired'
                    : bn
                      ? 'কোটের মেয়াদ'
                      : 'Quote valid for'}
                </span>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    isQuoteExpired ? 'text-red-700' : 'text-[#8A5A17]'
                  }`}
                >
                  {formatCountdown(remainingMs)}
                </span>
              </div>
            )}

            <div className="mt-2 space-y-1 text-[11px] text-[#635647]">
              <div className="flex justify-between gap-2">
                <span>{bn ? 'পণ্য' : 'Product'}</span>
                <span className="text-right font-medium text-[#1E1710]">
                  {summary.productName}
                </span>
              </div>
              {summary.variantLines && summary.variantLines.length > 1 ? (
                summary.variantLines.map((line) => (
                  <div key={line.weight} className="flex justify-between gap-2 pl-2 text-[10.5px]">
                    <span>
                      {line.weight} × {line.qty} ({formatBdt(line.unitPriceBdt)})
                    </span>
                    <span className="font-mono tabular-nums text-[#1E1710]">
                      {formatBdt(line.lineSubtotalBdt)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex justify-between gap-2">
                  <span>{bn ? 'একক দাম' : 'Unit Price'}</span>
                  <span className="font-mono font-medium tabular-nums text-[#1E1710]">
                    {formatBdt(summary.unitPriceBdt)}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span>{bn ? 'সাবটোটাল' : 'Subtotal'}</span>
                <span className="font-mono font-medium tabular-nums text-[#1E1710]">
                  {formatBdt(summary.subtotalBdt)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span>
                  {bn ? 'ডেলিভারি চার্জ' : 'Delivery'}
                  {summary.deliveryZone ? ` (${summary.deliveryZone})` : ''}
                </span>
                <span className="font-mono font-medium tabular-nums text-[#1E1710]">
                  {summary.deliveryFeeBdt === 0
                    ? bn
                      ? 'ফ্রি'
                      : 'Free'
                    : formatBdt(summary.deliveryFeeBdt)}
                </span>
              </div>
              {summary.estimatedDelivery && (
                <div className="flex justify-between gap-2">
                  <span>{bn ? 'সম্ভাব্য ডেলিভারি' : 'Est. Delivery'}</span>
                  <span className="text-right font-medium text-[#1E1710]">
                    {summary.estimatedDelivery}
                  </span>
                </div>
              )}
              {summary.discountBdt > 0 && (
                <div className="flex justify-between gap-2 text-emerald-800">
                  <span>{bn ? 'ডিসকাউন্ট' : 'Discount'}</span>
                  <span className="font-mono font-medium tabular-nums">
                    -{formatBdt(summary.discountBdt)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-[rgba(30,23,16,0.1)] pt-1 text-xs font-semibold text-[#1E1710]">
                <span>{bn ? 'সর্বমোট' : 'Final Total'}</span>
                <span className="font-mono tabular-nums text-[#8A5A17]">
                  {formatBdt(summary.totalBdt)}
                </span>
              </div>
              {summary.dispatchCutoffNote && (
                <p className="pt-0.5 text-[10px] text-[#635647]">
                  {summary.dispatchCutoffNote}
                </p>
              )}

              {(summary.customerName || summary.phone || summary.address) && (
                <div className="mt-1.5 space-y-0.5 border-t border-[rgba(30,23,16,0.08)] pt-1.5 text-[11px]">
                  {summary.customerName && (
                    <p>
                      <strong className="text-[#1E1710]">
                        {bn ? 'নাম:' : 'Name:'}
                      </strong>{' '}
                      {summary.customerName}
                    </p>
                  )}
                  {summary.phone && (
                    <p>
                      <strong className="text-[#1E1710]">
                        {bn ? 'ফোন:' : 'Phone:'}
                      </strong>{' '}
                      <span className="font-mono tabular-nums">{summary.phone}</span>
                    </p>
                  )}
                  {(summary.district || summary.deliveryArea) && (
                    <p>
                      <strong className="text-[#1E1710]">
                        {bn ? 'এলাকা:' : 'Area:'}
                      </strong>{' '}
                      {summary.area ? `${summary.area}, ${summary.district}` : summary.deliveryArea}
                    </p>
                  )}
                  {summary.address && (
                    <p>
                      <strong className="text-[#1E1710]">
                        {bn ? 'ঠিকানা:' : 'Address:'}
                      </strong>{' '}
                      {summary.address}
                    </p>
                  )}
                  {summary.paymentMethod && (
                    <p>
                      <strong className="text-[#1E1710]">
                        {bn ? 'পেমেন্ট:' : 'Payment:'}
                      </strong>{' '}
                      <span className="uppercase">{summary.paymentMethod}</span>
                      {summary.txnId ? ` · TxnID: ${summary.txnId}` : ''}
                    </p>
                  )}
                  {summary.note && (
                    <p>
                      <strong className="text-[#1E1710]">
                        {bn ? 'নোট:' : 'Note:'}
                      </strong>{' '}
                      {summary.note}
                    </p>
                  )}
                </div>
              )}
            </div>

            {canConfirm && (
              <div className="mt-3 space-y-2">
                {isQuoteExpired && (
                  <p className="text-[11px] font-medium text-red-700">
                    {bn
                      ? 'এই প্রাইস কোটের মেয়াদ শেষ হয়েছে। অনুগ্রহ করে আবার অর্ডার সারাংশ তৈরি করতে বলুন।'
                      : 'This price quote has expired. Please ask for an updated summary before confirming.'}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={Boolean(confirmingOrderMsgId) || isQuoteExpired}
                    onClick={() => onConfirmOrder?.(msg.id, summary)}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#B47B2B] px-3 py-2 text-[11px] font-semibold text-[#FFFDF9] transition-colors hover:bg-[#9D6820] disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {isConfirmingThis ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    <span>{bn ? 'অর্ডার কনফার্ম করুন' : 'Confirm Order'}</span>
                  </button>
                  {onEditOrder && (
                    <button
                      type="button"
                      disabled={Boolean(confirmingOrderMsgId)}
                      onClick={() => onEditOrder(msg.id, summary)}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-xl border border-[rgba(30,23,16,0.2)] bg-[#FAF7F2] px-3 py-2 text-[11px] font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>{bn ? 'পরিবর্তন করুন' : 'Edit'}</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {summary.confirmed && !summary.orderNumber && (
              <p className="mt-2 text-[10.5px] font-medium text-[#635647]">
                {bn
                  ? 'এই সারাংশটি আপডেট বা বাতিল করা হয়েছে।'
                  : 'Summary superseded or updated.'}
              </p>
            )}
          </div>
        )}

        {/* Interactive Contact, Map & Order Action Buttons */}
        {!isUser && msg.actions && msg.actions.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {msg.actions.map((action, idx) => {
              if (action.type === 'copy_phone') {
                return (
                  <button
                    key={`${action.type}_${idx}`}
                    type="button"
                    onClick={() => handleCopyText('phone', action.value)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-2.5 py-1 text-[11px] font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
                  >
                    {renderActionIcon(action.type)}
                    <span>
                      {copiedId === 'phone'
                        ? bn
                          ? 'কপি হয়েছে!'
                          : 'Copied!'
                        : bn
                          ? action.labelBn
                          : action.labelEn}
                    </span>
                  </button>
                );
              }
              if (
                (action.type === 'track_order' || action.type === 'order_confirmed') &&
                onNavigateTrack
              ) {
                return (
                  <button
                    key={`${action.type}_${idx}`}
                    type="button"
                    onClick={() => onNavigateTrack(action.value)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#B47B2B] px-3 py-1 text-[11px] font-medium text-[#FFFDF9] hover:bg-[#9D6820]"
                  >
                    {renderActionIcon(action.type)}
                    <span>{bn ? action.labelBn : action.labelEn}</span>
                  </button>
                );
              }
              if (action.type === 'reorder' && action.href) {
                return (
                  <a
                    key={`${action.type}_${idx}`}
                    href={action.href}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1E1710] px-3 py-1 text-[11px] font-medium text-[#FAF7F2] hover:bg-[#35291E]"
                  >
                    {renderActionIcon(action.type)}
                    <span>{bn ? action.labelBn : action.labelEn}</span>
                  </a>
                );
              }
              return (
                <a
                  key={`${action.type}_${idx}`}
                  href={action.href || '#'}
                  target={
                    action.type === 'call' ||
                    action.href?.startsWith('#') ||
                    action.href?.startsWith('/')
                      ? undefined
                      : '_blank'
                  }
                  rel={
                    action.type === 'call' ||
                    action.href?.startsWith('#') ||
                    action.href?.startsWith('/')
                      ? undefined
                      : 'noopener noreferrer'
                  }
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-2.5 py-1 text-[11px] font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
                >
                  {renderActionIcon(action.type)}
                  <span>{bn ? action.labelBn : action.labelEn}</span>
                  {action.type !== 'call' &&
                    !action.href?.startsWith('#') &&
                    !action.href?.startsWith('/') && (
                      <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                    )}
                </a>
              );
            })}
          </div>
        )}

        {/* Verified RAG Sources Disclosure */}
        {!isUser && msg.sources && msg.sources.length > 0 && (
          <div className="mt-2.5 border-t border-[rgba(30,23,16,0.08)] pt-2 text-[10.5px] text-[#635647]">
            <button
              type="button"
              onClick={() => setShowSources((v) => !v)}
              className="inline-flex items-center gap-1 font-medium text-[#8A5A17] hover:underline"
            >
              <span>
                {bn
                  ? `যাচাইকৃত তথ্যসূত্র (${msg.sources.length})`
                  : `Verified sources (${msg.sources.length})`}
              </span>
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showSources ? 'rotate-180' : ''}`}
              />
            </button>
            {showSources && (
              <ul className="mt-1 space-y-0.5 pl-1 font-mono text-[10px]">
                {msg.sources.map((s) => (
                  <li key={s.id}>
                    {s.title} ({s.category} · {s.score.toFixed(2)})
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Admin Playground Diagnostics Strip */}
        {!isUser && showDiagnostics && msg.diagnostics && (
          <div className="mt-2.5 border-t border-[rgba(30,23,16,0.12)] pt-2 font-mono text-[10px] leading-relaxed text-[#635647]">
            model={msg.diagnostics.model} · path={msg.diagnostics.path} · intent=
            {msg.diagnostics.intent} ({msg.diagnostics.confidence.toFixed(2)}) · tools=
            {msg.diagnostics.toolsUsed.join(',') || 'none'} · ragTop=
            {msg.diagnostics.sources[0]?.score.toFixed(2) || '0.00'} · guard=
            {msg.diagnostics.guardStatus} · rag={msg.diagnostics.ragMs ?? 0}ms · model=
            {msg.diagnostics.modelMs ?? 0}ms · tool={msg.diagnostics.toolMs ?? 0}ms ·{' '}
            {msg.diagnostics.promptTokens ?? 0}+{msg.diagnostics.outputTokens ?? 0} tok ($
            {(msg.diagnostics.estimatedCostUsd ?? 0).toFixed(5)}) · stream=
            {msg.diagnostics.streamedRealTokens ? 'live' : 'buffered'}
          </div>
        )}
      </div>

      {/* Inline Negative Feedback Reason Selector */}
      {!isUser && showReasonPicker && !msg.feedback && onSubmitFeedback && (
        <div className="mt-1.5 flex max-w-[92%] flex-wrap gap-1.5 rounded-xl border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] p-2 text-[10.5px]">
          <span className="w-full font-medium text-[#635647]">
            {bn ? 'কী সমস্যা ছিল জানাবেন?' : 'What went wrong?'}
          </span>
          {FEEDBACK_REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setShowReasonPicker(false);
                onSubmitFeedback(msg.id, 'down', r.id);
              }}
              className="min-h-[34px] rounded-md border border-[rgba(30,23,16,0.16)] bg-[#FAF7F2] px-2.5 py-1 text-[#1E1710] hover:border-[#B47B2B] hover:bg-[#F2ECE1]"
            >
              {bn ? r.labelBn : r.labelEn}
            </button>
          ))}
        </div>
      )}

      {/* Contextual Suggested Quick Replies (Latest Assistant Message Only) */}
      {!isUser &&
        isLatestAssistant &&
        onSuggestedReply &&
        msg.suggestedReplies &&
        msg.suggestedReplies.length > 0 && (
          <div className="mt-2 flex max-w-[92%] flex-wrap gap-1.5">
            {msg.suggestedReplies.map((replyText) => (
              <button
                key={replyText}
                type="button"
                onClick={() => onSuggestedReply(replyText)}
                className="min-h-[38px] rounded-lg border border-[rgba(180,123,43,0.35)] bg-[#FFFDF9] px-3 py-1.5 text-left text-[11px] font-medium text-[#1E1710] transition-colors hover:border-[#B47B2B] hover:bg-[#F2ECE1]"
              >
                {replyText}
              </button>
            ))}
          </div>
        )}

      {/* Footer metadata & Copy / Retry / Feedback actions */}
      <div className="mt-1 flex flex-wrap items-center gap-2.5 px-1 text-[10px] text-[#635647]">
        <span>{msg.timestamp}</span>
        {!isUser && msg.text.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => handleCopyText('msg', msg.text)}
              className="inline-flex min-h-[28px] items-center gap-1 hover:text-[#1E1710]"
              aria-label={bn ? 'উত্তর কপি করুন' : 'Copy reply'}
            >
              {copiedId === 'msg' ? (
                <>
                  <Check className="h-3 w-3 text-emerald-700" />
                  <span>{bn ? 'কপি' : 'Copied'}</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>{bn ? 'কপি' : 'Copy'}</span>
                </>
              )}
            </button>
            {onSpeakMessage && (
              <button
                type="button"
                onClick={() => onSpeakMessage(msg.id, msg.text)}
                disabled={loadingAudioMsgId === msg.id}
                className={`inline-flex min-h-[28px] items-center gap-1 hover:text-[#1E1710] disabled:opacity-60 ${
                  speakingMsgId === msg.id ? 'font-semibold text-[#8A5A17]' : ''
                }`}
                aria-label={
                  speakingMsgId === msg.id
                    ? bn
                      ? 'অডিও বন্ধ করুন'
                      : 'Stop audio'
                    : bn
                      ? 'উত্তর শুনুন'
                      : 'Listen to reply'
                }
              >
                {loadingAudioMsgId === msg.id ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin text-[#B47B2B]" />
                    <span>{bn ? 'তৈরি হচ্ছে...' : 'Loading...'}</span>
                  </>
                ) : speakingMsgId === msg.id ? (
                  <>
                    <Square className="h-3 w-3 fill-current" />
                    <span>{bn ? 'থামান' : 'Stop'}</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="h-3 w-3" />
                    <span>{bn ? 'শুনুন' : 'Listen'}</span>
                  </>
                )}
              </button>
            )}
            {msg.retryPrompt && onRetry && (
              <button
                type="button"
                onClick={() => onRetry(msg.retryPrompt!)}
                className="inline-flex min-h-[28px] items-center gap-1 hover:text-[#1E1710]"
                aria-label={bn ? 'পুনরায় উত্তর নিন' : 'Regenerate response'}
              >
                <RotateCcw className="h-3 w-3" />
                <span>{bn ? 'আবার দেখুন' : 'Retry'}</span>
              </button>
            )}
            {!msg.isError && onSubmitFeedback && (
              <div className="inline-flex items-center gap-1">
                {msg.feedback ? (
                  <span className="text-[10px] font-medium text-[#8A5A17]">
                    {bn ? 'মতামতের জন্য ধন্যবাদ' : 'Thanks for your feedback'}
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onSubmitFeedback(msg.id, 'up')}
                      aria-label={bn ? 'উত্তর ভালো লেগেছে' : 'Helpful reply'}
                      className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded hover:bg-[#F2ECE1] hover:text-emerald-800"
                    >
                      <ThumbsUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowReasonPicker((v) => !v)}
                      aria-label={bn ? 'উত্তর সহায়ক নয়' : 'Unhelpful reply'}
                      className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded hover:bg-[#F2ECE1] hover:text-red-700"
                    >
                      <ThumbsDown className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

