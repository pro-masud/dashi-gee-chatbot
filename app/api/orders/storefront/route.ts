import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import {
  getEffectiveMaxJarsPerOrder,
  isStorefrontOrderingReady,
  type OrderRecord,
  type PaymentMethod,
  type WeightKey,
} from '../../../../src/lib/storeTypes';
import {
  checkAndIncrementFirestoreRateLimit,
  checkRecentOrderFingerprint,
  createServerOrderAtomically,
  fetchServerCouponByCode,
  fetchServerStoreSettings,
} from '../../../../src/lib/chatbot/firestoreRest';
import { normalizeWeight } from '../../../../src/lib/chatbot/domain-guard';
import {
  assessAddressCompleteness,
  assessOrderRiskSignals,
  buildDuplicateFingerprintHash,
  buildOrderIdempotencyKey,
  computeOrderPricingInPoisha,
  getDispatchWindowInfo,
  isValidBangladeshPhone,
  normalizeBangladeshPhone,
  resolveConfiguredDistrictAndZone,
} from '../../../../src/lib/chatbot/orderToken';
import { extractClientIp, hashIdentifier } from '../../../../src/lib/chatbot/rateLimit';
import { disabledSlotsInOrder } from '../../../../src/lib/packages/packages';
import { getEnabledSlotsBestEffort } from '../../../../src/lib/server/packagesRepository';
import { markLeadConvertedByPhone } from '../../../../src/lib/server/leadsRepository';
import { computeOrderCogs } from '../../../../src/lib/finance/profit';
import { getFinanceSettingsBestEffort } from '../../../../src/lib/server/financeRepository';
import { dispatchOrderNotificationsServerSide } from '../../../../src/lib/integrations/orderNotify';

export const dynamic = 'force-dynamic';

