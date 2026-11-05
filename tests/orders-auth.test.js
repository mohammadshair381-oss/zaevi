import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';

// Checkout policy: the ZAEVI storefront requires a signed-in customer to place
// an order. These tests prove the server-side half of that policy
// (`requireAuthForOrders`) while the client-side half lives in checkout.html.

const silentLogger = { log() {}, error() {} };
const SESSION_SECRET = 'test-secret-32-characters-long-enough';
const CREDENTIALS = { email: 'shopper@example.com', password: 'securepassword123' };

/** Minimal priced catalog used by the order model's server-side pricing. */
const CATALOG = [
  {
    id: 'ZV001',
    name: 'Aurelia Silk Dress',
    price: 18900,
    available: true,
    sizes: [{ size: 'S' }, { size: 'M' }, { size: 'L' }],
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

/**
 * Fake database covering the auth and order endpoints: register/login need the
 * customer model, POST /api/orders needs products, the customer upsert and a
 * transaction that creates the order.
 */
function createFakeDb() {
  const customers = new Map();
  const orders = [];
  let customerSeq = 0;
  let orderSeq = 0;

  const customerModel = {
    async create({ data }) {
      if (customers.has(data.email)) {
        const error = new Error('Unique constraint failed on the fields: (`email`)');
        error.code = 'DUPLICATE_KEY';
        error.meta = { target: 'Customer_email_key' };
        throw error;
      }
      const id = ++customerSeq;
      const customer = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
      customers.set(data.email, customer);
      return customer;
    },
    async findUnique({ where }) {
      if (where?.email) return customers.get(where.email) || null;
      if (where?.id) return [...customers.values()].find((c) => c.id === where.id) || null;
      return null;
    },
    async upsert({ where, create, update }) {
      const existing = customers.get(where.email);
      if (existing) {
        const merged = { ...existing, ...update, updatedAt: new Date() };
        customers.set(where.email, merged);
        return merged;
      }
      const created = { id: ++customerSeq, ...create, createdAt: new Date(), updatedAt: new Date() };
      customers.set(where.email, created);
      return created;
    },
  };

  const orderModel = {
    async create({ data }) {
      const { items: nested, ...scalars } = data;
      const id = (orderSeq += 1);
      const items = (nested?.create ?? []).map((item, index) => ({ id: index + 1, orderId: id, ...item }));
      const row = { id, status: 'pending', currency: 'INR', createdAt: new Date(), updatedAt: new Date(), ...scalars, items };
      orders.push(row);
      return row;
    },
    async findUnique({ where, include }) {
      if (where?.idempotencyKey) {
        const found = orders.find((o) => o.idempotencyKey === where.idempotencyKey);
        if (!found) return null;
        return include?.items ? found : { ...found, items: undefined };
      }
      return null;
    },
    async findMany({ where, include }) {
      const rows = orders.filter((o) => !where?.customerId || o.customerId === where.customerId);
      return include?.items ? rows : rows.map((o) => ({ ...o, items: undefined }));
    },
    async count({ where }) {
      return orders.filter((o) => !where?.customerId || o.customerId === where.customerId).length;
    },
  };

  return {
    customer: customerModel,
    product: {
      async findMany({ where, include }) {
        const ids = where?.id?.in ?? [];
        return CATALOG.filter((p) => ids.includes(p.id))
          .map((p) => (include?.sizes ? { ...p, sizes: [...p.sizes] } : { ...p }));
      },
    },
    order: orderModel,
    async $transaction(fn) { return fn(this); },
    __orders: orders,
    __customers: customers,
  };
}

function buildApp({ requireAuthForOrders = false } = {}) {
  const db = createFakeDb();
  const app = createApp({
    db,
    logger: silentLogger,
    sessionSecret: SESSION_SECRET,
    authRateLimit: false,
    loginRateLimit: false,
    orderRateLimit: false,
    requireAuthForOrders,
  });
  return { app, db };
}

function orderBody(overrides = {}) {
  return {
    email: CREDENTIALS.email,
    name: 'Shopper One',
    phone: '+91 98200 00000',
    shippingName: 'Shopper One',
    shippingAddress: '1 Test Road',
    shippingCity: 'Mumbai',
    shippingPostalCode: '400001',
    items: [{ productId: 'ZV001', size: 'M', quantity: 1 }],
    ...overrides,
  };
}

function orderHeaders(overrides = {}) {
  return { 'Idempotency-Key': 'order-auth-test-key-1234567890123456', ...overrides };
}

/** Register + log in and return { cookieHeader, csrfToken } for the session. */
async function login(app) {
  const register = await request(app)
    .post('/api/auth/register')
    .send({ ...CREDENTIALS, name: 'Shopper One', phone: '+91 98200 00000' });
  assert.equal(register.status, 201);

  const response = await request(app).post('/api/auth/login').send(CREDENTIALS);
  assert.equal(response.status, 200);

  const jar = {};
  const csrfToken = {};
  for (const cookie of response.headers['set-cookie'] || []) {
    const [pair] = cookie.split(';');
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1);
    jar[name] = value;
    if (name === 'zaevi.csrf') csrfToken.value = value;
  }
  assert.ok(jar['zaevi.sid'], 'login sets the session cookie');
  assert.ok(csrfToken.value, 'login sets the CSRF cookie');
  return { cookieHeader: Object.entries(jar).map(([n, v]) => `${n}=${v}`).join('; '), csrfToken: csrfToken.value };
}

test('policy OFF (default): guest checkout still works — no compatibility break', async () => {
  const { app, db } = buildApp();
  const res = await request(app).post('/api/orders').set(orderHeaders()).send(orderBody());
  assert.equal(res.status, 201);
  assert.match(res.body.data.reference, /^ZV-\d{8}-[0-9a-f]{16}$/);
  assert.equal(db.__orders.length, 1);
});

test('policy ON: guest order is rejected before any database write', async () => {
  const { app, db } = buildApp({ requireAuthForOrders: true });
  const res = await request(app).post('/api/orders').set(orderHeaders()).send(orderBody());
  assert.equal(res.status, 401);
  assert.equal(res.body.error.message, 'Authentication required');
  assert.equal(db.__orders.length, 0, 'no order row may be created for a guest');
});

test('policy ON: authenticated order without a CSRF token is rejected', async () => {
  const { app, db } = buildApp({ requireAuthForOrders: true });
  const session = await login(app);
  const res = await request(app)
    .post('/api/orders')
    .set(orderHeaders())
    .set('Cookie', session.cookieHeader)
    .send(orderBody());
  assert.equal(res.status, 403);
  assert.equal(db.__orders.length, 0, 'no order row may be created without a CSRF token');
});

test('policy ON: authenticated order with a wrong CSRF token is rejected', async () => {
  const { app, db } = buildApp({ requireAuthForOrders: true });
  const session = await login(app);
  const res = await request(app)
    .post('/api/orders')
    .set(orderHeaders())
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', 'not-the-session-token')
    .send(orderBody());
  assert.equal(res.status, 403);
  assert.equal(db.__orders.length, 0);
});

test('policy ON: signed-in customer places an order with session + CSRF + idempotency key', async () => {
  const { app, db } = buildApp({ requireAuthForOrders: true });
  const session = await login(app);
  const res = await request(app)
    .post('/api/orders')
    .set(orderHeaders())
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrfToken)
    .send(orderBody());

  assert.equal(res.status, 201);
  assert.match(res.body.data.reference, /^ZV-\d{8}-[0-9a-f]{16}$/);
  assert.equal(res.body.data.totalMinor, 1890000);
  assert.equal(db.__orders.length, 1);

  // The order is attached to the signed-in customer and appears in their history.
  const history = await request(app)
    .get('/api/customer/orders')
    .set('Cookie', session.cookieHeader);
  assert.equal(history.status, 200);
  assert.equal(history.body.data.length, 1);
  assert.equal(history.body.data[0].reference, res.body.data.reference);
});

