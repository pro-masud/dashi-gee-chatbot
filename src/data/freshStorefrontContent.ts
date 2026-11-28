import type { DeliveryZone, StoreSettingsDoc, WeightKey } from '../lib/storeTypes';
import {
  getConfirmedDeliveryFeeForZone,
  getConfirmedPriceForWeight,
} from '../lib/storeTypes';
import type { PublicPackages } from '../lib/packages/packages';

export type FreshLang = 'bn' | 'en';

export interface BilingualText {
  bn: string;
  en: string;
}

/**
 * 100% brand-new AI-generated photography for the recreated Deshi Gee storefront.
 * Zero previous storefront images are referenced here.
 */
export const FRESH_IMAGES = {
  heroJar: '/assets/images/fresh/fresh_hero_jar_1795855973640.jpg',
  craftSimmer: '/assets/images/fresh/fresh_craft_simmer_1795855977452.jpg',
  dishPulao: '/assets/images/fresh/fresh_dish_pulao_1795855976821.jpg',
  dishRice: '/assets/images/fresh/fresh_dish_rice_1795855977675.jpg',
  dishPitha: '/assets/images/fresh/fresh_dish_pitha_1795855977839.jpg',
  checkoutJar: '/assets/images/fresh/fresh_checkout_jar_1795855978108.jpg',
} as const;

export const FRESH_WEIGHT_OPTIONS: {
  weight: WeightKey;
  labelBn: string;
  labelEn: string;
  subtitleBn: string;
  subtitleEn: string;
  flagship?: boolean;
}[] = [
  {
    weight: '1kg',
    labelBn: '১ কেজি জার',
    labelEn: '1 kg Jar',
    subtitleBn: 'পরিবারের সেরা পছন্দ',
    subtitleEn: 'Family flagship jar',
    flagship: true,
  },
  {
    weight: '500g',
    labelBn: '৫০০ গ্রাম জার',
    labelEn: '500g Jar',
    subtitleBn: 'প্রতিদিনের রান্নার জন্য',
    subtitleEn: 'Everyday kitchen size',
  },
  {
    weight: '250g',
    labelBn: '২৫০ গ্রাম জার',
    labelEn: '250g Jar',
    subtitleBn: 'প্রথমবার স্বাদ যাচাইয়ে',
    subtitleEn: 'First-time tasting jar',
  },
];

export const ANNOUNCEMENT_HIGHLIGHTS: BilingualText[] = [
  {
    bn: 'সারা বাংলাদেশে হোম ডেলিভারি',
    en: 'Home Delivery Across Bangladesh',
  },
  {
    bn: 'পণ্য হাতে পেয়ে টাকা পরিশোধ',
    en: 'Cash on Delivery Available',
  },
  {
    bn: 'দেখে ও ঘ্রাণ নিয়ে তারপর গ্রহণ করুন',
    en: 'Inspect & Smell Before Paying',
  },
];

export const HERO_CONTENT = {
  originKicker: {
    bn: 'পাবনা ও সিরাজগঞ্জের গ্রামীণ ঐতিহ্য',
    en: 'Heritage Craft of Pabna & Sirajganj',
  },
  headlinePrefix: {
    bn: 'দেশি গরুর টাটকা দুধ থেকে তৈরি',
    en: 'Crafted from Fresh Rural Cow Milk —',
  },
  headlineHighlight: {
    bn: 'খাঁটি দানাদার গাওয়া ঘি',
    en: 'Pure Granular Deshi Ghee',
  },
  subheadline: {
    bn: 'মৃদু আঁচে ধীরে জ্বাল দেওয়া, সোনালি দানাদার আর মনকাড়া সুঘ্রাণ। প্রতিদিনের গরম ভাত কিংবা উৎসবের রান্নায় ফিরিয়ে আনবে চিরচেনা ঘরের স্বাদ।',
    en: 'Slow-simmered over gentle heat for natural golden grains and warm nutty aroma—bringing nostalgic home-cooked richness back to every meal.',
  },
  ctaLabel: {
    bn: 'এখনই অর্ডার করুন',
    en: 'Order Your Jar Now',
  },
  priceNoteConfirmed: {
    bn: 'সারা বাংলাদেশে ক্যাশ অন ডেলিভারি',
    en: 'Cash on delivery nationwide',
  },
  priceNotePending: {
    bn: 'লাইভ মূল্য স্টোর অ্যাডমিন থেকে হালনাগাদ হচ্ছে',
    en: 'Live jar pricing is being updated by the store',
  },
  trustChecks: [
    { bn: 'ক্যাশ অন ডেলিভারি', en: 'Cash on Delivery' },
    { bn: 'শতভাগ ভেজালমুক্ত', en: 'Zero Adulteration' },
    { bn: 'নিজস্ব তত্ত্বাবধানে তৈরি', en: 'Small-Batch Crafted' },
  ],
  floatTop: {
    bn: 'দেশি গরুর খাঁটি দুধ',
    en: 'Pure Rural Cow Milk',
  },
  floatBottom: {
    bn: 'মৃদু আঁচে ধীরে জ্বাল',
    en: 'Gentle Slow Simmer',
  },
};

