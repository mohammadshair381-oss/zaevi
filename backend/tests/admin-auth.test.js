import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/models/auth.js';

/**
 * Phase A admin authorization tests against an in-memory db stub and the
 * REAL middleware stack (sessions, CSRF issuance, static blocking all live).
 *
 * Policy under test:
 *   - anonymous            → 404 on /admin and every /api/admin/* route
 *   - ordinary customer    → 404 (existence not disclosed)
 *   - administrator        → 200 + real data
 *   - role checked per request: flipping the stored role immediately denies
 *   - /admin.html static access blocked for everyone — served only via /admin
 */

const REGISTRATION_MIN = 12;

/**
 * In-memory db fake covering the routes this test file touches.
 * Customers carry `role`; orders/products back the admin listings.
 */
function buildDbStub() {
  const customers = new Map(); // email → row
  let customerSeq = 0;
  const orders = [];
  const products = [];

  const db = {
    customer: {
      async create({ data }) {
        if (customers.has(data.email)) {
          const error = new Error('Unique constraint failed on the fields: (`email`)');
          error.code = 'DUPLICATE_KEY';
          error.meta = { target: 'Customer_email_key' };
          throw error;
        }
        const id = ++customerSeq;
        const row = { id, role: 'customer', ...data, createdAt: new Date(), updatedAt: new Date() };
        customers.set(data.email, row);
        return row;
      },
      async findUnique({ where }) {
        if (where?.email) return customers.get(where.email) || null;
        if (where?.id !== undefined && where?.id !== null) {
          // requireAdmin only selects { role }
          for (const row of customers.values()) {
            if (row.id === where.id) {
              return where && arguments[0] && arguments[0].select && arguments[0].select.role
                ? { role: row.role }
                : row;
            }
          }
        }
        return null;
      },
      async update({ where, data }) {
        const row = customers.get(where.email);
        if (!row) return null;
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      async count() { return customers.size; },
    },
    order: {
      async count(whereArgs = {}) {
        const status = whereArgs.where && whereArgs.where.status;
        return orders.filter((o) => !status || o.status === status).length;
      },
      async groupBy({ by }) {
        assert.deepEqual(by, ['status']);
        const counts = new Map();
        for (const o of orders) counts.set(o.status, (counts.get(o.status) || 0) + 1);
        return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
          .map(([status, n]) => ({ status, _count: { _all: n } }));
      },
      async aggregate({ _sum }) {
        assert.ok(_sum.totalMinor !== undefined);
        return { _sum: { totalMinor: orders.reduce((s, o) => s + (o.totalMinor || 0), 0) } };
      },
      async findMany({ where, include, skip = 0, take } = {}) {
        assert.ok(include && include.items, 'admin order listing must include items');
        const status = where && where.status;
        const copy = orders
          .filter((o) => !status || o.status === status)
          .map((o) => ({ ...o, items: o._itemsSnapshot || [] }));
        copy.sort((a, b) => b.createdAt - a.createdAt);
        return copy.slice(skip, take === undefined || take === null ? undefined : skip + take);
      },
      async findUnique({ where }) {
        const found = orders.find((o) => o.reference === where.reference);
        return found ? { ...found, items: found._itemsSnapshot || [] } : null;
      },
      async updateMany({ where, data }) {
        const found = orders.find((o) => o.reference === where.reference
          && (where.status === undefined || o.status === where.status));
        if (!found) return { count: 0 };
        Object.assign(found, data, { updatedAt: new Date() });
        return { count: 1 };
      },
    },
    product: {
      async count() { return products.length; },
      async findMany({ include } = {}) {
        assert.ok(include && include.sizes, 'admin product listing must include sizes');
        return products.map((p) => ({ ...p }));
      },
    },
  };

  const helpers = {
    addCustomer(email, role = 'customer', passwordHash = null) {
      const id = ++customerSeq;
      const row = { id, email, role, passwordHash, name: null, phone: null, createdAt: new Date(), updatedAt: new Date() };
      customers.set(email, row);
      return row;
    },
    addOrder(over = {}) {
      const seq = orders.length + 1;
      const order = {
        id: seq,
        reference: over.reference || `ZV-20260120-test${seq}`,
        status: over.status || 'pending',
        currency: 'INR',
        subtotalMinor: over.totalMinor ?? 100000,
        totalMinor: over.totalMinor ?? 100000,
        contactEmail: over.contactEmail || 'buyer@example.com',
        contactPhone: null,
        createdAt: over.createdAt || new Date(Date.now() + seq),
        customer: over.customer || null,
        customerId: over.customer ? over.customer.id : null,
        _itemsSnapshot: over._itemsSnapshot || [{
          productId: 'ZV001', productSku: 'ZV001', productName: 'Coat',
          size: 'M', unitPriceMinor: 100000, quantity: 1, lineTotalMinor: 100000,
        }],
      };
      orders.push(order);
      return order;
    },
    addProduct(over = {}) {
      const product = {
        id: over.id || `ZV0${products.length + 1}`, name: over.name || 'Product',
        category: over.category || 'Dresses', gender: over.gender || 'women',
        price: over.price ?? 990, color: 'Black', imageUrl: '', hoverImageUrl: '',
        description: '', available: over.available ?? true,
        sizes: (over.sizes || ['S', 'M']).map((size, position) => ({ size, position })),
      };
      products.push(product);
      return product;
    },
  };

  return { db, helpers, customers };
}

/** Build the app and sign in; returns { app, jar, email } helper. */
async function bootWithUser({ email, password, role = 'customer' } = {}) {
  const harness = buildDbStub();
  const passwordHash = email ? await hashPassword(password) : null;
  if (email) harness.helpers.addCustomer(email, role, passwordHash);

  const app = createApp({
    db: harness.db,
    sessionSecret: 'phase-a-admin-test-secret-32-chars!!',
    requireAuthForOrders: false,
  });
  const jar = {};
  if (email) {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    assert.equal(res.status, 200, 'sign-in should succeed');
    const cookies = res.headers['set-cookie'].map((c) => c.split(';')[0]);
    jar.cookie = cookies.join('; ');
    jar.csrf = cookies.find((c) => c.startsWith('zaevi.csrf='))
      ? decodeURIComponent(cookies.find((c) => c.startsWith('zaevi.csrf=')).split('=').slice(1).join('='))
      : null;
  }
  return { app, jar, harness };
}

const ADMIN = { email: `admin-${Date.now()}@zaevi.test`, password: 'AdminPass123!' };
const CUSTOMER = { email: `cust-${Date.now()}@zaevi.test`, password: 'CustPass12345!' };

test('anonymous requests get 404 on /admin and every /api/admin/* route', async () => {
  const { app } = await bootWithUser({});
  for (const path of ['/admin', '/api/admin/stats', '/api/admin/orders', '/api/admin/products']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 404, `${path} must look nonexistent to anonymous visitors`);
  }
});

