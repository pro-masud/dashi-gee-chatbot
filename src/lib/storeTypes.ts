export type WeightKey = '250g' | '500g' | '1kg';

export type DeliveryZone = 'dhaka' | 'suburban' | 'nationwide' | 'remote';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing' // legacy: equivalent to packaging
  | 'shipped' // legacy: equivalent to sent_to_courier
  | 'delivered'
  | 'cancelled'
  // Pipeline v2 (additive)
  | 'packaging'
  | 'ready_to_ship'
  | 'sent_to_courier'
  | 'out_for_delivery'
  | 'delivery_failed'
  | 'returned';

/** COD cash collection state — separate from the delivery status. */
export type CollectionStatus = 'awaiting' | 'collected' | 'partial' | 'failed';

/** Courier-to-store settlement state — separate from collection. */
export type SettlementStatus = 'pending' | 'partial' | 'settled' | 'disputed';

export type PaymentMethod = 'cod' | 'bkash' | 'nagad';

export type PaymentStatus =
  | 'cod_due'
  | 'pending_verification'
  | 'verified'
  | 'failed';

export type OrderRiskReviewStatus = 'none' | 'manual_review' | 'approved' | 'rejected';

export type CourierPartner = 'steadfast' | 'pathao' | 'redx' | 'manual';

export type ChannelSource = 'web' | 'messenger' | 'instagram' | 'whatsapp' | 'email' | 'sms';

export interface StoreSettingsDoc {
  productNameEn: string;
  productNameBn: string;
  taglineEn: string;
  taglineBn: string;
  originLocation: string;
  price250g: number;
  price500g: number;
  price1kg: number;
  stock250g: number;
  stock500g: number;
  stock1kg: number;
  insideDhakaFee: number;
  outsideDhakaFee: number;
  dhakaSuburbanFee?: number;
  remoteDistrictFee?: number;
  freeDeliveryThreshold: number;
  estimatedDhakaDays: string;
  estimatedSuburbanDays?: string;
  estimatedOutsideDays: string;
  estimatedRemoteDays?: string;
  dispatchCutoffHourBst?: number;
  cutoffNoticeEn?: string;
  cutoffNoticeBn?: string;
  maxJarsPerOrder?: number;
  codConfirmEnabled?: boolean;
  codHighValueThresholdBdt?: number;
  codRiskThresholdScore?: number;
  lastOrderNumber?: string;
  bkashNumber: string;
  nagadNumber: string;
  advanceDiscountPct: number;
  whatsappNumber: string;
  supportPhone: string;
  supportEmail: string;
  businessAddress: string;
  googleMapsUrl?: string;
  facebookUrl: string;
  instagramUrl: string;
  activeBatchCode: string;
  ownerConfirmedFields?: Record<string, boolean>;
}

/**
 * All unconfirmed business facts start `unset` (0 or '').
 * Never invent prices, fees, ETAs, cut-offs, stock, contacts, or claims in code defaults.
 * Values reach customers/chatbot ONLY once entered and confirmed by the owner in Admin.
 */
export const DEFAULT_STORE_SETTINGS: StoreSettingsDoc = {
  productNameEn: 'Deshi Gee — Pabna Grass-Fed Cow Ghee',
  productNameBn: 'দেশী ঘি — পাবনার খাঁটি গাওয়া ঘি',
  taglineEn: 'Pure Pabna cow ghee, wooden-churned to golden danadar.',
  taglineBn: 'পাবনার চারণভূমির দুধে কাঠের বিলোনার সোনালী দানাদার ঘি।',
  originLocation: 'Pabna, Bangladesh',
  price250g: 0,
  price500g: 0,
  price1kg: 0,
  stock250g: 0,
  stock500g: 0,
  stock1kg: 0,
  insideDhakaFee: 0,
  dhakaSuburbanFee: 0,
  outsideDhakaFee: 0,
  remoteDistrictFee: 0,
  freeDeliveryThreshold: 0,
  estimatedDhakaDays: '',
  estimatedSuburbanDays: '',
  estimatedOutsideDays: '',
  estimatedRemoteDays: '',
  dispatchCutoffHourBst: undefined,
  cutoffNoticeEn: '',
  cutoffNoticeBn: '',
  maxJarsPerOrder: 0,
  codConfirmEnabled: false,
  codHighValueThresholdBdt: 0,
  codRiskThresholdScore: 0,
  bkashNumber: '',
  nagadNumber: '',
  advanceDiscountPct: 0,
  whatsappNumber: '',
  supportPhone: '',
  supportEmail: '',
  businessAddress: '',
  googleMapsUrl: '',
  facebookUrl: '',
  instagramUrl: '',
  activeBatchCode: '',
  ownerConfirmedFields: {},
};

