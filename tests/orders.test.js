import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createHash } from 'node:crypto';

import { createApp } from '../src/app.js';
import { MAX_REFERENCE_ATTEMPTS } from '../src/routes/orders.js';

function hashIdempotencyKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

// HTTP-level tests for POST /api/orders using an in-memory fake Prisma client.
// No database is required; the live-database counterpart lives in
// orders.api.db.test.js.

function catalog() {
  return [
    {
      id: 'ZV001',
      name: 'Aurelia Silk Dress',
      price: 18900,
      available: true,
      sizes: [{ size: 'XS' }, { size: 'S' }, { size: 'M' }, { size: 'L' }],
    },
    {
      id: 'ZV012',
      name: 'ZAEVI Signature Loafers',
      price: 13900,
      available: true,
      sizes: [{ size: '39' }, { size: '40' }],
    },
    {
      id: 'ZV099',
      name: 'Sold Out Coat',
      price: 5000,
      available: false,
      sizes: [{ size: 'M' }],
    },
  ];
}

function createFakePrisma(rows, { uniqueCollisions = 0, failOrderCreate = false } = {}) {
  const customers = new Map();
  const orders = [];
  let collisionBudget = uniqueCollisions;
  let orderSeq = 0;
  const calls = { transactions: 0, orderCreate: 0, customerUpsert: 0, writesOutsideTx: 0, inTx: false };

  const orderModel = {
    async create({ data, include } = {}) {
      calls.orderCreate += 1;
      if (!calls.inTx) calls.writesOutsideTx += 1;

      if (collisionBudget > 0) {
        collisionBudget -= 1;
        const error = new Error('Unique constraint failed on the fields: (`reference`)');
        error.code = 'P2002';
        error.meta = { target: 'Order_reference_key' };
        throw error;
      }
      if (failOrderCreate) throw new Error('database exploded');

      const { items: nested, ...scalars } = data;
      const id = (orderSeq += 1);
      const items = (nested?.create ?? []).map((item, index) => ({
        id: index + 1,
        orderId: id,
        createdAt: new Date(),
        ...item,
      }));
      // Store the idempotency key as-is (the route already hashes it before passing to Prisma)
      const row = {
        id,
        status: 'pending',
        currency: 'INR',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...scalars,
        items,
      };
      orders.push(row);
      return include?.items ? row : { ...row, items: undefined };
    },
    async findUnique({ where, include } = {}) {
      const key = where?.idempotencyKey;
      if (key) {
        // The route now passes the hash, so we match directly.
        // (In production, the fallback to raw key is for pre-migration records;
        // the fake starts clean so hash-only lookup is correct.)
        const found = orders.find((o) => o.idempotencyKey === key);
        if (!found) return null;
        return include?.items ? found : { ...found, items: undefined };
      }
      return null;
    },
  };

  const customerModel = {
    async upsert({ where, create, update }) {
      calls.customerUpsert += 1;
      if (!calls.inTx) calls.writesOutsideTx += 1;
      const existing = customers.get(where.email);
      if (existing) {
        const merged = { ...existing, ...update, updatedAt: new Date() };
        customers.set(where.email, merged);
        return merged;
      }
      const created = { id: customers.size + 1, ...create, createdAt: new Date(), updatedAt: new Date() };
      customers.set(where.email, created);
      return created;
    },
    async findUnique({ where }) {
      const email = where?.email;
      if (email) {
        const found = customers.get(email);
        return found || null;
      }
      return null;
    },
  };

  const tx = { order: orderModel, customer: customerModel };

  return {
    product: {
      async findMany({ where, include } = {}) {
        const ids = where?.id?.in ?? [];
        return rows
          .filter((row) => ids.includes(row.id))
          .map((row) => (include?.sizes ? { ...row, sizes: [...row.sizes] } : { ...row }));
      },
    },
    order: orderModel,
    customer: customerModel,
    async $transaction(fn) {
      calls.transactions += 1;
      calls.inTx = true;
      const customerSnapshot = new Map(customers);
      const orderCount = orders.length;
      try {
        return await fn(tx);
      } catch (error) {
        customers.clear();
        for (const [key, value] of customerSnapshot) customers.set(key, value);
        orders.length = orderCount;
        throw error;
      } finally {
        calls.inTx = false;
      }
    },
    __calls: calls,
    __orders: orders,
    __customers: customers,
  };
}

