import { WeightKey } from '../lib/firebase';

export type Lang = 'en' | 'bn';

export const IMAGES = {
  heroFront: '/assets/images/hero_deshi_jar_1794893673264.jpg',
  sidePackaging: '/assets/images/jar_side_packaging_1794894505096.jpg',
  packagingDetail: '/assets/images/jar_packaging_detail_1794894506736.jpg',
  tableJar: '/assets/images/product_cow_ghee_1794893675325.jpg',
  milkSourcing: '/assets/images/craft_milk_sourcing_1794894506133.jpg',
  bilonaChurn: '/assets/images/craft_bilona_churning_1794893676123.jpg',
  clayClarify: '/assets/images/craft_clay_clarification_1794893678993.jpg',
  textureDanadar: '/assets/images/texture_danadar_crystals_1794893677111.jpg',
  textureLiquid: '/assets/images/texture_liquid_gold_1794893678986.jpg',
  founderPortrait: '/assets/images/founder_farm_portrait_1794894506240.jpg',
  dishKhichuri: '/assets/images/dish_khichuri_1794894507100.jpg',
  dishPolao: '/assets/images/dish_polao_1794894507526.jpg',
  dishBhaat: '/assets/images/dish_bhaat_ghee_1794894508075.jpg',
  dishHalua: '/assets/images/dish_halua_1794894508831.jpg',
  dishParatha: '/assets/images/dish_paratha_1794894509471.jpg',
} as const;

export interface GalleryItem {
  id: 'front' | 'side' | 'texture' | 'packaging';
  src: string;
  labelEn: string;
  labelBn: string;
  altEn: string;
  altBn: string;
}

export const PRODUCT_GALLERY: GalleryItem[] = [
  {
    id: 'front',
    src: IMAGES.heroFront,
    labelEn: 'Front Jar',
    labelBn: 'সম্মুখ জার',
    altEn: 'Deshi Gee clear glass apothecary jar front view with brass lid and cream cotton label',
    altBn: 'পিতলের ঢাকনা ও ক্রিম লেবেলসহ দেশী ঘি কাঁচের জারের সামনের দৃশ্য',
  },
  {
    id: 'side',
    src: IMAGES.sidePackaging,
    labelEn: 'Side Seal',
    labelBn: 'পার্শ্ব সিল',
    altEn: 'Side view of Deshi Gee jar with jute twine batch tag showing golden granular texture',
    altBn: 'ব্যাচ ট্যাগ ও পাটের দড়িসহ দেশী ঘিয়ের জারের পার্শ্ব দৃশ্য',
  },
  {
    id: 'texture',
    src: IMAGES.textureDanadar,
    labelEn: 'Danadar Macro',
    labelBn: 'দানাদার টেক্সচার',
    altEn: 'Close-up macro of golden granular danadar Deshi Cow Ghee on a hammered brass spoon',
    altBn: 'পিতলের চামচে সোনালী দানাদার দেশী গরুর ঘিয়ের ক্লোজ-আপ',
  },
  {
    id: 'packaging',
    src: IMAGES.packagingDetail,
    labelEn: 'Box & Seal',
    labelBn: 'প্যাকেজিং',
    altEn: 'Protective linen and kraft parcel wrapping with wax batch seal and wooden spoon',
    altBn: 'লিনেন ও মোমের সিলসহ দেশী ঘিয়ের সুরক্ষিত প্যাকেজিং',
  },
];

export const WEIGHT_VARIANTS: {
  key: WeightKey;
  labelEn: string;
  labelBn: string;
  jarHeightNoteEn: string;
  jarHeightNoteBn: string;
  scale: number;
}[] = [
  {
    key: '250g',
    labelEn: '250g',
    labelBn: '২৫০ গ্রাম',
    jarHeightNoteEn: 'Starter Apothecary Glass Jar',
    jarHeightNoteBn: 'ছোট কাঁচের বয়াম',
    scale: 0.9,
  },
  {
    key: '500g',
    labelEn: '500g',
    labelBn: '৫০০ গ্রাম',
    jarHeightNoteEn: 'Family Kitchen Glass Jar',
    jarHeightNoteBn: 'পরিবারের নিয়মিত কাঁচের বয়াম',
    scale: 1.0,
  },
  {
    key: '1kg',
    labelEn: '1kg',
    labelBn: '১ কেজি',
    jarHeightNoteEn: 'Household Reserve Glass Jar',
    jarHeightNoteBn: 'বড় পারিবারিক কাঁচের বয়াম',
    scale: 1.08,
  },
];

