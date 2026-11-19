/**
 * Firestore Emulator Security Rules Test Suite for Split Interim Hotfix S0-13
 *
 * Covers BOTH:
 *   - Part 1 (`hotfix-s013-part1` — Patches B, C, D: pure removals of unauth update branches)
 *   - Part 2 (`hotfix-s013-part2` — Patches B, C, D + Patch A: fee/discount/total validation)
 *
 * Usage (requires Java JRE/JDK 11+ & firebase-tools):
 *   git checkout hotfix-s013-part1
 *   firebase emulators:exec --only firestore --project qualified-transit-lpd8p "S013_HOTFIX_PART=1 npm run test:rules:s013"
 *
 *   git checkout hotfix-s013-part2
 *   firebase emulators:exec --only firestore --project qualified-transit-lpd8p "S013_HOTFIX_PART=2 npm run test:rules:s013"
 */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'qualified-transit-lpd8p';
const HOTFIX_PART = process.env.S013_HOTFIX_PART === '1' ? 1 : 2;

const BASE_DOC_URL = `http://${EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const COMMIT_URL = `http://${EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`;
const CLEAR_URL = `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function docPath(col: string, id: string): string {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${col}/${id}`;
}

function toFsVal(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((v) => toFsVal(v)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      fields[k] = toFsVal(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFsFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = toFsVal(v);
  }
  return out;
}

/**
 * Generates an unsigned emulator JWT accepted by the Firestore Emulator for admin auth tests.
 * (Emulator accepts alg:"none" JWTs with custom claims.)
 */
function makeEmulatorAdminJwt(email = 'kinboni.bd@gmail.com', emailVerified = true): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      aud: PROJECT_ID,
      auth_time: Math.floor(Date.now() / 1000),
      user_id: 'admin_test_uid',
      sub: 'admin_test_uid',
      email,
      email_verified: emailVerified,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString('base64url');
  return `${header}.${payload}.`;
}

async function clearEmulatorDb(): Promise<void> {
  const res = await fetch(CLEAR_URL, { method: 'DELETE' });
  assert.equal(res.status, 200, `Failed to clear Firestore Emulator: ${await res.text()}`);
}

async function seedDocAsOwner(
  col: string,
  id: string,
  fields: Record<string, unknown>,
  serverTimeFields: string[] = []
): Promise<void> {
  const writes: Record<string, unknown>[] = [
    {
      update: {
        name: docPath(col, id),
        fields: toFsFields(fields),
      },
      ...(serverTimeFields.length > 0
        ? {
            updateTransforms: serverTimeFields.map((fieldPath) => ({
              fieldPath,
              setToServerValue: 'REQUEST_TIME',
            })),
          }
        : {}),
    },
  ];
  const res = await fetch(COMMIT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer owner',
    },
    body: JSON.stringify({ writes }),
  });
  assert.equal(res.status, 200, `Seed ${col}/${id} failed: ${await res.text()}`);
}

async function commitWrites(
  writes: Record<string, unknown>[],
  authHeader?: string
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch(COMMIT_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ writes }),
  });
  return { status: res.status, body: await res.text() };
}

function buildCanonicalSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productNameEn: 'Deshi Gee',
    productNameBn: 'দেশী ঘি',
    taglineEn: 'Pabna Bilona Cow Ghee',
    taglineBn: 'পাবনার বিলোনার গাওয়া ঘি',
    originLocation: 'Pabna, Bangladesh',
    price250g: 680,
    price500g: 1290,
    price1kg: 2480,
    stock250g: 50,
    stock500g: 50,
    stock1kg: 50,
    insideDhakaFee: 80,
    dhakaSuburbanFee: 90,
    outsideDhakaFee: 130,
    remoteDistrictFee: 180,
    freeDeliveryThreshold: 2500,
    estimatedDhakaDays: '1–2 days',
    estimatedSuburbanDays: '1–2 days',
    estimatedOutsideDays: '2–4 days',
    estimatedRemoteDays: '3–5 days',
    bkashNumber: '01700000001',
    nagadNumber: '01700000002',
    advanceDiscountPct: 5,
    whatsappNumber: '01700000001',
    supportPhone: '01700000001',
    supportEmail: 'support@deshigee.com',
    businessAddress: 'Dhaka, Bangladesh',
    facebookUrl: 'https://facebook.com/deshigee',
    instagramUrl: 'https://instagram.com/deshigee',
    activeBatchCode: 'PBN-2026-01',
    ...overrides,
  };
}

