'use client';

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import {
  ArrowLeftRight,
  ArrowRight,
  Award,
  Box,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileCheck2,
  Leaf,
  Lightbulb,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  ThumbsUp,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import { initHeroCanvas } from '../webgl/heroCanvas';
import { initSpecsCanvas } from '../webgl/specsCanvas';
import {
  ReviewRecord,
  WeightKey,
  getConfirmedPriceForWeight,
  isStoreFieldConfirmed,
  isStorefrontOrderingReady,
  incrementReviewHelpful,
  submitCustomerReview,
  subscribeNewsletterEmail,
} from '../lib/firebase';
import {
  CRAFT_STAGES,
  FAQ_ITEMS,
  IMAGES,
  PRODUCT_GALLERY,
  WAYS_TO_ENJOY,
  WEIGHT_VARIANTS,
  formatBdt,
  toBengaliDigits,
} from '../data/deshiGeeData';
import { trackStoreEvent } from '../lib/analytics';
import { ResilientImage } from './ResilientImage';
import { visibleFaqs, visibleHighlights } from '../lib/cms/cms';
import { useStorefront } from './StorefrontProvider';

gsap.registerPlugin(ScrollTrigger);

export function HomeStorefrontView() {
  const {
    lang,
    settings,
    activeBatch,
    qrCodeUrl,
    reviews,
    setReviews,
    setCart,
    drawerOpen,
    setDrawerOpen,
    chatbotConfig,
    openChatAssistant,
    openCallbackRequest,
    packageMeta,
    cms,
  } = useStorefront();

  const [selectedWeight, setSelectedWeight] = useState<WeightKey>('500g');
  const weightTouchedRef = useRef(false);
  const [purchaseQty, setPurchaseQty] = useState<number>(1);
  const [galleryIdx, setGalleryIdx] = useState<number>(0);
  const [showBlueprint, setShowBlueprint] = useState<boolean>(false);

  const [activeStage, setActiveStage] = useState<number>(0);
  const [captionTransitioning, setCaptionTransitioning] = useState<boolean>(false);
  const [splitPct, setSplitPct] = useState<number>(50);
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const [justAdded, setJustAdded] = useState<boolean>(false);

  // Review Submission State
  const [revName, setRevName] = useState('');
  const [revDistrict, setRevDistrict] = useState('Dhaka');
  const [revRating, setRevRating] = useState(5);
  const [revOrderNum, setRevOrderNum] = useState('');
  const [revComment, setRevComment] = useState('');
  const [revPhotoData, setRevPhotoData] = useState('');
  const [revSubmitting, setRevSubmitting] = useState(false);
  const [revStatusMsg, setRevStatusMsg] = useState('');
  const [helpfulVotedIds, setHelpfulVotedIds] = useState<Set<string>>(new Set());
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string; name: string } | null>(null);
  const reviewTrackRef = useRef<HTMLDivElement | null>(null);
  const [canPrevReview, setCanPrevReview] = useState(false);
  const [canNextReview, setCanNextReview] = useState(false);

  useEffect(() => {
    const track = reviewTrackRef.current;
    if (!track) return;
    const update = () => {
      setCanPrevReview(track.scrollLeft > 4);
      setCanNextReview(track.scrollLeft + track.clientWidth < track.scrollWidth - 4);
    };
    update();
    track.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(track);
    return () => {
      track.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [reviews.length]);

  const scrollReviews = (dir: 1 | -1) => {
    const track = reviewTrackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.min(420, track.clientWidth * 0.9), behavior: 'smooth' });
  };

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightbox]);

  // Newsletter State
  const [newsEmail, setNewsEmail] = useState('');
  const [newsSubmitting, setNewsSubmitting] = useState(false);
  const [newsFeedback, setNewsFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
  } | null>(null);

  const heroCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const specsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const heroStageRef = useRef<HTMLDivElement | null>(null);
  const tiltWrapRef = useRef<HTMLDivElement | null>(null);
  const galleryPreviewRef = useRef<HTMLDivElement | null>(null);
  const showcaseRef = useRef<HTMLElement | null>(null);
  const frameRefs = useRef<(HTMLDivElement | null)[]>([]);
  const compWrapRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const stageIdxRef = useRef<number>(0);
  const stageTimerRef = useRef<number | null>(null);
  const scrollTriggerRef = useRef<ScrollTrigger | null>(null);

  const bn = lang === 'bn';

  // Wireframe Jar Seal Canvas
  useEffect(() => {
    if (!showBlueprint) return;
    const cleanup = initSpecsCanvas(specsCanvasRef.current);
    return () => cleanup();
  }, [showBlueprint]);

  // Desktop-only Hero WebGL, Lenis Smooth Scroll, 3D Tilt & Responsive GSAP Pinned Storytelling
  useEffect(() => {
    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    const isDesktopInteractive =
      !prefersReduced &&
      window.matchMedia('(min-width: 1024px) and (min-height: 560px) and (pointer: fine)').matches;

    const cleanupHeroGl = isDesktopInteractive
      ? initHeroCanvas(heroCanvasRef.current)
      : () => {};

    let lenis: InstanceType<typeof Lenis> | null = null;
    let lenisTicker: ((time: number) => void) | null = null;
    if (isDesktopInteractive) {
      lenis = new Lenis({
        duration: 1.0,
        easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
      });
      lenis.on('scroll', ScrollTrigger.update);
      lenisTicker = (time: number) => {
        lenis?.raf(time * 1000);
      };
      gsap.ticker.add(lenisTicker);
      gsap.ticker.lagSmoothing(0);
    }

    let targetRotX = 0;
    let targetRotY = 0;
    let curRotX = 0;
    let curRotY = 0;
    let velX = 0;
    let velY = 0;
    let tiltTicker: (() => void) | null = null;

    const heroStage = heroStageRef.current;
    const onHeroMove = (e: PointerEvent) => {
      if (!heroStage) return;
      const rect = heroStage.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      targetRotY = nx * 9;
      targetRotX = -ny * 7;
    };
    const onHeroLeave = () => {
      targetRotX = 0;
      targetRotY = 0;
    };

    if (heroStage && tiltWrapRef.current && isDesktopInteractive) {
      heroStage.addEventListener('pointermove', onHeroMove);
      heroStage.addEventListener('pointerleave', onHeroLeave);
      tiltTicker = () => {
        const ax = (targetRotX - curRotX) * 0.08;
        const ay = (targetRotY - curRotY) * 0.08;
        velX = (velX + ax) * 0.82;
        velY = (velY + ay) * 0.82;
        curRotX += velX;
        curRotY += velY;
        if (tiltWrapRef.current) {
          tiltWrapRef.current.style.transform = `rotateX(${curRotX.toFixed(2)}deg) rotateY(${curRotY.toFixed(2)}deg)`;
        }
      };
      gsap.ticker.add(tiltTicker);
    }

    const mm = gsap.matchMedia();
    mm.add(
      '(min-width: 1024px) and (min-height: 560px) and (pointer: fine)',
      () => {
        if (prefersReduced) return;

        const frames = frameRefs.current.filter(
          (el): el is HTMLDivElement => el !== null
        );
        if (showcaseRef.current && frames.length === CRAFT_STAGES.length) {
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: showcaseRef.current,
              start: 'top top',
              end: '+=240%',
              pin: true,
              scrub: 0.65,
              onUpdate: (self) => {
                const t = self.progress * 3.5;
                let nextIdx = 0;
                if (t >= 3.0) nextIdx = 3;
                else if (t >= 1.95) nextIdx = 2;
                else if (t >= 0.9) nextIdx = 1;

                if (nextIdx !== stageIdxRef.current) {
                  stageIdxRef.current = nextIdx;
                  setCaptionTransitioning(true);
                  if (stageTimerRef.current !== null) {
                    window.clearTimeout(stageTimerRef.current);
                  }
                  stageTimerRef.current = window.setTimeout(() => {
                    stageTimerRef.current = null;
                    setActiveStage(nextIdx);
                    setCaptionTransitioning(false);
                  }, 90);
                }
              },
            },
          });

          scrollTriggerRef.current = tl.scrollTrigger ?? null;
          const wipeStarts = [0.25, 1.3, 2.35];
          frames.forEach((frame, i) => {
            if (i === 0) {
              gsap.set(frame, { clipPath: 'inset(0 0 0 0)', zIndex: 1 });
              return;
            }
            gsap.set(frame, { clipPath: 'inset(0 0 0 100%)', zIndex: i + 1 });
            tl.fromTo(
              frame,
              { clipPath: 'inset(0 0 0 100%)' },
              { clipPath: 'inset(0 0 0 0%)', ease: 'none', duration: 0.8 },
              wipeStarts[i - 1]
            );
          });
          tl.to({}, { duration: 0.35 }, 3.15);
        }

        return () => {
          scrollTriggerRef.current = null;
        };
      }
    );

    return () => {
      cleanupHeroGl();
      if (lenisTicker) gsap.ticker.remove(lenisTicker);
      if (tiltTicker) gsap.ticker.remove(tiltTicker);
      if (heroStage) {
        heroStage.removeEventListener('pointermove', onHeroMove);
        heroStage.removeEventListener('pointerleave', onHeroLeave);
      }
      if (stageTimerRef.current !== null) {
        window.clearTimeout(stageTimerRef.current);
      }
      lenis?.destroy();
      mm.revert();
    };
  }, []);

  // Owner-configured default size: applied once, and never over a choice the visitor already made.
  useEffect(() => {
    if (!packageMeta || weightTouchedRef.current) return;
    const def = (['250g', '500g', '1kg'] as WeightKey[]).find((k) => packageMeta[k]?.isDefault && packageMeta[k]?.enabled);
    if (def) setSelectedWeight(def);
  }, [packageMeta]);

  const orderingReady = isStorefrontOrderingReady(settings);

  const getPriceForWeight = useCallback(
    (w: WeightKey): number => getConfirmedPriceForWeight(settings, w) ?? 0,
    [settings]
  );

  const getStockForWeight = useCallback(
    (w: WeightKey): number => {
      if (!orderingReady) return 0;
      if (w === '250g') return Math.max(0, Math.round(settings.stock250g || 0));
      if (w === '500g') return Math.max(0, Math.round(settings.stock500g || 0));
      return Math.max(0, Math.round(settings.stock1kg || 0));
    },
    [settings, orderingReady]
  );

  const selectedVariantMeta = useMemo(
    () => WEIGHT_VARIANTS.find((v) => v.key === selectedWeight) ?? WEIGHT_VARIANTS[1],
    [selectedWeight]
  );

  const activePrice = getPriceForWeight(selectedWeight);
  const activeStock = getStockForWeight(selectedWeight);
  const isVariantUnavailable = !orderingReady || activePrice <= 0;
  const isOutOfStock = isVariantUnavailable || activeStock <= 0;
  const confirmedPricesList = [
    getConfirmedPriceForWeight(settings, '250g'),
    getConfirmedPriceForWeight(settings, '500g'),
    getConfirmedPriceForWeight(settings, '1kg'),
  ].filter((p): p is number => p !== null && p > 0);
  const minConfirmedPrice =
    confirmedPricesList.length > 0 ? Math.min(...confirmedPricesList) : null;
  const maxConfirmedPrice =
    confirmedPricesList.length > 0 ? Math.max(...confirmedPricesList) : null;
  const hasConfirmedEtas =
    isStoreFieldConfirmed(settings, 'estimatedDhakaDays') ||
    isStoreFieldConfirmed(settings, 'estimatedOutsideDays');

  useEffect(() => {
    const stock = getStockForWeight(selectedWeight);
    if (stock <= 0) {
      setPurchaseQty(1);
    } else if (purchaseQty > stock) {
      setPurchaseQty(stock);
    }
  }, [selectedWeight, getStockForWeight]);

  const handleAddToCart = (openImmediately: boolean) => {
    if (isOutOfStock) return;
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.weight === selectedWeight);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          qty: Math.min(activeStock, next[idx].qty + purchaseQty),
        };
        return next;
      }
      return [
        ...prev,
        { weight: selectedWeight, qty: Math.min(activeStock, purchaseQty) },
      ];
    });

    trackStoreEvent('AddToCart', {
      currency: 'BDT',
      value: activePrice * purchaseQty,
      items: [
        {
          item_name: settings.productNameEn,
          item_variant: selectedWeight,
          quantity: purchaseQty,
          price: activePrice,
        },
      ],
    });

    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1400);
    if (openImmediately) {
      setDrawerOpen(true);
    }
  };

  // Comparison Slider Pointer Handler
  const updateSplitFromClientX = useCallback((clientX: number) => {
    const wrap = compWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return;
    setSplitPct(Math.max(4, Math.min(96, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      updateSplitFromClientX(e.clientX);
    };
    const onUp = () => {
      isDraggingRef.current = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [updateSplitFromClientX]);

  const handleJumpStage = (idx: number) => {
    setActiveStage(idx);
    stageIdxRef.current = idx;
    const st = scrollTriggerRef.current;
    if (st) {
      const targetProgress = idx / 3.2;
      const scrollY = st.start + (st.end - st.start) * Math.min(0.95, targetProgress);
      window.scrollTo({ top: scrollY, behavior: 'smooth' });
    }
  };

  const handleReviewPhotoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 480;
        const scale = Math.min(1, maxW / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setRevPhotoData(canvas.toDataURL('image/jpeg', 0.65));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitReview = async (e: FormEvent) => {
    e.preventDefault();
    if (revName.trim().length < 2 || revComment.trim().length < 6) {
      setRevStatusMsg(
        bn
          ? 'আপনার নাম এবং অন্তত ৬ অক্ষরের অভিজ্ঞতা লিখুন।'
          : 'Please enter your name and at least 6 characters of feedback.'
      );
      return;
    }
    setRevSubmitting(true);
    setRevStatusMsg('');
    try {
      await submitCustomerReview({
        customerName: revName,
        district: revDistrict,
        rating: revRating,
        comment: revComment,
        orderNumber: revOrderNum,
        photoData: revPhotoData,
      });
      setRevName('');
      setRevOrderNum('');
      setRevComment('');
      setRevPhotoData('');
      setRevStatusMsg(
        bn
          ? 'ধন্যবাদ! আপনার রিভিউটি অ্যাডমিন অনুমোদনের জন্য জমা হয়েছে।'
          : 'Thank you! Your review has been submitted and is awaiting admin approval.'
      );
    } catch {
      setRevStatusMsg(
        bn
          ? 'রিভিউ জমা দিতে সমস্যা হয়েছে। আবার চেষ্টা করুন।'
          : 'Unable to submit review right now. Please try again.'
      );
    } finally {
      setRevSubmitting(false);
    }
  };

  const handleHelpfulVote = async (rev: ReviewRecord) => {
    if (helpfulVotedIds.has(rev.id)) return;
    setHelpfulVotedIds((prev) => new Set(prev).add(rev.id));
    setReviews((prev) =>
      prev.map((r) =>
        r.id === rev.id ? { ...r, helpfulCount: r.helpfulCount + 1 } : r
      )
    );
    try {
      await incrementReviewHelpful(rev.id, rev.helpfulCount);
    } catch {
      // keep optimistic count safe
    }
  };

  const handleNewsletterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const email = newsEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setNewsFeedback({
        type: 'err',
        msg: bn ? 'সঠিক ইমেইল ঠিকানা দিন।' : 'Please enter a valid email address.',
      });
      return;
    }
    setNewsSubmitting(true);
    setNewsFeedback(null);
    try {
      await subscribeNewsletterEmail(email, lang);
      setNewsEmail('');
      setNewsFeedback({
        type: 'ok',
        msg: bn
          ? 'সাবস্ক্রাইব সম্পন্ন! নতুন ব্যাচ প্রস্তুত হলে আপনাকে জানানো হবে।'
          : 'Subscribed! You will receive fresh Pabna batch harvest updates.',
      });
    } catch {
      setNewsFeedback({
        type: 'err',
        msg: bn ? 'সাবস্ক্রিপশন ব্যর্থ হয়েছে।' : 'Subscription failed. Please try again.',
      });
    } finally {
      setNewsSubmitting(false);
    }
  };

  const currentStage = CRAFT_STAGES[activeStage] ?? CRAFT_STAGES[0];
  const activeGallery = PRODUCT_GALLERY[galleryIdx] ?? PRODUCT_GALLERY[0];
  const avgRating =
    reviews.length > 0
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
      : null;

  const previewScale = Math.min(1.04, Math.max(0.86, selectedVariantMeta.scale * 0.94));

  return (
    <>
      <main className="pb-24 md:pb-0">
        {/* SECTION 01: LUXURY CINEMATIC HERO */}
        <section className="premium-grain relative isolate overflow-hidden bg-[var(--c-bg)]">
          <canvas
            ref={heroCanvasRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 hidden h-full w-full lg:block"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-48 top-1/4 -z-10 h-[680px] w-[680px] rounded-full bg-[radial-gradient(closest-side,rgba(229,178,93,0.20),transparent)] blur-2xl"
          />

          <div className="relative mx-auto grid max-w-[1320px] grid-cols-1 items-center gap-16 px-5 pb-24 pt-12 sm:px-8 lg:min-h-[calc(100dvh-96px)] lg:grid-cols-12 lg:gap-12 lg:pb-32 lg:pt-16">
            <div className="lg:col-span-6">
              <p className="eyebrow">
                {settings.originLocation} · {bn ? 'একক উৎসের বিলোনা ঘি' : 'Single-Origin Bilona'}
              </p>

              <h1 className="display-hero mt-7">
                {(bn ? cms?.hero.titleBn : cms?.hero.titleEn) ? (
                  <>
                    {bn ? cms?.hero.titleBn : cms?.hero.titleEn}
                    {(bn ? cms?.hero.accentBn : cms?.hero.accentEn) ? (
                      <>
                        {' '}
                        <span className="gold-gradient-text italic">{bn ? cms?.hero.accentBn : cms?.hero.accentEn}</span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                {bn ? (
                  <>
                    পাবনার চারণভূমির কাঁচা দুধে{' '}
                    <span className="gold-gradient-text italic">কাঠের বিলোনায়</span> মন্থিত ঘি
                  </>
                ) : (
                  <>
                    Pabna Cow Ghee,{' '}
                    <span className="gold-gradient-text italic">slow-churned</span> the old way.
                  </>
                )}
              </>
                )}
              </h1>

              <p className="mt-7 max-w-[46ch] text-base leading-[1.8] text-[var(--c-muted)] sm:text-lg">
                {(bn ? cms?.hero.subtitleBn : cms?.hero.subtitleEn) ? (bn ? cms?.hero.subtitleBn : cms?.hero.subtitleEn) : bn
                  ? 'সকালের সংগৃহীত দেশী গরুর সম্পূর্ণ দুধ থেকে পাতা দই, কাঠের বিলোনায় মন্থন আর মাটির মৃদু আঁচ—শেষে বয়ামে সিল করা খাঁটি দানাদার গাওয়া ঘি।'
                  : 'Whole-milk curd from Pabna pastures, hand-churned in a wooden bilona and sealed warm in an airtight jar. One product, made honestly.'}
              </p>

              <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
                <a href="#order" className="btn-gold w-full sm:w-auto">
                  <ShoppingBag className="h-4 w-4" />
                  <span>{(bn ? cms?.hero.ctaBn : cms?.hero.ctaEn) || (bn ? 'এখনই অর্ডার করুন' : 'Order the Jar')}</span>
                  <ArrowRight className="h-4 w-4" />
                </a>
                <a href="#craft" className="btn-ghost w-full sm:w-auto">
                  {bn ? 'তৈরির গল্প' : 'See the Craft'}
                </a>
              </div>

              {orderingReady && minConfirmedPrice !== null && (
                <p className="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-[var(--c-muted)]">
                  <span className="uppercase tracking-[0.2em] text-[11px]">
                    {bn ? 'শুরু' : 'From'}
                  </span>
                  <span className="font-display whitespace-nowrap text-2xl text-[var(--c-gold-text)] tabular-nums">
                    {formatBdt(minConfirmedPrice)}
                  </span>
                  <span className="hidden h-px w-8 bg-[rgb(var(--c-tint)/0.3)] sm:inline-block" />
                  <span>{bn ? 'সারাদেশে ক্যাশ অন ডেলিভারি' : 'Cash on delivery nationwide'}</span>
                </p>
              )}
            </div>

            <div
              ref={heroStageRef}
              className="hero-perspective relative flex justify-center lg:col-span-6 lg:justify-end"
            >
              <div ref={tiltWrapRef} className="jar-tilt-wrap relative w-full max-w-[500px]">
                {/* Offset gold hairline frame */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 translate-x-4 translate-y-4 rounded-[2rem] border border-[#D4AF37]/45 sm:translate-x-5 sm:translate-y-5"
                />
                <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[2rem] border border-[rgb(var(--c-tint)/0.14)] bg-[var(--c-surface)] shadow-[0_50px_90px_-30px_rgb(var(--c-shadow))]">
                  <ResilientImage
                    src={IMAGES.heroFront}
                    alt={
                      bn
                        ? 'পাবনার খাঁটি দানাদার দেশী গরুর ঘিয়ের জার'
                        : 'Sealed jar of golden granular Pabna Deshi Cow Ghee'
                    }
                    fallbackTitle="Deshi Gee"
                    priority
                    className="h-full w-full object-cover"
                  />

                  {activeBatch?.batchCode && (
                    <div className="absolute top-5 right-5 z-10 flex items-center gap-2 rounded-full border border-[#D4AF37]/60 bg-[#1A120B]/90 px-3.5 py-1.5 font-mono text-[11px] font-semibold text-[#F5D692] backdrop-blur-md shadow-md">
                      <span className="h-2 w-2 rounded-full bg-[#2D6A4F]" />
                      <span>{activeBatch.batchCode}</span>
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#140E08]/92 via-[#140E08]/45 to-transparent px-6 pb-6 pt-24 text-[#FAF7F2]">
                    <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#E5B25D]">
                      {bn ? 'পাবনা গাওয়া ঘি' : 'Pabna Artisanal Ghee'}
                    </p>
                    <p className="font-display mt-1.5 text-xl font-medium sm:text-2xl">
                      {bn ? settings.productNameBn : settings.productNameEn}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <a
            href="#order"
            aria-label={bn ? 'নিচে স্ক্রল করুন' : 'Scroll down'}
            className="scroll-cue absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-[var(--c-subtle)] lg:flex"
          >
            <span>{bn ? 'স্ক্রল' : 'Scroll'}</span>
            <span className="h-8 w-px bg-gradient-to-b from-[var(--c-gold-text)] to-transparent" />
          </a>
        </section>

        {/* PROMISE MARQUEE */}
        <section
          aria-label={bn ? 'আমাদের প্রতিশ্রুতি' : 'Our promises'}
          className="overflow-hidden border-y border-[rgb(var(--c-tint)/0.10)] bg-[var(--c-band)] py-5"
        >
          <div className="marquee">
            {[0, 1].map((dup) => (
              <ul
                key={dup}
                aria-hidden={dup === 1 ? 'true' : undefined}
                className="flex shrink-0 items-center"
              >
                {(cms && visibleHighlights(cms.highlights, bn ? 'bn' : 'en').length > 0
                  ? visibleHighlights(cms.highlights, bn ? 'bn' : 'en')
                  : bn
                  ? [
                      'পাবনার একক উৎস',
                      'কাঠের বিলোনায় মন্থন',
                      'পূর্ণ দইয়ের বাটারফ্যাট',
                      'কোনো সংযোজন নেই',
                      'এয়ারটাইট সিল করা বয়াম',
                      'সারাদেশে ক্যাশ অন ডেলিভারি',
                    ]
                  : [
                      'Single-Origin Pabna',
                      'Wooden Bilona Churn',
                      'Whole Curd Butterfat',
                      'Zero Additives',
                      'Airtight Sealed Jar',
                      'Cash on Delivery Nationwide',
                    ]
                ).map((item) => (
                  <li
                    key={`${dup}-${item}`}
                    className="flex items-center gap-8 pr-8 font-display text-lg italic text-[var(--c-muted)] sm:text-xl"
                  >
                    <span>{item}</span>
                    <span aria-hidden="true" className="text-[var(--c-gold-text)]">
                      ✦
                    </span>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </section>

        {/* SECTION 02: SINGLE-PRODUCT PURCHASE MODULE & WEIGHT CONFIGURATOR */}
        <section
          id="order"
          className="scroll-mt-16 sm:scroll-mt-20 mx-auto max-w-[1320px] px-5 py-20 sm:px-8 lg:py-28"
        >
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <span className="eyebrow is-centered">
              {bn ? 'খাঁটি একক ঐতিহ্য' : 'Authentic Single Product'}
            </span>
            <h2 className="section-title mt-5">
              {bn ? 'পছন্দের বয়াম ও পরিমাণ বেছে নিন' : 'Choose your jar'}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[var(--c-muted)] sm:text-base">
              {bn
                ? 'এয়ারটাইট বয়ামে সংরক্ষিত পাবনার খাঁটি কাঠের বিলোনা ঘি'
                : 'Pabna bilona ghee, sealed warm in an airtight jar to keep every note of aroma.'}
            </p>
          </div>

          <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
            {/* Gallery */}
            <div className="lg:sticky lg:top-28 lg:col-span-6">
              <div ref={galleryPreviewRef} className="scroll-mt-24">
                <div className="relative">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 -translate-x-3 translate-y-3 rounded-[2rem] border border-[#D4AF37]/35 sm:-translate-x-4 sm:translate-y-4"
                  />
                  <div className="relative aspect-[5/6] w-full overflow-hidden rounded-[2rem] border border-[rgb(var(--c-tint)/0.14)] bg-[var(--c-surface)] shadow-[0_40px_80px_-35px_rgb(var(--c-shadow))] sm:aspect-[4/4.4]">
                    {showBlueprint ? (
                      <div className="flex h-full w-full items-center justify-center p-6">
                        <canvas
                          ref={specsCanvasRef}
                          aria-label="Jar brass aroma seal wireframe"
                          className="h-full w-full"
                        />
                      </div>
                    ) : (
                      <div
                        className="h-full w-full transition-transform duration-500 ease-out"
                        style={{ transform: `scale(${Math.max(1, previewScale)})` }}
                      >
                        <ResilientImage
                          key={activeGallery.src}
                          src={activeGallery.src}
                          alt={bn ? activeGallery.altBn : activeGallery.altEn}
                          fallbackTitle="Deshi Gee"
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-[#140E08]/85 via-[#140E08]/30 to-transparent px-5 pb-5 pt-20 text-[#FAF7F2]">
                      <div className="min-w-0">
                        <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-[#E5B25D]">
                          {bn ? selectedVariantMeta.labelBn : selectedVariantMeta.labelEn}
                        </p>
                        <p className="mt-1 truncate text-sm">
                          {showBlueprint
                            ? bn
                              ? 'সিল ডায়াগ্রাম (৩ডি ওয়্যারফ্রেম)'
                              : 'Airtight brass seal diagram'
                            : bn
                              ? selectedVariantMeta.jarHeightNoteBn
                              : selectedVariantMeta.jarHeightNoteEn}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowBlueprint((v) => !v)}
                        className="pointer-events-auto inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border border-white/30 bg-black/35 px-3.5 text-[11px] font-medium text-white backdrop-blur-md transition-colors hover:bg-black/55"
                      >
                        {showBlueprint ? (
                          <>
                            <Camera className="h-3.5 w-3.5" />
                            <span>{bn ? 'আসল ছবি' : 'Photo'}</span>
                          </>
                        ) : (
                          <>
                            <Box className="h-3.5 w-3.5" />
                            <span>{bn ? 'সিল ডায়াগ্রাম' : 'Seal 3D'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-4 gap-3 sm:gap-4">
                  {PRODUCT_GALLERY.map((item, idx) => {
                    const active = idx === galleryIdx && !showBlueprint;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={active}
                        aria-label={bn ? item.labelBn : item.labelEn}
                        onClick={() => {
                          setShowBlueprint(false);
                          setGalleryIdx(idx);
                        }}
                        className={`group aspect-square cursor-pointer touch-manipulation select-none overflow-hidden rounded-2xl border-2 transition-all ${
                          active
                            ? 'border-[#B47B2B] shadow-md'
                            : 'border-transparent opacity-70 hover:opacity-100'
                        }`}
                      >
                        <ResilientImage
                          src={item.src}
                          alt={bn ? item.altBn : item.altEn}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Purchase panel */}
            <div className="lg:col-span-6">
              <div className="luxury-card rounded-[2rem] p-6 sm:p-9">
                <div className="flex items-center justify-between gap-3">
                  {!orderingReady ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      {bn ? 'অনলাইন অর্ডার সাময়িকভাবে অনুপলব্ধ' : 'Ordering is temporarily unavailable'}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-full bg-[#2D6A4F]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--c-green-text)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#2D6A4F]" />
                      {isOutOfStock
                        ? bn
                          ? 'স্টক সমাপ্ত'
                          : 'Out of stock'
                        : bn
                          ? `স্টকে আছে (${activeStock}টি জার)`
                          : `In stock · ${activeStock} jars`}
                    </span>
                  )}
                </div>

                <h2 className="section-title mt-6 !text-[clamp(1.8rem,1.3rem+1.8vw,2.6rem)]">
                  {bn ? settings.productNameBn : settings.productNameEn}
                </h2>

                {orderingReady && activePrice > 0 && (
                  <p className="mt-4 flex items-baseline gap-3">
                    <span className="font-display text-4xl tabular-nums text-[var(--c-gold-text)] sm:text-5xl">
                      {formatBdt(activePrice)}
                    </span>
                    <span className="text-xs uppercase tracking-[0.2em] text-[var(--c-subtle)]">
                      / {bn ? selectedVariantMeta.labelBn : selectedVariantMeta.labelEn}
                    </span>
                  </p>
                )}

                <p className="mt-5 text-sm leading-[1.85] text-[var(--c-muted)] sm:text-base">
                  {bn
                    ? 'সকালের সংগৃহীত দেশী গরুর দুধ দিয়ে মাটির হাঁড়িতে পাতা দই, কাঠের বিলোনার মন্থন এবং মৃদু আঁচে তৈরি সোনালী দানাদার ঘি।'
                    : 'Prepared in small batches from cultured Pabna cow milk curd, wood-churned with a traditional bilona, and slow-clarified.'}
                </p>

                <div className="gold-rule my-8" />

                {/* Weight selector */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--c-subtle)]">
                    {bn ? 'ওজন নির্বাচন করুন' : 'Select size'}
                  </p>

                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {WEIGHT_VARIANTS.map((v) => {
                      const active = v.key === selectedWeight;
                      const price = getPriceForWeight(v.key);
                      const stock = getStockForWeight(v.key);
                      const meta = packageMeta?.[v.key];
                      const sizeDisabled = meta ? !meta.enabled : false;
                      return (
                        <button
                          key={v.key}
                          type="button"
                          aria-pressed={active}
                          disabled={sizeDisabled}
                          onClick={() => {
                            weightTouchedRef.current = true;
                            setSelectedWeight(v.key);
                          }}
                          className={`relative flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-4 text-center transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                            active
                              ? 'border-[#B47B2B] bg-[#B47B2B]/10 shadow-[0_10px_30px_-15px_rgba(180,123,43,0.7)]'
                              : 'border-[rgb(var(--c-tint)/0.16)] hover:border-[rgb(var(--c-tint)/0.4)]'
                          }`}
                        >
                          {meta && meta.badge && !sizeDisabled && (
                            <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#B47B2B] px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--c-on-gold)]">
                              {meta.badge === 'popular' ? (bn ? 'জনপ্রিয়' : 'Most popular') : bn ? 'সেরা মূল্য' : 'Best value'}
                            </span>
                          )}
                          {active && (
                            <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-[#B47B2B] text-[var(--c-on-gold)]">
                              <Check className="h-2.5 w-2.5" />
                            </span>
                          )}
                          <span className="font-display text-xl font-medium text-[var(--c-ink)]">
                            {bn ? v.labelBn : v.labelEn}
                          </span>
                          {orderingReady && price > 0 && (
                            <span className="font-mono text-xs tabular-nums text-[var(--c-gold-text)]">
                              {sizeDisabled ? (bn ? 'অনুপলব্ধ' : 'Unavailable') : stock <= 0 ? (bn ? 'স্টক শেষ' : 'Out') : formatBdt(price)}
                            </span>
                          )}
                          {meta && meta.discountPct > 0 && !sizeDisabled && stock > 0 && (
                            <span className="font-mono text-[10px] text-[var(--c-subtle)] line-through">
                              {formatBdt(meta.regularPrice)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quantity + actions */}
                {!orderingReady ? (
                  <div
                    role="status"
                    data-testid="storefront-ordering-unavailable"
                    className="mt-8 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-5 text-sm text-[var(--c-ink)]"
                  >
                    <p className="font-semibold">
                      {bn ? 'অনলাইন অর্ডার সাময়িকভাবে অনুপলব্ধ' : 'Ordering is temporarily unavailable'}
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--c-muted)]">
                      {bn
                        ? 'মূল্য, ডেলিভারি চার্জ ও অর্ডার সিস্টেম চূড়ান্ত নিশ্চিত হলে সরাসরি অনলাইন অর্ডার চালু হবে। আপডেট জানতে কলব্যাক অনুরোধ করুন।'
                        : 'Online checkout is temporarily unavailable while store pricing and ordering services are being finalized. Please check back shortly or request a callback.'}
                    </p>
                    <button type="button" onClick={openCallbackRequest} className="btn-gold mt-4 !min-h-[46px] !px-6">
                      {bn ? 'কলব্যাক অনুরোধ করুন' : 'Request a Callback'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-8 space-y-3">
                    <div className="flex items-stretch gap-3">
                      <div className="inline-flex min-h-[52px] shrink-0 items-center rounded-full border border-[rgb(var(--c-tint)/0.22)]">
                        <button
                          type="button"
                          disabled={isOutOfStock || purchaseQty <= 1}
                          onClick={() => setPurchaseQty((q) => Math.max(1, q - 1))}
                          aria-label="Decrease quantity"
                          className="flex h-12 w-12 items-center justify-center rounded-full text-[var(--c-ink)] transition-colors hover:bg-[rgb(var(--c-tint)/0.08)] disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-8 text-center font-mono text-base font-bold tabular-nums text-[var(--c-ink)]">
                          {bn ? toBengaliDigits(purchaseQty) : purchaseQty}
                        </span>
                        <button
                          type="button"
                          disabled={isOutOfStock || purchaseQty >= activeStock}
                          onClick={() =>
                            setPurchaseQty((q) => (activeStock > 0 ? Math.min(activeStock, q + 1) : 1))
                          }
                          aria-label="Increase quantity"
                          className="flex h-12 w-12 items-center justify-center rounded-full text-[var(--c-ink)] transition-colors hover:bg-[rgb(var(--c-tint)/0.08)] disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>

                      <button
                        type="button"
                        disabled={isOutOfStock}
                        onClick={() => handleAddToCart(false)}
                        className="btn-ghost min-w-0 flex-1 disabled:opacity-45"
                      >
                        {justAdded ? (
                          <>
                            <Check className="h-4 w-4 text-[var(--c-gold-text)]" />
                            <span>{bn ? 'যোগ হয়েছে' : 'Added'}</span>
                          </>
                        ) : (
                          <>
                            <ShoppingBag className="h-4 w-4" />
                            <span>{bn ? 'ব্যাগে যোগ করুন' : 'Add to Bag'}</span>
                          </>
                        )}
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={isOutOfStock}
                      onClick={() => handleAddToCart(true)}
                      className="btn-gold w-full disabled:opacity-45"
                    >
                      <span>{bn ? 'অর্ডার করুন' : 'Buy Now'}</span>
                      <span className="h-3 w-px bg-current opacity-40" />
                      <span className="tabular-nums">{formatBdt(activePrice * purchaseQty)}</span>
                    </button>
                  </div>
                )}

                {hasConfirmedEtas && (
                  <div className="mt-5 flex items-center gap-3 rounded-2xl bg-[rgb(var(--c-tint)/0.05)] px-4 py-3 text-xs text-[var(--c-muted)]">
                    <Truck className="h-4 w-4 shrink-0 text-[var(--c-gold-text)]" />
                    <span>
                      {bn
                        ? `${settings.estimatedDhakaDays ? `ঢাকার ভেতরে ${settings.estimatedDhakaDays}` : ''}${settings.estimatedDhakaDays && settings.estimatedOutsideDays ? ' ও ' : ''}${settings.estimatedOutsideDays ? `বাইরে ${settings.estimatedOutsideDays}` : ''} সময়ে ক্যাশ অন ডেলিভারি।`
                        : `${settings.estimatedDhakaDays ? `Inside Dhaka: ${settings.estimatedDhakaDays}` : ''}${settings.estimatedDhakaDays && settings.estimatedOutsideDays ? ' · ' : ''}${settings.estimatedOutsideDays ? `Nationwide: ${settings.estimatedOutsideDays}` : ''}. Cash on Delivery.`}
                    </span>
                  </div>
                )}

                {/* Assurance row */}
                <ul className="mt-8 grid grid-cols-3 gap-3 text-center">
                  {[
                    { Icon: Truck, en: 'Cash on Delivery', bn: 'ক্যাশ অন ডেলিভারি' },
                    { Icon: ShieldCheck, en: 'Airtight Sealed', bn: 'এয়ারটাইট সিল' },
                    { Icon: Leaf, en: 'Zero Additives', bn: 'কোনো সংযোজন নেই' },
                  ].map(({ Icon, en, bn: bnLabel }) => (
                    <li key={en} className="flex flex-col items-center gap-2">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[rgb(var(--c-tint)/0.18)] text-[var(--c-gold-text)]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="text-[11px] font-medium leading-snug text-[var(--c-muted)]">
                        {bn ? bnLabel : en}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* Specification list */}
                <dl className="mt-8 divide-y divide-[rgb(var(--c-tint)/0.10)] border-t border-[rgb(var(--c-tint)/0.10)] text-sm">
                  <div className="flex items-baseline justify-between gap-6 py-3.5">
                    <dt className="shrink-0 text-[var(--c-subtle)]">{bn ? 'উপাদান' : 'Ingredients'}</dt>
                    <dd className="text-right font-medium text-[var(--c-ink)]">
                      {bn
                        ? 'গরুর দুধের মিল্কফ্যাট (কোনো বনস্পতি বা কৃত্রিম রং নয়)'
                        : 'Clarified Cultured Cow Milkfat'}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-6 py-3.5">
                    <dt className="shrink-0 text-[var(--c-subtle)]">{bn ? 'সুবাস ও স্বাদ' : 'Tasting notes'}</dt>
                    <dd className="text-right font-medium text-[var(--c-ink)]">
                      {bn
                        ? 'হালকা ভাজা বাদাম ও মিষ্টি ক্যারামেল সুবাস'
                        : 'Warm toasted hazelnut, caramelized butter'}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-6 py-3.5">
                    <dt className="shrink-0 text-[var(--c-subtle)]">{bn ? 'সংরক্ষণ' : 'Storage'}</dt>
                    <dd className="text-right font-medium text-[var(--c-ink)]">
                      {bn
                        ? 'মুখ শক্ত করে বন্ধ রেখে শুকনো ও ঠান্ডা স্থানে রাখুন'
                        : 'Keep tightly sealed in a cool, dry pantry'}
                    </dd>
                  </div>
                  {settings.originLocation && (
                    <div className="flex items-baseline justify-between gap-6 py-3.5">
                      <dt className="shrink-0 text-[var(--c-subtle)]">{bn ? 'উৎপাদন তথ্য' : 'Origin'}</dt>
                      <dd className="text-right font-medium text-[var(--c-ink)]">{settings.originLocation}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 03: CRAFT & BATCH TRANSPARENCY */}
        <section className="border-y border-[rgb(var(--c-tint)/0.08)] bg-[var(--c-band)]/60 py-16 lg:py-20">
          <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
            <div className="max-w-2xl">
              <span className="eyebrow">
                {bn ? 'স্বচ্ছতা ও প্রক্রিয়া' : 'Craft & Transparency'}
              </span>
              <h2 className="section-title mt-4">
                {bn
                  ? 'উৎস থেকে বয়াম—স্বচ্ছ প্রস্তুতপ্রণালী'
                  : 'Transparent preparation from pasture to jar'}
              </h2>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="luxury-card rounded-2xl p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#B47B2B]/10 text-[var(--c-gold-text)]">
                  <Leaf className="h-5 w-5" />
                </div>
                <p className="mt-4 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--c-gold-text)]">
                  {bn ? 'দুধের উৎস ও উপাদান' : 'Milk Sourcing & Curd'}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--c-muted)]">
                  {bn
                    ? 'পাবনার খামার থেকে সংগৃহীত গরুর দুধ মাটির হাঁড়িতে দই পেতে কাঠের বিলোনায় মন্থন করা হয়।'
                    : 'Whole cow milk sourced in Pabna, fermented into curd in earthen pots and churned with a wooden bilona.'}
                </p>
              </div>

              <div className="luxury-card rounded-2xl p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#B47B2B]/10 text-[var(--c-gold-text)]">
                  <Award className="h-5 w-5" />
                </div>
                <p className="mt-4 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--c-gold-text)]">
                  {bn ? 'ব্যাচ পাসপোর্ট' : 'Batch Traceability'}
                </p>
                {activeBatch?.batchCode ? (
                  <dl className="mt-3 space-y-2 text-xs">
                    <div className="flex justify-between border-b border-[rgb(var(--c-tint)/0.06)] pb-1.5">
                      <dt className="text-[var(--c-muted)]">{bn ? 'সক্রিয় ব্যাচ' : 'Active Batch'}</dt>
                      <dd className="font-mono font-bold text-[var(--c-ink)]">{activeBatch.batchCode}</dd>
                    </div>
                    {activeBatch.productionDate && (
                      <div className="flex justify-between border-b border-[rgb(var(--c-tint)/0.06)] pb-1.5">
                        <dt className="text-[var(--c-muted)]">{bn ? 'উৎপাদনের তারিখ' : 'Produced'}</dt>
                        <dd className="font-mono">{activeBatch.productionDate}</dd>
                      </div>
                    )}
                    {activeBatch.expiryDate && (
                      <div className="flex justify-between">
                        <dt className="text-[var(--c-muted)]">{bn ? 'মেয়াদোত্তীর্ণ' : 'Best Before'}</dt>
                        <dd className="font-mono">{activeBatch.expiryDate}</dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="mt-2 text-sm leading-relaxed text-[var(--c-muted)]">
                    {bn
                      ? 'বর্তমান ব্যাচের তথ্য অ্যাডমিন প্যানেল থেকে যুক্ত হলে এখানে প্রদর্শিত হবে।'
                      : 'Active batch details will appear here once recorded by the store team.'}
                  </p>
                )}
              </div>

              <div className="luxury-card rounded-2xl p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#B47B2B]/10 text-[var(--c-gold-text)]">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <p className="mt-4 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--c-gold-text)]">
                  {bn ? 'সংরক্ষণ নির্দেশনা' : 'Care & Storage'}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--c-muted)]">
                  {bn
                    ? 'সর্বদা শুকনো ও পরিষ্কার চামচ ব্যবহার করুন এবং সূর্যের আলো থেকে দূরে সাধারণ তাপমাত্রায় রাখুন।'
                    : 'Always scoop with a clean, dry spoon and keep sealed away from direct heat and sunlight.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 04: FROM MILK TO JAR (DESKTOP PINNED / MOBILE & TABLET STACKED) */}
        <section
          id="craft"
          ref={showcaseRef}
          className="scroll-mt-16 sm:scroll-mt-20 relative bg-[#1E1710] text-[#FAF7F2]"
        >
          {/* Desktop Pinned GSAP ScrollTrigger Sequence */}
          <div className="relative hidden h-dvh w-full overflow-hidden lg:block">
            {CRAFT_STAGES.map((stage, idx) => (
              <div
                key={stage.index}
                ref={(el) => {
                  frameRefs.current[idx] = el;
                }}
                className={`craft-frame ${idx === 0 ? 'is-first' : ''}`}
              >
                <ResilientImage
                  src={stage.image}
                  alt={bn ? stage.altBn : stage.altEn}
                  className="h-full w-full object-cover"
                />
              </div>
            ))}

            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-[#140E08]/90 via-[#140E08]/35 to-[#140E08]/15"
            />

            <div className="absolute inset-x-0 bottom-0 z-20 mx-auto flex max-w-[1320px] items-end justify-between gap-8 px-8 pb-14">
              <div
                className={`max-w-2xl transition-all duration-200 ${
                  captionTransitioning ? 'opacity-65 blur-[2px]' : 'opacity-100 blur-0'
                }`}
              >
                <p className="font-mono text-xs uppercase tracking-widest text-[#F5D692] tabular-nums">
                  {currentStage.index}. {bn ? 'দুধ থেকে জার' : 'From Milk to Jar'}
                </p>
                <h2 className="section-title mt-4 !text-[#FAF7F2]">
                  {bn ? currentStage.titleBn : currentStage.titleEn}
                </h2>
                <p className="mt-2.5 text-lg text-[#FAF7F2]/90">
                  {bn ? currentStage.subBn : currentStage.subEn}
                </p>
                <p className="mt-2 max-w-[54ch] text-sm leading-relaxed text-[#E8DFC5]/80">
                  {bn ? currentStage.detailBn : currentStage.detailEn}
                </p>
              </div>

              <div
                role="tablist"
                aria-label="Craft stages"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#FAF7F2]/20 bg-[#140E08]/70 p-1.5 backdrop-blur-md"
              >
                {CRAFT_STAGES.map((stage, idx) => (
                  <button
                    key={stage.index}
                    type="button"
                    role="tab"
                    aria-selected={idx === activeStage}
                    onClick={() => handleJumpStage(idx)}
                    className={`rounded-lg px-3.5 py-2 font-mono text-xs font-medium tabular-nums transition-colors ${
                      idx === activeStage
                        ? 'bg-[#B47B2B] text-[var(--c-on-gold)]'
                        : 'text-[#E8DFC5]/75 hover:text-[#FAF7F2]'
                    }`}
                  >
                    {bn ? toBengaliDigits(stage.index) : stage.index}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Mobile & Tablet Clean Stacked Craft Layout */}
          <div className="space-y-6 px-4 py-12 sm:space-y-8 sm:px-8 sm:py-16 lg:hidden">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-[#F5D692]">
                {bn ? 'দুধ থেকে জার' : 'From Milk to Jar'}
              </p>
              <h2 className="section-title mt-4 !text-[#FAF7F2]">
                {bn ? 'চার ধাপের বিলোনা পদ্ধতি' : 'Four stages of Bilona craft'}
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
              {CRAFT_STAGES.map((stage) => (
                <article
                  key={stage.index}
                  className="overflow-hidden rounded-2xl border border-[#FAF7F2]/15 bg-[#261D14]"
                >
                  <div className="aspect-[16/10] w-full">
                    <ResilientImage
                      src={stage.image}
                      alt={bn ? stage.altBn : stage.altEn}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="p-4 sm:p-5">
                    <p className="font-mono text-xs text-[#F5D692]">{stage.index}</p>
                    <h3 className="font-display mt-1 text-lg font-semibold sm:text-xl">
                      {bn ? stage.titleBn : stage.titleEn}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#E8DFC5]/85">
                      {bn ? stage.detailBn : stage.detailEn}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 05: INTERACTIVE TEXTURE COMPARISON SLIDER */}
        <section className="mx-auto max-w-[1320px] px-4 py-16 sm:px-8 sm:py-24">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-7">
              <div
                ref={compWrapRef}
                onPointerDown={(e) => {
                  isDraggingRef.current = true;
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  updateSplitFromClientX(e.clientX);
                }}
                onPointerMove={(e) => {
                  if (!isDraggingRef.current) return;
                  updateSplitFromClientX(e.clientX);
                }}
                onPointerUp={() => {
                  isDraggingRef.current = false;
                }}
                onPointerCancel={() => {
                  isDraggingRef.current = false;
                }}
                className="relative aspect-[16/10] w-full cursor-ew-resize select-none overflow-hidden rounded-3xl border border-[rgb(var(--c-tint)/0.14)] bg-[#1A120B] shadow-[0_20px_50px_-10px_rgba(30,23,16,0.16)] touch-none"
              >
                <div className="absolute inset-0">
                  <ResilientImage
                    src={IMAGES.textureLiquid}
                    alt={
                      bn
                        ? 'উষ্ণ আবহাওয়ায় তরল সোনালী দেশী ঘি'
                        : 'Warm liquid golden Deshi Ghee'
                    }
                    className="h-full w-full object-cover"
                  />
                  <div className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-[#140E08]/85 px-3 py-1.5 font-mono text-xs text-[#FAF7F2] backdrop-blur-md border border-[#FAF7F2]/10 sm:right-5 sm:bottom-5">
                    {bn ? 'উষ্ণ আবহাওয়ায় · তরল সোনালী' : 'Warm Weather · Liquid Amber'}
                  </div>
                </div>

                <div
                  className="absolute inset-0"
                  style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
                >
                  <ResilientImage
                    src={IMAGES.textureDanadar}
                    alt={
                      bn
                        ? 'শীতল আবহাওয়ায় জমে থাকা দানাদার দেশী ঘি'
                        : 'Cool-weather granular danadar Deshi Ghee'
                    }
                    className="h-full w-full object-cover"
                  />
                  <div className="pointer-events-none absolute left-3 bottom-3 rounded-full bg-[#140E08]/85 px-3 py-1.5 font-mono text-xs text-[#F5D692] backdrop-blur-md border border-[#F5D692]/20 sm:left-5 sm:bottom-5">
                    {bn ? 'শীতল আবহাওয়ায় · প্রাকৃতিক দানাদার' : 'Cool Weather · Natural Danadar'}
                  </div>
                </div>

                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Compare chilled granular ghee vs warm liquid ghee"
                  aria-valuemin={4}
                  aria-valuemax={96}
                  aria-valuenow={Math.round(splitPct)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') {
                      e.preventDefault();
                      setSplitPct((p) => Math.max(4, p - 4));
                    } else if (e.key === 'ArrowRight') {
                      e.preventDefault();
                      setSplitPct((p) => Math.min(96, p + 4));
                    }
                  }}
                  style={{ left: `${splitPct}%` }}
                  className="absolute inset-y-0 z-10 flex w-14 -translate-x-1/2 items-center justify-center focus:outline-none touch-none"
                >
                  <div className="h-full w-0.5 bg-[var(--c-card)] shadow-md" />
                  <div className="absolute flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#D4AF37] bg-[#1A120B] text-[#F5D692] shadow-xl">
                    <ArrowLeftRight className="h-4 w-4" />
                  </div>
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-[var(--c-gold-text)] sm:text-left flex items-center justify-center sm:justify-start gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                <span>{bn ? 'হ্যান্ডেলটি টেনে তাপমাত্রাভেদে রূপের পরিবর্তন দেখুন' : 'Drag slider to observe natural temperature crystallization'}</span>
              </p>
            </div>

            <div className="lg:col-span-5">
              <span className="eyebrow">
                {bn ? 'প্রাকৃতিক টেক্সচার ও বিজ্ঞান' : 'Natural Crystallization'}
              </span>
              <h2 className="section-title mt-4">
                {bn
                  ? 'তাপমাত্রার সাথে দানাদার রূপের স্বাভাবিক পরিবর্তন'
                  : 'Granular in cool weather, liquid gold when warm'}
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-[var(--c-muted)] sm:text-base">
                {bn
                  ? 'প্রাকৃতিক মিল্কফ্যাটের বিভিন্ন ফ্যাটি অ্যাসিডের গলনাঙ্ক ভিন্ন। তাই শীতল আবহাওয়ায় ঘি স্বাভাবিকভাবেই দানাদার হয়ে জমে এবং উষ্ণ আবহাওয়ায় গলে গিয়ে সোনালী তরল রূপ নেয়।'
                  : 'Natural butterfat naturally crystallizes into coarse danadar grains in cool weather and melts into clear golden liquid in warm conditions.'}
              </p>
              <div className="mt-6 rounded-2xl border border-[rgb(var(--c-tint)/0.08)] bg-[var(--c-band)]/70 p-4 text-xs text-[var(--c-muted)]">
                <p className="flex items-center gap-1.5 font-semibold text-[var(--c-ink)]">
                  <Lightbulb className="h-4 w-4 shrink-0 text-[#B47B2B]" />
                  <span>{bn ? 'গুরুত্বপূর্ণ তথ্য:' : 'Craft Note:'}</span>
                </p>
                <p className="mt-1.5 leading-relaxed">
                  {bn
                    ? 'তাপমাত্রাভেদে ঘি জমে যাওয়া বা তরল হওয়া সম্পূর্ণ স্বাভাবিক; এটি কোনো মানগত ত্রুটি নয়।'
                    : 'Natural shifts between granular and liquid texture across seasons are completely normal for unstabilized dairy fat.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 06: PROOF & BATCH VERIFICATION QR */}
        <section
          id="proof"
          className="scroll-mt-16 sm:scroll-mt-20 border-y border-[rgb(var(--c-tint)/0.08)] bg-[var(--c-band)]/50 py-16 lg:py-24"
        >
          <div className="mx-auto grid max-w-[1320px] grid-cols-1 items-center gap-10 px-4 sm:px-8 md:grid-cols-12">
            <div className="space-y-4 md:col-span-8">
              <span className="eyebrow">
                {bn ? 'ব্যাচ যাচাই ও রেকর্ড' : 'Provenance & Batch Verification'}
              </span>
              <h2 className="section-title">
                {bn
                  ? 'ব্যাচ কোড দিয়ে উৎপাদন তথ্য যাচাই করুন'
                  : 'Inspect published batch records online'}
              </h2>
              <p className="max-w-[54ch] text-sm leading-relaxed text-[var(--c-muted)] sm:text-base">
                {bn
                  ? 'স্টোর কর্তৃপক্ষ যখন কোনো ব্যাচের তথ্য ও রিপোর্ট প্রকাশ করে, তখন ব্যাচ কোড দিয়ে তার উৎপাদন ও মেয়াদ সংক্রান্ত তথ্য অনলাইনে দেখা যায়।'
                  : 'When a harvest batch record is published by the store owner, its production dates and any uploaded documentation can be inspected on the batch lookup page.'}
              </p>

              {activeBatch?.batchCode ? (
                <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
                  <div className="luxury-card rounded-2xl p-4 text-xs">
                    <p className="text-[var(--c-gold-text)] font-mono uppercase tracking-wider font-semibold">{bn ? 'বর্তমান সক্রিয় ব্যাচ' : 'Active Batch'}</p>
                    <p className="mt-1 font-mono text-base font-bold text-[var(--c-ink)]">
                      {activeBatch.batchCode}
                    </p>
                    {(activeBatch.productionDate || activeBatch.expiryDate) && (
                      <p className="mt-1 text-[var(--c-muted)]">
                        {activeBatch.productionDate || '—'} → {activeBatch.expiryDate || '—'}
                      </p>
                    )}
                  </div>

                  {(activeBatch.licenceDetails || activeBatch.labReportStatus) && (
                    <div className="luxury-card rounded-2xl p-4 text-xs">
                      <p className="text-[var(--c-gold-text)] font-mono uppercase tracking-wider font-semibold">
                        {bn ? 'ব্যাচ স্ট্যাটাস' : 'Batch Record Status'}
                      </p>
                      {activeBatch.licenceDetails && (
                        <p className="mt-1 font-medium text-[var(--c-ink)]">
                          {activeBatch.licenceDetails}
                        </p>
                      )}
                      {activeBatch.labReportStatus && (
                        <p className="mt-1 text-[var(--c-green-text)] font-semibold">{activeBatch.labReportStatus}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              <div className="flex flex-col gap-3 pt-3 sm:flex-row sm:flex-wrap">
                <Link
                  href={
                    activeBatch?.batchCode
                      ? `/batch?code=${encodeURIComponent(activeBatch.batchCode)}`
                      : '/batch'
                  }
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--c-accent)] px-6 py-2.5 text-xs font-semibold text-[var(--c-on-accent)] hover:bg-[var(--c-accent-hover)] transition-colors sm:w-auto shadow-xs"
                >
                  <FileCheck2 className="h-4 w-4 text-[#D4AF37]" />
                  <span>
                    {bn ? 'ব্যাচ যাচাই পেজ দেখুন' : 'Open Batch Verification Page'}
                  </span>
                </Link>

                {activeBatch?.labReportUrl && (
                  <a
                    href={activeBatch.labReportUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-bg)] px-6 py-2.5 text-xs font-semibold text-[var(--c-ink)] hover:bg-[var(--c-surface)] transition-colors sm:w-auto"
                  >
                    <span>{bn ? 'ব্যাচ ডকুমেন্ট দেখুন' : 'Open Batch Document'}</span>
                    <ExternalLink className="h-3.5 w-3.5 text-[var(--c-gold-text)]" />
                  </a>
                )}
              </div>
            </div>

            {activeBatch?.batchCode && (
              <div className="flex flex-col items-center rounded-3xl border-2 border-[#D4AF37]/30 bg-[var(--c-bg)] p-8 md:col-span-4 shadow-[0_15px_40px_-10px_rgba(30,23,16,0.08)]">
                {qrCodeUrl && (
                  <div className="rounded-2xl border border-[rgb(var(--c-tint)/0.12)] p-2 bg-[var(--c-card)] shadow-xs">
                    <img
                      src={qrCodeUrl}
                      alt={`Batch verification QR for ${activeBatch.batchCode}`}
                      className="h-44 w-44 rounded-xl"
                    />
                  </div>
                )}
                <p className="mt-4 font-mono text-sm font-bold text-[var(--c-ink)]">
                  {activeBatch.batchCode}
                </p>
                <p className="mt-1 text-center text-xs text-[var(--c-muted)]">
                  {bn
                    ? 'মোবাইল ক্যামেরা দিয়ে স্ক্যান করে ব্যাচ তথ্য দেখুন'
                    : 'Scan with camera to inspect published batch record'}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* SECTION 07: FOUNDER & FARM STORY */}
        <section
          id="story"
          className="scroll-mt-16 sm:scroll-mt-20 mx-auto max-w-[1320px] px-4 py-16 sm:px-8 sm:py-24"
        >
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="grid grid-cols-12 gap-4 lg:col-span-6">
              <div className="col-span-7 aspect-[4/3] overflow-hidden rounded-3xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-surface)] shadow-[0_15px_35px_-10px_rgba(30,23,16,0.12)]">
                <ResilientImage
                  src={IMAGES.founderPortrait}
                  alt={
                    bn
                      ? 'পাবনার খামার প্রাঙ্গণে হাতে তৈরি দেশী ঘিয়ের জারসহ প্রতিষ্ঠাতা'
                      : 'Founder holding a sealed jar of Deshi Gee at the Pabna farmstead courtyard'
                  }
                  className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
                />
              </div>
              <div className="col-span-5 aspect-[4/3] self-end overflow-hidden rounded-3xl border border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-surface)] shadow-[0_15px_35px_-10px_rgba(30,23,16,0.12)]">
                <ResilientImage
                  src={IMAGES.milkSourcing}
                  alt={
                    bn
                      ? 'পাবনার নদী তীরের সবুজ চারণভূমি'
                      : 'Grass-fed cattle pastures at sunrise in Pabna'
                  }
                  className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
                />
              </div>
            </div>

            <div className="lg:col-span-6 space-y-4">
              <span className="eyebrow">
                {bn ? 'উৎস ও ঐতিহ্যবাহী দর্শন' : 'Heritage & Pastoral Roots'}
              </span>
              <h2 className="section-title">
                {bn
                  ? 'একটিই পণ্য—যেন প্রতিটি রান্নাঘরে পৌঁছায় চেনা গ্রামের খাঁটি ঘ্রাণ'
                  : 'Dedicated to one honest jar of Pabna bilona ghee'}
              </h2>
              <p className="text-sm leading-relaxed text-[var(--c-muted)] sm:text-base">
                {bn
                  ? 'শহুরে কৃত্রিম খাদ্যের ভিড়ে আসল দই-মন্থিত গাওয়া ঘিয়ের অমূল্য স্বাদ ফিরিয়ে আনাই আমাদের লক্ষ্য। আমরা একাধিক পণ্যের ব্যবসা না করে শুধুমাত্র পাবনার নদী তীরের চারণভূমির খাঁটি কাঁচা দুধ ও কাঠের বিলোনার প্রাচীন মন্থন পদ্ধতির উপর মনোযোগ দিয়েছি।'
                  : 'Deshi Gee began with a simple commitment: avoid supermarket mass-production and focus completely on perfecting single-origin Pabna grass-fed bilona cow ghee.'}
              </p>
              <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-[var(--c-ink)]">
                <span className="text-[var(--c-gold-text)]">{bn ? 'উৎপাদন ও সংগ্রহ কেন্দ্র:' : 'Pastoral Origin:'}</span>
                <span className="font-mono text-[var(--c-gold-text)] bg-[var(--c-band)] px-3 py-1 rounded-full border border-[#B47B2B]/20">
                  {settings.originLocation}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 08: WAYS TO ENJOY DESHI GHEE */}
        <section className="border-y border-[rgb(var(--c-tint)/0.08)] bg-[var(--c-band)]/40 py-16 lg:py-24">
          <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
            <div className="max-w-2xl">
              <span className="eyebrow">
                {bn ? 'বাঙালি রান্না ও পরিবেশন' : 'Culinary Traditions'}
              </span>
              <h2 className="section-title mt-4">
                {bn
                  ? 'প্রতিদিনের খাবারে খাঁটি ঘিয়ের সুবাস'
                  : 'Five everyday ways across Bengali kitchens'}
              </h2>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-6">
              {WAYS_TO_ENJOY.map((dish, idx) => (
                <article
                  key={dish.id}
                  className={`group luxury-card flex flex-col overflow-hidden rounded-2xl ${
                    idx < 3
                      ? 'lg:col-span-2'
                      : idx === 3
                        ? 'lg:col-span-3'
                        : 'sm:col-span-2 lg:col-span-3'
                  }`}
                >
                  <div className="aspect-[4/3] w-full overflow-hidden bg-[var(--c-elev)]">
                    <ResilientImage
                      src={dish.image}
                      alt={bn ? dish.titleBn : dish.titleEn}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                    />
                  </div>
                  <div className="flex flex-1 flex-col justify-between p-5">
                    <div>
                      <h3 className="font-display text-lg font-bold text-[var(--c-ink)]">
                        {bn ? dish.titleBn : dish.titleEn}
                      </h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-[var(--c-muted)]">
                        {bn ? dish.descBn : dish.descEn}
                      </p>
                    </div>
                    <div className="mt-4 border-t border-[rgb(var(--c-tint)/0.08)] pt-3 flex items-start gap-1.5 text-[11px] font-medium text-[var(--c-gold-text)]">
                      <Sparkles className="h-3 w-3 shrink-0 mt-0.5 text-[#B47B2B]" />
                      <span>{bn ? dish.tipBn : dish.tipEn}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 09: CUSTOMER REVIEWS & MODERATED FEEDBACK */}
        <section className="mx-auto max-w-[1320px] px-5 py-20 sm:px-8 lg:py-28">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
            {/* Summary */}
            <div className="lg:col-span-4 lg:sticky lg:top-28 lg:self-start">
              <span className="eyebrow">
                {bn ? 'ক্রেতাদের অভিজ্ঞতা' : 'Customer Experience'}
              </span>
              <h2 className="section-title mt-5">
                {bn ? 'যাচাইকৃত গ্রাহকদের মতামত' : 'Genuine kitchen feedback'}
              </h2>

              {avgRating && (
                <div className="mt-9">
                  <div className="flex items-end gap-4">
                    <span className="font-display text-6xl leading-none tabular-nums text-[var(--c-gold-text)]">
                      {avgRating}
                    </span>
                    <div className="pb-1">
                      <div className="flex gap-0.5 text-[#D4AF37]">
                        {Array.from({ length: 5 }).map((_, idx) => (
                          <Star
                            key={idx}
                            className={`h-4 w-4 ${idx < Math.round(Number(avgRating)) ? 'fill-current' : 'opacity-30'}`}
                          />
                        ))}
                      </div>
                      <p className="mt-1 text-xs tabular-nums text-[var(--c-muted)]">
                        {bn
                          ? `${reviews.length}টি অনুমোদিত রিভিউ`
                          : `Based on ${reviews.length} approved ${reviews.length === 1 ? 'review' : 'reviews'}`}
                      </p>
                    </div>
                  </div>

                  <ul className="mt-6 space-y-2" aria-label={bn ? 'রেটিং বিন্যাস' : 'Rating breakdown'}>
                    {[5, 4, 3, 2, 1].map((star) => {
                      const count = reviews.filter((r) => r.rating === star).length;
                      const pct = reviews.length ? (count / reviews.length) * 100 : 0;
                      return (
                        <li key={star} className="flex items-center gap-3 text-xs text-[var(--c-muted)]">
                          <span className="w-3 tabular-nums">{star}</span>
                          <Star className="h-3 w-3 fill-current text-[#D4AF37]" />
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgb(var(--c-tint)/0.12)]">
                            <span
                              className="block h-full rounded-full bg-gradient-to-r from-[#B47B2B] to-[#D4AF37]"
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          <span className="w-4 text-right tabular-nums">{count}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="mt-9 flex flex-wrap items-center gap-3">
                {!showReviewForm && (
                  <button type="button" onClick={() => setShowReviewForm(true)} className="btn-ghost !min-h-[48px] !px-6">
                    <span>{bn ? 'রিভিউ লিখুন' : 'Write a review'}</span>
                  </button>
                )}
                {(canPrevReview || canNextReview) && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => scrollReviews(-1)}
                      disabled={!canPrevReview}
                      aria-label={bn ? 'আগের রিভিউ' : 'Previous reviews'}
                      className="flex h-12 w-12 items-center justify-center rounded-full border border-[rgb(var(--c-tint)/0.25)] text-[var(--c-ink)] transition-colors hover:border-[#B47B2B] hover:text-[var(--c-gold-text)] disabled:opacity-35 disabled:hover:border-[rgb(var(--c-tint)/0.25)] disabled:hover:text-[var(--c-ink)]"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollReviews(1)}
                      disabled={!canNextReview}
                      aria-label={bn ? 'পরের রিভিউ' : 'Next reviews'}
                      className="flex h-12 w-12 items-center justify-center rounded-full border border-[rgb(var(--c-tint)/0.25)] text-[var(--c-ink)] transition-colors hover:border-[#B47B2B] hover:text-[var(--c-gold-text)] disabled:opacity-35 disabled:hover:border-[rgb(var(--c-tint)/0.25)] disabled:hover:text-[var(--c-ink)]"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Reviews */}
            <div className="min-w-0 lg:col-span-8 lg:flex lg:items-center">
              {reviews.length === 0 ? (
                <div className="rounded-[2rem] border border-dashed border-[rgb(var(--c-tint)/0.25)] p-12 text-center">
                  <span aria-hidden="true" className="font-display text-6xl leading-none text-[var(--c-gold-text)] opacity-40">
                    “
                  </span>
                  <p className="mt-2 font-display text-2xl text-[var(--c-ink)]">
                    {bn ? 'আপনিই হতে পারেন প্রথম রিভিউদাতা' : 'Be the first to share'}
                  </p>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--c-muted)]">
                    {bn
                      ? 'আমরা কেবল প্রকৃত ক্রেতাদের অনুমোদিত রিভিউ প্রকাশ করি।'
                      : 'We publish only genuine customer feedback approved after moderation.'}
                  </p>
                </div>
              ) : (
                <div
                  ref={reviewTrackRef}
                  tabIndex={0}
                  aria-label={bn ? 'গ্রাহক রিভিউ স্লাইডার' : 'Customer reviews slider'}
                  className="-mx-5 flex w-full snap-x snap-mandatory items-stretch gap-5 overflow-x-auto scroll-smooth px-5 pb-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
                >
                  {reviews.map((rev) => (
                    <article
                      key={rev.id}
                      className="luxury-card flex min-h-[260px] w-[86%] shrink-0 snap-start flex-col rounded-[1.75rem] p-7 sm:w-[calc(50%-10px)] sm:p-8"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex gap-0.5 text-[#D4AF37]">
                          {Array.from({ length: 5 }).map((_, idx) => (
                            <Star
                              key={idx}
                              className={`h-4 w-4 ${idx < rev.rating ? 'fill-current' : 'opacity-25'}`}
                            />
                          ))}
                        </div>
                        <span aria-hidden="true" className="font-display text-6xl leading-[0.6] text-[var(--c-gold-text)] opacity-35">
                          “
                        </span>
                      </div>

                      <p
                        className={`mt-5 line-clamp-6 flex-1 font-display text-xl leading-[1.55] text-[var(--c-ink)] ${bn ? '' : 'italic'}`}
                      >
                        {rev.comment}
                      </p>

                      <div className="mt-6 flex items-center gap-3.5 border-t border-[rgb(var(--c-tint)/0.10)] pt-5">
                        {rev.photoData ? (
                          <button
                            type="button"
                            onClick={() =>
                              setLightbox({
                                src: rev.photoData,
                                alt: `Customer photo by ${rev.customerName}`,
                                name: rev.customerName,
                              })
                            }
                            aria-label={bn ? 'ছবি বড় করে দেখুন' : 'View photo full size'}
                            className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl border-2 sm:h-16 sm:w-16 border-[#B47B2B]/50"
                          >
                            <img
                              src={rev.photoData}
                              alt={`Customer photo by ${rev.customerName}`}
                              loading="lazy"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                            />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                              <Maximize2 className="h-4 w-4 text-white" />
                            </span>
                            <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white">
                              <Camera className="h-3 w-3" />
                            </span>
                          </button>
                        ) : (
                          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#B47B2B]/15 font-display text-xl sm:h-16 sm:w-16 text-[var(--c-gold-text)]">
                            {rev.customerName.trim().charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-semibold leading-tight text-[var(--c-ink)] sm:truncate">
                            {rev.customerName}
                          </p>
                          <p className="truncate text-xs text-[var(--c-muted)]">{rev.district}</p>
                          {rev.verifiedPurchase && (
                            <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--c-green-text)]">
                              <Check className="h-3 w-3" />
                              {bn ? 'যাচাইকৃত ক্রেতা' : 'Verified buyer'}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleHelpfulVote(rev)}
                          aria-label={bn ? 'সহায়ক' : 'Helpful'}
                          className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border border-[rgb(var(--c-tint)/0.15)] px-3 text-xs text-[var(--c-muted)] transition-colors hover:border-[#B47B2B] hover:text-[var(--c-ink)]"
                        >
                          <ThumbsUp className="h-3.5 w-3.5 text-[#B47B2B]" />
                          <span className="tabular-nums">{rev.helpfulCount}</span>
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Write a review */}
          <div className="mx-auto mt-12 max-w-3xl">

            {showReviewForm && (
              <form
                onSubmit={handleSubmitReview}
                className="luxury-card space-y-4 rounded-[2rem] p-7 text-left sm:p-9"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-display text-2xl text-[var(--c-ink)]">
                      {bn ? 'আপনার অভিজ্ঞতা লিখুন' : 'Share your experience'}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--c-muted)]">
                      {bn
                        ? 'আপনার প্রতিটি রিভিউ অন্যান্য ক্রেতাদের খাঁটি ঘি বেছে নিতে সাহায্য করবে।'
                        : 'Your genuine feedback guides fellow patrons across Bangladesh.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowReviewForm(false)}
                    aria-label={bn ? 'ফর্ম বন্ধ করুন' : 'Close form'}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--c-tint)/0.2)] text-[var(--c-muted)] hover:text-[var(--c-ink)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="block text-xs font-semibold text-[var(--c-muted)]">
                      {bn ? 'নাম *' : 'Your Name *'}
                    </span>
                    <input
                      type="text"
                      required
                      value={revName}
                      onChange={(e) => setRevName(e.target.value)}
                      autoComplete="name"
                      className="mt-1.5 w-full rounded-xl border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-bg)] px-4 py-3 text-base text-[var(--c-ink)] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-[var(--c-muted)]">
                      {bn ? 'জেলা / এলাকা *' : 'District / Area *'}
                    </span>
                    <input
                      type="text"
                      required
                      value={revDistrict}
                      onChange={(e) => setRevDistrict(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-bg)] px-4 py-3 text-base text-[var(--c-ink)] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-[var(--c-muted)]">
                      {bn ? 'রেটিং' : 'Rating'}
                    </span>
                    <select
                      value={revRating}
                      onChange={(e) => setRevRating(Number(e.target.value))}
                      className="mt-1.5 w-full rounded-xl border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-bg)] px-4 py-3 text-base text-[var(--c-ink)] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                    >
                      <option value={5}>{bn ? '৫ / ৫ — অসাধারণ' : '5 / 5 — Excellent'}</option>
                      <option value={4}>{bn ? '৪ / ৫ — খুব ভালো' : '4 / 5 — Very Good'}</option>
                      <option value={3}>{bn ? '৩ / ৫ — ভালো' : '3 / 5 — Good'}</option>
                      <option value={2}>{bn ? '২ / ৫ — মোটামুটি' : '2 / 5 — Fair'}</option>
                      <option value={1}>{bn ? '১ / ৫ — উন্নতি প্রয়োজন' : '1 / 5 — Needs Work'}</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-[var(--c-muted)]">
                      {bn ? 'অর্ডার আইডি (ঐচ্ছিক)' : 'Order ID (Optional)'}
                    </span>
                    <input
                      type="text"
                      value={revOrderNum}
                      onChange={(e) => setRevOrderNum(e.target.value.toUpperCase())}
                      placeholder={bn ? 'আপনার অর্ডার নম্বর' : 'Your Order ID'}
                      className="mt-1.5 w-full rounded-xl border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-bg)] px-4 py-3 font-mono text-base text-[var(--c-ink)] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--c-muted)]">
                    {bn ? 'মন্তব্য *' : 'Your Review *'}
                  </span>
                  <textarea
                    rows={4}
                    required
                    value={revComment}
                    onChange={(e) => setRevComment(e.target.value)}
                    placeholder={bn ? 'ঘিয়ের ঘ্রাণ, স্বাদ ও অভিজ্ঞতা বর্ণনা করুন...' : 'Describe aroma, taste, and experience...'}
                    className="mt-1.5 w-full rounded-xl border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-bg)] px-4 py-3 text-base text-[var(--c-ink)] focus:border-[#B47B2B] focus:outline-none sm:text-sm"
                  />
                </label>

                <label className="flex min-h-[50px] cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[rgb(var(--c-tint)/0.28)] px-4 py-2 text-xs text-[var(--c-muted)] transition-colors hover:border-[#B47B2B]">
                  <Upload className="h-4 w-4 text-[var(--c-gold-text)]" />
                  <span>
                    {revPhotoData
                      ? bn
                        ? 'ছবি সংযুক্ত হয়েছে ✓'
                        : 'Photo attached ✓'
                      : bn
                        ? 'জারের ছবি যুক্ত করুন (ঐচ্ছিক)'
                        : 'Attach jar photo (Optional)'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleReviewPhotoUpload}
                    className="hidden"
                  />
                </label>

                {revStatusMsg && (
                  <p role="status" className="text-xs font-semibold text-[var(--c-gold-text)]">
                    {revStatusMsg}
                  </p>
                )}

                <button type="submit" disabled={revSubmitting} className="btn-gold w-full disabled:opacity-60">
                  {revSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{bn ? 'রিভিউ জমা দিন' : 'Submit Review'}</span>
                </button>
              </form>
            )}
          </div>
        </section>

        {/* Review photo lightbox */}
        {lightbox && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={bn ? 'গ্রাহকের ছবি' : 'Customer photo'}
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          >
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label={bn ? 'বন্ধ করুন' : 'Close'}
              className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-black/50 text-white transition-colors hover:bg-black/70"
            >
              <X className="h-5 w-5" />
            </button>
            <figure onClick={(e) => e.stopPropagation()} className="max-h-full max-w-3xl">
              <img
                src={lightbox.src}
                alt={lightbox.alt}
                className="max-h-[80dvh] w-auto max-w-full rounded-2xl object-contain shadow-2xl"
              />
              <figcaption className="mt-3 text-center text-sm text-white/80">{lightbox.name}</figcaption>
            </figure>
          </div>
        )}

        {/* SECTION 10: BILINGUAL 12-QUESTION FAQ ACCORDION */}
        <section
          id="faq"
          className="scroll-mt-16 sm:scroll-mt-20 border-t border-[rgb(var(--c-tint)/0.08)] bg-[var(--c-band)]/40 py-16 lg:py-24"
        >
          <div className="mx-auto max-w-4xl px-4 sm:px-8">
            <div className="text-center">
              <span className="eyebrow is-centered">
                {bn ? 'সাধারণ জিজ্ঞাসা' : 'Frequently Asked Questions'}
              </span>
              <h2 className="section-title mt-4">
                {bn ? 'দেশী ঘি সম্পর্কে প্রশ্নোত্তর' : 'Everything about Deshi Gee'}
              </h2>
            </div>

            <div className="mt-10 space-y-3">
              {(cms && visibleFaqs(cms.faqs).length > 0
                ? visibleFaqs(cms.faqs).map((f) => ({
                    qEn: f.qEn || f.qBn,
                    qBn: f.qBn || f.qEn,
                    aEn: f.aEn || f.aBn,
                    aBn: f.aBn || f.aEn,
                  }))
                : FAQ_ITEMS
              ).map((item, idx) => {
                const isOpen = openFaqIdx === idx;
                return (
                  <div
                    key={idx}
                    className="overflow-hidden rounded-2xl border border-[rgb(var(--c-tint)/0.10)] bg-[var(--c-card)] transition-all"
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                      className="flex min-h-[52px] w-full items-center justify-between gap-4 p-5 text-left font-medium"
                    >
                      <span className="text-sm font-bold text-[var(--c-ink)] sm:text-base">
                        {idx + 1}. {bn ? item.qBn : item.qEn}
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-[var(--c-gold-text)] transition-transform duration-200 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <div className="border-t border-[rgb(var(--c-tint)/0.06)] px-5 pb-5 pt-3">
                        <p className="text-sm leading-relaxed text-[var(--c-muted)]">
                          {bn ? item.aBn : item.aEn}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* SECTION 11: NEWSLETTER & HARVEST UPDATES */}
        <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-8 sm:py-20">
          <span className="eyebrow is-centered">
            {bn ? 'নতুন ব্যাচের খবর' : 'Harvest Notifications'}
          </span>
          <h2 className="section-title mt-4">
            {bn ? 'পাবনা থেকে তাজা ব্যাচের খবর সবার আগে' : 'Fresh Harvest Alerts'}
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--c-muted)]">
            {bn
              ? 'নতুন ব্যাচের ঘি প্রস্তুত হলে ইমেইলে নোটিফিকেশন পান। কোনো স্প্যাম পাঠানো হবে না।'
              : 'Direct alerts when a fresh morning-churn batch leaves Pabna.'}
          </p>

          <form
            onSubmit={handleNewsletterSubmit}
            className="mx-auto mt-7 flex max-w-md flex-col gap-3 sm:flex-row"
          >
            <input
              type="email"
              value={newsEmail}
              onChange={(e) => setNewsEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              aria-label="Email address for batch updates"
              className="min-h-[48px] flex-1 rounded-xl border border-[rgb(var(--c-tint)/0.18)] bg-[var(--c-card)] px-4 text-base text-[var(--c-ink)] shadow-xs focus:border-[#B47B2B] focus:outline-none sm:text-sm"
            />
            <button
              type="submit"
              disabled={newsSubmitting}
              className="min-h-[48px] rounded-xl bg-[var(--c-accent)] px-7 text-sm font-semibold text-[var(--c-on-accent)] hover:bg-[var(--c-accent-hover)] disabled:opacity-60 transition-colors shadow-xs"
            >
              {newsSubmitting ? '...' : bn ? 'যুক্ত হোন' : 'Subscribe'}
            </button>
          </form>
          {newsFeedback && (
            <p
              className={`mt-3 text-xs font-semibold ${
                newsFeedback.type === 'ok' ? 'text-[var(--c-green-text)]' : 'text-red-700'
              }`}
            >
              {newsFeedback.msg}
            </p>
          )}
        </section>
      </main>

      {/* UNIFIED MOBILE BOTTOM BAR (AI ASSISTANT + WEIGHT/PRICE + BUY NOW) */}
      {!drawerOpen && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-[rgb(var(--c-tint)/0.12)] bg-[var(--c-bg)]/95 px-3 py-2 backdrop-blur-md pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden shadow-[0_-8px_24px_rgba(30,23,16,0.08)]">
          <div className="flex items-center justify-between gap-2.5">
            {chatbotConfig.enabled && (
              <button
                type="button"
                onClick={openChatAssistant}
                aria-label={bn ? 'দেশী ঘি এআই সহকারী খুলুন' : 'Open Deshi Gee AI Assistant'}
                className="relative inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl bg-[var(--c-accent)] px-3 text-xs font-semibold text-[var(--c-on-accent)] shadow-xs active:scale-95 transition-transform"
              >
                <span className="relative flex h-4 w-4 items-center justify-center">
                  <MessageSquareText className="h-4 w-4 text-[#F5D692]" />
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-[#1A120B] bg-emerald-400" />
                </span>
                <span className="whitespace-nowrap">{bn ? 'সহকারী' : 'Ask AI'}</span>
              </button>
            )}

            <div className="min-w-0 flex-1 text-center">
              {orderingReady && activePrice > 0 ? (
                <div className="flex items-baseline justify-center gap-1">
                  <span className="font-mono text-sm font-bold tabular-nums text-[var(--c-ink)]">
                    {formatBdt(activePrice)}
                  </span>
                  <span className="text-[11px] font-bold text-[var(--c-gold-text)]">
                    ({bn ? selectedVariantMeta.labelBn : selectedWeight})
                  </span>
                </div>
              ) : (
                <p className="truncate text-xs font-semibold text-[var(--c-ink)]">
                  {bn ? 'অর্ডার চালু হয়নি' : 'Ordering unavailable'}
                </p>
              )}
              <p className="truncate text-[10px] text-[var(--c-muted)]">
                {bn ? 'পাবনার বিলোনা ঘি' : 'Pabna Bilona Ghee'}
              </p>
            </div>

            {orderingReady ? (
              <button
                type="button"
                disabled={isOutOfStock}
                onClick={() => handleAddToCart(true)}
                className="min-h-[44px] shrink-0 rounded-xl bg-gradient-to-r from-[#B47B2B] to-[#96621B] px-4 text-xs font-bold text-[var(--c-on-gold)] shadow-sm disabled:opacity-45 whitespace-nowrap active:scale-95 transition-transform"
              >
                {isOutOfStock
                  ? bn
                    ? 'স্টক শেষ'
                    : 'Out of Stock'
                  : bn
                    ? 'অর্ডার করুন'
                    : 'Buy Now'}
              </button>
            ) : (
              <button
                type="button"
                onClick={openCallbackRequest}
                className="min-h-[44px] shrink-0 rounded-xl border border-[rgb(var(--c-tint)/0.3)]/20 bg-[var(--c-surface)] px-3.5 text-xs font-semibold text-[var(--c-ink)] whitespace-nowrap"
              >
                {bn ? 'কলব্যাক' : 'Callback'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