test('an ordinary customer session also gets 404 (existence not disclosed)', async () => {
  const { app, jar } = await bootWithUser({ ...CUSTOMER });
  for (const path of ['/admin', '/api/admin/stats', '/api/admin/orders', '/api/admin/products']) {
    const res = await request(app).get(path).set('Cookie', jar.cookie);
    assert.equal(res.status, 404, `${path} must look nonexistent to ordinary customers`);
  }
});

test('/admin.html static access is blocked even WITH a valid session', async () => {
  const { app, jar } = await bootWithUser({ ...ADMIN, role: 'admin' });
  const res = await request(app).get('/admin.html').set('Cookie', jar.cookie);
  assert.equal(res.status, 404);
});

test('an admin session is allowed: page + all read APIs return real stub data', async () => {
  const { app, jar, harness } = await bootWithUser({ ...ADMIN, role: 'admin' });
  harness.helpers.addOrder({ reference: 'ZV-20260120-aaaa', totalMinor: 250900, status: 'pending' });
  harness.helpers.addOrder({ reference: 'ZV-20260121-bbbb', totalMinor: 189900, status: 'pending' });
  harness.helpers.addProduct({ id: 'ZV001', name: 'Nocturne Coat', price: 2509 });

  const page = await request(app).get('/admin').set('Cookie', jar.cookie);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.ok(page.text.includes('ZAEVI'), 'admin shell served');

  const stats = await request(app).get('/api/admin/stats').set('Cookie', jar.cookie);
  assert.equal(stats.status, 200);
  assert.deepEqual(stats.body.data.orders, { total: 2, byStatus: [{ status: 'pending', count: 2 }] });
  assert.deepEqual(stats.body.data.customers, { total: 1 });
  assert.equal(stats.body.data.totalOrderValueMinor, 250900 + 189900, 'sum of actual order totals only');
  assert.equal(stats.body.data.currency, 'INR');
  // rule: never call it revenue
  assert.ok(!JSON.stringify(stats.body).toLowerCase().includes('revenue'));

  const orders = await request(app).get('/api/admin/orders?page=1&limit=1').set('Cookie', jar.cookie);
  assert.equal(orders.status, 200);
  assert.equal(orders.body.data.length, 1);
  assert.equal(orders.body.pagination.total, 2);
  assert.equal(orders.body.pagination.totalPages, 2);
  assert.equal(orders.body.data[0].reference, 'ZV-20260121-bbbb', 'newest first');

  const statusFiltered = await request(app).get('/api/admin/orders?status=pending').set('Cookie', jar.cookie);
  assert.equal(statusFiltered.body.pagination.total, 2);
  const statusEmpty = await request(app).get('/api/admin/orders?status=cancelled').set('Cookie', jar.cookie);
  assert.equal(statusEmpty.body.data.length, 0);

  const detail = await request(app).get('/api/admin/orders/ZV-20260120-aaaa').set('Cookie', jar.cookie);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.totalMinor, 250900);
  assert.equal(detail.body.data.items.length, 1);
  const unknown = await request(app).get('/api/admin/orders/ZV-9999').set('Cookie', jar.cookie);
  assert.equal(unknown.status, 404);

  const products = await request(app).get('/api/admin/products?page=1&limit=10').set('Cookie', jar.cookie);
  assert.equal(products.status, 200);
  assert.equal(products.body.data.length, 1);
  assert.equal(products.body.data[0].id, 'ZV001');
  assert.deepEqual(products.body.data[0].sizes, ['S', 'M'], 'sizes in position order');
  assert.equal(products.body.pagination.total, 1);
});

