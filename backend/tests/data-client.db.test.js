// Proves on a real MongoDB database that the data client keeps the rules MySQL used to
// enforce: uniqueness, case-insensitive matching, delete rules, foreign keys, rollback and
// races. Skipped when no database is reachable, and refuses any database not named *zaevi_test.
import '../src/config/load-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { resolveDatabaseName } from '../src/config/database.js';
import { DUPLICATE_KEY, FOREIGN_KEY, RECORD_NOT_FOUND } from '../src/db/client.js';
import { getDbClient, disconnectDB } from '../src/db/connect.js';
import { checkOtp, issueOtp, OTP_MAX_ATTEMPTS, OTP_PURPOSES } from '../src/services/email-otp.js';

if (process.env.MONGODB_URI && !resolveDatabaseName().endsWith('zaevi_test')) {
  throw new Error('data-client.db.test.js refuses to run against this database');
}

const silentLogger = { error() {}, warn() {}, info() {}, log() {} };
const SESSION_SECRET = 'data-client-test-secret-of-32-characters';
const suffix = () => crypto.randomBytes(5).toString('hex');
const customerIds = [];

async function connect(t) {
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
    t.skip('MongoDB is not reachable; skipping live database test');
    return null;
  }
}

async function newCustomer(db, overrides = {}) {
  const customer = await db.customer.create({ data: { email: `dc-${suffix()}@zaevi.test`, ...overrides } });
  customerIds.push(customer.id);
  return customer;
}

const orderData = (customerId, overrides = {}) => ({
  reference: `ZV-TEST-${suffix()}`,
  customerId,
  subtotalMinor: 1000,
  totalMinor: 1000,
  contactEmail: 'dc@zaevi.test',
  ...overrides,
});

test.after(async () => {
  try {
    if (customerIds.length) {
      const db = getDbClient();
      const orders = await db.order.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } });
      const orderIds = orders.map((o) => o.id);
      const payments = await db.payment.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
      await db.refund.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
      await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.order.deleteMany({ where: { id: { in: orderIds } } });
      await db.customer.deleteMany({ where: { id: { in: customerIds } } });
    }
  } finally {
    await disconnectDB();
  }
});

test('new records get numeric ids, defaults and null for unset optional fields', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const first = await newCustomer(db);
  const second = await newCustomer(db);
  assert.equal(typeof first.id, 'number');
  assert.equal(second.id > first.id, true);
  assert.equal(first.role, 'customer');
  assert.equal(first.name, null);
  assert.equal(first.passwordHash, null);
  assert.ok(first.createdAt instanceof Date);
  assert.equal('_id' in first, false, 'MongoDB internals never reach the application');
  assert.equal('__v' in first, false);
});

test('unique rules are enforced, without regard to case, as they were', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const email = `case-${suffix()}@zaevi.test`;
  await newCustomer(db, { email });
  await assert.rejects(db.customer.create({ data: { email: email.toUpperCase() } }), (error) => {
    assert.equal(error.code, DUPLICATE_KEY);
    assert.ok(error.meta.target.includes('email'));
    return true;
  });
  const found = await db.customer.findUnique({ where: { email: email.toUpperCase() } });
  assert.equal(found?.email, email, 'lookups ignore case too');
});

test('an optional unique field allows many empty values but no repeated value', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const customer = await newCustomer(db);
  await db.order.create({ data: orderData(customer.id) });
  await db.order.create({ data: orderData(customer.id) });
  const key = `key-${suffix()}`;
  await db.order.create({ data: orderData(customer.id, { idempotencyKey: key }) });
  await assert.rejects(db.order.create({ data: orderData(customer.id, { idempotencyKey: key }) }), (error) => {
    assert.equal(error.code, DUPLICATE_KEY);
    assert.ok(error.meta.target.includes('idempotencyKey'));
    return true;
  });
});

test('MongoDB operators in request data are refused, never executed', async (t) => {
  const db = await connect(t);
  if (!db) return;
  await newCustomer(db);
  await assert.rejects(db.customer.findFirst({ where: { email: { $ne: null } } }), /Unsupported filter/);
  await assert.rejects(db.customer.findFirst({ where: { $where: '1' } }), /Unknown field/);
  await assert.rejects(db.customer.findFirst({ where: { email: { contains: { $ne: '' } } } }), /Invalid value/);
  await assert.rejects(db.customer.updateMany({ where: { id: { $gt: 0 } }, data: { role: 'admin' } }), /Unsupported filter/);

  const app = createApp({ logger: silentLogger, sessionSecret: SESSION_SECRET, loginRateLimit: false, authRateLimit: false });
  const res = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
  assert.equal(res.status, 401);
  const reset = await request(app).post('/api/orders/track').send({ reference: { $ne: null }, email: { $ne: null } });
  assert.ok(reset.status >= 400 && reset.status < 500);
});