export const TRUST_BAR_ITEMS: {
  id: 'delivery' | 'cod' | 'inspect' | 'pure';
  title: BilingualText;
  sub: BilingualText;
}[] = [
  {
    id: 'delivery',
    title: { bn: 'সারা দেশে ডেলিভারি', en: 'Nationwide Delivery' },
    sub: { bn: 'ঢাকা ও ৬৪ জেলায়', en: 'Dhaka & 64 districts' },
  },
  {
    id: 'cod',
    title: { bn: 'ক্যাশ অন ডেলিভারি', en: 'Cash on Delivery' },
    sub: { bn: 'আগে টাকা দিতে হবে না', en: 'Pay when jar arrives' },
  },
  {
    id: 'inspect',
    title: { bn: 'দেখে ও ঘ্রাণ নিয়ে নিন', en: 'Check Before Paying' },
    sub: { bn: 'পছন্দ হলে তবেই পেমেন্ট', en: 'Inspect aroma & grain first' },
  },
  {
    id: 'pure',
    title: { bn: 'কোনো মিশ্রণ নেই', en: 'Pure & Unblended' },
    sub: { bn: 'রং বা ফ্লেভার ছাড়াই তৈরি', en: 'No artificial color or essence' },
  },
];

export const PROBLEM_SECTION = {
  kicker: { bn: 'একটু ভেবে দেখুন', en: 'Pause & Think' },
  heading: {
    bn: 'বাজারের সাধারণ ঘি কি সত্যিই নিশ্চিন্তে খাওয়া যায়?',
    en: 'Can You Truly Trust Commercial Shelf Ghee?',
  },
  sub: {
    bn: 'ভালো দাম দিয়ে কিনেও অনেক সময় আসল ঘ্রাণ বা স্বাদ পাওয়া যায় না। বাজারে প্রচলিত অনেক ঘিয়েই থাকে—',
    en: 'Even at a high price, many store-bought jars disappoint families with hidden shortcuts—',
  },
  points: [
    {
      bn: 'ডালডা, পাম অয়েল বা বনস্পতি মেশানো চটচটে মিশ্রণ',
      en: 'Blended with palm oil, dalda, or heavy vegetable fats',
    },
    {
      bn: 'কৃত্রিম এসেন্স আর হলুদ রং দিয়ে তৈরি নকল ঘ্রাণ',
      en: 'Synthetic butter essence and artificial yellow coloring',
    },
    {
      bn: 'কোথা থেকে দুধ এলো বা কীভাবে বানানো হলো তার কোনো নিশ্চয়তা নেই',
      en: 'No transparency on milk origin or preparation method',
    },
    {
      bn: 'বাচ্চা ও পরিবারের বয়স্কদের খাওয়াতে গিয়ে সবসময় মনের খটকা',
      en: 'Constant hesitation when serving children and elderly family',
    },
  ],
  resolutionPrefix: {
    bn: 'এই ভাবনা থেকেই আমাদের নিজস্ব উদ্যোগ —',
    en: 'That is exactly why we prepare every batch ourselves —',
  },
  resolutionBrand: {
    bn: 'Deshi Gee-এর খাঁটি গাওয়া ঘি',
    en: 'Deshi Gee Pure Artisanal Cow Ghee',
  },
};