const PLACEHOLDER_PATTERNS = [
  /configure\s+in\s+admin/i,
  /pending\s+admin/i,
  /configurable\s+in\s+admin/i,
  /placeholder/i,
  /000000/,
  /hello@deshigee\.com/i,
  /example\.com/i,
  /house\s*&\s*road\s*address/i,
  /^coming\s*soon$/i,
  /^tbd$/i,
  /^n\/?a$/i,
  /^unset$/i,
];

export function isPlaceholderContactValue(val: string | undefined | null): boolean {
  const clean = String(val || '').trim();
  if (!clean) return true;
  return PLACEHOLDER_PATTERNS.some((rx) => rx.test(clean));
}

export function hasValidRealPhone(val: string | undefined | null): boolean {
  if (isPlaceholderContactValue(val)) return false;
  const digits = String(val || '').replace(/[^0-9]/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

export function hasValidRealContact(val: string | undefined | null): boolean {
  return !isPlaceholderContactValue(val);
}

export function hasValidRealUrl(val: string | undefined | null): boolean {
  if (isPlaceholderContactValue(val)) return false;
  const clean = String(val || '').trim();
  return /^https:\/\/[^\s]+$/i.test(clean);
}

/**
 * Checks whether a specific store setting field is confirmed by the owner.
 * - If `ownerConfirmedFields` explicitly marks the field `false`, returns `false` even if a value is stored.
 * - If `ownerConfirmedFields` explicitly marks the field `true`, validates that the value is non-placeholder/non-empty.
 * - For legacy Firestore docs that lack `ownerConfirmedFields` keys, treats non-zero/non-placeholder values as confirmed
 *   while `DEFAULT_STORE_SETTINGS` (all 0 / '') returns `false` for every business fact.
 */
export function isStoreFieldConfirmed(
  settings: StoreSettingsDoc | null | undefined,
  field: keyof StoreSettingsDoc
): boolean {
  if (!settings) return false;
  const map = settings.ownerConfirmedFields;
  if (map && Object.prototype.hasOwnProperty.call(map, field)) {
    if (!map[field]) return false;
  }
  const value = settings[field];
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0;
  }
  if (typeof value === 'string') {
    return !isPlaceholderContactValue(value);
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return false;
}

export function getConfirmedPriceForWeight(
  settings: StoreSettingsDoc | null | undefined,
  weight: WeightKey
): number | null {
  if (!settings) return null;
  const field: keyof StoreSettingsDoc =
    weight === '250g' ? 'price250g' : weight === '500g' ? 'price500g' : 'price1kg';
  if (!isStoreFieldConfirmed(settings, field)) return null;
  const price = Number(settings[field] || 0);
  return Number.isFinite(price) && price > 0 ? Math.round(price) : null;
}

export function getConfirmedDeliveryFeeForZone(
  settings: StoreSettingsDoc | null | undefined,
  zone: DeliveryZone
): number | null {
  if (!settings) return null;
  const field: keyof StoreSettingsDoc =
    zone === 'dhaka'
      ? 'insideDhakaFee'
      : zone === 'suburban'
        ? 'dhakaSuburbanFee'
        : zone === 'remote'
          ? 'remoteDistrictFee'
          : 'outsideDhakaFee';

  const map = settings.ownerConfirmedFields;
  if (map && Object.prototype.hasOwnProperty.call(map, field) && !map[field]) {
    return null;
  }
  const raw = settings[field];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (map?.[field] === true && typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.round(raw);
  }
  return null;
}

export function isStorefrontOrderingReady(settings: StoreSettingsDoc | null | undefined): boolean {
  if (!settings) return false;
  const hasAnyPrice =
    getConfirmedPriceForWeight(settings, '250g') !== null ||
    getConfirmedPriceForWeight(settings, '500g') !== null ||
    getConfirmedPriceForWeight(settings, '1kg') !== null;
  const hasBaseFee =
    getConfirmedDeliveryFeeForZone(settings, 'dhaka') !== null ||
    getConfirmedDeliveryFeeForZone(settings, 'nationwide') !== null;
  return hasAnyPrice && hasBaseFee;
}

export function getEffectiveMaxJarsPerOrder(settings: StoreSettingsDoc | null | undefined): number {
  if (settings && isStoreFieldConfirmed(settings, 'maxJarsPerOrder')) {
    const val = Math.round(Number(settings.maxJarsPerOrder || 0));
    if (val >= 1 && val <= 100) return val;
  }
  return 10;
}

export interface OrderRecord {
  orderNumber: string;
  customerName: string;
  phone: string;
  district: string;
  area: string;
  address: string;
  note: string;
  deliveryZone: DeliveryZone;
  weight: WeightKey;
  qty: number;
  qty250g: number;
  qty500g: number;
  qty1kg: number;
  itemsSummary: string;
  unitPriceBdt: number;
  subtotalBdt: number;
  deliveryFeeBdt: number;
  discountBdt: number;
  totalBdt: number;
  couponCode: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  txnId: string;
  paymentProofData: string;
  status: OrderStatus;
  estimatedDelivery: string;
  webhookStatus: string;
  courierPartner?: CourierPartner;
  consignmentId?: string;
  courierTrackingUrl?: string;
  dispatchedAtIso?: string;
  riskScore?: number;
  riskSignals?: string[];
  reviewStatus?: OrderRiskReviewStatus;
  duplicateWarning?: string;
  codVerificationStatus?: 'not_required' | 'not_configured' | 'pending' | 'verified';
  sourceChannel?: ChannelSource;
  /** Cost-of-goods snapshot (BDT) captured at order creation; powers the profit report. */
  cogsBdt?: number;
  /** COD cash collected by the courier from the customer. Never implied by status=delivered. */
  collectionStatus?: CollectionStatus;
  collectedAmountBdt?: number;
  /** Whether the courier has paid the collected cash out to the store. */
  settlementStatus?: SettlementStatus;
  settledAmountBdt?: number;
  settlementId?: string;
  deliveredAtIso?: string;
  returnedAtIso?: string;
  statusUpdatedAtIso?: string;
  /** Where a manually entered order came from (facebook_inbox / whatsapp / phone / other). */
  orderSource?: string;
  createdByEmail?: string;
  manualEntry?: boolean;
  attributedSessionId?: string;
  trackingTokenHash?: string;
  paymentLifecycleStatus?:
    | 'unpaid'
    | 'pending'
    | 'verification_required'
    | 'paid'
    | 'failed'
    | 'expired'
    | 'refunded'
    | 'partially_refunded';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TrackingRecord {
  orderNumber: string;
  weight: WeightKey;
  qty: number;
  qty250g?: number;
  qty500g?: number;
  qty1kg?: number;
  itemsSummary: string;
  subtotalBdt?: number;
  deliveryFeeBdt?: number;
  discountBdt?: number;
  couponCode?: string;
  deliveryZone?: DeliveryZone;
  district?: string;
  totalBdt: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  reviewStatus?: OrderRiskReviewStatus;
  estimatedDelivery: string;
  courierPartner?: CourierPartner;
  consignmentId?: string;
  courierTrackingUrl?: string;
  dispatchedAtIso?: string;
  trackingTokenHash?: string;
  maskedPhone?: string;
  paymentLifecycleStatus?:
    | 'unpaid'
    | 'pending'
    | 'verification_required'
    | 'paid'
    | 'failed'
    | 'expired'
    | 'refunded'
    | 'partially_refunded';
  updatedAt?: unknown;
}

export interface OrderAuditLogRecord {
  id: string;
  orderNumber: string;
  action:
    | 'created'
    | 'address_updated'
    | 'cancelled'
    | 'review_approved'
    | 'review_rejected'
    | 'status_updated'
    | 'cod_verification'
    | 'courier_updated'
    | 'payment_gateway_verified'
    | 'courier_webhook_synced';
  actorType: 'customer' | 'admin' | 'system';
  summary: string;
  previousStatus?: string;
  nextStatus?: string;
  previousTotalBdt?: number;
  nextTotalBdt?: number;
  metadata?: Record<string, unknown>;
  createdAt?: unknown;
}

export interface BatchRecord {
  batchCode: string;
  originDistrict: string;
  milkSource: string;
  productionDate: string;
  expiryDate: string;
  labReportStatus: string;
  labReportUrl: string;
  licenceDetails: string;
  active: boolean;
}

/**
 * Empty batch template — never invent batch codes, production/expiry dates, or lab status.
 */
export const DEFAULT_ACTIVE_BATCH: BatchRecord = {
  batchCode: '',
  originDistrict: '',
  milkSource: '',
  productionDate: '',
  expiryDate: '',
  labReportStatus: '',
  labReportUrl: '',
  licenceDetails: '',
  active: false,
};

export interface ReviewRecord {
  id: string;
  customerName: string;
  district: string;
  rating: number;
  comment: string;
  orderNumber: string;
  verifiedPurchase: boolean;
  helpfulCount: number;
  photoData: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt?: unknown;
}

export interface CouponRecord {
  code: string;
  discountPct: number;
  minSubtotalBdt: number;
  active: boolean;
  expiresAt?: string;
  maxUses?: number;
  usedCount?: number;
  stackableWithAdvance?: boolean;
  descriptionEn?: string;
}

export interface SubscriberRecord {
  id: string;
  email: string;
  lang: 'en' | 'bn';
}
