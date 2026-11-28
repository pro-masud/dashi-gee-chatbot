import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  FRESH_IMAGES,
  computeFreshCheckoutTotals,
  resolvePreferredFlagshipWeight,
  validateFreshCheckoutInput,
} from '../src/data/freshStorefrontContent';
import { DEFAULT_STORE_SETTINGS } from '../src/lib/storeTypes';
import { TEST_CONFIRMED_STORE_SETTINGS } from './helpers/testStoreFixture';

test('fresh_storefront_images_exist_on_disk [static]: all 6 newly generated storefront photos exist under public/assets/images/fresh', () => {
  const entries = Object.entries(FRESH_IMAGES);
  assert.equal(entries.length, 6);
  for (const [key, relUrl] of entries) {
    assert.ok(relUrl.startsWith('/assets/images/fresh/'), `${key} must point to fresh directory`);
    const abs = path.join(process.cwd(), 'public', relUrl.replace(/^\//, ''));
    assert.equal(fs.existsSync(abs), true, `Missing image file on disk for ${key}: ${abs}`);
  }
});

test('fresh_flagship_weight_prefers_1kg [unit]: prefers 1kg flagship when enabled and falls back cleanly if out of stock', () => {
  assert.equal(resolvePreferredFlagshipWeight(TEST_CONFIRMED_STORE_SETTINGS, null), '1kg');

  const no1kg = { ...TEST_CONFIRMED_STORE_SETTINGS, stock1kg: 0 };
  assert.equal(resolvePreferredFlagshipWeight(no1kg, null), '500g');
});

test('fresh_checkout_totals_math [unit]: returns null prices when unset and exact totals + free threshold when confirmed', () => {
  const unset = computeFreshCheckoutTotals({
    settings: DEFAULT_STORE_SETTINGS,
    weight: '1kg',
    qty: 1,
    zone: 'dhaka',
  });
  assert.equal(unset.unitPriceBdt, null);
  assert.equal(unset.totalBdt, null);

  const confirmed1kg = computeFreshCheckoutTotals({
    settings: TEST_CONFIRMED_STORE_SETTINGS,
    weight: '1kg',
    qty: 1,
    zone: 'dhaka',
  });
  assert.equal(confirmed1kg.unitPriceBdt, TEST_CONFIRMED_STORE_SETTINGS.price1kg);
  assert.equal(confirmed1kg.subtotalBdt, TEST_CONFIRMED_STORE_SETTINGS.price1kg);
  assert.equal(typeof confirmed1kg.totalBdt, 'number');
  assert.ok((confirmed1kg.totalBdt ?? 0) >= confirmed1kg.subtotalBdt!);

  const discounted = computeFreshCheckoutTotals({
    settings: TEST_CONFIRMED_STORE_SETTINGS,
    weight: '500g',
    qty: 2,
    zone: 'nationwide',
    discountBdt: 100,
  });
  assert.equal(discounted.discountBdt, 100);
  assert.equal(
    discounted.totalBdt,
    discounted.subtotalBdt! - 100 + discounted.deliveryFeeBdt!
  );
});

test('fresh_checkout_validation [unit]: validates Bangladesh phone, full name, and full address in both bn and en', () => {
  const badName = validateFreshCheckoutInput({
    customerName: 'A',
    phone: '01712345678',
    district: 'Dhaka',
    address: 'House 12, Road 4, Dhanmondi',
    lang: 'bn',
  });
  assert.equal(badName.ok, false);
  if (!badName.ok) assert.equal(badName.field, 'name');

  const badPhone = validateFreshCheckoutInput({
    customerName: 'Karim Uddin',
    phone: '12345',
    district: 'Dhaka',
    address: 'House 12, Road 4, Dhanmondi',
    lang: 'en',
  });
  assert.equal(badPhone.ok, false);
  if (!badPhone.ok) assert.equal(badPhone.field, 'phone');

  const badAddress = validateFreshCheckoutInput({
    customerName: 'Karim Uddin',
    phone: '01712345678',
    district: 'Dhaka',
    address: 'Dhaka',
    lang: 'en',
  });
  assert.equal(badAddress.ok, false);
  if (!badAddress.ok) assert.equal(badAddress.field, 'address');

  const ok = validateFreshCheckoutInput({
    customerName: 'Karim Uddin',
    phone: '+8801712345678',
    district: 'Dhaka',
    address: 'House 12, Road 4, Dhanmondi, Dhaka',
    lang: 'bn',
  });
  assert.equal(ok.ok, true);
});