function buildOrderPayload(
  orderNumber: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    orderNumber,
    customerName: 'Karim Uddin',
    phone: '01711223344',
    district: 'Dhaka',
    area: 'Dhanmondi',
    address: 'House 12, Road 4, Dhanmondi',
    note: '',
    deliveryZone: 'dhaka',
    weight: '500g',
    qty: 1,
    qty250g: 0,
    qty500g: 1,
    qty1kg: 0,
    itemsSummary: '500g × 1',
    unitPriceBdt: 1290,
    subtotalBdt: 1290,
    deliveryFeeBdt: 80,
    discountBdt: 0,
    totalBdt: 1370,
    couponCode: '',
    paymentMethod: 'cod',
    paymentStatus: 'cod_due',
    txnId: '',
    paymentProofData: '',
    status: 'pending',
    estimatedDelivery: '1–2 days',
    webhookStatus: 'pending',
    ...overrides,
  };
}

function buildTrackingPayload(
  orderNumber: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    orderNumber,
    weight: '500g',
    qty: 1,
    qty250g: 0,
    qty500g: 1,
    qty1kg: 0,
    itemsSummary: '500g × 1',
    subtotalBdt: 1290,
    deliveryFeeBdt: 80,
    discountBdt: 0,
    couponCode: '',
    deliveryZone: 'dhaka',
    district: 'Dhaka',
    totalBdt: 1370,
    paymentMethod: 'cod',
    paymentStatus: 'cod_due',
    status: 'pending',
    estimatedDelivery: '1–2 days',
    ...overrides,
  };
}