export const WHY_SECTION = {
  kicker: { bn: 'কেন Deshi Gee বেছে নেবেন', en: 'Why Families Choose Deshi Gee' },
  heading: {
    bn: 'যে ৪টি কারণে আমাদের ঘির স্বাদ ও ঘ্রাণ অনন্য',
    en: 'Four Craft Standards That Set Our Ghee Apart',
  },
  pillars: [
    {
      id: 'milk' as const,
      title: { bn: 'গ্রামীণ খামারের টাটকা দুধ', en: 'Fresh Rural Dairy Milk' },
      desc: {
        bn: 'পাবনা-সিরাজগঞ্জ অঞ্চলের গৃহস্থ খামারের দেশি গরুর ভোরের টাটকা দুধ থেকে সংগ্রহ করা খাঁটি সর ও ক্রিম।',
        en: 'Morning whole milk gathered directly from rural dairy households across Pabna and Sirajganj.',
      },
    },
    {
      id: 'simmer' as const,
      title: { bn: 'ঐতিহ্যবাহী মৃদু জ্বাল', en: 'Traditional Slow Simmering' },
      desc: {
        bn: 'তাড়াহুড়ো না করে ধীর আঁচে সময় নিয়ে জ্বাল দেওয়া হয়—তাতেই তৈরি হয় সোনালি রং আর প্রাকৃতিক দানাদার গঠন।',
        en: 'Patient low-flame clarification develops the unmistakable sweet aroma and natural grainy texture.',
      },
    },
    {
      id: 'direct' as const,
      title: { bn: 'মধ্যস্বত্বভোগী ছাড়াই সরাসরি', en: 'Direct Small-Batch Kitchen' },
      desc: {
        bn: 'সংগ্রহ থেকে জারে সিল করা পর্যন্ত প্রতিটি ধাপ আমাদের নিজস্ব তত্ত্বাবধানে সম্পন্ন হয়, মাঝখানে হাতবদল নেই।',
        en: 'Controlled from milk collection to airtight glass sealing with zero middlemen or bulk repackaging.',
      },
    },
    {
      id: 'clean' as const,
      title: { bn: 'সম্পূর্ণ প্রাকৃতিক ও নিখাদ', en: 'Zero Additives or Fillers' },
      desc: {
        bn: 'কোনো ডালডা, ভোজ্য তেল, কৃত্রিম রং, ফ্লেভার কিংবা প্রিজারভেটিভ ছাড়াই একদম ঘরোয়া বিশুদ্ধতায় তৈরি।',
        en: 'Strictly free from vegetable fat, synthetic fragrance, coloring agents, or chemical preservatives.',
      },
    },
  ],
};

export const CULINARY_SECTION = {
  kicker: { bn: 'প্রতিদিনের রান্নাঘরে', en: 'At Your Everyday Table' },
  heading: {
    bn: 'এক চামচ খাঁটি ঘি, পাল্টে দেয় পুরো খাবারের আমেজ',
    en: 'One Spoonful Elevates Every Familiar Meal',
  },
  cta: {
    bn: 'আমার পরিবারের জন্য অর্ডার করুন',
    en: 'Order for Your Kitchen',
  },
  dishes: [
    {
      image: FRESH_IMAGES.dishPulao,
      alt: {
        bn: 'পোলাও ও বিরিয়ানির ওপর সোনালি গাওয়া ঘি',
        en: 'Golden cow ghee drizzled over fragrant saffron pulao and biryani',
      },
      title: { bn: 'পোলাও, বিরিয়ানি ও খিচুড়ি', en: 'Pulao, Biryani & Khichuri' },
      caption: {
        bn: 'ঘরোয়া রান্নাতেও ছড়িয়ে দেয় উৎসবের শাহি ঘ্রাণ',
        en: 'Turns weekend cooking into a fragrant festive spread',
      },
    },
    {
      image: FRESH_IMAGES.dishRice,
      alt: {
        bn: 'গরম সাদা ভাত ও ডালের সাথে গলানো খাঁটি ঘি',
        en: 'Steaming white rice with melting golden ghee and yellow lentil dal',
      },
      title: { bn: 'ধোঁয়া ওঠা গরম ভাত ও ডাল', en: 'Steaming Hot Rice & Dal' },
      caption: {
        bn: 'এক চামচ ঘি আর কাঁচামরিচ—বাঙালির চিরন্তন তৃপ্তি',
        en: 'A comforting spoonful over hot rice that needs nothing else',
      },
    },
    {
      image: FRESH_IMAGES.dishPitha,
      alt: {
        bn: 'ঐতিহ্যবাহী পায়েস ও পাটিসাপটা পিঠা',
        en: 'Traditional Bengali payesh rice pudding and golden patishapta pitha',
      },
      title: { bn: 'পায়েস, হালুয়া ও পিঠাপুলি', en: 'Payesh, Halwa & Pitha' },
      caption: {
        bn: 'শহরের ব্যস্ত রান্নাঘরেও ফিরিয়ে আনে গ্রামের মিষ্টান্নের স্বাদ',
        en: 'Brings traditional village dessert aroma into modern homes',
      },
    },
  ],
};