test('pagination and status filters are validated', async () => {
  const { app, jar } = await bootWithUser({ ...ADMIN, role: 'admin' });
  const cases = [
    '/api/admin/orders?page=0',
    '/api/admin/orders?page=abc',
    '/api/admin/orders?limit=0',
    '/api/admin/orders?limit=51',
    '/api/admin/orders?limit=abc',
    '/api/admin/products?page=-1',
    '/api/admin/products?limit=51',
  ];
  for (const pathAndQuery of cases) {
    const res = await request(app).get(pathAndQuery).set('Cookie', jar.cookie);
    assert.equal(res.status, 400, `${pathAndQuery} must be rejected`);
    assert.ok(res.body.error && res.body.error.message, 'standard error shape');
  }
  const longStatus = await request(app).get('/api/admin/orders?status=' + 'x'.repeat(21)).set('Cookie', jar.cookie);
  assert.equal(longStatus.status, 400);
});

test('no sensitive fields leak through admin responses', async () => {
  const { app, jar, harness } = await bootWithUser({ ...ADMIN, role: 'admin' });
  harness.helpers.addOrder({ reference: 'ZV-20260122-cccc', totalMinor: 99900, status: 'pending' });
  const requests = [
    '/api/admin/stats',
    '/api/admin/orders?page=1&limit=20',
    '/api/admin/orders/ZV-20260122-cccc',
    '/api/admin/products?page=1&limit=20',
  ];
  for (const path of requests) {
    const res = await request(app).get(path).set('Cookie', jar.cookie);
    assert.equal(res.status, 200);
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes('passwordHash'), `${path} must never expose password hashes`);
    assert.ok(!body.includes('zaevi.sid'), `${path} must never expose session identifiers`);
    assert.ok(!body.includes('"role"'), `${path} must never expose the role column value`);
  }
  // Customer identity shown to admins is limited to the approved fields.
  const withCustomer = await request(app)
    .get('/api/admin/orders/ZV-20260122-cccc')
    .set('Cookie', jar.cookie);
  const rows = [withCustomer.body.data];
  for (const order of rows) {
    if (order.customer) {
      assert.deepEqual(
        Object.keys(order.customer).sort(),
        ['createdAt', 'email', 'id', 'name', 'phone']
      );
    }
  }
});

test('an admin advances an order through the full production workflow', async () => {
  const { app, jar, harness } = await bootWithUser({ ...ADMIN, role: 'admin' });
  const reference = 'ZV-20260123-dddd';
  harness.helpers.addOrder({ reference, status: 'pending' });

  const steps = [
    ['confirmed', 'Confirmed'],
    ['in_production', 'In Production'],
    ['quality_check', 'Quality Check'],
    ['packed', 'Packed'],
    ['shipped', 'Shipped'],
    ['delivered', 'Delivered'],
  ];
  for (const [status, label] of steps) {
    const res = await request(app)
      .patch(`/api/admin/orders/${reference}/status`)
      .set('Cookie', jar.cookie)
      .set('x-csrf-token', jar.csrf)
      .send({ status });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, status);
    assert.equal(res.body.data.statusLabel, label);
  }

  const delivered = await request(app)
    .get(`/api/admin/orders/${reference}`)
    .set('Cookie', jar.cookie);
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.data.status, 'delivered');
  assert.deepEqual(delivered.body.data.allowedNextStatuses, [], 'delivered is terminal');

  // Repeating the current status is an idempotent no-op.
  const replay = await request(app)
    .patch(`/api/admin/orders/${reference}/status`)
    .set('Cookie', jar.cookie)
    .set('x-csrf-token', jar.csrf)
    .send({ status: 'delivered' });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.status, 'delivered');
});

