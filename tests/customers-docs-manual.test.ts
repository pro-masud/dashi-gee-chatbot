import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GET as customersGet, PATCH as customersPatch } from '../app/api/admin/customers/route';
import { POST as manualPost } from '../app/api/admin/orders/manual/route';
import {
  VIP_DELIVERED_COUNT,
  VIP_REVENUE_BDT,
  computeCustomers,
  customersToCsv,
  tagsFor,
  type CustomerOrderInput,
} from '../src/lib/customers/customers';
import { buildOrderDocument, escapeHtml, type DocOrder } from '../src/lib/orders/documents';

const ord = (p: Partial<CustomerOrderInput>): CustomerOrderInput => ({
  orderNumber: 'DG-10001',
  customerName: 'Rahim',
  phone: '01712345678',
  district: 'Dhaka',
  status: 'delivered',
  totalBdt: 1000,
  createdAt: '2026-11-20T05:00:00Z',
  ...p,
});

const doc = (p: Partial<DocOrder> = {}): DocOrder => ({
  orderNumber: 'DG-12345',
  customerName: 'Rahim Uddin',
  phone: '01712345678',
  district: 'Dhaka',
  area: 'Mirpur',
  address: 'House 12, Road 5',
  qty500g: 2,
  qty1kg: 1,
  subtotalBdt: 2400,
  deliveryFeeBdt: 80,
  discountBdt: 100,
  totalBdt: 2380,
  paymentMethod: 'cod',
  ...p,
});

describe('Customers (CRM)', () => {
  it('groups orders by normalised phone and counts outcomes', () => {
    const rows = computeCustomers(
      [
        ord({ orderNumber: 'A', phone: '01712345678', totalBdt: 1000 }),
        ord({ orderNumber: 'B', phone: '+880 1712-345678', totalBdt: 2000, createdAt: '2026-11-22T05:00:00Z', customerName: 'Rahim U.' }),
        ord({ orderNumber: 'C', phone: '01712345678', status: 'cancelled' }),
        ord({ orderNumber: 'D', phone: '01712345678', status: 'returned' }),
        ord({ orderNumber: 'E', phone: '01899999999', customerName: 'Karim', status: 'pending' }),
      ],
      { includeMoney: true }
    );
    assert.equal(rows.length, 2);
    const rahim = rows.find((r) => r.phone === '01712345678')!;
    assert.equal(rahim.totalOrders, 4);
    assert.equal(rahim.delivered, 2);
    assert.equal(rahim.cancelled, 1);
    assert.equal(rahim.returnedOrFailed, 1);
    assert.equal(rahim.deliveredRevenue, 3000);
    assert.equal(rahim.averageOrderValue, 1500);
    assert.equal(rahim.name, 'Rahim U.'); // most recent name wins
    assert.equal(rahim.lastOrderAtIso, '2026-11-22T05:00:00.000Z');
    assert.equal(rows[0].phone, '01712345678'); // most recently active first
  });

  it('hides money for roles that cannot see finance', () => {
    const [row] = computeCustomers([ord({})], { includeMoney: false });
    assert.equal(row.deliveredRevenue, null);
    assert.equal(row.averageOrderValue, null);
    // no other field may leak the order value either
    const { orderNumbers: _orders, ...rest } = row;
    assert.equal(Object.values(rest).some((v) => v === 1000), false);
  });

  it('tags are derived from real history', () => {
    assert.deepEqual(tagsFor({ totalOrders: 1, delivered: 0, cancelled: 0, returnedOrFailed: 0, revenue: 0 }), ['new']);
    assert.ok(tagsFor({ totalOrders: 2, delivered: 1, cancelled: 0, returnedOrFailed: 0, revenue: 800 }).includes('returning'));
    assert.ok(tagsFor({ totalOrders: 1, delivered: 1, cancelled: 0, returnedOrFailed: 0, revenue: VIP_REVENUE_BDT }).includes('vip'));
    assert.ok(tagsFor({ totalOrders: 3, delivered: VIP_DELIVERED_COUNT, cancelled: 0, returnedOrFailed: 0, revenue: 100 }).includes('vip'));
    assert.ok(tagsFor({ totalOrders: 3, delivered: 0, cancelled: 2, returnedOrFailed: 1, revenue: 0 }).includes('risky'));
    assert.equal(tagsFor({ totalOrders: 4, delivered: 3, cancelled: 1, returnedOrFailed: 0, revenue: 100 }).includes('risky'), false);
  });

  it('ignores rows without a phone number and exports CSV with escaped quotes', () => {
    const rows = computeCustomers([ord({ phone: '' }), ord({ customerName: 'Ra"him' })], { includeMoney: true });
    assert.equal(rows.length, 1);
    assert.ok(customersToCsv(rows).includes('"Ra""him"'));
  });

  it('customer APIs require authentication and CSRF', async () => {
    assert.equal((await customersGet(new Request('http://localhost:3000/api/admin/customers'))).status, 401);
    const patch = await customersPatch(
      new Request('http://localhost:3000/api/admin/customers', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify({ phone: '01712345678', note: 'VIP' }),
      })
    );
    assert.equal(patch.status, 401);
    assert.equal((await customersPatch(new Request('http://localhost:3000/api/admin/customers', { method: 'PATCH', body: '{}' }))).status, 403);
  });
});

