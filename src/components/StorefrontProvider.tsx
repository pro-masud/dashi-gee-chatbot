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
  ShieldCheck,
  ShoppingBag,
  Sparkles,
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
import { Lang, formatBdt, toBengaliDigits } from '../data/deshiGeeData';
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
  const isHome = pathname === '/';
  const isAdminRoute = pathname.startsWith('/admin');

  const resolvedInitialSettings = initialSettings
    ? { ...DEFAULT_STORE_SETTINGS, ...initialSettings }
    : DEFAULT_STORE_SETTINGS;

  const [lang, setLang] = useState<Lang>('en');
  const [hydratedStorage, setHydratedStorage] = useState(false);

  const [settings, setSettings] = useState<StoreSettingsDoc>(resolvedInitialSettings);
  const [chatbotConfig, setChatbotConfig] = useState<ChatbotConfigDoc>(
    DEFAULT_CHATBOT_CONFIG
  );
  const [activeBatch, setActiveBatch] = useState<BatchRecord | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);

  const [headerSolid, setHeaderSolid] = useState<boolean>(false);
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

  // Boot Firestore connection & refresh live settings, batch provenance, and approved reviews
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
            color: { dark: '#1E1710', light: '#FAF7F2' },
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

  // Escape-key dismissal and focus management for Policy Modal
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

  // Escape-key dismissal for mobile nav drawer
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileMenuOpen]);

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
      }}
    >
      {isAdminRoute ? (
        /* ISOLATED ADMIN SHELL — zero storefront announcement bar, customer header, or dark footer */
        <div id="top" className="min-h-screen bg-[#FAF7F2] text-[#1E1710]">
          {children}
        </div>
      ) : (
        <div id="top" className="min-h-screen bg-[#FAF7F2] text-[#1E1710]">
          {/* PRESTIGE ANNOUNCEMENT TICKER */}
          <div className="no-print relative z-40 border-b border-[#B47B2B]/20 bg-[#1A120B] px-4 py-1.5 text-xs font-medium tracking-wide text-[#FAF7F2]">
            <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4">
              <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#B47B2B]/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#F5D692]">
                  <Sparkles className="h-3 w-3 text-[#D4AF37]" />
                  {bn ? 'সরাসরি পাবনা থেকে' : 'Fresh Harvest'}
                </span>
                <span className="hidden text-[#E8DFC5] sm:inline">
                  {bn
                    ? 'পাবনার চারণভূমির কাঁচা দুধে পাতা দইয়ের বিলোনা ঘি · দেশজুড়ে ক্যাশ অন ডেলিভারি'
                    : 'Single-Origin Pabna Grass-Fed Bilona Cow Ghee · Cash on Delivery Nationwide'}
                </span>
                <span className="truncate text-[#E8DFC5] sm:hidden">
                  {bn ? 'পাবনার খাঁটি বিলোনা গাওয়া ঘি' : 'Pabna Grass-Fed Bilona Cow Ghee'}
                </span>
              </div>

              <div className="hidden shrink-0 items-center gap-4 text-[11px] text-[#C5B8A5] lg:flex">
                {freeThresholdConfirmed && (
                  <>
                    <span className="tabular-nums">
                      {bn
                        ? `ফ্রি ডেলিভারি ${formatBdt(settings.freeDeliveryThreshold)}+ অর্ডারে`
                        : `Free Delivery on Orders ${formatBdt(settings.freeDeliveryThreshold)}+`}
                    </span>
                    <span className="text-[#B47B2B]">·</span>
                  </>
                )}
                <Link
                  href="/track"
                  className="text-[#E8DFC5] underline decoration-[#B47B2B]/40 underline-offset-2 transition-colors hover:text-[#FAF7F2]"
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
                ? 'border-b border-[rgba(30,23,16,0.10)] bg-[#FAF7F2]/95 py-2 shadow-[0_4px_24px_rgba(30,23,16,0.04)] backdrop-blur-md sm:py-3'
                : 'bg-[#FAF7F2]/80 py-2.5 backdrop-blur-xs sm:bg-transparent sm:py-4'
            }`}
          >
            <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-2 px-4 sm:gap-5 sm:px-8">
              <Link
                href="/"
                onClick={() => setMobileMenuOpen(false)}
                className="group flex shrink-0 flex-col"
              >
                <span className="font-display flex items-center gap-1.5 text-xl font-bold tracking-tight text-[#1E1710] transition-colors group-hover:text-[#8A5A17] sm:text-2xl">
                  <span>{bn ? 'দেশী ঘি' : 'Deshi Gee'}</span>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#B47B2B]" />
                </span>
                <span className="-mt-0.5 hidden font-mono text-[9px] uppercase tracking-widest text-[#8A5A17] sm:block">
                  {bn ? 'পাবনা · খাঁটি বিলোনা' : 'Pabna · Single Origin'}
                </span>
              </Link>

              {/* Primary Single-Line Navigation (Non-wrapping on tablet & desktop) */}
              <nav
                aria-label="Primary Navigation"
                className="hidden items-center gap-4 whitespace-nowrap text-xs font-medium text-[#635647] md:flex lg:gap-8 lg:text-sm"
              >
                <Link
                  href="/#story"
                  onClick={(e) => {
                    if (pathname === '/') {
                      e.preventDefault();
                      navigateToSection('story');
                    }
                  }}
                  className="relative py-2 transition-colors after:absolute after:right-0 after:bottom-1 after:left-0 after:h-[1.5px] after:origin-left after:scale-x-0 after:bg-[#B47B2B] after:transition-transform hover:text-[#1E1710] hover:after:scale-x-100"
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
                  className="relative py-2 transition-colors after:absolute after:right-0 after:bottom-1 after:left-0 after:h-[1.5px] after:origin-left after:scale-x-0 after:bg-[#B47B2B] after:transition-transform hover:text-[#1E1710] hover:after:scale-x-100"
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
                  className="relative py-2 transition-colors after:absolute after:right-0 after:bottom-1 after:left-0 after:h-[1.5px] after:origin-left after:scale-x-0 after:bg-[#B47B2B] after:transition-transform hover:text-[#1E1710] hover:after:scale-x-100"
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
                  className="relative py-2 font-semibold text-[#8A5A17] transition-colors after:absolute after:right-0 after:bottom-1 after:left-0 after:h-[1.5px] after:origin-left after:scale-x-0 after:bg-[#8A5A17] after:transition-transform hover:text-[#1E1710] hover:after:scale-x-100"
                >
                  {bn ? 'অর্ডার করুন' : 'Order Jar'}
                </Link>
              </nav>

              {/* Right Controls: Language Toggle + Shopping Bag + Mobile Menu (>= 44px targets) */}
              <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
                <button
                  type="button"
                  onClick={() => setLang((l) => (l === 'en' ? 'bn' : 'en'))}
                  aria-label="Toggle language between English and Bangla"
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-[rgba(30,23,16,0.16)] bg-[#FAF7F2] px-3.5 text-xs font-semibold text-[#1E1710] shadow-xs transition-colors hover:border-[#B47B2B] hover:bg-[#F2ECE1]"
                >
                  <span className="text-[11px] uppercase tracking-wider text-[#8A5A17]">
                    {lang === 'en' ? 'বাংলা' : 'EN'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setDrawerOpen(true);
                  }}
                  className="group inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl bg-[#1A120B] px-3.5 text-xs font-medium text-[#FAF7F2] transition-all hover:bg-[#332415] hover:shadow-[0_8px_20px_rgba(30,23,16,0.18)] sm:px-4"
                >
                  <ShoppingBag className="h-4 w-4 text-[#E5B25D] transition-transform group-hover:scale-110" />
                  <span className="font-medium">{bn ? 'ব্যাগ' : 'Bag'}</span>
                  <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-[#B47B2B] px-1.5 font-mono text-[11px] font-bold text-[#FFFDF9] tabular-nums shadow-xs">
                    {bn ? toBengaliDigits(totalBagCount) : totalBagCount}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setMobileMenuOpen((v) => !v)}
                  aria-expanded={mobileMenuOpen}
                  aria-label="Toggle mobile menu"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(30,23,16,0.16)] bg-[#FAF7F2] text-[#1E1710] transition-colors hover:bg-[#F2ECE1] md:hidden"
                >
                  {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
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
                    className="flex min-h-[44px] items-center rounded-lg px-2.5 active:bg-[#F2ECE1]"
                  >
                    {bn ? 'গল্প ও খামার' : 'Origin & Story'}
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
                    className="flex min-h-[44px] items-center rounded-lg px-2.5 active:bg-[#F2ECE1]"
                  >
                    {bn ? 'বিলোনা প্রস্তুতপ্রণালী' : 'Bilona Craft'}
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
                    className="flex min-h-[44px] items-center rounded-lg px-2.5 active:bg-[#F2ECE1]"
                  >
                    {bn ? 'ব্যাচ যাচাই' : 'Lab Proof'}
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
                    className="flex min-h-[44px] items-center rounded-lg px-2.5 font-semibold text-[#8A5A17] active:bg-[#F2ECE1]"
                  >
                    {bn ? 'অর্ডার করুন' : 'Order Jar'}
                  </Link>
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[rgba(30,23,16,0.10)] pt-3 text-xs text-[#635647]">
                    <Link
                      href="/track"
                      onClick={() => setMobileMenuOpen(false)}
                      className="inline-flex min-h-[44px] items-center rounded-lg px-2.5 font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
                    >
                      {bn ? 'অর্ডার ট্র্যাকিং' : 'Track Order'}
                    </Link>
                    <Link
                      href="/batch"
                      onClick={() => setMobileMenuOpen(false)}
                      className="inline-flex min-h-[44px] items-center rounded-lg px-2.5 font-medium text-[#1E1710] hover:bg-[#F2ECE1]"
                    >
                      {bn ? 'ব্যাচ যাচাই' : 'Verify Batch'}
                    </Link>
                    {whatsappConfigured ? (
                      <a
                        href={whatsappChatHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setMobileMenuOpen(false)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 font-medium text-[#8A5A17] hover:bg-[#F2ECE1]"
                      >
                        <MessageCircle className="h-4 w-4" />
                        <span>{bn ? 'হোয়াটসঅ্যাপ' : 'WhatsApp'}</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileMenuOpen(false);
                          openCallbackRequest();
                        }}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-left font-medium text-[#8A5A17] hover:bg-[#F2ECE1]"
                      >
                        <MessageCircle className="h-4 w-4" />
                        <span>{bn ? 'কলব্যাক অনুরোধ' : 'Request Callback'}</span>
                      </button>
                    )}
                    <Link
                      href="/admin"
                      onClick={() => setMobileMenuOpen(false)}
                      className="inline-flex min-h-[44px] items-center rounded-lg px-2.5 hover:bg-[#F2ECE1]"
                    >
                      Admin
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </header>

          {/* ACTIVE NEXT.JS ROUTE CONTENT */}
          {children}

          {/* SECTION 12: LUXURY ARTISANAL FOOTER */}
          <footer className="border-t border-[rgba(30,23,16,0.12)] bg-[#1A120B] py-14 text-sm text-[#E8DFC5] sm:py-16">
            <div className="mx-auto max-w-[1320px] px-4 sm:px-8">
              <div className="grid grid-cols-1 gap-10 border-b border-[#FAF7F2]/10 pb-12 sm:grid-cols-2 lg:grid-cols-12 lg:gap-12">
                {/* Brand Column */}
                <div className="space-y-4 sm:col-span-2 lg:col-span-5">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-2xl font-bold tracking-tight text-[#FAF7F2]">
                      {bn ? 'দেশী ঘি' : 'Deshi Gee'}
                    </span>
                    <span className="h-1.5 w-1.5 rounded-full bg-[#D4AF37]" />
                    <span className="font-mono text-xs uppercase tracking-widest text-[#B47B2B]">
                      {bn ? 'পাবনা' : 'Pabna'}
                    </span>
                  </div>
                  <p className="max-w-md text-xs leading-relaxed text-[#C5B8A5] sm:text-sm">
                    {bn
                      ? 'পাবনার সবুজ চারণভূমির দেশী গরুর খাঁটি দুধ দিয়ে মাটির হাঁড়িতে পাতা দই ও কাঠের বিলোনার প্রাচীন মন্থন পদ্ধতিতে প্রস্তুত একক উৎপত্তির খাঁটি গাওয়া ঘি।'
                      : 'Single-origin Pabna grass-fed bilona cow ghee prepared from whole cultured curd, hand-churned in wooden pots, and sealed warm in heavy apothecary glass.'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2.5 pt-2 text-xs text-[#E5B25D]">
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#D4AF37]/30 bg-[#261B12] px-3 py-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-[#D4AF37]" />
                      {bn ? 'কাঁচের এয়ারটাইট বয়াম' : 'Sealed Apothecary Glass'}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#D4AF37]/30 bg-[#261B12] px-3 py-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-[#D4AF37]" />
                      {bn ? 'কাঠের বিলোনা মন্থন' : 'Bilona Churned'}
                    </span>
                  </div>
                </div>

                {/* Quick Links */}
                <div className="space-y-3 lg:col-span-2">
                  <p className="font-mono text-xs font-semibold uppercase tracking-widest text-[#FAF7F2]">
                    {bn ? 'ন্যাভিগেশন' : 'Navigation'}
                  </p>
                  <ul className="space-y-1 text-xs">
                    <li>
                      <Link
                        href="/#story"
                        className="inline-flex min-h-[36px] items-center text-[#C5B8A5] transition-colors hover:text-[#FAF7F2]"
                      >
                        {bn ? 'উৎস ও খামার' : 'Origin & Story'}
                      </Link>
                    </li>
                    <li>
                      <Link
                        href="/#craft"
                        className="inline-flex min-h-[36px] items-center text-[#C5B8A5] transition-colors hover:text-[#FAF7F2]"
                      >
                        {bn ? 'বিলোনা প্রণালী' : 'Bilona Craft'}
                      </Link>
                    </li>
                    <li>
                      <Link
                        href="/#proof"
                        className="inline-flex min-h-[36px] items-center text-[#C5B8A5] transition-colors hover:text-[#FAF7F2]"
                      >
                        {bn ? 'ল্যাব ও ব্যাচ যাচাই' : 'Verify Batch'}
                      </Link>
                    </li>
                    <li>
                      <Link
                        href="/#order"
                        className="inline-flex min-h-[36px] items-center text-[#C5B8A5] transition-colors hover:text-[#FAF7F2]"
                      >
                        {bn ? 'অর্ডার করুন' : 'Order Jar'}
                      </Link>
                    </li>
                    <li>
                      <Link
                        href="/track"
                        className="inline-flex min-h-[36px] items-center text-[#C5B8A5] transition-colors hover:text-[#FAF7F2]"
                      >
                        {bn ? 'অর্ডার ট্র্যাকিং' : 'Track Order'}
                      </Link>
                    </li>
                    <li>
                      <Link
                        href="/admin"
                        className="inline-flex min-h-[36px] items-center text-[#8A7867] transition-colors hover:text-[#FAF7F2]"
                      >
                        Admin
                      </Link>
                    </li>
                  </ul>
                </div>

                {/* Policies (D10: gated behind feature flag as DRAFT until owner reviews) */}
                <div className="space-y-3 lg:col-span-2">
                  <p className="font-mono text-xs font-semibold uppercase tracking-widest text-[#FAF7F2]">
                    {bn ? 'নীতিমালা' : 'Policies'}
                  </p>
                  {ENABLE_POLICY_DRAFTS ? (
                    <ul className="space-y-1 text-xs">
                      <li>
                        <button
                          type="button"
                          onClick={(e) => openPolicy('delivery', e.currentTarget)}
                          className="inline-flex min-h-[36px] items-center text-left text-[#C5B8A5] transition-colors hover:text-[#FAF7F2]"
                        >
                          {bn ? 'ডেলিভারি নীতিমালা (খসড়া)' : 'Delivery Policy (Draft)'}
                        </button>
                      </li>
                      <li>
                        <button
                          type="button"
                          onClick={(e) => openPolicy('return', e.currentTarget)}
                          className="inline-flex min-h-[36px] items-center text-left text-[#C5B8A5] transition-colors hover:text-[#FAF7F2]"
                        >
                          {bn ? 'রিটার্ন ও রিফান্ড (খসড়া)' : 'Return & Refund (Draft)'}
                        </button>
                      </li>
                      <li>
                        <button
                          type="button"
                          onClick={(e) => openPolicy('privacy', e.currentTarget)}
                          className="inline-flex min-h-[36px] items-center text-left text-[#C5B8A5] transition-colors hover:text-[#FAF7F2]"
                        >
                          {bn ? 'প্রাইভেসি পলিসি (খসড়া)' : 'Privacy Policy (Draft)'}
                        </button>
                      </li>
                      <li>
                        <button
                          type="button"
                          onClick={(e) => openPolicy('terms', e.currentTarget)}
                          className="inline-flex min-h-[36px] items-center text-left text-[#C5B8A5] transition-colors hover:text-[#FAF7F2]"
                        >
                          {bn ? 'শর্তাবলী (খসড়া)' : 'Terms of Service (Draft)'}
                        </button>
                      </li>
                    </ul>
                  ) : (
                    <p className="text-xs leading-relaxed text-[#8A7867]">
                      {bn
                        ? 'স্টোরের চূড়ান্ত নীতিমালা মালিকের অনুমোদনের পর এখানে প্রকাশিত হবে।'
                        : 'Final store policies will be published here once confirmed by the store owner.'}
                    </p>
                  )}
                </div>

                {/* Direct Support & Address (D17 / D18: hide unset contacts; offer callback ticket) */}
                <div className="space-y-3 sm:col-span-2 lg:col-span-3">
                  <p className="font-mono text-xs font-semibold uppercase tracking-widest text-[#FAF7F2]">
                    {bn ? 'যোগাযোগ ও সাপোর্ট' : 'Customer Care'}
                  </p>
                  {hasAnyDirectContact ? (
                    <div className="space-y-2 text-xs text-[#C5B8A5]">
                      {phoneConfigured && (
                        <p>
                          <span className="text-[#8A7867]">{bn ? 'ফোন:' : 'Phone:'}</span>{' '}
                          <a
                            href={`tel:${settings.supportPhone.replace(/[^0-9+]/g, '')}`}
                            className="font-mono text-[#FAF7F2] tabular-nums hover:underline"
                          >
                            {settings.supportPhone}
                          </a>
                        </p>
                      )}
                      {whatsappConfigured && (
                        <p>
                          <span className="text-[#8A7867]">WhatsApp:</span>{' '}
                          <a
                            href={whatsappChatHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[#FAF7F2] tabular-nums hover:underline"
                          >
                            {settings.whatsappNumber}
                          </a>
                        </p>
                      )}
                      {emailConfigured && (
                        <p>
                          <span className="text-[#8A7867]">Email:</span>{' '}
                          <a
                            href={`mailto:${settings.supportEmail}`}
                            className="text-[#FAF7F2] hover:underline"
                          >
                            {settings.supportEmail}
                          </a>
                        </p>
                      )}
                      {addressConfigured && (
                        <p className="pt-1 leading-relaxed text-[#8A7867]">
                          {settings.businessAddress}
                        </p>
                      )}
                      {mapsConfigured && (
                        <a
                          href={settings.googleMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[36px] items-center text-xs text-[#E5B25D] hover:underline"
                        >
                          {bn ? 'গুগল ম্যাপে দেখুন ↗' : 'View on Google Maps ↗'}
                        </a>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2.5 text-xs text-[#C5B8A5]">
                      <p className="leading-relaxed text-[#8A7867]">
                        {bn
                          ? 'যেকোনো প্রশ্ন বা অর্ডার সহায়তার জন্য কলব্যাক অনুরোধ পাঠান—আমাদের টিম যোগাযোগ করবে।'
                          : 'Need help with an order or inquiry? Submit a callback request and our team will reach out.'}
                      </p>
                      <button
                        type="button"
                        onClick={openCallbackRequest}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#D4AF37]/40 bg-[#261B12] px-4 py-2 text-xs font-semibold text-[#F5D692] transition-colors hover:bg-[#332415]"
                      >
                        {bn ? 'কলব্যাক অনুরোধ করুন' : 'Request a Callback'}
                      </button>
                    </div>
                  )}

                  <div className="flex gap-4 pt-2">
                    {hasValidRealUrl(settings.facebookUrl) && (
                      <a
                        href={settings.facebookUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[36px] items-center text-xs text-[#E5B25D] hover:underline"
                      >
                        Facebook ↗
                      </a>
                    )}
                    {hasValidRealUrl(settings.instagramUrl) && (
                      <a
                        href={settings.instagramUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[36px] items-center text-xs text-[#E5B25D] hover:underline"
                      >
                        Instagram ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Copyright & Provenance Note */}
              <div className="flex flex-col items-center justify-between gap-4 pt-8 text-xs text-[#8A7867] sm:flex-row">
                <p suppressHydrationWarning>
                  © {new Date().getUTCFullYear()} Deshi Gee.{' '}
                  {bn ? 'সর্বস্বত্ব সংরক্ষিত।' : 'All rights reserved.'}
                </p>
                <p className="font-mono text-[11px] text-[#B47B2B]">
                  {bn
                    ? 'পাবনার চারণভূমি থেকে বিশ্বস্ত খাঁটি ঘি'
                    : 'Artisanal Single-Origin Ghee · Harvested in Pabna'}
                </p>
              </div>
            </div>
          </footer>

          {/* FLOATING WHATSAPP CUSTOMER SUPPORT — ONLY WHEN REAL WHATSAPP NUMBER IS CONFIGURED (D18) */}
          {whatsappConfigured && (
            <a
              href={whatsappChatHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={bn ? 'হোয়াটসঅ্যাপ সাপোর্ট' : 'WhatsApp Customer Support'}
              className="no-print fixed right-6 bottom-[92px] z-20 hidden h-11 items-center gap-2 rounded-xl border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2]/95 px-4 text-xs font-medium text-[#1E1710] shadow-md backdrop-blur-sm transition-transform hover:scale-[1.03] md:inline-flex"
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

          {/* REQUEST A CALLBACK TICKET MODAL (D17) */}
          {callbackModalOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="callback-modal-title"
              className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1710]/50 p-4 backdrop-blur-xs"
              onClick={() => setCallbackModalOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-2xl border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] p-5 shadow-2xl sm:p-6"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3
                    id="callback-modal-title"
                    className="font-display text-lg font-semibold text-[#1E1710]"
                  >
                    {bn ? 'কলব্যাক অনুরোধ করুন' : 'Request a Callback'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setCallbackModalOpen(false)}
                    aria-label={bn ? 'বন্ধ করুন' : 'Close dialog'}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(30,23,16,0.12)] hover:bg-[#F2ECE1]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <form onSubmit={handleSubmitCallback} className="mt-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[#635647]">
                      {bn ? 'আপনার নাম *' : 'Your Name *'}
                    </label>
                    <input
                      type="text"
                      required
                      value={cbName}
                      onChange={(e) => setCbName(e.target.value)}
                      className="mt-1 min-h-[44px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-2 text-base text-[#1E1710] sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#635647]">
                      {bn ? 'মোবাইল নম্বর (01XXXXXXXXX) *' : 'Mobile Number (01XXXXXXXXX) *'}
                    </label>
                    <input
                      type="tel"
                      inputMode="tel"
                      required
                      value={cbPhone}
                      onChange={(e) => setCbPhone(e.target.value)}
                      placeholder="017XXXXXXXX"
                      className="mt-1 min-h-[44px] w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-2 font-mono text-base text-[#1E1710] sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#635647]">
                      {bn ? 'সংক্ষিপ্ত বার্তা' : 'Short Message'}
                    </label>
                    <textarea
                      rows={3}
                      value={cbNote}
                      onChange={(e) => setCbNote(e.target.value)}
                      placeholder={bn ? 'আপনার প্রশ্ন বা অর্ডারের বিষয় লিখুন' : 'How can we help you?'}
                      className="mt-1 w-full rounded-lg border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-3 py-2 text-base text-[#1E1710] sm:text-sm"
                    />
                  </div>
                  {cbResult && (
                    <p
                      className={`text-xs font-medium ${
                        cbResult.ok ? 'text-[#2D6A4F]' : 'text-red-700'
                      }`}
                    >
                      {cbResult.msg}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={cbBusy}
                    className="min-h-[46px] w-full rounded-xl bg-[#1A120B] px-5 py-2.5 text-sm font-semibold text-[#FAF7F2] hover:bg-[#332415] disabled:opacity-50"
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
              className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E1710]/50 p-4 backdrop-blur-xs sm:p-5"
              onClick={closePolicy}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="max-h-[85dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] p-5 shadow-2xl sm:p-6"
              >
                <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                  {bn
                    ? 'খসড়া — মালিকের অনুমোদন প্রয়োজন (DRAFT – owner review required)'
                    : 'DRAFT – owner review required before publishing as final store policy.'}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <h3
                    id="policy-modal-title"
                    className="font-display text-lg font-semibold text-[#1E1710] sm:text-xl"
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
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[rgba(30,23,16,0.12)] hover:bg-[#F2ECE1]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-[#635647]">
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
