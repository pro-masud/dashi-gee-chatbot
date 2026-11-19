export type WeightKey = '250g' | '500g' | '1kg';

export type DeliveryZone = 'dhaka' | 'suburban' | 'nationwide' | 'remote';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

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
  codConfirmEnabled?: boolean;
  codHighValueThresholdBdt?: number;
  lastOrderNumber?: string;
  bkashNumber: string;
  nagadNumber: string;
  advanceDiscountPct: number;
  whatsappNumber: string;
  supportPhone: string;
  supportEmail: string;
  businessAddress: string;
  facebookUrl: string;
  instagramUrl: string;
  activeBatchCode: string;
}

export const DEFAULT_STORE_SETTINGS: StoreSettingsDoc = {
  productNameEn: 'Deshi Gee — Pabna Grass-Fed Cow Ghee',
  productNameBn: 'দেশী ঘি — পাবনার খাঁটি গাওয়া ঘি',
  taglineEn: 'Pure Pabna cow ghee, wooden-churned to golden danadar.',
  taglineBn: 'পাবনার চারণভূমির দুধে কাঠের বিলোনার সোনালী দানাদার ঘি।',
  originLocation: 'Bera & Faridpur, Pabna, Bangladesh',
  price250g: 680,
  price500g: 1290,
  price1kg: 2480,
  stock250g: 42,
  stock500g: 36,
  stock1kg: 20,
  insideDhakaFee: 80,
  dhakaSuburbanFee: 100,
  outsideDhakaFee: 130,
  remoteDistrictFee: 160,
  freeDeliveryThreshold: 2500,
  estimatedDhakaDays: '24–48 Hours (Inside Dhaka)',
  estimatedSuburbanDays: '2–3 Business Days (Dhaka Suburbs)',
  estimatedOutsideDays: '2–4 Business Days (Nationwide)',
  estimatedRemoteDays: '3–5 Business Days (Remote / Hill & Coastal)',
  dispatchCutoffHourBst: 14,
  cutoffNoticeEn: 'Orders confirmed before 2:00 PM BST dispatch same day.',
  cutoffNoticeBn: 'দুপুর ২টার (BST) আগে কনফার্ম হওয়া অর্ডার একই দিনে ডিসপ্যাচ হয়।',
  codConfirmEnabled: false,
  codHighValueThresholdBdt: 5000,
  bkashNumber: 'Configure in Admin',
  nagadNumber: 'Configure in Admin',
  advanceDiscountPct: 0,
  whatsappNumber: 'Configure in Admin',
  supportPhone: 'Configure in Admin',
  supportEmail: 'hello@deshigee.com',
  businessAddress: 'House & Road Address (Configurable in Admin)',
  facebookUrl: '',
  instagramUrl: '',
  activeBatchCode: 'DG-PAB-2026-042',
};

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
  attributedSessionId?: string;
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

export const DEFAULT_ACTIVE_BATCH: BatchRecord = {
  batchCode: 'DG-PAB-2026-042',
  originDistrict: 'Pabna, Rajshahi Division',
  milkSource: 'Whole Cultured Grass-Fed Deshi Cow Milk (100%)',
  productionDate: 'November 2026',
  expiryDate: 'November 2027',
  labReportStatus: 'Batch Lab PDF Upload Slot (Admin Configurable)',
  labReportUrl: '',
  licenceDetails: 'Regulatory Licence Number Pending Admin Entry',
  active: true,
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
