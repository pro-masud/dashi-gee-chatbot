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
    altEn: 'Deshi Gee jar front view with brass lid and cream cotton label',
    altBn: 'পিতলের ঢাকনা ও ক্রিম লেবেলসহ দেশী ঘি জারের সামনের দৃশ্য',
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
    jarHeightNoteEn: 'Starter Jar',
    jarHeightNoteBn: 'ছোট বয়াম',
    scale: 0.9,
  },
  {
    key: '500g',
    labelEn: '500g',
    labelBn: '৫০০ গ্রাম',
    jarHeightNoteEn: 'Family Kitchen Jar',
    jarHeightNoteBn: 'পরিবারের নিয়মিত বয়াম',
    scale: 1.0,
  },
  {
    key: '1kg',
    labelEn: '1kg',
    labelBn: '১ কেজি',
    jarHeightNoteEn: 'Household Reserve Jar',
    jarHeightNoteBn: 'বড় পারিবারিক বয়াম',
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
    titleEn: 'Slow Clarification & Jar Sealing',
    titleBn: 'মৃদু জ্বাল ও জারে সিল',
    subEn: 'Simmered gently until clear amber and sealed warm in the jar',
    subBn: 'মৃদু আঁচে জ্বাল দিয়ে সোনালী ঘি বয়ামে ভরা',
    detailEn:
      'The makkhan simmers slowly over low heat until moisture evaporates, strained through clean muslin, and poured into food-safe jars.',
    detailBn:
      'খাঁটি মাখন মৃদু আঁচে ধীরে ধীরে জ্বাল দিয়ে মসলিন কাপড়ে ছেঁকে সরাসরি জারে সিল করা হয়।',
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
    descEn: 'Clarified butterfat helps crisp layered dough evenly with rich aroma.',
    descBn: 'খাঁটি গাওয়া ঘি পরোটাকে করে তোলে মচমচে, সুগন্ধি ও সোনালী।',
    tipEn: 'Brush ½ tsp inside dough folds and pan-finish with golden ghee.',
    tipBn: 'ভাজ করার সময় ভেতরে সামান্য ঘি লাগিয়ে তাওয়ায় ভেজে নিন।',
    image: IMAGES.dishParatha,
  },
];

export const FAQ_ITEMS = [
  {
    qEn: 'How is Deshi Gee prepared?',
    qBn: 'দেশী ঘি কীভাবে তৈরি করা হয়?',
    aEn: 'Deshi Gee is prepared from cultured cow milk sourced in Pabna using earthen-pot curd fermentation, traditional wooden bilona churning, and gentle slow clarification.',
    aBn: 'পাবনার গরুর দুধ মাটির পাত্রে দই পেতে কাঠের বিলোনার মাধ্যমে মাখন তুলে মৃদু আঁচে জ্বাল দিয়ে দেশী ঘি তৈরি করা হয়।',
  },
  {
    qEn: 'What ingredients are used?',
    qBn: 'এতে কী কী উপাদান ব্যবহার করা হয়?',
    aEn: 'Clarified cultured cow milkfat sealed in jars, without added vegetable oil or artificial colour.',
    aBn: 'বয়ামে সিল করা গরুর দুধের মিল্কফ্যাট—কোনো বনস্পতি বা কৃত্রিম রং মেশানো হয় না।',
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
    aEn: 'Keep the jar tightly sealed in a cool, dry pantry away from direct sunlight and moisture. Always use a clean, dry spoon.',
    aBn: 'বয়ামের ঢাকনা শক্ত করে লাগিয়ে রোদ ও আর্দ্রতা থেকে দূরে ঠান্ডা ও শুষ্ক স্থানে রাখুন। সবসময় শুকনো ও পরিষ্কার চামচ ব্যবহার করুন।',
  },
  {
    qEn: 'What weight options are offered?',
    qBn: 'কত গ্রাম বা কেজির জারে পাওয়া যায়?',
    aEn: 'Deshi Gee is packed in 250g, 500g, and 1kg sealed jars (availability depends on current stock).',
    aBn: 'আমাদের ঘি ২৫০ গ্রাম, ৫০০ গ্রাম এবং ১ কেজি বয়ামে পাওয়া যায় (বর্তমান স্টক সাপেক্ষে)।',
  },
  {
    qEn: 'How are delivery charges and timelines calculated?',
    qBn: 'ডেলিভারি চার্জ ও সময় কীভাবে নির্ধারিত হয়?',
    aEn: 'Confirmed delivery charges and estimated delivery timelines for your district are displayed live at checkout once set by our store team.',
    aBn: 'আপনার জেলার জন্য নির্ধারিত ডেলিভারি চার্জ ও সম্ভাব্য সময় চেকআউট ধাপে লাইভ দেখানো হয়।',
  },
  {
    qEn: 'What payment methods are accepted?',
    qBn: 'কোন কোন মাধ্যমে পেমেন্ট করা যায়?',
    aEn: 'Available payment methods (such as Cash on Delivery and configured mobile payments) are displayed during checkout.',
    aBn: 'উপলব্ধ পেমেন্ট মাধ্যমগুলো (যেমন ক্যাশ অন ডেলিভারি বা নির্ধারিত মোবাইল পেমেন্ট) চেকআউট ধাপে দেখানো হয়।',
  },
  {
    qEn: 'What if a jar arrives damaged?',
    qBn: 'পার্সেলে জার ক্ষতিগ্রস্ত হলে কী করব?',
    aEn: 'If a jar arrives cracked, leaking, or with an open seal, contact our support team through the Track Order page or Support Callback form with a photo so our team can review and assist.',
    aBn: 'পার্সেলে জার ফাটা, লিক বা সিল খোলা অবস্থায় এলে ছবি সহ আমাদের সাপোর্ট টিম বা অর্ডার ট্র্যাকিং পেজের মাধ্যমে যোগাযোগ করুন।',
  },
  {
    qEn: 'How can I track my order?',
    qBn: 'আমার অর্ডার কীভাবে ট্র্যাক করব?',
    aEn: 'Use your private tracking link from order confirmation, or open the Order Tracking page and enter your Order ID together with your checkout mobile number.',
    aBn: 'অর্ডার কনফার্মেশনের ব্যক্তিগত ট্র্যাকিং লিংক ব্যবহার করুন, অথবা অর্ডার ট্র্যাকিং পেজে গিয়ে আপনার অর্ডার আইডি ও মোবাইল নম্বর দিন।',
  },
];