test('the workflow rejects skipped stages, unknown statuses and terminal changes', async () => {
  const { app, jar, harness } = await bootWithUser({ ...ADMIN, role: 'admin' });
  const reference = 'ZV-20260124-eeee';
  harness.helpers.addOrder({ reference, status: 'pending' });
  const patch = (body) => request(app)
    .patch(`/api/admin/orders/${reference}/status`)
    .set('Cookie', jar.cookie)
    .set('x-csrf-token', jar.csrf)
    .send(body);

  const skipped = await patch({ status: 'shipped' });
  assert.equal(skipped.status, 409);
  assert.match(skipped.body.error.message, /Allowed next status/);

  const unknown = await patch({ status: 'warehouse' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error.message, /must be one of/);

  const missing = await patch({});
  assert.equal(missing.status, 400);

  const stillPending = await request(app).get(`/api/admin/orders/${reference}`).set('Cookie', jar.cookie);
  assert.equal(stillPending.body.data.status, 'pending', 'rejected changes persist nothing');

  const cancelled = await patch({ status: 'cancelled' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.statusLabel, 'Cancelled');
  assert.deepEqual(cancelled.body.data.allowedNextStatuses, []);
  const afterCancel = await patch({ status: 'confirmed' });
  assert.equal(afterCancel.status, 409, 'cancelled is terminal');
});

test('status writes require admin authorization and a CSRF token', async () => {
  const anon = await bootWithUser({});
  const anonRes = await request(anon.app)
    .patch('/api/admin/orders/ZV-20260125-ffff/status')
    .send({ status: 'confirmed' });
  assert.equal(anonRes.status, 404);

  const customer = await bootWithUser({ ...CUSTOMER });
  customer.harness.helpers.addOrder({ reference: 'ZV-20260125-ffff', status: 'pending' });
  const customerRes = await request(customer.app)
    .patch('/api/admin/orders/ZV-20260125-ffff/status')
    .set('Cookie', customer.jar.cookie)
    .set('x-csrf-token', customer.jar.csrf)
    .send({ status: 'confirmed' });
  assert.equal(customerRes.status, 404);

  const admin = await bootWithUser({ ...ADMIN, role: 'admin' });
  admin.harness.helpers.addOrder({ reference: 'ZV-20260125-ffff', status: 'pending' });
  const noCsrf = await request(admin.app)
    .patch('/api/admin/orders/ZV-20260125-ffff/status')
    .set('Cookie', admin.jar.cookie)
    .send({ status: 'confirmed' });
  assert.equal(noCsrf.status, 403);
  const unchanged = await request(admin.app)
    .get('/api/admin/orders/ZV-20260125-ffff')
    .set('Cookie', admin.jar.cookie);
  assert.equal(unchanged.body.data.status, 'pending');
});

test('the role is resolved from the database on EVERY request (not cached in the session)', async () => {
  const { app, jar, harness } = await bootWithUser({ ...ADMIN, role: 'admin' });
  const first = await request(app).get('/api/admin/stats').set('Cookie', jar.cookie);
  assert.equal(first.status, 200);

  // Demote the admin in the "database" — same session, next request must fail.
  harness.customers.get(ADMIN.email).role = 'customer';
  const second = await request(app).get('/api/admin/stats').set('Cookie', jar.cookie);
  assert.equal(second.status, 404, 'revocation takes effect immediately');
});

test('the CLI validation helpers enforce the same password policy without any database', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const cli = require('../scripts/create-admin.cjs'); // guarded: does NOT auto-run
  assert.ok(cli.isValidEmail('admin@zaevi.test'));
  assert.equal(cli.isValidEmail('not-an-email'), false);
  assert.equal(cli.isValidEmail('x'.repeat(250) + '@zaevi.test'), false, 'email max length enforced');
  assert.equal(cli.validateAdminPassword('short'), 'Password must be at least 12 characters');
  assert.equal(cli.validateAdminPassword('a'.repeat(129)), 'Password must be at most 128 characters');
  assert.equal(cli.validateAdminPassword('Exactly12char'), null);
  // hash verification round trip reuses the project scrypt implementation:
  const h = await hashPassword('Exactly12char');
  assert.ok(await verifyPassword('Exactly12char', h));
  assert.equal(await verifyPassword('WrongExactly12', h), false);
});
