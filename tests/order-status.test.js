import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ORDER_STATUS_VALUES,
  ORDER_STATUSES,
  ORDER_WORKFLOW,
  buildOrderStatusTimeline,
  canTransitionOrderStatus,
  getAllowedNextStatuses,
  getOrderStatusLabel,
  parseOrderStatusUpdateBody,
} from '../src/models/order-status.js';

// Production-on-demand workflow. `pending` is retained as the persisted value
// for "Order Received" so every historical order keeps its existing status.

test('the production workflow exposes the required stages in order', () => {
  assert.deepEqual(ORDER_WORKFLOW.map((stage) => stage.label), [
    'Order Received',
    'Confirmed',
    'In Production',
    'Quality Check',
    'Packed',
    'Shipped',
    'Delivered',
  ]);
  assert.deepEqual(ORDER_STATUSES, [
    'pending', 'confirmed', 'in_production', 'quality_check', 'packed', 'shipped', 'delivered', 'cancelled',
  ]);
});

test('legacy pending orders are labelled Order Received without changing the value', () => {
  assert.equal(ORDER_STATUS_VALUES.PENDING, 'pending');
  assert.equal(getOrderStatusLabel('pending'), 'Order Received');
  assert.equal(getOrderStatusLabel('in_production'), 'In Production');
  assert.equal(getOrderStatusLabel('legacy-value'), 'legacy-value', 'unknown history is not hidden');
});

test('forward transitions follow the atelier sequence and cancellation rules', () => {
  for (let i = 0; i < ORDER_WORKFLOW.length - 1; i += 1) {
    const from = ORDER_WORKFLOW[i].value;
    const to = ORDER_WORKFLOW[i + 1].value;
    assert.equal(canTransitionOrderStatus(from, to), true, `${from} -> ${to}`);
    assert.ok(getAllowedNextStatuses(from).includes(to));
  }
  assert.equal(canTransitionOrderStatus('pending', 'shipped'), false, 'stages cannot be skipped');
  assert.equal(canTransitionOrderStatus('shipped', 'delivered'), true);
  assert.equal(canTransitionOrderStatus('delivered', 'cancelled'), false);
  assert.equal(canTransitionOrderStatus('shipped', 'cancelled'), false, 'cannot cancel after shipping');
  assert.equal(canTransitionOrderStatus('confirmed', 'cancelled'), true);
  assert.equal(canTransitionOrderStatus('pending', 'pending'), true, 'replay is a no-op');
  assert.equal(canTransitionOrderStatus('unknown', 'confirmed'), false);
  assert.deepEqual(getAllowedNextStatuses('delivered'), []);
  assert.deepEqual(getAllowedNextStatuses('cancelled'), []);
});

test('status update bodies accept only known workflow values', () => {
  assert.deepEqual(parseOrderStatusUpdateBody({ status: ' confirmed ' }), { status: 'confirmed' });
  assert.deepEqual(parseOrderStatusUpdateBody({ status: 'in_production' }), { status: 'in_production' });
  for (const body of [null, [], 'confirmed', {}, { status: 3 }, { status: '' }, { status: 'warehouse' }]) {
    assert.throws(() => parseOrderStatusUpdateBody(body), { status: 400 }, JSON.stringify(body));
  }
});

test('the customer timeline marks completed, current and upcoming stages', () => {
  const timeline = buildOrderStatusTimeline('quality_check');
  assert.deepEqual(timeline.map((stage) => stage.state), [
    'complete', 'complete', 'complete', 'current', 'upcoming', 'upcoming', 'upcoming',
  ]);
  assert.equal(timeline[3].label, 'Quality Check');

  assert.deepEqual(buildOrderStatusTimeline('pending').map((stage) => stage.state), [
    'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming',
  ]);
  assert.deepEqual(buildOrderStatusTimeline('cancelled'), [
    { value: 'cancelled', label: 'Cancelled', state: 'current' },
  ]);
});
