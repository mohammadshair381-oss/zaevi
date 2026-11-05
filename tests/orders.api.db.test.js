import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

// Live-database tests for POST /api/orders. Skipped (never failed) when
// DATABASE_URL is unset or MySQL is unreachable, matching the other *.db.test.js
// files. Every row this file creates is removed in `finally`.
import 'dotenv/config';

import { createApp } from '../src/app.js';
import { getPrismaClient, disconnectDB } from '../src/db/connect.js';

const silentLogger = { log() {}, error() {} };

function uniqueSuffix() {
  return randomBytes(6).toString('hex');
}

async function connectOrSkip(t) {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is not set; skipping live database test');
    return null;
  }
  const prisma = getPrismaClient();
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return prisma;
  } catch (error) {
    t.diagnostic(`database unavailable: ${error.message}`);
    t.skip('MySQL is not reachable; skipping live database test');
    return null;
  }
}

function validBody(priceEmail, items, overrides = {}) {
  return {
    email: priceEmail,
    name: 'Live Test Buyer',
    phone: '+91 98200 00000',
    shippingName: 'Live Test Buyer',
    shippingAddress: '12 Marine Drive',
    shippingCity: 'Mumbai',
    shippingPostalCode: '400020',
    items,
    ...overrides,
  };
}

async function cleanup(prisma, references, emails) {
  if (references.length > 0) {
    await prisma.order.deleteMany({ where: { reference: { in: references } } });
  }
  for (const email of emails) {
    await prisma.customer.deleteMany({ where: { email } });
  }
}

test('live database: POST /api/orders persists a guest order with DB-calculated paise', async (t) => {
  const prisma = await connectOrSkip(t);
  if (!prisma) return;

  const suffix = uniqueSuffix();
  const email = `guest.${suffix}@zaevi.test`;
  const references = [];
  const app = createApp({ prisma, logger: silentLogger });

  try {
    const product = await prisma.product.findUnique({ where: { id: 'ZV001' } });
    assert.ok(product, 'catalog product ZV001 must exist');

    const idempotencyKey = `test-${suffix}-${Date.now()}`;
    const res = await request(app)
      .post('/api/orders')
      .set('Idempotency-Key', idempotencyKey)
      .send(validBody(email, [{ productId: 'ZV001', size: 'S', quantity: 2 }], { shippingCountry: 'in' }));

    assert.equal(res.status, 201);
    const reference = res.body.data.reference;
    references.push(reference);
    assert.match(reference, /^ZV-\d{8}-[0-9a-f]{16}$/);

    const expectedUnit = product.price * 100;
    assert.equal(res.body.data.items[0].unitPriceMinor, expectedUnit);
    assert.equal(res.body.data.subtotalMinor, expectedUnit * 2);
    assert.equal(res.body.data.totalMinor, expectedUnit * 2);

    const stored = await prisma.order.findUnique({ where: { reference }, include: { items: true } });
    assert.ok(stored, 'order must be persisted');
    assert.equal(stored.status, 'pending');
    assert.equal(stored.currency, 'INR');
    assert.equal(stored.contactEmail, email);
    assert.equal(stored.shippingCountry, 'IN');
    assert.equal(stored.subtotalMinor, expectedUnit * 2);
    assert.equal(stored.items.length, 1);
    assert.equal(stored.items[0].productSku, 'ZV001');
    assert.equal(stored.items[0].productName, product.name);
    assert.equal(stored.items[0].unitPriceMinor, expectedUnit);
    assert.equal(stored.items[0].lineTotalMinor, expectedUnit * 2);
    assert.equal(stored.items[0].productId, 'ZV001');

    const customer = await prisma.customer.findUnique({ where: { email } });
    assert.ok(customer, 'customer must be linked');
    assert.equal(customer.name, 'Live Test Buyer');
    assert.equal(stored.customerId, customer.id, 'order must link the customer');
  } finally {
    await cleanup(prisma, references, [email]);
    await disconnectDB();
  }
});

