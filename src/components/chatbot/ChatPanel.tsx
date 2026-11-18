'use client';

import {
  Dispatch,
  KeyboardEvent,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Loader2,
  Minimize2,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { CHATBOT_BUILD_CONFIG } from '../../lib/chatbot/build-config';
import type {
  ChatActionItem,
  ChatDiagnosticsMeta,
  ChatMessageItem,
  ChatbotConfigDoc,
  FeedbackReason,
  KnowledgeSourceRef,
  OrderDraftDoc,
  OrderSummaryCard,
  ProductCardItem,
  TrackingCardData,
} from '../../lib/chatbot/types';
import type { Lang } from '../../data/deshiGeeData';
import { ChatMessageBubble } from './ChatMessageBubble';

const SESSION_STORAGE_KEY = 'deshi_gee_chat_session_v1';
const MESSAGES_STORAGE_KEY = 'deshi_gee_chat_messages_v1';

function createTimeLabel(): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date());
  } catch {
    return '';
  }
}

function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && existing.length >= 6) return existing;
    const created = `dg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return `dg_${Date.now()}`;
  }
}

export interface ChatPanelProps {
  chatbotConfig: ChatbotConfigDoc;
  lang: Lang;
  setLang: Dispatch<SetStateAction<Lang>>;
  open: boolean;
  minimized: boolean;
  onMinimize: () => void;
  onClose: () => void;
  onNavigateTrack: (orderNumber: string) => void;
}

export function ChatPanel({
  chatbotConfig,
  lang,
  setLang,
  open,
  minimized,
  onMinimize,
  onClose,
  onNavigateTrack,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [rolloverNotice, setRolloverNotice] = useState(false);
  const [resumedDraft, setResumedDraft] = useState<OrderDraftDoc | null>(null);
  const [confirmingOrderMsgId, setConfirmingOrderMsgId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('dg_init');
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const bn = lang === 'bn';

  useEffect(() => {
    const activeId = getOrCreateSessionId();
    setSessionId(activeId);
    try {
      const saved = sessionStorage.getItem(MESSAGES_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessageItem[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch {
      // ignore storage failures
    }

    let cancelled = false;
    fetch(`/api/chat/session?sessionId=${encodeURIComponent(activeId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: {
          session?: { lockedLang?: 'bn' | 'en' | '' } | null;
          orderDraft?: OrderDraftDoc | null;
        } | null) => {
          if (cancelled || !data) return;
          if (data.session?.lockedLang === 'bn' || data.session?.lockedLang === 'en') {
            setLang(data.session.lockedLang);
          }
          if (
            data.orderDraft &&
            data.orderDraft.state !== 'confirmed' &&
            data.orderDraft.state !== 'cancelled' &&
            data.orderDraft.state !== 'expired' &&
            (data.orderDraft.weight || data.orderDraft.phone || data.orderDraft.address)
          ) {
            setResumedDraft(data.orderDraft);
          }
        }
      )
      .catch(() => {
        // ignore network errors on mount restore
      });

    return () => {
      cancelled = true;
    };
  }, [setLang]);

  useEffect(() => {
    if (messages.length === 0) return;
    try {
      sessionStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(messages.slice(-24)));
    } catch {
      // ignore
    }
  }, [messages]);

  useEffect(() => {
    if (open && !minimized) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, awaitingReply, confirmingOrderMsgId, open, minimized]);

  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, minimized]);

  useEffect(() => {
    if (!open || minimized) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, minimized, onClose]);

  useEffect(() => {
    if (!open || minimized) return;
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
    if (!isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, minimized]);

  const welcomeMessage = bn
    ? chatbotConfig.welcomeMessageBn
    : chatbotConfig.welcomeMessageEn;

  const quickQuestions = useMemo(
    () =>
      (bn ? chatbotConfig.quickQuestionsBn : chatbotConfig.quickQuestionsEn).slice(0, 6),
    [bn, chatbotConfig.quickQuestionsBn, chatbotConfig.quickQuestionsEn]
  );

  const latestAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages]);

  if (!open || minimized) {
    return null;
  }

  const sendMessage = async (rawText: string, replaceFromRetry = false) => {
    const trimmed = rawText.trim().slice(0, CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS);
    if (!trimmed || awaitingReply || confirmingOrderMsgId) return;

    setResumedDraft(null);
    let activeSessionId = sessionId;
    const needsRollover =
      !replaceFromRetry &&
      messages.length >= CHATBOT_BUILD_CONFIG.SESSION_ROLLOVER_THRESHOLD;
    let workingHistory = messages;

    if (needsRollover) {
      activeSessionId = `dg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setSessionId(activeSessionId);
      setRolloverNotice(true);
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, activeSessionId);
      } catch {
        // ignore
      }
      workingHistory = messages.slice(-CHATBOT_BUILD_CONFIG.MAX_CONTEXT_MESSAGES);
    }

    const userMsg: ChatMessageItem = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: createTimeLabel(),
    };

    const nextDisplayMessages = replaceFromRetry ? messages : [...messages, userMsg];
    const requestHistory = replaceFromRetry
      ? workingHistory.slice(-CHATBOT_BUILD_CONFIG.MAX_CONTEXT_MESSAGES)
      : [...workingHistory, userMsg].slice(-CHATBOT_BUILD_CONFIG.MAX_CONTEXT_MESSAGES);

    if (!replaceFromRetry) {
      setMessages(nextDisplayMessages);
      setInput('');
    }

    const assistantId = `a_${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        text: '',
        timestamp: createTimeLabel(),
        retryPrompt: trimmed,
      },
    ]);
    setAwaitingReply(true);

    let errActions: ChatActionItem[] = [];
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          mode: 'published',
          sessionId: activeSessionId,
          uiLang: lang,
          messages: requestHistory.map((m) => ({ role: m.role, text: m.text })),
        }),
      });

      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({}));
        if (Array.isArray(errBody.actions)) {
          errActions = errBody.actions as ChatActionItem[];
        }
        throw new Error(
          errBody.error ||
            (bn
              ? 'উত্তর পাওয়া যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
              : 'Could not reach assistant. Please try again.')
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assembledText = '';
      let metaActions: ChatActionItem[] = [];
      let metaOrderSummary: OrderSummaryCard | undefined;
      let metaProductCards: ProductCardItem[] | undefined;
      let metaTrackingCard: TrackingCardData | undefined;
      let metaSuggestedReplies: string[] | undefined;
      let metaSources: KnowledgeSourceRef[] | undefined;
      let metaDiagnostics: ChatDiagnosticsMeta | undefined;
      let metaLogId: string | undefined;
      let metaIsError = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;
          try {
            const event = JSON.parse(cleanLine) as {
              type: string;
              text?: string;
              actions?: ChatActionItem[];
              orderSummary?: OrderSummaryCard | null;
              productCards?: ProductCardItem[] | null;
              trackingCard?: TrackingCardData | null;
              suggestedReplies?: string[] | null;
              sources?: KnowledgeSourceRef[] | null;
              diagnostics?: ChatDiagnosticsMeta | null;
              logId?: string | null;
              lockedLang?: 'bn' | 'en' | '' | null;
              isError?: boolean;
            };
            if (event.type === 'delta' && event.text) {
              assembledText += event.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, text: assembledText } : m
                )
              );
            } else if (event.type === 'meta') {
              metaActions = event.actions || [];
              metaOrderSummary = event.orderSummary || undefined;
              metaProductCards =
                event.productCards && event.productCards.length > 0
                  ? event.productCards
                  : undefined;
              metaTrackingCard = event.trackingCard || undefined;
              metaSuggestedReplies =
                event.suggestedReplies && event.suggestedReplies.length > 0
                  ? event.suggestedReplies
                  : undefined;
              metaSources =
                event.sources && event.sources.length > 0 ? event.sources : undefined;
              metaDiagnostics = event.diagnostics || undefined;
              metaLogId = event.logId || undefined;
              metaIsError = Boolean(event.isError);
              if (event.lockedLang === 'bn' || event.lockedLang === 'en') {
                setLang(event.lockedLang);
              }
            }
          } catch {
            // ignore malformed partial chunk
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                text:
                  assembledText ||
                  (bn ? chatbotConfig.fallbackMessageBn : chatbotConfig.fallbackMessageEn),
                actions: metaActions,
                orderSummary: metaOrderSummary,
                productCards: metaProductCards,
                trackingCard: metaTrackingCard,
                suggestedReplies: metaSuggestedReplies,
                sources: metaSources,
                diagnostics: metaDiagnostics,
                logId: metaLogId,
                isError: metaIsError,
                retryPrompt: trimmed,
              }
            : m
        )
      );
    } catch (err) {
      const msgText =
        err instanceof Error
          ? err.message
          : bn
            ? 'সাময়িক সংযোগ সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Connection hiccup. Please try again.';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                text: msgText,
                actions: errActions.length > 0 ? errActions : m.actions,
                isError: true,
                retryPrompt: trimmed,
              }
            : m
        )
      );
    } finally {
      setAwaitingReply(false);
    }
  };

  const handleConfirmOrder = async (msgId: string, summary: OrderSummaryCard) => {
    if (!summary.confirmationToken || confirmingOrderMsgId || awaitingReply) return;
    setConfirmingOrderMsgId(msgId);

    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          confirmationToken: summary.confirmationToken,
          sessionId,
          uiLang: lang,
          website: '',
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.priceChanged && data.updatedSummary) {
        setMessages((prev) => [
          ...prev.map((m) =>
            m.id === msgId && m.orderSummary
              ? {
                  ...m,
                  orderSummary: { ...m.orderSummary, confirmed: true, confirmationToken: undefined },
                }
              : m
          ),
          {
            id: `upd_${Date.now()}`,
            role: 'assistant',
            text:
              data.error ||
              (bn
                ? 'দাম বা ডেলিভারি চার্জ হালনাগাদ হয়েছে। অনুগ্রহ করে নতুন সারাংশ দেখে আবার অর্ডার কনফার্ম করুন।'
                : 'Prices or delivery charges updated. Please review this updated summary and click Confirm Order again.'),
            timestamp: createTimeLabel(),
            orderSummary: data.updatedSummary as OrderSummaryCard,
          },
        ]);
        return;
      }

      if (res.status === 409 && data.outOfStock) {
        setMessages((prev) => [
          ...prev.map((m) =>
            m.id === msgId && m.orderSummary
              ? {
                  ...m,
                  orderSummary: { ...m.orderSummary, confirmed: true, confirmationToken: undefined },
                }
              : m
          ),
          {
            id: `oos_${Date.now()}`,
            role: 'assistant',
            text:
              data.error ||
              (bn
                ? 'দুঃখিত, এই মুহূর্তে পর্যাপ্ত জার স্টকে নেই। অনুগ্রহ করে পরিমাণ কমিয়ে বা অন্য সাইজ বেছে নিন।'
                : 'Sorry, there is insufficient stock for one or more jars right now. Please adjust quantity or pick another size.'),
            timestamp: createTimeLabel(),
            isError: true,
          },
        ]);
        return;
      }

      if (!res.ok || !data.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `ord_err_${Date.now()}`,
            role: 'assistant',
            text:
              data.error ||
              (bn
                ? 'দুঃখিত, অর্ডারটি কনফার্ম করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন বা সাপোর্টে যোগাযোগ করুন।'
                : 'Could not confirm order right now. Please try again or reach our support team.'),
            timestamp: createTimeLabel(),
            isError: true,
          },
        ]);
        return;
      }

      const confirmedOrderNum = String(data.orderNumber || '');
      setResumedDraft(null);
      setMessages((prev) => [
        ...prev.map((m) =>
          m.id === msgId && m.orderSummary
            ? {
                ...m,
                orderSummary: {
                  ...m.orderSummary,
                  confirmed: true,
                  orderNumber: confirmedOrderNum,
                  confirmationToken: undefined,
                  orderState: 'order_created' as const,
                },
              }
            : m
        ),
        {
          id: `ord_ok_${Date.now()}`,
          role: 'assistant',
          text:
            data.message ||
            `ধন্যবাদ! আপনার অর্ডারটি সফলভাবে গ্রহণ করা হয়েছে। আমাদের টিম অর্ডারটি যাচাই করে আপনাকে ফোনে যোগাযোগ করবে। আপনার অর্ডার নম্বর: ${confirmedOrderNum}।`,
          timestamp: createTimeLabel(),
          actions: [
            {
              type: 'order_confirmed',
              labelEn: `Track ${confirmedOrderNum}`,
              labelBn: `অর্ডার ট্র্যাক করুন (${confirmedOrderNum})`,
              value: confirmedOrderNum,
              href: `/track?order=${encodeURIComponent(confirmedOrderNum)}`,
            },
          ],
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `ord_fail_${Date.now()}`,
          role: 'assistant',
          text: bn
            ? 'নেটওয়ার্ক সমস্যার কারণে অর্ডার কনফার্ম করা যায়নি। আবার চেষ্টা করুন।'
            : 'Network error while confirming order. Please try again.',
          timestamp: createTimeLabel(),
          isError: true,
        },
      ]);
    } finally {
      setConfirmingOrderMsgId(null);
    }
  };

  const handleEditOrder = (msgId: string) => {
    if (confirmingOrderMsgId || awaitingReply) return;
    setMessages((prev) => [
      ...prev.map((m) =>
        m.id === msgId && m.orderSummary
          ? {
              ...m,
              orderSummary: {
                ...m.orderSummary,
                confirmed: true,
                confirmationToken: undefined,
              },
            }
          : m
      ),
      {
        id: `edit_${Date.now()}`,
        role: 'assistant',
        text: bn
          ? 'অবশ্যই! আপনি অর্ডারের কোন তথ্যটি (ওজন, পরিমাণ, ফোন নম্বর, ঠিকানা বা পেমেন্ট মাধ্যম) পরিবর্তন করতে চান? আমাকে লিখে জানান।'
          : 'Of course! Which order detail would you like to update (weight, quantity, phone, address, or payment method)? Just type your change below.',
        timestamp: createTimeLabel(),
      },
    ]);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSubmitFeedback = async (
    msgId: string,
    rating: 'up' | 'down',
    reason?: FeedbackReason
  ) => {
    const target = messages.find((m) => m.id === msgId);
    if (!target || target.role !== 'assistant' || target.feedback) return;

    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, feedback: rating, feedbackReason: reason || '' } : m
      )
    );

    try {
      await fetch('/api/chatbot/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          sessionId,
          logId: target.logId || '',
          rating,
          reason: reason || '',
          userMessage: target.retryPrompt || '',
          assistantReply: target.text,
          lang,
          intent: target.diagnostics?.intent || 'general',
        }),
      });
    } catch {
      // keep optimistic UI state silently
    }
  };

  const handleClearChat = () => {
    const prevSession = sessionId;
    setMessages([]);
    setRolloverNotice(false);
    setResumedDraft(null);
    const fresh = `dg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setSessionId(fresh);
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, fresh);
      sessionStorage.removeItem(MESSAGES_STORAGE_KEY);
    } catch {
      // ignore
    }
    if (prevSession && prevSession !== 'dg_init') {
      fetch(`/api/chat/session?sessionId=${encodeURIComponent(prevSession)}`, {
        method: 'DELETE',
        headers: {
          'x-requested-with': 'DeshiGeeStorefront',
        },
      }).catch(() => {
        // ignore cleanup error
      });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={chatbotConfig.botName}
      className="no-print fixed inset-0 z-[48] flex h-dvh flex-col bg-[#FAF7F2] text-[#1E1710] shadow-2xl sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[620px] sm:max-h-[85dvh] sm:w-[400px] sm:overflow-hidden sm:rounded-2xl sm:border sm:border-[rgba(30,23,16,0.18)]"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[rgba(250,247,242,0.12)] bg-[#1E1710] px-4 py-3 text-[#FAF7F2]">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#B47B2B]/25 text-[#D89B2B]">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-display text-sm font-semibold">
              {chatbotConfig.botName}
            </h2>
            <p className="flex items-center gap-1.5 text-[11px] text-[#E8DFC5]/80">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  chatbotConfig.maintenanceMode ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              />
              <span>
                {chatbotConfig.maintenanceMode
                  ? bn
                    ? 'রক্ষণাবেক্ষণ চলছে'
                    : 'Maintenance Mode'
                  : bn
                    ? 'অনলাইন · Deshi Gee সাপোর্ট'
                    : 'Online · Deshi Gee Support'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setLang((l) => (l === 'en' ? 'bn' : 'en'))}
            className="min-h-[36px] rounded-md border border-[rgba(250,247,242,0.2)] px-2.5 py-1 text-[11px] font-medium text-[#FAF7F2] hover:bg-white/10"
          >
            {lang === 'en' ? 'বাংলা' : 'EN'}
          </button>
          <button
            type="button"
            onClick={handleClearChat}
            title={bn ? 'চ্যাট পরিষ্কার করুন' : 'Clear conversation'}
            aria-label={bn ? 'চ্যাট পরিষ্কার করুন' : 'Clear conversation'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#E8DFC5]/80 hover:bg-white/10 hover:text-[#FAF7F2]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMinimize}
            title={bn ? 'মিনিমাইজ' : 'Minimize'}
            aria-label={bn ? 'মিনিমাইজ' : 'Minimize'}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-[#E8DFC5]/80 hover:bg-white/10 hover:text-[#FAF7F2] sm:inline-flex"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={bn ? 'চ্যাট বন্ধ করুন' : 'Close chat'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#E8DFC5]/80 hover:bg-white/10 hover:text-[#FAF7F2]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scrollable Conversation Area */}
      <div
        aria-live="polite"
        className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
      >
        <div className="rounded-2xl border border-[rgba(30,23,16,0.1)] bg-[#F2ECE1]/70 p-3.5 text-xs leading-relaxed text-[#1E1710]">
          <p>{welcomeMessage}</p>
        </div>

        {resumedDraft && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[rgba(180,123,43,0.35)] bg-[#FFFDF9] px-3 py-2 text-[11px] text-[#1E1710]">
            <span>
              {bn ? 'সংরক্ষিত অর্ডার খসড়া পাওয়া গেছে: ' : 'Active order draft restored: '}
              {[
                resumedDraft.qty250g ? `250g×${resumedDraft.qty250g}` : '',
                resumedDraft.qty500g ? `500g×${resumedDraft.qty500g}` : '',
                resumedDraft.qty1kg ? `1kg×${resumedDraft.qty1kg}` : '',
              ]
                .filter(Boolean)
                .join(' + ') ||
                `${resumedDraft.weight || 'Jar'}${resumedDraft.qty ? ` × ${resumedDraft.qty}` : ''}`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  sendMessage(
                    bn ? 'আমার অর্ডারটা সম্পূর্ণ করতে চাই' : 'Continue my order draft'
                  )
                }
                className="font-semibold text-[#8A5A17] hover:underline"
              >
                {bn ? 'চালিয়ে যান' : 'Continue'}
              </button>
              <button
                type="button"
                onClick={() => setResumedDraft(null)}
                className="text-[#635647] hover:text-[#1E1710]"
              >
                {bn ? 'লুকান' : 'Dismiss'}
              </button>
            </div>
          </div>
        )}

        {messages.length === 0 && quickQuestions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-[#635647]">
              {bn ? 'দ্রুত জিজ্ঞাসা করুন:' : 'Quick questions:'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {quickQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendMessage(q)}
                  className="min-h-[38px] rounded-xl border border-[rgba(180,123,43,0.35)] bg-[#FFFDF9] px-3 py-1.5 text-left text-xs font-medium text-[#1E1710] transition-colors hover:border-[#B47B2B] hover:bg-[#F2ECE1]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessageBubble
            key={msg.id}
            msg={msg}
            lang={lang}
            isLatestAssistant={msg.id === latestAssistantId}
            onRetry={(prompt) => sendMessage(prompt, true)}
            onConfirmOrder={handleConfirmOrder}
            onEditOrder={(id) => handleEditOrder(id)}
            confirmingOrderMsgId={confirmingOrderMsgId}
            onNavigateTrack={onNavigateTrack}
            onSelectProductVariant={(weight) =>
              sendMessage(bn ? `${weight} জার অর্ডার করতে চাই` : `I want to order ${weight} jar`)
            }
            onSuggestedReply={(q) => sendMessage(q)}
            onSubmitFeedback={handleSubmitFeedback}
          />
        ))}

        {rolloverNotice && (
          <div className="rounded-xl border border-[rgba(180,123,43,0.28)] bg-[#F2ECE1]/60 px-3 py-2 text-[11px] text-[#635647]">
            {bn
              ? 'দ্রুত ও নির্ভুল উত্তরের জন্য একটি নতুন ধারাবাহিক সেশন চালু হয়েছে — আপনি নিশ্চিন্তে কথা চালিয়ে যেতে পারেন।'
              : 'Continuing in a fresh seamless session to keep responses fast — please keep chatting.'}
          </div>
        )}

        {awaitingReply && messages[messages.length - 1]?.text === '' && (
          <div className="flex items-center gap-2 px-1 text-xs text-[#635647]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#B47B2B]" />
            <span>
              {bn ? 'তথ্য যাচাই ও উত্তর তৈরি হচ্ছে...' : 'Checking live details & composing reply...'}
            </span>
          </div>
        )}

        <div ref={scrollEndRef} />
      </div>

      {/* Input Composer */}
      <div className="shrink-0 border-t border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] px-3 pt-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) =>
              setInput(e.target.value.slice(0, CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS))
            }
            onKeyDown={handleKeyDown}
            maxLength={CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS}
            placeholder={
              bn
                ? 'দাম, অর্ডার বা ডেলিভারি সম্পর্কে লিখুন...'
                : 'Ask in English, বাংলা, or Banglish...'
            }
            className="max-h-28 min-h-[44px] flex-1 resize-none rounded-xl border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-3.5 py-2.5 text-base sm:text-sm text-[#1E1710] placeholder:text-[#635647]/70 focus:border-[#B47B2B] focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={
              !input.trim() ||
              awaitingReply ||
              Boolean(confirmingOrderMsgId)
            }
            onClick={() => sendMessage(input)}
            aria-label={bn ? 'মেসেজ পাঠান' : 'Send message'}
            className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl bg-[#B47B2B] text-[#FFFDF9] transition-colors hover:bg-[#9D6820] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {awaitingReply ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-[#635647]">
          {bn
            ? 'তথ্য শুধু ডেলিভারি যাচাইয়ের জন্য ব্যবহৃত হয় · কখনোই PIN/OTP দেবেন না।'
            : 'Details used only for delivery verification · Never share PIN or OTP.'}
        </p>
      </div>
    </div>
  );
}
