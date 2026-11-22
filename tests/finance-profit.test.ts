import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GET as financeGet } from '../app/api/admin/finance/route';
import { DELETE as expenseDelete, POST as expensePost } from '../app/api/admin/finance/expenses/route';
import { PUT as settingsPut } from '../app/api/admin/finance/settings/route';
import {
  computeOrderCogs,
  computeProfitReport,
  dhakaDateKey,
  enumerateDateKeys,
  validateExpenseInput,
  validateFinanceSettings,
  type ExpenseRecord,
  type ProfitOrderInput,
} from '../src/lib/finance/profit';

const exp = (p: Partial<ExpenseRecord>): ExpenseRecord => ({
  id: 'e1',
  date: '2026-11-20',
  type: 'facebook_ads',
  amountBdt: 0,
  description: '',
  createdByEmail: 'owner@test',
  createdAtIso: '2026-11-20T00:00:00.000Z',
  ...p,
});

describe('Finance — daily profit & expenses', () => {
  it('dhakaDateKey groups by Asia/Dhaka calendar date (UTC+6)', () => {
    assert.equal(dhakaDateKey('2026-11-19T18:30:00.000Z'), '2026-11-20'); // 00:30 Dhaka next day
    assert.equal(dhakaDateKey('2026-11-19T17:59:00.000Z'), '2026-11-19');
    assert.equal(dhakaDateKey('not-a-date'), '');
  });

  it('enumerateDateKeys is inclusive and rejects invalid ranges', () => {
    assert.deepEqual(enumerateDateKeys('2026-11-19', '2026-11-21'), ['2026-11-19', '2026-11-20', '2026-11-21']);
    assert.deepEqual(enumerateDateKeys('2026-11-21', '2026-11-19'), []);
    assert.deepEqual(enumerateDateKeys('2026-02-30', '2026-03-02'), []);
  });

  it('net profit counts delivered revenue only and subtracts COGS, ads, packaging, courier, other', () => {
    const orders: ProfitOrderInput[] = [
      { orderNumber: 'A', status: 'delivered', totalBdt: 1000, cogsBdt: 400, createdAtIso: '2026-11-20T05:00:00Z' },
      { orderNumber: 'B', status: 'delivered', totalBdt: 500, cogsBdt: 200, createdAtIso: '2026-11-20T06:00:00Z' },
      { orderNumber: 'C', status: 'pending', totalBdt: 900, cogsBdt: 300, createdAtIso: '2026-11-20T07:00:00Z' },
      { orderNumber: 'D', status: 'cancelled', totalBdt: 800, cogsBdt: 300, createdAtIso: '2026-11-20T08:00:00Z' },
      { orderNumber: 'E', status: 'shipped', totalBdt: 700, cogsBdt: 250, createdAtIso: '2026-11-20T09:00:00Z' },
    ];
    const expenses = [
      exp({ id: '1', type: 'facebook_ads', amountBdt: 300 }),
      exp({ id: '2', type: 'tiktok_ads', amountBdt: 50 }),
      exp({ id: '3', type: 'packaging', amountBdt: 40 }),
      exp({ id: '4', type: 'courier', amountBdt: 60 }),
      exp({ id: '5', type: 'other', amountBdt: 10 }),
      exp({ id: '6', type: 'procurement', amountBdt: 5000 }), // excluded: covered by COGS
    ];
    const { rows, totals } = computeProfitReport({ orders, expenses, from: '2026-11-20', to: '2026-11-20' });
    const day = rows[0];
    assert.equal(day.totalOrders, 5);
    assert.equal(day.deliveredOrders, 2);
    assert.equal(day.cancelledOrders, 1);
    assert.equal(day.grossOrderValue, 1000 + 500 + 900 + 700); // cancelled excluded
    assert.equal(day.deliveredRevenue, 1500);
    assert.equal(day.cogs, 600);
    assert.equal(day.adSpend, 350);
    assert.equal(day.procurementExcluded, 5000);
    // 1500 - 600 - 40 - 60 - 350 - 10 = 440
    assert.equal(day.netProfit, 440);
    assert.equal(day.marginPct, 29.33);
    assert.equal(totals.netProfit, 440);
    assert.equal(day.ordersMissingCogs, 0);
  });

  it('flags delivered orders without a COGS snapshot instead of inventing a cost', () => {
    const { rows } = computeProfitReport({
      orders: [{ orderNumber: 'X', status: 'delivered', totalBdt: 1000, createdAtIso: '2026-11-20T05:00:00Z' }],
      expenses: [],
      from: '2026-11-20',
      to: '2026-11-20',
    });
    assert.equal(rows[0].cogs, 0);
    assert.equal(rows[0].ordersMissingCogs, 1);
    assert.equal(rows[0].netProfit, 1000);
  });

  it('days with no activity are present with zero values and null margin', () => {
    const { rows } = computeProfitReport({ orders: [], expenses: [exp({ date: '2026-11-21', amountBdt: 100 })], from: '2026-11-20', to: '2026-11-21' });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].marginPct, null);
    assert.equal(rows[1].adSpend, 100);
    assert.equal(rows[1].netProfit, -100);
  });

  it('orders and expenses outside the range are ignored', () => {
    const { totals } = computeProfitReport({
      orders: [{ orderNumber: 'O', status: 'delivered', totalBdt: 999, cogsBdt: 1, createdAtIso: '2026-10-01T05:00:00Z' }],
      expenses: [exp({ date: '2026-10-01', amountBdt: 999 })],
      from: '2026-11-20',
      to: '2026-11-21',
    });
    assert.equal(totals.deliveredRevenue, 0);
    assert.equal(totals.adSpend, 0);
  });

  it('computeOrderCogs multiplies per-jar cost and stays undefined when no cost configured', () => {
    assert.equal(
      computeOrderCogs({ qty250g: 1, qty500g: 2, qty1kg: 1 }, { cogs250g: 200, cogs500g: 400, cogs1kg: 800 }),
      200 + 800 + 800
    );
    assert.equal(computeOrderCogs({ qty250g: 1, qty500g: 0, qty1kg: 0 }, { cogs250g: 0, cogs500g: 0, cogs1kg: 0 }), undefined);
  });

  it('expense and settings validation reject bad input', () => {
    assert.equal(validateExpenseInput({ date: '2026-11-20', type: 'facebook_ads', amountBdt: 1500.456, description: ' boost ' }).ok, true);
    assert.equal(validateExpenseInput({ date: '20-11-2026', type: 'facebook_ads', amountBdt: 10 }).ok, false);
    assert.equal(validateExpenseInput({ date: '2026-11-20', type: 'crypto', amountBdt: 10 }).ok, false);
    assert.equal(validateExpenseInput({ date: '2026-11-20', type: 'other', amountBdt: -5 }).ok, false);
    assert.equal(validateExpenseInput({ date: '2026-11-20', type: 'other', amountBdt: 0 }).ok, false);
    assert.equal(validateFinanceSettings({ cogs250g: 100, cogs500g: 200, cogs1kg: 400 }).ok, true);
    assert.equal(validateFinanceSettings({ cogs250g: -1 }).ok, false);
  });

  it('admin finance APIs reject unauthenticated callers', async () => {
    const get = await financeGet(new Request('http://localhost:3000/api/admin/finance?from=2026-11-20&to=2026-11-20'));
    assert.equal(get.status, 401);

    const post = await expensePost(
      new Request('http://localhost:3000/api/admin/finance/expenses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify({ date: '2026-11-20', type: 'facebook_ads', amountBdt: 100 }),
      })
    );
    assert.equal(post.status, 401);

    const del = await expenseDelete(
      new Request('http://localhost:3000/api/admin/finance/expenses?id=abcdefgh12', {
        method: 'DELETE',
        headers: { 'x-requested-with': 'DeshiGeeStorefront' },
      })
    );
    assert.equal(del.status, 401);

    const put = await settingsPut(
      new Request('http://localhost:3000/api/admin/finance/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify({ cogs250g: 100 }),
      })
    );
    assert.equal(put.status, 401);
  });

  it('mutations without the CSRF header are refused before auth is even attempted', async () => {
    const res = await expensePost(
      new Request('http://localhost:3000/api/admin/finance/expenses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: '2026-11-20', type: 'facebook_ads', amountBdt: 100 }),
      })
    );
    assert.equal(res.status, 403);
  });
});
