import { createHash } from 'crypto';
import type { BatchRecord, StoreSettingsDoc } from '../storeTypes';
import type { ApprovedClaimMeta, ChatbotConfigDoc } from './types';
import { convertBanglaDigitsToEnglish } from './domain-guard';

export interface StoreFactsSnapshot {
  factsVersion: string;
  generatedAt: string;
  brandName: string;
  productNameEn: string;
  productNameBn: string;
  originLocation: string;
  pricesBdt: {
    '250g': number;
    '500g': number;
    '1kg': number;
  };
  stockJars: {
    '250g': number;
    '500g': number;
    '1kg': number;
  };
  delivery: {
    insideDhakaFeeBdt: number;
    dhakaSuburbanFeeBdt: number;
    outsideDhakaFeeBdt: number;
    remoteDistrictFeeBdt: number;
    freeDeliveryThresholdBdt: number;
    estimatedDhakaDays: string;
    estimatedSuburbanDays: string;
    estimatedOutsideDays: string;
    estimatedRemoteDays: string;
    dispatchCutoffHourBst: number;
    cutoffNoticeEn: string;
    cutoffNoticeBn: string;
    policy: string;
  };
  payments: {
    codAvailable: boolean;
    bkashNumber: string;
    nagadNumber: string;
    advanceDiscountPct: number;
    otherPaymentInfo: string;
  };
  contact: {
    supportPhone: string;
    whatsappNumber: string;
    supportEmail: string;
    businessAddress: string;
    district: string;
    city: string;
    googleMapsUrl: string;
    directionsUrl: string;
    facebookUrl: string;
    instagramUrl: string;
    phoneConfigured: boolean;
    whatsappConfigured: boolean;
  };
  policies: {
    returnPolicy: string;
    replacementPolicy: string;
  };
  craft: {
    description: string;
    ingredients: string;
    taste: string;
    aroma: string;
    texture: string;
    productionMethod: string;
    shelfLife: string;
    storageInstructions: string;
  };
  approvedClaims: string;
  blockedClaims: string;
  activeBatch: {
    batchCode: string;
    originDistrict: string;
    productionDate: string;
    expiryDate: string;
    labReportStatus: string;
  };
  conflicts: string[];
}

function isPlaceholderValue(val: string): boolean {
  const lower = (val || '').toLowerCase();
  return !lower || lower.includes('configure') || lower.includes('000000');
}

export function detectStoreFactConflicts(params: {
  settings: StoreSettingsDoc;
  config: ChatbotConfigDoc;
}): string[] {
  const { settings, config } = params;
  const conflicts: string[] = [];

  if (isPlaceholderValue(settings.supportPhone)) {
    conflicts.push('Store Settings supportPhone appears unconfigured or placeholder.');
  }
  if (isPlaceholderValue(settings.whatsappNumber)) {
    conflicts.push('Store Settings whatsappNumber appears unconfigured or placeholder.');
  }

  // Detect mismatched free delivery threshold inside ChatbotConfig text vs live StoreSettings number
  const offerAscii = convertBanglaDigitsToEnglish(config.currentOffers || '').replace(
    /(\d),(\d)/g,
    '$1$2'
  );
  for (const m of offerAscii.matchAll(/(?:৳|bdt|tk\.?)\s*([0-9]{3,6})/gi)) {
    const mentioned = Number(m[1]);
    if (
      Number.isFinite(mentioned) &&
      mentioned >= 500 &&
      mentioned !== Math.round(settings.freeDeliveryThreshold) &&
      /free\s*delivery|ফ্রি\s*ডেলিভারি/i.test(offerAscii)
    ) {
      conflicts.push(
        `Chatbot offers note mentions ৳${mentioned}, while live Store Settings freeDeliveryThreshold is ৳${Math.round(settings.freeDeliveryThreshold)}. Using Store Settings value.`
      );
    }
  }

  return conflicts;
}

