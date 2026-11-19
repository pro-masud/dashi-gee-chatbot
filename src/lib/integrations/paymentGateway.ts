import { createHash, timingSafeEqual } from 'node:crypto';
import { normalizeBangladeshPhone } from '../chatbot/orderToken';

export type OnlinePaymentGateway = 'sslcommerz' | 'bkash';

/**
 * Computes the official SSLCommerz IPN MD5 verify_sign hash over `verify_key` fields
 * plus `store_passwd = md5(storePasswd)`, sorted alphabetically by key.
 */
export function computeSslCommerzIpnSignature(
  fields: Record<string, string>,
  storePasswd: string
): string | null {
  const verifyKeyRaw = String(fields.verify_key || '').trim();
  const cleanPass = String(storePasswd || '').trim();
  if (!verifyKeyRaw || !cleanPass) return null;

  const keys = verifyKeyRaw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0 && k !== 'store_passwd');

  if (keys.length === 0) return null;

  const storePassMd5 = createHash('md5').update(cleanPass, 'utf8').digest('hex');
  const map: Record<string, string> = {
    store_passwd: storePassMd5,
  };
  for (const key of keys) {
    map[key] = String(fields[key] ?? '');
  }

  const sortedKeys = Object.keys(map).sort();
  const payload = sortedKeys.map((k) => `${k}=${map[k]}`).join('&');
  return createHash('md5').update(payload, 'utf8').digest('hex');
}

export function verifySslCommerzIpnSignature(
  fields: Record<string, string>,
  storePasswd = process.env.SSLCOMMERZ_STORE_PASSWD || ''
): { ok: boolean; reason?: string } {
  const receivedRaw = String(fields.verify_sign || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(receivedRaw)) {
    return { ok: false, reason: 'missing_or_malformed_verify_sign' };
  }
  const expected = computeSslCommerzIpnSignature(fields, storePasswd);
  if (!expected) {
    return { ok: false, reason: 'missing_verify_key_or_store_passwd' };
  }
  const a = Buffer.from(receivedRaw, 'utf8');
  const b = Buffer.from(expected.toLowerCase(), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'verify_sign_mismatch' };
  }
  return { ok: true };
}

export interface PaymentGatewayReadiness {
  sslcommerz: {
    configured: boolean;
    liveMode: boolean;
  };
  bkash: {
    configured: boolean;
    liveMode: boolean;
  };
  anyConfigured: boolean;
}

export interface PaymentInitiationInput {
  gateway: OnlinePaymentGateway;
  orderNumber: string;
  amountBdt: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerDistrict: string;
  itemsSummary: string;
  siteBaseUrl: string;
}

export interface PaymentInitiationResult {
  ok: boolean;
  gateway: OnlinePaymentGateway;
  gatewayUrl?: string;
  sessionKey?: string;
  paymentId?: string;
  error?: string;
  code?: string;
}

export interface PaymentVerificationResult {
  ok: boolean;
  verified: boolean;
  gateway: OnlinePaymentGateway;
  orderNumber: string;
  transactionId: string;
  valId?: string;
  amountBdt: number;
  currency: string;
  rawStatus: string;
  error?: string;
}

export function getPaymentGatewayReadiness(): PaymentGatewayReadiness {
  const sslStoreId = (process.env.SSLCOMMERZ_STORE_ID || '').trim();
  const sslPasswd = (process.env.SSLCOMMERZ_STORE_PASSWD || '').trim();
  const sslConfigured = sslStoreId.length >= 3 && sslPasswd.length >= 3;

  const bkKey = (process.env.BKASH_APP_KEY || '').trim();
  const bkSecret = (process.env.BKASH_APP_SECRET || '').trim();
  const bkUser = (process.env.BKASH_USERNAME || '').trim();
  const bkPass = (process.env.BKASH_PASSWORD || '').trim();
  const bkConfigured =
    bkKey.length >= 4 && bkSecret.length >= 4 && bkUser.length >= 2 && bkPass.length >= 2;

  return {
    sslcommerz: {
      configured: sslConfigured,
      liveMode: String(process.env.SSLCOMMERZ_IS_LIVE || '').toLowerCase() === 'true',
    },
    bkash: {
      configured: bkConfigured,
      liveMode: String(process.env.BKASH_IS_LIVE || '').toLowerCase() === 'true',
    },
    anyConfigured: sslConfigured || bkConfigured,
  };
}

function getSslCommerzBaseUrl(): string {
  return String(process.env.SSLCOMMERZ_IS_LIVE || '').toLowerCase() === 'true'
    ? 'https://securepay.sslcommerz.com'
    : 'https://sandbox.sslcommerz.com';
}

