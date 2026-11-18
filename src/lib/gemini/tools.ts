import { Type, type FunctionDeclaration } from '@google/genai';
import type { BatchRecord, PaymentMethod, StoreSettingsDoc, WeightKey } from '../storeTypes';
import { CHATBOT_BUILD_CONFIG } from '../chatbot/build-config';
import {
  convertBanglaDigitsToEnglish,
  normalizeWeight,
} from '../chatbot/domain-guard';
import {
  checkRecentOrderFingerprint,
  createServerSupportRequest,
  fetchServerCouponByCode,
  fetchServerOrderTracking,
  manageServerOrder,
} from '../chatbot/firestoreRest';
import { runHybridKnowledgeSearch } from '../chatbot/hybridRag';
import {
  buildProductComparisonCards,
  recommendJarVariant,
} from '../chatbot/intentRouter';
import {
  assessAddressCompleteness,
  buildDuplicateFingerprintHash,
  computeOrderPricingInPoisha,
  evaluateCouponEligibility,
  getDispatchWindowInfo,
  isValidBangladeshPhone,
  normalizeBangladeshPhone,
  normalizeVariantQuantities,
  resolveConfiguredDistrictAndZone,
  resolveZoneDeliveryFeeAndEta,
  tryCreateSignedOrderToken,
} from '../chatbot/orderToken';
import { getBusinessHoursStatus } from '../chatbot/security';
import {
  buildStoreFactsSnapshot,
  type StoreFactsSnapshot,
} from '../chatbot/storeFacts';
import type {
  ChatActionItem,
  ChatbotConfigDoc,
  ChatbotFaqDoc,
  ChatbotKbDocRecord,
  KnowledgeChunkRecord,
  OrderStatePhase,
  OrderSummaryCard,
  ProductCardItem,
  TrackingCardData,
} from '../chatbot/types';
import { dispatchWebhookWithRetry, notificationLogs } from '../serverState';

export { normalizeWeight };

