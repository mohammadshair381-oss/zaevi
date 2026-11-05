import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

// Live-database (zaevi_test ONLY) integration test for the production workflow.
// Skipped (never failed) when MONGODB_URI is unset or the database is unreachable.
//
// STRICT TARGET RULE: refuses to run against anything but zaevi_test. No schema
// change is required: all workflow values fit the existing VARCHAR(20) status
// column and historical `pending` rows keep their value.
import '../src/config/load-env.js';

import { createApp, frontendRoot } from '../src/app.js';
import { resolveDatabaseName } from '../src/config/database.js';
import { getDbClient, disconnectDB } from '../src/db/connect.js';
import { hashPassword } from '../src/models/auth.js';

// Live tests only ever run on a database whose name ends in zaevi_test.
if (process.env.MONGODB_URI && !resolveDatabaseName().endsWith('zaevi_test')) {
  throw new Error('admin-order-status.db.test.js refuses to run against this database');
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

test('zaevi_test: production status advances and persists without any stock column', async (t) => {
  const db = await connectOrSkip(t);
  if (!db) return;

  const suffix = uniqueSuffix();
  const adminEmail = `zv-workflow-${suffix}@zaevi.test`;
  const adminPassword = 'WorkflowAdmin123!';
  const reference = `ZV-20261020-${suffix.padEnd(16, '0').slice(0, 16)}`;

  const app = createApp({
    sessionSecret: 'zaevi-test-production-workflow-secret',
    requireAuthForOrders: false,
    root: frontendRoot,
  });

  try {
    await db.customer.create({
      data: {
        email: adminEmail,
        name: 'Workflow Admin',
        passwordHash: await hashPassword(adminPassword),
        role: 'admin',
      },
    });

    const fixture = await db.order.create({
      data: {
        reference,
        idempotencyKey: `workflow-${suffix}`,
        idempotencyHash: null,
        status: 'pending',
        currency: 'INR',
        subtotalMinor: 1890000,
        totalMinor: 1890000,
        contactEmail: `workflow-buyer-${suffix}@zaevi.test`,
        contactPhone: null,
        shippingName: 'Workflow Buyer',
        shippingAddress: '1 Atelier Lane',
        shippingCity: 'Mumbai',
        shippingPostalCode: '400001',
        shippingCountry: 'IN',
        items: {
          create: [{
            productSku: 'ZV001',
            productName: 'Aurelia Silk Dress',
            size: 'S',
            unitPriceMinor: 1890000,
            quantity: 1,
            lineTotalMinor: 1890000,
          }],
        },
      },
      include: { items: true },
    });

    const login = await request(app).post('/api/auth/login').send({ email: adminEmail, password: adminPassword });
    assert.equal(login.status, 200);
    const cookies = login.headers['set-cookie'].map((c) => c.split(';')[0]);
    const cookie = cookies.join('; ');
    const csrf = cookies.find((c) => c.startsWith('zaevi.csrf=')).split('=').slice(1).join('=');

    // The existing pending order is presented as "Order Received".
    const initial = await request(app).get(`/api/admin/orders/${reference}`).set('Cookie', cookie);
    assert.equal(initial.status, 200);
    assert.equal(initial.body.data.status, 'pending');
    assert.equal(initial.body.data.statusLabel, 'Order Received');

    // Missing CSRF changes nothing.
    const noCsrf = await request(app)
      .patch(`/api/admin/orders/${reference}/status`)
      .set('Cookie', cookie)
      .send({ status: 'confirmed' });
    assert.equal(noCsrf.status, 403);
    assert.equal((await db.order.findUnique({ where: { reference } })).status, 'pending');

    // Stage skipping is rejected.
    const skipped = await request(app)
      .patch(`/api/admin/orders/${reference}/status`)
      .set('Cookie', cookie).set('x-csrf-token', csrf)
      .send({ status: 'packed' });
    assert.equal(skipped.status, 409);

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
        .set('Cookie', cookie).set('x-csrf-token', csrf)
        .send({ status });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.status, status);
      assert.equal(res.body.data.statusLabel, label);
    }

    const persisted = await db.order.findUnique({ where: { reference } });
    assert.equal(persisted.status, 'delivered');
    assert.equal(persisted.totalMinor, 1890000, 'order data untouched by status changes');
    assert.equal(fixture.items.length, 1);
  } finally {
    await db.order.deleteMany({ where: { reference } });
    await db.customer.deleteMany({ where: { email: adminEmail } });
    await disconnectDB();
  }
});
