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
        <Loader2 className="h-6 w-6 animate-spin text-[var(--c-accent)]" />
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
      {(!open || minimized) && (
        <div className="no-print fixed right-4 bottom-24 z-[45] flex items-end md:right-6 md:bottom-6">
          <button
            ref={launcherBtnRef}
            type="button"
            onClick={handleOpenChat}
            aria-label={bn ? 'Deshi Gee সহকারী চ্যাট খুলুন' : 'Open Deshi Gee Support Assistant'}
            title={bn ? 'Deshi Gee সহকারী চ্যাট খুলুন' : 'Open Deshi Gee Support Assistant'}
            className="inline-flex h-12 items-center gap-2 rounded-full border border-[#FFD21F]/40 bg-gradient-to-br from-[#16673A] to-[#0C3F22] px-4 text-xs font-bold text-white shadow-[0_12px_28px_rgba(12,63,34,0.32)] transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(12,63,34,0.42)]"
          >
            <MessageSquareText className="h-4 w-4 text-[#FFD21F]" />
            <span className="hidden sm:inline">{bn ? 'সহায়তা' : 'Support'}</span>
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
