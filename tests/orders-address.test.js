import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';

// A saved address must never be trusted from the request body. The server
// loads the address, verifies it belongs to the session customer, rebuilds the
// shipping snapshot from the stored row and freezes it on the order — so
// editing the address later cannot rewrite order history.

const CATALOG = [
  { id: 'ZV001', name: 'Silk Shirt', price: 12000, available: true, sizes: [{ size: 'M' }, { size: 'L' }] },
];

function createFakePrisma() {
  const customers = new Map();
  const addresses = [];
  const orders = [];
  let customerSeq = 0;
  let addressSeq = 0;
  let orderSeq = 0;

  const customerModel = {
    async create({ data }) {
      if (customers.has(data.email)) {
        const error = new Error('Unique constraint failed on the fields: (`email`)');
        error.code = 'P2002';
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

  const addressModel = {
    async findFirst({ where }) {
      return (
        addresses.find(
          (a) =>
            (where?.id === undefined || (typeof where.id === 'object' ? a.id !== where.id.not : a.id === where.id)) &&
            (where?.customerId === undefined || a.customerId === where.customerId)
        ) || null
      );
    },
    async findMany({ where }) {
      return addresses.filter((a) => where?.customerId === undefined || a.customerId === where.customerId);
    },
    async create({ data }) {
      const row = { id: ++addressSeq, country: 'IN', isDefault: false, ...data, createdAt: new Date(), updatedAt: new Date() };
      addresses.push(row);
      return row;
    },
    async update({ where, data }) {
      const row = addresses.find((a) => a.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async updateMany() {
      return { count: 0 };
    },
    async delete({ where }) {
      const i = addresses.findIndex((a) => a.id === where.id);
      return addresses.splice(i, 1)[0];
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
        const found = orders.find((o) => o.idempotencyKey === where.idempotencyKey) || null;
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
    address: addressModel,
    order: orderModel,
    product: {
      async findMany({ where, include }) {
        const ids = where?.id?.in ?? [];
        return CATALOG.filter((p) => ids.includes(p.id)).map((p) => (include?.sizes ? { ...p, sizes: [...p.sizes] } : { ...p }));
      },
    },
    async $transaction(arg) {
      if (Array.isArray(arg)) return Promise.all(arg);
      if (typeof arg === 'function') return arg(this);
      throw new Error('Unsupported transaction form');
    },
    __orders: orders,
    __addresses: addresses,
    __customers: customers,
  };
}

function buildApp({ requireAuthForOrders = false } = {}) {
  const prisma = createFakePrisma();
  const app = createApp({
    prisma,
    logger: { log() {}, error() {} },
    sessionSecret: 'test-secret-32-characters-long-enough',
    authRateLimit: false,
    loginRateLimit: false,
    orderRateLimit: false,
    requireAuthForOrders,
  });
  return { app, prisma };
}

function orderBody(overrides = {}) {
  return {
    email: 'buyer@example.com',
    name: 'Buyer',
    phone: '+91 98200 00000',
    shippingName: 'Client Name',
    shippingAddress: '1 Client Road',
    shippingCity: 'Client City',
    shippingPostalCode: '400001',
    items: [{ productId: 'ZV001', size: 'M', quantity: 1 }],
    ...overrides,
  };
}

const STORED_ADDRESS = {
  fullName: 'Stored Name',
  phone: '+91 90000 00000',
  addressLine1: '99 Stored Street',
  addressLine2: 'Floor 3',
  locality: 'Bandra',
  landmark: 'Opposite the park',
  city: 'Mumbai',
  state: 'Maharashtra',
  postalCode: '400050',
  country: 'IN',
};

/** Register + log in, then seed a saved address owned by that customer. */
async function loginWithAddress(app, prisma, email) {
  const creds = { email, password: 'securepassword123' };
  const register = await request(app)
    .post('/api/auth/register')
    .send({ ...creds, name: 'Test Customer', phone: '+91 98200 00000' });
  assert.equal(register.status, 201);
  const customerId = register.body.data.id;

  const response = await request(app).post('/api/auth/login').send(creds);
  assert.equal(response.status, 200);

  const jar = {};
  let csrf = null;
  for (const cookie of response.headers['set-cookie'] || []) {
    const [pair] = cookie.split(';');
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1);
    jar[name] = value;
    if (name === 'zaevi.csrf') csrf = value;
  }
  assert.ok(jar['zaevi.sid'] && csrf, 'session + CSRF cookies set');

  const address = await prisma.address.create({ data: { customerId, ...STORED_ADDRESS } });
  return {
    cookieHeader: Object.entries(jar).map(([n, v]) => `${n}=${v}`).join('; '),
    csrf,
    customerId,
    addressId: address.id,
    cookie: jar,
  };
}

function postOrder(app, session, body, key) {
  return request(app)
    .post('/api/orders')
    .set({ 'Idempotency-Key': key })
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrf)
    .send(body);
}

test('an owned addressId becomes the order shipping snapshot, overriding client fields', async () => {
  const { app, prisma } = buildApp();
  const session = await loginWithAddress(app, prisma, 'buyer@example.com');

  const res = await request(app)
    .post('/api/orders')
    .set({ 'Idempotency-Key': 'addr-order-key-000000000000000001' })
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrf)
    .send(orderBody({ addressId: session.addressId }));

  assert.equal(res.status, 201, JSON.stringify(res.body));
  const stored = prisma.__orders[0];
  assert.equal(stored.shippingName, 'Stored Name');
  assert.equal(stored.shippingAddress, '99 Stored Street, Floor 3, Bandra, Opposite the park');
  assert.equal(stored.shippingCity, 'Mumbai');
  assert.equal(stored.shippingPostalCode, '400050');
  assert.equal(stored.shippingCountry, 'IN');
  assert.equal(stored.customerId, session.customerId, 'order is linked to the session customer');
});

test('a foreign customer addressId is rejected and creates no order', async () => {
  const { app, prisma } = buildApp();
  const victim = await loginWithAddress(app, prisma, 'victim@example.com');
  const attacker = await loginWithAddress(app, prisma, 'attacker@example.com');

  const res = await request(app)
    .post('/api/orders')
    .set({ 'Idempotency-Key': 'addr-order-key-000000000000000002' })
    .set('Cookie', attacker.cookieHeader)
    .set('x-csrf-token', attacker.csrf)
    .send(orderBody({ addressId: victim.addressId }));

  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /address is not available/i);
  assert.equal(prisma.__orders.length, 0, 'no order row is created for a foreign address');
});

test('an addressId without a session is rejected', async () => {
  const { app, prisma } = buildApp();
  const res = await request(app)
    .post('/api/orders')
    .set({ 'Idempotency-Key': 'addr-order-key-000000000000000003' })
    .send(orderBody({ addressId: 1 }));
  assert.equal(res.status, 401);
  assert.equal(prisma.__orders.length, 0);
});

test('guest checkout is still blocked when the order policy requires auth', async () => {
  const { app, prisma } = buildApp({ requireAuthForOrders: true });
  const res = await request(app)
    .post('/api/orders')
    .set({ 'Idempotency-Key': 'addr-order-key-000000000000000009' })
    .set('x-csrf-token', 'anything')
    .send(orderBody({ addressId: 1 }));
  assert.equal(res.status, 401);
  assert.equal(prisma.__orders.length, 0);
});

test('an unknown addressId is rejected', async () => {
  const { app, prisma } = buildApp();
  const session = await loginWithAddress(app, prisma, 'unknown@example.com');
  const res = await request(app)
    .post('/api/orders')
    .set({ 'Idempotency-Key': 'addr-order-key-000000000000000004' })
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrf)
    .send(orderBody({ addressId: session.addressId + 9999 }));
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /address is not available/i);
  assert.equal(prisma.__orders.length, 0);
});