const silentLogger = { log() {}, error() {} };

function buildApp(prismaOptions, appOptions = {}) {
  const prisma = createFakePrisma(catalog(), prismaOptions);
  return { app: createApp({ prisma, logger: silentLogger, ...appOptions }), prisma };
}

function validBody(overrides = {}) {
  return {
    email: '  Aya.El@Example.COM ',
    name: 'Aya El',
    phone: '+91 98200 00000',
    shippingName: 'Aya El',
    shippingAddress: '12 Marine Drive',
    shippingCity: 'Mumbai',
    shippingPostalCode: '400020',
    items: [{ productId: 'ZV001', size: 'S', quantity: 2 }],
    ...overrides,
  };
}

function validHeaders(key = 'test-idempotency-key-1234567890123456') {
  return { 'Idempotency-Key': key };
}

function postOrder(app, body, headers = validHeaders()) {
  return request(app).post('/api/orders').set(headers).send(body);
}

test('POST /api/orders persists a valid guest order and hides internal ids', async () => {
  const { app, prisma } = buildApp();
  const res = await postOrder(app, validBody());

  assert.equal(res.status, 201);
  assert.match(res.body.data.reference, /^ZV-\d{8}-[0-9a-f]{16}$/);
  assert.equal(res.body.data.status, 'pending');
  assert.equal(res.body.data.currency, 'INR');
  assert.equal(res.body.data.subtotalMinor, 3780000);
  assert.equal(res.body.data.totalMinor, 3780000);
  assert.equal(res.body.data.id, undefined);
  assert.equal(res.body.data.customerId, undefined);

  assert.equal(res.body.data.items.length, 1);
  const item = res.body.data.items[0];
  assert.deepEqual(item, {
    productId: 'ZV001',
    productSku: 'ZV001',
    productName: 'Aurelia Silk Dress',
    size: 'S',
    unitPriceMinor: 1890000,
    quantity: 2,
    lineTotalMinor: 3780000,
  });

  assert.equal(prisma.__orders.length, 1);
  assert.equal(prisma.__orders[0].contactEmail, 'aya.el@example.com');
  assert.equal(prisma.__orders[0].shippingCountry, 'IN');
});

test('POST /api/orders ignores client-supplied prices and names', async () => {
  const { app } = buildApp();
  const res = await postOrder(app,
    validBody({
      items: [
        {
          productId: 'ZV001',
          size: 'S',
          quantity: 1,
          price: 1,
          unitPriceMinor: 1,
          lineTotalMinor: 1,
          productName: 'Hacked Name',
          available: false,
        },
      ],
      subtotalMinor: 1,
      totalMinor: 1,
    })
  );

  assert.equal(res.status, 201);
  assert.equal(res.body.data.items[0].unitPriceMinor, 1890000);
  assert.equal(res.body.data.items[0].productName, 'Aurelia Silk Dress');
  assert.equal(res.body.data.subtotalMinor, 1890000);
});

test('POST /api/orders sums multiple items in integer paise', async () => {
  const { app } = buildApp();
  const res = await postOrder(app,
    validBody({
      items: [
        { productId: 'ZV001', size: 'S', quantity: 2 },
        { productId: 'ZV012', size: '39', quantity: 1 },
      ],
    })
  );

  assert.equal(res.status, 201);
  assert.equal(res.body.data.subtotalMinor, 3780000 + 1390000);
  assert.equal(res.body.data.totalMinor, 5170000);
  assert.equal(res.body.data.items.length, 2);
});

