import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { POST as pipelinePost } from '../app/api/admin/orders/update/route';
import {
  SELECTABLE_STATUSES,
  allowedNextStatuses,
  canTransition,
  cancellationRestoresStock,
  customerFacingStatus,
  defaultTracksForStatus,
  isTerminalStatus,
  validatePipelineUpdate,
} from '../src/lib/orders/pipeline';
import type { OrderStatus } from '../src/lib/storeTypes';

describe('Order pipeline v2 — statuses, COD collection, settlement', () => {
  it('follows the intended happy path step by step', () => {
    const path: OrderStatus[] = [
      'pending',
      'confirmed',
      'packaging',
      'ready_to_ship',
      'sent_to_courier',
      'out_for_delivery',
      'delivered',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      assert.equal(canTransition(path[i], path[i + 1]), true, `${path[i]} → ${path[i + 1]}`);
    }
  });

  it('blocks skipping the pipeline and moving out of final states', () => {
    assert.equal(canTransition('pending', 'delivered'), false);
    assert.equal(canTransition('pending', 'sent_to_courier'), false);
    assert.equal(canTransition('cancelled', 'pending'), false);
    assert.equal(canTransition('returned', 'delivered'), false);
    assert.equal(isTerminalStatus('cancelled'), true);
    assert.equal(isTerminalStatus('returned'), true);
    assert.equal(isTerminalStatus('delivered'), false); // can still be returned
    assert.deepEqual(allowedNextStatuses('delivered'), ['returned']);
  });

  it('keeps legacy processing / shipped orders workable', () => {
    assert.equal(canTransition('processing', 'ready_to_ship'), true);
    assert.equal(canTransition('shipped', 'delivered'), true);
    assert.equal(canTransition('shipped', 'delivery_failed'), true);
    assert.equal(SELECTABLE_STATUSES.includes('processing'), false);
    assert.equal(SELECTABLE_STATUSES.includes('shipped'), false);
  });

  it('failed delivery can be retried or returned', () => {
    assert.equal(canTransition('out_for_delivery', 'delivery_failed'), true);
    assert.equal(canTransition('delivery_failed', 'out_for_delivery'), true);
    assert.equal(canTransition('delivery_failed', 'returned'), true);
  });

  it('customers only ever see the original five tracking steps', () => {
    const seen = new Set(SELECTABLE_STATUSES.map(customerFacingStatus));
    for (const s of seen) {
      assert.ok(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'].includes(s), s);
    }
    assert.equal(customerFacingStatus('packaging'), 'processing');
    assert.equal(customerFacingStatus('out_for_delivery'), 'shipped');
    assert.equal(customerFacingStatus('returned'), 'cancelled');
  });

  it('stock is restored on cancellation but never for delivered/returned orders', () => {
    assert.equal(cancellationRestoresStock('pending'), true);
    assert.equal(cancellationRestoresStock('packaging'), true);
    assert.equal(cancellationRestoresStock('delivery_failed'), true);
    assert.equal(cancellationRestoresStock('delivered'), false);
    assert.equal(cancellationRestoresStock('returned'), false);
    assert.equal(cancellationRestoresStock('cancelled'), false);
  });

  it('delivered does NOT mark cash as collected or settled', () => {
    const d = defaultTracksForStatus('delivered', {});
    assert.equal(d.collectionStatus, 'awaiting');
    assert.equal(d.settlementStatus, 'pending');
    // existing progress is preserved, not reset
    const kept = defaultTracksForStatus('delivered', { collectionStatus: 'collected', settlementStatus: 'settled' });
    assert.equal(kept.collectionStatus, 'collected');
    assert.equal(kept.settlementStatus, 'settled');
    // failed delivery marks collection failed
    assert.equal(defaultTracksForStatus('delivery_failed', {}).collectionStatus, 'failed');
  });

  it('cash can be marked collected only after delivery', () => {
    const r = validatePipelineUpdate({ status: 'sent_to_courier', totalBdt: 1200 }, { collectionStatus: 'collected' });
    assert.equal(r.ok, false);
    const ok = validatePipelineUpdate({ status: 'delivered', totalBdt: 1200 }, { collectionStatus: 'collected' });
    assert.equal(ok.ok, true);
  });

  it('partial collection needs an amount between 0 and the order total', () => {
    const base = { status: 'delivered' as OrderStatus, totalBdt: 1200 };
    assert.equal(validatePipelineUpdate(base, { collectionStatus: 'partial' }).ok, false);
    assert.equal(validatePipelineUpdate(base, { collectionStatus: 'partial', collectedAmountBdt: 0 }).ok, false);
    assert.equal(validatePipelineUpdate(base, { collectionStatus: 'partial', collectedAmountBdt: 1200 }).ok, false);
    assert.equal(validatePipelineUpdate(base, { collectionStatus: 'partial', collectedAmountBdt: 700 }).ok, true);
  });

  it('settlement cannot advance before cash is collected, and partial cannot be fully settled', () => {
    const awaiting = { status: 'delivered' as OrderStatus, totalBdt: 1200, collectionStatus: 'awaiting' as const };
    assert.equal(validatePipelineUpdate(awaiting, { settlementStatus: 'settled' }).ok, false);
    assert.equal(validatePipelineUpdate(awaiting, { settlementStatus: 'pending' }).ok, true);
    const collected = { ...awaiting, collectionStatus: 'collected' as const };
    assert.equal(validatePipelineUpdate(collected, { settlementStatus: 'settled' }).ok, true);
    const partial = { ...awaiting, collectionStatus: 'partial' as const };
    assert.equal(validatePipelineUpdate(partial, { settlementStatus: 'settled' }).ok, false);
    assert.equal(validatePipelineUpdate(partial, { settlementStatus: 'partial' }).ok, true);
  });

  it('rejects an illegal status jump with a readable message', () => {
    const r = validatePipelineUpdate({ status: 'pending', totalBdt: 500 }, { status: 'delivered' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Cannot change status from "Pending" to "Delivered"/);
  });

  it('admin update API rejects unauthenticated and cross-site callers', async () => {
    const unauth = await pipelinePost(
      new Request('http://localhost:3000/api/admin/orders/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'DeshiGeeStorefront' },
        body: JSON.stringify({ orderNumber: 'DG-12345', status: 'confirmed' }),
      })
    );
    assert.equal(unauth.status, 401);

    const noCsrf = await pipelinePost(
      new Request('http://localhost:3000/api/admin/orders/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderNumber: 'DG-12345', status: 'confirmed' }),
      })
    );
    assert.equal(noCsrf.status, 403);
  });
});
