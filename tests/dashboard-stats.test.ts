import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GET as signalGet } from '../app/api/admin/signal/route';
import {
  buildFunnel,
  computeDashboardStats,
  dhakaDay,
  orderCreatedAtMs,
  pctChange,
  previousRange,
  resolveRange,
  type StatsOrder,
} from '../src/lib/dashboard/stats';

const o = (p: Partial<StatsOrder>): StatsOrder => ({
  orderNumber: 'DG-10001',
  status: 'pending',
  totalBdt: 1000,
  qty500g: 1,
  createdAt: '2026-11-20T05:00:00Z',
  ...p,
});

describe('Dashboard statistics', () => {
  it('reads ISO strings, Dates, Firestore timestamps and plain {seconds}', () => {
    const iso = '2026-11-20T05:00:00.000Z';
    const ms = Date.parse(iso);
    assert.equal(orderCreatedAtMs(iso), ms);
    assert.equal(orderCreatedAtMs(new Date(iso)), ms);
    assert.equal(orderCreatedAtMs({ toDate: () => new Date(iso) }), ms);
    assert.equal(orderCreatedAtMs({ seconds: ms / 1000 }), ms);
    assert.equal(orderCreatedAtMs(undefined), null);
    assert.equal(orderCreatedAtMs('garbage'), null);
  });

  it('range presets resolve in Asia/Dhaka calendar days', () => {
    assert.deepEqual(resolveRange('today', '2026-11-20'), { from: '2026-11-20', to: '2026-11-20' });
    assert.deepEqual(resolveRange('yesterday', '2026-11-20'), { from: '2026-11-19', to: '2026-11-19' });
    assert.deepEqual(resolveRange('7d', '2026-11-20'), { from: '2026-11-14', to: '2026-11-20' });
    assert.deepEqual(resolveRange('30d', '2026-11-20'), { from: '2026-10-22', to: '2026-11-20' });
    assert.deepEqual(resolveRange('month', '2026-11-20'), { from: '2026-11-01', to: '2026-11-20' });
    assert.deepEqual(resolveRange('last_month', '2026-11-20'), { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual(resolveRange('last_month', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' });
    assert.deepEqual(resolveRange('custom', '2026-11-20', { from: '2026-11-01', to: '2026-11-05' }), { from: '2026-11-01', to: '2026-11-05' });
  });

  it('an order at 00:30 Dhaka belongs to the Dhaka day, not the UTC day', () => {
    assert.equal(dhakaDay(Date.parse('2026-11-19T18:30:00Z')), '2026-11-20');
  });

  it('counts every status bucket and only delivered orders as revenue', () => {
    const orders = [
      o({ orderNumber: 'A', status: 'pending', totalBdt: 500 }),
      o({ orderNumber: 'B', status: 'confirmed', totalBdt: 600 }),
      o({ orderNumber: 'C', status: 'packaging', totalBdt: 700 }),
      o({ orderNumber: 'D', status: 'ready_to_ship', totalBdt: 700 }),
      o({ orderNumber: 'E', status: 'out_for_delivery', totalBdt: 800 }),
      o({ orderNumber: 'F', status: 'delivered', totalBdt: 1000 }),
      o({ orderNumber: 'G', status: 'delivered', totalBdt: 2000 }),
      o({ orderNumber: 'H', status: 'returned', totalBdt: 900 }),
      o({ orderNumber: 'I', status: 'delivery_failed', totalBdt: 400 }),
      o({ orderNumber: 'J', status: 'cancelled', totalBdt: 999 }),
    ];
    const s = computeDashboardStats(orders, '2026-11-20', '2026-11-20');
    assert.equal(s.totalOrders, 10);
    assert.equal(s.pending, 1);
    assert.equal(s.confirmed, 1);
    assert.equal(s.packaging, 2);
    assert.equal(s.withCourier, 1);
    assert.equal(s.delivered, 2);
    assert.equal(s.returned, 1);
    assert.equal(s.failed, 1);
    assert.equal(s.cancelled, 1);
    assert.equal(s.deliveredRevenue, 3000);
    assert.equal(s.grossOrderValue, 500 + 600 + 700 + 700 + 800 + 1000 + 2000 + 900 + 400);
    assert.equal(s.returnRatePct, 33.33); // 1 returned of 3 (2 delivered + 1 returned)
    assert.equal(s.cancelRatePct, 10);
    assert.equal(s.deliverySuccessPct, 50); // 2 delivered of 4 outcomes
    assert.equal(s.days[0].revenue, 3000);
  });

  it('ignores orders outside the range and with unreadable dates; days with no orders are zero', () => {
    const s = computeDashboardStats(
      [o({ createdAt: '2026-10-01T00:00:00Z' }), o({ createdAt: undefined }), o({ createdAt: '2026-11-21T05:00:00Z' })],
      '2026-11-20',
      '2026-11-22'
    );
    assert.equal(s.totalOrders, 1);
    assert.equal(s.days.length, 3);
    assert.deepEqual(s.days.map((d) => d.orders), [0, 1, 0]);
  });

  it('package sales sum jars from non-cancelled orders', () => {
    const s = computeDashboardStats(
      [
        o({ orderNumber: 'A', qty250g: 1, qty500g: 0, qty1kg: 0 }),
        o({ orderNumber: 'B', qty250g: 0, qty500g: 2, qty1kg: 1 }),
        o({ orderNumber: 'C', status: 'cancelled', qty250g: 9, qty500g: 9, qty1kg: 9 }),
      ],
      '2026-11-20',
      '2026-11-20'
    );
    assert.deepEqual(s.packageSales, [
      { slot: '250g', jars: 1 },
      { slot: '500g', jars: 2 },
      { slot: '1kg', jars: 1 },
    ]);
  });

  it('empty data gives null rates, not NaN or fake zeros', () => {
    const s = computeDashboardStats([], '2026-11-20', '2026-11-20');
    assert.equal(s.returnRatePct, null);
    assert.equal(s.cancelRatePct, null);
    assert.equal(s.deliverySuccessPct, null);
    assert.equal(s.avgOrderValue, 0);
  });

  it('funnel omits the leads step when leads are unavailable and reports step conversion', () => {
    const stats = computeDashboardStats(
      [o({ status: 'delivered' }), o({ orderNumber: 'B', status: 'confirmed' }), o({ orderNumber: 'C', status: 'pending' }), o({ orderNumber: 'D', status: 'cancelled' })],
      '2026-11-20',
      '2026-11-20'
    );
    const withoutLeads = buildFunnel(null, stats);
    assert.deepEqual(withoutLeads.map((f) => f.key), ['orders', 'confirmed', 'delivered']);
    const withLeads = buildFunnel(20, stats);
    assert.deepEqual(withLeads.map((f) => f.key), ['leads', 'orders', 'confirmed', 'delivered']);
    assert.equal(withLeads[1].pctOfPrevious, 20); // 4 orders of 20 leads
    assert.equal(withLeads[0].pctOfPrevious, null);
  });

  it('previous period is the same length immediately before; percentage change handles zero', () => {
    assert.deepEqual(previousRange('2026-11-14', '2026-11-20'), { from: '2026-11-07', to: '2026-11-13' });
    assert.deepEqual(previousRange('2026-11-20', '2026-11-20'), { from: '2026-11-19', to: '2026-11-19' });
    assert.equal(pctChange(150, 100), 50);
    assert.equal(pctChange(50, 100), -50);
    assert.equal(pctChange(10, 0), null);
  });

  it('order signal API requires an authenticated admin', async () => {
    assert.equal((await signalGet(new Request('http://localhost:3000/api/admin/signal'))).status, 401);
  });
});