/**
 * Approved Gemini Function Declarations (21 total).
 * CRITICAL: `place_order` is intentionally NOT exposed to Gemini.
 * New orders can ONLY be created via POST /api/order after clicking Confirm Order.
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
      'Get Inside Dhaka, Dhaka Suburbs, Nationwide & Remote delivery charges, free delivery threshold, estimates, dispatch cutoff window, and delivery policy.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        district: {
          type: Type.STRING,
          description: 'Optional Bangladesh district name to check delivery zone.',
        },
        area: {
          type: Type.STRING,
          description: 'Optional area or suburb (e.g., Savar, Keraniganj, Uttara).',
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
      'Verify and look up real-time order progress using BOTH Order ID (e.g., DG-10421) and checkout Bangladesh phone number (01XXXXXXXXX).',
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
      'Validate all collected customer order details (single or mixed 250g/500g/1kg jars), calculate deterministic BDT total on the server, and generate a signed single-use confirmation token for the interactive Confirm Order card. Does NOT place the order.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        weight: {
          type: Type.STRING,
          description: 'Primary weight: 250g, 500g, or 1kg (optional when qty_250g/qty_500g/qty_1kg provided)',
        },
        quantity: {
          type: Type.NUMBER,
          description: 'Single-variant integer jar quantity (1 to 10)',
        },
        qty_250g: {
          type: Type.NUMBER,
          description: 'Optional number of 250g jars for mixed carts',
        },
        qty_500g: {
          type: Type.NUMBER,
          description: 'Optional number of 500g jars for mixed carts',
        },
        qty_1kg: {
          type: Type.NUMBER,
          description: 'Optional number of 1kg jars for mixed carts',
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
          description: 'Valid Bangladesh district name (all 64 districts supported)',
        },
        area: {
          type: Type.STRING,
          description: 'Thana, area, or neighbourhood',
        },
        address: {
          type: Type.STRING,
          description: 'Full street/house delivery address (>= 8 characters with house/road/landmark)',
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
    name: 'recommend_jar_variant',
    description:
      'Recommend the best Deshi Gee jar size (250g, 500g, or 1kg) based on household size, usage purpose, first-time trial, or gifting, verify live stock, suggest alternatives if out of stock, and check free-delivery qualification.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        household_size: { type: Type.STRING },
        usage_frequency: { type: Type.STRING },
        is_first_time: { type: Type.BOOLEAN },
        purpose: { type: Type.STRING },
        preferred_weight: { type: Type.STRING },
      },
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
  {
    name: 'get_variant_options',
    description:
      'List all 3 Deshi Gee jar options (250g, 500g, 1kg) with live BDT price, per-100g value rate, remaining stock, and free-delivery status.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'calculate_cart_quote',
    description:
      'Calculate an authoritative server BDT price quote for a single or mixed-variant jar cart (250g/500g/1kg), delivery zone fee, coupon discount, and free-delivery threshold.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        qty_250g: { type: Type.NUMBER },
        qty_500g: { type: Type.NUMBER },
        qty_1kg: { type: Type.NUMBER },
        district: { type: Type.STRING },
        area: { type: Type.STRING },
        payment_method: { type: Type.STRING },
        coupon_code: { type: Type.STRING },
      },
    },
  },
  {
    name: 'validate_coupon',
    description:
      'Verify a promo coupon code against active status, expiry date, max usage limits, and subtotal minimum.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        coupon_code: { type: Type.STRING },
        subtotal_bdt: { type: Type.NUMBER },
        payment_method: { type: Type.STRING },
      },
      required: ['coupon_code'],
    },
  },
  {
    name: 'quote_delivery',
    description:
      'Resolve any Bangladesh district (with typo tolerance) and area/suburb into a delivery zone (dhaka, suburban, nationwide, remote), exact fee, ETA, and BST dispatch cutoff window.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        district: { type: Type.STRING },
        area: { type: Type.STRING },
        subtotal_bdt: { type: Type.NUMBER },
      },
      required: ['district'],
    },
  },
  {
    name: 'recalculate_order',
    description:
      'Recalculate a draft or existing order total when jar quantities, coupon, payment method, or delivery district/suburb changes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        qty_250g: { type: Type.NUMBER },
        qty_500g: { type: Type.NUMBER },
        qty_1kg: { type: Type.NUMBER },
        district: { type: Type.STRING },
        area: { type: Type.STRING },
        payment_method: { type: Type.STRING },
        coupon_code: { type: Type.STRING },
      },
    },
  },
  {
    name: 'request_cancel',
    description:
      'Cancel a customer order before dispatch (only when status is pending or confirmed) after verifying Order ID and checkout phone number. Automatically restores jar stock.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        order_id: { type: Type.STRING },
        phone: { type: Type.STRING },
        reason: { type: Type.STRING },
      },
      required: ['order_id', 'phone'],
    },
  },
  {
    name: 'request_address_change',
    description:
      'Update delivery district/area/address on an existing order before dispatch (only when status is pending or confirmed) and recalculate delivery fee and total.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        order_id: { type: Type.STRING },
        phone: { type: Type.STRING },
        district: { type: Type.STRING },
        area: { type: Type.STRING },
        address: { type: Type.STRING },
      },
      required: ['order_id', 'phone', 'district', 'area', 'address'],
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
  facts?: StoreFactsSnapshot;
  faqs: ChatbotFaqDoc[];
  kbDocs: ChatbotKbDocRecord[];
  storedChunks?: KnowledgeChunkRecord[];
  isTestPlayground: boolean;
  collectedActions: ChatActionItem[];
  collectedOrderSummary?: OrderSummaryCard;
  collectedProductCards?: ProductCardItem[];
  collectedTrackingCard?: TrackingCardData;
  priceQuoteVersion?: number;
  orderState: OrderStatePhase;
  handoverTriggered: boolean;
  detectedIntent: string;
  verifiedMonetaryAmounts: Set<number>;
  verifiedOrderTrackingStatus?: string;
  customerPhoneInTurn?: string;
  errorCode?: string;
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
  const facts =
    ctx.facts || (ctx.facts = buildStoreFactsSnapshot({ settings, batch, config }));

  switch (name) {
    case 'get_product_information': {
      ctx.detectedIntent = 'product_info';
      return {
        factsVersion: facts.factsVersion,
        brandName: facts.brandName,
        productNameEn: facts.productNameEn,
        productNameBn: facts.productNameBn,
        origin: facts.originLocation,
        description: facts.craft.description,
        ingredients: facts.craft.ingredients,
        taste: facts.craft.taste,
        aroma: facts.craft.aroma,
        texture: facts.craft.texture,
        productionMethod: facts.craft.productionMethod,
        shelfLife: facts.craft.shelfLife,
        storageInstructions: facts.craft.storageInstructions,
        approvedClaims: facts.approvedClaims,
        activeBatch: facts.activeBatch,
        variants: ['250g', '500g', '1kg'],
      };
    }

    case 'get_variant_options': {
      ctx.detectedIntent = 'pricing';
      ctx.verifiedMonetaryAmounts.add(settings.price250g);
      ctx.verifiedMonetaryAmounts.add(settings.price500g);
      ctx.verifiedMonetaryAmounts.add(settings.price1kg);
      ctx.verifiedMonetaryAmounts.add(settings.freeDeliveryThreshold);
      return {
        currency: 'BDT (৳)',
        freeDeliveryThresholdBdt: settings.freeDeliveryThreshold,
        options: [
          {
            weight: '250g',
            priceBdt: settings.price250g,
            per100gBdt: Math.round(settings.price250g / 2.5),
            stockJars: settings.stock250g,
            inStock: settings.stock250g > 0,
            bestFor: 'First-time trial / solo kitchen',
          },
          {
            weight: '500g',
            priceBdt: settings.price500g,
            per100gBdt: Math.round(settings.price500g / 5),
            stockJars: settings.stock500g,
            inStock: settings.stock500g > 0,
            bestFor: 'Most popular everyday family jar',
          },
          {
            weight: '1kg',
            priceBdt: settings.price1kg,
            per100gBdt: Math.round(settings.price1kg / 10),
            stockJars: settings.stock1kg,
            inStock: settings.stock1kg > 0,
            bestFor: 'Best per-gram value, cooking & gifting',
          },
        ],
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

    case 'validate_coupon':
    case 'get_current_offers': {
      ctx.detectedIntent = 'offers';
      ctx.verifiedMonetaryAmounts.add(settings.freeDeliveryThreshold);
      const code = String(args.coupon_code || args.couponCode || '').trim().toUpperCase();
      const subtotalBdt = Number(args.subtotal_bdt || 0);
      const pm = (String(args.payment_method || 'cod').toLowerCase() as PaymentMethod) || 'cod';
      let couponResult: Record<string, unknown> | null = null;
      if (code) {
        if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
          couponResult = { valid: false, code, reason: 'invalid_coupon_format' };
        } else {
          const coupon = await fetchServerCouponByCode(code);
          const effectiveSub = subtotalBdt > 0 ? subtotalBdt : Number(coupon?.minSubtotalBdt || 0);
          const evalRes = evaluateCouponEligibility(coupon, effectiveSub, pm);
          if (coupon) ctx.verifiedMonetaryAmounts.add(coupon.minSubtotalBdt);
          couponResult = {
            valid: evalRes.valid,
            code,
            reason: evalRes.reason,
            discountPct: evalRes.discountPct,
            minSubtotalBdt: coupon?.minSubtotalBdt ?? 0,
            expiresAt: coupon?.expiresAt || '',
            stackableWithAdvance: evalRes.stackableWithAdvance,
            message: ctx.replyLang === 'bn' ? evalRes.messageBn : evalRes.messageEn,
          };
        }
      }
      if (name === 'validate_coupon') {
        return couponResult || { valid: false, reason: 'missing_code' };
      }
      return {
        offersSummary: config.currentOffers,
        freeDeliveryThresholdBdt: settings.freeDeliveryThreshold,
        advancePaymentDiscountPct: settings.advanceDiscountPct,
        couponCheck: couponResult,
      };
    }

    case 'quote_delivery':
    case 'get_delivery_information': {
      ctx.detectedIntent = 'delivery';
      ctx.verifiedMonetaryAmounts.add(settings.insideDhakaFee);
      ctx.verifiedMonetaryAmounts.add(settings.dhakaSuburbanFee ?? 100);
      ctx.verifiedMonetaryAmounts.add(settings.outsideDhakaFee);
      ctx.verifiedMonetaryAmounts.add(settings.remoteDistrictFee ?? 160);
      ctx.verifiedMonetaryAmounts.add(settings.freeDeliveryThreshold);

      const districtArg = String(args.district || '').trim();
      const areaArg = String(args.area || '').trim();
      const subtotalBdt = Number(args.subtotal_bdt || 0);
      const zoneCheck = districtArg
        ? resolveConfiguredDistrictAndZone(districtArg, undefined, areaArg)
        : null;
      const dispatch = getDispatchWindowInfo(settings);

      let queriedResult: Record<string, unknown> | undefined;
      if (zoneCheck) {
        if (zoneCheck.valid) {
          const zInfo = resolveZoneDeliveryFeeAndEta(settings, zoneCheck.deliveryZone);
          const free = subtotalBdt >= settings.freeDeliveryThreshold;
          queriedResult = {
            valid: true,
            district: zoneCheck.canonicalDistrict,
            matchedBy: zoneCheck.matchedBy,
            suggestedDistrict: zoneCheck.suggestedDistrict,
            zone: zoneCheck.deliveryZone,
            feeBdt: free ? 0 : zInfo.feeBdt,
            freeDeliveryApplied: free,
            estimatedDelivery: zInfo.etaText,
          };
        } else {
          queriedResult = { valid: false, district: districtArg };
        }
      }

      if (name === 'quote_delivery') {
        return {
          ...(queriedResult || { valid: false, district: districtArg }),
          freeDeliveryThresholdBdt: settings.freeDeliveryThreshold,
          dispatchCutoff: ctx.replyLang === 'bn' ? dispatch.noticeBn : dispatch.noticeEn,
        };
      }

      return {
        insideDhakaFeeBdt: settings.insideDhakaFee,
        dhakaSuburbanFeeBdt: settings.dhakaSuburbanFee ?? 100,
        outsideDhakaFeeBdt: settings.outsideDhakaFee,
        remoteDistrictFeeBdt: settings.remoteDistrictFee ?? 160,
        freeDeliveryThresholdBdt: settings.freeDeliveryThreshold,
        estimatedDhakaDays: settings.estimatedDhakaDays,
        estimatedSuburbanDays: settings.estimatedSuburbanDays,
        estimatedOutsideDays: settings.estimatedOutsideDays,
        estimatedRemoteDays: settings.estimatedRemoteDays,
        dispatchCutoff: ctx.replyLang === 'bn' ? dispatch.noticeBn : dispatch.noticeEn,
        deliveryPolicy: config.deliveryPolicy,
        queriedDistrict: queriedResult,
      };
    }

    case 'calculate_cart_quote':
    case 'recalculate_order': {
      ctx.detectedIntent = 'pricing';
      const q250 = Math.max(0, Math.round(Number(args.qty_250g || 0)));
      const q500 = Math.max(0, Math.round(Number(args.qty_500g || 0)));
      const q1k = Math.max(0, Math.round(Number(args.qty_1kg || 0)));
      const total = q250 + q500 + q1k;
      if (total < 1 || total > CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER) {
        return {
          ok: false,
          message: `Total jar count must be between 1 and ${CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER}.`,
        };
      }
      const zRes = resolveConfiguredDistrictAndZone(
        String(args.district || 'Dhaka'),
        undefined,
        String(args.area || '')
      );
      const pmRaw = String(args.payment_method || 'cod').toLowerCase();
      const paymentMethod: PaymentMethod =
        pmRaw === 'bkash' ? 'bkash' : pmRaw === 'nagad' ? 'nagad' : 'cod';
      const couponCode = String(args.coupon_code || '').trim().toUpperCase();
      const coupon = couponCode ? await fetchServerCouponByCode(couponCode) : null;

      const pricing = computeOrderPricingInPoisha({
        settings,
        qty250g: q250,
        qty500g: q500,
        qty1kg: q1k,
        deliveryZone: zRes.valid ? zRes.deliveryZone : 'dhaka',
        paymentMethod,
        coupon,
      });

      ctx.verifiedMonetaryAmounts.add(pricing.subtotalBdt);
      ctx.verifiedMonetaryAmounts.add(pricing.deliveryFeeBdt);
      ctx.verifiedMonetaryAmounts.add(pricing.discountBdt);
      ctx.verifiedMonetaryAmounts.add(pricing.totalBdt);
      ctx.verifiedMonetaryAmounts.add(settings.freeDeliveryThreshold);

      return {
        ok: true,
        itemsSummary: pricing.itemsSummary,
        variantBreakdown: pricing.variantBreakdown,
        district: zRes.valid ? zRes.canonicalDistrict : 'Dhaka',
        deliveryZone: zRes.valid ? zRes.deliveryZone : 'dhaka',
        subtotalBdt: pricing.subtotalBdt,
        deliveryFeeBdt: pricing.deliveryFeeBdt,
        discountBdt: pricing.discountBdt,
        totalBdt: pricing.totalBdt,
        freeDeliveryApplied: pricing.freeDeliveryApplied,
        stockSufficient: pricing.stockSufficient,
        insufficientWeights: pricing.insufficientWeights,
        estimatedDelivery: pricing.estimatedDelivery,
        couponStatus: pricing.couponEvaluation?.reason || 'none',
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
        return { matchedFaqs: [], matchedKnowledgeSnippets: [], noVerifiedMatch: true };
      }
      const rag = await runHybridKnowledgeSearch({
        query: q,
        faqs: ctx.faqs,
        kbDocs: ctx.kbDocs,
        storedChunks: ctx.storedChunks,
        replyLang: ctx.replyLang,
        synonyms: ctx.config.synonyms,
        limit: 5,
      });
      return {
        matchedFaqs: rag.faqs.map((f) => ({
          question: f.question,
          answer: f.answer,
          category: f.category,
        })),
        matchedKnowledgeSnippets: rag.kbSnippets,
        noVerifiedMatch: rag.noVerifiedMatch,
      };
    }

    case 'recommend_jar_variant': {
      ctx.detectedIntent = 'recommendation';
      ctx.verifiedMonetaryAmounts.add(settings.price250g);
      ctx.verifiedMonetaryAmounts.add(settings.price500g);
      ctx.verifiedMonetaryAmounts.add(settings.price1kg);
      ctx.verifiedMonetaryAmounts.add(settings.freeDeliveryThreshold);

      const rec = recommendJarVariant(
        {
          householdSize: String(args.household_size || ''),
          usageFrequency: String(args.usage_frequency || ''),
          isFirstTime: Boolean(args.is_first_time),
          purpose: String(args.purpose || ''),
          preferredWeight: String(args.preferred_weight || ''),
        },
        settings
      );
      ctx.verifiedMonetaryAmounts.add(rec.shortfallForFreeDeliveryBdt);
      ctx.collectedProductCards = buildProductComparisonCards(
        settings,
        rec.recommendedWeight,
        { en: rec.reasonEn, bn: rec.reasonBn }
      );
      return rec as unknown as Record<string, unknown>;
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
          message: 'Order ID must follow format DG-10421.',
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
      ctx.collectedTrackingCard = {
        orderNumber: tracking.orderNumber,
        status: tracking.status,
        paymentMethod: tracking.paymentMethod,
        paymentStatus: tracking.paymentStatus,
        itemsSummary: tracking.itemsSummary,
        totalBdt: tracking.totalBdt,
        estimatedDelivery: tracking.estimatedDelivery,
      };
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
        preDispatchEditable: tracking.status === 'pending' || tracking.status === 'confirmed',
      };
    }

    case 'request_cancel': {
      ctx.detectedIntent = 'order_manage';
      const orderId = convertBanglaDigitsToEnglish(String(args.order_id || '')).trim().toUpperCase();
      const phone = normalizeBangladeshPhone(String(args.phone || ''));
      ctx.customerPhoneInTurn = phone;
      const res = await manageServerOrder({
        action: 'cancel',
        orderNumber: orderId,
        phone,
        reason: String(args.reason || 'Customer requested cancel via assistant'),
      });
      if (!res.ok && res.supportRequired) {
        pushUniqueAction(ctx.collectedActions, {
          type: 'track_order',
          labelEn: 'Open Order Tracker',
          labelBn: 'অর্ডার ট্র্যাকার খুলুন',
          value: orderId,
          href: `/track?order=${encodeURIComponent(orderId)}`,
        });
      }
      return {
        ok: res.ok,
        eligible: res.eligible,
        supportRequired: res.supportRequired,
        orderNumber: res.orderNumber,
        currentStatus: res.currentStatus,
        nextStatus: res.nextStatus,
        stockRestored: res.stockRestored,
        message: ctx.replyLang === 'bn' ? res.messageBn : res.messageEn,
      };
    }

    case 'request_address_change': {
      ctx.detectedIntent = 'order_manage';
      const orderId = convertBanglaDigitsToEnglish(String(args.order_id || '')).trim().toUpperCase();
      const phone = normalizeBangladeshPhone(String(args.phone || ''));
      ctx.customerPhoneInTurn = phone;
      const res = await manageServerOrder({
        action: 'edit_address',
        orderNumber: orderId,
        phone,
        district: String(args.district || ''),
        area: String(args.area || ''),
        address: String(args.address || ''),
      });
      if (typeof res.updatedTotalBdt === 'number') {
        ctx.verifiedMonetaryAmounts.add(res.updatedTotalBdt);
      }
      if (typeof res.updatedDeliveryFeeBdt === 'number') {
        ctx.verifiedMonetaryAmounts.add(res.updatedDeliveryFeeBdt);
      }
      return {
        ok: res.ok,
        eligible: res.eligible,
        supportRequired: res.supportRequired,
        orderNumber: res.orderNumber,
        currentStatus: res.currentStatus,
        updatedDistrict: res.updatedDistrict,
        updatedZone: res.updatedZone,
        updatedDeliveryFeeBdt: res.updatedDeliveryFeeBdt,
        updatedTotalBdt: res.updatedTotalBdt,
        estimatedDelivery: res.estimatedDelivery,
        message: ctx.replyLang === 'bn' ? res.messageBn : res.messageEn,
      };
    }

    case 'prepare_order_summary': {
      ctx.detectedIntent = 'order_summary_prepared';
      ctx.orderState = 'collecting_details';

      const singleWeight = normalizeWeight(args.weight) as WeightKey | undefined;
      const singleQtyNum = Number(convertBanglaDigitsToEnglish(String(args.quantity ?? '0')));
      const q250Arg = Number(convertBanglaDigitsToEnglish(String(args.qty_250g ?? '0')));
      const q500Arg = Number(convertBanglaDigitsToEnglish(String(args.qty_500g ?? '0')));
      const q1kArg = Number(convertBanglaDigitsToEnglish(String(args.qty_1kg ?? '0')));

      const hasExplicitMix = q250Arg > 0 || q500Arg > 0 || q1kArg > 0;
      const rawTotal = hasExplicitMix
        ? Math.max(0, Math.round(q250Arg)) + Math.max(0, Math.round(q500Arg)) + Math.max(0, Math.round(q1kArg))
        : Math.round(singleQtyNum);

      if (!hasExplicitMix && (!singleWeight || !Number.isFinite(singleQtyNum) || rawTotal < 1)) {
        return {
          ready: false,
          reason: 'invalid_items',
          message: 'Select at least 1 jar of 250g, 500g, or 1kg.',
        };
      }

      if (rawTotal > CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER) {
        return {
          ready: false,
          reason: 'quantity_exceeds_max',
          maxQty: CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER,
          message: `Orders over ${CHATBOT_BUILD_CONFIG.MAX_QTY_PER_ORDER} jars require human confirmation. Ask to connect with support or reduce quantity.`,
        };
      }

      const norm = normalizeVariantQuantities({
        weight: singleWeight,
        qty: singleQtyNum,
        qty250g: hasExplicitMix ? q250Arg : undefined,
        qty500g: hasExplicitMix ? q500Arg : undefined,
        qty1kg: hasExplicitMix ? q1kArg : undefined,
      });

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

      const area = String(args.area || '').trim().slice(0, 100);
      const address = String(args.address || '').trim().slice(0, 300);
      const districtRaw = String(args.district || '').trim().slice(0, 80);
      const zoneRes = resolveConfiguredDistrictAndZone(districtRaw, undefined, `${area} ${address}`);
      if (!zoneRes.valid) {
        return {
          ready: false,
          reason: 'unsupported_delivery_area',
          message:
            'District could not be matched to a Bangladesh district. Please ask the customer to clarify one of the 64 districts.',
        };
      }

      const addressCheck = assessAddressCompleteness(address, area, zoneRes.canonicalDistrict);
      if (!addressCheck.complete || area.length < 2) {
        return {
          ready: false,
          reason: 'incomplete_address',
          message:
            addressCheck.suggestionEn ||
            'Both area/thana and full street address with house/road or village details are required.',
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
        weight: norm.primaryWeight,
        qty: norm.totalQty,
        qty250g: norm.qty250g,
        qty500g: norm.qty500g,
        qty1kg: norm.qty1kg,
        deliveryZone: zoneRes.deliveryZone,
        paymentMethod,
        coupon,
      });

      if (!pricing.stockSufficient) {
        return {
          ready: false,
          reason: 'insufficient_stock',
          insufficientWeights: pricing.insufficientWeights,
          availableStock: pricing.availableStock,
          message: `Insufficient stock for ${pricing.insufficientWeights.join(', ')}.`,
        };
      }

      if (couponCode && pricing.couponEvaluation && !pricing.couponEvaluation.valid) {
        return {
          ready: false,
          reason: pricing.couponEvaluation.reason,
          message:
            ctx.replyLang === 'bn'
              ? pricing.couponEvaluation.messageBn
              : pricing.couponEvaluation.messageEn,
        };
      }

      const fingerprintHash = buildDuplicateFingerprintHash({
        phone,
        district: zoneRes.canonicalDistrict,
        address,
        qty250g: pricing.qty250g,
        qty500g: pricing.qty500g,
        qty1kg: pricing.qty1kg,
      });
      const dupCheck = await checkRecentOrderFingerprint(fingerprintHash);
      const duplicateWarning = dupCheck.duplicateFound
        ? ctx.replyLang === 'bn'
          ? `গত ২ ঘণ্টার মধ্যে এই ঠিকানায় একই ধরনের অর্ডার (${dupCheck.recentOrderNumber}) পাওয়া গেছে।`
          : `Similar order (${dupCheck.recentOrderNumber}) placed within the last 2 hours.`
        : undefined;

      ctx.verifiedMonetaryAmounts.add(pricing.unitPriceBdt);
      ctx.verifiedMonetaryAmounts.add(pricing.subtotalBdt);
      ctx.verifiedMonetaryAmounts.add(pricing.deliveryFeeBdt);
      ctx.verifiedMonetaryAmounts.add(pricing.discountBdt);
      ctx.verifiedMonetaryAmounts.add(pricing.totalBdt);
      ctx.verifiedMonetaryAmounts.add(settings.freeDeliveryThreshold);

      const note = String(args.note || '').trim().slice(0, 240);
      const draft = {
        weight: pricing.primaryWeight,
        qty: pricing.totalQty,
        qty250g: pricing.qty250g,
        qty500g: pricing.qty500g,
        qty1kg: pricing.qty1kg,
        customerName,
        phone,
        district: zoneRes.canonicalDistrict,
        area,
        address,
        deliveryZone: zoneRes.deliveryZone,
        paymentMethod,
        txnId,
        couponCode: pricing.couponEvaluation?.valid ? couponCode : '',
        note,
      };

      const tokenRes = tryCreateSignedOrderToken({
        sessionId: ctx.sessionId,
        draft,
        pricing: {
          qty250g: pricing.qty250g,
          qty500g: pricing.qty500g,
          qty1kg: pricing.qty1kg,
          itemsSummary: pricing.itemsSummary,
          unitPriceBdt: pricing.unitPriceBdt,
          subtotalBdt: pricing.subtotalBdt,
          deliveryFeeBdt: pricing.deliveryFeeBdt,
          discountBdt: pricing.discountBdt,
          totalBdt: pricing.totalBdt,
        },
      });
      if (!tokenRes.ok) {
        ctx.errorCode = tokenRes.errorCode;
        ctx.orderState = 'failed';
        return {
          ready: false,
          reason: tokenRes.errorCode,
          message:
            'Online order token signing is not configured on the server right now. Ask the customer to place the order via the website form or WhatsApp/Phone.',
        };
      }
      const { token, payload } = tokenRes;
      const dispatch = getDispatchWindowInfo(settings);

      ctx.orderState = 'summary_shown';
      ctx.collectedOrderSummary = {
        productName: ctx.replyLang === 'bn' ? settings.productNameBn : settings.productNameEn,
        weight: pricing.primaryWeight,
        qty: pricing.totalQty,
        qty250g: pricing.qty250g,
        qty500g: pricing.qty500g,
        qty1kg: pricing.qty1kg,
        variantLines: pricing.variantBreakdown,
        itemsSummary: pricing.itemsSummary,
        unitPriceBdt: pricing.unitPriceBdt,
        subtotalBdt: pricing.subtotalBdt,
        deliveryFeeBdt: pricing.deliveryFeeBdt,
        discountBdt: pricing.discountBdt,
        totalBdt: pricing.totalBdt,
        customerName,
        phone,
        district: zoneRes.canonicalDistrict,
        area,
        deliveryZone: zoneRes.deliveryZone,
        deliveryArea: `${area}, ${zoneRes.canonicalDistrict} (${zoneRes.deliveryZone})`,
        address,
        note,
        txnId,
        couponCode: draft.couponCode,
        paymentMethod,
        confirmationToken: ctx.isTestPlayground ? undefined : token,
        expiresAt: payload.exp,
        confirmed: false,
        orderState: 'summary_shown',
        priceQuoteVersion: ctx.priceQuoteVersion || 1,
        estimatedDelivery: pricing.estimatedDelivery,
        dispatchCutoffNote: ctx.replyLang === 'bn' ? dispatch.noticeBn : dispatch.noticeEn,
        ...(duplicateWarning ? { duplicateWarning } : {}),
      };

      return {
        ready: true,
        orderState: 'summary_shown',
        simulatedPlayground: ctx.isTestPlayground,
        productName: ctx.collectedOrderSummary.productName,
        itemsSummary: pricing.itemsSummary,
        variantBreakdown: pricing.variantBreakdown,
        subtotalBdt: pricing.subtotalBdt,
        deliveryFeeBdt: pricing.deliveryFeeBdt,
        freeDeliveryApplied: pricing.freeDeliveryApplied,
        discountBdt: pricing.discountBdt,
        totalBdt: pricing.totalBdt,
        paymentMethod,
        estimatedDelivery: pricing.estimatedDelivery,
        dispatchCutoffNote: ctx.replyLang === 'bn' ? dispatch.noticeBn : dispatch.noticeEn,
        ...(duplicateWarning ? { duplicateWarning } : {}),
        instructionForAssistant:
          'Summary card with interactive Confirm Order & Edit buttons is now attached. Do NOT say order is placed — politely ask the customer to verify the summary card and click the Confirm Order button.',
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