function getBkashBaseUrl(): string {
  return String(process.env.BKASH_IS_LIVE || '').toLowerCase() === 'true'
    ? 'https://tokenized.pay.bka.sh/v1.2.0-beta'
    : 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
}

export async function initiateSslCommerzPayment(
  input: PaymentInitiationInput
): Promise<PaymentInitiationResult> {
  const readiness = getPaymentGatewayReadiness();
  if (!readiness.sslcommerz.configured) {
    return {
      ok: false,
      gateway: 'sslcommerz',
      code: 'gateway_not_configured',
      error: 'SSLCommerz credentials are not configured on the server.',
    };
  }

  const base = input.siteBaseUrl.replace(/\/+$/, '');
  const callbackBase = `${base}/api/payments/callback?gateway=sslcommerz&order=${encodeURIComponent(
    input.orderNumber
  )}`;
  const form = new URLSearchParams({
    store_id: (process.env.SSLCOMMERZ_STORE_ID || '').trim(),
    store_passwd: (process.env.SSLCOMMERZ_STORE_PASSWD || '').trim(),
    total_amount: String(Math.max(1, Math.round(input.amountBdt))),
    currency: 'BDT',
    tran_id: input.orderNumber,
    success_url: `${callbackBase}&outcome=success`,
    fail_url: `${callbackBase}&outcome=fail`,
    cancel_url: `${callbackBase}&outcome=cancel`,
    ipn_url: `${callbackBase}&outcome=ipn`,
    shipping_method: 'Courier',
    product_name: input.itemsSummary.slice(0, 120) || 'Deshi Gee Pure Cow Ghee',
    product_category: 'Food & Grocery',
    product_profile: 'physical-goods',
    cus_name: input.customerName.slice(0, 60) || 'Customer',
    cus_email: 'orders@deshigee.com',
    cus_add1: input.customerAddress.slice(0, 120) || 'Dhaka',
    cus_city: input.customerDistrict.slice(0, 40) || 'Dhaka',
    cus_country: 'Bangladesh',
    cus_phone: normalizeBangladeshPhone(input.customerPhone),
    ship_name: input.customerName.slice(0, 60) || 'Customer',
    ship_add1: input.customerAddress.slice(0, 120) || 'Dhaka',
    ship_city: input.customerDistrict.slice(0, 40) || 'Dhaka',
    ship_postcode: '1200',
    ship_country: 'Bangladesh',
  });

  try {
    const res = await fetch(`${getSslCommerzBaseUrl()}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      GatewayPageURL?: string;
      sessionkey?: string;
      failedreason?: string;
    };

    if (!res.ok || data.status?.toUpperCase() !== 'SUCCESS' || !data.GatewayPageURL) {
      return {
        ok: false,
        gateway: 'sslcommerz',
        code: 'sslcommerz_init_failed',
        error: data.failedreason || `SSLCommerz session init failed (HTTP ${res.status}).`,
      };
    }

    return {
      ok: true,
      gateway: 'sslcommerz',
      gatewayUrl: data.GatewayPageURL,
      sessionKey: data.sessionkey || '',
    };
  } catch (err) {
    return {
      ok: false,
      gateway: 'sslcommerz',
      code: 'sslcommerz_network_error',
      error: err instanceof Error ? err.message : 'Network error initiating SSLCommerz session.',
    };
  }
}

export async function validateSslCommerzPayment(params: {
  valId: string;
  expectedOrderNumber: string;
  expectedAmountBdt: number;
}): Promise<PaymentVerificationResult> {
  const readiness = getPaymentGatewayReadiness();
  if (!readiness.sslcommerz.configured) {
    return {
      ok: false,
      verified: false,
      gateway: 'sslcommerz',
      orderNumber: params.expectedOrderNumber,
      transactionId: '',
      amountBdt: 0,
      currency: 'BDT',
      rawStatus: 'unconfigured',
      error: 'Not configured: SSLCommerz credentials are missing on the server.',
    };
  }

  if (!Number.isFinite(params.expectedAmountBdt) || params.expectedAmountBdt <= 0) {
    return {
      ok: false,
      verified: false,
      gateway: 'sslcommerz',
      orderNumber: params.expectedOrderNumber,
      transactionId: '',
      amountBdt: 0,
      currency: 'BDT',
      rawStatus: 'invalid_expected_amount',
      error: 'Authoritative server order amount is required for payment validation.',
    };
  }

  const valId = params.valId.trim();
  if (!valId) {
    return {
      ok: false,
      verified: false,
      gateway: 'sslcommerz',
      orderNumber: params.expectedOrderNumber,
      transactionId: '',
      amountBdt: 0,
      currency: 'BDT',
      rawStatus: 'missing_val_id',
      error: 'Missing SSLCommerz val_id.',
    };
  }

  const url = `${getSslCommerzBaseUrl()}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(
    valId
  )}&store_id=${encodeURIComponent(
    (process.env.SSLCOMMERZ_STORE_ID || '').trim()
  )}&store_passwd=${encodeURIComponent(
    (process.env.SSLCOMMERZ_STORE_PASSWD || '').trim()
  )}&v=1&format=json`;

  try {
    const res = await fetch(url, { method: 'GET' });
    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      tran_id?: string;
      bank_tran_id?: string;
      val_id?: string;
      amount?: string | number;
      currency?: string;
    };

    const statusUpper = String(data.status || '').toUpperCase();
    const paidAmount = Number(data.amount || 0);
    const tranId = String(data.tran_id || '').trim().toUpperCase();
    const currency = String(data.currency || 'BDT').toUpperCase();
    const amountMatches =
      Number.isFinite(paidAmount) && paidAmount >= Math.max(1, params.expectedAmountBdt - 1);
    const orderMatches = tranId === params.expectedOrderNumber.toUpperCase();
    const verified =
      res.ok &&
      (statusUpper === 'VALID' || statusUpper === 'VALIDATED') &&
      currency === 'BDT' &&
      amountMatches &&
      orderMatches;

    return {
      ok: true,
      verified,
      gateway: 'sslcommerz',
      orderNumber: tranId || params.expectedOrderNumber,
      transactionId: String(data.bank_tran_id || data.val_id || valId),
      valId: String(data.val_id || valId),
      amountBdt: Number.isFinite(paidAmount) ? paidAmount : 0,
      currency,
      rawStatus: statusUpper || 'INVALID',
      error: verified
        ? undefined
        : !orderMatches
          ? 'Order number mismatch in SSLCommerz validation response.'
          : !amountMatches
            ? `Paid amount (${paidAmount} BDT) is less than expected (${params.expectedAmountBdt} BDT).`
            : `SSLCommerz status was ${statusUpper || 'INVALID'}.`,
    };
  } catch (err) {
    return {
      ok: false,
      verified: false,
      gateway: 'sslcommerz',
      orderNumber: params.expectedOrderNumber,
      transactionId: valId,
      amountBdt: 0,
      currency: 'BDT',
      rawStatus: 'network_error',
      error: err instanceof Error ? err.message : 'SSLCommerz validation request failed.',
    };
  }
}

async function grantBkashToken(): Promise<{ ok: boolean; idToken?: string; error?: string }> {
  const res = await fetch(`${getBkashBaseUrl()}/tokenized/checkout/token/grant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      username: (process.env.BKASH_USERNAME || '').trim(),
      password: (process.env.BKASH_PASSWORD || '').trim(),
    },
    body: JSON.stringify({
      app_key: (process.env.BKASH_APP_KEY || '').trim(),
      app_secret: (process.env.BKASH_APP_SECRET || '').trim(),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    id_token?: string;
    statusMessage?: string;
  };
  if (!res.ok || !data.id_token) {
    return {
      ok: false,
      error: data.statusMessage || `bKash token grant failed (HTTP ${res.status}).`,
    };
  }
  return { ok: true, idToken: data.id_token };
}

export async function initiateBkashCheckout(
  input: PaymentInitiationInput
): Promise<PaymentInitiationResult> {
  const readiness = getPaymentGatewayReadiness();
  if (!readiness.bkash.configured) {
    return {
      ok: false,
      gateway: 'bkash',
      code: 'gateway_not_configured',
      error: 'bKash Tokenized Checkout credentials are not configured on the server.',
    };
  }

  try {
    const tokenRes = await grantBkashToken();
    if (!tokenRes.ok || !tokenRes.idToken) {
      return {
        ok: false,
        gateway: 'bkash',
        code: 'bkash_auth_failed',
        error: tokenRes.error || 'Could not obtain bKash token.',
      };
    }

    const base = input.siteBaseUrl.replace(/\/+$/, '');
    const callbackURL = `${base}/api/payments/callback?gateway=bkash&order=${encodeURIComponent(
      input.orderNumber
    )}`;

    const res = await fetch(`${getBkashBaseUrl()}/tokenized/checkout/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: tokenRes.idToken,
        'X-APP-Key': (process.env.BKASH_APP_KEY || '').trim(),
      },
      body: JSON.stringify({
        mode: '0011',
        payerReference: normalizeBangladeshPhone(input.customerPhone),
        callbackURL,
        amount: String(Math.max(1, Math.round(input.amountBdt))),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: input.orderNumber,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      statusCode?: string;
      statusMessage?: string;
      paymentID?: string;
      bkashURL?: string;
    };

    if (!res.ok || !data.bkashURL || !data.paymentID) {
      return {
        ok: false,
        gateway: 'bkash',
        code: 'bkash_create_failed',
        error: data.statusMessage || `bKash payment creation failed (HTTP ${res.status}).`,
      };
    }

    return {
      ok: true,
      gateway: 'bkash',
      gatewayUrl: data.bkashURL,
      paymentId: data.paymentID,
    };
  } catch (err) {
    return {
      ok: false,
      gateway: 'bkash',
      code: 'bkash_network_error',
      error: err instanceof Error ? err.message : 'Network error initiating bKash payment.',
    };
  }
}

export async function executeBkashCheckout(params: {
  paymentId: string;
  expectedOrderNumber: string;
  expectedAmountBdt: number;
}): Promise<PaymentVerificationResult> {
  const readiness = getPaymentGatewayReadiness();
  if (!readiness.bkash.configured) {
    return {
      ok: false,
      verified: false,
      gateway: 'bkash',
      orderNumber: params.expectedOrderNumber,
      transactionId: '',
      amountBdt: 0,
      currency: 'BDT',
      rawStatus: 'unconfigured',
      error: 'Not configured: bKash Tokenized Checkout credentials are missing on the server.',
    };
  }

  const cleanPaymentId = String(params.paymentId || '').trim();
  if (!cleanPaymentId) {
    return {
      ok: false,
      verified: false,
      gateway: 'bkash',
      orderNumber: params.expectedOrderNumber,
      transactionId: '',
      amountBdt: 0,
      currency: 'BDT',
      rawStatus: 'missing_payment_id',
      error: 'Missing bKash paymentID.',
    };
  }

  if (!Number.isFinite(params.expectedAmountBdt) || params.expectedAmountBdt <= 0) {
    return {
      ok: false,
      verified: false,
      gateway: 'bkash',
      orderNumber: params.expectedOrderNumber,
      transactionId: cleanPaymentId,
      amountBdt: 0,
      currency: 'BDT',
      rawStatus: 'invalid_expected_amount',
      error: 'Authoritative server order amount is required for payment validation.',
    };
  }

  try {
    const tokenRes = await grantBkashToken();
    if (!tokenRes.ok || !tokenRes.idToken) {
      return {
        ok: false,
        verified: false,
        gateway: 'bkash',
        orderNumber: params.expectedOrderNumber,
        transactionId: '',
        amountBdt: 0,
        currency: 'BDT',
        rawStatus: 'auth_failed',
        error: tokenRes.error || 'bKash token grant failed.',
      };
    }

    const res = await fetch(`${getBkashBaseUrl()}/tokenized/checkout/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: tokenRes.idToken,
        'X-APP-Key': (process.env.BKASH_APP_KEY || '').trim(),
      },
      body: JSON.stringify({ paymentID: params.paymentId.trim() }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      statusCode?: string;
      statusMessage?: string;
      transactionStatus?: string;
      trxID?: string;
      amount?: string | number;
      currency?: string;
      merchantInvoiceNumber?: string;
    };

    const paidAmount = Number(data.amount || 0);
    const invoice = String(data.merchantInvoiceNumber || '').trim().toUpperCase();
    const txStatus = String(data.transactionStatus || '').trim();
    const amountMatches =
      Number.isFinite(paidAmount) && paidAmount >= Math.max(1, params.expectedAmountBdt - 1);
    const orderMatches =
      Boolean(invoice) && invoice === params.expectedOrderNumber.toUpperCase();
    const verified =
      res.ok &&
      data.statusCode === '0000' &&
      txStatus.toLowerCase() === 'completed' &&
      Boolean(data.trxID) &&
      amountMatches &&
      orderMatches;

    return {
      ok: true,
      verified,
      gateway: 'bkash',
      orderNumber: invoice || params.expectedOrderNumber,
      transactionId: String(data.trxID || params.paymentId),
      amountBdt: Number.isFinite(paidAmount) ? paidAmount : 0,
      currency: String(data.currency || 'BDT').toUpperCase(),
      rawStatus: txStatus || data.statusMessage || 'FAILED',
      error: verified
        ? undefined
        : data.statusMessage ||
          (!amountMatches
            ? `Paid amount (${paidAmount} BDT) is less than expected (${params.expectedAmountBdt} BDT).`
            : 'bKash payment execution was not completed.'),
    };
  } catch (err) {
    return {
      ok: false,
      verified: false,
      gateway: 'bkash',
      orderNumber: params.expectedOrderNumber,
      transactionId: params.paymentId,
      amountBdt: 0,
      currency: 'BDT',
      rawStatus: 'network_error',
      error: err instanceof Error ? err.message : 'bKash execute request failed.',
    };
  }
}
