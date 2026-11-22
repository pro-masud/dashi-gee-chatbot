import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GET as codGet } from '../app/api/admin/cod/route';
import { POST as settlementPost } from '../app/api/admin/cod/settlements/route';
import {
  computeCodSummary,
  eligibleForSettlement,
  evaluateSettlement,
  outstandingCollected,
  settlementDocId,
  validateSettlementInput,
  type CodOrderInput,
} from '../src/lib/cod/settlement';

const order = (p: Partial<CodOrderInput>): CodOrderInput => ({
  orderNumber: 'DG-10001',
  customerName: 'Test',
  status: 'delivered',
  paymentMethod: 'cod',
  totalBdt: 1000,
  createdAtIso: '2026-11-20T05:00:00Z',
  ...p,
});

describe('COD collection & settlement', () => {
  it('summary keeps in-transit, awaiting, collected and settled money in separate buckets', () => {
    const orders: CodOrderInput[] = [
      order({ orderNumber: 'A', status: 'out_for_delivery', totalBdt: 1000 }),
      order({ orderNumber: 'B', status: 'sent_to_courier', totalBdt: 500 }),
      order({ orderNumber: 'C', status: 'delivered', totalBdt: 800 }), // delivered, no collection yet
      order({ orderNumber: 'D', status: 'delivered', totalBdt: 700, collectionStatus: 'collected' }),
      order({ orderNumber: 'E', status: 'delivered', totalBdt: 600, collectionStatus: 'collected', settlementStatus: 'settled', settledAmountBdt: 600 }),
      order({ orderNumber: 'F', status: 'delivered', totalBdt: 400, collectionStatus: 'collected', settlementStatus: 'disputed' }),
      order({ orderNumber: 'G', status: 'returned', totalBdt: 900 }),
      order({ orderNumber: 'H', status: 'cancelled', totalBdt: 999 }),
      order({ orderNumber: 'I', status: 'delivered', totalBdt: 300, paymentMethod: 'bkash' }), // not COD
    ];
    const s = computeCodSummary(orders);
    assert.deepEqual(s.inTransit, { count: 2, amountBdt: 1500 });
    assert.deepEqual(s.awaitingCollection, { count: 1, amountBdt: 800 });
    assert.deepEqual(s.collectedPendingSettlement, { count: 1, amountBdt: 700 });
    assert.deepEqual(s.settled, { count: 1, amountBdt: 600 });
    assert.deepEqual(s.disputed, { count: 1, amountBdt: 400 });
    assert.deepEqual(s.failedCollection, { count: 1, amountBdt: 900 });
  });

  it('delivered orders are never treated as collected cash', () => {
    const s = computeCodSummary([order({ status: 'delivered', totalBdt: 1200 })]);
    assert.equal(s.collectedPendingSettlement.amountBdt, 0);
    assert.equal(s.awaitingCollection.amountBdt, 1200);
  });

  it('partial collection counts only the collected part', () => {
    const o = order({ totalBdt: 1000, collectionStatus: 'partial', collectedAmountBdt: 600 });
    assert.equal(outstandingCollected(o), 600);
    assert.equal(computeCodSummary([o]).collectedPendingSettlement.amountBdt, 600);
  });

  it('only collected, unsettled COD orders are eligible for settlement', () => {
    const list = eligibleForSettlement([
      order({ orderNumber: 'A', collectionStatus: 'collected' }),
      order({ orderNumber: 'B', collectionStatus: 'awaiting' }),
      order({ orderNumber: 'C', collectionStatus: 'collected', settlementStatus: 'settled', settledAmountBdt: 1000 }),
      order({ orderNumber: 'D', collectionStatus: 'collected', paymentMethod: 'nagad' }),
      order({ orderNumber: 'E', collectionStatus: 'collected', settlementStatus: 'disputed' }), // can be re-settled
    ]);
    assert.deepEqual(list.map((o) => o.orderNumber), ['A', 'E']);
  });

  it('exact payout settles; any difference marks orders disputed', () => {
    const sel = [order({ orderNumber: 'A', totalBdt: 1000, collectionStatus: 'collected' }), order({ orderNumber: 'B', totalBdt: 500, collectionStatus: 'collected' })];
    const exact = evaluateSettlement(sel, 1500);
    assert.equal(exact.discrepancyBdt, 0);
    assert.equal(exact.orderStatus, 'settled');
    const short = evaluateSettlement(sel, 1400);
    assert.equal(short.discrepancyBdt, 100);
    assert.equal(short.orderStatus, 'disputed');
    const extra = evaluateSettlement(sel, 1600);
    assert.equal(extra.discrepancyBdt, -100);
    assert.equal(extra.orderStatus, 'disputed');
  });

  it('settlement document id is deterministic so one courier reference can only be recorded once', () => {
    assert.equal(settlementDocId('steadfast', 'sf-pay 10442'), settlementDocId('steadfast', 'SF-PAY-10442'));
    assert.notEqual(settlementDocId('steadfast', 'X1'), settlementDocId('pathao', 'X1'));
  });

  it('settlement input validation', () => {
    const good = { courier: 'steadfast', reference: 'SF-10442', amountBdt: 1500, date: '2026-11-20', orderNumbers: ['dg-10001', 'DG-10001', 'DG-10002'] };
    const ok = validateSettlementInput(good);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.deepEqual(ok.value.orderNumbers, ['DG-10001', 'DG-10002']); // de-duplicated, normalised
    assert.equal(validateSettlementInput({ ...good, courier: 'ups' }).ok, false);
    assert.equal(validateSettlementInput({ ...good, reference: 'x' }).ok, false);
    assert.equal(validateSettlementInput({ ...good, amountBdt: 0 }).ok, false);
    assert.equal(validateSettlementInput({ ...good, date: '20/11/2026' }).ok, false);
    assert.equal(validateSettlementInput({ ...good, orderNumbers: [] }).ok, false);
    assert.equal(validateSettlementInput({ ...good, orderNumbers: ['BAD-1'] }).ok, false);
  });

  it('COD admin APIs reject unauthenticated and cross-site callers', async () => {
    const get = await codGet(new Request('http://localhost:3000/api/admin/cod'));
    assert.equal(get.status, 401);
    const post = await settlementPost(
      new Request('http://localhost:3000/api/admin/cod/settlements', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: '{}',
      })
    );
    assert.equal(post.status, 401);
    const noCsrf = await settlementPost(
      new Request('http://localhost:3000/api/admin/cod/settlements', { method: 'POST', body: '{}' })
    );
    assert.equal(noCsrf.status, 403);
  });
});