test('policy ON: an expired/invalid session cannot place an order', async () => {
  const { app, db } = buildApp({ requireAuthForOrders: true });
  const session = await login(app);
  await request(app)
    .post('/api/auth/logout')
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrfToken);

  const res = await request(app)
    .post('/api/orders')
    .set(orderHeaders())
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrfToken)
    .send(orderBody());
  assert.equal(res.status, 401, 'the destroyed session must not create orders');
  assert.equal(db.__orders.length, 0);
});

test('policy ON: idempotency still works for authenticated orders', async () => {
  const { app, db } = buildApp({ requireAuthForOrders: true });
  const session = await login(app);
  const key = 'order-auth-idempotency-12345678901';
  const first = await request(app)
    .post('/api/orders')
    .set(orderHeaders({ 'Idempotency-Key': key }))
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrfToken)
    .send(orderBody());
  assert.equal(first.status, 201);

  const replay = await request(app)
    .post('/api/orders')
    .set(orderHeaders({ 'Idempotency-Key': key }))
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrfToken)
    .send(orderBody());
  assert.equal(replay.status, 200, 'same key + same payload replays the stored order');
  assert.equal(replay.body.data.reference, first.body.data.reference);
  assert.equal(db.__orders.length, 1, 'no duplicate order row');

  const conflict = await request(app)
    .post('/api/orders')
    .set(orderHeaders({ 'Idempotency-Key': key }))
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrfToken)
    .send(orderBody({ shippingAddress: '99 Other Street' }));
  assert.equal(conflict.status, 409);
  assert.equal(db.__orders.length, 1);
});
