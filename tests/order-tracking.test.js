import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';

// Public tracking: reference + checkout email, no warehouse inventory. The
// endpoint is read-only, rate-limited by the orders router, and returns only
// the public order shape plus production timeline metadata.

const silentLogger = { log() {}, error() {} };

function order(over = {}) {
  return {
    id: 1,
    reference: 'ZV-20261020-0011223344556677',
    status: 'in_production',
    currency: 'INR',
    subtotalMinor: 1890000,
    totalMinor: 1890000,
    contactEmail: 'buyer@example.com',
    contactPhone: '+91 90000 00000',
    shippingName: 'Buyer',
    shippingAddress: '1 Atelier Lane',
    shippingCity: 'Mumbai',
    shippingPostalCode: '400001',
    shippingCountry: 'IN',
    createdAt: new Date('2026-10-20T00:00:00.000Z'),
    items: [{
      id: 9,
      orderId: 1,
      productId: 'ZV001',
      productSku: 'ZV001',
      productName: 'Aurelia Silk Dress',
      size: 'S',
      unitPriceMinor: 1890000,
      quantity: 1,
      lineTotalMinor: 1890000,
    }],
    ...over,
  };
}

function appWith(rows) {
  const db = {
    order: {
      async findUnique({ where, include } = {}) {
        const found = rows.find((row) => row.reference === where.reference);
        if (!found) return null;
        return include?.items ? found : { ...found, items: undefined };
      },
    },
  };
  return createApp({ db, logger: silentLogger, orderRateLimit: false });
}

const track = (app, body) => request(app).post('/api/orders/track').send(body);

test('tracking returns the public order shape and production timeline', async () => {
  const app = appWith([order()]);
  const res = await track(app, {
    reference: 'zv-20261020-0011223344556677',
    email: 'BUYER@example.com ',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'in_production');
  assert.equal(res.body.data.statusLabel, 'In Production');
  assert.equal(res.body.data.reference, 'ZV-20261020-0011223344556677');
  assert.equal(res.body.data.timeline.find((s) => s.state === 'current').label, 'In Production');
  assert.equal(res.body.data.items.length, 1);

  const body = JSON.stringify(res.body);
  assert.ok(!body.includes('contactEmail'), 'tracking never echoes the contact email');
  assert.ok(!body.includes('shippingAddress'), 'tracking never exposes the shipping address');
  assert.ok(!body.includes('stock'), 'tracking has no inventory fields');
});

test('a mismatched email and an unknown reference are indistinguishable 404s', async () => {
  const app = appWith([order()]);
  const mismatch = await track(app, {
    reference: 'ZV-20261020-0011223344556677',
    email: 'someone-else@example.com',
  });
  assert.equal(mismatch.status, 404);
  assert.equal(mismatch.body.error.message, 'Order not found');

  const unknown = await track(app, {
    reference: 'ZV-20261020-aaaaaaaaaaaaaaaa',
    email: 'buyer@example.com',
  });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.message, 'Order not found');
});

test('malformed tracking requests are rejected before any lookup', async () => {
  const app = appWith([order()]);
  for (const body of [
    null,
    {},
    { reference: 'not-a-reference', email: 'buyer@example.com' },
    { reference: 'ZV-20261020-0011223344556677' },
    { reference: 'ZV-20261020-0011223344556677', email: 'not-an-email' },
  ]) {
    const res = await track(app, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('a cancelled order is shown as the terminal cancelled stage', async () => {
  const app = appWith([order({ status: 'cancelled' })]);
  const res = await track(app, {
    reference: 'ZV-20261020-0011223344556677',
    email: 'buyer@example.com',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.statusLabel, 'Cancelled');
  assert.deepEqual(res.body.data.timeline, [
    { value: 'cancelled', label: 'Cancelled', state: 'current' },
  ]);
});
