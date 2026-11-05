/**
 * Cancellation, return and replacement requests, through the same routes the
 * account page calls, with a real signed-in session and CSRF token.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { hashPassword } from '../src/models/auth.js';

const silentLogger = { error() {}, warn() {}, info() {}, log() {} };
const SESSION_SECRET = 'test-session-secret-at-least-32-characters';
const EMAIL = 'requests@example.com';
const PASSWORD = 'securepassword123';
const DAY_MS = 24 * 60 * 60 * 1000;

async function build({ status = 'delivered', deliveredDaysAgo = 1 } = {}) {
  const customer = { id: 1, email: EMAIL, name: 'Test', role: 'customer', passwordHash: await hashPassword(PASSWORD) };
  const order = { id: 7, reference: 'ZV-TEST-1', customerId: 1, status, items: [{ id: 70, quantity: 2 }] };
  const stored = { cancellation: null, returns: [], replacements: [] };
  const prisma = {
    stored,
    order,
    customer: {
      findUnique: async ({ where }) => (where.email === EMAIL || where.id === 1 ? customer : null),
      update: async () => customer,
    },
    orderStatusHistory: {
      findFirst: async () => ({ createdAt: new Date(Date.now() - deliveredDaysAgo * DAY_MS) }),
      create: async ({ data }) => data,
    },
    cancellationRequest: {
      findUnique: async () => stored.cancellation,
      create: async ({ data }) => { stored.cancellation = data; return data; },
    },
    returnRequest: {
      findMany: async () => stored.returns,
      create: async ({ data }) => {
        const row = { ...data, status: 'pending', items: data.items.create };
        stored.returns.push(row);
        return row;
      },
    },
    replacementRequest: {
      findMany: async () => stored.replacements,
      create: async ({ data }) => {
        const row = { ...data, status: 'pending', items: data.items.create };
        stored.replacements.push(row);
        return row;
      },
    },
    $transaction: async (fn) => fn(prisma),
  };
  prisma.order = {
    findFirst: async ({ where }) => (where.reference === order.reference && where.customerId === 1 ? order : null),
    updateMany: async ({ data }) => { Object.assign(order, data); return { count: 1 }; },
  };
  const app = createApp({ prisma, logger: silentLogger, sessionSecret: SESSION_SECRET, authRateLimit: false, loginRateLimit: false });
  const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
  assert.equal(login.status, 200);
  const cookies = login.headers['set-cookie'];
  const csrf = cookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('zaevi.csrf=')).slice('zaevi.csrf='.length);
  const post = (path, body) => request(app)
    .post(`/api/customer/orders/ZV-TEST-1/${path}`)
    .set('Cookie', cookies.map((c) => c.split(';')[0]).join('; '))
    .set('x-csrf-token', decodeURIComponent(csrf))
    .send(body);
  return { post, stored, order };
}

const oneItem = { reason: 'Too big', items: [{ orderItemId: 70, quantity: 1 }] };

test('cancel: an order being made creates a request for the team to answer', async () => {
  const { post, stored, order } = await build({ status: 'confirmed' });
  const res = await post('cancel', { reason: 'Changed my mind' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.direct, false);
  assert.equal(stored.cancellation.status, 'pending');
  assert.equal(stored.cancellation.reason, 'Changed my mind');
  assert.equal(stored.cancellation.requesterEmail, EMAIL);
  assert.equal(order.status, 'confirmed');
});

test('cancel: an order not yet confirmed is cancelled straight away', async () => {
  const { post, stored, order } = await build({ status: 'pending' });
  const res = await post('cancel', {});
  assert.equal(res.status, 201);
  assert.equal(res.body.data.direct, true);
  assert.equal(order.status, 'cancelled');
  assert.equal(stored.cancellation.status, 'approved');
});

test('cancel: repeats and shipped orders get a clear answer instead of a server error', async () => {
  const first = await build({ status: 'confirmed' });
  await first.post('cancel', {});
  const again = await first.post('cancel', {});
  assert.equal(again.status, 409);
  assert.match(again.body.error.message, /already pending/);

  first.stored.cancellation.status = 'rejected';
  const afterDecision = await first.post('cancel', {});
  assert.equal(afterDecision.status, 409);
  assert.match(afterDecision.body.error.message, /already answered/);

  const shipped = await build({ status: 'shipped' });
  assert.equal((await shipped.post('cancel', {})).status, 400);
});

test('return: a delivered order creates a request', async () => {
  const { post, stored } = await build();
  const res = await post('return', oneItem);
  assert.equal(res.status, 201);
  assert.equal(stored.returns.length, 1);
  assert.deepEqual(stored.returns[0].items, [{ orderItemId: 70, quantity: 1 }]);
});

test('replacement: a delivered order creates a request', async () => {
  const { post, stored } = await build();
  const res = await post('replacement', oneItem);
  assert.equal(res.status, 201);
  assert.equal(stored.replacements.length, 1);
});

test('return and replacement: refused before delivery and after 14 days', async () => {
  for (const path of ['return', 'replacement']) {
    const early = await build({ status: 'shipped' });
    assert.equal((await early.post(path, oneItem)).status, 400);
    const late = await build({ deliveredDaysAgo: 15 });
    const res = await late.post(path, oneItem);
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /14-day return period/);
  }
});

test('return and replacement: cannot exceed what was ordered, across both kinds of request', async () => {
  const { post } = await build();
  assert.equal((await post('return', { reason: 'x', items: [{ orderItemId: 70, quantity: 3 }] })).status, 400);
  assert.equal((await post('return', oneItem)).status, 201);
  assert.equal((await post('replacement', oneItem)).status, 201);
  assert.equal((await post('return', oneItem)).status, 400);
  assert.equal((await post('return', { reason: 'x', items: [{ orderItemId: 999, quantity: 1 }] })).status, 400);
});

test('requests need the CSRF token', async () => {
  const { post } = await build();
  const res = await post('return', oneItem).set('x-csrf-token', 'wrong');
  assert.equal(res.status, 403);
});
