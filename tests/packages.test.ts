import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GET as adminPackagesGet, PUT as adminPackagesPut } from '../app/api/admin/packages/route';
import { GET as publicPackagesGet } from '../app/api/packages/public/route';
import {
  defaultPackagesState,
  disabledSlotsInOrder,
  packageEconomics,
  sellingPrice,
  toPublicPackages,
  validatePackagesInput,
  type PackagesState,
} from '../src/lib/packages/packages';
import { roleHasPermission } from '../src/lib/auth/permissions';

const good = (): PackagesState => {
  const s = defaultPackagesState();
  s['250g'] = { ...s['250g'], regularPrice: 350, offerPrice: 299, cogs: 180, stock: 40, badge: '', isDefault: false };
  s['500g'] = { ...s['500g'], regularPrice: 650, offerPrice: 549, cogs: 340, stock: 60, badge: 'popular', isDefault: true };
  s['1kg'] = { ...s['1kg'], regularPrice: 1200, offerPrice: 0, cogs: 650, stock: 25, badge: 'best_value', isDefault: false };
  return s;
};

describe('Package manager', () => {
  it('customer price is the offer price when it is lower, otherwise the regular price', () => {
    assert.equal(sellingPrice({ regularPrice: 650, offerPrice: 549 }), 549);
    assert.equal(sellingPrice({ regularPrice: 650, offerPrice: 0 }), 650);
    assert.equal(sellingPrice({ regularPrice: 650, offerPrice: 700 }), 650); // an "offer" above regular is ignored
  });

  it('computes discount and profit per jar, and never invents a cost', () => {
    const e = packageEconomics(good()['500g']);
    assert.equal(e.sellingPrice, 549);
    assert.equal(e.discountBdt, 101);
    assert.equal(e.discountPct, 15.54);
    assert.equal(e.profitPerJar, 209);
    assert.equal(e.marginPct, 38.07);
    const noCost = packageEconomics({ ...good()['500g'], cogs: 0 });
    assert.equal(noCost.profitPerJar, null);
    assert.equal(noCost.marginPct, null);
  });

  it('accepts a valid configuration', () => {
    const r = validatePackagesInput(good());
    assert.equal(r.ok, true);
  });

  it('rejects an offer that is not lower than the regular price', () => {
    const bad = good();
    bad['250g'].offerPrice = 350;
    assert.equal(validatePackagesInput(bad).ok, false);
  });

  it('rejects a cost that is not lower than the selling price and zero regular price', () => {
    const bad = good();
    bad['1kg'].cogs = 1200;
    assert.equal(validatePackagesInput(bad).ok, false);
    const zero = good();
    zero['250g'].regularPrice = 0;
    assert.equal(validatePackagesInput(zero).ok, false);
  });

  it('rejects negative, fractional stock and unknown badges', () => {
    const neg = good();
    neg['250g'].stock = -1;
    assert.equal(validatePackagesInput(neg).ok, false);
    const frac = good();
    frac['250g'].stock = 2.5;
    assert.equal(validatePackagesInput(frac).ok, false);
    const badge = good() as unknown as Record<string, Record<string, unknown>>;
    badge['250g'].badge = 'cheapest';
    assert.equal(validatePackagesInput(badge).ok, false);
  });

  it('at least one package must stay enabled and exactly one default is enforced', () => {
    const none = good();
    for (const s of ['250g', '500g', '1kg'] as const) none[s].enabled = false;
    assert.equal(validatePackagesInput(none).ok, false);

    const twoDefaults = good();
    twoDefaults['250g'].isDefault = true;
    twoDefaults['500g'].isDefault = true;
    const r = validatePackagesInput(twoDefaults);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(Object.values(r.value).filter((p) => p.isDefault).length, 1);

    const disabledDefault = good();
    disabledDefault['500g'].enabled = false; // the default was disabled → falls to another enabled package
    const r2 = validatePackagesInput(disabledDefault);
    assert.equal(r2.ok, true);
    if (r2.ok) {
      const def = Object.values(r2.value).find((p) => p.isDefault)!;
      assert.equal(def.enabled, true);
    }
  });

  it('public view never exposes cost of goods or stock', () => {
    const pub = toPublicPackages(good());
    const json = JSON.stringify(pub);
    assert.equal(json.includes('cogs'), false);
    assert.equal(json.includes('stock'), false);
    assert.equal(pub['500g'].sellingPrice, 549);
    assert.equal(pub['500g'].badge, 'popular');
  });

  it('orders containing a disabled size are detected', () => {
    const enabled = { '250g': true, '500g': false, '1kg': true } as const;
    assert.deepEqual(disabledSlotsInOrder({ qty250g: 1, qty500g: 2, qty1kg: 0 }, enabled), ['500g']);
    assert.deepEqual(disabledSlotsInOrder({ qty250g: 1, qty500g: 0, qty1kg: 1 }, enabled), []);
  });

  it('only the owner may manage the catalogue', () => {
    assert.equal(roleHasPermission('owner', 'catalog.manage'), true);
    for (const r of ['call_agent', 'delivery_manager', 'accountant'] as const) {
      assert.equal(roleHasPermission(r, 'catalog.manage'), false, r);
    }
  });

  it('admin package APIs require authentication; public API is safe without a database', async () => {
    assert.equal((await adminPackagesGet(new Request('http://localhost:3000/api/admin/packages'))).status, 401);
    const put = await adminPackagesPut(
      new Request('http://localhost:3000/api/admin/packages', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify(good()),
      })
    );
    assert.equal(put.status, 401);
    const pub = await publicPackagesGet();
    assert.equal(pub.status, 200);
    const body = (await pub.json()) as { ok: boolean; packages: unknown };
    assert.equal(body.ok, true);
    assert.equal(body.packages, null);
  });
});
