import { Type, type FunctionDeclaration } from '@google/genai';
import type { BatchRecord, PaymentMethod, StoreSettingsDoc, WeightKey } from '../storeTypes';
import { CHATBOT_BUILD_CONFIG } from '../chatbot/build-config';
import { convertBanglaDigitsToEnglish } from '../chatbot/domain-guard';
import {
  createServerSupportRequest,
  fetchServerCouponByCode,
  fetchServerOrderTracking,
} from '../chatbot/firestoreRest';
import {
  computeOrderPricingInPoisha,
  createSignedOrderToken,
  isValidBangladeshPhone,
  normalizeBangladeshPhone,
  resolveConfiguredDistrictAndZone,
} from '../chatbot/orderToken';
import { getBusinessHoursStatus, retrieveRelevantKnowledge } from '../chatbot/security';
import type {
  ChatActionItem,
  ChatbotConfigDoc,
  ChatbotFaqDoc,
  ChatbotKbDocRecord,
  OrderStatePhase,
  OrderSummaryCard,
} from '../chatbot/types';
import { dispatchWebhookWithRetry, notificationLogs } from '../serverState';

/**
 * Approved Gemini Function Declarations.
 * CRITICAL: `place_order` is intentionally NOT exposed to Gemini.
 * Orders can ONLY be created via POST /api/order after the user clicks Confirm Order.
 */
export const CHATBOT_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_product_information',
    description:
      'Get verified details about Deshi Gee single product: description, ingredients, taste, aroma, texture, bilona production craft, shelf life, storage, origin, approved claims, and active batch traceability.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_current_price',
    description:
      'Get live BDT (৳) prices for Deshi Gee 250g, 500g, and 1kg sealed glass jars.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        weight: {
          type: Type.STRING,
          description: 'Optional weight variant: 250g, 500g, or 1kg.',
        },
      },
    },
  },
  {
    name: 'get_product_stock',
    description: 'Check live remaining jar stock for 250g, 500g, and 1kg.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        weight: {
          type: Type.STRING,
          description: 'Optional weight variant: 250g, 500g, or 1kg.',
        },
      },
    },
  },
  {
    name: 'get_current_offers',
    description:
      'Check active promotional offers, free delivery threshold, advance payment discount, and optionally verify a coupon code.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        couponCode: {
          type: Type.STRING,
          description: 'Optional promo coupon code to verify.',
        },
      },
    },
  },
  {
    name: 'get_delivery_information',
    description:
      'Get Inside Dhaka & Outside Dhaka delivery charges, free delivery threshold, estimates, and delivery policy.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        district: {
          type: Type.STRING,
          description: 'Optional Bangladesh district name to check delivery zone.',
        },
      },
    },
  },
  {
    name: 'get_business_contact',
    description:
      'Get official phone number, WhatsApp number, email, district/city, full street address, Google Maps link, and Directions link.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_business_hours',
    description:
      'Get business hours, closed days, and real-time Open/Closed status in Asia/Dhaka (BST).',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_payment_methods',
    description:
      'Get supported payment methods (Cash on Delivery, bKash, Nagad), receiving account numbers, and rules.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_return_policy',
    description: 'Get verified return, broken-jar replacement, and refund policy.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_faq_information',
    description:
      'Search published FAQs and knowledge documents for a Deshi Gee customer question.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Customer question or keywords.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_order_status',
    description:
      'Verify and look up real-time order progress using BOTH Order ID (e.g., DG-1042) and checkout Bangladesh phone number (01XXXXXXXXX).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        order_id: {
          type: Type.STRING,
          description: 'Order ID in DG-XXXXX format',
        },
        phone: {
          type: Type.STRING,
          description: '11-digit Bangladesh mobile number (01XXXXXXXXX)',
        },
      },
      required: ['order_id', 'phone'],
    },
  },
  {
    name: 'prepare_order_summary',
    description:
      'Validate all collected customer order details, calculate deterministic BDT total on the server, and generate a signed single-use confirmation token for the interactive Confirm Order card. Does NOT place the order.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        weight: {
          type: Type.STRING,
          description: '250g, 500g, or 1kg',
        },
        quantity: {
          type: Type.NUMBER,
          description: 'Integer jar quantity (1 to 10)',
        },
        customer_name: {
          type: Type.STRING,
          description: 'Customer full name (>= 2 characters)',
        },
        phone: {
          type: Type.STRING,
          description: '11-digit Bangladesh phone number (01[3-9]XXXXXXXX)',
        },
        district: {
          type: Type.STRING,
          description: 'Valid Bangladesh district name (e.g. Dhaka, Chattogram, Pabna)',
        },
        area: {
          type: Type.STRING,
          description: 'Thana, area, or neighbourhood',
        },
        address: {
          type: Type.STRING,
          description: 'Full street/house delivery address (>= 5 characters)',
        },
        payment_method: {
          type: Type.STRING,
          description: 'cod, bkash, or nagad',
        },
        txn_id: {
          type: Type.STRING,
          description: 'Required (>= 4 chars) only when payment_method is bkash or nagad',
        },
        coupon_code: {
          type: Type.STRING,
          description: 'Optional promo coupon code',
        },
        note: {
          type: Type.STRING,
          description: 'Optional customer delivery note',
        },
      },
      required: [
        'weight',
        'quantity',
        'customer_name',
        'phone',
        'district',
        'area',
        'address',
        'payment_method',
      ],
    },
  },
  {
    name: 'submit_support_handover',
    description:
      'Create a consented human customer support callback/handover ticket when customer asks for a real agent, reports a damaged jar, requests bulk > 10 jars, or needs refund/payment help.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        customerName: { type: Type.STRING },
        phone: { type: Type.STRING },
        issueSummary: { type: Type.STRING },
      },
      required: ['customerName', 'phone', 'issueSummary'],
    },
  },
];