export function buildStoreFactsSnapshot(params: {
  settings: StoreSettingsDoc;
  batch: BatchRecord;
  config: ChatbotConfigDoc;
}): StoreFactsSnapshot {
  const { settings, batch, config } = params;
  const conflicts = detectStoreFactConflicts({ settings, config });

  const canonical = {
    price250g: Math.round(settings.price250g),
    price500g: Math.round(settings.price500g),
    price1kg: Math.round(settings.price1kg),
    stock250g: Math.round(settings.stock250g),
    stock500g: Math.round(settings.stock500g),
    stock1kg: Math.round(settings.stock1kg),
    insideDhakaFee: Math.round(settings.insideDhakaFee),
    dhakaSuburbanFee: Math.round(settings.dhakaSuburbanFee ?? 100),
    outsideDhakaFee: Math.round(settings.outsideDhakaFee),
    remoteDistrictFee: Math.round(settings.remoteDistrictFee ?? 160),
    freeDeliveryThreshold: Math.round(settings.freeDeliveryThreshold),
    advanceDiscountPct: Math.round(settings.advanceDiscountPct),
    batchCode: batch.batchCode,
    configVersion: config.version || 1,
    approvedClaims: config.approvedClaims || '',
    blockedClaims: config.blockedClaims || '',
  };

  const hash = createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 8);

  return {
    factsVersion: `v${canonical.configVersion}-${hash}`,
    generatedAt: new Date().toISOString(),
    brandName: config.brandName || 'Deshi Gee',
    productNameEn: settings.productNameEn,
    productNameBn: settings.productNameBn,
    originLocation: settings.originLocation,
    pricesBdt: {
      '250g': canonical.price250g,
      '500g': canonical.price500g,
      '1kg': canonical.price1kg,
    },
    stockJars: {
      '250g': canonical.stock250g,
      '500g': canonical.stock500g,
      '1kg': canonical.stock1kg,
    },
    delivery: {
      insideDhakaFeeBdt: canonical.insideDhakaFee,
      dhakaSuburbanFeeBdt: canonical.dhakaSuburbanFee,
      outsideDhakaFeeBdt: canonical.outsideDhakaFee,
      remoteDistrictFeeBdt: canonical.remoteDistrictFee,
      freeDeliveryThresholdBdt: canonical.freeDeliveryThreshold,
      estimatedDhakaDays: settings.estimatedDhakaDays,
      estimatedSuburbanDays:
        settings.estimatedSuburbanDays || '2–3 Business Days (Dhaka Suburbs)',
      estimatedOutsideDays: settings.estimatedOutsideDays,
      estimatedRemoteDays:
        settings.estimatedRemoteDays || '3–5 Business Days (Remote / Hill & Coastal)',
      dispatchCutoffHourBst: Math.round(settings.dispatchCutoffHourBst ?? 14),
      cutoffNoticeEn:
        settings.cutoffNoticeEn || 'Orders confirmed before 2:00 PM BST dispatch same day.',
      cutoffNoticeBn:
        settings.cutoffNoticeBn || 'দুপুর ২টার (BST) আগে কনফার্ম হওয়া অর্ডার একই দিনে ডিসপ্যাচ হয়।',
      policy: config.deliveryPolicy,
    },
    payments: {
      codAvailable: true,
      bkashNumber: settings.bkashNumber,
      nagadNumber: settings.nagadNumber,
      advanceDiscountPct: canonical.advanceDiscountPct,
      otherPaymentInfo: config.otherPaymentInfo,
    },
    contact: {
      supportPhone: settings.supportPhone,
      whatsappNumber: settings.whatsappNumber,
      supportEmail: settings.supportEmail,
      businessAddress: settings.businessAddress,
      district: config.district,
      city: config.city,
      googleMapsUrl: config.googleMapsUrl,
      directionsUrl: config.directionsUrl,
      facebookUrl: settings.facebookUrl,
      instagramUrl: settings.instagramUrl,
      phoneConfigured: !isPlaceholderValue(settings.supportPhone),
      whatsappConfigured: !isPlaceholderValue(settings.whatsappNumber),
    },
    policies: {
      returnPolicy: config.returnPolicy,
      replacementPolicy: config.replacementPolicy,
    },
    craft: {
      description: config.productDescription,
      ingredients: config.ingredients,
      taste: config.taste,
      aroma: config.aroma,
      texture: config.texture,
      productionMethod: config.productionMethod,
      shelfLife: config.shelfLife,
      storageInstructions: config.storageInstructions,
    },
    approvedClaims: config.approvedClaims || '',
    blockedClaims: config.blockedClaims || '',
    activeBatch: {
      batchCode: batch.batchCode,
      originDistrict: batch.originDistrict,
      productionDate: batch.productionDate,
      expiryDate: batch.expiryDate,
      labReportStatus: batch.labReportStatus,
    },
    conflicts,
  };
}

/**
 * Seeds verified catalog/delivery monetary amounts from live Firestore store settings
 * so direct price/delivery answers are always grounded even when answered from live context.
 * Multi-jar order totals and coupon discounts STILL require tool execution (`prepare_order_summary` / `get_current_offers`).
 */
export function getSeededVerifiedMonetaryAmounts(facts: StoreFactsSnapshot): Set<number> {
  const seeded = new Set<number>();
  for (const val of [
    facts.pricesBdt['250g'],
    facts.pricesBdt['500g'],
    facts.pricesBdt['1kg'],
    facts.delivery.insideDhakaFeeBdt,
    facts.delivery.dhakaSuburbanFeeBdt,
    facts.delivery.outsideDhakaFeeBdt,
    facts.delivery.remoteDistrictFeeBdt,
    facts.delivery.freeDeliveryThresholdBdt,
  ]) {
    if (Number.isFinite(val) && val > 0) {
      seeded.add(Math.round(val));
    }
  }
  return seeded;
}

export function sanitizeApprovedClaimsStringForPublish(rawClaims?: string): string {
  return String(rawClaims || '')
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;
      if (/\[draft\b/i.test(part)) return false;
      if (/enter\s+verified|template\s+draft|placeholder|\[add\s+/i.test(part)) return false;
      return true;
    })
    .join('; ');
}

export function sanitizeApprovedClaimsMetaForPublish(
  metaList?: ApprovedClaimMeta[]
): ApprovedClaimMeta[] {
  if (!Array.isArray(metaList)) return [];
  return metaList
    .filter((m) => m && m.status !== 'draft')
    .filter((m) => {
      const claim = String(m.claim || '').trim();
      return (
        claim.length > 0 &&
        !/\[draft\b/i.test(claim) &&
        !/enter\s+verified|template\s+draft|placeholder|\[add\s+/i.test(claim)
      );
    })
    .map((m) => ({
      ...m,
      status: 'approved' as const,
    }));
}

export function getActiveApprovedClaimsText(config: ChatbotConfigDoc): string {
  const todayIso = new Date().toISOString().slice(0, 10);
  const safeLegacyClaims = sanitizeApprovedClaimsStringForPublish(config.approvedClaims);
  const activeMetaClaims = sanitizeApprovedClaimsMetaForPublish(config.approvedClaimsMeta)
    .filter((m) => !m.expiresAt || m.expiresAt >= todayIso)
    .map((m) => m.claim)
    .filter(Boolean);
  return [safeLegacyClaims, ...activeMetaClaims].filter(Boolean).join('; ').toLowerCase();
}