export const CRAFT_STAGES = [
  {
    index: '01',
    titleEn: 'Milk Sourcing & Preparation',
    titleBn: 'পাবনার তাজা দুধ সংগ্রহ',
    subEn: 'Single-origin whole morning milk from Pabna grass-fed cows',
    subBn: 'পাবনার চারণভূমির দেশী গরুর সকালের খাঁটি দুধ',
    detailEn:
      'Collected fresh at dawn from local Pabna dairy households, gently boiled in thick vessels and cooled to natural culturing warmth.',
    detailBn:
      'ভোরবেলা পাবনার খামার থেকে সংগৃহীত খাঁটি দুধ মৃদু আঁচে জ্বাল দিয়ে স্বাভাবিক তাপমাত্রায় ঠান্ডা করা হয়।',
    image: IMAGES.milkSourcing,
    altEn: 'Deshi cows grazing at sunrise along green Pabna river pastures with brass milk vessel',
    altBn: 'ভোরের আলোয় পাবনার সবুজ চারণভূমিতে চরা দেশী গরু ও পিতলের দুধের কলসি',
  },
  {
    index: '02',
    titleEn: 'Overnight Curd Fermentation',
    titleBn: 'মাটির পাত্রে দই পাতা',
    subEn: 'Whole boiled milk cultured slowly into thick, aromatic curd',
    subBn: 'সম্পূর্ণ দুধ সারা রাত মাটির হাঁড়িতে দইয়ে রূপান্তর',
    detailEn:
      'Rather than separating raw cream mechanically, we culture the entire milk overnight in seasoned earthen pots to develop complex lactic depth.',
    detailBn:
      'মেশিনে ক্রিম আলাদা না করে সম্পূর্ণ দুধ মাটির পাত্রে সারা রাত দই পাতা হয় যেন প্রাকৃতিক সুবাস তৈরি হয়।',
    image: IMAGES.tableJar,
    altEn: 'Fresh cultured dairy preparation beside brass tasting spoon on travertine stone',
    altBn: 'খাঁটি দই ও সোনালী ঘিয়ের ঐতিহ্যবাহী প্রস্তুতি',
  },
  {
    index: '03',
    titleEn: 'Traditional Wooden Bilona Churning',
    titleBn: 'কাঠের বিলোনার মন্থন',
    subEn: 'Two-way hand churning releases snowy white cultured makkhan',
    subBn: 'ঘূর্ণায়মান কাঠের ডাঁটি দিয়ে সাদা মাখন তোলা',
    detailEn:
      'Before sunrise, the cultured curd is churned back and forth with a wooden bilona until pure butterfat separates cleanly from buttermilk.',
    detailBn:
      'সূর্যোদয়ের আগে কাঠের বিলোনা ঘুরিয়ে ঘুরিয়ে দই মন্থন করে খাঁটি সাদা মাখন আলাদা করা হয়।',
    image: IMAGES.bilonaChurn,
    altEn: 'Artisan churning frothy cultured curd inside an earthen pot using a traditional wooden bilona',
    altBn: 'মাটির পাত্রে কাঠের বিলোনা দিয়ে দই মন্থনের দৃশ্য',
  },
  {
    index: '04',
    titleEn: 'Slow Clarification & Glass Sealing',
    titleBn: 'মৃদু জ্বাল ও কাঁচের জারে সিল',
    subEn: 'Simmered gently until clear amber and sealed warm in glass',
    subBn: 'মৃদু আঁচে জ্বাল দিয়ে সোনালী ঘি কাঁচের বয়ামে ভরা',
    detailEn:
      'The makkhan simmers slowly over low heat until moisture evaporates, strained through clean muslin, and poured into UV-safe glass jars.',
    detailBn:
      'খাঁটি মাখন মৃদু আঁচে ধীরে ধীরে জ্বাল দিয়ে মসলিন কাপড়ে ছেঁকে সরাসরি কাঁচের জারে সিল করা হয়।',
    image: IMAGES.clayClarify,
    altEn: 'Golden ghee simmering softly inside a seasoned earthen clay pot over warm embers',
    altBn: 'মাটির হাঁড়িতে মৃদু আঁচে সোনালী ঘি তৈরির দৃশ্য',
  },
];

