import { NextResponse } from 'next/server';
import {
  DEFAULT_WEIGHT_PRICES,
  phoneRateWindow,
  recentSubmissions,
} from '../../../../src/lib/serverState';
import { normalizeWeight } from '../../../../src/lib/gemini/tools';

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return NextResponse.json(
      { error: 'Invalid request origin header.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const customerName = String(body.customerName || '').trim();
  const phone = String(body.phone || '').replace(/[\s-]/g, '');
  const district = String(body.district || '').trim();
  const area = String(body.area || '').trim();
  const address = String(body.address || '').trim();
  const deliveryZone = body.deliveryZone === 'dhaka' ? 'dhaka' : 'nationwide';
  const paymentMethod = String(body.paymentMethod || '');
  const txnId = String(body.txnId || '').trim();

  const fallbackWeight = normalizeWeight(body.weight) || '';
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
  if (!/^01[3-9]\d{8}$/.test(phone)) {
    return NextResponse.json(
      { error: 'Invalid Bangladesh mobile number (01XXXXXXXXX).' },
      { status: 400 }
    );
  }
  if (district.length < 2 || area.length < 2 || address.length < 5) {
    return NextResponse.json(
      { error: 'Complete district, area, and delivery address are required.' },
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

  const dedupKey = `${phone}:${qty250g}-${qty500g}-${qty1kg}:${paymentMethod}`;
  const lastSub = recentSubmissions.get(dedupKey);
  if (lastSub && now - lastSub < 45_000) {
    return NextResponse.json(
      {
        error:
          'Duplicate order detected within 45 seconds. Check your recent confirmation.',
      },
      { status: 409 }
    );
  }

  windowHits.push(now);
  phoneRateWindow.set(phone, windowHits);
  recentSubmissions.set(dedupKey, now);

  const settings = body.storePrices || {};
  const price250g =
    Number(settings['250g']) > 0
      ? Number(settings['250g'])
      : DEFAULT_WEIGHT_PRICES['250g'];
  const price500g =
    Number(settings['500g']) > 0
      ? Number(settings['500g'])
      : DEFAULT_WEIGHT_PRICES['500g'];
  const price1kg =
    Number(settings['1kg']) > 0
      ? Number(settings['1kg'])
      : DEFAULT_WEIGHT_PRICES['1kg'];

  const primaryWeight = qty500g > 0 ? '500g' : qty1kg > 0 ? '1kg' : '250g';
  const unitPriceBdt =
    primaryWeight === '250g'
      ? price250g
      : primaryWeight === '500g'
        ? price500g
        : price1kg;

  const summaryParts: string[] = [];
  if (qty250g > 0) summaryParts.push(`250g × ${qty250g}`);
  if (qty500g > 0) summaryParts.push(`500g × ${qty500g}`);
  if (qty1kg > 0) summaryParts.push(`1kg × ${qty1kg}`);
  const itemsSummary = summaryParts.join(', ').slice(0, 80);

  const insideDhakaFee =
    Number(settings.insideDhakaFee) >= 0 ? Number(settings.insideDhakaFee) : 80;
  const outsideDhakaFee =
    Number(settings.outsideDhakaFee) >= 0
      ? Number(settings.outsideDhakaFee)
      : 130;
  const freeThreshold =
    Number(settings.freeDeliveryThreshold) >= 0
      ? Number(settings.freeDeliveryThreshold)
      : 2500;
  const advanceDiscountPct =
    paymentMethod !== 'cod' && Number(settings.advanceDiscountPct) > 0
      ? Math.min(25, Number(settings.advanceDiscountPct))
      : 0;
  const couponDiscountPct =
    Number(body.couponDiscountPct) > 0
      ? Math.min(40, Number(body.couponDiscountPct))
      : 0;

  const subtotalBdt =
    qty250g * price250g + qty500g * price500g + qty1kg * price1kg;
  const deliveryFeeBdt =
    subtotalBdt >= freeThreshold
      ? 0
      : deliveryZone === 'dhaka'
        ? insideDhakaFee
        : outsideDhakaFee;

  const combinedPct = Math.min(50, advanceDiscountPct + couponDiscountPct);
  const discountBdt = Math.round((subtotalBdt * combinedPct) / 100);
  const totalBdt = Math.max(1, subtotalBdt + deliveryFeeBdt - discountBdt);

  const orderNumber = `DG-${Math.floor(1001 + Math.random() * 8990)}`;
  const paymentStatus =
    paymentMethod === 'cod' ? 'cod_due' : 'pending_verification';

  return NextResponse.json({
    orderNumber,
    weight: primaryWeight,
    qty: totalQty,
    qty250g,
    qty500g,
    qty1kg,
    itemsSummary,
    unitPriceBdt,
    subtotalBdt,
    deliveryFeeBdt,
    discountBdt,
    totalBdt,
    paymentStatus,
  });
}