describe(`S0-13 Split Interim Hotfix Emulator Suite (Part ${HOTFIX_PART})`, () => {
  before(() => {
    if (!EMULATOR_HOST) {
      throw new Error(
        'FIRESTORE_EMULATOR_HOST is not set. Run via:\n' +
          '  firebase emulators:exec --only firestore --project qualified-transit-lpd8p "S013_HOTFIX_PART=1 npm run test:rules:s013"'
      );
    }
  });

  beforeEach(async () => {
    await clearEmulatorDb();
    await seedDocAsOwner('store_settings', 'main', buildCanonicalSettings(), ['updatedAt']);
    await seedDocAsOwner('orders', 'DG-10001', buildOrderPayload('DG-10001'), [
      'createdAt',
      'updatedAt',
    ]);
    await seedDocAsOwner(
      'order_tracking',
      'DG-10001_01711223344',
      buildTrackingPayload('DG-10001'),
      ['updatedAt']
    );
    await seedDocAsOwner(
      'coupons',
      'EID10',
      {
        code: 'EID10',
        discountPct: 10,
        minSubtotalBdt: 1000,
        active: true,
        stackableWithAdvance: false,
      },
      ['updatedAt']
    );
  });

  // =========================================================================
  // PART 1 TESTS (Patches B, C, D — must pass on BOTH Part 1 & Part 2)
  // =========================================================================

  it('Part 1 / Patch B: blocks unauthenticated orders/{orderId} address/fee hijack without phone', async () => {
    const res = await commitWrites([
      {
        update: {
          name: docPath('orders', 'DG-10001'),
          fields: toFsFields({
            district: 'Chattogram',
            area: 'Agrabad',
            address: 'Attacker Warehouse 99',
            deliveryZone: 'nationwide',
            deliveryFeeBdt: 0,
            totalBdt: 1290,
            estimatedDelivery: '2–4 days',
          }),
        },
        updateMask: {
          fieldPaths: [
            'district',
            'area',
            'address',
            'deliveryZone',
            'deliveryFeeBdt',
            'totalBdt',
            'estimatedDelivery',
          ],
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ]);
    assert.equal(res.status, 403, `Expected 403 PERMISSION_DENIED, got ${res.status}: ${res.body}`);
  });

  it('Part 1 / Patch B: blocks unauthenticated orders/{orderId} cancel update', async () => {
    const res = await commitWrites([
      {
        update: {
          name: docPath('orders', 'DG-10001'),
          fields: toFsFields({ status: 'cancelled' }),
        },
        updateMask: { fieldPaths: ['status'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
      {
        update: {
          name: docPath('order_tracking', 'DG-10001_01711223344'),
          fields: toFsFields({ status: 'cancelled' }),
        },
        updateMask: { fieldPaths: ['status'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ]);
    assert.equal(res.status, 403, `Expected 403 PERMISSION_DENIED, got ${res.status}: ${res.body}`);
  });

  it('Part 1 / Patch C: blocks unauthenticated order_tracking status forgery to delivered', async () => {
    const res = await commitWrites([
      {
        update: {
          name: docPath('order_tracking', 'DG-10001_01711223344'),
          fields: toFsFields({ status: 'delivered' }),
        },
        updateMask: { fieldPaths: ['status'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ]);
    assert.equal(res.status, 403, `Expected 403 PERMISSION_DENIED, got ${res.status}: ${res.body}`);
  });

  it('Part 1 / Patch D: blocks unauthenticated store_settings/main stock-restore abuse and price tamper', async () => {
    const resPriceTamper = await commitWrites([
      {
        update: {
          name: docPath('store_settings', 'main'),
          fields: toFsFields({ price500g: 1, supportPhone: '01799999999' }),
        },
        updateMask: { fieldPaths: ['price500g', 'supportPhone'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ]);
    assert.equal(resPriceTamper.status, 403);

    const resStockRestore = await commitWrites([
      {
        update: {
          name: docPath('store_settings', 'main'),
          fields: toFsFields({
            stock250g: 50,
            stock500g: 51,
            stock1kg: 50,
            lastOrderNumber: 'DG-10001',
          }),
        },
        updateMask: { fieldPaths: ['stock250g', 'stock500g', 'stock1kg', 'lastOrderNumber'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ]);
    assert.equal(resStockRestore.status, 403);
  });

  it('Part 1: verified admin can still update orders & order_tracking status/courier fields', async () => {
    const adminAuth = `Bearer ${makeEmulatorAdminJwt('kinboni.bd@gmail.com', true)}`;
    const res = await commitWrites(
      [
        {
          update: {
            name: docPath('orders', 'DG-10001'),
            fields: toFsFields({ status: 'confirmed' }),
          },
          updateMask: { fieldPaths: ['status'] },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
        {
          update: {
            name: docPath('order_tracking', 'DG-10001_01711223344'),
            fields: toFsFields({ status: 'confirmed' }),
          },
          updateMask: { fieldPaths: ['status'] },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        },
      ],
      adminAuth
    );
    assert.equal(res.status, 200, `Verified admin update should succeed, got ${res.status}: ${res.body}`);
  });

  // =========================================================================
  // PART 2 TESTS (Patch A — canonical deliveryFeeBdt, discountBdt, totalBdt)
  // =========================================================================

  it('Part 2 / Patch A: blocks forged deliveryFeeBdt=1, discountBdt=subtotal, totalBdt=1 on create', async (t) => {
    if (HOTFIX_PART < 2) {
      t.skip('Run with S013_HOTFIX_PART=2 on branch hotfix-s013-part2');
      return;
    }

    // Attack 1: forged deliveryFeeBdt=1 & discountBdt=subtotal (1290) -> totalBdt=1
    const forgedOrder = buildOrderPayload('DG-20001', {
      deliveryFeeBdt: 1,
      discountBdt: 1290,
      totalBdt: 1,
      couponCode: '',
    });
    const forgedTracking = buildTrackingPayload('DG-20001', {
      deliveryFeeBdt: 1,
      discountBdt: 1290,
      totalBdt: 1,
      couponCode: '',
    });
    const res = await commitWrites([
      {
        update: { name: docPath('orders', 'DG-20001'), fields: toFsFields(forgedOrder) },
        currentDocument: { exists: false },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      },
      {
        update: {
          name: docPath('order_tracking', 'DG-20001_01711223344'),
          fields: toFsFields(forgedTracking),
        },
        currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ]);
    assert.equal(res.status, 403, `Expected forged 1 BDT order to be denied, got ${res.status}: ${res.body}`);
  });

  it('Part 2 / Patch A: allows canonical 7-document atomic order batch with valid coupon within Firestore 20-call limit', async (t) => {
    if (HOTFIX_PART < 2) {
      t.skip('Run with S013_HOTFIX_PART=2 on branch hotfix-s013-part2');
      return;
    }

    // 500g (1290) + Dhaka fee (80) - EID10 10% (129) = 1241 BDT
    const orderNum = 'DG-20002';
    const validOrder = buildOrderPayload(orderNum, {
      couponCode: 'EID10',
      deliveryFeeBdt: 80,
      discountBdt: 129,
      totalBdt: 1241,
    });
    const validTracking = buildTrackingPayload(orderNum, {
      couponCode: 'EID10',
      deliveryFeeBdt: 80,
      discountBdt: 129,
      totalBdt: 1241,
    });

    const res = await commitWrites([
      {
        update: { name: docPath('orders', orderNum), fields: toFsFields(validOrder) },
        currentDocument: { exists: false },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      },
      {
        update: {
          name: docPath('order_tracking', `${orderNum}_01711223344`),
          fields: toFsFields(validTracking),
        },
        currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
      {
        update: {
          name: docPath('store_settings', 'main'),
          fields: toFsFields({
            stock250g: 50,
            stock500g: 49,
            stock1kg: 50,
            lastOrderNumber: orderNum,
          }),
        },
        updateMask: { fieldPaths: ['stock250g', 'stock500g', 'stock1kg', 'lastOrderNumber'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
      {
        update: {
          name: docPath('chatbot_used_tokens', 'tok_s013_valid_01'),
          fields: toFsFields({ orderNumber: orderNum, sessionId: 'dg_session_test_01' }),
        },
        currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      },
      {
        update: {
          name: docPath('chatbot_order_idempotency', 'idem_s013_valid_01'),
          fields: toFsFields({ orderNumber: orderNum }),
        },
        currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      },
      {
        update: {
          name: docPath('order_fingerprints', 'fp_s013_valid_01'),
          fields: toFsFields({
            orderNumber: orderNum,
            phone: '01711223344',
            itemsSummary: '500g × 1',
            totalBdt: 1241,
            createdAtMs: Date.now(),
          }),
        },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
      {
        update: {
          name: docPath('order_audit_logs', 'audit_s013_valid_01'),
          fields: toFsFields({
            orderNumber: orderNum,
            action: 'created',
            actorType: 'customer',
            actorLabel: 'Test Checkout',
            summary: 'Order placed with valid EID10 coupon',
          }),
        },
        currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ]);
    assert.equal(
      res.status,
      200,
      `Expected valid 7-doc atomic order batch with coupon to succeed (<= 20 calls), got ${res.status}: ${res.body}`
    );
  });

  it('Part 2 / Patch A: blocks mismatched order_tracking totalBdt vs orders totalBdt on create', async (t) => {
    if (HOTFIX_PART < 2) {
      t.skip('Run with S013_HOTFIX_PART=2 on branch hotfix-s013-part2');
      return;
    }

    const orderNum = 'DG-20003';
    const res = await commitWrites([
      {
        update: {
          name: docPath('orders', orderNum),
          fields: toFsFields(buildOrderPayload(orderNum)),
        },
        currentDocument: { exists: false },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
      },
      {
        update: {
          name: docPath('order_tracking', `${orderNum}_01711223344`),
          fields: toFsFields(buildTrackingPayload(orderNum, { totalBdt: 999 })),
        },
        currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      },
    ]);
    assert.equal(res.status, 403, `Expected mismatched tracking totalBdt to be denied, got ${res.status}`);
  });
});
