import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

// Live-database (zaevi_test ONLY) integration tests for the Phase A admin
// surface. Skipped (never failed) when MONGODB_URI is unset or the database is
// unreachable, matching the other *.db.test.js files.
//
// STRICT TARGET RULE: if MONGODB_URI is set to anything other than
// zaevi_test this file REFUSES to run rather than silently touching the
// live database. Every row it creates is removed in `finally`.
import 'dotenv/config';

import { createApp, projectRoot } from '../src/app.js';
import { resolveDatabaseName } from '../src/config/database.js';
import { getDbClient, disconnectDB } from '../src/db/connect.js';
import { hashPassword } from '../src/models/auth.js';

// Live tests only ever run on a database whose name ends in zaevi_test.
if (process.env.MONGODB_URI && !resolveDatabaseName().endsWith('zaevi_test')) {
  throw new Error('admin-api.db.test.js refuses to run against this database');
}


function uniqueSuffix() {
  return randomBytes(6).toString('hex');
}

async function connectOrSkip(t) {
  if (!process.env.MONGODB_URI) {
    t.skip('MONGODB_URI is not set; skipping live database test');
    return null;
  }
  const db = getDbClient();
  try {
    await db.$ping();
    return db;
  } catch (error) {
    t.diagnostic(`database unavailable: ${error.message}`);
    t.skip('the database is not reachable; skipping live database test');
    return null;
  }
}

test('zaevi_test: admin session sees real, database-derived data; ordinary customer does not', async (t) => {
  const db = await connectOrSkip(t);
  if (!db) return;

  const suffix = uniqueSuffix();
  const adminEmail = `zv-admin-${suffix}@zaevi.test`;
  const custEmail = `zv-cust-${suffix}@zaevi.test`;
  const adminPassword = 'AdminLive123!';
  const custPassword = 'CustomerLive123!';

  const app = createApp({
    sessionSecret: 'zaevi-test-admin-integration-secret',
    requireAuthForOrders: false,
    root: projectRoot,
  });

  try {
    // Seed directly with the real client (bypasses the register rate limiter;
    // the ordinary customer relies on the schema default role = 'customer').
    await db.customer.create({
      data: {
        email: adminEmail,
        name: 'Integration Admin',
        passwordHash: await hashPassword(adminPassword),
        role: 'admin',
      },
    });
    const cust = await db.customer.create({
      data: { email: custEmail, name: 'Integration Customer', passwordHash: await hashPassword(custPassword) },
    });
    assert.equal(cust.role, 'customer', 'schema default role applies to new customers');

    const login = async (email, password) => {
      const res = await request(app).post('/api/auth/login').send({ email, password });
      assert.equal(res.status, 200, `login for ${email} should succeed`);
      const parts = res.headers['set-cookie'].map((c) => c.split(';')[0]);
      return {
        cookie: parts.join('; '),
        csrf: parts.find((c) => c.startsWith('zaevi.csrf='))?.split('=')[1] ?? null,
      };
    };

    const admin = await login(adminEmail, adminPassword);
    const customer = await login(custEmail, custPassword);

    // ---- Ordinary customer is fully denied with 404 ------------------------
    for (const path of ['/admin', '/api/admin/stats', '/api/admin/orders', '/api/admin/products', '/admin.html']) {
      const res = await request(app).get(path).set('Cookie', customer.cookie);
      assert.equal(res.status, 404, `${path} must be 404 for an ordinary customer`);
    }

    // ---- Admin page + static behavior --------------------------------------
    const page = await request(app).get('/admin').set('Cookie', admin.cookie);
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.ok(page.text.includes('TOTAL ORDER VALUE'), 'dashboard labels order value, not revenue');

    const directStatic = await request(app).get('/admin.html').set('Cookie', admin.cookie);
    assert.equal(directStatic.status, 404, '/admin.html must stay blocked even for admins');

    // ---- Stats match database-derived expectations computed independently ---
    const [expectedOrders, expectedCustomers, expectedStatus, expectedValue] = await Promise.all([
      db.order.count(),
      db.customer.count(),
      db.order.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db.order.aggregate({ _sum: { totalMinor: true } }),
    ]);
    const stats = await request(app).get('/api/admin/stats').set('Cookie', admin.cookie);
    assert.equal(stats.status, 200);
    assert.deepEqual(stats.body.data.orders, {
      total: expectedOrders,
      byStatus: expectedStatus.map((r) => ({ status: r.status, count: r._count._all })),
    });
    assert.equal(stats.body.data.customers.total, expectedCustomers);
    assert.equal(stats.body.data.totalOrderValueMinor, expectedValue._sum.totalMinor ?? 0);
    assert.ok(!JSON.stringify(stats.body).toLowerCase().includes('revenue'));
    assert.ok(!JSON.stringify(stats.body).includes('low'), 'no stock/low-stock widget fields');

    // ---- Orders list + detail ----------------------------------------------
    const orders = await request(app).get('/api/admin/orders?page=1&limit=5').set('Cookie', admin.cookie);
    assert.equal(orders.status, 200);
    assert.ok(orders.body.data.length <= 5);
    // A newly installed database has no orders yet.
    const known = orders.body.data[0];
    if (known) {
      assert.equal(known.items.length >= 1, true);
      assert.ok(typeof known.totalMinor === 'number', 'money in integer paise');
      const detail = await request(app).get(`/api/admin/orders/${encodeURIComponent(known.reference)}`).set('Cookie', admin.cookie);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.data.reference, known.reference);
    }
    // no password hashes / session ids anywhere in the payload
    const blob = JSON.stringify(orders.body);
    assert.ok(!blob.includes('passwordHash'));
    assert.ok(!blob.includes('zaevi.sid'));

    const unknown = await request(app).get('/api/admin/orders/ZV-NOT-REAL').set('Cookie', admin.cookie);
    assert.equal(unknown.status, 404);

    // ---- Products ------------------------------------------------------------
    const products = await request(app).get('/api/admin/products?page=1&limit=50').set('Cookie', admin.cookie);
    assert.equal(products.status, 200);
    assert.ok(products.body.pagination.total >= 1);
    const first = products.body.data[0];
    assert.ok(Array.isArray(first.sizes), 'sizes included');
    assert.ok(typeof first.price === 'number');
  } finally {
    await db.customer.deleteMany({ where: { email: { in: [adminEmail, custEmail] } } });
    await disconnectDB();
  }
});