export const PROCESS_SECTION = {
  kicker: { bn: 'তৈরির প্রতিটি ধাপ', en: 'From Farm to Glass Jar' },
  heading: {
    bn: 'খামার থেকে সরাসরি আপনার খাবার টেবিলে',
    en: 'Four Careful Steps Behind Every Sealed Jar',
  },
  steps: [
    {
      numBn: '০১',
      numEn: '01',
      title: { bn: 'ভোরের দুধ সংগ্রহ', en: 'Morning Milk Sourcing' },
      desc: {
        bn: 'নির্বাচিত খামার থেকে দেশি গরুর টাটকা দুধ সংগ্রহ',
        en: 'Fresh whole milk collected from trusted rural farms',
      },
    },
    {
      numBn: '০২',
      numEn: '02',
      title: { bn: 'খাঁটি সর ও মাখন তোলা', en: 'Natural Butter Extraction' },
      desc: {
        bn: 'যত্নসহকারে দুধের ক্রিম ও মাখন আলাদা করা',
        en: 'Rich natural butter carefully separated without shortcuts',
      },
    },
    {
      numBn: '০৩',
      numEn: '03',
      title: { bn: 'মৃদু আঁচে জ্বাল দেওয়া', en: 'Slow Flame Clarification' },
      desc: {
        bn: 'ধীরে ধীরে জ্বাল দিয়ে আসল ঘ্রাণ ও সোনালি আভা আনা',
        en: 'Gentle slow simmering for rich nutty aroma and clarity',
      },
    },
    {
      numBn: '০৪',
      numEn: '04',
      title: { bn: 'ছেঁকে জারে এয়ারটাইট সিল', en: 'Strained & Airtight Sealed' },
      desc: {
        bn: 'পরিষ্কার কাপড়ে ছেঁকে ব্যাচ কোডসহ কাচের জারে প্যাকিং',
        en: 'Fine-strained and tamper-sealed warm in clean glass jars',
      },
    },
  ],
};

export const REVIEWS_SECTION = {
  kicker: { bn: 'গ্রাহকদের অনুভূতি', en: 'Customer Voices' },
  heading: {
    bn: 'যাঁরা পরিবারকে খাওয়াচ্ছেন, তাঁদের মতামত',
    en: 'What Families Say After Opening Their Jar',
  },
  sub: {
    bn: 'Deshi Gee-এর যাচাইকৃত গ্রাহকদের বাস্তব অভিজ্ঞতা ও মন্তব্য',
    en: 'Real approved feedback shared directly by Deshi Gee customers',
  },
  emptyCards: [
    {
      tag: { bn: 'যাচাইকৃত অভিজ্ঞতা', en: 'Open-Jar Inspection' },
      title: { bn: 'খুলেই চেনা যায় আসল ঘ্রাণ', en: 'Aroma You Recognize Instantly' },
      body: {
        bn: 'গ্রাহকরা ডেলিভারির সময় ঢাকনা খুলে দানাদার গঠন আর প্রাকৃতিক ঘ্রাণ দেখে তবেই অর্ডার গ্রহণ করেন।',
        en: 'Buyers are welcome to open the seal at delivery and verify the natural grain and warm aroma before paying.',
      },
    },
    {
      tag: { bn: 'ব্যাচ স্বচ্ছতা', en: 'Batch Transparency' },
      title: { bn: 'প্রতিটি জারে ব্যাচ যাচাইয়ের সুযোগ', en: 'Trace Every Small Batch' },
      body: {
        bn: 'জারের গায়ের ব্যাচ কোড দিয়ে আমাদের ব্যাচ যাচাই পাতায় উৎপাদন তথ্য দেখে নেওয়ার সুবিধা রয়েছে।',
        en: 'Check preparation notes and batch details anytime on our dedicated Batch Verification page.',
      },
    },
    {
      tag: { bn: 'আপনার মতামত দিন', en: 'Share Your Review' },
      title: { bn: 'আপনার অভিজ্ঞতা অন্যদের সাহায্য করে', en: 'Already Tried Deshi Gee?' },
      body: {
        bn: 'আমাদের ঘি ব্যবহার করে থাকলে নিচের বাটনে ক্লিক করে আপনার সত্যিকারের মতামত জমা দিন—অনুমোদনের পর এখানে প্রকাশিত হবে।',
        en: 'Submit your honest review below with your order number—approved reviews appear right here for other families.',
      },
    },
  ],
};