export const WAYS_TO_ENJOY = [
  {
    id: 'khichuri',
    titleEn: 'Bhuna Khichuri',
    titleBn: 'ভুনা খিচুড়ি',
    descEn: 'Steaming moog dal and aromatic rice lifted by warm clarified butterfat.',
    descBn: 'ভাজা মুগ ডাল ও চিনিগুঁড়া চালের গরম খিচুড়ির সাথে ঘিয়ের ঘ্রাণ।',
    tipEn: 'Drizzle 1 tbsp over piping-hot khichuri right before serving.',
    tipBn: 'পরিবেশনের ঠিক আগে গরম খিচুড়ির ওপর ১ টেবিল চামচ ছড়িয়ে দিন।',
    image: IMAGES.dishKhichuri,
  },
  {
    id: 'polao',
    titleEn: 'Shahi Polao',
    titleBn: 'শাহী পোলাও',
    descEn: 'Chinigura grains coated cleanly without heaviness, holding whole spices.',
    descBn: 'চিনিগুঁড়া চাল ও গরম মসলার সাথে ঝরঝরে শাহী পোলাওয়ের অতুলনীয় স্বাদ।',
    tipEn: 'Sauté whole cardamom, cinnamon, and onions in 2 tbsp ghee.',
    tipBn: 'এলাচ, দারুচিনি ও পেঁয়াজ ২ টেবিল চামচ ঘিয়ে হালকা ভেজে নিন।',
    image: IMAGES.dishPolao,
  },
  {
    id: 'bhaat',
    titleEn: 'Gorom Bhaat & Ghee',
    titleBn: 'গরম ভাত ও ঘি',
    descEn: 'The timeless Bengali comfort ritual—fluffy white rice and granular gold.',
    descBn: 'ধোঁয়া ওঠা সাদা ভাতের সাথে এক চামচ খাঁটি দানাদার গাওয়া ঘি।',
    tipEn: 'Fold 1 tsp into freshly steamed rice with a pinch of salt and green chili.',
    tipBn: 'গরম ভাতে ১ চা চামচ ঘি, সামান্য লবণ ও কাঁচা মরিচ দিয়ে মেখে খান।',
    image: IMAGES.dishBhaat,
  },
  {
    id: 'halua',
    titleEn: 'Festive Halua',
    titleBn: 'ঐতিহ্যবাহী হালুয়া',
    descEn: 'Caramelized semolina or carrot halua with deep roasted nutty richness.',
    descBn: 'সুজি বা গাজরের হালুয়ায় মোলায়েম বুনন ও ভাজা বাদামের ঘ্রাণ।',
    tipEn: 'Roast suji slowly on low heat in ghee before adding warm milk syrup.',
    tipBn: 'হালকা আঁচে ঘিয়ে সুজি ধীরে ভেজে নিয়ে তারপর দুধ বা চিনির সিরা দিন।',
    image: IMAGES.dishHalua,
  },
  {
    id: 'paratha',
    titleEn: 'Flaky Paratha',
    titleBn: 'মচমচে পরোটা',
    descEn: 'High 250°C smoke point crisps layered dough without burning.',
    descBn: 'উচ্চ স্মোক পয়েন্টের কারণে পরোটা পোড়ে না, হয় মচমচে ও সোনালী।',
    tipEn: 'Brush ½ tsp inside dough folds and pan-finish with golden ghee.',
    tipBn: 'ভাজ করার সময় ভেতরে সামান্য ঘি লাগিয়ে তাওয়ায় ভেজে নিন।',
    image: IMAGES.dishParatha,
  },
];

