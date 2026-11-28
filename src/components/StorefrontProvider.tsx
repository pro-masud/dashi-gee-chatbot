'use client';

import {
  Dispatch,
  ReactNode,
  SetStateAction,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import {
  Menu,
  MessageCircle,
  X,
} from 'lucide-react';
import {
  BatchRecord,
  DEFAULT_STORE_SETTINGS,
  OrderRecord,
  ReviewRecord,
  StoreSettingsDoc,
  WeightKey,
  fetchApprovedReviews,
  fetchBatchRecord,
  fetchStoreSettings,
  hasValidRealContact,
  hasValidRealPhone,
  hasValidRealUrl,
  isStoreFieldConfirmed,
  testFirestoreConnection,
} from '../lib/firebase';
import { Lang } from '../data/deshiGeeData';
import type { PublicPackages } from '../lib/packages/packages';
import { loadTrackers } from '../lib/marketing/loadTrackers';
import {
  isAnnouncementActive,
  isAnnouncementHidden,
  isSafeLink,
  type CmsContent,
} from '../lib/cms/cms';
import { trackStoreEvent } from '../lib/analytics';
import {
  DEFAULT_CHATBOT_CONFIG,
  type ChatbotConfigDoc,
} from '../lib/chatbot/types';
import { fetchPublishedChatbotConfig } from '../lib/firebaseChatbot';
import { BagCheckoutDrawer, CartJarItem } from './BagCheckoutDrawer';
import { ChatWidget } from './chatbot/ChatWidget';

const STORAGE_CART_KEY = 'deshi_gee_single_cart_v1';
const STORAGE_LANG_KEY = 'deshi_gee_lang_v2';
const STORAGE_LAST_ORDER_KEY = 'deshi_gee_last_confirmed_v1';
const ENABLE_POLICY_DRAFTS = process.env.NEXT_PUBLIC_ENABLE_POLICY_DRAFTS === 'true';

type PolicyKey = 'delivery' | 'return' | 'privacy' | 'terms' | null;

interface StorefrontContextValue {
  lang: Lang;
  setLang: Dispatch<SetStateAction<Lang>>;
  settings: StoreSettingsDoc;
  setSettings: Dispatch<SetStateAction<StoreSettingsDoc>>;
  activeBatch: BatchRecord | null;
  qrCodeUrl: string;
  reviews: ReviewRecord[];
  setReviews: Dispatch<SetStateAction<ReviewRecord[]>>;
  cart: CartJarItem[];
  setCart: Dispatch<SetStateAction<CartJarItem[]>>;
  lastConfirmedOrder: OrderRecord | null;
  setLastConfirmedOrder: Dispatch<SetStateAction<OrderRecord | null>>;
  drawerOpen: boolean;
  setDrawerOpen: Dispatch<SetStateAction<boolean>>;
  trackPrefill: { order: string; phone: string };
  setTrackPrefill: Dispatch<SetStateAction<{ order: string; phone: string }>>;
  handleUpdateCartQty: (weight: WeightKey, delta: number) => void;
  handleRemoveCartItem: (weight: WeightKey) => void;
  chatbotConfig: ChatbotConfigDoc;
  setChatbotConfig: Dispatch<SetStateAction<ChatbotConfigDoc>>;
  openChatAssistant: () => void;
  openCallbackRequest: () => void;
  packageMeta: PublicPackages | null;
  cms: CmsContent | null;
}

const StorefrontContext = createContext<StorefrontContextValue | null>(null);

export function useStorefront(): StorefrontContextValue {
  const ctx = useContext(StorefrontContext);
  if (!ctx) {
    throw new Error('useStorefront must be used inside StorefrontProvider');
  }
  return ctx;
}

export function StorefrontProvider({
  children,
  initialSettings,
}: {
  children: ReactNode;
  initialSettings?: StoreSettingsDoc;
}) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const isAdminRoute = pathname.startsWith('/admin');

  const resolvedInitialSettings = initialSettings
    ? { ...DEFAULT_STORE_SETTINGS, ...initialSettings }
    : DEFAULT_STORE_SETTINGS;

  const [lang, setLang] = useState<Lang>('bn');
  const [hydratedStorage, setHydratedStorage] = useState(false);
  const [packageMeta, setPackageMeta] = useState<PublicPackages | null>(null);
  const [cms, setCms] = useState<CmsContent | null>(null);

  useEffect(() => {
    if (pathname.startsWith('/admin')) return;
    let cancelled = false;
    fetch('/api/tracking/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.ok && d.tracking) loadTrackers(d.tracking);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const announce = cms && isAnnouncementActive(cms.announcement) ? cms.announcement : null;
  const hideAnnouncement = cms ? isAnnouncementHidden(cms.announcement) : false;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/cms/published')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.ok && d.content) setCms(d.content as CmsContent);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/packages/public')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.ok && d.packages) setPackageMeta(d.packages as PublicPackages);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-sf-theme', 'light');
  }, []);

  const [settings, setSettings] = useState<StoreSettingsDoc>(resolvedInitialSettings);
  const [chatbotConfig, setChatbotConfig] = useState<ChatbotConfigDoc>(
    DEFAULT_CHATBOT_CONFIG
  );
  const [activeBatch, setActiveBatch] = useState<BatchRecord | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);

  const [headerElevated, setHeaderElevated] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [policyModal, setPolicyModal] = useState<PolicyKey>(null);
  const [callbackModalOpen, setCallbackModalOpen] = useState<boolean>(false);
  const [cbName, setCbName] = useState('');
  const [cbPhone, setCbPhone] = useState('');
  const [cbNote, setCbNote] = useState('');
  const [cbBusy, setCbBusy] = useState(false);
  const [cbResult, setCbResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [trackPrefill, setTrackPrefill] = useState<{ order: string; phone: string }>({
    order: '',
    phone: '',
  });
  const [cart, setCart] = useState<CartJarItem[]>([]);
  const [lastConfirmedOrder, setLastConfirmedOrder] = useState<OrderRecord | null>(null);
  const [settingsReady, setSettingsReady] = useState<boolean>(Boolean(initialSettings));

  const policyTriggerRef = useRef<HTMLButtonElement | null>(null);
  const policyCloseBtnRef = useRef<HTMLButtonElement | null>(null);

  const bn = lang === 'bn';

  const openChatAssistant = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('deshi-gee-open-chat'));
    }
  }, []);

  const openCallbackRequest = useCallback(() => {
    setCbResult(null);
    setCallbackModalOpen(true);
  }, []);

  useEffect(() => {
    try {
      const savedLang = localStorage.getItem(STORAGE_LANG_KEY);
      if (savedLang === 'bn' || savedLang === 'en') {
        setLang(savedLang);
      }
      const savedCart = localStorage.getItem(STORAGE_CART_KEY);
      if (savedCart) {
        setCart(JSON.parse(savedCart) as CartJarItem[]);
      }
      const savedOrder = localStorage.getItem(STORAGE_LAST_ORDER_KEY);
      if (savedOrder) {
        setLastConfirmedOrder(JSON.parse(savedOrder) as OrderRecord);
      }
    } catch {
      // ignore localStorage access failures
    }
    setHydratedStorage(true);
  }, []);

  useEffect(() => {
    if (!hydratedStorage) return;
    document.documentElement.setAttribute('data-lang', lang);
    document.documentElement.setAttribute('lang', lang);
    try {
      localStorage.setItem(STORAGE_LANG_KEY, lang);
    } catch {
      // ignore
    }
    if (!isAdminRoute) {
      document.title =
        lang === 'bn'
          ? 'দেশী ঘি — পাবনার খাঁটি কাঠের বিলোনার গাওয়া ঘি'
          : 'Deshi Gee — Pure Pabna Grass-Fed Bilona Cow Ghee';
    }
  }, [lang, hydratedStorage, isAdminRoute]);

  useEffect(() => {
    if (!hydratedStorage) return;
    try {
      localStorage.setItem(STORAGE_CART_KEY, JSON.stringify(cart));
    } catch {
      // ignore
    }
  }, [cart, hydratedStorage]);

  useEffect(() => {
    if (!hydratedStorage || !lastConfirmedOrder) return;
    try {
      localStorage.setItem(
        STORAGE_LAST_ORDER_KEY,
        JSON.stringify(lastConfirmedOrder)
      );
    } catch {
      // ignore
    }
  }, [lastConfirmedOrder, hydratedStorage]);

  useEffect(() => {
    testFirestoreConnection();

    (async () => {
      try {
        const [loadedSettings, loadedReviews, loadedChatbot] = await Promise.all([
          fetchStoreSettings(),
          fetchApprovedReviews(),
          fetchPublishedChatbotConfig(),
        ]);
        setSettings(loadedSettings);
        setReviews(loadedReviews);
        setChatbotConfig(loadedChatbot);

        const batchRec = loadedSettings.activeBatchCode
          ? await fetchBatchRecord(loadedSettings.activeBatchCode)
          : null;
        setActiveBatch(batchRec && batchRec.batchCode ? batchRec : null);

        if (batchRec && batchRec.batchCode) {
          const qrLink = `${window.location.origin}/batch?code=${encodeURIComponent(
            batchRec.batchCode
          )}`;
          const qrData = await QRCode.toDataURL(qrLink, {
            width: 200,
            margin: 1,
            color: { dark: '#141A15', light: '#FAFAF8' },
          });
          setQrCodeUrl(qrData);
        } else {
          setQrCodeUrl('');
        }
      } catch {
        // Fallback / SSR initial settings remain active cleanly
      } finally {
        setSettingsReady(true);
      }
    })();

    if (!isAdminRoute) {
      trackStoreEvent('ViewContent', {
        content_name: 'Deshi Gee — Pabna Grass-Fed Cow Ghee',
        currency: 'BDT',
      });
    }
  }, [isAdminRoute]);

  useEffect(() => {
    if (!hydratedStorage || !settingsReady || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const rawReorder = params.get('reorder');
    if (!rawReorder) return;

    const stockByWeight: Record<WeightKey, number> = {
      '250g': Math.max(0, Math.round(settings.stock250g)),
      '500g': Math.max(0, Math.round(settings.stock500g)),
      '1kg': Math.max(0, Math.round(settings.stock1kg)),
    };

    const nextCart: CartJarItem[] = [];
    for (const part of rawReorder.split(',')) {
      const [wRaw, qRaw] = part.split(':');
      const w = wRaw?.trim() as WeightKey;
      const requested = Math.round(Number(qRaw || 0));
      if ((w === '250g' || w === '500g' || w === '1kg') && requested > 0) {
        const clamped = Math.min(requested, stockByWeight[w]);
        if (clamped > 0 && !nextCart.some((c) => c.weight === w)) {
          nextCart.push({ weight: w, qty: clamped });
        }
      }
    }

    if (nextCart.length > 0) {
      setCart(nextCart);
      setDrawerOpen(true);
    }

    params.delete('reorder');
    const qs = params.toString();
    const cleanedUrl = `${pathname}${qs ? `?${qs}` : ''}`;
    window.history.replaceState({}, '', cleanedUrl);
  }, [hydratedStorage, settingsReady, settings, pathname]);

  useEffect(() => {
    const onScroll = () => setHeaderElevated(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!policyModal) return;
    policyCloseBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPolicyModal(null);
        policyTriggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [policyModal]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileMenuOpen]);

  useEffect(() => {
    const locked = drawerOpen || mobileMenuOpen || policyModal !== null;
    if (!locked) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen, mobileMenuOpen, policyModal]);

  const openPolicy = (key: Exclude<PolicyKey, null>, el: HTMLButtonElement | null) => {
    policyTriggerRef.current = el;
    setPolicyModal(key);
  };

  const closePolicy = () => {
    setPolicyModal(null);
    policyTriggerRef.current?.focus();
  };

  const navigateToSection = useCallback(
    (sectionId: string) => {
      setMobileMenuOpen(false);
      if (pathname === '/') {
        const target = document.getElementById(sectionId);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }
      router.push(`/#${sectionId}`);
    },
    [pathname, router]
  );

  const handleUpdateCartQty = useCallback(
    (weight: WeightKey, delta: number) => {
      setCart((prev) =>
        prev
          .map((item) => {
            if (item.weight !== weight) return item;
            const stock =
              weight === '250g'
                ? settings.stock250g
                : weight === '500g'
                  ? settings.stock500g
                  : settings.stock1kg;
            const targetQty = item.qty + delta;
            const cappedQty = delta > 0 ? Math.min(stock, targetQty) : targetQty;
            return { ...item, qty: cappedQty };
          })
          .filter((item) => item.qty > 0)
      );
    },
    [settings]
  );

  const handleRemoveCartItem = useCallback((weight: WeightKey) => {
    setCart((prev) => prev.filter((item) => item.weight !== weight));
  }, []);

  const totalBagCount = cart.reduce((s, c) => s + c.qty, 0);
  const phoneConfigured = hasValidRealPhone(settings.supportPhone);
  const whatsappConfigured = hasValidRealPhone(settings.whatsappNumber);
  const emailConfigured = hasValidRealContact(settings.supportEmail);
  const addressConfigured = hasValidRealContact(settings.businessAddress);
  const mapsConfigured = hasValidRealUrl(settings.googleMapsUrl);
  const hasAnyDirectContact =
    phoneConfigured || whatsappConfigured || emailConfigured || addressConfigured;
  const freeThresholdConfirmed =
    isStoreFieldConfirmed(settings, 'freeDeliveryThreshold') &&
    settings.freeDeliveryThreshold > 0;

  const whatsappDigits = whatsappConfigured
    ? settings.whatsappNumber.replace(/[^0-9]/g, '')
    : '';
  const whatsappChatHref = whatsappDigits
    ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(
        bn
          ? 'আসসালামু আলাইকুম, দেশী ঘি সম্পর্কে জানতে চাই।'
          : 'Assalamu Alaikum, I would like to inquire about Deshi Gee.'
      )}`
    : '';

  const handleSubmitCallback = async (e: React.FormEvent) => {
    e.preventDefault();
    setCbBusy(true);
    setCbResult(null);
    try {
      const res = await fetch('/api/support/ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-requested-with': 'DeshiGeeStorefront',
        },
        body: JSON.stringify({
          customerName: cbName.trim(),
          phone: cbPhone.trim(),
          category: 'general',
          issueSummary:
            cbNote.trim() ||
            (bn ? 'স্টোরফ্রন্ট থেকে কলব্যাক অনুরোধ' : 'Storefront callback request'),
          consentGranted: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCbResult({
          ok: false,
          msg:
            data.error ||
            (bn
              ? 'অনুরোধ জমা দেওয়া যায়নি। সঠিক মোবাইল নম্বর (01XXXXXXXXX) দিন।'
              : 'Could not submit request. Please enter a valid BD mobile number (01XXXXXXXXX).'),
        });
      } else {
        setCbResult({
          ok: true,
          msg: bn
            ? `আপনার কলব্যাক অনুরোধ গৃহীত হয়েছে (${data.ticketNumber || 'Ticket'})। আমাদের টিম যোগাযোগ করবে।`
            : `Callback request received (${data.ticketNumber || 'Ticket'}). Our team will reach out.`,
        });
        setCbName('');
        setCbPhone('');
        setCbNote('');
      }
    } catch {
      setCbResult({
        ok: false,
        msg: bn ? 'নেটওয়ার্ক ত্রুটি হয়েছে, আবার চেষ্টা করুন।' : 'Network error. Please try again.',
      });
    } finally {
      setCbBusy(false);
    }
  };

  return (
    <StorefrontContext.Provider
      value={{
        lang,
        setLang,
        settings,
        setSettings,
        activeBatch,
        qrCodeUrl,
        reviews,
        setReviews,
        cart,
        setCart,
        lastConfirmedOrder,
        setLastConfirmedOrder,
        drawerOpen,
        setDrawerOpen,
        trackPrefill,
        setTrackPrefill,
        handleUpdateCartQty,
        handleRemoveCartItem,
        chatbotConfig,
        setChatbotConfig,
        openChatAssistant,
        openCallbackRequest,
        packageMeta,
        cms,
      }}
    >
      {isAdminRoute ? (
        <div id="top" className="min-h-screen bg-[#FAF7F2] text-[#1E1710]">
          {children}
        </div>
      ) : (
        <div id="top" className="min-h-screen bg-[var(--c-bg)] text-[var(--c-ink)]">
          {/* SLIM DEEP FOREST GREEN ANNOUNCEMENT STRIP */}
          {!hideAnnouncement && (
            <div
              className="no-print bg-[#0C3F22] px-4 py-2 text-center text-xs font-semibold text-white sm:text-[13px]"
              style={
                announce
                  ? {
                      background: announce.bgColor || undefined,
                      color: announce.textColor || undefined,
                    }
                  : undefined
              }
            >
              <div className="mx-auto flex max-w-[1140px] flex-wrap items-center justify-center gap-x-7 gap-y-1">
                {announce ? (
                  announce.linkUrl && isSafeLink(announce.linkUrl) ? (
                    <a
                      href={announce.linkUrl}
                      className="truncate underline-offset-4 hover:underline"
                      {...(announce.linkUrl.startsWith('http')
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                    >
                      {(bn ? announce.textBn : announce.textEn) ||
                        announce.textEn ||
                        announce.textBn}
                    </a>
                  ) : (
                    <span className="truncate">
                      {(bn ? announce.textBn : announce.textEn) ||
                        announce.textEn ||
                        announce.textBn}
                    </span>
                  )
                ) : (
                  <>
                    <span>
                      {bn ? 'সারা বাংলাদেশে হোম ডেলিভারি' : 'Nationwide Home Delivery'}
                    </span>
                    <span aria-hidden="true" className="hidden text-[#FFD21F] sm:inline">
                      ·
                    </span>
                    <span className="hidden sm:inline">
                      {bn ? 'পণ্য হাতে পেয়ে টাকা পরিশোধ' : 'Pay Cash on Delivery'}
                    </span>
                    <span aria-hidden="true" className="hidden text-[#FFD21F] md:inline">
                      ·
                    </span>
                    <span className="hidden md:inline">
                      {bn ? 'দেখে ও ঘ্রাণ নিয়ে তারপর পেমেন্ট' : 'Inspect & Smell Before Paying'}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* MINIMAL 1-ROW, 3-ZONE UTILITY NAVIGATION BAR */}
          <header
            className={`sticky top-0 z-30 border-b transition-colors duration-200 ${
              headerElevated || mobileMenuOpen
                ? 'border-[#E7E3D3] bg-white/95 backdrop-blur-md'
                : 'border-[#E7E3D3]/70 bg-[#FFFAEB]/95'
            }`}
          >
            <div className="mx-auto flex h-16 max-w-[1140px] items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
              {/* Zone 1: Single-line Brand Wordmark */}
              <Link
                href="/"
                onClick={() => setMobileMenuOpen(false)}
                className="font-display shrink-0 whitespace-nowrap text-xl font-extrabold tracking-tight text-[#0C3F22] transition-colors hover:text-[#16673A] sm:text-2xl"
              >
                Deshi Gee
              </Link>

              {/* Zone 2: Clean Single-Line Utility Nav Links */}
              <nav
                aria-label="Primary Navigation"
                className="hidden items-center gap-7 text-sm font-semibold text-[#56645A] md:flex"
              >
                <Link
                  href="/#craft"
                  onClick={(e) => {
                    if (pathname === '/') {
                      e.preventDefault();
                      navigateToSection('craft');
                    }
                  }}
                  className="shrink-0 whitespace-nowrap py-1 transition-colors hover:text-[#0C3F22]"
                >
                  {bn ? 'তৈরির ধাপ' : 'Craft'}
                </Link>
                <Link
                  href="/#faq"
                  onClick={(e) => {
                    if (pathname === '/') {
                      e.preventDefault();
                      navigateToSection('faq');
                    }
                  }}
                  className="shrink-0 whitespace-nowrap py-1 transition-colors hover:text-[#0C3F22]"
                >
                  {bn ? 'প্রশ্ন ও উত্তর' : 'FAQ'}
                </Link>
                <Link
                  href="/track"
                  className="shrink-0 whitespace-nowrap py-1 transition-colors hover:text-[#0C3F22]"
                >
                  {bn ? 'অর্ডার ট্র্যাক' : 'Track Order'}
                </Link>
                <Link
                  href="/batch"
                  className="shrink-0 whitespace-nowrap py-1 transition-colors hover:text-[#0C3F22]"
                >
                  {bn ? 'ব্যাচ যাচাই' : 'Batch Check'}
                </Link>
              </nav>

              {/* Zone 3: Language Switch + Single Primary Order CTA */}
              <div className="flex shrink-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setLang((l) => (l === 'bn' ? 'en' : 'bn'))}
                  aria-label="Switch language between Bangla and English"
                  className="inline-flex min-h-[40px] shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-[#E7E3D3] bg-white px-3 text-xs font-bold text-[#0C3F22] transition-colors hover:border-[#1F8A4C] hover:bg-[#F4FAF5]"
                >
                  {lang === 'bn' ? 'EN' : 'বাংলা'}
                </button>

                <Link
                  href="/#order"
                  onClick={(e) => {
                    setMobileMenuOpen(false);
                    if (pathname === '/') {
                      e.preventDefault();
                      navigateToSection('order');
                    }
                  }}
                  className="hidden min-h-[42px] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-gradient-to-br from-[#1F8A4C] to-[#16673A] px-5 text-xs font-bold text-white shadow-[0_6px_16px_rgba(22,103,58,0.26)] transition-transform hover:-translate-y-0.5 sm:inline-flex"
                >
                  {bn ? 'অর্ডার করুন' : 'Order Now'}
                </Link>

                <button
                  type="button"
                  onClick={() => setMobileMenuOpen((v) => !v)}
                  aria-expanded={mobileMenuOpen}
                  aria-label="Toggle mobile menu"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#E7E3D3] bg-white text-[#0C3F22] transition-colors hover:bg-[#F4FAF5] md:hidden"
                >
                  {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Mobile Menu Panel */}
            {mobileMenuOpen && (
              <div className="border-t border-[#E7E3D3] bg-white px-4 py-4 md:hidden">
                <div className="flex flex-col gap-1 text-sm font-semibold text-[#14231A]">
                  <Link
                    href="/#order"
                    onClick={(e) => {
                      if (pathname === '/') {
                        e.preventDefault();
                        navigateToSection('order');
                      } else {
                        setMobileMenuOpen(false);
                      }
                    }}
                    className="flex min-h-[44px] items-center rounded-xl px-3 hover:bg-[#F4FAF5]"
                  >
                    {bn ? 'অর্ডার করুন' : 'Order Now'}
                  </Link>
                  <Link
                    href="/#craft"
                    onClick={(e) => {
                      if (pathname === '/') {
                        e.preventDefault();
                        navigateToSection('craft');
                      } else {
                        setMobileMenuOpen(false);
                      }
                    }}
                    className="flex min-h-[44px] items-center rounded-xl px-3 hover:bg-[#F4FAF5]"
                  >
                    {bn ? 'তৈরির ধাপ' : 'Craft Process'}
                  </Link>
                  <Link
                    href="/track"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex min-h-[44px] items-center rounded-xl px-3 hover:bg-[#F4FAF5]"
                  >
                    {bn ? 'অর্ডার ট্র্যাক' : 'Track Order'}
                  </Link>
                  <Link
                    href="/batch"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex min-h-[44px] items-center rounded-xl px-3 hover:bg-[#F4FAF5]"
                  >
                    {bn ? 'ব্যাচ যাচাই' : 'Batch Check'}
                  </Link>
                  <div className="mt-2 border-t border-[#E7E3D3] pt-2">
                    {whatsappConfigured ? (
                      <a
                        href={whatsappChatHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-[#16673A] hover:bg-[#F4FAF5]"
                      >
                        <MessageCircle className="h-4 w-4" />
                        <span>{bn ? 'হোয়াটসঅ্যাপ সাপোর্ট' : 'WhatsApp Support'}</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileMenuOpen(false);
                          openCallbackRequest();
                        }}
                        className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 text-left text-[#16673A] hover:bg-[#F4FAF5]"
                      >
                        <MessageCircle className="h-4 w-4" />
                        <span>{bn ? 'কলব্যাক অনুরোধ করুন' : 'Request a Callback'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </header>

          {/* ACTIVE PAGE CONTENT */}
          {children}

          {/* MINIMAL DARK FOREST FOOTER (#08291A) */}
          <footer className="bg-[#08291A] py-12 text-center text-sm text-[#A9C5B2]">
            <div className="mx-auto max-w-[960px] space-y-4 px-4 sm:px-6">
              <p className="font-display text-xl font-extrabold tracking-widest text-white uppercase">
                DESHI GEE
              </p>
              <p className="text-[15px] text-[#CBE0D1]">
                {bn
                  ? 'খাঁটি দানাদার গাওয়া ঘির বিশ্বস্ত ঠিকানা'
                  : 'Your trusted home for pure artisanal cow ghee'}
              </p>

              {/* Real Configured Contacts (or Callback Request — D17/D18) */}
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
                {phoneConfigured && (
                  <a
                    href={`tel:${settings.supportPhone.replace(/[^0-9+]/g, '')}`}
                    className="font-mono font-semibold text-[#FFD21F] hover:underline"
                  >
                    {settings.supportPhone}
                  </a>
                )}
                {whatsappConfigured && (
                  <a
                    href={whatsappChatHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#FFD21F] hover:underline"
                  >
                    WhatsApp
                  </a>
                )}
                {hasValidRealUrl(settings.facebookUrl) && (
                  <a
                    href={settings.facebookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#FFD21F] hover:underline"
                  >
                    Facebook
                  </a>
                )}
                {!hasAnyDirectContact && (
                  <button
                    type="button"
                    onClick={openCallbackRequest}
                    className="font-semibold text-[#FFD21F] underline underline-offset-4 hover:text-white"
                  >
                    {bn ? 'কলব্যাক অনুরোধ করুন' : 'Request a Callback'}
                  </button>
                )}
              </div>

              {/* Subtle Utility Links */}
              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-xs text-[#A9C5B2]">
                <Link href="/track" className="hover:text-white">
                  {bn ? 'অর্ডার ট্র্যাক' : 'Track Order'}
                </Link>
                <span aria-hidden="true">·</span>
                <Link href="/batch" className="hover:text-white">
                  {bn ? 'ব্যাচ যাচাই' : 'Verify Batch'}
                </Link>
                {ENABLE_POLICY_DRAFTS && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={(e) => openPolicy('delivery', e.currentTarget)}
                      className="hover:text-white"
                    >
                      {bn ? 'ডেলিভারি নীতিমালা (খসড়া)' : 'Delivery Policy (Draft)'}
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={(e) => openPolicy('return', e.currentTarget)}
                      className="hover:text-white"
                    >
                      {bn ? 'রিটার্ন নীতিমালা (খসড়া)' : 'Return Policy (Draft)'}
                    </button>
                  </>
                )}
              </div>

              <p className="pt-1 text-xs text-[#7E9E89]" suppressHydrationWarning>
                © {new Date().getUTCFullYear()} Deshi Gee ·{' '}
                {bn ? 'সর্বস্বত্ব সংরক্ষিত' : 'All rights reserved'}
              </p>
            </div>
          </footer>

          {/* FLOATING WHATSAPP CUSTOMER SUPPORT — ONLY WHEN REAL NUMBER CONFIGURED (D18) */}
          {whatsappConfigured && (
            <a
              href={whatsappChatHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={bn ? 'হোয়াটসঅ্যাপ সাপোর্ট' : 'WhatsApp Customer Support'}
              className="no-print fixed right-6 bottom-[92px] z-20 hidden h-11 items-center gap-2 rounded-lg border border-[rgb(var(--c-tint)/0.14)] bg-[var(--c-card)] px-4 text-xs font-semibold text-[var(--c-ink)] shadow-sm transition-colors hover:bg-[var(--c-surface)] md:inline-flex"
            >
              <MessageCircle className="h-4 w-4 text-[var(--c-green-text)]" />
              <span>{bn ? 'হোয়াটসঅ্যাপ' : 'WhatsApp'}</span>
            </a>
          )}

          {/* DESHI GEE AI CUSTOMER SUPPORT CHATBOT */}
          <ChatWidget
            chatbotConfig={chatbotConfig}
            lang={lang}
            setLang={setLang}
            drawerOpen={drawerOpen}
            onNavigateTrack={(orderNum) => {
              setTrackPrefill((prev) => ({ ...prev, order: orderNum }));
              router.push(`/track?order=${encodeURIComponent(orderNum)}`);
            }}
          />

          {/* REQUEST A CALLBACK TICKET MODAL (D17) */}
          {callbackModalOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="callback-modal-title"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
              onClick={() => setCallbackModalOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-xl border border-[rgb(var(--c-tint)/0.14)] bg-[var(--c-card)] p-6 shadow-xl"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3
                    id="callback-modal-title"
                    className="font-display text-2xl font-semibold text-[var(--c-ink)]"
                  >
                    {bn ? 'কলব্যাক অনুরোধ করুন' : 'Request a Callback'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setCallbackModalOpen(false)}
                    aria-label={bn ? 'বন্ধ করুন' : 'Close dialog'}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[rgb(var(--c-tint)/0.12)] hover:bg-[var(--c-surface)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <form onSubmit={handleSubmitCallback} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--c-muted)]">
                      {bn ? 'আপনার নাম *' : 'Your Name *'}
                    </label>
                    <input
                      type="text"
                      required
                      value={cbName}
                      onChange={(e) => setCbName(e.target.value)}
                      className="mt-1.5 min-h-[44px] w-full rounded-lg border border-[rgb(var(--c-tint)/0.16)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-ink)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--c-muted)]">
                      {bn ? 'মোবাইল নম্বর (01XXXXXXXXX) *' : 'Mobile Number (01XXXXXXXXX) *'}
                    </label>
                    <input
                      type="tel"
                      inputMode="tel"
                      required
                      value={cbPhone}
                      onChange={(e) => setCbPhone(e.target.value)}
                      placeholder="017XXXXXXXX"
                      className="mt-1.5 min-h-[44px] w-full rounded-lg border border-[rgb(var(--c-tint)/0.16)] bg-[var(--c-bg)] px-3 py-2 font-mono text-sm text-[var(--c-ink)] tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--c-muted)]">
                      {bn ? 'সংক্ষিপ্ত বার্তা' : 'Short Message'}
                    </label>
                    <textarea
                      rows={3}
                      value={cbNote}
                      onChange={(e) => setCbNote(e.target.value)}
                      placeholder={bn ? 'আপনার প্রশ্ন বা অর্ডারের বিষয় লিখুন' : 'How can we help you?'}
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--c-tint)/0.16)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-ink)]"
                    />
                  </div>
                  {cbResult && (
                    <p
                      className={`text-xs font-medium ${
                        cbResult.ok ? 'text-[var(--c-green-text)]' : 'text-red-700'
                      }`}
                    >
                      {cbResult.msg}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={cbBusy}
                    className="btn-primary w-full"
                  >
                    {cbBusy
                      ? '...'
                      : bn
                        ? 'কলব্যাক অনুরোধ পাঠান'
                        : 'Submit Callback Request'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* BILINGUAL POLICY MODAL (D10: DRAFT — OWNER REVIEW REQUIRED) */}
          {ENABLE_POLICY_DRAFTS && policyModal && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="policy-modal-title"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
              onClick={closePolicy}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="max-h-[85dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-xl border border-[rgb(var(--c-tint)/0.14)] bg-[var(--c-card)] p-6 shadow-xl"
              >
                <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                  {bn
                    ? 'খসড়া — মালিকের অনুমোদন প্রয়োজন (DRAFT – owner review required)'
                    : 'DRAFT – owner review required before publishing as final store policy.'}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <h3
                    id="policy-modal-title"
                    className="font-display text-2xl font-semibold text-[var(--c-ink)]"
                  >
                    {policyModal === 'delivery' &&
                      (bn ? 'ডেলিভারি নীতিমালা (খসড়া)' : 'Delivery Policy (Draft)')}
                    {policyModal === 'return' &&
                      (bn ? 'রিটার্ন ও রিফান্ড নীতিমালা (খসড়া)' : 'Return & Refund Policy (Draft)')}
                    {policyModal === 'privacy' &&
                      (bn ? 'প্রাইভেসি পলিসি (খসড়া)' : 'Privacy Policy (Draft)')}
                    {policyModal === 'terms' &&
                      (bn ? 'শর্তাবলী (খসড়া)' : 'Terms & Conditions (Draft)')}
                  </h3>
                  <button
                    ref={policyCloseBtnRef}
                    type="button"
                    onClick={closePolicy}
                    aria-label={bn ? 'নীতিমালা বন্ধ করুন' : 'Close policy dialog'}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[rgb(var(--c-tint)/0.12)] hover:bg-[var(--c-surface)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-[var(--c-muted)]">
                  {policyModal === 'delivery' &&
                    (bn
                      ? 'ডেলিভারি চার্জ ও সম্ভাব্য সময় চেকআউটে প্রদর্শিত মালিক-অনুমোদিত সেটিংস অনুযায়ী প্রযোজ্য।'
                      : 'Delivery fees and estimated timelines follow the owner-confirmed rates shown live at checkout.')}
                  {policyModal === 'return' &&
                    (bn
                      ? 'ক্ষতিগ্রস্ত বা সিল খোলা পার্সেল পেলে ছবি সহ আমাদের সাপোর্ট টিমের সাথে যোগাযোগ করুন। রিটার্ন/রিফান্ড সিদ্ধান্ত মালিক-অনুমোদিত নীতিমালা অনুযায়ী টিম পর্যালোচনা করবে।'
                      : 'If a jar arrives damaged or with an open tamper seal, contact support with a photo for review under our owner-confirmed policy.')}
                  {policyModal === 'privacy' &&
                    (bn
                      ? 'ক্রেতাদের নাম, মোবাইল নম্বর ও ডেলিভারি ঠিকানা শুধুমাত্র অর্ডার ডেলিভারি, সাপোর্ট এবং যাচাইয়ের জন্য সংরক্ষণ করা হয়। চ্যাট ও অর্ডার ডেটা সংরক্ষণের সময়সীমা অ্যাডমিন সেটিংস অনুযায়ী নির্ধারিত।'
                      : 'Customer names, phone numbers, delivery addresses, and chat transcripts are used solely for fulfillment and support, subject to store retention settings.')}
                  {policyModal === 'terms' &&
                    (bn
                      ? 'সকল মূল্য বাংলাদেশি টাকায় (BDT) প্রদর্শিত। মোবাইল পেমেন্ট আমাদের টিম যাচাই করার পর চূড়ান্ত নিশ্চিত হয়।'
                      : 'All confirmed prices are listed in Bangladeshi Taka (BDT). Mobile payments remain pending verification until confirmed by our team.')}
                </p>
              </div>
            </div>
          )}

          {/* SLIDE-OVER BAG & CHECKOUT DRAWER */}
          <BagCheckoutDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            lang={lang}
            settings={settings}
            cart={cart}
            onUpdateQty={handleUpdateCartQty}
            onRemoveItem={handleRemoveCartItem}
            onClearCart={() => setCart([])}
            lastConfirmedOrder={lastConfirmedOrder}
            onOrderConfirmed={(order) => setLastConfirmedOrder(order)}
            onNavigateTrack={(orderNumber, phone) => {
              setTrackPrefill({ order: orderNumber, phone });
              router.push('/track');
            }}
          />
        </div>
      )}
    </StorefrontContext.Provider>
  );
}