export const PURITY_TESTS_SECTION = {
  kicker: { bn: 'নিজেই পরখ করুন', en: 'Simple Home Checks' },
  heading: {
    bn: 'ঘরে বসেই খাঁটি গাওয়া ঘি চেনার ৪টি সহজ উপায়',
    en: 'Four Simple Ways to Check Pure Ghee at Home',
  },
  checks: [
    {
      id: 'palm' as const,
      text: {
        bn: 'হাতের তালুতে সামান্য ঘি নিলে শরীরের স্বাভাবিক তাপেই ধীরে গলে যাবে',
        en: 'A small dab on your warm palm melts gently from natural body warmth',
      },
    },
    {
      id: 'grain' as const,
      text: {
        bn: 'স্বাভাবিক ঠান্ডায় জমলে চিকচিকে দানাদার হয়—সাদা মোমের মতো জমাট বাঁধে না',
        en: 'Sets into soft golden grains when cool, never waxy or chalky white',
      },
    },
    {
      id: 'aroma' as const,
      text: {
        bn: 'গরম ভাতে বা কড়াইয়ে দিলে প্রাকৃতিক মিষ্টি সুঘ্রাণ ছড়িয়ে পড়ে',
        en: 'Releases a warm, comforting nutty aroma as soon as it meets hot food',
      },
    },
    {
      id: 'clarity' as const,
      text: {
        bn: 'গলানো অবস্থায় পরিষ্কার সোনালি রং থাকে, নিচে কোনো ভারী তেলতেলে তলানি পড়ে না',
        en: 'Melts clear and golden with zero heavy oily sediment at the bottom',
      },
    },
  ],
};

export const GUARANTEE_SECTION = {
  title: {
    bn: '১০০% ঝুঁকিমুক্ত অর্ডার নিশ্চয়তা',
    en: '100% Risk-Free Inspect-Before-Paying Promise',
  },
  body: {
    bn: 'অগ্রিম এক টাকাও নয়। ডেলিভারি প্রতিনিধির সামনেই জার খুলে দানাদার গঠন দেখুন ও ঘ্রাণ যাচাই করুন। আপনার প্রত্যাশা অনুযায়ী মনে হলে তবেই মূল্য পরিশোধ করুন—পছন্দ না হলে সাথে সাথেই ফেরত দেওয়ার সুযোগ থাকছে।',
    en: 'Zero advance required for Cash on Delivery. Open the jar in front of the delivery rider to inspect the golden grain and natural aroma. Pay only when you are completely satisfied.',
  },
};

export const CHECKOUT_SECTION = {
  kicker: { bn: 'সহজ অর্ডার ফর্ম', en: 'Direct Order Form' },
  heading: {
    bn: 'মাত্র কয়েকটি তথ্য দিয়েই অর্ডার সম্পন্ন করুন',
    en: 'Complete Your Order in Under a Minute',
  },
  sub: {
    bn: 'পছন্দের জার বেছে নিন, নাম, মোবাইল নম্বর আর ডেলিভারি ঠিকানা দিন—আমাদের টিম দ্রুত নিশ্চিত করবে।',
    en: 'Pick your jar size and fill in your delivery details below. Our team confirms every order promptly.',
  },
};