test('filters behave as before: not, in, comparisons, OR, text search and relations', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const customer = await newCustomer(db, { name: 'Findable Person' });
  const tag = suffix();
  const paid = await db.order.create({ data: orderData(customer.id, { status: 'confirmed', notes: `note ${tag}` }) });
  const open = await db.order.create({ data: orderData(customer.id, { status: 'pending' }) });
  const mine = { customerId: customer.id };
  const ids = async (where) => (await db.order.findMany({ where: { ...mine, ...where }, orderBy: { id: 'asc' } })).map((o) => o.id);

  assert.deepEqual(await ids({ status: { not: 'pending' } }), [paid.id]);
  assert.deepEqual(await ids({ status: { in: ['pending'] } }), [open.id]);
  assert.deepEqual(await ids({ id: { gt: paid.id } }), [open.id]);
  assert.deepEqual(await ids({ notes: null }), [open.id]);
  assert.deepEqual(await ids({ notes: { not: null } }), [paid.id]);
  assert.deepEqual(await ids({ notes: { not: 'x' } }), [paid.id], 'as in SQL, "not" skips empty values');
  assert.deepEqual(await ids({ OR: [{ status: 'pending' }, { status: 'confirmed' }] }), [paid.id, open.id]);
  assert.deepEqual(await ids({ notes: { contains: tag.toUpperCase() } }), [paid.id], 'text search ignores case');
  assert.deepEqual(await ids({ notes: { contains: '.*' } }), [], 'search text is never treated as a pattern');

  const item = await db.orderItem.create({
    data: { orderId: paid.id, productSku: 'SKU', productName: 'Item', unitPriceMinor: 1, quantity: 1, lineTotalMinor: 1 },
  });
  assert.equal(await db.orderItem.count({ where: { id: item.id, order: { customerId: customer.id, status: { in: ['confirmed'] } } } }), 1);
  assert.equal(await db.orderItem.count({ where: { id: item.id, order: { status: 'pending' } } }), 0);
});

test('include and select return the same shapes the routes rely on', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const customer = await newCustomer(db, { name: 'Shape Tester', passwordHash: 'never-returned-by-select' });
  const order = await db.order.create({
    data: {
      ...orderData(customer.id),
      items: { create: [
        { productSku: 'B', productName: 'B', unitPriceMinor: 1, quantity: 1, lineTotalMinor: 1 },
        { productSku: 'A', productName: 'A', unitPriceMinor: 2, quantity: 2, lineTotalMinor: 4 },
      ] },
      statusHistory: { create: [{ newStatus: 'pending', note: 'first' }] },
    },
    include: { items: { orderBy: { productSku: 'asc' } }, customer: { select: { email: true } }, statusHistory: true, cancellationRequest: true, coupon: true },
  });
  assert.deepEqual(order.items.map((i) => i.productSku), ['A', 'B']);
  assert.equal(order.items[0].orderId, order.id);
  assert.deepEqual(order.customer, { email: customer.email });
  assert.equal(order.statusHistory.length, 1);
  assert.equal(order.cancellationRequest, null);
  assert.equal(order.coupon, null);

  const selected = await db.order.findUnique({ where: { reference: order.reference }, select: { id: true, customer: { select: { name: true } } } });
  assert.deepEqual(selected, { id: order.id, customer: { name: 'Shape Tester' } });
  const limited = await db.order.findUnique({ where: { id: order.id }, include: { items: { orderBy: { productSku: 'desc' }, take: 1 } } });
  assert.deepEqual(limited.items.map((i) => i.productSku), ['B']);

  const size = await db.productSize.findFirst({ where: { productId: 'ZV001' } });
  assert.equal('stock' in size, false, 'the retired stock field stays hidden');
});

test('updates: counters, conditional updates, missing records and bad references', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const customer = await newCustomer(db);
  const order = await db.order.create({ data: orderData(customer.id) });
  const before = order.updatedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const updated = await db.order.update({ where: { id: order.id }, data: { discountMinor: { increment: 5 } } });
  assert.equal(updated.discountMinor, 5);
  assert.ok(updated.updatedAt > before, 'the updated time moves');

  const won = await db.order.updateMany({ where: { id: order.id, status: 'pending' }, data: { status: 'confirmed' } });
  assert.equal(won.count, 1);
  const lost = await db.order.updateMany({ where: { id: order.id, status: 'pending' }, data: { status: 'cancelled' } });
  assert.equal(lost.count, 0);

  await assert.rejects(db.order.update({ where: { id: 987654321 }, data: { notes: 'x' } }), (e) => e.code === RECORD_NOT_FOUND);
  await assert.rejects(db.order.delete({ where: { id: 987654321 } }), (e) => e.code === RECORD_NOT_FOUND);
  await assert.rejects(db.order.create({ data: orderData(987654321) }), (e) => e.code === FOREIGN_KEY);
  await assert.rejects(db.order.update({ where: { id: order.id }, data: { customerId: 987654321 } }), (e) => e.code === FOREIGN_KEY);
});

