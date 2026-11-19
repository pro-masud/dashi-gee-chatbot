import { NextResponse } from 'next/server';
import type { PaymentMethod, WeightKey } from '../../../../src/lib/storeTypes';
import {
  checkRecentOrderFingerprint,
  fetchServerCouponByCode,
  fetchServerStoreSettings,
} from '../../../../src/lib/chatbot/firestoreRest';
import {
  assessAddressCompleteness,
  assessOrderRiskSignals,
  buildDuplicateFingerprintHash,
  computeOrderPricingInPoisha,
  getDispatchWindowInfo,
  isValidBangladeshPhone,
  normalizeBangladeshPhone,
  resolveConfiguredDistrictAndZone,
} from '../../../../src/lib/chatbot/orderToken';
import { phoneRateWindow } from '../../../../src/lib/serverState';
import { normalizeWeight } from '../../../../src/lib/chatbot/domain-guard';

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json(
      { error: 'Invalid request origin header.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const customerName = String(body.customerName || '').trim();
  const phone = normalizeBangladeshPhone(String(body.phone || ''));
  const districtInput = String(body.district || '').trim();
  const area = String(body.area || '').trim();
  const address = String(body.address || '').trim();
  const zoneHint = String(body.deliveryZone || '').trim();
  const paymentMethod = String(body.paymentMethod || '') as PaymentMethod;
  const txnId = String(body.txnId || '').trim();
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
    return NextResponse.json(
      { error: 'Valid full name is required.' },
      { status: 400 }
    );
  }
  if (!isValidBangladeshPhone(phone)) {
    return NextResponse.json(
      { error: 'Invalid Bangladesh mobile number (01XXXXXXXXX).' },
      { status: 400 }
    );
  }

  const zoneResolved = resolveConfiguredDistrictAndZone(
    districtInput,
    zoneHint,
    `${area} ${address}`
  );
  if (!zoneResolved.valid) {
    if (zoneResolved.needsClarification && zoneResolved.suggestedDistrict) {
      return NextResponse.json(
        {
          error: `Did you mean ${zoneResolved.suggestedDistrict}? Please confirm your district before continuing.`,
          code: 'district_typo_confirmation_required',
          needsClarification: true,
          suggestedDistrict: zoneResolved.suggestedDistrict,
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: 'Please select a valid Bangladesh district and enter your delivery area.',
      },
      { status: 400 }
    );
  }
  if (area.length < 2) {
    return NextResponse.json(
      {
        error: 'Please select a valid Bangladesh district and enter your delivery area.',
      },
      { status: 400 }
    );
  }

  const addressCheck = assessAddressCompleteness(address, area, zoneResolved.canonicalDistrict);
  if (!addressCheck.complete) {
    return NextResponse.json(
      {
        error: addressCheck.suggestionEn || 'Please enter a complete delivery address.',
        code: addressCheck.reason || 'incomplete_address',
      },
      { status: 400 }
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
    return NextResponse.json(
      { error: 'Total jar quantity must be between 1 and 50 jars.' },
      { status: 400 }
    );
  }
  if (!['cod', 'bkash', 'nagad'].includes(paymentMethod)) {
    return NextResponse.json(
      { error: 'Invalid payment method.' },
      { status: 400 }
    );
  }
  if (
    (paymentMethod === 'bkash' || paymentMethod === 'nagad') &&
    txnId.length < 4
  ) {
    return NextResponse.json(
      { error: 'Valid mobile payment Transaction ID is required.' },
      { status: 400 }
    );
  }

  const now = Date.now();
  const windowHits = (phoneRateWindow.get(phone) || []).filter(
    (ts) => now - ts < 300_000
  );
  if (windowHits.length >= 6) {
    return NextResponse.json(
      { error: 'Too many order attempts. Please wait a few minutes.' },
      { status: 429 }
    );
  }

  // Fetch authoritative live settings, coupon, and duplicate fingerprint check from server
  const [settings, coupon] = await Promise.all([
    fetchServerStoreSettings(),
    couponCode ? fetchServerCouponByCode(couponCode) : Promise.resolve(null),
  ]);

  const pricing = computeOrderPricingInPoisha({
    settings,
    qty250g,
    qty500g,
    qty1kg,
    deliveryZone: zoneResolved.deliveryZone,
    paymentMethod,
    coupon,
    maxTotalQty: 50,
  });

  if (!pricing.stockSufficient) {
    return NextResponse.json(
      {
        error: `Insufficient stock for ${pricing.insufficientWeights.join(', ')}. Please adjust jar quantity.`,
        outOfStock: true,
        insufficientWeights: pricing.insufficientWeights,
      },
      { status: 409 }
    );
  }

  if (couponCode && pricing.couponEvaluation && !pricing.couponEvaluation.valid) {
    return NextResponse.json(
      {
        error: pricing.couponEvaluation.messageEn,
        couponReason: pricing.couponEvaluation.reason,
      },
      { status: 400 }
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

  const recentHourHits = windowHits.length;
  windowHits.push(now);
  phoneRateWindow.set(phone, windowHits);

  const risk = assessOrderRiskSignals({
    phone,
    addressComplete: addressCheck.complete,
    duplicateRecentCount: duplicateCheck.duplicateFound ? 1 : 0,
    recentOrdersLastHour: recentHourHits,
    paymentMethod,
    totalBdt: pricing.totalBdt,
    codHighValueThresholdBdt: settings.codHighValueThresholdBdt,
  });

  const dispatchWindow = getDispatchWindowInfo(settings);
  const orderNumber = `DG-${Math.floor(10000 + Math.random() * 89999)}`;
  const paymentStatus =
    paymentMethod === 'cod' ? 'cod_due' : 'pending_verification';

  const duplicateWarning = duplicateCheck.duplicateFound
    ? `Similar recent order (${duplicateCheck.recentOrderNumber}) detected within 2 hours. Team will double-check before shipping.`
    : '';

  return NextResponse.json({
    orderNumber,
    district: zoneResolved.canonicalDistrict,
    deliveryZone: zoneResolved.deliveryZone,
    weight: pricing.primaryWeight,
    qty: pricing.totalQty,
    qty250g: pricing.qty250g,
    qty500g: pricing.qty500g,
    qty1kg: pricing.qty1kg,
    itemsSummary: pricing.itemsSummary,
    variantBreakdown: pricing.variantBreakdown,
    unitPriceBdt: pricing.unitPriceBdt,
    subtotalBdt: pricing.subtotalBdt,
    deliveryFeeBdt: pricing.deliveryFeeBdt,
    discountBdt: pricing.discountBdt,
    totalBdt: pricing.totalBdt,
    estimatedDelivery: pricing.estimatedDelivery,
    dispatchCutoffNote: dispatchWindow.noticeEn,
    paymentStatus,
    duplicateWarning,
    riskScore: risk.riskScore,
    riskSignals: risk.riskSignals,
    reviewStatus: risk.reviewStatus,
    codVerificationStatus:
      paymentMethod === 'cod' && settings.codConfirmEnabled
        ? 'not_configured'
        : 'not_required',
  });
}