export const FAQ_ITEMS = [
  {
    qEn: 'Is this authentic Deshi Ghee?',
    qBn: 'এটি কি সত্যিকারের খাঁটি দেশী গরুর ঘি?',
    aEn: 'Yes. Deshi Gee is prepared exclusively from whole cultured milk of Pabna cows using the traditional wooden bilona method, with zero vegetable oil or artificial flavouring.',
    aBn: 'হ্যাঁ। আমাদের ঘি শুধুমাত্র পাবনার দেশী গরুর দুধের দই থেকে কাঠের বিলোনার মাধ্যমে তৈরি করা হয়—এতে কোনো বনস্পতি, পাম অয়েল বা কৃত্রিম ফ্লেভার নেই।',
  },
  {
    qEn: 'What ingredients are used?',
    qBn: 'এতে কী কী উপাদান ব্যবহার করা হয়?',
    aEn: 'Only one ingredient: 100% pure cultured cow milkfat. No preservatives, colours, or emulsifiers are added.',
    aBn: 'মাত্র একটি উপাদান: ১০০% খাঁটি গরুর দুধের ফ্যাট (মিল্কফ্যাট)। কোনো প্রিজারভেটিভ বা কৃত্রিম রং নেই।',
  },
  {
    qEn: 'How is the ghee prepared?',
    qBn: 'এই ঘি কীভাবে তৈরি করা হয়?',
    aEn: 'Morning milk is boiled, fermented overnight into curd in earthen pots, hand-churned with a wooden bilona to extract makkhan, and gently clarified until golden.',
    aBn: 'ভোরের তাজা দুধ জ্বাল দিয়ে মাটির পাত্রে দই পাতা হয়, এরপর কাঠের বিলোনার মাধ্যমে মাখন তুলে মৃদু আঁচে জ্বাল দিয়ে ঘি তৈরি করা হয়।',
  },
  {
    qEn: 'Why does ghee become granular (danadar)?',
    qBn: 'ঘিয়ে দানা বা দানাদার ভাব হয় কেন?',
    aEn: 'Slow ambient cooling lets natural milkfat fatty acids crystallize gently into granules. Granularity varies naturally with room temperature and season.',
    aBn: 'মৃদু তাপমাত্রায় ধীরে ঠান্ডা হলে প্রাকৃতিক মিল্কফ্যাট স্ফটিক বা দানাদার রূপ নেয়। আবহাওয়া ও তাপমাত্রা ভেদে দানার ধরন বদলাতে পারে।',
  },
  {
    qEn: 'How should ghee be stored?',
    qBn: 'ঘি কীভাবে সংরক্ষণ করা উচিত?',
    aEn: 'Keep the glass jar tightly sealed in a cool, dry pantry away from direct sunlight. Always use a clean, dry spoon.',
    aBn: 'কাঁচের বয়ামের ঢাকনা শক্ত করে লাগিয়ে রোদ থেকে দূরে ঠান্ডা ও শুষ্ক স্থানে রাখুন। সবসময় শুকনো ও পরিষ্কার চামচ ব্যবহার করুন।',
  },
  {
    qEn: 'What is the shelf life?',
    qBn: 'ঘি কতদিন ভালো থাকে?',
    aEn: 'Up to 12 months from the batch production date when kept sealed and moisture-free at room temperature.',
    aBn: 'আর্দ্রতা ও পানি থেকে দূরে সাধারণ তাপমাত্রায় রাখলে উৎপাদনের তারিখ থেকে ১২ মাস পর্যন্ত ভালো থাকে।',
  },
  {
    qEn: 'What weight options are available?',
    qBn: 'কত গ্রাম বা কেজির জারে পাওয়া যায়?',
    aEn: 'We pack our single-origin Pabna Deshi Cow Ghee in 250g, 500g, and 1kg sealed apothecary glass jars.',
    aBn: 'আমাদের খাঁটি ঘি ২৫০ গ্রাম, ৫০০ গ্রাম এবং ১ কেজি কাঁচের বয়ামে পাওয়া যায়।',
  },
  {
    qEn: 'How long does delivery take?',
    qBn: 'ডেলিভারি পেতে কত সময় লাগে?',
    aEn: 'Inside Dhaka typically arrives within 24–48 hours; outside Dhaka across all districts arrives within 2–4 business days.',
    aBn: 'ঢাকার ভেতরে সাধারণত ২৪–৪৮ ঘণ্টা এবং ঢাকার বাইরে সারা বাংলাদেশে ২–৪ কর্মদিবসের মধ্যে ডেলিভারি পৌঁছে যায়।',
  },
  {
    qEn: 'Is Cash on Delivery available?',
    qBn: 'ক্যাশ অন ডেলিভারি (COD) সুবিধা কি আছে?',
    aEn: 'Yes. You can inspect the parcel seal upon arrival and pay in cash directly to the delivery rider.',
    aBn: 'হ্যাঁ, সম্পূর্ণ বাংলাদেশে ক্যাশ অন ডেলিভারি সুবিধা রয়েছে। পার্সেল হাতে পেয়ে যাচাই করে মূল্য পরিশোধ করতে পারবেন।',
  },
  {
    qEn: 'Can I pay through bKash or Nagad?',
    qBn: 'বিকাশ বা নগদের মাধ্যমে কি পেমেন্ট করা যাবে?',
    aEn: 'Yes. Select bKash or Nagad at checkout, complete your transfer to our listed number, and enter your Transaction ID for admin verification.',
    aBn: 'হ্যাঁ। চেকআউটে বিকাশ বা নগদ বেছে নিয়ে প্রদত্ত নম্বরে পেমেন্ট করে আপনার ট্রানজেকশন আইডি (TxnID) সাবমিট করুন।',
  },
  {
    qEn: 'What is the return or replacement policy?',
    qBn: 'রিটার্ন বা রিপ্লেসমেন্ট নীতিমালা কী?',
    aEn: 'If a glass jar arrives damaged in transit or the tamper seal is broken, share a photo within 24 hours on WhatsApp for a free replacement.',
    aBn: 'ডেলিভারির সময় কাঁচের জার ক্ষতিগ্রস্ত হলে বা সিল খোলা থাকলে ২৪ ঘণ্টার মধ্যে হোয়াটসঅ্যাপে ছবি পাঠালে বিনামূল্যে পরিবর্তন করে দেওয়া হবে।',
  },
  {
    qEn: 'How can I track my order?',
    qBn: 'আমার অর্ডার কীভাবে ট্র্যাক করব?',
    aEn: 'Open the Order Tracking view from the header or footer and enter your Order ID (e.g. DG-1042) with your checkout phone number.',
    aBn: 'হেডার বা ফুটারের অর্ডার ট্র্যাকিং পেজে গিয়ে আপনার অর্ডার আইডি (যেমন DG-1042) ও মোবাইল নম্বর দিয়ে লাইভ অবস্থা দেখতে পারবেন।',
  },
];

export const BANGLADESH_DISTRICTS = [
  'Dhaka',
  'Chattogram',
  'Gazipur',
  'Narayanganj',
  'Savar',
  'Sylhet',
  'Rajshahi',
  'Khulna',
  'Barishal',
  'Rangpur',
  'Mymensingh',
  'Cumilla',
  'Bogura',
  'Pabna',
  'Sirajganj',
  'Jashore',
  'Cox’s Bazar',
  'Tangail',
  'Narsingdi',
  'Faridpur',
  'Dinajpur',
  'Noakhali',
  'Feni',
  'Kushtia',
  'Brahmanbaria',
];

export function formatBdt(amount: number): string {
  return `৳ ${Math.round(amount).toLocaleString('en-US')}`;
}