function localizedError(
  uiLang: 'en' | 'bn',
  messageEn: string,
  messageBn: string,
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    {
      ok: false,
      error: uiLang === 'bn' ? messageBn : messageEn,
      messageEn,
      messageBn,
      ...(extra || {}),
    },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * S0-05 / Item 6: Server-side storefront checkout endpoint.
 * Validates cart & canonical pricing server-side, writes the order atomically,
 * returns localized EN/BN messages, and dispatches owner notifications directly
 * on the server without reopening /api/orders/notify to unauthenticated browsers.
 */
export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return localizedError(
      'en',
      'Invalid request origin header.',
      'অবৈধ রিকোয়েস্ট হেডার।',
      403
    );
  }

  const body = await request.json().catch(() => ({}));
  const uiLang: 'en' | 'bn' = body.uiLang === 'bn' ? 'bn' : 'en';
  const customerName = String(body.customerName || '').trim().slice(0, 100);
  const phone = normalizeBangladeshPhone(String(body.phone || ''));
  const districtInput = String(body.district || '').trim();
  const area = String(body.area || '').trim().slice(0, 100);
  const address = String(body.address || '').trim().slice(0, 300);
  const note = String(body.note || '').trim().slice(0, 240);
  const zoneHint = String(body.deliveryZone || '').trim();
  const paymentMethod = String(body.paymentMethod || '') as PaymentMethod;
  const txnId = String(body.txnId || '').trim().slice(0, 64);
  const paymentProofData = String(body.paymentProofData || '').slice(0, 180000);
  const couponCode = String(body.couponCode || '').trim().toUpperCase();

  const fallbackWeight = normalizeWeight(String(body.weight || '')) as WeightKey | null;
  const fallbackQty = Number(body.qty || 0);
  const hasSplitQtys =
    body.qty250g !== undefined ||
    body.qty500g !== undefined ||
    body.qty1kg !== undefined;

  const qty250g = hasSplitQtys
    ? Number(body.qty250g || 0)
    : fallbackWeight === '250g'
      ? fallbackQty
      : 0;
  const qty500g = hasSplitQtys
    ? Number(body.qty500g || 0)
    : fallbackWeight === '500g'
      ? fallbackQty
      : 0;
  const qty1kg = hasSplitQtys
    ? Number(body.qty1kg || 0)
    : fallbackWeight === '1kg'
      ? fallbackQty
      : 0;
  const totalQty = qty250g + qty500g + qty1kg;

  if (customerName.length < 2 || customerName.length > 100) {
    return localizedError(
      uiLang,
      'Valid full name is required.',
      'সঠিক পূর্ণ নাম লিখুন।',
      400
    );
  }
  if (!isValidBangladeshPhone(phone)) {
    return localizedError(
      uiLang,
      'Invalid Bangladesh mobile number (01XXXXXXXXX).',
      'সঠিক ১১ সংখ্যার বাংলাদেশি মোবাইল নম্বর দিন (01XXXXXXXXX)।',
      400
    );
  }

  const zoneResolved = resolveConfiguredDistrictAndZone(
    districtInput,
    zoneHint,
    `${area} ${address}`
  );
  if (!zoneResolved.valid) {
    if (zoneResolved.needsClarification && zoneResolved.suggestedDistrict) {
      return localizedError(
        uiLang,
        `Did you mean ${zoneResolved.suggestedDistrict}? Please confirm your district.`,
        `আপনি কি ${zoneResolved.suggestedDistrict} জেলা বোঝাচ্ছেন? অনুগ্রহ করে জেলা নিশ্চিত করুন।`,
        400,
        {
          code: 'district_typo_confirmation_required',
          needsClarification: true,
          suggestedDistrict: zoneResolved.suggestedDistrict,
        }
      );
    }
    return localizedError(
      uiLang,
      'Please select a valid Bangladesh district.',
      'অনুগ্রহ করে সঠিক বাংলাদেশি জেলা নির্বাচন করুন।',
      400
    );
  }
  if (area.length < 2) {
    return localizedError(
      uiLang,
      'Please enter your delivery area or thana.',
      'অনুগ্রহ করে আপনার এলাকা বা থানার নাম লিখুন।',
      400
    );
  }

  const addressCheck = assessAddressCompleteness(address, area, zoneResolved.canonicalDistrict);
  if (!addressCheck.complete) {
    return localizedError(
      uiLang,
      addressCheck.suggestionEn || 'Please enter a complete delivery address.',
      addressCheck.suggestionBn || 'অনুগ্রহ করে সম্পূর্ণ ডেলিভারি ঠিকানা লিখুন।',
      400,
      { code: addressCheck.reason || 'incomplete_address' }
    );
  }

  if (
    !Number.isInteger(qty250g) ||
    qty250g < 0 ||
    !Number.isInteger(qty500g) ||
    qty500g < 0 ||
    !Number.isInteger(qty1kg) ||
    qty1kg < 0 ||
    totalQty < 1 ||
    totalQty > 50
  ) {
    return localizedError(
      uiLang,
      'Total jar quantity must be between 1 and 50 jars.',
      'মোট জারের সংখ্যা ১ থেকে ৫০টির মধ্যে হতে হবে।',
      400
    );
  }
  if (!['cod', 'bkash', 'nagad'].includes(paymentMethod)) {
    return localizedError(
      uiLang,
      'Invalid payment method.',
      'সঠিক পেমেন্ট মাধ্যম নির্বাচন করুন।',
      400
    );
  }
  if ((paymentMethod === 'bkash' || paymentMethod === 'nagad') && txnId.length < 4) {
    return localizedError(
      uiLang,
      'Valid mobile payment Transaction ID is required.',
      'সঠিক বিকাশ/নগদ ট্রানজেকশন আইডি (TxnID) লিখুন।',
      400
    );
  }

  // Persistent IP + phone rate limits
  const ipHash = hashIdentifier(`storefront_order_ip:${extractClientIp(request)}`);
  const phoneHash = hashIdentifier(`storefront_order_phone:${phone}`);
  const [ipLimit, phoneLimit] = await Promise.all([
    checkAndIncrementFirestoreRateLimit(`sf_ord_ip_${ipHash}`, 8, 300_000),
    checkAndIncrementFirestoreRateLimit(`sf_ord_ph_${phoneHash}`, 6, 300_000),
  ]);
  if (!ipLimit.allowed || !phoneLimit.allowed) {
    return localizedError(
      uiLang,
      'Too many order attempts. Please wait a few minutes.',
      'অনেকবার অর্ডার করার চেষ্টা করা হয়েছে। কয়েক মিনিট পর আবার চেষ্টা করুন।',
      429,
      { code: 'rate_limited' }
    );
  }

  const [settings, coupon] = await Promise.all([
    fetchServerStoreSettings(),
    couponCode ? fetchServerCouponByCode(couponCode) : Promise.resolve(null),
  ]);

  if (!isStorefrontOrderingReady(settings)) {
    return localizedError(
      uiLang,
      'Ordering not available yet. Store prices and delivery fees have not been confirmed.',
      'স্টোরের মূল্য ও ডেলিভারি চার্জ এখনো নির্ধারিত হয়নি। অর্ডার গ্রহণ সাময়িকভাবে বন্ধ আছে।',
      503,
      { code: 'ordering_not_available' }
    );
  }

  const maxJarsAllowed = getEffectiveMaxJarsPerOrder(settings);
  if (totalQty > maxJarsAllowed) {
    return localizedError(
      uiLang,
      `Maximum ${maxJarsAllowed} jars per order. Please contact our team for bulk orders.`,
      `এক অর্ডারে সর্বোচ্চ ${maxJarsAllowed}টি জার অর্ডার করা যাবে।`,
      400,
      { code: 'max_jars_exceeded', maxJarsAllowed }
    );
  }

  const pricing = computeOrderPricingInPoisha({
    settings,
    qty250g,
    qty500g,
    qty1kg,
    deliveryZone: zoneResolved.deliveryZone,
    paymentMethod,
    coupon,
    maxTotalQty: maxJarsAllowed,
  });

  if (!pricing.stockSufficient) {
    const weightsList = pricing.insufficientWeights.join(', ');
    return localizedError(
      uiLang,
      `Insufficient stock for ${weightsList}. Please adjust jar quantity.`,
      `${weightsList} জারের পর্যাপ্ত স্টক নেই। অনুগ্রহ করে পরিমাণ কমান।`,
      409,
      {
        outOfStock: true,
        insufficientWeights: pricing.insufficientWeights,
      }
    );
  }

  if (couponCode && pricing.couponEvaluation && !pricing.couponEvaluation.valid) {
    return localizedError(
      uiLang,
      pricing.couponEvaluation.messageEn,
      pricing.couponEvaluation.messageBn,
      400,
      { couponReason: pricing.couponEvaluation.reason }
    );
  }

  const fingerprintHash = buildDuplicateFingerprintHash({
    phone,
    district: zoneResolved.canonicalDistrict,
    address,
    qty250g: pricing.qty250g,
    qty500g: pricing.qty500g,
    qty1kg: pricing.qty1kg,
  });
  const duplicateCheck = await checkRecentOrderFingerprint(fingerprintHash);
  const risk = assessOrderRiskSignals({
    phone,
    addressComplete: addressCheck.complete,
    duplicateRecentCount: duplicateCheck.duplicateFound ? 1 : 0,
    recentOrdersLastHour: Math.max(0, phoneLimit.count - 1),
    paymentMethod,
    totalBdt: pricing.totalBdt,
    codHighValueThresholdBdt: settings.codHighValueThresholdBdt,
    codRiskThresholdScore: settings.codRiskThresholdScore,
  });

  const disabledSlots = disabledSlotsInOrder(
    { qty250g: pricing.qty250g, qty500g: pricing.qty500g, qty1kg: pricing.qty1kg },
    await getEnabledSlotsBestEffort()
  );
  if (disabledSlots.length > 0) {
    return localizedError(
      uiLang,
      `The ${disabledSlots.join(', ')} jar is not available right now. Please choose another size.`,
      `${disabledSlots.join(', ')} জারটি এখন পাওয়া যাচ্ছে না। অনুগ্রহ করে অন্য সাইজ বেছে নিন।`,
      409
    );
  }

  const financeSettings = await getFinanceSettingsBestEffort();
  const cogsBdt = computeOrderCogs(
    { qty250g: pricing.qty250g, qty500g: pricing.qty500g, qty1kg: pricing.qty1kg },
    financeSettings
  );

  const dispatchWindow = getDispatchWindowInfo(settings);
  const orderNumber = `DG-${Math.floor(10000 + Math.random() * 89999)}`;
  const paymentStatus = paymentMethod === 'cod' ? 'cod_due' : 'pending_verification';
  const duplicateWarning = duplicateCheck.duplicateFound
    ? `Similar recent order (${duplicateCheck.recentOrderNumber}) detected within 2 hours. Team will double-check before shipping.`
    : '';

  const orderDoc: Omit<OrderRecord, 'createdAt' | 'updatedAt'> = {
    orderNumber,
    customerName,
    phone,
    district: zoneResolved.canonicalDistrict,
    area,
    address,
    note,
    deliveryZone: zoneResolved.deliveryZone,
    weight: pricing.primaryWeight,
    qty: pricing.totalQty,
    qty250g: pricing.qty250g,
    qty500g: pricing.qty500g,
    qty1kg: pricing.qty1kg,
    itemsSummary: pricing.itemsSummary,
    unitPriceBdt: pricing.unitPriceBdt,
    subtotalBdt: pricing.subtotalBdt,
    deliveryFeeBdt: pricing.deliveryFeeBdt,
    discountBdt: pricing.discountBdt,
    totalBdt: pricing.totalBdt,
    couponCode: pricing.couponEvaluation?.valid ? couponCode : '',
    paymentMethod,
    paymentStatus,
    txnId: paymentMethod === 'cod' ? '' : txnId,
    paymentProofData: paymentMethod === 'cod' ? '' : paymentProofData,
    status: 'pending',
    estimatedDelivery: pricing.estimatedDelivery,
    webhookStatus: 'pending_server_dispatch',
    riskScore: risk.riskScore,
    riskSignals: risk.riskSignals,
    reviewStatus: risk.reviewStatus,
    ...(duplicateWarning ? { duplicateWarning } : {}),
    codVerificationStatus:
      paymentMethod === 'cod' && settings.codConfirmEnabled ? 'not_configured' : 'not_required',
    sourceChannel: 'web',
    ...(cogsBdt !== undefined ? { cogsBdt } : {}),
  };

  const tokenId = `sf_${randomUUID()}`;
  const idemKey = buildOrderIdempotencyKey({
    sessionId: `storefront_${phoneHash}_${Math.floor(Date.now() / 60_000)}`,
    phone,
    weight: pricing.primaryWeight,
    qty: pricing.totalQty,
    qty250g: pricing.qty250g,
    qty500g: pricing.qty500g,
    qty1kg: pricing.qty1kg,
    totalBdt: pricing.totalBdt,
    deliveryArea: `${zoneResolved.deliveryZone}:${zoneResolved.canonicalDistrict}:${area}`,
  });

  const writeRes = await createServerOrderAtomically(
    orderDoc,
    {
      tokenId,
      sessionId: `storefront_${phoneHash}`,
      idemKey,
    },
    { fingerprintHash }
  );

  if (!writeRes.ok) {
    if (writeRes.serviceUnavailable) {
      return localizedError(
        uiLang,
        'Ordering is temporarily unavailable. Please try again shortly.',
        'অর্ডার সিস্টেম সাময়িকভাবে অনুপলব্ধ। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।',
        503,
        { code: 'admin_sdk_unavailable' }
      );
    }
    if (writeRes.couponExhausted) {
      return localizedError(
        uiLang,
        'This coupon code has reached its usage limit.',
        'এই কুপন কোডের ব্যবহারের সীমা শেষ হয়ে গেছে।',
        409,
        { code: 'coupon_usage_limit_reached' }
      );
    }
    if (writeRes.outOfStock) {
      return localizedError(
        uiLang,
        'Insufficient stock to complete this order.',
        'এই অর্ডার সম্পন্ন করার জন্য পর্যাপ্ত স্টক নেই।',
        409,
        { outOfStock: true }
      );
    }
    return localizedError(
      uiLang,
      writeRes.error || 'Could not save order right now.',
      'এই মুহূর্তে অর্ডার সংরক্ষণ করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।',
      500
    );
  }

  // Close the matching incomplete-order lead (best effort, never blocks the order).
  await markLeadConvertedByPhone(orderDoc.phone, orderDoc.orderNumber);

  // S0-05: Trigger owner notifications directly on the server after atomic persistence.
  const notifyResult = await dispatchOrderNotificationsServerSide({
    orderNumber: orderDoc.orderNumber,
    customerName: orderDoc.customerName,
    phone: orderDoc.phone,
    district: orderDoc.district,
    area: orderDoc.area,
    address: orderDoc.address,
    weight: orderDoc.weight,
    qty: orderDoc.qty,
    itemsSummary: orderDoc.itemsSummary,
    totalBdt: orderDoc.totalBdt,
    paymentMethod: orderDoc.paymentMethod,
    paymentStatus: orderDoc.paymentStatus,
    txnId: orderDoc.txnId,
  }).catch(() => ({
    ok: false as const,
    webhookStatus: 'failed_logged_retry_exhausted' as const,
    channelsAttempted: [] as Array<{ channel: string; status: string }>,
  }));

  return NextResponse.json(
    {
      ok: true,
      order: {
        ...orderDoc,
        webhookStatus: notifyResult.webhookStatus,
      },
      dispatchCutoffNote: dispatchWindow.noticeEn,
      dispatchCutoffNoteBn: dispatchWindow.noticeBn,
      trackingToken: writeRes.trackingToken || undefined,
      trackingHref: writeRes.trackingToken
        ? `/track?token=${encodeURIComponent(writeRes.trackingToken)}`
        : `/track?order=${encodeURIComponent(orderDoc.orderNumber)}`,
      notified: notifyResult.webhookStatus === 'delivered',
      notificationStatus: notifyResult.webhookStatus,
    },
    { status: 201 }
  );
}
