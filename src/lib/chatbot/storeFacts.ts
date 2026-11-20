import { createHash } from 'crypto';
import {
  getConfirmedDeliveryFeeForZone,
  getConfirmedPriceForWeight,
  hasValidRealPhone,
  isPlaceholderContactValue,
  isStoreFieldConfirmed,
  isStorefrontOrderingReady,
  type BatchRecord,
  type StoreSettingsDoc,
} from '../storeTypes';
import type { ApprovedClaimMeta, ChatbotConfigDoc } from './types';
import { convertBanglaDigitsToEnglish } from './domain-guard';

export interface StoreFactsSnapshot {
  factsVersion: string;
  generatedAt: string;
  orderingReady: boolean;
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
    bkashConfigured: boolean;
    nagadConfigured: boolean;
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
  return isPlaceholderContactValue(val);
}

export function detectStoreFactConflicts(params: {
  settings: StoreSettingsDoc;
  config: ChatbotConfigDoc;
}): string[] {
  const { settings, config } = params;
  const conflicts: string[] = [];

  if (!hasValidRealPhone(settings.supportPhone)) {
    conflicts.push('Store Settings supportPhone appears unconfigured or placeholder.');
  }
  if (!hasValidRealPhone(settings.whatsappNumber)) {
    conflicts.push('Store Settings whatsappNumber appears unconfigured or placeholder.');
  }

  // Detect mismatched free delivery threshold inside ChatbotConfig text vs live StoreSettings number
  const offerAscii = convertBanglaDigitsToEnglish(config.currentOffers || '').replace(
    /(\d),(\d)/g,
    '$1$2'
  );
  if (settings.freeDeliveryThreshold > 0) {
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
  }

  return conflicts;
}

