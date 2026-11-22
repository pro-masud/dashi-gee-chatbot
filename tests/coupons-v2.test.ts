import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PUT as adminCouponsPut } from '../app/api/admin/coupons/route';
import { validateCouponInput } from '../src/lib/coupons/coupons';
import { computeOrderPricingInPoisha, evaluateCouponEligibility } from '../src/lib/chatbot/orderToken';
import { DEFAULT_STORE_SETTINGS, type CouponRecord, type StoreSettingsDoc } from '../src/lib/storeTypes';

const settings: StoreSettingsDoc = {
  ...DEFAULT_STORE_SETTINGS,
  price250g: 350,
  price500g: 650,
  price1kg: 1200,
  stock250g: 50,
  stock500g: 50,
  stock1kg: 50,
  insideDhakaFee: 80,
  outsideDhakaFee: 120,
  dhakaSuburbanFee: 100,
  remoteDistrictFee: 150,
  freeDeliveryThreshold: 0,
  advanceDiscountPct: 5,
};

const coupon = (p: Partial<CouponRecord> = {}): CouponRecord => ({
  code: 'WINTER',
  discountPct: 10,
  minSubtotalBdt: 0,
  active: true,
  stackableWithAdvance: true,
  ...p,
});

const price = (c: CouponRecord | null, qty500g = 2, method: 'cod' | 'bkash' = 'cod', zone: 'dhaka' | 'nationwide' = 'dhaka') =>
  computeOrderPricingInPoisha({
    settings,
    deliveryZone: zone,
    paymentMethod: method,
    coupon: c,
    weight: '500g',
    qty: qty500g,
    qty250g: 0,
    qty500g,
    qty1kg: 0,
    todayIso: '2026-11-20',
  } as Parameters<typeof computeOrderPricingInPoisha>[0]);

describe('Coupon v2 (schedule, discount cap, free delivery)', () => {
  it('REGRESSION: a classic coupon (no v2 fields) prices exactly as before', () => {
    const r = price(coupon());
    // 2 × 650 = 1300; 10% = 130; delivery 80
    assert.equal(r.subtotalBdt, 1300);
    assert.equal(r.discountBdt, 130);
    assert.equal(r.deliveryFeeBdt, 80);
    assert.equal(r.totalBdt, 1300 - 130 + 80);
  });

  it('REGRESSION: no coupon, and advance-payment discount stacking, are unchanged', () => {
    assert.equal(price(null).totalBdt, 1300 + 80);
    const prepaid = price(coupon(), 2, 'bkash'); // coupon 10% + advance 5% = 15% of 1300 = 195
    assert.equal(prepaid.discountBdt, 195);
  });

  it('a coupon with a cap never gives more than the cap (BDT)', () => {
    const r = price(coupon({ discountPct: 20, maxDiscountBdt: 100 }), 4); // 4×650=2600, 20% = 520 → capped at 100
    assert.equal(r.subtotalBdt, 2600);
    assert.equal(r.discountBdt, 100);
    assert.equal(r.totalBdt, 2600 - 100 + 80);
  });

  it('a cap that is higher than the discount changes nothing', () => {
    const r = price(coupon({ discountPct: 10, maxDiscountBdt: 500 })); // 130 < 500
    assert.equal(r.discountBdt, 130);
  });

  it('cap applies only to the coupon share; advance-payment share is added on top', () => {
    const r = price(coupon({ discountPct: 20, maxDiscountBdt: 100 }), 4, 'bkash'); // coupon capped 100 + advance 5% of 2600 = 130
    assert.equal(r.discountBdt, 230);
  });

  it('free-delivery coupon waives the delivery fee in every zone', () => {
    const dhaka = price(coupon({ discountPct: 0, freeDelivery: true }));
    assert.equal(dhaka.deliveryFeeBdt, 0);
    assert.equal(dhaka.discountBdt, 0);
    assert.equal(dhaka.totalBdt, 1300);
    const outside = price(coupon({ discountPct: 5, freeDelivery: true }), 2, 'cod', 'nationwide');
    assert.equal(outside.deliveryFeeBdt, 0);
    assert.equal(outside.discountBdt, 65);
  });

  it('an invalid coupon does not waive delivery or discount', () => {
    const r = price(coupon({ freeDelivery: true, active: false }));
    assert.equal(r.deliveryFeeBdt, 80);
    assert.equal(r.discountBdt, 0);
    const belowMin = price(coupon({ freeDelivery: true, minSubtotalBdt: 5000 }));
    assert.equal(belowMin.deliveryFeeBdt, 80);
  });

  it('schedule: not valid before its start date, valid from the start day, expired after the end', () => {
    const c = coupon({ startsAt: '2026-11-25', expiresAt: '2026-11-30' });
    assert.equal(evaluateCouponEligibility(c, 1000, 'cod', '2026-11-24').reason, 'not_started');
    assert.equal(evaluateCouponEligibility(c, 1000, 'cod', '2026-11-25').valid, true);
    assert.equal(evaluateCouponEligibility(c, 1000, 'cod', '2026-11-30').valid, true);
    assert.equal(evaluateCouponEligibility(c, 1000, 'cod', '2026-12-01').reason, 'expired');
  });

  it('pricing ignores a coupon that has not started yet', () => {
    const r = price(coupon({ startsAt: '2026-12-01' }));
    assert.equal(r.discountBdt, 0);
    assert.equal(r.couponEvaluation?.reason, 'not_started');
  });

  it('admin coupon validation', () => {
    const ok = validateCouponInput({ code: 'winter10', discountPct: 10, minSubtotalBdt: 500, maxDiscountBdt: 200, startsAt: '2026-11-25', expiresAt: '2026-12-31', maxUses: 50, freeDelivery: false });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.value.code, 'WINTER10');
    assert.equal(validateCouponInput({ code: 'x', discountPct: 10 }).ok, false);
    assert.equal(validateCouponInput({ code: 'BIG', discountPct: 90 }).ok, false); // engine caps at 40%
    assert.equal(validateCouponInput({ code: 'NOTHING', discountPct: 0 }).ok, false); // must give something
    assert.equal(validateCouponInput({ code: 'FREEDEL', discountPct: 0, freeDelivery: true }).ok, true);
    assert.equal(validateCouponInput({ code: 'CAPONLY', discountPct: 0, maxDiscountBdt: 50, freeDelivery: true }).ok, false);
    assert.equal(validateCouponInput({ code: 'LATE', discountPct: 10, startsAt: '2026-12-31', expiresAt: '2026-12-01' }).ok, false);
    assert.equal(validateCouponInput({ code: 'BADDATE', discountPct: 10, expiresAt: '31/12/2026' }).ok, false);
    const html = validateCouponInput({ code: 'TAGS', discountPct: 5, descriptionEn: 'Hello <b>x</b>' });
    if (html.ok) assert.equal(html.value.descriptionEn, 'Hello x');
  });

  it('admin coupon API requires owner auth and CSRF', async () => {
    const unauth = await adminCouponsPut(
      new Request('http://localhost:3000/api/admin/coupons', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify({ code: 'WINTER', discountPct: 10 }),
      })
    );
    assert.equal(unauth.status, 401);
    assert.equal((await adminCouponsPut(new Request('http://localhost:3000/api/admin/coupons', { method: 'PUT', body: '{}' }))).status, 403);
  });
});