test('field rules still apply: length, negative amounts and required values', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const customer = await newCustomer(db);
  await assert.rejects(db.order.create({ data: orderData(customer.id, { notes: 'x'.repeat(501) }) }));
  await assert.rejects(db.order.create({ data: orderData(customer.id, { totalMinor: -1 }) }));
  await assert.rejects(db.order.create({ data: { reference: `ZV-TEST-${suffix()}`, subtotalMinor: 1 } }));
  await assert.rejects(db.order.create({ data: orderData(customer.id, { madeUpField: 1 }) }), /Unknown field/);
  const order = await db.order.create({ data: orderData(customer.id) });
  await assert.rejects(db.order.update({ where: { id: order.id }, data: { notes: 'x'.repeat(501) } }));
});

test('delete rules: cascade, clear the link, or refuse, as the foreign keys did', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const customer = await newCustomer(db);
  const address = await db.address.create({
    data: { customerId: customer.id, fullName: 'A', phone: '9876543210', addressLine1: 'L', city: 'C', state: 'S', postalCode: '110001' },
  });
  const order = await db.order.create({
    data: {
      ...orderData(customer.id),
      items: { create: [{ productSku: 'S', productName: 'N', unitPriceMinor: 1, quantity: 1, lineTotalMinor: 1 }] },
    },
    include: { items: true },
  });
  const payment = await db.payment.create({ data: { orderId: order.id, amountMinor: 100 } });

  await assert.rejects(db.order.delete({ where: { id: order.id } }), (e) => e.code === FOREIGN_KEY, 'an order with a payment cannot go');
  assert.ok(await db.order.findUnique({ where: { id: order.id } }), 'nothing changed');

  await db.customer.delete({ where: { id: customer.id } });
  assert.equal(await db.address.findUnique({ where: { id: address.id } }), null, 'addresses go with the customer');
  const kept = await db.order.findUnique({ where: { id: order.id } });
  assert.equal(kept.customerId, null, 'orders stay, with the link cleared');

  await db.payment.delete({ where: { id: payment.id } });
  await db.order.delete({ where: { id: order.id } });
  assert.equal(await db.orderItem.count({ where: { orderId: order.id } }), 0, 'items go with the order');
});

test('a failed transaction leaves nothing behind', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const email = `rollback-${suffix()}@zaevi.test`;
  const marker = new Error('roll back');
  await assert.rejects(db.$transaction(async (tx) => {
    const customer = await tx.customer.create({ data: { email } });
    await tx.order.create({ data: orderData(customer.id) });
    assert.ok(await tx.customer.findUnique({ where: { email } }), 'visible inside the transaction');
    assert.equal(await db.customer.findUnique({ where: { email } }), null, 'invisible outside it');
    throw marker;
  }), (error) => error === marker);
  assert.equal(await db.customer.findUnique({ where: { email } }), null);
});

test('counting and grouping', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const customer = await newCustomer(db);
  await db.order.create({ data: orderData(customer.id, { totalMinor: 100 }) });
  await db.order.create({ data: orderData(customer.id, { totalMinor: 250, status: 'confirmed' }) });
  const where = { customerId: customer.id };
  assert.equal(await db.order.count({ where }), 2);
  assert.equal((await db.order.aggregate({ where, _sum: { totalMinor: true } }))._sum.totalMinor, 350);
  assert.equal((await db.order.aggregate({ where: { customerId: 987654321 }, _sum: { totalMinor: true } }))._sum.totalMinor, null);
  const groups = await db.order.groupBy({ by: ['status'], where, _count: { _all: true }, orderBy: { status: 'asc' } });
  assert.deepEqual(groups, [{ status: 'confirmed', _count: { _all: 1 } }, { status: 'pending', _count: { _all: 1 } }]);
});

// ---- Races on the real database -------------------------------------------------------

const app = () => createApp({ logger: silentLogger, sessionSecret: SESSION_SECRET, orderRateLimit: false, loginRateLimit: false, authRateLimit: false });

