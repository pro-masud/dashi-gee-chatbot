'use client';

import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Loader2, MessageSquareText } from 'lucide-react';
import type { ChatbotConfigDoc } from '../../lib/chatbot/types';
import type { Lang } from '../../data/deshiGeeData';

const ChatPanel = dynamic(
  () => import('./ChatPanel').then((mod) => mod.ChatPanel),
  {
    ssr: false,
    loading: () => (
      <div className="no-print fixed inset-0 z-[48] flex h-dvh flex-col items-center justify-center bg-[var(--c-bg)] text-[var(--c-ink)] shadow-2xl sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[620px] sm:max-h-[85dvh] sm:w-[400px] sm:rounded-2xl sm:border sm:border-[rgb(var(--c-tint)/0.18)]">
        <Loader2 className="h-6 w-6 animate-spin text-[#B47B2B]" />
        <p className="mt-2 text-xs text-[var(--c-muted)]">Loading Deshi Gee Assistant...</p>
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
  const launcherBtnRef = useRef<HTMLButtonElement | null>(null);

  const bn = lang === 'bn';
  const isAdminRoute = pathname.startsWith('/admin');
  const isHomeRoute = pathname === '/';

  useEffect(() => {
    const onOpenEvent = () => {
      setHasOpened(true);
      setOpen(true);
      setMinimized(false);
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
  };

  const handleCloseChat = () => {
    setOpen(false);
    window.setTimeout(() => {
      launcherBtnRef.current?.focus();
    }, 0);
  };

  return (
    <>
      {/* FLOATING LAUNCHER BUTTON
          - On mobile homepage (< md), chat launches from the Unified Mobile Bottom Bar to prevent overlap.
          - On secondary pages (/track, /batch) and on tablet/desktop (md+), renders cleanly at bottom-right. */}
      {(!open || minimized) && (
        <div
          className={`no-print fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[45] items-end md:right-6 md:bottom-6 ${
            isHomeRoute ? 'hidden md:flex' : 'flex'
          }`}
        >
          <button
            ref={launcherBtnRef}
            type="button"
            onClick={handleOpenChat}
            aria-label={bn ? 'দেশী ঘি সহকারী চ্যাট খুলুন' : 'Open Deshi Gee Assistant'}
            title={bn ? 'দেশী ঘি সহকারী চ্যাট খুলুন' : 'Open Deshi Gee Assistant'}
            className="group relative inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[#D4AF37]/70 bg-gradient-to-br from-[#2D1F13] via-[#1A120B] to-[#120B06] text-[#F5D692] shadow-[0_10px_28px_rgba(30,23,16,0.28)] transition-all duration-200 hover:scale-105 hover:border-[#E5B25D] hover:shadow-[0_14px_34px_rgba(30,23,16,0.36)] active:scale-95"
          >
            <MessageSquareText className="h-6 w-6 transition-transform duration-200 group-hover:scale-105" />
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-[#1A120B] bg-[var(--c-card)]"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  chatbotConfig.maintenanceMode ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
              />
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
          onClose={handleCloseChat}
          onNavigateTrack={onNavigateTrack}
        />
      )}
    </>
  );
}
