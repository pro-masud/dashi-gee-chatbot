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
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  FileCheck2,
  Leaf,
  Loader2,
  MessageCircle,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  ThumbsUp,
  Truck,
  Upload,
} from 'lucide-react';
import { initHeroCanvas } from '../webgl/heroCanvas';
import { initSpecsCanvas } from '../webgl/specsCanvas';
import {
  ReviewRecord,
  WeightKey,
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
} from '../data/deshiGeeData';
import { trackStoreEvent } from '../lib/analytics';
import { ResilientImage } from './ResilientImage';
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
  } = useStorefront();

  const [selectedWeight, setSelectedWeight] = useState<WeightKey>('500g');
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

  const [showMobileSticky, setShowMobileSticky] = useState<boolean>(false);

  // Wireframe Jar Seal Canvas
  useEffect(() => {
    if (!showBlueprint) return;
    const cleanup = initSpecsCanvas(specsCanvasRef.current);
    return () => cleanup();
  }, [showBlueprint]);

  // Show mobile sticky CTA bar only after scrolling past the top hero
  useEffect(() => {
    const onScrollSticky = () => {
      setShowMobileSticky(window.scrollY > 340);
    };
    window.addEventListener('scroll', onScrollSticky, { passive: true });
    onScrollSticky();
    return () => window.removeEventListener('scroll', onScrollSticky);
  }, []);

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

  const getPriceForWeight = useCallback(
    (w: WeightKey): number => {
      if (w === '250g') return settings.price250g;
      if (w === '500g') return settings.price500g;
      return settings.price1kg;
    },
    [settings]
  );

  const getStockForWeight = useCallback(
    (w: WeightKey): number => {
      if (w === '250g') return settings.stock250g;
      if (w === '500g') return settings.stock500g;
      return settings.stock1kg;
    },
    [settings]
  );

  const selectedVariantMeta = useMemo(
    () => WEIGHT_VARIANTS.find((v) => v.key === selectedWeight) ?? WEIGHT_VARIANTS[1],
    [selectedWeight]
  );

  const activePrice = getPriceForWeight(selectedWeight);
  const activeStock = getStockForWeight(selectedWeight);
  const isOutOfStock = activeStock <= 0;

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

  const whatsappDigits = settings.whatsappNumber.replace(/[^0-9]/g, '');
  const whatsappChatHref = whatsappDigits
    ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(
        bn
          ? 'আসসালামু আলাইকুম, দেশী ঘি সম্পর্কে জানতে চাই।'
          : 'Assalamu Alaikum, I would like to inquire about Deshi Gee.'
      )}`
    : `https://wa.me/?text=${encodeURIComponent('Hello Deshi Gee')}`;

  return (
    <>
      <main className="pb-20 md:pb-0">
        {/* SECTION 01: LUXURY EDITORIAL HERO */}
        <section className="relative overflow-hidden border-b border-[rgba(30,23,16,0.08)] bg-gradient-to-b from-[#FAF7F2] via-[#FAF7F2] to-[#F5EFE6]">
          {/* Subtle Ambient Radial Glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/4 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-[#D4AF37]/10 via-[#B47B2B]/5 to-transparent blur-3xl lg:h-[700px] lg:w-[700px]"
          />

          <canvas
            ref={heroCanvasRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
          />

          <div className="relative z-10 mx-auto grid max-w-[1320px] grid-cols-1 items-center gap-10 px-4 py-10 sm:px-8 sm:py-14 lg:min-h-[calc(100dvh-80px)] lg:grid-cols-12 lg:gap-14 lg:py-16">
            <div className="lg:col-span-7">
              {/* Provenance Badge */}
              <div className="inline-flex items-center gap-2 rounded-full border border-[#B47B2B]/25 bg-[#FAF7F2]/80 px-3.5 py-1.5 backdrop-blur-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-[#B47B2B] animate-pulse" />
                <span className="font-mono text-[11px] font-semibold uppercase tracking-widest text-[#8A5A17]">
                  {settings.originLocation} · {bn ? 'একক ঐতিহ্যবাহী ঘি' : 'Single-Origin Bilona'}
                </span>
              </div>

              {/* Grand Headline with Serif Display & Gold Accent */}
              <h1 className="font-display mt-4 text-3xl font-semibold leading-[1.12] tracking-tight text-[#1E1710] sm:mt-5 sm:text-5xl lg:text-[3.85rem]">
                {bn ? (
                  <>
                    পাবনার চারণভূমির কাঁচা দুধে{' '}
                    <span className="gold-gradient-text italic font-normal">পাতাদইয়ের কাঠের বিলোনা</span> ঘি
                  </>
                ) : (
                  <>
                    Single-Origin Pabna Cow Ghee.{' '}
                    <span className="gold-gradient-text italic font-normal">Pure Bilona Craft.</span>
                  </>
                )}
              </h1>

              {/* Subtitle */}
              <p className="mt-4 max-w-[50ch] text-base leading-relaxed text-[#635647] sm:mt-6 sm:text-lg">
                {bn
                  ? 'কোনো ক্রিম নয়—সকালের সংগৃহীত দেশী গরুর সম্পূর্ণ দুধে পাতা দই কাঠের বিলোনায় মন্থন করে মাটির মৃদু আঁচে তৈরি খাঁটি সোনালী দানাদার গাওয়া ঘি।'
                  : 'Cultured exclusively from whole pasture cow milk curd, slow-churned at dawn with a wooden bilona, and preserved warm in sealed apothecary glass.'}
              </p>

              {/* Three Pillars Micro-Chips */}
              <div className="mt-5 flex flex-wrap gap-2 sm:gap-2.5 text-xs text-[#1E1710]">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(30,23,16,0.12)] bg-[#FAF7F2] px-3 py-1 font-medium">
                  <Sparkles className="h-3 w-3 text-[#B47B2B]" />
                  {bn ? '১০০% দই মন্থিত বাটার' : 'Whole Curd Butterfat'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(30,23,16,0.12)] bg-[#FAF7F2] px-3 py-1 font-medium">
                  <Leaf className="h-3 w-3 text-[#2D6A4F]" />
                  {bn ? 'কোনো রাসায়নিক বা প্রিজারভেটিভ নেই' : 'Zero Additives'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(30,23,16,0.12)] bg-[#FAF7F2] px-3 py-1 font-medium">
                  <ShieldCheck className="h-3 w-3 text-[#B47B2B]" />
                  {bn ? 'কাঁচের এয়ারটাইট বয়াম' : 'Apothecary Glass Jar'}
                </span>
              </div>

              {/* Primary Call to Action */}
              <div className="mt-7 flex flex-col gap-3 sm:mt-9 sm:flex-row sm:items-center sm:gap-4">
                <a
                  href="#order"
                  className="group relative inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#B47B2B] via-[#C98A2C] to-[#96621B] px-8 py-3.5 text-sm font-semibold text-[#FFFDF9] shadow-[0_10px_25px_-5px_rgba(180,123,43,0.35)] transition-all hover:scale-[1.02] hover:shadow-[0_15px_30px_-5px_rgba(180,123,43,0.45)] sm:w-auto whitespace-nowrap"
                >
                  <ShoppingBag className="h-4 w-4" />
                  <span>{bn ? 'এখনই অর্ডার করুন' : 'Order Fresh Batch'}</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>

                <a
                  href="#craft"
                  className="inline-flex min-h-[50px] w-full items-center justify-center rounded-xl border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-7 py-3.5 text-sm font-semibold text-[#1E1710] hover:bg-[#F2ECE1] transition-all sm:w-auto whitespace-nowrap"
                >
                  {bn ? 'তৈরির চার ধাপ দেখুন' : 'Explore The Craft'}
                </a>
              </div>

              {/* Micro Trust Strip Beneath Hero CTA */}
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[rgba(30,23,16,0.08)] pt-4 text-xs text-[#635647]">
                <span className="flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5 text-[#B47B2B]" />
                  {bn ? 'সারাদেশে ক্যাশ অন ডেলিভারি' : 'Cash on Delivery Nationwide'}
                </span>
                <span className="flex items-center gap-1.5">
                  <Award className="h-3.5 w-3.5 text-[#B47B2B]" />
                  {bn ? 'ল্যাব টেস্ট ভেরিফাইড' : 'Lab Tested Authenticity'}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-[#B47B2B]" />
                  {bn ? '২৪ ঘণ্টার ভেতর রিপ্লেসমেন্ট' : '24h Replacement Guarantee'}
                </span>
              </div>
            </div>

            {/* Right Jar Showcase Stage with Interactive 3D Perspective */}
            <div
              ref={heroStageRef}
              className="hero-perspective flex justify-center lg:col-span-5"
            >
              <div
                ref={tiltWrapRef}
                className="jar-tilt-wrap relative w-full max-w-[460px]"
              >
                {/* Backlight Ambient Glow */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-4 rounded-3xl bg-gradient-to-tr from-[#D4AF37]/20 via-[#B47B2B]/15 to-transparent blur-2xl"
                />

                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl border border-[rgba(180,123,43,0.25)] bg-[#F2ECE1] shadow-[0_30px_70px_-15px_rgba(30,23,16,0.18)] sm:aspect-[3/4]">
                  <ResilientImage
                    src={IMAGES.heroFront}
                    alt={
                      bn
                        ? 'পাবনার খাঁটি দানাদার দেশী গরুর ঘিয়ের কাঁচের জার'
                        : 'Sealed glass apothecary jar of golden granular Pabna Deshi Cow Ghee'
                    }
                    fallbackTitle="Deshi Gee"
                    className="h-full w-full object-cover"
                  />

                  {/* Floating Batch Wax Stamp Badge */}
                  <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full border border-[#D4AF37]/60 bg-[#1A120B]/90 px-3 py-1 font-mono text-[11px] font-semibold text-[#F5D692] backdrop-blur-md shadow-md">
                    <span className="h-2 w-2 rounded-full bg-[#2D6A4F]" />
                    <span>{activeBatch.batchCode}</span>
                  </div>

                  {/* Gradient Overlay at Bottom */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#140E08]/90 via-[#140E08]/40 to-transparent px-5 pb-5 pt-16 text-[#FAF7F2] sm:px-6 sm:pb-6">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-[#E5B25D]">
                      {bn ? 'পাবনা গাওয়া ঘি' : 'Pabna Artisanal Ghee'}
                    </p>
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-display text-lg font-semibold sm:text-xl">
                        {bn ? settings.productNameBn : settings.productNameEn}
                      </p>
                      <p className="font-mono text-sm font-semibold tabular-nums text-[#F5D692]">
                        {formatBdt(settings.price250g)} – {formatBdt(settings.price1kg)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 02: SINGLE-PRODUCT PURCHASE MODULE & WEIGHT CONFIGURATOR */}
        <section
          id="order"
          className="scroll-mt-16 sm:scroll-mt-20 mx-auto max-w-[1320px] px-4 py-14 sm:px-8 sm:py-20 lg:py-24"
        >
          {/* Section Subtitle */}
          <div className="mb-10 text-center max-w-2xl mx-auto">
            <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#8A5A17]">
              {bn ? 'খাঁটি একক ঐতিহ্য' : 'Authentic Single Product'}
            </span>
            <h2 className="font-display mt-2 text-3xl font-semibold tracking-tight text-[#1E1710] sm:text-4xl">
              {bn ? 'পছন্দের বয়াম ও পরিমাণ বেছে নিন' : 'Select Packaging Size & Reserve'}
            </h2>
            <p className="mt-2 text-sm text-[#635647]">
              {bn
                ? 'কাঁচের এয়ারটাইট বয়ামে সংরক্ষিত পাবনার খাঁটি কাঠের বিলোনা ঘি'
                : 'Sealed warm in apothecary glass jars for maximum aroma preservation'}
            </p>
          </div>

          <div className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-12 lg:gap-14">
            {/* Left Gallery & Proportion Preview */}
            <div className="flex flex-col gap-4 lg:col-span-6">
              <div
                ref={galleryPreviewRef}
                className="scroll-mt-20 relative flex min-h-[340px] flex-1 flex-col justify-between overflow-hidden rounded-3xl border border-[rgba(30,23,16,0.12)] bg-[#F2ECE1] p-5 sm:min-h-[500px] shadow-[0_12px_36px_-10px_rgba(30,23,16,0.08)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="block font-mono text-[11px] uppercase tracking-wider text-[#635647] tabular-nums sm:text-xs">
                      {bn ? selectedVariantMeta.labelBn : selectedVariantMeta.labelEn} ·{' '}
                      {bn
                        ? selectedVariantMeta.jarHeightNoteBn
                        : selectedVariantMeta.jarHeightNoteEn}
                    </span>
                    <span className="mt-0.5 block text-xs font-semibold text-[#8A5A17]">
                      {showBlueprint
                        ? bn
                          ? 'সিল ডায়াগ্রাম (৩ডি ওয়্যারফ্রেম)'
                          : 'Airtight Brass Seal Diagram'
                        : bn
                          ? activeGallery.labelBn
                          : activeGallery.labelEn}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowBlueprint((v) => !v)}
                    className="min-h-[38px] cursor-pointer rounded-full border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-3.5 py-1.5 text-xs font-medium text-[#1E1710] hover:bg-[#EAE1D2] hover:border-[#B47B2B] transition-colors whitespace-nowrap shrink-0 shadow-xs"
                  >
                    {showBlueprint
                      ? bn
                        ? '📷 জারের আসল ছবি'
                        : '📷 Jar Photograph'
                      : bn
                        ? '🔍 সিল ডায়াগ্রাম (3D)'
                        : '🔍 Brass Seal (3D)'}
                  </button>
                </div>

                <div className="my-4 flex flex-1 items-center justify-center overflow-hidden p-2 sm:p-4">
                  {showBlueprint ? (
                    <div className="h-64 w-full sm:h-80">
                      <canvas
                        ref={specsCanvasRef}
                        aria-label="Apothecary jar brass aroma seal wireframe"
                        className="h-full w-full"
                      />
                    </div>
                  ) : (
                    <div
                      className="aspect-[4/3] w-full max-w-[440px] overflow-hidden rounded-2xl border border-[rgba(30,23,16,0.10)] bg-[#FAF7F2] shadow-sm transition-transform duration-300 ease-out"
                      style={{ transform: `scale(${selectedVariantMeta.scale})` }}
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
                </div>

                <p className="text-xs text-[#635647]">
                  {showBlueprint
                    ? bn
                      ? 'ডাবল-গ্যাস্কেট পিতলের ঢাকনা ও মোটা কাঁচের বয়াম আর্দ্রতা থেকে সুরক্ষা দেয়।'
                      : 'Heavy apothecary clear glass with airtight brass collar protects natural aroma.'
                    : bn
                      ? activeGallery.altBn
                      : activeGallery.altEn}
                </p>
              </div>

              {/* 4-Angle Thumbnail Gallery */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {PRODUCT_GALLERY.map((item, idx) => {
                  const active = idx === galleryIdx && !showBlueprint;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setShowBlueprint(false);
                        setGalleryIdx(idx);
                        galleryPreviewRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'nearest',
                        });
                      }}
                      className={`group cursor-pointer touch-manipulation select-none overflow-hidden rounded-xl border text-left transition-all ${
                        active
                          ? 'border-[#B47B2B] ring-2 ring-[#B47B2B]/40 shadow-md opacity-100'
                          : 'border-[rgba(30,23,16,0.12)] opacity-80 hover:border-[rgba(30,23,16,0.3)] hover:opacity-100'
                      }`}
                    >
                      <div className="aspect-[4/3] w-full bg-[#EAE1D2]">
                        <ResilientImage
                          src={item.src}
                          alt={bn ? item.altBn : item.altEn}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                        />
                      </div>
                      <span
                        className={`flex items-center justify-between gap-1 px-2.5 py-2 text-xs font-medium transition-colors ${
                          active
                            ? 'bg-[#B47B2B] text-[#FFFDF9]'
                            : 'bg-[#FAF7F2] text-[#1E1710]'
                        }`}
                      >
                        <span className="truncate">{bn ? item.labelBn : item.labelEn}</span>
                        {active && <Check className="h-3 w-3 shrink-0" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Contiguous Purchase Panel */}
            <div className="flex flex-col justify-center lg:col-span-6">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-[#2D6A4F]/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#2D6A4F]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#2D6A4F]" />
                  {isOutOfStock
                    ? bn
                      ? 'স্টক সমাপ্ত'
                      : 'Out of Stock'
                    : bn
                      ? `স্টকে আছে (${activeStock}টি জার)`
                      : `In Stock (${activeStock} jars)`}
                </span>
                <span className="text-xs text-[#8A5A17]">· {activeBatch.batchCode}</span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-display text-2xl font-bold tracking-tight text-[#1E1710] sm:text-4xl">
                  {bn ? settings.productNameBn : settings.productNameEn}
                </h2>
                <span className="font-mono text-2xl font-bold tabular-nums text-[#8A5A17] sm:text-3xl">
                  {formatBdt(activePrice)}
                </span>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-[#635647] sm:text-base">
                {bn
                  ? 'সকালের সংগৃহীত দেশী গরুর দুধ দিয়ে মাটির হাঁড়িতে পাতা দই, কাঠের বিলোনার মন্থন এবং মৃদু আঁচে তৈরি খাঁটি সোনালী দানাদার ঘি।'
                  : 'Prepared strictly in small batches from grass-fed Pabna cow milk curd, wood-churned at dawn, and slow-simmered for nutty golden aroma.'}
              </p>

              {/* Redesigned Weight Selector Cards with "Most Popular" Badge */}
              <div className="mt-6 sm:mt-7">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium uppercase tracking-wider text-[#635647]">
                    {bn ? 'ওজন নির্বাচন করুন' : 'Select Packaging Weight'}
                  </span>
                  <span className="text-[11px] text-[#8A5A17]">
                    {bn ? 'কাঁচের এয়ারটাইট বয়াম' : 'Heavy Glass Sealed'}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2.5 sm:gap-3">
                  {WEIGHT_VARIANTS.map((v) => {
                    const active = v.key === selectedWeight;
                    const price = getPriceForWeight(v.key);
                    const stock = getStockForWeight(v.key);
                    const isPopular = v.key === '500g';
                    const isBestValue = v.key === '1kg';
                    return (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => setSelectedWeight(v.key)}
                        className={`relative flex min-h-[72px] flex-col items-start justify-center rounded-2xl border p-3 text-left transition-all ${
                          active
                            ? 'border-[#B47B2B] bg-[#FFFDF9] ring-2 ring-[#B47B2B]/35 shadow-sm'
                            : 'border-[rgba(30,23,16,0.14)] bg-[#FAF7F2] text-[#635647] hover:border-[rgba(30,23,16,0.28)] hover:text-[#1E1710]'
                        }`}
                      >
                        {isPopular && (
                          <span className="absolute -top-2.5 right-2 rounded-full bg-gradient-to-r from-[#B47B2B] to-[#D4AF37] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#FFFDF9] shadow-xs">
                            {bn ? 'জনপ্রিয়' : 'Popular'}
                          </span>
                        )}
                        {isBestValue && (
                          <span className="absolute -top-2.5 right-2 rounded-full bg-[#1A120B] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#F5D692] shadow-xs">
                            {bn ? 'সাশ্রয়ী' : 'Value'}
                          </span>
                        )}
                        <span className="font-mono text-sm font-bold text-[#1E1710]">
                          {bn ? v.labelBn : v.labelEn}
                        </span>
                        <span className="mt-1 font-mono text-xs font-semibold tabular-nums text-[#8A5A17]">
                          {stock <= 0
                            ? bn
                              ? 'স্টক শেষ'
                              : 'Out'
                            : formatBdt(price)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quantity Stepper + Add to Bag + Buy Now */}
              <div className="mt-6 grid grid-cols-[auto_1fr] gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
                <div className="inline-flex min-h-[50px] items-center rounded-xl border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] shadow-xs">
                  <button
                    type="button"
                    disabled={isOutOfStock || purchaseQty <= 1}
                    onClick={() => setPurchaseQty((q) => Math.max(1, q - 1))}
                    aria-label="Decrease quantity"
                    className="flex h-12 w-11 items-center justify-center text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-10 text-center font-mono text-sm font-bold tabular-nums">
                    {purchaseQty}
                  </span>
                  <button
                    type="button"
                    disabled={isOutOfStock || purchaseQty >= activeStock}
                    onClick={() =>
                      setPurchaseQty((q) =>
                        activeStock > 0 ? Math.min(activeStock, q + 1) : 1
                      )
                    }
                    aria-label="Increase quantity"
                    className="flex h-12 w-11 items-center justify-center text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                <button
                  type="button"
                  disabled={isOutOfStock}
                  onClick={() => handleAddToCart(false)}
                  className="inline-flex min-h-[50px] flex-1 items-center justify-center gap-2 rounded-xl border border-[#1E1710] bg-[#FAF7F2] px-5 py-3 text-sm font-semibold text-[#1E1710] hover:bg-[#F2ECE1] disabled:opacity-45 transition-colors whitespace-nowrap shadow-xs"
                >
                  {justAdded ? (
                    <>
                      <Check className="h-4 w-4 text-[#8A5A17]" />
                      <span>{bn ? 'ব্যাগে যোগ হয়েছে ✓' : 'Added to Bag ✓'}</span>
                    </>
                  ) : (
                    <>
                      <ShoppingBag className="h-4 w-4" />
                      <span>{bn ? 'ব্যাগে যোগ করুন' : 'Add to Bag'}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={isOutOfStock}
                  onClick={() => handleAddToCart(true)}
                  className="col-span-2 inline-flex min-h-[50px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#B47B2B] to-[#96621B] px-6 py-3 text-sm font-semibold text-[#FFFDF9] hover:shadow-[0_8px_20px_rgba(180,123,43,0.35)] disabled:opacity-45 sm:col-span-1 sm:flex-1 transition-all whitespace-nowrap"
                >
                  <span>{bn ? 'অর্ডার করুন · ' : 'Buy Now · '}</span>
                  <span className="font-mono tabular-nums font-bold">
                    {formatBdt(activePrice * purchaseQty)}
                  </span>
                </button>
              </div>

              {/* Delivery ETA Reassurance Box */}
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-[rgba(30,23,16,0.08)] bg-[#F4EFE6]/60 px-4 py-2.5 text-xs text-[#635647]">
                <Truck className="h-4 w-4 text-[#B47B2B] shrink-0" />
                <span>
                  {bn
                    ? 'ঢাকার ভেতরে ৪৮ ঘণ্টা ও বাইরে ৩-৫ দিনে ক্যাশ অন ডেলিভারি।'
                    : '48h delivery inside Dhaka; 3-5 days nationwide. Cash on Delivery.'}
                </span>
              </div>

              {/* Product Transparency Specification Table */}
              <dl className="mt-7 divide-y divide-[rgba(30,23,16,0.08)] border-y border-[rgba(30,23,16,0.08)] text-sm">
                <div className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="shrink-0 text-[#635647]">
                    {bn ? 'উপাদান' : 'Ingredients'}
                  </dt>
                  <dd className="text-right font-medium text-[#1E1710]">
                    {bn
                      ? '১০০% খাঁটি গরুর দুধের ফ্যাট (একক উপাদান)'
                      : '100% Pure Cultured Cow Milkfat'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="shrink-0 text-[#635647]">
                    {bn ? 'সুবাস ও স্বাদ' : 'Aroma & Tasting Notes'}
                  </dt>
                  <dd className="text-right font-medium text-[#1E1710]">
                    {bn
                      ? 'হালকা ভাজা বাদাম ও মিষ্টি ক্যারামেল সুবাস'
                      : 'Warm toasted hazelnut, caramelized butter'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="shrink-0 text-[#635647]">
                    {bn ? 'সংরক্ষণ ও মেয়াদ' : 'Shelf Life & Storage'}
                  </dt>
                  <dd className="text-right font-medium text-[#1E1710]">
                    {bn
                      ? '১২ মাস · শুকনো ও ঠান্ডা স্থানে রাখুন'
                      : '12 Months · Tightly sealed in cool dry pantry'}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="shrink-0 text-[#635647]">
                    {bn ? 'উৎপাদন তথ্য' : 'Production Origin'}
                  </dt>
                  <dd className="text-right font-medium text-[#1E1710]">
                    {settings.originLocation}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* SECTION 03: FOUR PILLARS OF PURITY & BATCH PASSPORT */}
        <section className="border-y border-[rgba(30,23,16,0.08)] bg-[#F4EFE6]/60 py-16 lg:py-20">
          <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
            <div className="max-w-2xl">
              <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#8A5A17]">
                {bn ? 'স্বচ্ছতা ও নিশ্চয়তা' : 'Authenticity & Standards'}
              </span>
              <h2 className="font-display mt-2 text-3xl font-bold tracking-tight text-[#1E1710]">
                {bn
                  ? 'উৎস থেকে কাঁচের বয়াম—পূর্ণ নিশ্চয়তা'
                  : 'Documented provenance from pasture to glass'}
              </h2>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="luxury-card rounded-2xl p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#B47B2B]/10 text-[#8A5A17]">
                  <Leaf className="h-5 w-5" />
                </div>
                <p className="mt-4 font-mono text-xs font-semibold uppercase tracking-wider text-[#8A5A17]">
                  {bn ? 'দুধের উৎস ও উপাদান' : 'Milk Sourcing & Curd'}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#635647]">
                  {bn
                    ? 'পাবনার চারণভূমির সুস্থ গাভীর সকালের সংগৃহীত দুধ। কাঁচা দুধে পাতা দইয়ের কাঠের বিলোনা মন্থন। কোনো পাম অয়েল বা প্রিজারভেটিভ নেই।'
                    : 'Whole morning milk sourced directly from Pabna pasture households. Single ingredient only: pure cow milkfat.'}
                </p>
              </div>

              <div className="luxury-card rounded-2xl p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#B47B2B]/10 text-[#8A5A17]">
                  <Award className="h-5 w-5" />
                </div>
                <p className="mt-4 font-mono text-xs font-semibold uppercase tracking-wider text-[#8A5A17]">
                  {bn ? 'ব্যাচ ও মেয়াদ পাসপোর্ট' : 'Batch & Shelf Traceability'}
                </p>
                <dl className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between border-b border-[rgba(30,23,16,0.06)] pb-1.5">
                    <dt className="text-[#635647]">Active Batch</dt>
                    <dd className="font-mono font-bold text-[#1E1710]">{activeBatch.batchCode}</dd>
                  </div>
                  <div className="flex justify-between border-b border-[rgba(30,23,16,0.06)] pb-1.5">
                    <dt className="text-[#635647]">Produced</dt>
                    <dd className="font-mono">{activeBatch.productionDate}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[#635647]">Best Before</dt>
                    <dd className="font-mono">{activeBatch.expiryDate}</dd>
                  </div>
                </dl>
              </div>

              <div className="luxury-card rounded-2xl p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#B47B2B]/10 text-[#8A5A17]">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <p className="mt-4 font-mono text-xs font-semibold uppercase tracking-wider text-[#8A5A17]">
                  {bn ? 'সংরক্ষণ ও ল্যাব নিশ্চয়তা' : 'Storage & Lab Records'}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#635647]">
                  {activeBatch.labReportStatus}.{' '}
                  {bn
                    ? 'সর্বদা শুকনো ও পরিষ্কার চামচ ব্যবহার করুন এবং সূর্যের আলো থেকে দূরে সাধারণ তাপমাত্রায় রাখুন।'
                    : 'Always scoop with a clean, dry spoon and keep sealed away from heat.'}
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
                  {currentStage.index}. {bn ? 'দুধ থেকে কাঁচের জার' : 'From Milk to Jar'}
                </p>
                <h2 className="font-display mt-2 text-4xl font-semibold tracking-tight lg:text-5xl">
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
                        ? 'bg-[#B47B2B] text-[#FFFDF9]'
                        : 'text-[#E8DFC5]/75 hover:text-[#FAF7F2]'
                    }`}
                  >
                    {stage.index}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Mobile & Tablet Clean Stacked Craft Layout */}
          <div className="space-y-6 px-4 py-12 sm:space-y-8 sm:px-8 sm:py-16 lg:hidden">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-[#F5D692]">
                {bn ? 'দুধ থেকে কাঁচের জার' : 'From Milk to Jar'}
              </p>
              <h2 className="font-display mt-2 text-2xl font-semibold sm:text-3xl">
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
                className="relative aspect-[16/10] w-full cursor-ew-resize select-none overflow-hidden rounded-3xl border border-[rgba(30,23,16,0.14)] bg-[#1A120B] shadow-[0_20px_50px_-10px_rgba(30,23,16,0.16)] touch-none"
              >
                <div className="absolute inset-0">
                  <ResilientImage
                    src={IMAGES.textureLiquid}
                    alt={
                      bn
                        ? '৩৬ ডিগ্রি সেলসিয়াসে উষ্ণ তরল সোনালী দেশী ঘি'
                        : 'Warm liquid golden Deshi Ghee at 36 degrees Celsius'
                    }
                    className="h-full w-full object-cover"
                  />
                  <div className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-[#140E08]/85 px-3 py-1.5 font-mono text-xs text-[#FAF7F2] backdrop-blur-md border border-[#FAF7F2]/10 sm:right-5 sm:bottom-5">
                    {bn ? 'উষ্ণ তরল সোনালী · 36°C' : 'Liquid Amber · 36°C'}
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
                        ? '১৮ ডিগ্রি সেলসিয়াসে জমে থাকা দানাদার দেশী ঘি'
                        : 'Chilled granular danadar Deshi Ghee at 18 degrees Celsius'
                    }
                    className="h-full w-full object-cover"
                  />
                  <div className="pointer-events-none absolute left-3 bottom-3 rounded-full bg-[#140E08]/85 px-3 py-1.5 font-mono text-xs text-[#F5D692] backdrop-blur-md border border-[#F5D692]/20 sm:left-5 sm:bottom-5">
                    {bn ? 'খাঁটি দানাদার স্ফটিক · 18°C' : 'Danadar Crystals · 18°C'}
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
                  <div className="h-full w-0.5 bg-[#FFFDF9] shadow-md" />
                  <div className="absolute flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#D4AF37] bg-[#1A120B] text-[#F5D692] shadow-xl">
                    <ArrowLeftRight className="h-4 w-4" />
                  </div>
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-[#8A5A17] sm:text-left flex items-center justify-center sm:justify-start gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                <span>{bn ? 'হ্যান্ডেলটি টেনে তাপমাত্রাভেদে রূপের পরিবর্তন দেখুন' : 'Drag slider to observe natural temperature crystallization'}</span>
              </p>
            </div>

            <div className="lg:col-span-5">
              <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#8A5A17]">
                {bn ? 'প্রাকৃতিক টেক্সচার ও বিজ্ঞান' : 'Natural Crystallization'}
              </span>
              <h2 className="font-display mt-2 text-2xl font-bold tracking-tight text-[#1E1710] sm:text-3xl lg:text-4xl">
                {bn
                  ? 'তাপমাত্রার সাথে দানাদার রূপের স্বাভাবিক পরিবর্তন'
                  : 'Granular crystals at 18°C, liquid gold at 36°C'}
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-[#635647] sm:text-base">
                {bn
                  ? 'প্রাকৃতিক খাঁটি মিল্কফ্যাটের বিভিন্ন ফ্যাটি অ্যাসিডের গলনাঙ্ক ভিন্ন। তাই ঠান্ডা আবহাওয়ায় (১৮° সে.) ঘি স্বাভাবিকভাবেই সুষম দানা বাঁধে এবং উষ্ণতায় (৩৬° সে.) গলে গিয়ে সুগন্ধি তরল সোনা হয়ে যায়।'
                  : 'Natural pasture butterfat gently crystallizes into coarse danadar grains in cool environments (around 18°C) and melts into translucent liquid amber above 36°C.'}
              </p>
              <div className="mt-6 rounded-2xl border border-[rgba(30,23,16,0.08)] bg-[#F4EFE6]/70 p-4 text-xs text-[#635647]">
                <p className="font-semibold text-[#1E1710]">{bn ? '💡 বিশুদ্ধতার গুরুত্বপূর্ণ তথ্য:' : '💡 Authenticity Insight:'}</p>
                <p className="mt-1 leading-relaxed">
                  {bn
                    ? 'কৃত্রিম রাসায়নিক বা ডালডা দিয়ে দানাদার রূপ নকল করা যায়। তাই কেবল দানাদার হওয়া নয়—সঠিক বিলোনা উৎস ও ল্যাব টেস্টই খাঁটি ঘিয়ের আসল নিশ্চয়তা।'
                    : 'Authenticity is verified by curd-churned sourcing and laboratory acid value, not grain size alone.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 06: PROOF & BATCH VERIFICATION QR */}
        <section
          id="proof"
          className="scroll-mt-16 sm:scroll-mt-20 border-y border-[rgba(30,23,16,0.08)] bg-[#F4EFE6]/50 py-16 lg:py-24"
        >
          <div className="mx-auto grid max-w-[1320px] grid-cols-1 items-center gap-10 px-4 sm:px-8 md:grid-cols-12">
            <div className="space-y-4 md:col-span-8">
              <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#8A5A17]">
                {bn ? 'ল্যাব রিপোর্ট ও ব্যাচ পাসপোর্ট' : 'Provenance & Batch Verification'}
              </span>
              <h2 className="font-display text-2xl font-bold tracking-tight text-[#1E1710] sm:text-3xl lg:text-4xl">
                {bn
                  ? 'প্রতিটি জারের সাথে যুক্ত উন্মুক্ত ল্যাব রেকর্ড'
                  : 'Scan any jar to open its live batch record'}
              </h2>
              <p className="max-w-[54ch] text-sm leading-relaxed text-[#635647] sm:text-base">
                {bn
                  ? 'প্রতিটি ব্যাচের দুধ সংগ্রহের খামার, উৎপাদনের তারিখ, মেয়াদ এবং সরকারি মানদণ্ডের অনুমোদিত ল্যাব সার্টিফিকেট সরাসরি অনলাইনে যাচাইযোগ্য।'
                  : 'Inspect the current harvest batch record, production and expiry dates, regulatory licence status, and downloadable lab certificate.'}
              </p>

              <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
                <div className="luxury-card rounded-2xl p-4 text-xs">
                  <p className="text-[#8A5A17] font-mono uppercase tracking-wider font-semibold">{bn ? 'বর্তমান সক্রিয় ব্যাচ' : 'Active Batch'}</p>
                  <p className="mt-1 font-mono text-base font-bold text-[#1E1710]">
                    {activeBatch.batchCode}
                  </p>
                  <p className="mt-1 text-[#635647]">
                    {activeBatch.productionDate} → {activeBatch.expiryDate}
                  </p>
                </div>

                <div className="luxury-card rounded-2xl p-4 text-xs">
                  <p className="text-[#8A5A17] font-mono uppercase tracking-wider font-semibold">
                    {bn ? 'লাইসেন্স ও ল্যাব স্ট্যাটাস' : 'Licence & Certification'}
                  </p>
                  <p className="mt-1 font-medium text-[#1E1710]">
                    {activeBatch.licenceDetails}
                  </p>
                  <p className="mt-1 text-[#2D6A4F] font-semibold">{activeBatch.labReportStatus}</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-3 sm:flex-row sm:flex-wrap">
                <Link
                  href={`/batch?code=${encodeURIComponent(activeBatch.batchCode)}`}
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#1A120B] px-6 py-2.5 text-xs font-semibold text-[#FAF7F2] hover:bg-[#332415] transition-colors sm:w-auto shadow-xs"
                >
                  <FileCheck2 className="h-4 w-4 text-[#D4AF37]" />
                  <span>
                    {bn ? 'ব্যাচ যাচাই পেজ দেখুন' : 'Open Batch Verification Page'}
                  </span>
                </Link>

                {activeBatch.labReportUrl && (
                  <a
                    href={activeBatch.labReportUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-[rgba(30,23,16,0.18)] bg-[#FAF7F2] px-6 py-2.5 text-xs font-semibold text-[#1E1710] hover:bg-[#F2ECE1] transition-colors sm:w-auto"
                  >
                    <span>{bn ? 'ল্যাব রিপোর্ট ডাউনলোড PDF' : 'Download Lab PDF'}</span>
                    <ExternalLink className="h-3.5 w-3.5 text-[#8A5A17]" />
                  </a>
                )}
              </div>
            </div>

            <div className="flex flex-col items-center rounded-3xl border-2 border-[#D4AF37]/30 bg-[#FAF7F2] p-8 md:col-span-4 shadow-[0_15px_40px_-10px_rgba(30,23,16,0.08)]">
              {qrCodeUrl && (
                <div className="rounded-2xl border border-[rgba(30,23,16,0.12)] p-2 bg-[#FFFDF9] shadow-xs">
                  <img
                    src={qrCodeUrl}
                    alt={`Batch verification QR for ${activeBatch.batchCode}`}
                    className="h-44 w-44 rounded-xl"
                  />
                </div>
              )}
              <p className="mt-4 font-mono text-sm font-bold text-[#1E1710]">
                {activeBatch.batchCode}
              </p>
              <p className="mt-1 text-center text-xs text-[#635647]">
                {bn
                  ? 'মোবাইল ক্যামেরা দিয়ে স্ক্যান করে ব্যাচ রিপোর্ট দেখুন'
                  : 'Scan with camera to inspect lab records'}
              </p>
            </div>
          </div>
        </section>

        {/* SECTION 07: FOUNDER & FARM STORY */}
        <section
          id="story"
          className="scroll-mt-16 sm:scroll-mt-20 mx-auto max-w-[1320px] px-4 py-16 sm:px-8 sm:py-24"
        >
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="grid grid-cols-12 gap-4 lg:col-span-6">
              <div className="col-span-7 aspect-[4/3] overflow-hidden rounded-3xl border border-[rgba(30,23,16,0.12)] bg-[#F2ECE1] shadow-[0_15px_35px_-10px_rgba(30,23,16,0.12)]">
                <ResilientImage
                  src={IMAGES.founderPortrait}
                  alt={
                    bn
                      ? 'পাবনার খামার প্রাঙ্গণে হাতে তৈরি দেশী ঘিয়ের জারসহ প্রতিষ্ঠাতা'
                      : 'Founder holding a sealed glass jar of Deshi Gee at the Pabna farmstead courtyard'
                  }
                  className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
                />
              </div>
              <div className="col-span-5 aspect-[4/3] self-end overflow-hidden rounded-3xl border border-[rgba(30,23,16,0.12)] bg-[#F2ECE1] shadow-[0_15px_35px_-10px_rgba(30,23,16,0.12)]">
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
              <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#8A5A17]">
                {bn ? 'উৎস ও ঐতিহ্যবাহী দর্শন' : 'Heritage & Pastoral Roots'}
              </span>
              <h2 className="font-display text-3xl font-bold tracking-tight text-[#1E1710] sm:text-4xl">
                {bn
                  ? 'একটিই পণ্য—যেন প্রতিটি রান্নাঘরে পৌঁছায় চেনা গ্রামের খাঁটি ঘ্রাণ'
                  : 'Dedicated to one honest jar of Pabna bilona ghee'}
              </h2>
              <p className="text-sm leading-relaxed text-[#635647] sm:text-base">
                {bn
                  ? 'শহুরে কৃত্রিম খাদ্যের ভিড়ে আসল দই-মন্থিত গাওয়া ঘিয়ের অমূল্য স্বাদ ফিরিয়ে আনাই আমাদের লক্ষ্য। আমরা একাধিক পণ্যের ব্যবসা না করে শুধুমাত্র পাবনার নদী তীরের চারণভূমির খাঁটি কাঁচা দুধ ও কাঠের বিলোনার প্রাচীন মন্থন পদ্ধতির উপর মনোযোগ দিয়েছি।'
                  : 'Deshi Gee began with a simple commitment: avoid supermarket mass-production and focus completely on perfecting single-origin Pabna grass-fed bilona cow ghee.'}
              </p>
              <div className="pt-2 flex items-center gap-2 text-xs font-semibold text-[#1E1710]">
                <span className="text-[#8A5A17]">{bn ? 'উৎপাদন ও সংগ্রহ কেন্দ্র:' : 'Pastoral Origin:'}</span>
                <span className="font-mono text-[#8A5A17] bg-[#F4EFE6] px-3 py-1 rounded-full border border-[#B47B2B]/20">
                  {settings.originLocation}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 08: WAYS TO ENJOY DESHI GHEE */}
        <section className="border-y border-[rgba(30,23,16,0.08)] bg-[#F4EFE6]/40 py-16 lg:py-24">
          <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
            <div className="max-w-2xl">
              <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#8A5A17]">
                {bn ? 'বাঙালি রান্না ও পরিবেশন' : 'Culinary Traditions'}
              </span>
              <h2 className="font-display mt-2 text-3xl font-bold tracking-tight text-[#1E1710]">
                {bn
                  ? 'প্রতিদিনের খাবারে খাঁটি ঘিয়ের সুবাস'
                  : 'Five everyday ways across Bengali kitchens'}
              </h2>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
              {WAYS_TO_ENJOY.map((dish) => (
                <article
                  key={dish.id}
                  className="group luxury-card flex flex-col overflow-hidden rounded-2xl"
                >
                  <div className="aspect-[4/3] w-full overflow-hidden bg-[#EAE1D2]">
                    <ResilientImage
                      src={dish.image}
                      alt={bn ? dish.titleBn : dish.titleEn}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                    />
                  </div>
                  <div className="flex flex-1 flex-col justify-between p-5">
                    <div>
                      <h3 className="font-display text-lg font-bold text-[#1E1710]">
                        {bn ? dish.titleBn : dish.titleEn}
                      </h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-[#635647]">
                        {bn ? dish.descBn : dish.descEn}
                      </p>
                    </div>
                    <div className="mt-4 border-t border-[rgba(30,23,16,0.08)] pt-3 flex items-start gap-1.5 text-[11px] font-medium text-[#8A5A17]">
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
        <section className="mx-auto max-w-[1320px] px-5 py-20 sm:px-8 lg:py-24">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[rgba(30,23,16,0.10)] pb-6">
                <div>
                  <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#8A5A17]">
                    {bn ? 'ক্রেতাদের অভিজ্ঞতা' : 'Customer Experience Ledger'}
                  </span>
                  <h2 className="font-display mt-2 text-3xl font-bold text-[#1E1710]">
                    {bn ? 'যাচাইকৃত গ্রাহকদের মতামত' : 'Genuine kitchen feedback'}
                  </h2>
                </div>

                {avgRating && (
                  <div className="text-right">
                    <p className="font-mono text-3xl font-bold tabular-nums text-[#1E1710]">
                      {avgRating} <span className="text-sm font-normal text-[#8A5A17]">/ 5.0</span>
                    </p>
                    <p className="text-xs text-[#635647] tabular-nums">
                      {reviews.length}{' '}
                      {bn ? 'টি অনুমোদিত রিভিউ' : 'approved reviews'}
                    </p>
                  </div>
                )}
              </div>

              {reviews.length === 0 ? (
                <div className="mt-8 rounded-3xl border border-[rgba(30,23,16,0.10)] bg-[#F4EFE6]/50 p-10 text-center">
                  <p className="font-display text-lg font-semibold text-[#1E1710]">
                    {bn
                      ? 'এখনও কোনো অনুমোদিত রিভিউ প্রদর্শিত হয়নি'
                      : 'No approved reviews published yet'}
                  </p>
                  <p className="mt-2 text-sm text-[#635647] max-w-md mx-auto">
                    {bn
                      ? 'আমরা কেবল প্রকৃত ক্রেতাদের অনুমোদিত রিভিউ প্রকাশ করি। আপনার অভিজ্ঞতা ডানদিকের ফর্মে শেয়ার করুন।'
                      : 'We publish only genuine customer feedback approved after moderation. Share your experience using the form.'}
                  </p>
                </div>
              ) : (
                <div className="mt-8 space-y-4">
                  {reviews.map((rev) => (
                    <article
                      key={rev.id}
                      className="luxury-card rounded-2xl p-6"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-[#1E1710]">
                            {rev.customerName}{' '}
                            <span className="font-normal text-[#635647]">
                              · {rev.district}
                            </span>
                          </p>
                          {rev.verifiedPurchase && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2D6A4F]">
                              <Check className="h-3 w-3" />
                              {bn ? 'যাচাইকৃত ক্রেতা' : 'Verified Purchase'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 text-[#B47B2B]">
                          {Array.from({ length: rev.rating }).map((_, idx) => (
                            <Star key={idx} className="h-4 w-4 fill-current text-[#D4AF37]" />
                          ))}
                        </div>
                      </div>

                      <p className="mt-3 text-sm leading-relaxed text-[#1E1710]">
                        {rev.comment}
                      </p>

                      {rev.photoData && (
                        <img
                          src={rev.photoData}
                          alt={`Customer photo by ${rev.customerName}`}
                          className="mt-4 max-h-48 rounded-xl border border-[rgba(30,23,16,0.10)] object-cover shadow-xs"
                        />
                      )}

                      <div className="mt-4 flex items-center justify-end border-t border-[rgba(30,23,16,0.06)] pt-3">
                        <button
                          type="button"
                          onClick={() => handleHelpfulVote(rev)}
                          className="inline-flex items-center gap-1.5 text-xs text-[#635647] hover:text-[#1E1710] transition-colors"
                        >
                          <ThumbsUp className="h-3.5 w-3.5 text-[#B47B2B]" />
                          <span>
                            {bn ? 'সহায়ক' : 'Helpful'} ({rev.helpfulCount})
                          </span>
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            {/* Submit Review Form */}
            <form
              onSubmit={handleSubmitReview}
              className="space-y-4 self-start rounded-3xl border border-[rgba(30,23,16,0.12)] bg-[#F4EFE6]/80 p-7 lg:col-span-5 shadow-[0_10px_30px_rgba(30,23,16,0.06)]"
            >
              <h3 className="font-display text-xl font-bold text-[#1E1710]">
                {bn ? 'আপনার অভিজ্ঞতা লিখুন' : 'Share Your Experience'}
              </h3>
              <p className="text-xs text-[#635647]">
                {bn
                  ? 'আপনার প্রতিটি রিভিউ অন্যান্য ক্রেতাদের খাঁটি ঘি বেছে নিতে সাহায্য করবে।'
                  : 'Your genuine feedback guides fellow patrons across Bangladesh.'}
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-[#635647]">
                    {bn ? 'নাম *' : 'Your Name *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={revName}
                    onChange={(e) => setRevName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[rgba(30,23,16,0.16)] bg-[#FFFDF9] px-3.5 py-2.5 text-base sm:text-sm shadow-xs focus:border-[#B47B2B] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#635647]">
                    {bn ? 'জেলা / এলাকা *' : 'District / Area *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={revDistrict}
                    onChange={(e) => setRevDistrict(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[rgba(30,23,16,0.16)] bg-[#FFFDF9] px-3.5 py-2.5 text-base sm:text-sm shadow-xs focus:border-[#B47B2B] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#635647]">
                    {bn ? 'রেটিং' : 'Rating'}
                  </label>
                  <select
                    value={revRating}
                    onChange={(e) => setRevRating(Number(e.target.value))}
                    className="mt-1 w-full rounded-xl border border-[rgba(30,23,16,0.16)] bg-[#FFFDF9] px-3.5 py-2.5 text-base sm:text-sm shadow-xs focus:border-[#B47B2B] focus:outline-none"
                  >
                    <option value={5}>⭐⭐⭐⭐⭐ (5 / 5)</option>
                    <option value={4}>⭐⭐⭐⭐ (4 / 5)</option>
                    <option value={3}>⭐⭐⭐ (3 / 5)</option>
                    <option value={2}>⭐⭐ (2 / 5)</option>
                    <option value={1}>⭐ (1 / 5)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#635647]">
                    {bn ? 'অর্ডার আইডি (ঐচ্ছিক)' : 'Order ID (Optional)'}
                  </label>
                  <input
                    type="text"
                    value={revOrderNum}
                    onChange={(e) => setRevOrderNum(e.target.value.toUpperCase())}
                    placeholder="DG-1042"
                    className="mt-1 w-full rounded-xl border border-[rgba(30,23,16,0.16)] bg-[#FFFDF9] px-3.5 py-2.5 font-mono text-base sm:text-sm shadow-xs focus:border-[#B47B2B] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#635647]">
                  {bn ? 'মন্তব্য *' : 'Your Review *'}
                </label>
                <textarea
                  rows={3}
                  required
                  value={revComment}
                  onChange={(e) => setRevComment(e.target.value)}
                  placeholder={bn ? 'ঘিয়ের ঘ্রাণ, স্বাদ ও অভিজ্ঞতা বর্ণনা করুন...' : 'Describe aroma, taste, and experience...'}
                  className="mt-1 w-full rounded-xl border border-[rgba(30,23,16,0.16)] bg-[#FFFDF9] px-3.5 py-2.5 text-base sm:text-sm shadow-xs focus:border-[#B47B2B] focus:outline-none"
                />
              </div>

              <label className="flex min-h-[46px] cursor-pointer items-center gap-2.5 rounded-xl border border-dashed border-[rgba(30,23,16,0.25)] bg-[#FFFDF9] px-4 py-2 text-xs text-[#635647] hover:border-[#B47B2B] transition-colors">
                <Upload className="h-4 w-4 text-[#8A5A17]" />
                <span>
                  {revPhotoData
                    ? bn
                      ? 'ছবি সংযুক্ত হয়েছে ✓'
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
                <p className="text-xs font-semibold text-[#8A5A17]">{revStatusMsg}</p>
              )}

              <button
                type="submit"
                disabled={revSubmitting}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#1A120B] px-6 py-3 text-sm font-semibold text-[#FAF7F2] hover:bg-[#332415] disabled:opacity-60 transition-colors shadow-xs"
              >
                {revSubmitting && <Loader2 className="h-4 w-4 animate-spin text-[#D4AF37]" />}
                <span>{bn ? 'রিভিউ জমা দিন' : 'Submit Review'}</span>
              </button>
            </form>
          </div>
        </section>

        {/* SECTION 10: BILINGUAL 12-QUESTION FAQ ACCORDION */}
        <section
          id="faq"
          className="scroll-mt-16 sm:scroll-mt-20 border-t border-[rgba(30,23,16,0.08)] bg-[#F4EFE6]/40 py-16 lg:py-24"
        >
          <div className="mx-auto max-w-4xl px-4 sm:px-8">
            <div className="text-center">
              <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#8A5A17]">
                {bn ? 'সাধারণ জিজ্ঞাসা' : 'Frequently Asked Questions'}
              </span>
              <h2 className="font-display mt-2 text-3xl font-bold text-[#1E1710] sm:text-4xl">
                {bn ? 'দেশী ঘি সম্পর্কে প্রশ্নোত্তর' : 'Everything about Deshi Gee'}
              </h2>
            </div>

            <div className="mt-10 space-y-3">
              {FAQ_ITEMS.map((item, idx) => {
                const isOpen = openFaqIdx === idx;
                return (
                  <div
                    key={idx}
                    className="overflow-hidden rounded-2xl border border-[rgba(30,23,16,0.10)] bg-[#FFFDF9] transition-all"
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                      className="flex min-h-[52px] w-full items-center justify-between gap-4 p-5 text-left font-medium"
                    >
                      <span className="text-sm font-bold text-[#1E1710] sm:text-base">
                        {idx + 1}. {bn ? item.qBn : item.qEn}
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-[#8A5A17] transition-transform duration-200 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <div className="border-t border-[rgba(30,23,16,0.06)] px-5 pb-5 pt-3">
                        <p className="text-sm leading-relaxed text-[#635647]">
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
          <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[#8A5A17]">
            {bn ? 'নতুন ব্যাচের খবর' : 'Harvest Notifications'}
          </span>
          <h2 className="font-display mt-2 text-3xl font-bold text-[#1E1710] sm:text-4xl">
            {bn ? 'পাবনা থেকে তাজা ব্যাচের খবর সবার আগে' : 'Fresh Harvest Alerts'}
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-[#635647]">
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
              placeholder="you@example.com"
              aria-label="Email address for batch updates"
              className="min-h-[48px] flex-1 rounded-xl border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] px-4 text-base text-[#1E1710] shadow-xs focus:border-[#B47B2B] focus:outline-none sm:text-sm"
            />
            <button
              type="submit"
              disabled={newsSubmitting}
              className="min-h-[48px] rounded-xl bg-[#1A120B] px-7 text-sm font-semibold text-[#FAF7F2] hover:bg-[#332415] disabled:opacity-60 transition-colors shadow-xs"
            >
              {newsSubmitting ? '...' : bn ? 'যুক্ত হোন' : 'Subscribe'}
            </button>
          </form>
          {newsFeedback && (
            <p
              className={`mt-3 text-xs font-semibold ${
                newsFeedback.type === 'ok' ? 'text-[#2D6A4F]' : 'text-red-700'
              }`}
            >
              {newsFeedback.msg}
            </p>
          )}
        </section>
      </main>

      {/* MOBILE STICKY ADD TO BAG BAR */}
      {showMobileSticky && !drawerOpen && (
        <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-[rgba(30,23,16,0.12)] bg-[#FAF7F2]/95 px-4 py-2.5 backdrop-blur-md pb-[max(0.6rem,env(safe-area-inset-bottom))] md:hidden shadow-[0_-8px_24px_rgba(30,23,16,0.08)]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-sm font-bold tabular-nums text-[#1E1710]">
                  {formatBdt(activePrice)}
                </span>
                <span className="font-mono text-xs text-[#8A5A17] font-semibold">
                  ({selectedWeight})
                </span>
              </div>
              <p className="truncate text-[11px] text-[#635647]">
                {bn ? 'খাঁটি কাঠের বিলোনা ঘি' : 'Pure Pabna Bilona Ghee'}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <a
                href={whatsappChatHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={bn ? 'হোয়াটসঅ্যাপ সাপোর্ট' : 'WhatsApp Support'}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(30,23,16,0.18)] bg-[#FFFDF9] text-[#1E1710] shadow-xs active:scale-95 transition-transform"
              >
                <MessageCircle className="h-4 w-4 text-[#8A5A17]" />
              </a>

              <button
                type="button"
                disabled={isOutOfStock}
                onClick={() => handleAddToCart(true)}
                className="min-h-[42px] rounded-xl bg-gradient-to-r from-[#B47B2B] to-[#96621B] px-5 text-xs font-bold text-[#FFFDF9] shadow-sm disabled:opacity-45 whitespace-nowrap active:scale-95 transition-transform"
              >
                {isOutOfStock
                  ? bn
                    ? 'স্টক শেষ'
                    : 'Out of Stock'
                  : bn
                    ? 'অর্ডার করুন'
                    : 'Buy Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
