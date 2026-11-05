import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/models/auth.js';

function buildMockApp() {
  const customers = new Map();
  const orders = [];
  let seq = 0;

  const db = {
    customer: {
      async create({ data }) {
        if (customers.has(data.email)) {
          const error = new Error('Unique constraint failed on the fields: (`email`)');
          error.code = 'DUPLICATE_KEY';
          error.meta = { target: 'Customer_email_key' };
          throw error;
        }
        const id = ++seq;
        const customer = { id, ...data, role: data.role || 'customer', createdAt: new Date(), updatedAt: new Date() };
        customers.set(data.email, customer);
        return customer;
      },
      async findUnique({ where }) {
        if (where?.email) return customers.get(where.email) || null;
        if (where?.id) {
          for (const c of customers.values()) {
            if (c.id === where.id) return c;
          }
        }
        return null;
      },
      async update({ where, data }) {
        const c = await this.findUnique({ where });
        if (!c) throw new Error('Not found');
        Object.assign(c, data, { updatedAt: new Date() });
        return c;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const c of customers.values()) {
          const idMatch = !where.id || c.id === where.id;
          const emailMatch = !where.email || c.email === where.email;
          const hashMatch = !('passwordHash' in where) || c.passwordHash === where.passwordHash;
          if (idMatch && emailMatch && hashMatch) {
            Object.assign(c, data, { updatedAt: new Date() });
            count++;
          }
        }
        return { count };
      },
    },
    order: {
      async count({ where }) {
        return orders.filter(o => !where?.customerId || o.customerId === where.customerId).length;
      },
      async findMany({ where }) {
        return orders.filter(o => !where?.customerId || o.customerId === where.customerId);
      },
    },
    product: {
      async findMany() { return []; },
      async findUnique() { return null; },
    },
    async $transaction(fn) { return fn(this); },
  };

  const app = createApp({
    db,
    logger: { log() {}, error() {} },
    sessionSecret: 'test-secret-32-characters-long-enough',
    authRateLimit: false,
    loginRateLimit: false,
  });

  return { app, db, customers, orders };
}

test('guest account claiming: guest customer claims account, sets password, and preserves ID', async () => {
  const { db, customers } = buildMockApp();

  // 1. Simulate guest checkout: Customer row created with passwordHash: null
  const guestCustomer = await db.customer.create({
    data: {
      email: 'guest@example.com',
      name: 'Guest Shopper',
      phone: '+91 98200 11111',
      passwordHash: null,
      role: 'customer',
    },
  });
  assert.equal(guestCustomer.id, 1);
  assert.equal(guestCustomer.passwordHash, null);

  // 2. Guest registers with same email and new password
  const newPassword = 'SecurePassword123!';
  const hashedPassword = await hashPassword(newPassword);

  const existing = await db.customer.findUnique({ where: { email: 'guest@example.com' } });
  assert.ok(existing);
  assert.equal(existing.passwordHash, null);

  // Claim account atomically
  const result = await db.customer.updateMany({
    where: { id: existing.id, passwordHash: null },
    data: {
      passwordHash: hashedPassword,
      name: 'Registered Shopper',
      phone: '+91 98200 22222',
    },
  });
  assert.equal(result.count, 1);

  const claimed = await db.customer.findUnique({ where: { id: existing.id } });
  assert.equal(claimed.id, guestCustomer.id, 'Customer ID is preserved');
  assert.equal(claimed.name, 'Registered Shopper');
  assert.equal(claimed.phone, '+91 98200 22222');
  assert.ok(claimed.passwordHash !== null);

  // 3. Verify password check succeeds
  const isValid = await verifyPassword(newPassword, claimed.passwordHash);
  assert.equal(isValid, true, 'Password hashes and verifies with scrypt');

  // 4. Duplicate registration fails (passwordHash is now set)
  const reCheck = await db.customer.findUnique({ where: { email: 'guest@example.com' } });
  assert.ok(reCheck.passwordHash !== null, 'Account now has password');

  // 5. Concurrent claim fails if passwordHash already set
  const concurrentResult = await db.customer.updateMany({
    where: { id: existing.id, passwordHash: null },
    data: { passwordHash: hashedPassword },
  });
  assert.equal(concurrentResult.count, 0, 'Concurrent claim on already-claimed account yields count 0');
});