test('POST /api/orders performs all writes inside a single transaction', async () => {
  const { app, prisma } = buildApp();
  const res = await postOrder(app, validBody());

  assert.equal(res.status, 201);
  assert.equal(prisma.__calls.transactions, 1);
  assert.equal(prisma.__calls.orderCreate, 1);
  assert.equal(prisma.__calls.customerUpsert, 1);
  assert.equal(prisma.__calls.writesOutsideTx, 0);
});

test('POST /api/orders rejects invalid payloads with 400 and no stack', async () => {
  const { app } = buildApp();
  const cases = [
    ['invalid email', validBody({ email: 'nope' })],
    ['missing email', validBody({ email: undefined })],
    ['missing shippingName', validBody({ shippingName: '' })],
    ['missing shippingAddress', validBody({ shippingAddress: undefined })],
    ['missing city', validBody({ shippingCity: '  ' })],
    ['missing postal code', validBody({ shippingPostalCode: undefined })],
    ['empty cart', validBody({ items: [] })],
    ['items not array', validBody({ items: 'x' })],
    ['item not object', validBody({ items: [42] })],
    ['missing productId', validBody({ items: [{ size: 'S', quantity: 1 }] })],
    ['missing size', validBody({ items: [{ productId: 'ZV001', quantity: 1 }] })],
    ['zero quantity', validBody({ items: [{ productId: 'ZV001', size: 'S', quantity: 0 }] })],
    ['negative quantity', validBody({ items: [{ productId: 'ZV001', size: 'S', quantity: -2 }] })],
    ['fractional quantity', validBody({ items: [{ productId: 'ZV001', size: 'S', quantity: 1.5 }] })],
    ['string quantity', validBody({ items: [{ productId: 'ZV001', size: 'S', quantity: '2' }] })],
    ['unsafe quantity', validBody({ items: [{ productId: 'ZV001', size: 'S', quantity: Number.MAX_SAFE_INTEGER + 1 }] })],
    ['over max quantity', validBody({ items: [{ productId: 'ZV001', size: 'S', quantity: 11 }] })],
    ['unknown product', validBody({ items: [{ productId: 'ZZ999', size: 'S', quantity: 1 }] })],
    ['unavailable product', validBody({ items: [{ productId: 'ZV099', size: 'M', quantity: 1 }] })],
    ['invalid size', validBody({ items: [{ productId: 'ZV001', size: 'XXL', quantity: 1 }] })],
    [
      'duplicate product and size',
      validBody({
        items: [
          { productId: 'ZV001', size: 'S', quantity: 1 },
          { productId: 'ZV001', size: 'S', quantity: 2 },
        ],
      }),
    ],
  ];

  for (const [label, body] of cases) {
    const res = await postOrder(app, body);
    assert.equal(res.status, 400, `${label} should be rejected`);
    assert.equal(res.body.error.status, 400, label);
    assert.equal(res.body.error.stack, undefined, `${label} must not leak a stack`);
  }
});

test('POST /api/orders rejects malformed JSON and non-object bodies', async () => {
  const { app } = buildApp();

  const malformed = await request(app)
    .post('/api/orders')
    .set('Content-Type', 'application/json')
    .set('Idempotency-Key', 'test-idempotency-key-1234567890123456')
    .send('{"items": [');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.stack, undefined);

  const arrayBody = await request(app).post('/api/orders').set('Idempotency-Key', 'test-idempotency-key-1234567890123456').send([1, 2, 3]);
  assert.equal(arrayBody.status, 400);

  const empty = await request(app).post('/api/orders').set('Idempotency-Key', 'test-idempotency-key-1234567890123456');
  assert.equal(empty.status, 400);
});