const orderBody = (email, extra = {}) => ({
  email,
  phone: '9876543210',
  shippingName: 'Race Tester',
  shippingAddress: '12 Silk Lane',
  shippingCity: 'Mumbai',
  shippingPostalCode: '400001',
  shippingCountry: 'IN',
  items: [{ productId: 'ZV001', size: 'S', quantity: 1 }],
  ...extra,
});

async function cleanGuests(db, emails) {
  const customers = await db.customer.findMany({ where: { email: { in: emails } }, select: { id: true } });
  customerIds.push(...customers.map((c) => c.id));
}

test('race: parallel orders with one key create exactly one order', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const server = app();
  const email = `race-${suffix()}@zaevi.test`;
  const key = `race-key-${suffix()}`;
  const results = await Promise.all(Array.from({ length: 6 }, () => request(server).post('/api/orders').set('Idempotency-Key', key).send(orderBody(email))));
  await cleanGuests(db, [email]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses.filter((s) => s >= 300), [], `unexpected: ${statuses}`);
  assert.equal(statuses.filter((s) => s === 201).length >= 1, true);
  assert.equal(new Set(results.map((r) => r.body.data.reference)).size, 1, 'every caller gets the same order');
  assert.equal(await db.order.count({ where: { contactEmail: email } }), 1);
});

test('race: a coupon limited to one use is used exactly once', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const server = app();
  const code = `RACE${suffix().toUpperCase()}`;
  const coupon = await db.coupon.create({ data: { code, discountValue: 10, usageLimit: 1 } });
  const emails = Array.from({ length: 6 }, () => `race-${suffix()}@zaevi.test`);
  try {
    const results = await Promise.all(emails.map((email) => request(server).post('/api/orders').set('Idempotency-Key', `race-key-${suffix()}`).send(orderBody(email, { couponCode: code }))));
    await cleanGuests(db, emails);
    assert.equal(results.filter((r) => r.status === 201).length, 1, `statuses: ${results.map((r) => r.status)}`);
    assert.equal(results.filter((r) => r.status === 400).length, emails.length - 1);
    const stored = await db.coupon.findUnique({ where: { id: coupon.id } });
    assert.equal(stored.usedCount, 1);
    assert.equal(await db.couponUsage.count({ where: { couponId: coupon.id } }), 1);
    assert.equal(await db.order.count({ where: { contactEmail: { in: emails } } }), 1, 'the losers left no order behind');
  } finally {
    await db.coupon.delete({ where: { id: coupon.id } });
  }
});

test('race: code guesses at the same moment cannot exceed the limit', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const customer = await newCustomer(db);
  let code = null;
  const { challenge } = await issueOtp(db, { customerId: customer.id, email: customer.email, purpose: OTP_PURPOSES.LOGIN }, {
    deliver: async (message) => { code = message.code; },
  });
  const wrong = code === '000000' ? '000001' : '000000';
  await Promise.all(Array.from({ length: OTP_MAX_ATTEMPTS * 2 }, () => checkOtp(db, { challenge, code: wrong, purposes: [OTP_PURPOSES.LOGIN] })));
  const row = await db.emailOtp.findFirst({ where: { customerId: customer.id } });
  assert.equal(row.attempts, OTP_MAX_ATTEMPTS);
  const late = await checkOtp(db, { challenge, code, purposes: [OTP_PURPOSES.LOGIN] });
  assert.equal(late.status, 'invalid', 'the right code no longer works');
});

test('race: a code cannot be used twice at the same moment', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const customer = await newCustomer(db);
  let code = null;
  const { challenge } = await issueOtp(db, { customerId: customer.id, email: customer.email, purpose: OTP_PURPOSES.LOGIN }, {
    deliver: async (message) => { code = message.code; },
  });
  const results = await Promise.all([1, 2, 3].map(() => checkOtp(db, { challenge, code, purposes: [OTP_PURPOSES.LOGIN] })));
  assert.equal(results.filter((r) => r.status === 'ok').length, 1);
});

test('race: guest checkouts sharing one email share one customer', async (t) => {
  const db = await connect(t);
  if (!db) return;
  const server = app();
  const email = `race-${suffix()}@zaevi.test`;
  const results = await Promise.all(Array.from({ length: 4 }, () => request(server).post('/api/orders').set('Idempotency-Key', `race-key-${suffix()}`).send(orderBody(email))));
  await cleanGuests(db, [email]);
  assert.deepEqual(results.map((r) => r.status), [201, 201, 201, 201]);
  assert.equal(await db.customer.count({ where: { email } }), 1);
  assert.equal(await db.order.count({ where: { contactEmail: email } }), 4);
});