export const ALL_64_BANGLADESH_DISTRICTS = [
  'Dhaka',
  'Chattogram',
  'Gazipur',
  'Narayanganj',
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
  'Bagerhat',
  'Bandarban',
  'Barguna',
  'Bhola',
  'Chandpur',
  'Chapainawabganj',
  'Chuadanga',
  'Gaibandha',
  'Gopalganj',
  'Habiganj',
  'Jamalpur',
  'Jhalokati',
  'Jhenaidah',
  'Joypurhat',
  'Khagrachhari',
  'Kishoreganj',
  'Kurigram',
  'Lakshmipur',
  'Lalmonirhat',
  'Madaripur',
  'Magura',
  'Manikganj',
  'Meherpur',
  'Moulvibazar',
  'Munshiganj',
  'Naogaon',
  'Narail',
  'Natore',
  'Netrokona',
  'Nilphamari',
  'Panchagarh',
  'Patuakhali',
  'Pirojpur',
  'Rajbari',
  'Rangamati',
  'Satkhira',
  'Shariatpur',
  'Sherpur',
  'Sunamganj',
  'Thakurgaon',
] as const;

export const BANGLADESH_DISTRICTS: string[] = [...ALL_64_BANGLADESH_DISTRICTS];

const CLIENT_SUBURBAN_DISTRICTS = new Set([
  'Gazipur',
  'Narayanganj',
  'Manikganj',
  'Munshiganj',
  'Narsingdi',
]);

const CLIENT_REMOTE_DISTRICTS = new Set([
  'Bandarban',
  'Rangamati',
  'Khagrachhari',
  'Cox’s Bazar',
  'Bhola',
]);

const CLIENT_SUBURBAN_AREA_RX =
  /(savar|সাভার|ashulia|আশুলিয়া|আশুলিয়া|keraniganj|কেরানীগঞ্জ|tongi|টঙ্গী|gazipur|গাজীপুর|narayanganj|নারায়ণগঞ্জ|নারায়ণগঞ্জ|dhamrai|ধামরাই|dohar|দোহার|nawabganj|নবাবগঞ্জ|fatullah|ফতুল্লা|demra|ডেমরা)/i;

export function clientResolveZoneFromDistrictAndArea(
  district: string,
  area = '',
  address = ''
): 'dhaka' | 'suburban' | 'nationwide' | 'remote' {
  const dist = String(district || '').trim();
  const combined = `${area} ${address}`.trim();
  if (dist === 'Dhaka') {
    return CLIENT_SUBURBAN_AREA_RX.test(combined) ? 'suburban' : 'dhaka';
  }
  if (CLIENT_SUBURBAN_DISTRICTS.has(dist)) {
    return 'suburban';
  }
  if (CLIENT_REMOTE_DISTRICTS.has(dist)) {
    return 'remote';
  }
  return 'nationwide';
}

export function clientAssessAddressCompleteness(
  address: string,
  area = '',
  district = ''
): { complete: boolean; reason?: 'too_short' | 'placeholder_only' | 'missing_detail' } {
  const clean = String(address || '').trim();
  if (clean.length < 6) return { complete: false, reason: 'too_short' };
  const lower = clean.toLowerCase();
  const areaLower = area.trim().toLowerCase();
  const distLower = district.trim().toLowerCase();
  const singleGeneric = new Set([
    'dhaka',
    'mirpur',
    'uttara',
    'dhanmondi',
    'gulshan',
    'banani',
    'savar',
    'chattogram',
    'chittagong',
    'sylhet',
    'rajshahi',
    'khulna',
    'test',
    'na',
    'n/a',
    areaLower,
    distLower,
  ]);
  if (singleGeneric.has(lower)) {
    return { complete: false, reason: 'placeholder_only' };
  }
  const hasDetailKeyword =
    /(\d|house|h#|road|rd|r#|flat|floor|apt|sector|block|lane|avenue|holding|village|gram|bazar|para|বাড়ি|বাড়ি|রোড|সড়ক|সড়ক|ফ্ল্যাট|সেক্টর|ব্লক|গ্রাম|বাজার|হোল্ডিং)/i.test(
      clean
    );
  const tokens = clean.split(/[\s,/#-]+/).filter((t) => t.length >= 2);
  if (!hasDetailKeyword && tokens.length < 2) {
    return { complete: false, reason: 'missing_detail' };
  }
  return { complete: true };
}

export function formatBdt(amount: number): string {
  return `৳ ${Math.round(amount).toLocaleString('en-US')}`;
}

export function toBengaliDigits(num: number | string): string {
  const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(num).replace(/\d/g, (d) => bnDigits[Number(d)] ?? d);
}