test('POST /api/orders rolls back partial writes and sanitizes 500s in production', async () => {
  const { app, prisma } = buildApp({ failOrderCreate: true });
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = await postOrder(app, validBody());
    assert.equal(res.status, 500);
    assert.equal(res.body.error.status, 500);
    assert.equal(res.body.error.message, 'Internal Server Error');
    assert.equal(res.body.error.stack, undefined);
    assert.equal(prisma.__orders.length, 0, 'no order may survive a failed transaction');
    assert.equal(prisma.__customers.size, 0, 'customer writes must roll back with the order');
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('POST /api/orders retries on a reference collision and then succeeds', async () => {
  const { app, prisma } = buildApp({ uniqueCollisions: 1 });
  const res = await postOrder(app, validBody());

  assert.equal(res.status, 201);
  assert.equal(prisma.__calls.orderCreate, 2, 'one collision then one success');
  assert.equal(prisma.__orders.length, 1);
});

test('POST /api/orders fails safely when references keep colliding', async () => {
  const { app, prisma } = buildApp({ uniqueCollisions: 99 });
  const res = await postOrder(app, validBody());

  assert.equal(res.status, 500);
  assert.equal(prisma.__calls.orderCreate, MAX_REFERENCE_ATTEMPTS);
  assert.equal(prisma.__orders.length, 0);
});

test('POST /api/orders requires Idempotency-Key header', async () => {
  const { app } = buildApp();
  const res = await request(app).post('/api/orders').send(validBody());
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /Idempotency-Key header is required/);
});

test('POST /api/orders rejects malformed Idempotency-Key', async () => {
  const { app } = buildApp();
  const badKeys = ['', 'a'.repeat(15), 'a'.repeat(65), 'invalid@key', 'invalid key'];
  for (const key of badKeys) {
    const res = await request(app).post('/api/orders').set('Idempotency-Key', key).send(validBody());
    assert.equal(res.status, 400, `key ${JSON.stringify(key)}`);
  }
});

test('POST /api/orders with new key creates order and stores idempotency metadata', async () => {
  const { app, prisma } = buildApp();
  const key = 'valid-idempotency-key-1234567890123456';
  const res = await postOrder(app, validBody(), { 'Idempotency-Key': key });

  assert.equal(res.status, 201);
  assert.ok(res.body.data.reference);
  assert.equal(prisma.__orders.length, 1);
  // The stored key is now the SHA-256 hash of the provided key
  assert.equal(prisma.__orders[0].idempotencyKey, hashIdempotencyKey(key));
  assert.ok(prisma.__orders[0].idempotencyHash);
});

test('POST /api/orders with same key and equivalent payload returns existing order (200)', async () => {
  const { app, prisma } = buildApp();
  const key = 'valid-idempotency-key-1234567890123456';

  const first = await postOrder(app, validBody(), { 'Idempotency-Key': key });
  assert.equal(first.status, 201);
  const firstRef = first.body.data.reference;

  const second = await postOrder(app, validBody(), { 'Idempotency-Key': key });
  assert.equal(second.status, 200);
  assert.equal(second.body.data.reference, firstRef);

  // No duplicate order created
  assert.equal(prisma.__orders.length, 1);
});

test('POST /api/orders with same key but different payload returns 409', async () => {
  const { app, prisma } = buildApp();
  const key = 'valid-idempotency-key-1234567890123456';

  await postOrder(app, validBody(), { 'Idempotency-Key': key });

  // Different email
  const res = await postOrder(app, validBody({ email: 'other@example.com' }), { 'Idempotency-Key': key });

  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /different checkout details/);
  assert.equal(prisma.__orders.length, 1);
});

test('POST /api/orders with same key but different items returns 409', async () => {
  const { app, prisma } = buildApp();
  const key = 'valid-idempotency-key-1234567890123456';

  await postOrder(app, validBody(), { 'Idempotency-Key': key });

  const res = await postOrder(app, validBody({ items: [{ productId: 'ZV001', size: 'M', quantity: 2 }] }), { 'Idempotency-Key': key });

  assert.equal(res.status, 409);
  assert.equal(prisma.__orders.length, 1);
});

