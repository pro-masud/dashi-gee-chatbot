export type WeightKey = '250g' | '500g' | '1kg';

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
  freeDeliveryThreshold: number;
  estimatedDhakaDays: string;
  estimatedOutsideDays: string;
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
  outsideDhakaFee: 130,
  freeDeliveryThreshold: 2500,
  estimatedDhakaDays: '24–48 Hours (Inside Dhaka)',
  estimatedOutsideDays: '2–4 Business Days (Nationwide)',
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
  deliveryZone: 'dhaka' | 'nationwide';
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
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TrackingRecord {
  orderNumber: string;
  weight: WeightKey;
  qty: number;
  itemsSummary: string;
  totalBdt: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  estimatedDelivery: string;
  updatedAt?: unknown;
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
}

export interface SubscriberRecord {
  id: string;
  email: string;
  lang: 'en' | 'bn';
}
