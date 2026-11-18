import type { OrderRecord } from '../../../src/lib/storeTypes';
import { CHATBOT_BUILD_CONFIG } from '../../../src/lib/chatbot/build-config';
import {
  checkAndIncrementFirestoreRateLimit,
  checkOrderIdempotency,
  createServerOrderAtomically,
  fetchServerCouponByCode,
  fetchServerStoreSettings,
} from '../../../src/lib/chatbot/firestoreRest';
import {
  computeOrderPricingInPoisha,
  createSignedOrderToken,
  isValidBangladeshPhone,
  resolveConfiguredDistrictAndZone,
  verifySignedOrderToken,
} from '../../../src/lib/chatbot/orderToken';
import { sanitizeUserText } from '../../../src/lib/chatbot/security';
import { dispatchWebhookWithRetry, notificationLogs } from '../../../src/lib/serverState';

export async function POST(request: Request) {
  if (request.headers.get('x-requested-with') !== 'DeshiGeeStorefront') {
    return Response.json(
      { ok: false, error: 'Invalid request origin header.' },
      { status: 403 }
    );
  }

  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  if (Buffer.byteLength(rawBody, 'utf8') > CHATBOT_BUILD_CONFIG.MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: 'Payload too large.' }, { status: 413 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody || '{}') as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: 'Malformed JSON body.' }, { status: 400 });
  }

  const uiLang: 'en' | 'bn' = body.uiLang === 'bn' ? 'bn' : 'en';
  const bn = uiLang === 'bn';

  // Bot honeypot guard
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return Response.json(
      {
        ok: false,
        code: 'bot_rejected',
        error: bn ? 'অনুরোধটি গ্রহণ করা যায়নি।' : 'Request could not be processed.',
      },
      { status: 400 }
    );
  }

  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon_ip';

  // Persistent IP rate limit for order submissions (max 5/min)
  const ipRate = await checkAndIncrementFirestoreRateLimit(
    `order_ip_min_${clientIp}`,
    CHATBOT_BUILD_CONFIG.ORDER_IP_PER_MIN,
    60_000
  );
  if (!ipRate.allowed) {
    return Response.json(
      {
        ok: false,
        code: 'rate_limit',
        error: bn
          ? 'অনেক দ্রুত অর্ডার অনুরোধ পাঠানো হয়েছে। অনুগ্রহ করে ১ মিনিট পর চেষ্টা করুন।'
          : 'Too many order attempts right now. Please wait a minute and try again.',
      },
      { status: 429 }
    );
  }

  const confirmationToken = String(body.confirmationToken || '').trim();
  const sessionId = sanitizeUserText(String(body.sessionId || ''), 64);

  if (!confirmationToken || !sessionId) {
    return Response.json(
      {
        ok: false,
        code: 'missing_token',
        error: bn
          ? 'অর্ডার কনফার্মেশন টোকেন পাওয়া যায়নি। অনুগ্রহ করে আবার সারাংশ তৈরি করুন।'
          : 'Confirmation token is missing. Please prepare a fresh order summary.',
      },
      { status: 400 }
    );
  }

  // 1. Verify HMAC signature, previewHash integrity, and 10-min expiry
  const verified = verifySignedOrderToken(confirmationToken);
  if (!verified.ok) {
    const isExpired = verified.reason === 'expired_token';
    return Response.json(
      {
        ok: false,
        code: verified.reason,
        error: isExpired
          ? bn
            ? 'অর্ডার কনফার্মেশনের সময় (১০ মিনিট) শেষ হয়ে গেছে। অনুগ্রহ করে নতুন করে সারাংশ দেখে কনফার্ম করুন।'
            : 'This order confirmation link expired (10-minute limit). Please generate a fresh order summary.'
          : bn
            ? 'অর্ডার কনফার্মেশন টোকেনটি বৈধ নয়।'
            : 'Invalid or tampered order confirmation token.',
      },
      { status: 400 }
    );
  }

  const payload = verified.payload;

  // 2. Enforce session ownership
  if (payload.sessionId !== sessionId) {
    return Response.json(
      {
        ok: false,
        code: 'session_mismatch',
        error: bn
          ? 'সেশন মিলছে না। অনুগ্রহ করে বর্তমান চ্যাটে নতুন সারাংশ নিন।'
          : 'Session ownership mismatch. Please generate a new order summary in this session.',
      },
      { status: 403 }
    );
  }

  // 3. Revalidate order data integrity
  if (
    payload.qty < 1 ||
    payload.qty > CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER ||
    !isValidBangladeshPhone(payload.phone)
  ) {
    return Response.json(
      {
        ok: false,
        code: 'invalid_order_data',
        error: bn
          ? 'অর্ডার তথ্য বা মোবাইল নম্বর সঠিক নয়।'
          : 'Invalid quantity or Bangladesh mobile number.',
      },
      { status: 400 }
    );
  }

  const zoneCheck = resolveConfiguredDistrictAndZone(payload.district, payload.deliveryZone);
  if (!zoneCheck.valid) {
    return Response.json(
      {
        ok: false,
        code: 'unsupported_delivery_area',
        error: bn
          ? 'ডেলিভারি জেলাটি কনফিগারকৃত এলাকায় পাওয়া যায়নি।'
          : 'Selected delivery district is not configured.',
      },
      { status: 400 }
    );
  }

  if (
    (payload.paymentMethod === 'bkash' || payload.paymentMethod === 'nagad') &&
    payload.txnId.trim().length < 4
  ) {
    return Response.json(
      {
        ok: false,
        code: 'missing_txn_id',
        error: bn
          ? 'bKash/Nagad পেমেন্টের জন্য বৈধ Transaction ID প্রয়োজন।'
          : 'A valid Transaction ID is required for bKash/Nagad orders.',
      },
      { status: 400 }
    );
  }

  // 4. Duplicate idempotency check (same session+phone+items+total+area within 10 min returns original order)
  const existingIdem = await checkOrderIdempotency(payload.idempotencyKey);
  if (existingIdem.found && existingIdem.orderNumber) {
    return Response.json({
      ok: true,
      duplicatePrevented: true,
      orderNumber: existingIdem.orderNumber,
      trackingHref: `/track?order=${encodeURIComponent(existingIdem.orderNumber)}`,
      notificationStatus: 'already_processed',
      message: bn
        ? `ধন্যবাদ! আপনার অর্ডারটি ইতোমধ্যে গ্রহণ করা হয়েছে। অর্ডার নম্বর: ${existingIdem.orderNumber}।`
        : `Your order has already been received cleanly. Order ID: ${existingIdem.orderNumber}.`,
    });
  }

  // 5. Re-fetch live prices, coupons, stock, and delivery fee from Firestore
  const [settings, coupon] = await Promise.all([
    fetchServerStoreSettings(),
    payload.couponCode ? fetchServerCouponByCode(payload.couponCode) : Promise.resolve(null),
  ]);

  const livePricing = computeOrderPricingInPoisha({
    settings,
    weight: payload.weight,
    qty: payload.qty,
    deliveryZone: zoneCheck.deliveryZone,
    paymentMethod: payload.paymentMethod,
    coupon,
  });

  if (livePricing.availableStock < payload.qty) {
    return Response.json(
      {
        ok: false,
        outOfStock: true,
        availableStock: livePricing.availableStock,
        error: bn
          ? `দুঃখিত, ${payload.weight} সাইজের পর্যাপ্ত স্টক এখন নেই (অবশিষ্ট: ${livePricing.availableStock}টি)।`
          : `Sorry, insufficient stock for ${payload.weight} (${livePricing.availableStock} jars remaining).`,
      },
      { status: 409 }
    );
  }

  // If unit price, delivery charge, discount, or total changed since preview, require fresh confirmation
  if (
    livePricing.unitPriceBdt !== payload.unitPriceBdt ||
    livePricing.deliveryFeeBdt !== payload.deliveryFeeBdt ||
    livePricing.discountBdt !== payload.discountBdt ||
    livePricing.totalBdt !== payload.totalBdt
  ) {
    const refreshed = createSignedOrderToken({
      sessionId: payload.sessionId,
      draft: {
        weight: payload.weight,
        qty: payload.qty,
        customerName: payload.customerName,
        phone: payload.phone,
        district: zoneCheck.canonicalDistrict,
        area: payload.area,
        address: payload.address,
        deliveryZone: zoneCheck.deliveryZone,
        paymentMethod: payload.paymentMethod,
        txnId: payload.txnId,
        couponCode: payload.couponCode,
        note: payload.note,
      },
      pricing: {
        unitPriceBdt: livePricing.unitPriceBdt,
        subtotalBdt: livePricing.subtotalBdt,
        deliveryFeeBdt: livePricing.deliveryFeeBdt,
        discountBdt: livePricing.discountBdt,
        totalBdt: livePricing.totalBdt,
      },
    });

    return Response.json(
      {
        ok: false,
        priceChanged: true,
        error: bn
          ? `দাম বা ডেলিভারি চার্জ হালনাগাদ হয়েছে। নতুন সর্বমোট ৳${livePricing.totalBdt}। অনুগ্রহ করে আপডেট করা সারাংশ দেখে পুনরায় কনফার্ম করুন।`
          : `Live pricing or delivery fees updated (new total: ৳${livePricing.totalBdt}). Please review the updated summary and confirm again.`,
        updatedSummary: {
          productName: bn ? settings.productNameBn : settings.productNameEn,
          weight: payload.weight,
          qty: payload.qty,
          unitPriceBdt: livePricing.unitPriceBdt,
          subtotalBdt: livePricing.subtotalBdt,
          deliveryFeeBdt: livePricing.deliveryFeeBdt,
          discountBdt: livePricing.discountBdt,
          totalBdt: livePricing.totalBdt,
          customerName: payload.customerName,
          phone: payload.phone,
          district: zoneCheck.canonicalDistrict,
          area: payload.area,
          deliveryArea: `${payload.area}, ${zoneCheck.canonicalDistrict}`,
          address: payload.address,
          note: payload.note,
          txnId: payload.txnId,
          couponCode: payload.couponCode,
          paymentMethod: payload.paymentMethod,
          confirmationToken: refreshed.token,
          expiresAt: refreshed.payload.exp,
          confirmed: false,
          orderState: 'summary_shown',
        },
      },
      { status: 409 }
    );
  }

  // 6. Enforce per-phone hourly (3/hr) and daily (5/day) caps
  const [phoneHourly, phoneDaily] = await Promise.all([
    checkAndIncrementFirestoreRateLimit(
      `order_phone_hr_${payload.phone}`,
      CHATBOT_BUILD_CONFIG.ORDER_PHONE_PER_HOUR,
      60 * 60 * 1000
    ),
    checkAndIncrementFirestoreRateLimit(
      `order_phone_day_${payload.phone}`,
      CHATBOT_BUILD_CONFIG.ORDER_PHONE_PER_DAY,
      24 * 60 * 60 * 1000
    ),
  ]);

  if (!phoneHourly.allowed || !phoneDaily.allowed) {
    return Response.json(
      {
        ok: false,
        code: 'phone_order_limit',
        error: bn
          ? 'এই মোবাইল নম্বর থেকে স্বল্প সময়ে অনেক অর্ডার করা হয়েছে। অতিরিক্ত সহায়তার জন্য সরাসরি ফোন বা WhatsApp-এ যোগাযোগ করুন।'
          : 'Maximum chatbot order limit reached for this phone number. Please contact our support team for assistance.',
      },
      { status: 429 }
    );
  }

  // 7. Build OrderRecord & commit atomically with single-use token + idempotency lock
  const orderNumber = `DG-${Math.floor(10000 + Math.random() * 89999)}`;
  const paymentStatus =
    payload.paymentMethod === 'cod' ? 'cod_due' : 'pending_verification';
  const estimatedDelivery =
    zoneCheck.deliveryZone === 'dhaka'
      ? settings.estimatedDhakaDays
      : settings.estimatedOutsideDays;
  const itemsSummary = `${payload.weight} × ${payload.qty}`;

  const webhookTargets = [
    { channel: 'owner_webhook', url: process.env.OWNER_WEBHOOK_URL },
    { channel: 'google_sheets', url: process.env.GOOGLE_SHEETS_WEBHOOK_URL },
    { channel: 'whatsapp_api', url: process.env.WHATSAPP_WEBHOOK_URL },
    { channel: 'email_api', url: process.env.EMAIL_WEBHOOK_URL },
  ].filter((t) => Boolean(t.url));

  const orderDoc: Omit<OrderRecord, 'createdAt' | 'updatedAt'> = {
    orderNumber,
    customerName: payload.customerName,
    phone: payload.phone,
    district: zoneCheck.canonicalDistrict,
    area: payload.area,
    address: payload.address,
    note: (payload.note || 'Confirmed via Deshi Gee AI Assistant').slice(0, 240),
    deliveryZone: zoneCheck.deliveryZone,
    weight: payload.weight,
    qty: payload.qty,
    qty250g: payload.weight === '250g' ? payload.qty : 0,
    qty500g: payload.weight === '500g' ? payload.qty : 0,
    qty1kg: payload.weight === '1kg' ? payload.qty : 0,
    itemsSummary,
    unitPriceBdt: livePricing.unitPriceBdt,
    subtotalBdt: livePricing.subtotalBdt,
    deliveryFeeBdt: livePricing.deliveryFeeBdt,
    discountBdt: livePricing.discountBdt,
    totalBdt: livePricing.totalBdt,
    couponCode: payload.couponCode,
    paymentMethod: payload.paymentMethod,
    paymentStatus,
    txnId: payload.txnId,
    paymentProofData: '',
    status: 'pending',
    estimatedDelivery,
    webhookStatus:
      webhookTargets.length > 0 ? 'pending_server_dispatch' : 'not_configured',
  };

  const writeRes = await createServerOrderAtomically(orderDoc, {
    tokenId: payload.tokenId,
    sessionId: payload.sessionId,
    idemKey: payload.idempotencyKey,
  });

  if (!writeRes.ok) {
    if (writeRes.conflict) {
      const retryIdem = await checkOrderIdempotency(payload.idempotencyKey);
      if (retryIdem.found && retryIdem.orderNumber) {
        return Response.json({
          ok: true,
          duplicatePrevented: true,
          orderNumber: retryIdem.orderNumber,
          trackingHref: `/track?order=${encodeURIComponent(retryIdem.orderNumber)}`,
          notificationStatus: 'already_processed',
          message: bn
            ? `ধন্যবাদ! আপনার অর্ডারটি ইতোমধ্যে গ্রহণ করা হয়েছে। অর্ডার নম্বর: ${retryIdem.orderNumber}।`
            : `Order already recorded cleanly. Order ID: ${retryIdem.orderNumber}.`,
        });
      }
      return Response.json(
        {
          ok: false,
          code: 'token_already_used',
          error: bn
            ? 'এই কনফার্মেশন টোকেনটি একবার ব্যবহার করা হয়েছে। নতুন অর্ডারের জন্য আবার সারাংশ তৈরি করুন।'
            : 'This confirmation token has already been used.',
        },
        { status: 409 }
      );
    }

    return Response.json(
      {
        ok: false,
        code: 'database_error',
        error: bn
          ? 'দুঃখিত, এই মুহূর্তে অর্ডার সংরক্ষণ করা যায়নি। অনুগ্রহ করে সরাসরি ফোন বা WhatsApp-এ যোগাযোগ করুন।'
          : 'Could not save order right now. Please contact our support team via Phone or WhatsApp.',
      },
      { status: 500 }
    );
  }

  // 8. Dispatch Owner Notification AFTER successful DB save (3 retries + exponential backoff)
  // Notification failures are logged cleanly and NEVER cancel the saved order.
  let notificationStatus: 'delivered' | 'failed' | 'not_configured' = 'not_configured';

  if (webhookTargets.length === 0) {
    notificationLogs.unshift({
      orderNumber,
      channel: 'webhook_dispatcher',
      status: 'skipped_unconfigured',
      detail: 'No owner notification webhook URLs configured in environment; order saved in Firestore.',
      timestamp: new Date().toISOString(),
    });
    if (notificationLogs.length > 50) notificationLogs.pop();
  } else {
    const notifyPayload = {
      orderId: orderNumber,
      orderNumber,
      product: settings.productNameEn,
      weight: payload.weight,
      quantity: payload.qty,
      totalBdt: livePricing.totalBdt,
      customerName: payload.customerName,
      customerPhone: payload.phone,
      district: zoneCheck.canonicalDistrict,
      deliveryArea: payload.area,
      address: payload.address,
      note: orderDoc.note,
      paymentMethod: payload.paymentMethod,
      paymentStatus,
      orderTime: new Date().toISOString(),
      source: 'chatbot',
    };

    const results = await Promise.all(
      webhookTargets.map((t) =>
        dispatchWebhookWithRetry(
          t.url as string,
          t.channel,
          notifyPayload,
          CHATBOT_BUILD_CONFIG.NOTIFICATION_RETRIES
        )
      )
    );
    for (const r of results) {
      notificationLogs.unshift(r);
      if (notificationLogs.length > 50) notificationLogs.pop();
    }
    notificationStatus = results.some((r) => r.status === 'sent') ? 'delivered' : 'failed';
  }

  return Response.json({
    ok: true,
    duplicatePrevented: false,
    orderNumber,
    itemsSummary,
    totalBdt: livePricing.totalBdt,
    paymentMethod: payload.paymentMethod,
    paymentStatus,
    estimatedDelivery,
    notificationStatus,
    trackingHref: `/track?order=${encodeURIComponent(orderNumber)}`,
    message: bn
      ? `ধন্যবাদ! আপনার অর্ডারটি সফলভাবে গ্রহণ করা হয়েছে। আমাদের টিম অর্ডারটি যাচাই করে আপনাকে ফোনে যোগাযোগ করবে। আপনার অর্ডার নম্বর: ${orderNumber}।`
      : `Thank you! Your order has been received successfully. Our team will verify and call you shortly. Your Order ID: ${orderNumber}.`,
  });
}