export const ALLOWED_CHATBOT_TOOLS = new Set(CHATBOT_FUNCTION_DECLARATIONS.map((f) => f.name));

export interface ToolRuntimeContext {
  sessionId: string;
  replyLang: 'bn' | 'en';
  settings: StoreSettingsDoc;
  config: ChatbotConfigDoc;
  batch: BatchRecord;
  faqs: ChatbotFaqDoc[];
  kbDocs: ChatbotKbDocRecord[];
  isTestPlayground: boolean;
  collectedActions: ChatActionItem[];
  collectedOrderSummary?: OrderSummaryCard;
  orderState: OrderStatePhase;
  handoverTriggered: boolean;
  detectedIntent: string;
  verifiedMonetaryAmounts: Set<number>;
  verifiedOrderTrackingStatus?: string;
  customerPhoneInTurn?: string;
}

export function normalizeWeight(raw: unknown): WeightKey | null {
  if (!raw) return null;
  const s = convertBanglaDigitsToEnglish(String(raw || ''))
    .toLowerCase()
    .replace(/[\s\-_.]+/g, '');
  if (!s) return null;

  // 250g variations
  if (
    s.includes('250') ||
    s.includes('পোয়া') ||
    s.includes('পোয়া') ||
    s.includes('quarter')
  ) {
    return '250g';
  }

  // 500g variations
  if (
    s.includes('500') ||
    s.includes('হাফ') ||
    s.includes('half') ||
    s.includes('আধা') ||
    s.includes('আধ')
  ) {
    return '500g';
  }

  // 1kg variations
  if (
    s.includes('1kg') ||
    s.includes('1000') ||
    s.includes('কেজি') ||
    s.includes('kg') ||
    s === '1' ||
    s.includes('এককেজি') ||
    s.includes('onekg')
  ) {
    return '1kg';
  }

  // Relative size terms
  if (s.includes('ছোট') || s === 'small') return '250g';
  if (s.includes('মাঝারি') || s === 'medium') return '500g';
  if (s.includes('বড়') || s.includes('বড়') || s === 'large') return '1kg';

  return null;
}

function cleanDialDigits(phone: string): string {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('01')) return `88${digits}`;
  return digits;
}

function pushUniqueAction(list: ChatActionItem[], action: ChatActionItem) {
  if (!list.some((a) => a.type === action.type && a.value === action.value)) {
    list.push(action);
  }
}

