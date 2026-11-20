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
  Headset,
  ImagePlus,
  Loader2,
  Mic,
  MicOff,
  Minimize2,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { CHATBOT_BUILD_CONFIG } from '../../lib/chatbot/build-config';
import type {
  ChatActionItem,
  ChatAgentReplyItem,
  ChatDiagnosticsMeta,
  ChatMessageItem,
  ChatbotConfigDoc,
  FeedbackReason,
  KnowledgeSourceRef,
  OrderDraftDoc,
  OrderManageProposalCard,
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

interface BrowserSpeechRecognitionEvent {
  results?: ArrayLike<ArrayLike<{ transcript?: string }>>;
}

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((ev: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

async function compressEvidenceFileToDataUrl(file: File): Promise<string> {
  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Invalid image file'));
    el.src = rawUrl;
  });

  const maxSide = 1100;
  const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
  const targetW = Math.max(1, Math.round((img.width || 800) * scale));
  const targetH = Math.max(1, Math.round((img.height || 800) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return rawUrl;
  ctx.drawImage(img, 0, 0, targetW, targetH);

  let dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  if (dataUrl.length > 680_000) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.6);
  }
  return dataUrl;
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
  const [confirmingManageMsgId, setConfirmingManageMsgId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('dg_init');
  const [aiPaused, setAiPaused] = useState(false);
  const [activeTicketId, setActiveTicketId] = useState('');
  const [assignedAgentName, setAssignedAgentName] = useState('');
  const [pendingEvidence, setPendingEvidence] = useState<{
    evidenceId: string;
    filename: string;
  } | null>(null);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [loadingAudioMsgId, setLoadingAudioMsgId] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState('');
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCacheRef = useRef<Map<string, string>>(new Map());

  const bn = lang === 'bn';

  const applySessionSnapshot = (data: {
    session?: {
      lockedLang?: 'bn' | 'en' | '';
      aiPaused?: boolean;
      activeTicketId?: string;
      assignedAgentName?: string;
      agentReplies?: ChatAgentReplyItem[];
    } | null;
    orderDraft?: OrderDraftDoc | null;
  }) => {
    if (data.session?.lockedLang === 'bn' || data.session?.lockedLang === 'en') {
      setLang(data.session.lockedLang);
    }
    setAiPaused(Boolean(data.session?.aiPaused));
    setActiveTicketId(data.session?.activeTicketId || '');
    setAssignedAgentName(data.session?.assignedAgentName || '');

    const replies = data.session?.agentReplies;
    if (Array.isArray(replies) && replies.length > 0) {
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const additions: ChatMessageItem[] = [];
        for (const r of replies) {
          const msgId = `agent_${r.id}`;
          if (!existingIds.has(msgId)) {
            additions.push({
              id: msgId,
              role: 'assistant',
              text: r.text,
              timestamp: createTimeLabel(),
              isAgentReply: true,
              agentName: r.agentName || 'Deshi Gee Support',
            });
          }
        }
        return additions.length > 0 ? [...prev, ...additions] : prev;
      });
    }
  };

  useEffect(() => {
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

    const bootstrapAndRestore = async () => {
      try {
        const bootRes = await fetch('/api/chat/session', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
          },
          body: JSON.stringify({ forceNew: false }),
        });
        if (!bootRes.ok) {
          const fallbackId = getOrCreateSessionId();
          if (!cancelled) setSessionId(fallbackId);
          return;
        }
        const bootData = (await bootRes.json()) as { ok?: boolean; sessionId?: string };
        const activeId = bootData.sessionId || getOrCreateSessionId();
        if (cancelled) return;
        setSessionId(activeId);
        try {
          sessionStorage.setItem(SESSION_STORAGE_KEY, activeId);
        } catch {
          // ignore storage failures
        }

        const res = await fetch(
          `/api/chat/session?sessionId=${encodeURIComponent(activeId)}`,
          { credentials: 'same-origin' }
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          session?: {
            lockedLang?: 'bn' | 'en' | '';
            aiPaused?: boolean;
            activeTicketId?: string;
            assignedAgentName?: string;
            agentReplies?: ChatAgentReplyItem[];
          } | null;
          orderDraft?: OrderDraftDoc | null;
        } | null;
        if (cancelled || !data) return;
        applySessionSnapshot(data);
        if (
          data.orderDraft &&
          data.orderDraft.state !== 'confirmed' &&
          data.orderDraft.state !== 'cancelled' &&
          data.orderDraft.state !== 'expired' &&
          (data.orderDraft.weight || data.orderDraft.phone || data.orderDraft.address)
        ) {
          setResumedDraft(data.orderDraft);
        }
      } catch {
        const fallbackId = getOrCreateSessionId();
        if (!cancelled) setSessionId(fallbackId);
      }
    };

    void bootstrapAndRestore();

    return () => {
      cancelled = true;
    };
  }, [setLang]);

  useEffect(() => {
    if (!open || minimized || sessionId === 'dg_init' || messages.length === 0) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let idleStreak = 0;
    const MAX_IDLE_POLLS = 20; // stop polling automatically after extended inactivity
    const BASE_DELAY_MS = 8000;
    const MAX_DELAY_MS = 45000;

    const scheduleNext = () => {
      if (!active || idleStreak >= MAX_IDLE_POLLS) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(1.5, Math.min(idleStreak, 5)));
      timer = setTimeout(poll, delay);
    };

    const poll = () => {
      if (!active) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      fetch(`/api/chat/session?sessionId=${encodeURIComponent(sessionId)}`, {
        credentials: 'same-origin',
      })
        .then((res) => {
          if (res.status === 403 || res.status === 429) {
            idleStreak = Math.min(MAX_IDLE_POLLS, idleStreak + 3);
            return null;
          }
          return res.ok ? res.json() : null;
        })
        .then((data) => {
          if (!active) return;
          if (data) {
            const hasActiveAgent = Boolean(data.session?.aiPaused || data.session?.activeTicketId);
            idleStreak = hasActiveAgent ? 0 : idleStreak + 1;
            applySessionSnapshot(data);
          } else {
            idleStreak += 1;
          }
          scheduleNext();
        })
        .catch(() => {
          idleStreak += 2;
          scheduleNext();
        });
    };

    const handleVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      } else if (active && idleStreak < MAX_IDLE_POLLS) {
        scheduleNext();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }
    scheduleNext();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [open, minimized, sessionId, messages.length]);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const win = window as unknown as {
      SpeechRecognition?: new () => BrowserSpeechRecognition;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    };
    if (win.SpeechRecognition || win.webkitSpeechRecognition) {
      setSpeechSupported(true);
    }
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore cleanup error
      }
      recognitionRef.current = null;
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current = null;
      }
    };
  }, []);

  const stopAudioPlayback = () => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.currentTime = 0;
      audioElRef.current = null;
    }
    setSpeakingMsgId(null);
  };

  const handleSpeakMessage = async (msgId: string, text: string, ttsToken?: string) => {
    setTtsError('');
    if (speakingMsgId === msgId) {
      stopAudioPlayback();
      return;
    }
    stopAudioPlayback();

    const playDataUrl = (dataUrl: string) => {
      const audio = new Audio(dataUrl);
      audioElRef.current = audio;
      setSpeakingMsgId(msgId);
      audio.onended = () => {
        setSpeakingMsgId((cur) => (cur === msgId ? null : cur));
        if (audioElRef.current === audio) audioElRef.current = null;
      };
      audio.onerror = () => {
        setSpeakingMsgId((cur) => (cur === msgId ? null : cur));
        setTtsError(bn ? 'অডিও প্লে করা যায়নি।' : 'Audio playback failed.');
        if (audioElRef.current === audio) audioElRef.current = null;
      };
      audio.play().catch(() => {
        setSpeakingMsgId((cur) => (cur === msgId ? null : cur));
        setTtsError(bn ? 'ব্রাউজারে অডিও প্লে আটকে গেছে।' : 'Browser blocked audio playback.');
      });
    };

    const cached = audioCacheRef.current.get(msgId);
    if (cached) {
      playDataUrl(cached);
      return;
    }

    const resolvedTtsToken =
      ttsToken || messages.find((m) => m.id === msgId)?.ttsToken || '';
    if (!resolvedTtsToken) {
      setTtsError(
        bn
          ? 'এই বার্তার জন্য ভয়েস টোকেন পাওয়া যায়নি।'
          : 'Voice playback is only available for verified assistant replies.'
      );
      return;
    }

    setLoadingAudioMsgId(msgId);
    try {
      const res = await fetch('/api/chat/tts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          text,
          lang,
          sessionId,
          ttsToken: resolvedTtsToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.audioBase64) {
        throw new Error(
          data.error ||
            (bn ? 'অডিও তৈরি করা যায়নি।' : 'Could not generate voice reply.')
        );
      }
      const mime = String(data.mimeType || 'audio/wav');
      const dataUrl = `data:${mime};base64,${data.audioBase64}`;
      audioCacheRef.current.set(msgId, dataUrl);
      playDataUrl(dataUrl);
    } catch (err) {
      setTtsError(
        err instanceof Error
          ? err.message
          : bn
            ? 'ভয়েস রিপ্লাই চালু করা যায়নি।'
            : 'Voice reply unavailable.'
      );
    } finally {
      setLoadingAudioMsgId((cur) => (cur === msgId ? null : cur));
    }
  };

  const toggleVoiceDictation = () => {
    if (typeof window === 'undefined' || !speechSupported) return;
    if (isListening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore stop errors
      }
      setIsListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => BrowserSpeechRecognition;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    };
    const SpeechCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechCtor) return;

    try {
      const recognition = new SpeechCtor();
      recognition.lang = lang === 'bn' ? 'bn-BD' : 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.continuous = false;
      recognition.onresult = (ev) => {
        const transcript = String(ev.results?.[0]?.[0]?.transcript || '').trim();
        if (transcript) {
          setInput((prev) => {
            const combined = prev.trim() ? `${prev.trim()} ${transcript}` : transcript;
            return combined.slice(0, CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS);
          });
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      };
      recognition.onerror = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };
      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };
      recognitionRef.current = recognition;
      setIsListening(true);
      recognition.start();
    } catch {
      setIsListening(false);
      recognitionRef.current = null;
    }
  };

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

  useEffect(() => {
    if (!open || minimized) return;
    const onGlobalKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, [open, minimized, onClose]);

  if (!open || minimized) {
    return null;
  }

  const handleEvidenceFileSelected = async (file?: File | null) => {
    if (!file || uploadingEvidence) return;
    setEvidenceError('');
    setUploadingEvidence(true);
    try {
      const dataUrl = await compressEvidenceFileToDataUrl(file);
      const res = await fetch('/api/support/evidence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          dataUrl,
          filename: file.name || 'evidence.jpg',
          sessionId,
          purpose: 'general',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.evidenceId) {
        throw new Error(
          data.error ||
            (bn ? 'ছবি আপলোড করা যায়নি।' : 'Could not upload photo evidence.')
        );
      }
      setPendingEvidence({
        evidenceId: String(data.evidenceId),
        filename: String(data.filename || file.name || 'photo.jpg'),
      });
    } catch (err) {
      setEvidenceError(
        err instanceof Error
          ? err.message
          : bn
            ? 'ছবি আপলোড ব্যর্থ হয়েছে।'
            : 'Evidence upload failed.'
      );
    } finally {
      setUploadingEvidence(false);
    }
  };

  const sendMessage = async (rawText: string, replaceFromRetry = false) => {
    const attachmentSuffix =
      !replaceFromRetry && pendingEvidence
        ? `\n[Evidence ID: ${pendingEvidence.evidenceId}]`
        : '';
    const combinedRaw = `${rawText.trim()}${attachmentSuffix}`.trim();
    const trimmed = combinedRaw.slice(0, CHATBOT_BUILD_CONFIG.MAX_MESSAGE_CHARS);
    if (!trimmed || awaitingReply || confirmingOrderMsgId) return;

    if (!replaceFromRetry && pendingEvidence) {
      setPendingEvidence(null);
    }
    setEvidenceError('');
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
      let metaOrderManageProposal: OrderManageProposalCard | undefined;
      let metaProductCards: ProductCardItem[] | undefined;
      let metaTrackingCard: TrackingCardData | undefined;
      let metaSuggestedReplies: string[] | undefined;
      let metaSources: KnowledgeSourceRef[] | undefined;
      let metaDiagnostics: ChatDiagnosticsMeta | undefined;
      let metaLogId: string | undefined;
      let metaTtsToken: string | undefined;
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
              orderManageProposal?: OrderManageProposalCard | null;
              productCards?: ProductCardItem[] | null;
              trackingCard?: TrackingCardData | null;
              suggestedReplies?: string[] | null;
              sources?: KnowledgeSourceRef[] | null;
              diagnostics?: ChatDiagnosticsMeta | null;
              logId?: string | null;
              ttsToken?: string | null;
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
              metaOrderManageProposal = event.orderManageProposal || undefined;
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
              metaTtsToken = event.ttsToken || undefined;
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
                orderManageProposal: metaOrderManageProposal,
                productCards: metaProductCards,
                trackingCard: metaTrackingCard,
                suggestedReplies: metaSuggestedReplies,
                sources: metaSources,
                diagnostics: metaDiagnostics,
                logId: metaLogId,
                ttsToken: metaTtsToken,
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
          sourceChannel: 'web',
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

      if (
        res.status === 503 ||
        data.code === 'admin_sdk_unavailable' ||
        data.code === 'ordering_not_available'
      ) {
        setMessages((prev) => [
          ...prev,
          {
            id: `ord_unavail_${Date.now()}`,
            role: 'assistant',
            text: bn
              ? 'অনলাইন অর্ডার এখন সাময়িকভাবে অনুপলব্ধ। কোনো অর্ডার তৈরি হয়নি এবং কোনো টাকা কাটা হয়নি — অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।'
              : 'Ordering is temporarily unavailable right now. No order was placed and no payment was charged — please try again shortly.',
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

  const handleConfirmOrderManage = async (
    msgId: string,
    proposal: OrderManageProposalCard
  ) => {
    if (!proposal.actionToken || confirmingManageMsgId || awaitingReply) return;
    setConfirmingManageMsgId(msgId);
    try {
      const res = await fetch('/api/orders/manage', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          actionToken: proposal.actionToken,
          sessionId,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        const errText =
          data.error ||
          (bn
            ? 'দুঃখিত, অর্ডার আপডেট নিশ্চিত করা যায়নি।'
            : 'Could not complete that order update right now.');
        setMessages((prev) => [
          ...prev.map((m) =>
            m.id === msgId && m.orderManageProposal
              ? {
                  ...m,
                  orderManageProposal: {
                    ...m.orderManageProposal,
                    status: 'failed' as const,
                    resultMessage: errText,
                  },
                }
              : m
          ),
          {
            id: `om_err_${Date.now()}`,
            role: 'assistant',
            text: errText,
            timestamp: createTimeLabel(),
            isError: true,
          },
        ]);
        return;
      }

      const okText =
        proposal.action === 'cancel'
          ? bn
            ? `আপনার অর্ডার ${proposal.orderNumber} সফলভাবে বাতিল করা হয়েছে।`
            : `Order ${proposal.orderNumber} has been cancelled as confirmed.`
          : bn
            ? `আপনার অর্ডার ${proposal.orderNumber}-এর ডেলিভারি ঠিকানা সফলভাবে হালনাগাদ হয়েছে।${typeof data.updatedTotalBdt === 'number' ? ` নতুন সর্বমোট: ৳${data.updatedTotalBdt}।` : ''}`
            : `Delivery address for order ${proposal.orderNumber} has been updated.${typeof data.updatedTotalBdt === 'number' ? ` Updated total: ৳${data.updatedTotalBdt}.` : ''}`;

      setMessages((prev) => [
        ...prev.map((m) =>
          m.id === msgId && m.orderManageProposal
            ? {
                ...m,
                orderManageProposal: {
                  ...m.orderManageProposal,
                  status: 'confirmed' as const,
                  resultMessage: okText,
                },
              }
            : m
        ),
        {
          id: `om_ok_${Date.now()}`,
          role: 'assistant',
          text: okText,
          timestamp: createTimeLabel(),
          actions: [
            {
              type: 'track_order',
              labelEn: `Track ${proposal.orderNumber}`,
              labelBn: `অর্ডার ট্র্যাক করুন (${proposal.orderNumber})`,
              value: proposal.orderNumber,
              href: `/track?order=${encodeURIComponent(proposal.orderNumber)}`,
            },
          ],
        },
      ]);
    } catch {
      const netErr = bn
        ? 'নেটওয়ার্ক সমস্যার কারণে অর্ডার আপডেট সম্পন্ন হয়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
        : 'Network error while applying order update. Please try again.';
      setMessages((prev) => [
        ...prev,
        {
          id: `om_net_${Date.now()}`,
          role: 'assistant',
          text: netErr,
          timestamp: createTimeLabel(),
          isError: true,
        },
      ]);
    } finally {
      setConfirmingManageMsgId(null);
    }
  };

  const handleDismissOrderManage = (msgId: string) => {
    if (confirmingManageMsgId) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.orderManageProposal
          ? {
              ...m,
              orderManageProposal: {
                ...m.orderManageProposal,
                status: 'dismissed' as const,
              },
            }
          : m
      )
    );
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
    stopAudioPlayback();
    audioCacheRef.current.clear();
    setTtsError('');
    const prevSession = sessionId;
    setMessages([]);
    setRolloverNotice(false);
    setResumedDraft(null);
    setAiPaused(false);
    setActiveTicketId('');
    setAssignedAgentName('');
    setPendingEvidence(null);
    const resetSession = async () => {
      if (prevSession && prevSession !== 'dg_init') {
        await fetch(`/api/chat/session?sessionId=${encodeURIComponent(prevSession)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: {
            'x-requested-with': 'DeshiGeeStorefront',
          },
        }).catch(() => {
          // ignore cleanup error
        });
      }
      try {
        const bootRes = await fetch('/api/chat/session', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'x-requested-with': 'DeshiGeeStorefront',
          },
          body: JSON.stringify({ forceNew: true }),
        });
        if (bootRes.ok) {
          const data = (await bootRes.json()) as { sessionId?: string };
          if (data.sessionId) {
            setSessionId(data.sessionId);
            sessionStorage.setItem(SESSION_STORAGE_KEY, data.sessionId);
            sessionStorage.removeItem(MESSAGES_STORAGE_KEY);
            return;
          }
        }
      } catch {
        // fallback below
      }
      try {
        sessionStorage.removeItem(MESSAGES_STORAGE_KEY);
      } catch {
        // ignore
      }
    };
    void resetSession();
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
            className="min-h-[44px] min-w-[44px] rounded-lg border border-[rgba(250,247,242,0.2)] px-2.5 py-1 text-xs font-medium text-[#FAF7F2] hover:bg-white/10"
          >
            {lang === 'en' ? 'বাংলা' : 'EN'}
          </button>
          <button
            type="button"
            onClick={handleClearChat}
            title={bn ? 'চ্যাট পরিষ্কার করুন' : 'Clear conversation'}
            aria-label={bn ? 'চ্যাট পরিষ্কার করুন' : 'Clear conversation'}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[#E8DFC5]/80 hover:bg-white/10 hover:text-[#FAF7F2]"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onMinimize}
            title={bn ? 'মিনিমাইজ' : 'Minimize'}
            aria-label={bn ? 'মিনিমাইজ' : 'Minimize'}
            className="hidden h-11 w-11 items-center justify-center rounded-lg text-[#E8DFC5]/80 hover:bg-white/10 hover:text-[#FAF7F2] sm:inline-flex"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={bn ? 'চ্যাট বন্ধ করুন' : 'Close chat'}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[#E8DFC5]/80 hover:bg-white/10 hover:text-[#FAF7F2]"
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
                  className="min-h-[44px] rounded-xl border border-[rgba(180,123,43,0.35)] bg-[#FFFDF9] px-3.5 py-2 text-left text-xs font-medium text-[#1E1710] transition-colors hover:border-[#B47B2B] hover:bg-[#F2ECE1]"
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
            onConfirmOrderManage={handleConfirmOrderManage}
            onDismissOrderManage={handleDismissOrderManage}
            confirmingManageMsgId={confirmingManageMsgId}
            onNavigateTrack={onNavigateTrack}
            onSelectProductVariant={(weight) =>
              sendMessage(bn ? `${weight} জার অর্ডার করতে চাই` : `I want to order ${weight} jar`)
            }
            onSuggestedReply={(q) => sendMessage(q)}
            onSubmitFeedback={handleSubmitFeedback}
            onSpeakMessage={
              chatbotConfig.enableVoiceFeatures === true ? handleSpeakMessage : undefined
            }
            speakingMsgId={speakingMsgId}
            loadingAudioMsgId={loadingAudioMsgId}
          />
        ))}

        {ttsError && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
            <span>{ttsError}</span>
            <button
              type="button"
              onClick={() => setTtsError('')}
              className="shrink-0 font-semibold text-amber-900 hover:underline"
            >
              {bn ? 'বন্ধ' : 'Dismiss'}
            </button>
          </div>
        )}

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

      {/* Human Agent Ownership Banner */}
      {aiPaused && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-[11px] font-medium text-emerald-950">
          <div className="flex items-center gap-2 min-w-0">
            <Headset className="h-3.5 w-3.5 shrink-0 text-emerald-800" />
            <span className="truncate">
              {bn
                ? `মানব প্রতিনিধি (${assignedAgentName || 'Deshi Gee Support'}) সাপোর্ট দিচ্ছেন · AI বিরতিতে`
                : `Human agent (${assignedAgentName || 'Deshi Gee Support'}) active · AI paused`}
            </span>
          </div>
          {activeTicketId && (
            <span className="shrink-0 font-mono text-[10px] font-semibold text-emerald-800">
              {activeTicketId}
            </span>
          )}
        </div>
      )}

      {/* Input Composer */}
      <div className="shrink-0 border-t border-[rgba(30,23,16,0.12)] bg-[#FFFDF9] px-3 pt-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))]">
        {(pendingEvidence || evidenceError) && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-[rgba(180,123,43,0.3)] bg-[#F2ECE1]/75 px-2.5 py-1.5 text-[11px]">
            {evidenceError ? (
              <span className="text-red-700">{evidenceError}</span>
            ) : (
              <span className="truncate font-medium text-[#1E1710]">
                {bn ? 'ছবি সংযুক্ত:' : 'Attached:'}{' '}
                <span className="font-mono text-[#8A5A17]">{pendingEvidence?.filename}</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setPendingEvidence(null);
                setEvidenceError('');
              }}
              aria-label={bn ? 'ছবি সরান' : 'Remove attachment'}
              className="shrink-0 text-[#635647] hover:text-[#1E1710]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              handleEvidenceFileSelected(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={uploadingEvidence || awaitingReply}
            onClick={() => fileInputRef.current?.click()}
            title={bn ? 'জার/পেমেন্ট ছবি সংযুক্ত করুন' : 'Attach damaged jar or payment photo'}
            aria-label={bn ? 'ছবি সংযুক্ত করুন' : 'Attach photo'}
            className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] text-[#635647] transition-colors hover:border-[#B47B2B] hover:text-[#1E1710] disabled:opacity-45"
          >
            {uploadingEvidence ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#B47B2B]" />
            ) : (
              <ImagePlus className="h-4 w-4" />
            )}
          </button>
          {chatbotConfig.enableVoiceFeatures === true && speechSupported && (
            <button
              type="button"
              disabled={awaitingReply}
              onClick={toggleVoiceDictation}
              title={
                isListening
                  ? bn
                    ? 'ভয়েস ইনপুট বন্ধ করুন'
                    : 'Stop voice dictation'
                  : bn
                    ? 'বাংলা বা ইংরেজিতে ভয়েসে লিখুন'
                    : 'Speak in Bangla or English'
              }
              aria-label={
                isListening
                  ? bn
                    ? 'ভয়েস ইনপুট বন্ধ করুন'
                    : 'Stop voice dictation'
                  : bn
                    ? 'ভয়েস ইনপুট শুরু করুন'
                    : 'Start voice dictation'
              }
              className={`inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-45 ${
                isListening
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] text-[#635647] hover:border-[#B47B2B] hover:text-[#1E1710]'
              }`}
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
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
              (!input.trim() && !pendingEvidence) ||
              awaitingReply ||
              Boolean(confirmingOrderMsgId)
            }
            onClick={() => sendMessage(input || (bn ? 'ছবি সংযুক্ত করেছি' : 'Attached evidence photo'))}
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
