'use client';

import {
  Dispatch,
  ReactNode,
  SetStateAction,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { Menu, MessageCircle, ShoppingBag, X } from 'lucide-react';
import {
  BatchRecord,
  DEFAULT_ACTIVE_BATCH,
  DEFAULT_STORE_SETTINGS,
  OrderRecord,
  ReviewRecord,
  StoreSettingsDoc,
  WeightKey,
  fetchApprovedReviews,
  fetchBatchRecord,
  fetchStoreSettings,
  testFirestoreConnection,
} from '../lib/firebase';
import { Lang, formatBdt } from '../data/deshiGeeData';
import { trackStoreEvent } from '../lib/analytics';
import {
  DEFAULT_CHATBOT_CONFIG,
  type ChatbotConfigDoc,
} from '../lib/chatbot/types';
import { fetchPublishedChatbotConfig } from '../lib/firebaseChatbot';
import { BagCheckoutDrawer, CartJarItem } from './BagCheckoutDrawer';
import { ChatWidget } from './chatbot/ChatWidget';

const STORAGE_CART_KEY = 'deshi_gee_single_cart_v1';
const STORAGE_LANG_KEY = 'deshi_gee_lang_v1';
const STORAGE_LAST_ORDER_KEY = 'deshi_gee_last_confirmed_v1';

type PolicyKey = 'delivery' | 'return' | 'privacy' | 'terms' | null;

interface StorefrontContextValue {
  lang: Lang;
  setLang: Dispatch<SetStateAction<Lang>>;
  settings: StoreSettingsDoc;
  setSettings: Dispatch<SetStateAction<StoreSettingsDoc>>;
  activeBatch: BatchRecord;
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
}

const StorefrontContext = createContext<StorefrontContextValue | null>(null);

export function useStorefront(): StorefrontContextValue {
  const ctx = useContext(StorefrontContext);
  if (!ctx) {
    throw new Error('useStorefront must be used inside StorefrontProvider');
  }
  return ctx;
}

export function StorefrontProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const isHome = pathname === '/';

  const [lang, setLang] = useState<Lang>('en');
  const [hydratedStorage, setHydratedStorage] = useState(false);

  const [settings, setSettings] = useState<StoreSettingsDoc>(DEFAULT_STORE_SETTINGS);
  const [chatbotConfig, setChatbotConfig] = useState<ChatbotConfigDoc>(
    DEFAULT_CHATBOT_CONFIG
  );
  const [activeBatch, setActiveBatch] = useState<BatchRecord>(DEFAULT_ACTIVE_BATCH);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);

  const [headerSolid, setHeaderSolid] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [policyModal, setPolicyModal] = useState<PolicyKey>(null);

  const [trackPrefill, setTrackPrefill] = useState<{ order: string; phone: string }>({
    order: '',
    phone: '',
  });
  const [cart, setCart] = useState<CartJarItem[]>([]);
  const [lastConfirmedOrder, setLastConfirmedOrder] = useState<OrderRecord | null>(null);
  const [settingsReady, setSettingsReady] = useState<boolean>(false);

  const bn = lang === 'bn';

  // Hydrate persisted client preferences cleanly after mount to prevent SSR hydration mismatch
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
    document.title =
      lang === 'bn'
        ? 'দেশী ঘি — পাবনার খাঁটি কাঠের বিলোনার গাওয়া ঘি'
        : 'Deshi Gee — Pure Pabna Grass-Fed Bilona Cow Ghee';
  }, [lang, hydratedStorage]);

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

  // Boot Firestore connection & load live settings, batch provenance, and approved reviews
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

        const batchRec = await fetchBatchRecord(loadedSettings.activeBatchCode);
        const resolvedBatch = batchRec || DEFAULT_ACTIVE_BATCH;
        setActiveBatch(resolvedBatch);

        const qrLink = `${window.location.origin}/batch?code=${encodeURIComponent(
          resolvedBatch.batchCode
        )}`;
        const qrData = await QRCode.toDataURL(qrLink, {
          width: 200,
          margin: 1,
          color: { dark: '#1E1710', light: '#FAF7F2' },
        });
        setQrCodeUrl(qrData);
      } catch {
        // Fallback defaults remain active cleanly
      } finally {
        setSettingsReady(true);
      }
    })();

    trackStoreEvent('ViewContent', {
      content_name: 'Deshi Gee — Pabna Grass-Fed Cow Ghee',
      currency: 'BDT',
    });
  }, []);

  // Support one-click Reorder URL (`/?reorder=250g:N,500g:N,1kg:N`) clamped to live jar stock
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

  // Sticky Header transparency -> warm linen transition
  useEffect(() => {
    const onScroll = () => {
      setHeaderSolid(window.scrollY > 36);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Lock background page scroll on mobile/desktop when drawer, mobile menu, or policy modal is open
  useEffect(() => {
    const locked = drawerOpen || mobileMenuOpen || policyModal !== null;
    if (!locked) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen, mobileMenuOpen, policyModal]);

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

  const handleUpdateCartQty = useCallback((weight: WeightKey, delta: number) => {
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
  }, [settings]);

  const handleRemoveCartItem = useCallback((weight: WeightKey) => {
    setCart((prev) => prev.filter((item) => item.weight !== weight));
  }, []);

  const totalBagCount = cart.reduce((s, c) => s + c.qty, 0);
  const whatsappDigits = settings.whatsappNumber.replace(/[^0-9]/g, '');
  const whatsappChatHref = whatsappDigits
    ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(
        bn
          ? 'আসসালামু আলাইকুম, দেশী ঘি সম্পর্কে জানতে চাই।'
          : 'Assalamu Alaikum, I would like to inquire about Deshi Gee.'
      )}`
    : `https://wa.me/?text=${encodeURIComponent('Hello Deshi Gee')}`;

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
      }}
    >
      <div id="top" className="min-h-screen bg-[#FAF7F2] text-[#1E1710]">
        {/* PRESTIGE ANNOUNCEMENT TICKER */}
        <div className="no-print relative z-40 border-b border-[#B47B2B]/20 bg-[#1A120B] text-[#FAF7F2] py-2 px-4 text-xs font-medium tracking-wide">
          <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4">
            <div className="flex items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#B47B2B]/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#F5D692]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#D4AF37] animate-pulse" />
                {bn ? 'সরাসরি পাবনা থেকে' : 'Fresh Harvest'}
              </span>
              <span className="text-[#E8DFC5] hidden sm:inline">
                {bn
                  ? '🌾 পাবনার চারণভূমির কাঁচা দুধে পাতা দইয়ের বিলোনা ঘি · দেশজুড়ে ক্যাশ অন ডেলিভারি'
                  : 'Single-Origin Pabna Grass-Fed Bilona Cow Ghee · Cash on Delivery Nationwide'}
              </span>
              <span className="text-[#E8DFC5] sm:hidden truncate">
                {bn ? 'পাবনার খাঁটি বিলোনা গাওয়া ঘি' : 'Pabna Grass-Fed Bilona Cow Ghee'}
              </span>
            </div>

            <div className="hidden lg:flex items-center gap-4 text-[11px] text-[#C5B8A5] shrink-0">
              <span>
                {bn ? 'ফ্রি ডেলিভারি ৳২,০০০+ অর্ডারে' : 'Free Delivery on Orders ৳2,000+'}
              </span>
              <span className="text-[#B47B2B]">·</span>
              <span className="font-mono text-[#F5D692]">{activeBatch.batchCode}</span>
              <span className="text-[#B47B2B]">·</span>
              <Link
                href="/track"
                className="text-[#E8DFC5] hover:text-[#FAF7F2] transition-colors underline decoration-[#B47B2B]/40 underline-offset-2"
              >
                {bn ? 'অর্ডার ট্র্যাক' : 'Track Order'}
              </Link>
            </div>
          </div>
        </div>

        {/* GLOBAL HEADER */}
        <header
          className={`sticky top-0 z-30 transition-all duration-300 ${
            headerSolid || !isHome || mobileMenuOpen
              ? 'border-b border-[rgba(30,23,16,0.10)] bg-[#FAF7F2]/90 backdrop-blur-md shadow-[0_4px_24px_rgba(30,23,16,0.04)] py-3 sm:py-3.5'
              : 'bg-transparent py-4 sm:py-5'
          }`}
        >
          <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-3 px-4 sm:gap-6 sm:px-8">
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              className="group flex flex-col shrink-0"
            >
              <span className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#1E1710] group-hover:text-[#8A5A17] transition-colors flex items-center gap-1.5">
                <span>{bn ? 'দেশী ঘি' : 'Deshi Gee'}</span>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#B47B2B]" />
              </span>
              <span className="font-mono text-[9px] tracking-widest uppercase text-[#8A5A17] -mt-0.5 hidden sm:block">
                {bn ? 'পাবনা · খাঁটি বিলোনা' : 'Pabna · Single Origin'}
              </span>
            </Link>

            {/* Primary Single-Line Navigation */}
            <nav
              aria-label="Primary Navigation"
              className="hidden items-center gap-8 text-sm font-medium text-[#635647] md:flex"
            >
              <Link
                href="/#story"
                onClick={(e) => {
                  if (pathname === '/') {
                    e.preventDefault();
                    navigateToSection('story');
                  }
                }}
                className="relative py-1 hover:text-[#1E1710] transition-colors after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1.5px] after:bg-[#B47B2B] after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:origin-left"
              >
                {bn ? 'উৎস ও খামার' : 'Origin & Story'}
              </Link>
              <Link
                href="/#craft"
                onClick={(e) => {
                  if (pathname === '/') {
                    e.preventDefault();
                    navigateToSection('craft');
                  }
                }}
                className="relative py-1 hover:text-[#1E1710] transition-colors after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1.5px] after:bg-[#B47B2B] after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:origin-left"
              >
                {bn ? 'বিলোনা প্রণালী' : 'Bilona Craft'}
              </Link>
              <Link
                href="/#proof"
                onClick={(e) => {
                  if (pathname === '/') {
                    e.preventDefault();
                    navigateToSection('proof');
                  }
                }}
                className="relative py-1 hover:text-[#1E1710] transition-colors after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1.5px] after:bg-[#B47B2B] after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:origin-left"
              >
                {bn ? 'ল্যাব ও ব্যাচ' : 'Lab Proof'}
              </Link>
              <Link
                href="/#order"
                onClick={(e) => {
                  if (pathname === '/') {
                    e.preventDefault();
                    navigateToSection('order');
                  }
                }}
                className="relative py-1 font-semibold text-[#8A5A17] hover:text-[#1E1710] transition-colors after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1.5px] after:bg-[#8A5A17] after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:origin-left"
              >
                {bn ? 'অর্ডার করুন' : 'Order Jar'}
              </Link>
            </nav>

            {/* Right Controls: Language Toggle + Shopping Bag + Mobile Menu */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {/* Language Switcher Pill */}
              <button
                type="button"
                onClick={() => setLang((l) => (l === 'en' ? 'bn' : 'en'))}
                aria-label="Toggle language between English and Bangla"
                className="group relative inline-flex items-center gap-1.5 rounded-full border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] px-3 py-1.5 text-xs font-semibold text-[#1E1710] hover:border-[#B47B2B] hover:bg-[#F2ECE1] transition-all shadow-xs"
              >
                <span className="text-[11px] uppercase tracking-wider text-[#8A5A17]">
                  {lang === 'en' ? 'বাংলা' : 'EN'}
                </span>
              </button>

              {/* Shopping Bag Button */}
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setDrawerOpen(true);
                }}
                className="group relative inline-flex items-center gap-2 rounded-full bg-[#1A120B] px-4 py-2 text-xs font-medium text-[#FAF7F2] hover:bg-[#332415] hover:shadow-[0_8px_20px_rgba(30,23,16,0.18)] transition-all shrink-0"
              >
                <ShoppingBag className="h-3.5 w-3.5 text-[#E5B25D] group-hover:scale-110 transition-transform" />
                <span className="font-medium">{bn ? 'ব্যাগ' : 'Bag'}</span>
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#B47B2B] px-1.5 font-mono text-[11px] font-bold text-[#FFFDF9] tabular-nums">
                  {totalBagCount}
                </span>
              </button>

              {/* Mobile Menu Hamburger */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen((v) => !v)}
                aria-expanded={mobileMenuOpen}
                aria-label="Toggle mobile menu"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] text-[#1E1710] hover:bg-[#F2ECE1] md:hidden transition-colors"
              >
                {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Mobile Drawer Menu */}
          {mobileMenuOpen && (
            <div className="max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-[rgba(30,23,16,0.12)] bg-[#FAF7F2] px-4 py-4 shadow-lg md:hidden">
              <div className="flex flex-col gap-1 text-sm font-medium text-[#1E1710]">
                <Link
                  href="/#story"
                  onClick={(e) => {
                    if (pathname === '/') {
                      e.preventDefault();
                      navigateToSection('story');
                    } else {
                      setMobileMenuOpen(false);
                    }
                  }}
                  className="flex min-h-[44px] items-center rounded-lg px-2 active:bg-[#F2ECE1]"
                >
                  {bn ? 'গল্প ও খামার' : 'Story'}
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
                  className="flex min-h-[44px] items-center rounded-lg px-2 active:bg-[#F2ECE1]"
                >
                  {bn ? 'বিলোনা প্রস্তুতপ্রণালী' : 'Craft'}
                </Link>
                <Link
                  href="/#proof"
                  onClick={(e) => {
                    if (pathname === '/') {
                      e.preventDefault();
                      navigateToSection('proof');
                    } else {
                      setMobileMenuOpen(false);
                    }
                  }}
                  className="flex min-h-[44px] items-center rounded-lg px-2 active:bg-[#F2ECE1]"
                >
                  {bn ? 'ব্যাচ যাচাই' : 'Proof'}
                </Link>
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
                  className="flex min-h-[44px] items-center rounded-lg px-2 active:bg-[#F2ECE1]"
                >
                  {bn ? 'অর্ডার করুন' : 'Order'}
                </Link>
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[rgba(30,23,16,0.10)] px-2 pt-3 text-xs text-[#635647]">
                  <Link
                    href="/track"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex min-h-[40px] items-center font-medium text-[#1E1710]"
                  >
                    {bn ? 'অর্ডার ট্র্যাকিং' : 'Track Order'}
                  </Link>
                  <Link
                    href="/batch"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex min-h-[40px] items-center font-medium text-[#1E1710]"
                  >
                    {bn ? 'ব্যাচ যাচাই' : 'Verify Batch'}
                  </Link>
                  <Link
                    href="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex min-h-[40px] items-center"
                  >
                    Admin
                  </Link>
                  <a
                    href={whatsappChatHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMobileMenuOpen(false)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 font-medium text-[#8A5A17]"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>{bn ? 'হোয়াটসঅ্যাপ' : 'WhatsApp'}</span>
                  </a>
                </div>
              </div>
            </div>
          )}
        </header>

        {/* ACTIVE NEXT.JS ROUTE CONTENT */}
        {children}

        {/* SECTION 12: LUXURY ARTISANAL FOOTER */}
        <footer className="border-t border-[rgba(30,23,16,0.12)] bg-[#1A120B] text-[#E8DFC5] py-16 text-sm">
          <div className="mx-auto max-w-[1320px] px-4 sm:px-8">
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 pb-12 border-b border-[#FAF7F2]/10">
              {/* Brand Column */}
              <div className="lg:col-span-5 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="font-display text-2xl font-bold tracking-tight text-[#FAF7F2]">
                    {bn ? 'দেশী ঘি' : 'Deshi Gee'}
                  </span>
                  <span className="h-1.5 w-1.5 rounded-full bg-[#D4AF37]" />
                  <span className="font-mono text-xs uppercase tracking-widest text-[#B47B2B]">
                    {bn ? 'পাবনা' : 'Pabna'}
                  </span>
                </div>
                <p className="max-w-md text-xs sm:text-sm leading-relaxed text-[#C5B8A5]">
                  {bn
                    ? 'পাবনার সবুজ চারণভূমির দেশী গরুর খাঁটি দুধ দিয়ে মাটির হাঁড়িতে পাতা দই ও কাঠের বিলোনার প্রাচীন মন্থন পদ্ধতিতে প্রস্তুত একক উৎপত্তির খাঁটি গাওয়া ঘি।'
                    : 'Single-origin Pabna grass-fed bilona cow ghee prepared from whole cultured curd, hand-churned in wooden pots, and sealed warm in heavy apothecary glass.'}
                </p>
                <div className="pt-2 flex items-center gap-3 text-xs text-[#E5B25D]">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D4AF37]/30 bg-[#261B12] px-3 py-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#D4AF37]" />
                    {bn ? '১০০% পরীক্ষিত খাঁটি ঘি' : '100% Lab Tested Purity'}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D4AF37]/30 bg-[#261B12] px-3 py-1">
                    {bn ? 'কাঠের বিলোনা মন্থন' : 'Bilona Churned'}
                  </span>
                </div>
              </div>

              {/* Quick Links */}
              <div className="lg:col-span-2 space-y-3">
                <p className="font-mono text-xs font-semibold uppercase tracking-widest text-[#FAF7F2]">
                  {bn ? 'ন্যাভিগেশন' : 'Navigation'}
                </p>
                <ul className="space-y-2 text-xs">
                  <li>
                    <Link href="/#story" className="text-[#C5B8A5] hover:text-[#FAF7F2] transition-colors">
                      {bn ? 'উৎস ও খামার' : 'Origin & Story'}
                    </Link>
                  </li>
                  <li>
                    <Link href="/#craft" className="text-[#C5B8A5] hover:text-[#FAF7F2] transition-colors">
                      {bn ? 'বিলোনা প্রণালী' : 'Bilona Craft'}
                    </Link>
                  </li>
                  <li>
                    <Link href="/#proof" className="text-[#C5B8A5] hover:text-[#FAF7F2] transition-colors">
                      {bn ? 'ল্যাব ও ব্যাচ যাচাই' : 'Verify Batch'}
                    </Link>
                  </li>
                  <li>
                    <Link href="/#order" className="text-[#C5B8A5] hover:text-[#FAF7F2] transition-colors">
                      {bn ? 'অর্ডার করুন' : 'Order Jar'}
                    </Link>
                  </li>
                  <li>
                    <Link href="/track" className="text-[#C5B8A5] hover:text-[#FAF7F2] transition-colors">
                      {bn ? 'অর্ডার ট্র্যাকিং' : 'Track Order'}
                    </Link>
                  </li>
                  <li>
                    <Link href="/admin" className="text-[#8A7867] hover:text-[#FAF7F2] transition-colors">
                      Admin
                    </Link>
                  </li>
                </ul>
              </div>

              {/* Policies */}
              <div className="lg:col-span-2 space-y-3">
                <p className="font-mono text-xs font-semibold uppercase tracking-widest text-[#FAF7F2]">
                  {bn ? 'নীতিমালা' : 'Policies'}
                </p>
                <ul className="space-y-2 text-xs">
                  <li>
                    <button
                      type="button"
                      onClick={() => setPolicyModal('delivery')}
                      className="text-[#C5B8A5] hover:text-[#FAF7F2] transition-colors text-left"
                    >
                      {bn ? 'ডেলিভারি নীতিমালা' : 'Delivery Policy'}
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => setPolicyModal('return')}
                      className="text-[#C5B8A5] hover:text-[#FAF7F2] transition-colors text-left"
                    >
                      {bn ? 'রিটার্ন ও রিফান্ড' : 'Return & Refund'}
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => setPolicyModal('privacy')}
                      className="text-[#C5B8A5] hover:text-[#FAF7F2] transition-colors text-left"
                    >
                      {bn ? 'প্রাইভেসি পলিসি' : 'Privacy Policy'}
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => setPolicyModal('terms')}
                      className="text-[#C5B8A5] hover:text-[#FAF7F2] transition-colors text-left"
                    >
                      {bn ? 'শর্তাবলী' : 'Terms of Service'}
                    </button>
                  </li>
                </ul>
              </div>

              {/* Direct Support & Address */}
              <div className="lg:col-span-3 space-y-3">
                <p className="font-mono text-xs font-semibold uppercase tracking-widest text-[#FAF7F2]">
                  {bn ? 'যোগাযোগ ও সাপোর্ট' : 'Customer Care'}
                </p>
                <div className="space-y-2 text-xs text-[#C5B8A5]">
                  <p>
                    <span className="text-[#8A7867]">{bn ? 'ফোন:' : 'Phone:'}</span>{' '}
                    <span className="text-[#FAF7F2] font-mono">{settings.supportPhone}</span>
                  </p>
                  <p>
                    <span className="text-[#8A7867]">WhatsApp:</span>{' '}
                    <span className="text-[#FAF7F2] font-mono">{settings.whatsappNumber}</span>
                  </p>
                  <p>
                    <span className="text-[#8A7867]">Email:</span>{' '}
                    <span className="text-[#FAF7F2]">{settings.supportEmail}</span>
                  </p>
                  <p className="pt-1 text-[#8A7867] leading-relaxed">
                    {settings.businessAddress}
                  </p>
                </div>

                <div className="flex gap-4 pt-2">
                  {settings.facebookUrl && (
                    <a
                      href={settings.facebookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#E5B25D] hover:underline"
                    >
                      Facebook ↗
                    </a>
                  )}
                  {settings.instagramUrl && (
                    <a
                      href={settings.instagramUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#E5B25D] hover:underline"
                    >
                      Instagram ↗
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Copyright & Provenance Note */}
            <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#8A7867]">
              <p>
                © {new Date().getFullYear()} Deshi Gee. {bn ? 'সর্বস্বত্ব সংরক্ষিত।' : 'All rights reserved.'}
              </p>
              <p className="text-[11px] font-mono text-[#B47B2B]">
                {bn
                  ? 'পাবনার চারণভূমি থেকে বিশ্বস্ত খাঁটি ঘি'
                  : 'Artisanal Single-Origin Ghee · Harvested in Pabna'}
              </p>
            </div>
          </div>
        </footer>

        {/* FLOATING WHATSAPP CUSTOMER SUPPORT (Desktop / Tablet, clear of the AI speech bubble) */}
        {!pathname.startsWith('/admin') && (
          <a
            href={whatsappChatHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={bn ? 'হোয়াটসঅ্যাপ সাপোর্ট' : 'WhatsApp Customer Support'}
            className="no-print fixed right-6 bottom-[140px] z-20 hidden h-11 items-center gap-2 rounded-full border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2]/95 px-4 text-xs font-medium text-[#1E1710] shadow-md backdrop-blur-sm transition-transform hover:scale-[1.03] md:inline-flex"
          >
            <MessageCircle className="h-4 w-4 text-[#8A5A17]" />
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

        {/* POLICY MODAL */}
        {policyModal && (
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1710]/50 p-4 sm:p-5 backdrop-blur-xs"
              onClick={() => setPolicyModal(null)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="max-h-[85dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] p-5 sm:p-6 shadow-2xl"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-lg font-semibold text-[#1E1710] sm:text-xl">
                    {policyModal === 'delivery' && (bn ? 'ডেলিভারি নীতিমালা' : 'Delivery Policy')}
                    {policyModal === 'return' &&
                      (bn ? 'রিটার্ন ও রিফান্ড নীতিমালা' : 'Return & Refund Policy')}
                    {policyModal === 'privacy' && (bn ? 'প্রাইভেসি পলিসি' : 'Privacy Policy')}
                    {policyModal === 'terms' && (bn ? 'শর্তাবলী' : 'Terms & Conditions')}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setPolicyModal(null)}
                    aria-label="Close policy dialog"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-[#F2ECE1]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              <p className="mt-4 text-sm leading-relaxed text-[#635647]">
                {policyModal === 'delivery' &&
                  `Inside Dhaka: ${formatBdt(settings.insideDhakaFee)} (${settings.estimatedDhakaDays}). Outside Dhaka: ${formatBdt(settings.outsideDhakaFee)} (${settings.estimatedOutsideDays}). Orders of ${formatBdt(settings.freeDeliveryThreshold)} or above qualify for free delivery.`}
                {policyModal === 'return' &&
                  'If your glass jar arrives cracked, leaking, or with a compromised tamper seal, message us on WhatsApp with a photo within 24 hours of delivery for an immediate replacement or refund.'}
                {policyModal === 'privacy' &&
                  'Customer phone numbers and delivery addresses are stored strictly for order fulfillment and verification. Public order tracking never exposes personal addresses or full names.'}
                {policyModal === 'terms' &&
                  'All prices are listed in Bangladeshi Taka (BDT). Mobile financial service payments (bKash/Nagad) remain pending verification until matched by our team.'}
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
    </StorefrontContext.Provider>
  );
}