export const FRESH_FAQS: { q: BilingualText; a: BilingualText }[] = [
  {
    q: {
      bn: 'অর্ডার করার কতদিনের মধ্যে ঘি হাতে পাব?',
      en: 'How long does home delivery take?',
    },
    a: {
      bn: 'সাধারণত ঢাকা মেট্রোপলিটন এলাকায় ১–২ কর্মদিবস এবং ঢাকার বাইরে দেশের অন্যান্য জেলায় ২–৪ কর্মদিবসের মধ্যে হোম ডেলিভারি পৌঁছায়।',
      en: 'Inside Dhaka delivery usually arrives within 1–2 working days, and nationwide deliveries across Bangladesh take 2–4 working days.',
    },
  },
  {
    q: {
      bn: 'ডেলিভারি চার্জ কত টাকা লাগবে?',
      en: 'How is the delivery charge calculated?',
    },
    a: {
      bn: 'আপনার জেলা ও এলাকা নির্বাচন করার সাথে সাথেই অর্ডার ফর্মে আমাদের নির্ধারিত ডেলিভারি চার্জ এবং ফ্রি ডেলিভারি সুবিধা (যদি প্রযোজ্য হয়) স্পষ্টভাবে দেখানো হয়।',
      en: 'Exact delivery charges—and any active free-delivery threshold—calculate automatically in the checkout summary as soon as you select your district.',
    },
  },
  {
    q: {
      bn: 'মূল্য পরিশোধের নিয়ম কী?',
      en: 'How do I pay for my order?',
    },
    a: {
      bn: 'আপনি সম্পূর্ণ নিশ্চিন্তে ক্যাশ অন ডেলিভারিতে পণ্য হাতে পেয়ে টাকা পরিশোধ করতে পারবেন। পাশাপাশি স্টোরে চালু থাকলে মোবাইল ব্যাংকিং অপশনও বেছে নিতে পারবেন।',
      en: 'Cash on Delivery is our default option—pay only after your jar arrives. Any configured mobile payment options are also shown clearly at checkout.',
    },
  },
  {
    q: {
      bn: 'জার হাতে পেয়ে পছন্দ না হলে বা ক্ষতিগ্রস্ত হলে কী করব?',
      en: 'What if a jar arrives damaged or does not meet expectations?',
    },
    a: {
      bn: 'ডেলিভারি ম্যানের সামনেই পার্সেল ও ঘ্রাণ যাচাই করে নিতে পারবেন। সিল খোলা বা ক্ষতিগ্রস্ত পার্সেল দেখলে সাথে সাথেই ফেরত দিন অথবা আমাদের সাপোর্টে যোগাযোগ করুন।',
      en: 'Inspect your parcel and tamper seal at delivery. If anything looks damaged or unsatisfactory, you can decline it on the spot or message our support team.',
    },
  },
  {
    q: {
      bn: 'খাঁটি গাওয়া ঘি ঘরে কীভাবে সংরক্ষণ করলে দীর্ঘদিন ভালো থাকবে?',
      en: 'How should I store Deshi Gee at home?',
    },
    a: {
      bn: 'ঘি সবসময় শুকনো ও পরিষ্কার চামচ দিয়ে তুলুন এবং ব্যবহারের পর ঢাকনা শক্ত করে বন্ধ করে ঠান্ডা ও শুকনো স্থানে রাখুন। পানি না লাগলে সাধারণ তাপমাত্রাতেই দীর্ঘদিন চমৎকার ঘ্রাণ অটুট থাকে।',
      en: 'Always scoop with a clean, completely dry spoon and seal the lid tightly in a cool, dry cabinet away from direct sunlight—no refrigeration required.',
    },
  },
];

export const CLOSING_CTA = {
  heading: {
    bn: 'আজই আপনার পরিবারের জন্য খাঁটি ঘি ঘরে আনুন',
    en: 'Bring Pure Artisanal Ghee Home to Your Family Today',
  },
  sub: {
    bn: 'দেখে, ঘ্রাণ নিয়ে তারপর পরিশোধ—নিশ্চিন্তে এখনই আপনার পছন্দের জার অর্ডার করুন।',
    en: 'Inspect and smell before you pay—select your jar size and place your order with confidence.',
  },
  button: {
    bn: 'এখনই অর্ডার করুন',
    en: 'Order Now',
  },
};

export function getFreshStockForWeight(
  settings: StoreSettingsDoc,
  weight: WeightKey
): number {
  if (weight === '250g') return Number(settings.stock250g || 0);
  if (weight === '500g') return Number(settings.stock500g || 0);
  return Number(settings.stock1kg || 0);
}

/**
 * Pure helper: selects the flagship 1kg jar when enabled & in stock, falling back cleanly
 * to the owner-configured default or first available jar weight.
 */
