'use client';

import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { ChatbotConfigDoc } from '../../lib/chatbot/types';
import type { Lang } from '../../data/deshiGeeData';

const ChatPanel = dynamic(
  () => import('./ChatPanel').then((mod) => mod.ChatPanel),
  {
    ssr: false,
    loading: () => (
      <div className="no-print fixed inset-0 z-[48] flex h-dvh flex-col items-center justify-center bg-[#FAF7F2] text-[#1E1710] shadow-2xl sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[620px] sm:max-h-[85dvh] sm:w-[400px] sm:rounded-2xl sm:border sm:border-[rgba(30,23,16,0.18)]">
        <Loader2 className="h-6 w-6 animate-spin text-[#B47B2B]" />
        <p className="mt-2 text-xs text-[#635647]">Loading Deshi Gee Assistant...</p>
      </div>
    ),
  }
);

export interface ChatWidgetProps {
  chatbotConfig: ChatbotConfigDoc;
  lang: Lang;
  setLang: Dispatch<SetStateAction<Lang>>;
  drawerOpen: boolean;
  onNavigateTrack: (orderNumber: string) => void;
}

export function ChatWidget({
  chatbotConfig,
  lang,
  setLang,
  drawerOpen,
  onNavigateTrack,
}: ChatWidgetProps) {
  const pathname = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [showWelcomeTooltip, setShowWelcomeTooltip] = useState(false);
  const [welcomeMessageIndex, setWelcomeMessageIndex] = useState(-1);

  const bn = lang === 'bn';
  const isAdminRoute = pathname.startsWith('/admin');
  const canShowWelcome =
    chatbotConfig.enabled &&
    !chatbotConfig.maintenanceMode &&
    !isAdminRoute &&
    !drawerOpen &&
    !open;
  const welcomeMessages = bn
    ? [
        'হাই! ঘি বা অর্ডার নিয়ে কিছু জানতে চান?',
        'আমি আছি—কীভাবে সাহায্য করতে পারি?',
        'দাম বা ডেলিভারি জানতে আমাকে জিজ্ঞেস করুন।',
      ]
    : [
        'Hi! Questions about ghee or orders?',
        "I'm here—how can I help?",
        'Ask me about prices or delivery.',
      ];

  useEffect(() => {
    if (!canShowWelcome) {
      setShowWelcomeTooltip(false);
      return;
    }

    const interval = window.setInterval(() => {
      setWelcomeMessageIndex((index) => (index + 1) % welcomeMessages.length);
      setShowWelcomeTooltip(true);
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [canShowWelcome, welcomeMessages.length]);

  useEffect(() => {
    if (!showWelcomeTooltip) return;
    const timer = window.setTimeout(() => setShowWelcomeTooltip(false), 6_000);
    return () => window.clearTimeout(timer);
  }, [showWelcomeTooltip]);

  useEffect(() => {
    const onOpenEvent = () => {
      setHasOpened(true);
      setOpen(true);
      setMinimized(false);
      setShowWelcomeTooltip(false);
    };
    window.addEventListener('deshi-gee-open-chat', onOpenEvent);

    return () => {
      window.removeEventListener('deshi-gee-open-chat', onOpenEvent);
    };
  }, []);

  if (!chatbotConfig.enabled || isAdminRoute || drawerOpen) {
    return null;
  }

  const handleOpenChat = () => {
    setHasOpened(true);
    setOpen(true);
    setMinimized(false);
    setShowWelcomeTooltip(false);
  };

  return (
    <>
      {/* FLOATING LAUNCHER BUTTON (Rendered immediately; panel lazy-loads on open) */}
      {(!open || minimized) && (
        <div className="no-print fixed right-4 bottom-[74px] z-[45] flex flex-row items-end gap-3 md:right-6 md:bottom-6">
          {showWelcomeTooltip && !open && (
            <div
              role="status"
              aria-live="polite"
              className="relative w-[min(260px,calc(100vw-6rem))] rounded-2xl rounded-br-md border border-[#D4AF37]/50 bg-gradient-to-br from-[#261B12] to-[#140E08] px-4 py-3 text-left text-[#FAF7F2] shadow-[0_15px_35px_rgba(30,23,16,0.28)]"
            >
              <span className="absolute -right-1.5 bottom-5 h-3 w-3 rotate-45 border-r border-b border-[#D4AF37]/50 bg-[#140E08]" />
              <button
                type="button"
                onClick={handleOpenChat}
                aria-label={bn ? 'চ্যাট শুরু করুন' : 'Start a chat'}
                className="relative block w-full text-left"
              >
                <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[#E5B25D]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#2D6A4F]" />
                  <span>{bn ? 'দেশী ঘি সহকারী' : 'Deshi Gee Concierge'}</span>
                </div>
                <span className="mt-1 block text-xs font-medium leading-relaxed text-[#FFFDF9]">
                  {welcomeMessages[Math.max(0, welcomeMessageIndex)]}
                </span>
                <span className="mt-2 block text-[10px] font-bold tracking-widest text-[#D4AF37] hover:underline">
                  {bn ? 'চ্যাট করুন →' : 'TAP TO INQUIRE →'}
                </span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleOpenChat}
            aria-label={bn ? 'দেশী ঘি সহকারী চ্যাট খুলুন' : 'Open Deshi Gee Assistant'}
            title={bn ? 'দেশী ঘি সহকারী চ্যাট খুলুন' : 'Open Deshi Gee Assistant'}
            className="group relative grid h-16 w-16 place-items-center rounded-full border-2 border-[#D4AF37] bg-gradient-to-br from-[#2D1F13] via-[#1A120B] to-[#120B06] shadow-[0_0_0_4px_rgba(212,175,55,0.15),0_12px_32px_rgba(30,23,16,0.3)] transition-all duration-300 hover:scale-105 hover:shadow-[0_0_0_6px_rgba(212,175,55,0.25),0_16px_36px_rgba(30,23,16,0.4)] active:scale-95"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="relative h-7 w-7 transition-transform duration-300 group-hover:scale-110"
              fill="none"
            >
              <defs>
                <linearGradient id="dropletGold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#F5D692" />
                  <stop offset="50%" stopColor="#C98A2C" />
                  <stop offset="100%" stopColor="#8A5A17" />
                </linearGradient>
              </defs>
              <path
                d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"
                fill="url(#dropletGold)"
                stroke="#D4AF37"
                strokeWidth="1.2"
              />
              <circle cx="12" cy="14" r="2.2" fill="#FAF7F2" opacity="0.65" />
              <path
                d="M12 7.5c0 0 2.5 3 2.5 5.5a2.5 2.5 0 0 1-5 0c0-2.5 2.5-5.5 2.5-5.5z"
                fill="#FFFDF9"
                opacity="0.3"
              />
            </svg>
            <span className="absolute right-0.5 bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[#1E1710] bg-[#FFFDF9]">
              {!chatbotConfig.maintenanceMode && (
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              )}
              {chatbotConfig.maintenanceMode && (
                <span className="h-2 w-2 rounded-full bg-amber-500" />
              )}
            </span>
          </button>
        </div>
      )}

      {/* LAZY-LOADED INTERACTIVE CHAT PANEL */}
      {hasOpened && (
        <ChatPanel
          chatbotConfig={chatbotConfig}
          lang={lang}
          setLang={setLang}
          open={open}
          minimized={minimized}
          onMinimize={() => setMinimized(true)}
          onClose={() => setOpen(false)}
          onNavigateTrack={onNavigateTrack}
        />
      )}
    </>
  );
}