export function buildStoreFactsSnapshot(params: {
  settings: StoreSettingsDoc;
  batch: BatchRecord | null;
  config: ChatbotConfigDoc;
}): StoreFactsSnapshot {
  const { settings, batch, config } = params;
  const conflicts = detectStoreFactConflicts({ settings, config });

  const price250g = getConfirmedPriceForWeight(settings, '250g') ?? 0;
  const price500g = getConfirmedPriceForWeight(settings, '500g') ?? 0;
  const price1kg = getConfirmedPriceForWeight(settings, '1kg') ?? 0;

  const insideDhakaFee = getConfirmedDeliveryFeeForZone(settings, 'dhaka') ?? 0;
  const dhakaSuburbanFee = getConfirmedDeliveryFeeForZone(settings, 'suburban') ?? 0;
  const outsideDhakaFee = getConfirmedDeliveryFeeForZone(settings, 'nationwide') ?? 0;
  const remoteDistrictFee = getConfirmedDeliveryFeeForZone(settings, 'remote') ?? 0;

  const freeDeliveryThreshold = isStoreFieldConfirmed(settings, 'freeDeliveryThreshold')
    ? Math.round(settings.freeDeliveryThreshold)
    : 0;
  const advanceDiscountPct = isStoreFieldConfirmed(settings, 'advanceDiscountPct')
    ? Math.round(settings.advanceDiscountPct)
    : 0;
  const dispatchCutoffHourBst = isStoreFieldConfirmed(settings, 'dispatchCutoffHourBst')
    ? Math.round(Number(settings.dispatchCutoffHourBst || 0))
    : 0;

  const canonical = {
    price250g,
    price500g,
    price1kg,
    stock250g: isStoreFieldConfirmed(settings, 'stock250g') ? Math.round(settings.stock250g) : Math.max(0, Math.round(settings.stock250g || 0)),
    stock500g: isStoreFieldConfirmed(settings, 'stock500g') ? Math.round(settings.stock500g) : Math.max(0, Math.round(settings.stock500g || 0)),
    stock1kg: isStoreFieldConfirmed(settings, 'stock1kg') ? Math.round(settings.stock1kg) : Math.max(0, Math.round(settings.stock1kg || 0)),
    insideDhakaFee,
    dhakaSuburbanFee,
    outsideDhakaFee,
    remoteDistrictFee,
    freeDeliveryThreshold,
    advanceDiscountPct,
    batchCode: batch?.batchCode || '',
    configVersion: config.version || 1,
    approvedClaims: config.approvedClaims || '',
    blockedClaims: config.blockedClaims || '',
  };

  const hash = createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 8);

  const bkashConfigured = hasValidRealPhone(settings.bkashNumber);
  const nagadConfigured = hasValidRealPhone(settings.nagadNumber);

  return {
    factsVersion: `v${canonical.configVersion}-${hash}`,
    generatedAt: new Date().toISOString(),
    orderingReady: isStorefrontOrderingReady(settings),
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
      estimatedDhakaDays: isStoreFieldConfirmed(settings, 'estimatedDhakaDays')
        ? settings.estimatedDhakaDays
        : '',
      estimatedSuburbanDays: isStoreFieldConfirmed(settings, 'estimatedSuburbanDays')
        ? settings.estimatedSuburbanDays || ''
        : '',
      estimatedOutsideDays: isStoreFieldConfirmed(settings, 'estimatedOutsideDays')
        ? settings.estimatedOutsideDays
        : '',
      estimatedRemoteDays: isStoreFieldConfirmed(settings, 'estimatedRemoteDays')
        ? settings.estimatedRemoteDays || ''
        : '',
      dispatchCutoffHourBst,
      cutoffNoticeEn: isStoreFieldConfirmed(settings, 'cutoffNoticeEn')
        ? settings.cutoffNoticeEn || ''
        : '',
      cutoffNoticeBn: isStoreFieldConfirmed(settings, 'cutoffNoticeBn')
        ? settings.cutoffNoticeBn || ''
        : '',
      policy: config.deliveryPolicy || '',
    },
    payments: {
      codAvailable: true,
      bkashNumber: bkashConfigured ? settings.bkashNumber : '',
      nagadNumber: nagadConfigured ? settings.nagadNumber : '',
      bkashConfigured,
      nagadConfigured,
      advanceDiscountPct: canonical.advanceDiscountPct,
      otherPaymentInfo: config.otherPaymentInfo || '',
    },
    contact: {
      supportPhone: hasValidRealPhone(settings.supportPhone) ? settings.supportPhone : '',
      whatsappNumber: hasValidRealPhone(settings.whatsappNumber) ? settings.whatsappNumber : '',
      supportEmail: isPlaceholderValue(settings.supportEmail) ? '' : settings.supportEmail,
      businessAddress: isPlaceholderValue(settings.businessAddress) ? '' : settings.businessAddress,
      district: config.district || '',
      city: config.city || '',
      googleMapsUrl: isPlaceholderValue(settings.googleMapsUrl || config.googleMapsUrl)
        ? ''
        : settings.googleMapsUrl || config.googleMapsUrl,
      directionsUrl: isPlaceholderValue(config.directionsUrl) ? '' : config.directionsUrl,
      facebookUrl: settings.facebookUrl || '',
      instagramUrl: settings.instagramUrl || '',
      phoneConfigured: hasValidRealPhone(settings.supportPhone),
      whatsappConfigured: hasValidRealPhone(settings.whatsappNumber),
    },
    policies: {
      returnPolicy: config.returnPolicy || '',
      replacementPolicy: config.replacementPolicy || '',
    },
    craft: {
      description: config.productDescription || '',
      ingredients: config.ingredients || '',
      taste: config.taste || '',
      aroma: config.aroma || '',
      texture: config.texture || '',
      productionMethod: config.productionMethod || '',
      shelfLife: config.shelfLife || '',
      storageInstructions: config.storageInstructions || '',
    },
    approvedClaims: config.approvedClaims || '',
    blockedClaims: config.blockedClaims || '',
    activeBatch: {
      batchCode: batch?.batchCode || '',
      originDistrict: batch?.originDistrict || '',
      productionDate: batch?.productionDate || '',
      expiryDate: batch?.expiryDate || '',
      labReportStatus: batch?.labReportStatus || '',
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
