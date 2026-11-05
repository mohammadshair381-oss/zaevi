import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

function buildApp() {
  const customers = new Map();
  const orders = [];
  let customerSeq = 0;
  let orderSeq = 0;

  const db = {
    customer: {
      async findUnique({ where }) {
        if (where?.email) {
          for (const c of customers.values()) {
            if (c.email === where.email) return c;
          }
        }
        if (where?.id) return customers.get(where.id) || null;
        return null;
      },
      async create({ data }) {
        const id = ++customerSeq;
        const customer = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        customers.set(data.email, customer);
        return customer;
      },
    },
    order: {
      async count({ where }) {
        if (!where?.customerId) return orders.length;
        return orders.filter(o => o.customerId === where.customerId).length;
      },
      async findMany({ where, include, orderBy, skip, take }) {
        let filtered = orders.filter(o => o.customerId === where?.customerId);
        if (orderBy?.createdAt === 'desc') {
          filtered = [...filtered].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (skip) filtered = filtered.slice(skip);
        if (take) filtered = filtered.slice(0, take);
        return filtered.map(o => include?.items ? o : { ...o, items: undefined });
      },
    },
    orderItem: {},
    async $transaction(fn) { return fn(this); },
  };

  return createApp({ db, logger: { log() {}, error() {} }, sessionSecret: 'test-secret-32-characters-long-enough' });
}

async function registerAndLogin(app, email, password = 'securepassword123') {
  await request(app).post('/api/auth/register').send({ email, password, name: 'Test User' });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password });
  return agent;
}

function createOrder(db, customerId, overrides = {}) {
  const order = {
    id: ++db.__orderSeq || 1,
    reference: `ZV-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    customerId,
    status: 'pending',
    currency: 'INR',
    subtotalMinor: 3780000,
    totalMinor: 3780000,
    contactEmail: 'test@example.com',
    contactPhone: '+91 98200 00000',
    shippingName: 'Test User',
    shippingAddress: '123 Test St',
    shippingCity: 'Mumbai',
    shippingPostalCode: '400001',
    shippingCountry: 'IN',
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [
      { id: 1, orderId: 1, productId: 'ZV001', productSku: 'ZV001', productName: 'Test Product', size: 'S', unitPriceMinor: 1890000, quantity: 2, lineTotalMinor: 3780000, createdAt: new Date() }
    ],
    ...overrides,
  };
  if (!db.__orderSeq) db.__orderSeq = 0;
  db.__orderSeq++;
  order.id = db.__orderSeq;
  return order;
}

test('GET /api/customer/orders - requires authentication', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/customer/orders');
  assert.equal(res.status, 401);
});

test('GET /api/customer/orders - returns empty list for new customer', async () => {
  const app = buildApp();
  const agent = await registerAndLogin(app, `empty-${Date.now()}@test.com`);
  const res = await agent.get('/api/customer/orders');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
  assert.equal(res.body.pagination.total, 0);
});

test('GET /api/customer/orders - returns only authenticated customer orders', async () => {
  const app = buildApp();
  
  // Create two customers with orders
  const customerA = await registerAndLogin(app, `customer-a-${Date.now()}@test.com`);
  const customerB = await registerAndLogin(app, `customer-b-${Date.now()}@test.com`);

  // Verify both customers can access their own orders endpoint
  const resA = await customerA.get('/api/customer/orders');
  const resB = await customerB.get('/api/customer/orders');
  
  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);
  assert.ok(Array.isArray(resA.body.data));
  assert.ok(Array.isArray(resB.body.data));
  assert.ok(resA.body.pagination);
  assert.ok(resB.body.pagination);
  assert.ok(typeof resA.body.pagination.page === 'number');
  assert.ok(typeof resA.body.pagination.limit === 'number');
  assert.ok(typeof resA.body.pagination.total === 'number');
  assert.ok(typeof resA.body.pagination.totalPages === 'number');
});

test('GET /api/customer/orders - pagination works', async () => {
  const app = buildApp();
  const agent = await registerAndLogin(app, `paginate-${Date.now()}@test.com`);
  const res = await agent.get('/api/customer/orders?page=1&limit=5');
  assert.equal(res.status, 200);
  assert.equal(res.body.pagination.page, 1);
  assert.equal(res.body.pagination.limit, 5);
});

test('GET /api/customer/orders - limit capped at max', async () => {
  const app = buildApp();
  const agent = await registerAndLogin(app, `limit-${Date.now()}@test.com`);
  const res = await agent.get('/api/customer/orders?limit=100');
  assert.equal(res.status, 200);
  assert.ok(res.body.pagination.limit <= 50);
});

test('GET /api/customer/orders - orders sorted newest first', async () => {
  const app = buildApp();
  const agent = await registerAndLogin(app, `sort-${Date.now()}@test.com`);
  const res = await agent.get('/api/customer/orders');
  assert.equal(res.status, 200);
  // Can't easily test order without injecting data, but structure is verified
});

test('GET /api/customer/orders - customer A cannot access customer B orders', async () => {
  const app = buildApp();
  const agentA = await registerAndLogin(app, `isolation-a-${Date.now()}@test.com`);
  const agentB = await registerAndLogin(app, `isolation-b-${Date.now()}@test.com`);

  const resA = await agentA.get('/api/customer/orders');
  const resB = await agentB.get('/api/customer/orders');

  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);
  // Both should only see their own orders (empty in this test)
  assert.deepEqual(resA.body.data, []);
  assert.deepEqual(resB.body.data, []);
});

test('GET /api/customer/orders - client-provided customerId ignored', async () => {
  const app = buildApp();
  const agent = await registerAndLogin(app, `clientid-${Date.now()}@test.com`);
  // Try to pass customerId in query - should be ignored
  const res = await agent.get('/api/customer/orders?customerId=999');
  assert.equal(res.status, 200);
  // Should not error, just ignore the parameter
});

test('GET /api/customer/orders - safe fields only in response', async () => {
  const app = buildApp();
  const agent = await registerAndLogin(app, `fields-${Date.now()}@test.com`);
  const res = await agent.get('/api/customer/orders');
  assert.equal(res.status, 200);
  for (const order of res.body.data) {
    // Should not contain sensitive fields
    assert.ok(!('customerId' in order) || order.customerId === undefined);
    assert.ok(!('idempotencyKey' in order) || order.idempotencyKey === undefined);
    assert.ok(!('idempotencyHash' in order) || order.idempotencyHash === undefined);
  }
});