export function resolvePreferredFlagshipWeight(
  settings: StoreSettingsDoc,
  packageMeta: PublicPackages | null
): WeightKey {
  const order: WeightKey[] = ['1kg', '500g', '250g'];
  const isAvailable = (w: WeightKey) => {
    const enabled = packageMeta ? packageMeta[w]?.enabled !== false : true;
    const stock = getFreshStockForWeight(settings, w);
    const price = getConfirmedPriceForWeight(settings, w);
    return enabled && (price === null || stock > 0);
  };
  const preferred = order.find(isAvailable);
  if (preferred) return preferred;
  const enabledFallback = order.find((w) => (packageMeta ? packageMeta[w]?.enabled !== false : true));
  return enabledFallback || '1kg';
}

export interface CheckoutTotalsResult {
  unitPriceBdt: number | null;
  subtotalBdt: number | null;
  deliveryFeeBdt: number | null;
  isFreeDelivery: boolean;
  discountBdt: number;
  totalBdt: number | null;
}

/**
 * Pure helper: computes live storefront checkout totals from owner-confirmed settings.
 * Returns null monetary fields whenever owner-confirmed pricing is not yet active.
 */
export function computeFreshCheckoutTotals(params: {
  settings: StoreSettingsDoc;
  weight: WeightKey;
  qty: number;
  zone: DeliveryZone;
  discountBdt?: number;
}): CheckoutTotalsResult {
  const safeQty = Math.max(1, Math.min(20, Math.floor(params.qty || 1)));
  const unitPriceBdt = getConfirmedPriceForWeight(params.settings, params.weight);
  const baseDeliveryFee = getConfirmedDeliveryFeeForZone(params.settings, params.zone);

  if (unitPriceBdt === null) {
    return {
      unitPriceBdt: null,
      subtotalBdt: null,
      deliveryFeeBdt: baseDeliveryFee,
      isFreeDelivery: baseDeliveryFee === 0,
      discountBdt: 0,
      totalBdt: null,
    };
  }

  const subtotalBdt = unitPriceBdt * safeQty;
  const threshold = params.settings.freeDeliveryThreshold || 0;
  const qualifiesFree = threshold > 0 && subtotalBdt >= threshold;
  const deliveryFeeBdt =
    baseDeliveryFee === null ? null : qualifiesFree ? 0 : baseDeliveryFee;
  const safeDiscount = Math.max(0, Math.min(subtotalBdt, Math.floor(params.discountBdt || 0)));
  const totalBdt =
    deliveryFeeBdt === null ? null : Math.max(0, subtotalBdt - safeDiscount + deliveryFeeBdt);

  return {
    unitPriceBdt,
    subtotalBdt,
    deliveryFeeBdt,
    isFreeDelivery: deliveryFeeBdt === 0,
    discountBdt: safeDiscount,
    totalBdt,
  };
}

export interface CheckoutFormValidationInput {
  customerName: string;
  phone: string;
  district: string;
  address: string;
  lang: FreshLang;
}

/**
 * Pure helper: validates required customer checkout inputs before hitting /api/orders/storefront.
 */
export function validateFreshCheckoutInput(
  input: CheckoutFormValidationInput
): { ok: true } | { ok: false; field: 'name' | 'phone' | 'address'; message: string } {
  const bn = input.lang === 'bn';
  const name = input.customerName.trim();
  if (name.length < 2) {
    return {
      ok: false,
      field: 'name',
      message: bn ? 'অনুগ্রহ করে আপনার পূর্ণ নাম লিখুন।' : 'Please enter your full name.',
    };
  }

  const digits = input.phone.replace(/[^\d]/g, '');
  const normalized = digits.startsWith('880') && digits.length === 13 ? `0${digits.slice(3)}` : digits;
  if (!/^01[3-9]\d{8}$/.test(normalized)) {
    return {
      ok: false,
      field: 'phone',
      message: bn
        ? 'সঠিক ১১ সংখ্যার বাংলাদেশি মোবাইল নম্বর দিন (যেমন: 017XXXXXXXX)।'
        : 'Please enter a valid 11-digit Bangladesh mobile number (e.g. 017XXXXXXXX).',
    };
  }

  const address = input.address.trim();
  if (address.length < 8) {
    return {
      ok: false,
      field: 'address',
      message: bn
        ? 'ডেলিভারির জন্য বাসা/রোড ও এলাকাসহ সম্পূর্ণ ঠিকানা লিখুন।'
        : 'Please provide your full house, road, and area address for delivery.',
    };
  }

  return { ok: true };
}