export async function executeChatbotTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolRuntimeContext
): Promise<Record<string, unknown>> {
  if (!ALLOWED_CHATBOT_TOOLS.has(name)) {
    return { error: `Disallowed or unknown tool: ${name}` };
  }

  const { settings, config, batch } = ctx;

  switch (name) {
    case 'get_product_information': {
      ctx.detectedIntent = 'product_info';
      return {
        brandName: config.brandName,
        productNameEn: settings.productNameEn,
        productNameBn: settings.productNameBn,
        origin: settings.originLocation,
        description: config.productDescription,
        ingredients: config.ingredients,
        taste: config.taste,
        aroma: config.aroma,
        texture: config.texture,
        productionMethod: config.productionMethod,
        shelfLife: config.shelfLife,
        storageInstructions: config.storageInstructions,
        approvedClaims: config.approvedClaims,
        activeBatch: {
          batchCode: batch.batchCode,
          originDistrict: batch.originDistrict,
          productionDate: batch.productionDate,
          expiryDate: batch.expiryDate,
          labReportStatus: batch.labReportStatus,
        },
        variants: ['250g', '500g', '1kg'],
      };
    }

    case 'get_current_price': {
      ctx.detectedIntent = 'pricing';
      ctx.verifiedMonetaryAmounts.add(settings.price250g);
      ctx.verifiedMonetaryAmounts.add(settings.price500g);
      ctx.verifiedMonetaryAmounts.add(settings.price1kg);
      ctx.verifiedMonetaryAmounts.add(settings.freeDeliveryThreshold);

      const requestedWeight = normalizeWeight(args.weight);
      if (requestedWeight) {
        const price =
          requestedWeight === '250g'
            ? settings.price250g
            : requestedWeight === '500g'
              ? settings.price500g
              : settings.price1kg;
        const stock =
          requestedWeight === '250g'
            ? settings.stock250g
            : requestedWeight === '500g'
              ? settings.stock500g
              : settings.stock1kg;
        return {
          currency: 'BDT (৳)',
          weight: requestedWeight,
          priceBdt: price,
          inStock: stock > 0,
          allPrices: {
            '250g': settings.price250g,
            '500g': settings.price500g,
            '1kg': settings.price1kg,
          },
          freeDeliveryThresholdBdt: settings.freeDeliveryThreshold,
        };
      }

      return {
        currency: 'BDT (৳)',
        prices: {
          '250g': { priceBdt: settings.price250g, inStock: settings.stock250g > 0 },
          '500g': { priceBdt: settings.price500g, inStock: settings.stock500g > 0 },
          '1kg': { priceBdt: settings.price1kg, inStock: settings.stock1kg > 0 },
        },
        freeDeliveryThresholdBdt: settings.freeDeliveryThreshold,
      };
    }

    case 'get_product_stock': {
      ctx.detectedIntent = 'stock';
      const w = normalizeWeight(args.weight);
      if (w) {
        const count =
          w === '250g' ? settings.stock250g : w === '500g' ? settings.stock500g : settings.stock1kg;
        return {
          weight: w,
          jarsAvailable: count,
          inStock: count > 0,
        };
      }
      return {
        stock: {
          '250g': { jarsAvailable: settings.stock250g, inStock: settings.stock250g > 0 },
          '500g': { jarsAvailable: settings.stock500g, inStock: settings.stock500g > 0 },
          '1kg': { jarsAvailable: settings.stock1kg, inStock: settings.stock1kg > 0 },
        },
      };
    }

    case 'get_current_offers': {
      ctx.detectedIntent = 'offers';
      ctx.verifiedMonetaryAmounts.add(settings.freeDeliveryThreshold);
      const code = String(args.couponCode || '').trim().toUpperCase();
      let couponResult: Record<string, unknown> | null = null;
      if (code) {
        if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
          couponResult = { valid: false, code, reason: 'invalid_coupon_format' };
        } else {
          const coupon = await fetchServerCouponByCode(code);
          if (coupon && coupon.active) {
            ctx.verifiedMonetaryAmounts.add(coupon.minSubtotalBdt);
            couponResult = {
              valid: true,
              code: coupon.code,
              discountPct: coupon.discountPct,
              minSubtotalBdt: coupon.minSubtotalBdt,
            };
          } else {
            couponResult = { valid: false, code };
          }
        }
      }
      return {
        offersSummary: config.currentOffers,
        freeDeliveryThresholdBdt: settings.freeDeliveryThreshold,
        advancePaymentDiscountPct: settings.advanceDiscountPct,
        couponCheck: couponResult,
      };
    }

    case 'get_delivery_information': {
      ctx.detectedIntent = 'delivery';
      ctx.verifiedMonetaryAmounts.add(settings.insideDhakaFee);
      ctx.verifiedMonetaryAmounts.add(settings.outsideDhakaFee);
      ctx.verifiedMonetaryAmounts.add(settings.freeDeliveryThreshold);

      const districtArg = String(args.district || '').trim();
      const zoneCheck = districtArg ? resolveConfiguredDistrictAndZone(districtArg) : null;

      return {
        insideDhakaFeeBdt: settings.insideDhakaFee,
        outsideDhakaFeeBdt: settings.outsideDhakaFee,
        freeDeliveryThresholdBdt: settings.freeDeliveryThreshold,
        estimatedDhakaDays: settings.estimatedDhakaDays,
        estimatedOutsideDays: settings.estimatedOutsideDays,
        deliveryPolicy: config.deliveryPolicy,
        queriedDistrict: zoneCheck
          ? zoneCheck.valid
            ? {
                valid: true,
                district: zoneCheck.canonicalDistrict,
                zone: zoneCheck.deliveryZone,
                feeBdt:
                  zoneCheck.deliveryZone === 'dhaka'
                    ? settings.insideDhakaFee
                    : settings.outsideDhakaFee,
              }
            : { valid: false, district: districtArg }
          : undefined,
      };
    }

    case 'get_business_contact': {
      ctx.detectedIntent = 'contact_location';
      const phone = settings.supportPhone;
      const whatsapp = settings.whatsappNumber;
      const phoneDigits = cleanDialDigits(phone);
      const waDigits = cleanDialDigits(whatsapp);
      const isConfiguredPhone =
        phoneDigits.length >= 10 && !phone.toLowerCase().includes('configure');
      const isConfiguredWa =
        waDigits.length >= 10 && !whatsapp.toLowerCase().includes('configure');

      if (isConfiguredPhone) {
        pushUniqueAction(ctx.collectedActions, {
          type: 'call',
          labelEn: 'Call Support',
          labelBn: 'ফোন করুন',
          value: phone,
          href: `tel:+${phoneDigits}`,
        });
        pushUniqueAction(ctx.collectedActions, {
          type: 'copy_phone',
          labelEn: 'Copy Phone',
          labelBn: 'নম্বর কপি করুন',
          value: phone,
        });
      }
      if (isConfiguredWa) {
        pushUniqueAction(ctx.collectedActions, {
          type: 'whatsapp',
          labelEn: 'Chat on WhatsApp',
          labelBn: 'WhatsApp-এ কথা বলুন',
          value: whatsapp,
          href: `https://wa.me/${waDigits}`,
        });
      }
      if (config.googleMapsUrl && config.googleMapsUrl.startsWith('http')) {
        pushUniqueAction(ctx.collectedActions, {
          type: 'maps',
          labelEn: 'View on Google Maps',
          labelBn: 'Google Maps-এ দেখুন',
          value: config.googleMapsUrl,
          href: config.googleMapsUrl,
        });
      }
      if (config.directionsUrl && config.directionsUrl.startsWith('http')) {
        pushUniqueAction(ctx.collectedActions, {
          type: 'directions',
          labelEn: 'Get Directions',
          labelBn: 'দিকনির্দেশনা দেখুন',
          value: config.directionsUrl,
          href: config.directionsUrl,
        });
      }

      return {
        businessAddress: settings.businessAddress,
        district: config.district,
        city: config.city,
        supportPhone: settings.supportPhone,
        whatsappNumber: settings.whatsappNumber,
        supportEmail: settings.supportEmail,
        googleMapsUrl: config.googleMapsUrl || 'Not configured yet',
        directionsUrl: config.directionsUrl || 'Not configured yet',
        facebookUrl: settings.facebookUrl || '',
        instagramUrl: settings.instagramUrl || '',
      };
    }

    case 'get_business_hours': {
      ctx.detectedIntent = 'business_hours';
      const status = getBusinessHoursStatus(config);
      return {
        businessHours: config.businessHours,
        openHourBst: config.openHourBst,
        closeHourBst: config.closeHourBst,
        closedDays: config.closedDays || 'None',
        currentTimeBst: status.currentTimeBst,
        isOpenNow: status.isOpenNow,
        availabilityNote: config.supportAvailabilityNote,
      };
    }

    case 'get_payment_methods': {
      ctx.detectedIntent = 'payment';
      return {
        cashOnDelivery: true,
        bkashNumber: settings.bkashNumber,
        nagadNumber: settings.nagadNumber,
        advanceDiscountPct: settings.advanceDiscountPct,
        otherPaymentInfo: config.otherPaymentInfo,
        securityNote:
          'Never ask for PIN, OTP, or password. Advance bKash/Nagad payments require only Transaction ID (TxnID) and remain Pending Verification until matched by our team.',
      };
    }

    case 'get_return_policy': {
      ctx.detectedIntent = 'return_policy';
      return {
        returnPolicy: config.returnPolicy,
        replacementPolicy: config.replacementPolicy,
      };
    }

    case 'get_faq_information': {
      ctx.detectedIntent = 'faq_kb';
      const q = String(args.query || '').slice(0, 300);
      if (!q.trim()) {
        return { matchedFaqs: [], matchedKnowledgeSnippets: [] };
      }
      const { faqs, kbSnippets } = retrieveRelevantKnowledge(
        q,
        ctx.faqs,
        ctx.kbDocs,
        ctx.replyLang,
        6
      );
      return {
        matchedFaqs: faqs.map((f) => ({
          question: f.question,
          answer: f.answer,
          category: f.category,
        })),
        matchedKnowledgeSnippets: kbSnippets,
      };
    }

    case 'get_order_status': {
      ctx.detectedIntent = 'order_tracking';
      const orderNumber = convertBanglaDigitsToEnglish(
        String(args.order_id || args.orderNumber || '')
      )
        .trim()
        .toUpperCase();
      const phone = normalizeBangladeshPhone(String(args.phone || ''));
      if (!/^DG-[0-9]{4,8}$/.test(orderNumber)) {
        return {
          found: false,
          reason: 'invalid_order_number',
          message: 'Order ID must follow format DG-1042.',
        };
      }
      if (!isValidBangladeshPhone(phone)) {
        return {
          found: false,
          reason: 'invalid_phone',
          message: 'Valid 11-digit Bangladesh mobile number (01XXXXXXXXX) is required.',
        };
      }
      ctx.customerPhoneInTurn = phone;

      const tracking = await fetchServerOrderTracking(orderNumber, phone);
      if (!tracking) {
        return {
          found: false,
          reason: 'not_found',
          message: 'No matching order found for that Order ID and phone number.',
        };
      }

      ctx.verifiedMonetaryAmounts.add(Math.round(tracking.totalBdt));
      ctx.verifiedOrderTrackingStatus = tracking.status;
      pushUniqueAction(ctx.collectedActions, {
        type: 'track_order',
        labelEn: 'Open Order Tracker',
        labelBn: 'অর্ডার ট্র্যাকার খুলুন',
        value: tracking.orderNumber,
        href: `/track?order=${encodeURIComponent(tracking.orderNumber)}`,
      });
      return {
        found: true,
        orderNumber: tracking.orderNumber,
        itemsSummary: tracking.itemsSummary,
        totalBdt: tracking.totalBdt,
        status: tracking.status,
        paymentMethod: tracking.paymentMethod,
        paymentStatus: tracking.paymentStatus,
        estimatedDelivery: tracking.estimatedDelivery,
      };
    }

    case 'prepare_order_summary': {
      ctx.detectedIntent = 'order_summary_prepared';
      ctx.orderState = 'collecting_details';

      const weight = normalizeWeight(args.weight);
      if (!weight) {
        return {
          ready: false,
          reason: 'invalid_weight',
          message: 'Weight must be 250g, 500g, or 1kg.',
        };
      }

      const rawQtyNum = Number(convertBanglaDigitsToEnglish(String(args.quantity ?? '')));
      if (!Number.isFinite(rawQtyNum) || rawQtyNum < 1) {
        return {
          ready: false,
          reason: 'invalid_quantity',
          message: 'Quantity must be at least 1 jar.',
        };
      }
      const qty = Math.round(rawQtyNum);
      if (qty > CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER) {
        return {
          ready: false,
          reason: 'quantity_exceeds_max',
          maxQty: CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER,
          message: `Orders over ${CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER} jars require human confirmation. Ask to connect with support or reduce quantity.`,
        };
      }

      const customerName = String(args.customer_name || '').trim().slice(0, 100);
      if (customerName.length < 2) {
        return {
          ready: false,
          reason: 'invalid_name',
          message: 'Valid customer name (>= 2 characters) is required.',
        };
      }

      const phone = normalizeBangladeshPhone(String(args.phone || ''));
      if (!isValidBangladeshPhone(phone)) {
        return {
          ready: false,
          reason: 'invalid_phone',
          message: 'Valid 11-digit Bangladesh mobile number (^01[3-9]\\d{8}$) is required.',
        };
      }
      ctx.customerPhoneInTurn = phone;

      const districtRaw = String(args.district || '').trim().slice(0, 80);
      const zoneRes = resolveConfiguredDistrictAndZone(districtRaw);
      if (!zoneRes.valid) {
        return {
          ready: false,
          reason: 'unsupported_delivery_area',
          message:
            'District could not be matched to a configured Bangladesh delivery zone. Ask customer to clarify a valid Bangladesh district (e.g., Dhaka, Chattogram, Pabna, Sylhet).',
        };
      }

      const area = String(args.area || '').trim().slice(0, 100);
      const address = String(args.address || '').trim().slice(0, 300);
      if (area.length < 2 || address.length < 5) {
        return {
          ready: false,
          reason: 'incomplete_address',
          message: 'Both area/thana and full street address (>= 5 characters) are required.',
        };
      }

      const pmRaw = String(args.payment_method || 'cod').toLowerCase().trim();
      const paymentMethod: PaymentMethod =
        pmRaw === 'bkash' ? 'bkash' : pmRaw === 'nagad' ? 'nagad' : 'cod';
      const txnId = String(args.txn_id || '').trim().slice(0, 64);
      if ((paymentMethod === 'bkash' || paymentMethod === 'nagad') && txnId.length < 4) {
        return {
          ready: false,
          reason: 'missing_txn_id',
          message: `A valid Transaction ID (>= 4 chars) is required for ${paymentMethod}. Never ask for PIN or OTP.`,
        };
      }

      const couponCode = String(args.coupon_code || '').trim().toUpperCase().slice(0, 32);
      const coupon = couponCode ? await fetchServerCouponByCode(couponCode) : null;
      const pricing = computeOrderPricingInPoisha({
        settings,
        weight,
        qty,
        deliveryZone: zoneRes.deliveryZone,
        paymentMethod,
        coupon,
      });

      if (pricing.availableStock < qty) {
        return {
          ready: false,
          reason: 'insufficient_stock',
          availableStock: pricing.availableStock,
          message: `Only ${pricing.availableStock} jars of ${weight} are currently in stock.`,
        };
      }

      ctx.verifiedMonetaryAmounts.add(pricing.unitPriceBdt);
      ctx.verifiedMonetaryAmounts.add(pricing.subtotalBdt);
      ctx.verifiedMonetaryAmounts.add(pricing.deliveryFeeBdt);
      ctx.verifiedMonetaryAmounts.add(pricing.discountBdt);
      ctx.verifiedMonetaryAmounts.add(pricing.totalBdt);
      ctx.verifiedMonetaryAmounts.add(settings.freeDeliveryThreshold);

      const note = String(args.note || '').trim().slice(0, 240);
      const draft = {
        weight,
        qty,
        customerName,
        phone,
        district: zoneRes.canonicalDistrict,
        area,
        address,
        deliveryZone: zoneRes.deliveryZone,
        paymentMethod,
        txnId,
        couponCode,
        note,
      };

      const { token, payload } = createSignedOrderToken({
        sessionId: ctx.sessionId,
        draft,
        pricing: {
          unitPriceBdt: pricing.unitPriceBdt,
          subtotalBdt: pricing.subtotalBdt,
          deliveryFeeBdt: pricing.deliveryFeeBdt,
          discountBdt: pricing.discountBdt,
          totalBdt: pricing.totalBdt,
        },
      });

      ctx.orderState = 'summary_shown';
      ctx.collectedOrderSummary = {
        productName: ctx.replyLang === 'bn' ? settings.productNameBn : settings.productNameEn,
        weight,
        qty,
        unitPriceBdt: pricing.unitPriceBdt,
        subtotalBdt: pricing.subtotalBdt,
        deliveryFeeBdt: pricing.deliveryFeeBdt,
        discountBdt: pricing.discountBdt,
        totalBdt: pricing.totalBdt,
        customerName,
        phone,
        district: zoneRes.canonicalDistrict,
        area,
        deliveryArea: `${area}, ${zoneRes.canonicalDistrict} (${zoneRes.deliveryZone === 'dhaka' ? 'Inside Dhaka' : 'Outside Dhaka'})`,
        address,
        note,
        txnId,
        couponCode,
        paymentMethod,
        confirmationToken: ctx.isTestPlayground ? undefined : token,
        expiresAt: payload.exp,
        confirmed: false,
        orderState: 'summary_shown',
      };

      return {
        ready: true,
        orderState: 'summary_shown',
        simulatedPlayground: ctx.isTestPlayground,
        productName: ctx.collectedOrderSummary.productName,
        weight,
        qty,
        unitPriceBdt: pricing.unitPriceBdt,
        subtotalBdt: pricing.subtotalBdt,
        deliveryFeeBdt: pricing.deliveryFeeBdt,
        freeDeliveryApplied: pricing.freeDeliveryApplied,
        discountBdt: pricing.discountBdt,
        totalBdt: pricing.totalBdt,
        paymentMethod,
        estimatedDelivery:
          zoneRes.deliveryZone === 'dhaka'
            ? settings.estimatedDhakaDays
            : settings.estimatedOutsideDays,
        instructionForAssistant:
          'Summary card with interactive Confirm Order & Edit buttons is now attached. Do NOT say order is placed — politely ask the customer to verify the summary card and press Confirm Order.',
      };
    }

    case 'submit_support_handover': {
      ctx.detectedIntent = 'human_handover';
      const customerName = String(args.customerName || '').trim().slice(0, 100);
      const phone = normalizeBangladeshPhone(String(args.phone || ''));
      const issueSummary = String(args.issueSummary || '').trim().slice(0, 500);

      if (customerName.length < 2 || !isValidBangladeshPhone(phone) || issueSummary.length < 4) {
        return {
          submitted: false,
          message: 'Need customerName, valid BD phone (01XXXXXXXXX), and brief issueSummary.',
        };
      }
      ctx.customerPhoneInTurn = phone;

      const saved = await createServerSupportRequest({
        sessionId: ctx.sessionId,
        customerName,
        phone,
        issueSummary,
      });
      if (!saved.ok) {
        return { submitted: false, message: saved.error || 'Failed to save ticket.' };
      }

      // Non-blocking owner notification for support handover
      const handoverTargets = [
        { channel: 'owner_webhook', url: process.env.OWNER_WEBHOOK_URL },
        { channel: 'whatsapp_api', url: process.env.WHATSAPP_WEBHOOK_URL },
        { channel: 'email_api', url: process.env.EMAIL_WEBHOOK_URL },
      ].filter((t) => Boolean(t.url));

      if (handoverTargets.length > 0) {
        Promise.all(
          handoverTargets.map((t) =>
            dispatchWebhookWithRetry(
              t.url as string,
              t.channel,
              {
                event: 'support_handover',
                orderNumber: saved.requestId || 'SUPPORT',
                customerName,
                phone,
                issueSummary,
                sessionId: ctx.sessionId,
                timestamp: new Date().toISOString(),
              },
              CHATBOT_BUILD_CONFIG.NOTIFICATION_RETRIES
            )
          )
        )
          .then((results) => {
            for (const r of results) {
              notificationLogs.unshift(r);
              if (notificationLogs.length > 50) notificationLogs.pop();
            }
          })
          .catch(() => {});
      }

      ctx.handoverTriggered = true;
      const phoneDigits = cleanDialDigits(settings.supportPhone);
      const waDigits = cleanDialDigits(settings.whatsappNumber);
      if (phoneDigits.length >= 10) {
        pushUniqueAction(ctx.collectedActions, {
          type: 'call',
          labelEn: 'Call Support',
          labelBn: 'ফোন করুন',
          value: settings.supportPhone,
          href: `tel:+${phoneDigits}`,
        });
      }
      if (waDigits.length >= 10) {
        pushUniqueAction(ctx.collectedActions, {
          type: 'whatsapp',
          labelEn: 'Chat on WhatsApp',
          labelBn: 'WhatsApp-এ কথা বলুন',
          value: settings.whatsappNumber,
          href: `https://wa.me/${waDigits}`,
        });
      }

      return {
        submitted: true,
        ticketId: saved.requestId,
        message: 'Human support handover saved to database.',
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