test('POST /api/orders with same key but different quantity returns 409', async () => {
  const { app, prisma } = buildApp();
  const key = 'valid-idempotency-key-1234567890123456';

  await postOrder(app, validBody(), { 'Idempotency-Key': key });

  const res = await postOrder(app, validBody({ items: [{ productId: 'ZV001', size: 'S', quantity: 3 }] }), { 'Idempotency-Key': key });

  assert.equal(res.status, 409);
  assert.equal(prisma.__orders.length, 1);
});

test('POST /api/orders ignores client-supplied prices in idempotency comparison', async () => {
  const { app, prisma } = buildApp();
  const key = 'valid-idempotency-key-1234567890123456';

  await postOrder(app, validBody({ items: [{ productId: 'ZV001', size: 'S', quantity: 2, price: 1 }] }), { 'Idempotency-Key': key });

  // Same key, different client price -> should match (client prices ignored)
  const res = await postOrder(app, validBody({ items: [{ productId: 'ZV001', size: 'S', quantity: 2, price: 999 }] }), { 'Idempotency-Key': key });

  assert.equal(res.status, 200);
  assert.equal(prisma.__orders.length, 1);
});

// ---------------------------------------------------------------------------
// Phase 3 / Task 5: rate limiting for POST /api/orders.
//
// The limiter is applied only to order creation. These HTTP tests inject a
// small window through createApp so 429 behavior is exercised end to end. The
// limiter is in-memory and process-local; see rate-limit.test.js for unit tests
// and the deployment limitation.
// ---------------------------------------------------------------------------

test('POST /api/orders allows requests up to the configured limit', async () => {
  const { app, prisma } = buildApp({}, { orderRateLimit: { max: 3, windowMs: 60000 } });
  for (let i = 0; i < 3; i += 1) {
    const res = await postOrder(app, validBody(), { 'Idempotency-Key': `below-limit-key-${i}-123456789012` });
    assert.equal(res.status, 201, `request ${i + 1} should succeed`);
  }
  assert.equal(prisma.__orders.length, 3);
});

test('POST /api/orders returns 429 in the standard error format once exceeded', async () => {
  const { app, prisma } = buildApp({}, { orderRateLimit: { max: 2, windowMs: 60000 } });

  const first = await postOrder(app, validBody(), { 'Idempotency-Key': 'over-limit-key-a-123456789012' });
  const second = await postOrder(app, validBody(), { 'Idempotency-Key': 'over-limit-key-b-123456789012' });
  const third = await postOrder(app, validBody(), { 'Idempotency-Key': 'over-limit-key-c-123456789012' });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(third.status, 429);
  assert.equal(third.body.error.status, 429);
  assert.match(third.body.error.message, /too many/i);
  assert.equal(third.body.error.stack, undefined, '429 must not leak a stack');
  assert.equal(prisma.__orders.length, 2, 'the blocked request must not create an order');
});

