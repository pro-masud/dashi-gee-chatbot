'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Award,
  Banknote,
  Check,
  ChevronDown,
  Droplet,
  Droplets,
  Eye,
  Flame,
  Gem,
  Hand,
  Leaf,
  Loader2,
  MessageSquarePlus,
  ShieldCheck,
  Star,
  ThumbsUp,
  Truck,
  Wind,
  X,
} from 'lucide-react';
import {
  WeightKey,
  getConfirmedPriceForWeight,
  incrementReviewHelpful,
  isStorefrontOrderingReady,
  submitCustomerReview,
} from '../lib/firebase';
import {
  BANGLADESH_DISTRICTS,
  formatBdt,
  toBengaliDigits,
} from '../data/deshiGeeData';
import {
  CLOSING_CTA,
  CULINARY_SECTION,
  FRESH_FAQS,
  FRESH_IMAGES,
  FRESH_WEIGHT_OPTIONS,
  GUARANTEE_SECTION,
  HERO_CONTENT,
  PROBLEM_SECTION,
  PROCESS_SECTION,
  PURITY_TESTS_SECTION,
  REVIEWS_SECTION,
  TRUST_BAR_ITEMS,
  WHY_SECTION,
  getFreshStockForWeight,
  resolvePreferredFlagshipWeight,
} from '../data/freshStorefrontContent';
import { visibleFaqs } from '../lib/cms/cms';
import { ResilientImage } from './ResilientImage';
import { useStorefront } from './StorefrontProvider';
import { EmbeddedOrderSection } from './storefront/EmbeddedOrderSection';

