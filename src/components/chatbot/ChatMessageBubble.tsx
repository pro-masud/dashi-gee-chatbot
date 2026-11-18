'use client';

import { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  ExternalLink,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  PackageCheck,
  Phone,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { formatBdt } from '../../data/deshiGeeData';
import type {
  ChatActionItem,
  ChatMessageItem,
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

export function ChatMessageBubble({
  msg,
  lang,
  onRetry,
  onNavigateTrack,
  onConfirmOrder,
  onEditOrder,
  confirmingOrderMsgId,
}: {
  msg: ChatMessageItem;
  lang: 'en' | 'bn';
  onRetry?: (prompt: string) => void;
  onNavigateTrack?: (orderNumber: string) => void;
  onConfirmOrder?: (msgId: string, summary: OrderSummaryCard) => void;
  onEditOrder?: (msgId: string, summary: OrderSummaryCard) => void;
  confirmingOrderMsgId?: string | null;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const bn = lang === 'bn';
  const isUser = msg.role === 'user';
  const isConfirmingThis = confirmingOrderMsgId === msg.id;

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
      default:
        return <PackageCheck className="h-3.5 w-3.5" />;
    }
  };

  const summary = msg.orderSummary;
  const canConfirm = Boolean(
    !isUser &&
      summary &&
      !summary.orderNumber &&
      summary.confirmationToken &&
      !summary.confirmed &&
      onConfirmOrder
  );

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 shadow-xs ${
          isUser
            ? 'rounded-br-sm bg-[#1E1710] text-[#FAF7F2]'
            : msg.isError
              ? 'rounded-bl-sm border border-red-300 bg-red-50/90 text-[#1E1710]'
              : 'rounded-bl-sm border border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] text-[#1E1710]'
        }`}
      >
        {!isUser && (
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#8A5A17]">
            <Sparkles className="h-3 w-3" />
            <span>{bn ? 'দেশী ঘি অ্যাসিস্ট্যান্ট' : 'Deshi Gee Assistant'}</span>
          </div>
        )}

        <FormattedMessageText text={msg.text} isUser={isUser} />

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
              </span>
              <span className="font-mono text-[11px] font-semibold text-[#8A5A17]">
                {summary.weight} × {summary.qty}
              </span>
            </div>

            <div className="mt-2 space-y-1 text-[11px] text-[#635647]">
              <div className="flex justify-between gap-2">
                <span>{bn ? 'পণ্য' : 'Product'}</span>
                <span className="text-right font-medium text-[#1E1710]">
                  {summary.productName}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span>{bn ? 'একক দাম' : 'Unit Price'}</span>
                <span className="font-mono font-medium text-[#1E1710]">
                  {formatBdt(summary.unitPriceBdt)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span>{bn ? 'সাবটোটাল' : 'Subtotal'}</span>
                <span className="font-mono font-medium text-[#1E1710]">
                  {formatBdt(summary.subtotalBdt)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span>{bn ? 'ডেলিভারি চার্জ' : 'Delivery Charge'}</span>
                <span className="font-mono font-medium text-[#1E1710]">
                  {summary.deliveryFeeBdt === 0
                    ? bn
                      ? 'ফ্রি'
                      : 'Free'
                    : formatBdt(summary.deliveryFeeBdt)}
                </span>
              </div>
              {summary.discountBdt > 0 && (
                <div className="flex justify-between gap-2 text-emerald-800">
                  <span>{bn ? 'ডিসকাউন্ট' : 'Discount'}</span>
                  <span className="font-mono font-medium">
                    -{formatBdt(summary.discountBdt)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-[rgba(30,23,16,0.1)] pt-1 text-xs font-semibold text-[#1E1710]">
                <span>{bn ? 'সর্বমোট' : 'Final Total'}</span>
                <span className="font-mono text-[#8A5A17]">
                  {formatBdt(summary.totalBdt)}
                </span>
              </div>

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
                      <span className="font-mono">{summary.phone}</span>
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
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Boolean(confirmingOrderMsgId)}
                  onClick={() => onConfirmOrder?.(msg.id, summary)}
                  className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#B47B2B] px-3 py-2 text-[11px] font-semibold text-[#FFFDF9] transition-colors hover:bg-[#9D6820] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {isConfirmingThis ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {bn ? 'অর্ডার কনফার্ম করুন' : 'Confirm Order'}
                  </span>
                </button>
                {onEditOrder && (
                  <button
                    type="button"
                    disabled={Boolean(confirmingOrderMsgId)}
                    onClick={() => onEditOrder(msg.id, summary)}
                    className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-xl border border-[rgba(30,23,16,0.2)] bg-[#FAF7F2] px-3 py-2 text-[11px] font-medium text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-50"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>{bn ? 'পরিবর্তন করুন' : 'Edit'}</span>
                  </button>
                )}
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
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-2.5 py-1 text-[11px] font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
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
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#B47B2B] px-3 py-1 text-[11px] font-medium text-[#FFFDF9] hover:bg-[#9D6820]"
                  >
                    {renderActionIcon(action.type)}
                    <span>{bn ? action.labelBn : action.labelEn}</span>
                  </button>
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
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-2.5 py-1 text-[11px] font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
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
      </div>

      {/* Footer metadata & Copy / Retry actions */}
      <div className="mt-1 flex items-center gap-2.5 px-1 text-[10px] text-[#635647]">
        <span>{msg.timestamp}</span>
        {!isUser && (
          <>
            <button
              type="button"
              onClick={() => handleCopyText('msg', msg.text)}
              className="inline-flex items-center gap-1 hover:text-[#1E1710]"
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
            {msg.retryPrompt && onRetry && (
              <button
                type="button"
                onClick={() => onRetry(msg.retryPrompt!)}
                className="inline-flex items-center gap-1 hover:text-[#1E1710]"
                aria-label={bn ? 'পুনরায় উত্তর নিন' : 'Regenerate response'}
              >
                <RotateCcw className="h-3 w-3" />
                <span>{bn ? 'আবার দেখুন' : 'Retry'}</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