test('rate-limit responses carry accurate headers and Retry-After', async () => {
  const { app } = buildApp({}, { orderRateLimit: { max: 1, windowMs: 60000 } });

  const allowed = await postOrder(app, validBody(), { 'Idempotency-Key': 'header-key-a-1234567890123456' });
  assert.equal(allowed.headers['ratelimit-limit'], '1');
  assert.equal(allowed.headers['ratelimit-remaining'], '0');
  assert.ok(Number(allowed.headers['ratelimit-reset']) >= 1);

  const blocked = await postOrder(app, validBody(), { 'Idempotency-Key': 'header-key-b-1234567890123456' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['ratelimit-limit'], '1');
  assert.equal(blocked.headers['ratelimit-remaining'], '0');
  assert.ok(Number(blocked.headers['ratelimit-reset']) >= 1);
  assert.ok(Number(blocked.headers['retry-after']) >= 1, 'Retry-After is present on 429');
});

test('a rate-limited request is blocked before idempotency or order logic', async () => {
  const { app, prisma } = buildApp({}, { orderRateLimit: { max: 1, windowMs: 60000 } });
  const key = 'blocked-idempotency-key-1234567890';

  const first = await postOrder(app, validBody(), { 'Idempotency-Key': key });
  assert.equal(first.status, 201);
  assert.equal(prisma.__calls.transactions, 1);

  // Same key would normally replay with 200; the limiter must short-circuit first.
  const blocked = await postOrder(app, validBody(), { 'Idempotency-Key': key });
  assert.equal(blocked.status, 429);
  assert.equal(prisma.__orders.length, 1, 'no order created by the blocked request');
  assert.equal(prisma.__calls.transactions, 1, 'no second transaction was attempted');
});

test('order rate limiting does not affect unrelated endpoints', async () => {
  const { app } = buildApp({}, { orderRateLimit: { max: 1, windowMs: 60000 } });

  await postOrder(app, validBody(), { 'Idempotency-Key': 'scope-key-a-1234567890123456' });
  const blocked = await postOrder(app, validBody(), { 'Idempotency-Key': 'scope-key-b-1234567890123456' });
  assert.equal(blocked.status, 429, 'orders are limited');

  const home = await request(app).get('/index.html');
  assert.equal(home.status, 200, 'static storefront is not limited');

  const unknown = await request(app).get('/api/does-not-exist');
  assert.equal(unknown.status, 404, 'unrelated API routes are not limited');
});

test('spoofed forwarding headers do not bypass the order rate limit', async () => {
  const { app } = buildApp({}, { orderRateLimit: { max: 1, windowMs: 60000 } });

  await postOrder(app, validBody(), {
    'Idempotency-Key': 'forwarded-key-a-1234567890123456',
    'X-Forwarded-For': '203.0.113.1',
  });
  const blocked = await postOrder(app, validBody(), {
    'Idempotency-Key': 'forwarded-key-b-1234567890123456',
    'X-Forwarded-For': '203.0.113.2',
  });
  assert.equal(blocked.status, 429, 'changing X-Forwarded-For must not reset the limit');
});

test('validation and server-side pricing are unchanged under the limiter', async () => {
  const { app } = buildApp({}, { orderRateLimit: { max: 5, windowMs: 60000 } });

  const invalid = await postOrder(app, validBody({ email: 'not-an-email' }), { 'Idempotency-Key': 'valid-key-a-12345678901234567' });
  assert.equal(invalid.status, 400, 'validation still runs before any order is created');
  assert.equal(invalid.body.error.status, 400);

  const priced = await postOrder(
    app,
    validBody({ items: [{ productId: 'ZV001', size: 'S', quantity: 1, price: 1, unitPriceMinor: 1, totalMinor: 1 }] }),
    { 'Idempotency-Key': 'valid-key-b-12345678901234567' }
  );
  assert.equal(priced.status, 201);
  assert.equal(priced.body.data.items[0].unitPriceMinor, 1890000, 'price comes from the catalog, not the client');
});

test('idempotency replay still works while under the order rate limit', async () => {
  const { app, prisma } = buildApp({}, { orderRateLimit: { max: 5, windowMs: 60000 } });
  const key = 'idempotency-under-limit-key-1234567';

  const first = await postOrder(app, validBody(), { 'Idempotency-Key': key });
  assert.equal(first.status, 201);

  const replay = await postOrder(app, validBody(), { 'Idempotency-Key': key });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.reference, first.body.data.reference);
  assert.equal(prisma.__orders.length, 1);
});

test('orderRateLimit: false disables the limiter', async () => {
  const { app, prisma } = buildApp({}, { orderRateLimit: false });
  for (let i = 0; i < 40; i += 1) {
    const res = await postOrder(app, validBody(), { 'Idempotency-Key': `disabled-key-${i}-123456789012345` });
    assert.equal(res.status, 201);
  }
  assert.equal(prisma.__orders.length, 40);
});