export function HomeStorefrontView() {
  const router = useRouter();
  const {
    lang,
    settings,
    reviews,
    setReviews,
    setLastConfirmedOrder,
    setTrackPrefill,
    openChatAssistant,
    openCallbackRequest,
    packageMeta,
    cms,
  } = useStorefront();

  const bn = lang === 'bn';
  const orderingReady = isStorefrontOrderingReady(settings);

  const [selectedWeight, setSelectedWeight] = useState<WeightKey>('1kg');
  const weightTouchedRef = useRef(false);
  const [orderQty, setOrderQty] = useState<number>(1);
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const [hideStickyBar, setHideStickyBar] = useState<boolean>(false);

  // Live review submission state
  const [showReviewComposer, setShowReviewComposer] = useState(false);
  const [revName, setRevName] = useState('');
  const [revDistrict, setRevDistrict] = useState('Dhaka');
  const [revOrderNum, setRevOrderNum] = useState('');
  const [revRating, setRevRating] = useState(5);
  const [revComment, setRevComment] = useState('');
  const [revBusy, setRevBusy] = useState(false);
  const [revMsg, setRevMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());

  // Sync preferred flagship weight (1kg first) once live packages/settings settle
  useEffect(() => {
    if (weightTouchedRef.current) return;
    setSelectedWeight(resolvePreferredFlagshipWeight(settings, packageMeta));
  }, [settings, packageMeta]);

  // Hide mobile sticky bar when customer reaches #order section
  useEffect(() => {
    const target = document.getElementById('order');
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const anyVisible = entries.some((entry) => entry.isIntersecting);
        setHideStickyBar(anyVisible);
      },
      { threshold: 0.08 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const enabledWeights = useMemo(
    () =>
      FRESH_WEIGHT_OPTIONS.filter((opt) =>
        packageMeta ? packageMeta[opt.weight]?.enabled !== false : true
      ),
    [packageMeta]
  );

  const selectedOption =
    FRESH_WEIGHT_OPTIONS.find((o) => o.weight === selectedWeight) || FRESH_WEIGHT_OPTIONS[0];
  const heroConfirmedPrice = getConfirmedPriceForWeight(settings, selectedWeight);
  const heroStock = getFreshStockForWeight(settings, selectedWeight);

  const formatPrice = (amount: number, targetLang: 'bn' | 'en' = lang) => {
    const formatted = formatBdt(amount);
    return targetLang === 'bn' ? toBengaliDigits(formatted) : formatted;
  };

  const faqList = useMemo(() => {
    const cmsItems = cms ? visibleFaqs(cms.faqs) : [];
    if (cmsItems.length > 0) {
      return cmsItems.map((item) => ({
        q: { bn: item.qBn || item.qEn, en: item.qEn || item.qBn },
        a: { bn: item.aBn || item.aEn, en: item.aEn || item.aBn },
      }));
    }
    return FRESH_FAQS;
  }, [cms]);

  const approvedReviews = useMemo(() => reviews.slice(0, 3), [reviews]);

  const scrollToOrder = () => {
    const el = document.getElementById('order');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSelectWeight = (weight: WeightKey) => {
    weightTouchedRef.current = true;
    setSelectedWeight(weight);
  };

  const handleHelpful = async (reviewId: string) => {
    if (votedIds.has(reviewId)) return;
    setVotedIds((prev) => new Set(prev).add(reviewId));
    setReviews((prev) =>
      prev.map((r) =>
        r.id === reviewId ? { ...r, helpfulCount: (r.helpfulCount || 0) + 1 } : r
      )
    );
    try {
      await incrementReviewHelpful(reviewId);
    } catch {
      // keep optimistic count
    }
  };

  const handleReviewSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (revName.trim().length < 2 || revComment.trim().length < 8) {
      setRevMsg({
        ok: false,
        text: bn
          ? 'অনুগ্রহ করে আপনার নাম এবং অন্তত কয়েক শব্দের অভিজ্ঞতা লিখুন।'
          : 'Please enter your name and a brief comment about your experience.',
      });
      return;
    }
    setRevBusy(true);
    setRevMsg(null);
    try {
      await submitCustomerReview({
        customerName: revName.trim(),
        district: revDistrict,
        rating: revRating,
        comment: revComment.trim(),
        orderNumber: revOrderNum.trim(),
        photoData: '',
      });
      setRevName('');
      setRevOrderNum('');
      setRevComment('');
      setRevMsg({
        ok: true,
        text: bn
          ? 'ধন্যবাদ! আপনার মতামত জমা হয়েছে এবং অনুমোদনের পর এখানে প্রকাশিত হবে।'
          : 'Thank you! Your review has been submitted and will appear once approved.',
      });
    } catch {
      setRevMsg({
        ok: false,
        text: bn
          ? 'এই মুহূর্তে রিভিউ জমা দেওয়া যায়নি। একটু পরে আবার চেষ্টা করুন।'
          : 'Could not submit your review right now. Please try again shortly.',
      });
    } finally {
      setRevBusy(false);
    }
  };

  const trustIcon = (id: (typeof TRUST_BAR_ITEMS)[number]['id']) => {
    switch (id) {
      case 'delivery':
        return <Truck className="h-5 w-5 text-[#16673A]" />;
      case 'cod':
        return <Banknote className="h-5 w-5 text-[#16673A]" />;
      case 'inspect':
        return <Eye className="h-5 w-5 text-[#16673A]" />;
      case 'pure':
        return <Leaf className="h-5 w-5 text-[#16673A]" />;
    }
  };

  const pillarIcon = (id: (typeof WHY_SECTION.pillars)[number]['id']) => {
    switch (id) {
      case 'milk':
        return <Droplets className="h-6 w-6 text-[#0C3F22]" />;
      case 'simmer':
        return <Flame className="h-6 w-6 text-[#0C3F22]" />;
      case 'direct':
        return <Award className="h-6 w-6 text-[#0C3F22]" />;
      case 'clean':
        return <ShieldCheck className="h-6 w-6 text-[#0C3F22]" />;
    }
  };

  const purityIcon = (id: (typeof PURITY_TESTS_SECTION.checks)[number]['id']) => {
    switch (id) {
      case 'palm':
        return <Hand className="h-6 w-6 text-[#16673A]" />;
      case 'grain':
        return <Gem className="h-6 w-6 text-[#16673A]" />;
      case 'aroma':
        return <Wind className="h-6 w-6 text-[#16673A]" />;
      case 'clarity':
        return <Droplet className="h-6 w-6 text-[#16673A]" />;
    }
  };

  return (
    <main className="pb-20 md:pb-0">
      {/* 1. WARM-GLOW 2-COLUMN SPLIT HERO */}
      <section className="dg-hero-surface relative overflow-hidden pt-10 pb-20 sm:pt-14 sm:pb-24">
        <div className="mx-auto grid max-w-[1140px] grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:px-8">
          {/* Left Hero Copy & Flagship 1kg Price Card */}
          <div className="space-y-6 text-center lg:col-span-7 lg:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-bold tracking-wider text-[#16673A] lg:justify-start">
              <span className="tracking-[0.2em] uppercase">DESHI GEE</span>
              <span aria-hidden="true" className="text-[#855E00]">
                ·
              </span>
              <span className="text-[#855E00]">{HERO_CONTENT.originKicker[lang]}</span>
            </div>

            <h1 className="font-display text-[2rem] font-extrabold leading-[1.24] text-[#14231A] sm:text-[2.75rem] lg:text-[3.15rem]">
              {HERO_CONTENT.headlinePrefix[lang]}
              <br />
              <span className="dg-highlight-brush">{HERO_CONTENT.headlineHighlight[lang]}</span>
            </h1>

            <p className="mx-auto max-w-xl text-base leading-relaxed text-[#56645A] sm:text-lg lg:mx-0">
              {HERO_CONTENT.subheadline[lang]}
            </p>

            {/* Flagship 1kg Price Card + Interactive Jar Size Selector */}
            <div className="mx-auto max-w-lg rounded-[20px] border border-[#E7E3D3] bg-white p-4 shadow-[0_14px_34px_rgba(12,63,34,0.09)] sm:p-5 lg:mx-0">
              {/* Interactive Size Switcher */}
              <div
                role="group"
                aria-label={bn ? 'জারের ওজন নির্বাচন' : 'Select jar weight'}
                className="flex items-center gap-1.5 rounded-xl bg-[#F4FAF5] p-1"
              >
                {enabledWeights.map((opt) => {
                  const active = selectedWeight === opt.weight;
                  return (
                    <button
                      key={opt.weight}
                      type="button"
                      onClick={() => handleSelectWeight(opt.weight)}
                      className={`min-h-[38px] flex-1 whitespace-nowrap rounded-lg px-2.5 text-xs font-bold transition-colors sm:text-sm ${
                        active
                          ? 'bg-[#16673A] text-white shadow-xs'
                          : 'text-[#14231A] hover:bg-white/80'
                      }`}
                    >
                      {bn ? opt.labelBn : opt.labelEn}
                    </button>
                  );
                })}
              </div>

              {/* Split Price + Delivery Row */}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
                <div className="text-left">
                  <span className="block text-xs font-semibold text-[#56645A]">
                    {bn ? selectedOption.labelBn : selectedOption.labelEn}
                    {selectedOption.flagship
                      ? bn
                        ? ' · ফ্ল্যাগশিপ'
                        : ' · Flagship'
                      : ''}
                  </span>
                  {heroConfirmedPrice !== null ? (
                    <strong className="font-display mt-0.5 block text-4xl font-extrabold leading-none text-[#16673A] tabular-nums">
                      {formatPrice(heroConfirmedPrice, lang)}
                    </strong>
                  ) : (
                    <div
                      data-testid="storefront-ordering-unavailable"
                      className="mt-1 space-y-0.5"
                    >
                      <strong className="block text-base font-extrabold text-[#0C3F22]">
                        {bn ? 'লাইভ মূল্য হালনাগাদ হচ্ছে' : 'Ordering is temporarily unavailable'}
                      </strong>
                      <span className="block text-xs text-[#56645A]">
                        {bn
                          ? 'Ordering is temporarily unavailable — লাইভ স্টক চালু হলেই অর্ডার করতে পারবেন।'
                          : 'Live jar pricing is being confirmed by the store owner.'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="border-t border-[#E7E3D3] pt-3 text-left sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5">
                  <span className="block text-sm font-extrabold text-[#16673A]">
                    {settings.freeDeliveryThreshold > 0
                      ? bn
                        ? `${formatPrice(settings.freeDeliveryThreshold, 'bn')}+ অর্ডারে ফ্রি ডেলিভারি`
                        : `Free delivery over ${formatPrice(settings.freeDeliveryThreshold, 'en')}`
                      : bn
                        ? 'সারা দেশে হোম ডেলিভারি'
                        : 'Nationwide Home Delivery'}
                  </span>
                  <span className="mt-0.5 block text-xs text-[#56645A]">
                    {orderingReady && heroStock > 0
                      ? HERO_CONTENT.priceNoteConfirmed[lang]
                      : HERO_CONTENT.priceNotePending[lang]}
                  </span>
                </div>
              </div>
            </div>

            {/* Primary CTA + 3 Inline Trust Checks */}
            <div className="space-y-4 pt-1">
              <div className="flex flex-wrap items-center justify-center gap-3 lg:justify-start">
                <a
                  href="#order"
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToOrder();
                  }}
                  className="dg-btn-emerald text-lg"
                >
                  <span>{HERO_CONTENT.ctaLabel[lang]}</span>
                  <ArrowRight className="h-5 w-5" />
                </a>
              </div>

              <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-semibold text-[#16673A] lg:justify-start">
                {HERO_CONTENT.trustChecks.map((item, i) => (
                  <li key={i} className="inline-flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-[#1F8A4C]" />
                    <span>{item[lang]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Right Hero Jar Visual */}
          <div className="relative mx-auto w-full max-w-[440px] lg:col-span-5 lg:max-w-none">
            <div className="relative">
              <div className="overflow-hidden rounded-[28px] border border-[#E7E3D3] bg-white shadow-[0_28px_60px_rgba(12,63,34,0.22)] transition-transform duration-300 lg:-rotate-2 lg:hover:rotate-0">
                <ResilientImage
                  src={FRESH_IMAGES.heroJar}
                  alt={
                    bn
                      ? 'কাচের জারে খাঁটি দানাদার সোনালি Deshi Gee গাওয়া ঘি'
                      : 'Clear glass jar of pure golden granular Deshi Gee cow ghee with wooden spoon'
                  }
                  fallbackTitle="Deshi Gee"
                  className="aspect-square w-full object-cover"
                />
              </div>

              {/* Two Clean Floating Highlights */}
              <div className="dg-float-a absolute top-[7%] -left-2 hidden items-center gap-2 rounded-2xl border border-[#E7E3D3] bg-white/95 px-4 py-2.5 text-sm font-bold text-[#0C3F22] shadow-[0_12px_28px_rgba(12,63,34,0.14)] backdrop-blur-xs sm:inline-flex lg:-left-5">
                <Droplets className="h-4 w-4 text-[#1F8A4C]" />
                <span>{HERO_CONTENT.floatTop[lang]}</span>
              </div>
              <div className="dg-float-b absolute right-2 bottom-[8%] hidden items-center gap-2 rounded-2xl border border-[#E7E3D3] bg-white/95 px-4 py-2.5 text-sm font-bold text-[#0C3F22] shadow-[0_12px_28px_rgba(12,63,34,0.14)] backdrop-blur-xs sm:inline-flex lg:-right-4">
                <Flame className="h-4 w-4 text-[#D97706]" />
                <span>{HERO_CONTENT.floatBottom[lang]}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. OVERLAPPING 4-COLUMN TRUST BAR */}
      <section aria-label={bn ? 'সেবার নিশ্চয়তা' : 'Service guarantees'} className="relative z-10 -mt-10 sm:-mt-12">
        <div className="mx-auto max-w-[1140px] px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 overflow-hidden rounded-[22px] border border-[#E7E3D3] bg-white shadow-[0_18px_40px_rgba(12,63,34,0.11)] lg:grid-cols-4">
            {TRUST_BAR_ITEMS.map((item, idx) => (
              <div
                key={item.id}
                className={`flex flex-col items-center gap-2.5 px-4 py-5 text-center sm:flex-row sm:items-center sm:gap-3.5 sm:px-5 sm:py-6 sm:text-left ${
                  idx < 3 ? 'border-b border-[#E7E3D3] lg:border-r lg:border-b-0' : ''
                } ${idx % 2 === 0 ? 'border-r border-[#E7E3D3] lg:border-r' : ''}`}
              >
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#EAF6EE]">
                  {trustIcon(item.id)}
                </div>
                <div>
                  <p className="text-[15px] font-bold leading-snug text-[#14231A]">
                    {item.title[lang]}
                  </p>
                  <p className="mt-0.5 text-xs text-[#56645A] sm:text-[13px]">{item.sub[lang]}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. MARKET REALITY / PROBLEM CONTRAST SECTION */}
      <section className="bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-[940px] px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold tracking-wide text-[#855E00]">
              {PROBLEM_SECTION.kicker[lang]}
            </p>
            <h2 className="font-display mt-2 text-3xl font-extrabold leading-tight text-[#14231A] sm:text-[2.375rem]">
              {PROBLEM_SECTION.heading[lang]}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-[#56645A] sm:text-lg">
              {PROBLEM_SECTION.sub[lang]}
            </p>
          </div>

          <div className="mt-9 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PROBLEM_SECTION.points.map((pt, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3.5 rounded-2xl border border-[#F6D6D2] bg-[#FFF6F5] px-5 py-4 text-[15px] font-semibold text-[#5A2A25] sm:text-base"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#D93F34] text-white">
                  <X className="h-4 w-4" />
                </span>
                <span>{pt[lang]}</span>
              </div>
            ))}
          </div>

          <div className="mt-7 rounded-2xl border border-[#E7E3D3] bg-gradient-to-r from-[#EAF6EE] to-[#FFF8D6] px-6 py-4 text-center text-base font-semibold text-[#14231A] sm:text-lg">
            <span>{PROBLEM_SECTION.resolutionPrefix[lang]} </span>
            <strong className="font-extrabold text-[#16673A]">
              {PROBLEM_SECTION.resolutionBrand[lang]}
            </strong>
          </div>
        </div>
      </section>

      {/* 4. WHY DESHI GEE IS DIFFERENT (WARM CREAM 2-COL SPLIT) */}
      <section className="bg-[#FFFAEB] py-16 sm:py-24">
        <div className="mx-auto grid max-w-[1140px] grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:px-8">
          <div className="lg:col-span-5">
            <div className="overflow-hidden rounded-[26px] border border-[#E7E3D3] bg-white shadow-[0_22px_46px_rgba(12,63,34,0.16)]">
              <ResilientImage
                src={FRESH_IMAGES.craftSimmer}
                alt={
                  bn
                    ? 'ঐতিহ্যবাহী পিতলের পাত্রে মৃদু আঁচে জ্বাল দেওয়া সোনালি ঘি'
                    : 'Golden slow-simmered cow ghee poured from a traditional brass ladle'
                }
                fallbackTitle="Deshi Gee Craft"
                className="aspect-[4/3] w-full object-cover"
              />
            </div>
          </div>

          <div className="space-y-6 lg:col-span-7">
            <div className="text-center lg:text-left">
              <p className="text-sm font-bold tracking-wide text-[#855E00]">
                {WHY_SECTION.kicker[lang]}
              </p>
              <h2 className="font-display mt-2 text-3xl font-extrabold leading-tight text-[#14231A] sm:text-[2.375rem]">
                {WHY_SECTION.heading[lang]}
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {WHY_SECTION.pillars.map((pillar) => (
                <article
                  key={pillar.id}
                  className="rounded-[18px] border border-[#E7E3D3] bg-white p-5 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(12,63,34,0.09)]"
                >
                  <div className="grid h-[50px] w-[50px] place-items-center rounded-[14px] bg-gradient-to-br from-[#FFD21F] to-[#FFB800]">
                    {pillarIcon(pillar.id)}
                  </div>
                  <h3 className="font-display mt-3.5 text-lg font-bold text-[#14231A]">
                    {pillar.title[lang]}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#56645A]">
                    {pillar.desc[lang]}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 5. EVERYDAY CULINARY SHOWCASE */}
      <section className="bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-[1140px] px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold tracking-wide text-[#855E00]">
              {CULINARY_SECTION.kicker[lang]}
            </p>
            <h2 className="font-display mt-2 text-3xl font-extrabold leading-tight text-[#14231A] sm:text-[2.375rem]">
              {CULINARY_SECTION.heading[lang]}
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            {CULINARY_SECTION.dishes.map((dish, idx) => (
              <article
                key={idx}
                className="group overflow-hidden rounded-[22px] border border-[#E7E3D3] bg-white shadow-[0_12px_30px_rgba(12,63,34,0.07)] transition-transform duration-200 hover:-translate-y-1"
              >
                <div className="overflow-hidden bg-[#FFFAEB]">
                  <ResilientImage
                    src={dish.image}
                    alt={dish.alt[lang]}
                    fallbackTitle={dish.title[lang]}
                    className="aspect-[4/3] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                </div>
                <div className="p-5">
                  <h3 className="font-display text-lg font-bold text-[#14231A]">
                    {dish.title[lang]}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-[#56645A]">
                    {dish.caption[lang]}
                  </p>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-10 text-center">
            <a
              href="#order"
              onClick={(e) => {
                e.preventDefault();
                scrollToOrder();
              }}
              className="dg-btn-emerald text-base sm:text-lg"
            >
              <span>{CULINARY_SECTION.cta[lang]}</span>
              <ArrowRight className="h-5 w-5" />
            </a>
          </div>
        </div>
      </section>

      {/* 6. 4-STEP FARM-TO-KITCHEN CRAFT BAND (DEEP FOREST GREEN) */}
      <section id="craft" className="dg-process-band py-16 text-white sm:py-24">
        <div className="mx-auto max-w-[1140px] px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold tracking-wide text-[#FFD21F]">
              {PROCESS_SECTION.kicker[lang]}
            </p>
            <h2 className="font-display mt-2 text-3xl font-extrabold leading-tight text-white sm:text-[2.375rem]">
              {PROCESS_SECTION.heading[lang]}
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PROCESS_SECTION.steps.map((step, idx) => (
              <div
                key={idx}
                className="rounded-[20px] border border-white/15 bg-white/[0.07] px-5 py-7 text-center backdrop-blur-xs"
              >
                <span className="font-display mx-auto grid h-[54px] w-[54px] place-items-center rounded-full bg-[#FFD21F] text-xl font-extrabold text-[#0C3F22]">
                  {bn ? step.numBn : step.numEn}
                </span>
                <h3 className="font-display mt-4 text-lg font-bold text-white">
                  {step.title[lang]}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#D4E9DA]">
                  {step.desc[lang]}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. CUSTOMER VOICES & VERIFIED FEEDBACK */}
      <section id="reviews" className="bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-[1140px] px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold tracking-wide text-[#855E00]">
              {REVIEWS_SECTION.kicker[lang]}
            </p>
            <h2 className="font-display mt-2 text-3xl font-extrabold leading-tight text-[#14231A] sm:text-[2.375rem]">
              {REVIEWS_SECTION.heading[lang]}
            </h2>
            <p className="mt-2.5 text-base text-[#56645A]">{REVIEWS_SECTION.sub[lang]}</p>
          </div>

          {approvedReviews.length > 0 ? (
            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
              {approvedReviews.map((rev) => (
                <article
                  key={rev.id}
                  className="flex flex-col justify-between rounded-[20px] border border-[#E7E3D3] bg-white p-6 shadow-[0_14px_32px_rgba(12,63,34,0.08)]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 border-b border-[#E7E3D3] pb-3">
                      <div className="flex items-center gap-0.5 text-[#FFB800]" aria-label={`${rev.rating} out of 5 stars`}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-4 w-4 ${
                              i < rev.rating ? 'fill-[#FFB800] text-[#FFB800]' : 'text-[#E7E3D3]'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-xs font-semibold text-[#16673A]">
                        {rev.verifiedPurchase
                          ? bn
                            ? 'যাচাইকৃত ক্রেতা'
                            : 'Verified Buyer'
                          : bn
                            ? 'গ্রাহক মতামত'
                            : 'Customer Review'}
                      </span>
                    </div>
                    <p className="mt-4 text-[15px] leading-relaxed text-[#14231A]">
                      “{rev.comment}”
                    </p>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-3 border-t border-[#E7E3D3] pt-3.5 text-xs text-[#56645A]">
                    <div>
                      <p className="font-bold text-[#14231A]">{rev.customerName}</p>
                      <p>{rev.district}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleHelpful(rev.id)}
                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[#E7E3D3] px-2.5 font-semibold text-[#16673A] hover:bg-[#F4FAF5]"
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      <span className="tabular-nums">
                        {bn ? toBengaliDigits(rev.helpfulCount || 0) : rev.helpfulCount || 0}
                      </span>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
              {REVIEWS_SECTION.emptyCards.map((card, idx) => (
                <article
                  key={idx}
                  className="rounded-[20px] border border-[#E7E3D3] bg-white p-6 shadow-[0_14px_32px_rgba(12,63,34,0.08)]"
                >
                  <p className="text-xs font-bold text-[#16673A]">{card.tag[lang]}</p>
                  <h3 className="font-display mt-2 text-lg font-bold text-[#14231A]">
                    {card.title[lang]}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#56645A]">{card.body[lang]}</p>
                </article>
              ))}
            </div>
          )}

          {/* Expandable Real Review Submission Composer */}
          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={() => setShowReviewComposer((v) => !v)}
              className="btn-secondary text-sm"
            >
              <MessageSquarePlus className="h-4 w-4 text-[#16673A]" />
              <span>
                {showReviewComposer
                  ? bn
                    ? 'ফর্ম বন্ধ করুন'
                    : 'Close Review Form'
                  : bn
                    ? 'আপনার মতামত লিখুন'
                    : 'Share Your Experience'}
              </span>
            </button>
          </div>

          {showReviewComposer && (
            <form
              onSubmit={handleReviewSubmit}
              className="mx-auto mt-6 max-w-xl space-y-4 rounded-2xl border border-[#E7E3D3] bg-[#FFFDF8] p-6 shadow-[0_14px_32px_rgba(12,63,34,0.07)]"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="dg-rev-name" className="mb-1 block text-xs font-semibold text-[#14231A]">
                    {bn ? 'আপনার নাম *' : 'Your Name *'}
                  </label>
                  <input
                    id="dg-rev-name"
                    type="text"
                    required
                    value={revName}
                    onChange={(e) => setRevName(e.target.value)}
                    className="min-h-[44px] w-full rounded-xl border border-[#DFE7E1] bg-white px-3.5 text-sm text-[#14231A]"
                  />
                </div>
                <div>
                  <label htmlFor="dg-rev-district" className="mb-1 block text-xs font-semibold text-[#14231A]">
                    {bn ? 'জেলা' : 'District'}
                  </label>
                  <select
                    id="dg-rev-district"
                    value={revDistrict}
                    onChange={(e) => setRevDistrict(e.target.value)}
                    className="min-h-[44px] w-full rounded-xl border border-[#DFE7E1] bg-white px-3.5 text-sm text-[#14231A]"
                  >
                    {BANGLADESH_DISTRICTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#14231A]">
                    {bn ? 'রেটিং' : 'Rating'}
                  </label>
                  <div className="flex items-center gap-1.5 py-1.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        aria-label={`${star} stars`}
                        onClick={() => setRevRating(star)}
                        className="p-1"
                      >
                        <Star
                          className={`h-5 w-5 ${
                            star <= revRating ? 'fill-[#FFB800] text-[#FFB800]' : 'text-[#D6D3C4]'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="dg-rev-order" className="mb-1 block text-xs font-semibold text-[#14231A]">
                    {bn ? 'অর্ডার নম্বর (ঐচ্ছিক)' : 'Order Number (Optional)'}
                  </label>
                  <input
                    id="dg-rev-order"
                    type="text"
                    value={revOrderNum}
                    onChange={(e) => setRevOrderNum(e.target.value)}
                    placeholder="DG-..."
                    className="min-h-[44px] w-full rounded-xl border border-[#DFE7E1] bg-white px-3.5 font-mono text-sm text-[#14231A]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="dg-rev-comment" className="mb-1 block text-xs font-semibold text-[#14231A]">
                  {bn ? 'আপনার অভিজ্ঞতা *' : 'Your Comment *'}
                </label>
                <textarea
                  id="dg-rev-comment"
                  rows={3}
                  required
                  value={revComment}
                  onChange={(e) => setRevComment(e.target.value)}
                  className="w-full rounded-xl border border-[#DFE7E1] bg-white p-3.5 text-sm text-[#14231A]"
                />
              </div>

              {revMsg && (
                <p
                  role="status"
                  className={`text-xs font-semibold ${revMsg.ok ? 'text-[#16673A]' : 'text-[#B9382C]'}`}
                >
                  {revMsg.text}
                </p>
              )}

              <button type="submit" disabled={revBusy} className="btn-primary w-full">
                {revBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : bn ? (
                  'মতামত জমা দিন'
                ) : (
                  'Submit Review'
                )}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* 8. 4 HOME PURITY CHECKS + 9. 100% RISK-FREE GUARANTEE BANNER */}
      <section className="bg-[#FFFAEB] py-16 sm:py-24">
        <div className="mx-auto max-w-[1140px] px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold tracking-wide text-[#855E00]">
              {PURITY_TESTS_SECTION.kicker[lang]}
            </p>
            <h2 className="font-display mt-2 text-3xl font-extrabold leading-tight text-[#14231A] sm:text-[2.375rem]">
              {PURITY_TESTS_SECTION.heading[lang]}
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PURITY_TESTS_SECTION.checks.map((item) => (
              <div
                key={item.id}
                className="flex flex-col items-center rounded-[20px] border border-[#E7E3D3] border-b-4 border-b-[#FFB800] bg-white px-5 py-6 text-center shadow-[0_10px_26px_rgba(12,63,34,0.07)]"
              >
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#EAF6EE]">
                  {purityIcon(item.id)}
                </div>
                <p className="mt-4 text-[15px] font-semibold leading-relaxed text-[#14231A]">
                  {item.text[lang]}
                </p>
              </div>
            ))}
          </div>

          {/* 100% Risk-Free Guarantee Seal Card */}
          <div className="mx-auto mt-14 max-w-[880px] rounded-[26px] border-2 border-[#1F8A4C] bg-gradient-to-br from-white to-[#FFFBEA] p-6 shadow-[0_18px_40px_rgba(12,63,34,0.10)] sm:flex sm:items-center sm:gap-7 sm:p-9">
            <div className="mx-auto grid h-20 w-20 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#FFD21F] to-[#FFB800] ring-8 ring-[#FFD21F]/25 sm:mx-0 sm:h-24 sm:w-24">
              <ShieldCheck className="h-10 w-10 text-[#0C3F22] sm:h-11 sm:w-11" />
            </div>
            <div className="mt-5 text-center sm:mt-0 sm:text-left">
              <h3 className="font-display text-2xl font-extrabold text-[#0C3F22]">
                {GUARANTEE_SECTION.title[lang]}
              </h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#56645A] sm:text-base">
                {GUARANTEE_SECTION.body[lang]}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 10. 2-COLUMN EMBEDDED INSTANT CHECKOUT (#order) */}
      <EmbeddedOrderSection
        lang={lang}
        settings={settings}
        packageMeta={packageMeta}
        selectedWeight={selectedWeight}
        onSelectWeight={handleSelectWeight}
        qty={orderQty}
        onChangeQty={setOrderQty}
        onOrderConfirmed={(order) => setLastConfirmedOrder(order)}
        onNavigateTrack={(orderNumber, phone) => {
          setTrackPrefill({ order: orderNumber, phone });
          router.push(`/track?order=${encodeURIComponent(orderNumber)}`);
        }}
        onOpenCallback={openCallbackRequest}
        onOpenChat={openChatAssistant}
      />

      {/* 11. 5-QUESTION ACCORDION FAQ */}
      <section id="faq" className="bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-[820px] px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-sm font-bold tracking-wide text-[#855E00]">
              {bn ? 'প্রশ্ন ও উত্তর' : 'Frequently Asked Questions'}
            </p>
            <h2 className="font-display mt-2 text-3xl font-extrabold leading-tight text-[#14231A] sm:text-[2.375rem]">
              {bn ? 'আপনার মনে যে প্রশ্নগুলো আসতে পারে' : 'Answers Before You Order'}
            </h2>
          </div>

          <div className="mt-9 space-y-3">
            {faqList.map((item, idx) => {
              const isOpen = openFaqIdx === idx;
              return (
                <div
                  key={idx}
                  className={`overflow-hidden rounded-2xl border transition-colors ${
                    isOpen ? 'border-[#1F8A4C] bg-[#FAFDFB]' : 'border-[#E7E3D3] bg-white'
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                    className="flex min-h-[58px] w-full items-center justify-between gap-4 px-5 py-4 text-left text-base font-bold text-[#14231A] sm:px-6"
                  >
                    <span>{item.q[lang]}</span>
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-[#16673A] transition-transform duration-200 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="border-t border-[#E7E3D3]/80 px-5 py-4 text-[15px] leading-relaxed text-[#56645A] sm:px-6">
                      {item.a[lang]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 12. CLOSING DEEP-GREEN OFFER BANNER */}
      <section className="dg-closing-band py-16 text-center text-white sm:py-20">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-extrabold leading-tight text-white sm:text-[2.375rem]">
            {CLOSING_CTA.heading[lang]}
          </h2>
          <p className="mt-3 text-base text-[#E2F2E6] sm:text-lg">
            {CLOSING_CTA.sub[lang]}
          </p>
          <div className="mt-7">
            <a
              href="#order"
              onClick={(e) => {
                e.preventDefault();
                scrollToOrder();
              }}
              className="dg-btn-gold text-lg"
            >
              <span>{CLOSING_CTA.button[lang]}</span>
              <ArrowRight className="h-5 w-5" />
            </a>
          </div>
        </div>
      </section>

      {/* 13. COMPACT MOBILE STICKY BOTTOM BAR (<= 12% viewport height, hides when #order visible) */}
      <div
        className={`no-print fixed right-3 bottom-3 left-3 z-30 transition-all duration-200 md:hidden ${
          hideStickyBar ? 'pointer-events-none translate-y-24 opacity-0' : 'translate-y-0 opacity-100'
        }`}
      >
        <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[#0C3F22] py-2.5 pr-2.5 pl-4 text-white shadow-[0_14px_34px_rgba(0,0,0,0.28)]">
          <div className="min-w-0">
            <span className="block truncate text-[11px] text-[#C5E2CE]">
              {bn ? selectedOption.labelBn : selectedOption.labelEn} ·{' '}
              {bn ? 'ক্যাশ অন ডেলিভারি' : 'Cash on Delivery'}
            </span>
            <strong className="block truncate text-sm font-extrabold text-white tabular-nums">
              {heroConfirmedPrice !== null
                ? formatPrice(heroConfirmedPrice, lang)
                : 'Deshi Gee'}
            </strong>
          </div>
          <a
            href="#order"
            onClick={(e) => {
              e.preventDefault();
              scrollToOrder();
            }}
            className="inline-flex min-h-[42px] shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-[#FFD21F] px-4 text-sm font-extrabold text-[#0C3F22]"
          >
            {bn ? 'অর্ডার করুন' : 'Order Now'}
          </a>
        </div>
      </div>
    </main>
  );
}