describe('Printable order documents', () => {
  it('escapes every dynamic value so names and addresses cannot inject markup', () => {
    const evil = '<img src=x onerror=alert(1)>"\'&';
    for (const kind of ['invoice', 'packing_slip', 'label'] as const) {
      const html = buildOrderDocument(kind, doc({ customerName: evil, address: evil, note: evil }), { name: 'Deshi <b>Gee</b>', phone: '017', address: evil });
      assert.equal(html.includes('<img src=x'), false, kind);
      assert.equal(html.includes('onerror=alert(1)>"'), false, kind);
      assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), kind);
      assert.ok(html.includes('Deshi &lt;b&gt;Gee&lt;/b&gt;'), kind);
    }
    assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  });

  it('invoice shows the maths and the COD instruction', () => {
    const html = buildOrderDocument('invoice', doc(), { name: 'Deshi Gee', phone: '01700000000', address: 'Dhaka' });
    assert.ok(html.includes('DG-12345'));
    assert.ok(html.includes('৳2,400'));
    assert.ok(html.includes('৳2,380'));
    assert.ok(html.includes('2 × 500g') === false); // table rows, not text
    assert.ok(html.includes('500g jar'));
    assert.ok(html.includes('cash on delivery'));
    assert.ok(html.includes('Discount'));
  });

  it('thermal label is 80mm, shows the courier id and the COD amount to collect', () => {
    const html = buildOrderDocument('label', doc({ courierPartner: 'steadfast', consignmentId: 'SF-100' }), { name: 'Deshi Gee', phone: '017', address: 'x' });
    assert.ok(html.includes('size:80mm'));
    assert.ok(html.includes('STEADFAST: SF-100'));
    assert.ok(html.includes('COD ৳2,380'));
    const prepaid = buildOrderDocument('label', doc({ paymentMethod: 'bkash' }), { name: 'Deshi Gee', phone: '017', address: 'x' });
    assert.ok(prepaid.includes('PREPAID'));
  });

  it('packing slip lists quantities with a checkbox and the amount to collect', () => {
    const html = buildOrderDocument('packing_slip', doc(), { name: 'Deshi Gee', phone: '017', address: 'x' });
    assert.ok(html.includes('Packing slip'));
    assert.ok(html.includes('☐'));
    assert.ok(html.includes('Collect on delivery'));
  });
});

describe('Manual order entry API', () => {
  it('requires an authenticated staff member and the CSRF header', async () => {
    const unauth = await manualPost(
      new Request('http://localhost:3000/api/admin/orders/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify({ source: 'phone', customerName: 'A', phone: '01712345678', qty500g: 1 }),
      })
    );
    assert.equal(unauth.status, 401);
    const noCsrf = await manualPost(new Request('http://localhost:3000/api/admin/orders/manual', { method: 'POST', body: '{}' }));
    assert.equal(noCsrf.status, 403);
  });
});