test('live database: client-supplied prices are ignored in favour of DB prices', async (t) => {
  const prisma = await connectOrSkip(t);
  if (!prisma) return;

  const email = `guest.${uniqueSuffix()}@zaevi.test`;
  const references = [];
  const app = createApp({ prisma, logger: silentLogger });

  try {
    const product = await prisma.product.findUnique({ where: { id: 'ZV012' } });
    const idempotencyKey = `test-${uniqueSuffix()}-${Date.now()}`;
    const res = await request(app)
      .post('/api/orders')
      .set('Idempotency-Key', idempotencyKey)
      .send(
        validBody(email, [
          { productId: 'ZV012', size: '40', quantity: 1, price: 1, unitPriceMinor: 1, lineTotalMinor: 1 },
        ])
      );

    assert.equal(res.status, 201);
    references.push(res.body.data.reference);

    const expectedUnit = product.price * 100;
    const stored = await prisma.order.findUnique({
      where: { reference: res.body.data.reference },
      include: { items: true },
    });
    assert.equal(stored.items[0].unitPriceMinor, expectedUnit);
    assert.equal(stored.totalMinor, expectedUnit);
  } finally {
    await cleanup(prisma, references, [email]);
    await disconnectDB();
  }
});

test('live database: invalid carts create no order or customer rows', async (t) => {
  const prisma = await connectOrSkip(t);
  if (!prisma) return;

  const app = createApp({ prisma, logger: silentLogger });
  const before = {
    orders: await prisma.order.count(),
    items: await prisma.orderItem.count(),
    customers: await prisma.customer.count(),
  };

  try {
    const email = `guest.${uniqueSuffix()}@zaevi.test`;
    const badBodies = [
      validBody(email, [{ productId: 'ZZ999', size: 'S', quantity: 1 }]),
      validBody(email, [{ productId: 'ZV001', size: 'XXL', quantity: 1 }]),
      validBody(email, []),
      validBody('not-an-email', [{ productId: 'ZV001', size: 'S', quantity: 1 }]),
      validBody(email, [{ productId: 'ZV001', size: 'S', quantity: 0 }]),
      validBody(email, [
        { productId: 'ZV001', size: 'S', quantity: 1 },
        { productId: 'ZV001', size: 'S', quantity: 1 },
      ]),
    ];

    for (const body of badBodies) {
      const res = await request(app).post('/api/orders').send(body);
      assert.equal(res.status, 400);
    }

    assert.equal(await prisma.order.count(), before.orders);
    assert.equal(await prisma.orderItem.count(), before.items);
    assert.equal(await prisma.customer.count(), before.customers);
  } finally {
    await disconnectDB();
  }
});

test('live database: order references are unique across requests', async (t) => {
  const prisma = await connectOrSkip(t);
  if (!prisma) return;

  const email = `guest.${uniqueSuffix()}@zaevi.test`;
  const references = [];
  const app = createApp({ prisma, logger: silentLogger });

  try {
    for (let i = 0; i < 5; i += 1) {
      const idempotencyKey = `test-${uniqueSuffix()}-${Date.now()}-${i}`;
      const res = await request(app)
        .post('/api/orders')
        .set('Idempotency-Key', idempotencyKey)
        .send(validBody(email, [{ productId: 'ZV011', size: 'One Size', quantity: 1 }]));
      assert.equal(res.status, 201);
      references.push(res.body.data.reference);
    }
    assert.equal(new Set(references).size, references.length, 'references must be unique');
  } finally {
    await cleanup(prisma, references, [email]);
    await disconnectDB();
  }
});

test('live database: catalog parity is unchanged (12 products, 49 sizes)', async (t) => {
  const prisma = await connectOrSkip(t);
  if (!prisma) return;
  try {
    assert.equal(await prisma.product.count(), 12);
    assert.equal(await prisma.productSize.count(), 49);
  } finally {
    await disconnectDB();
  }
});