test('editing or deleting the saved address never rewrites past orders', async () => {
  const { app, prisma } = buildApp();
  const session = await loginWithAddress(app, prisma, 'immutable@example.com');

  const res = await request(app)
    .post('/api/orders')
    .set({ 'Idempotency-Key': 'addr-order-key-000000000000000005' })
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrf)
    .send(orderBody({ addressId: session.addressId }));
  assert.equal(res.status, 201);
  const before = prisma.__orders[0].shippingAddress;

  const patched = await request(app)
    .patch(`/api/customer/addresses/${session.addressId}`)
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrf)
    .send({ city: 'Delhi', postalCode: '110001' });
  assert.equal(patched.status, 200);

  const removed = await request(app)
    .delete(`/api/customer/addresses/${session.addressId}`)
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrf);
  assert.equal(removed.status, 200);

  assert.equal(prisma.__orders[0].shippingAddress, before, 'order history is frozen');
  assert.equal(prisma.__orders[0].shippingCity, 'Mumbai');
  assert.equal(prisma.__orders[0].shippingPostalCode, '400050');
  assert.equal(prisma.__addresses.length, 0);
});

test('a malformed addressId is rejected with 400', async () => {
  const { app, prisma } = buildApp();
  const session = await loginWithAddress(app, prisma, 'malformed@example.com');
  const res = await request(app)
    .post('/api/orders')
    .set({ 'Idempotency-Key': 'addr-order-key-000000000000000007' })
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrf)
    .send(orderBody({ addressId: 'not-a-number' }));
  assert.equal(res.status, 400);
  assert.equal(prisma.__orders.length, 0);
});

test('idempotent replay with the same addressId returns the original order', async () => {
  const { app, prisma } = buildApp();
  const session = await loginWithAddress(app, prisma, 'replay@example.com');
  const key = 'addr-order-key-000000000000000006';
  const send = () =>
    request(app)
      .post('/api/orders')
      .set({ 'Idempotency-Key': key })
      .set('Cookie', session.cookieHeader)
      .set('x-csrf-token', session.csrf)
      .send(orderBody({ addressId: session.addressId }));

  const first = await send();
  assert.equal(first.status, 201);
  const replay = await send();
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.reference, first.body.data.reference);
  assert.equal(prisma.__orders.length, 1, 'no duplicate order row');
});
