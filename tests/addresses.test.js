import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';

// Saved delivery addresses are account-scoped: every read and write is keyed
// off the server session, never a client-supplied customer id. These tests
// cover auth gating, ownership isolation, validation, the default-address
// rule and CSRF protection.

function createFakePrisma() {
  const customers = new Map();
  const addresses = [];
  let customerSeq = 0;
  let addressSeq = 0;

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

  function matches(row, where) {
    if (!where) return true;
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.customerId !== undefined && row.customerId !== where.customerId) return false;
    if (where.isDefault !== undefined && row.isDefault !== where.isDefault) return false;
    return true;
  }

  const addressModel = {
    async findMany({ where }) {
      return addresses
        .filter((a) => matches(a, where))
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.createdAt - a.createdAt);
    },
    async findFirst({ where }) {
      // `where.id` may be { not: n } for the updateMany-ish filters; handle both.
      if (where && where.id && typeof where.id === 'object' && 'not' in where.id) {
        return addresses.find((a) => a.id !== where.id.not && matches(a, { ...where, id: undefined })) || null;
      }
      return addresses.find((a) => matches(a, where)) || null;
    },
    async create({ data }) {
      const row = {
        id: ++addressSeq,
        country: 'IN',
        isDefault: false,
        ...data,
        createdAt: new Date(Date.now() + addressSeq),
        updatedAt: new Date(),
      };
      addresses.push(row);
      return row;
    },
    async update({ where, data }) {
      const row = addresses.find((a) => a.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async updateMany({ where, data }) {
      let count = 0;
      for (const row of addresses) {
        let ok = true;
        if (where?.customerId !== undefined && row.customerId !== where.customerId) ok = false;
        if (where?.isDefault !== undefined && row.isDefault !== where.isDefault) ok = false;
        if (where?.id && typeof where.id === 'object' && 'not' in where.id && row.id === where.id.not) ok = false;
        if (ok) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
    async delete({ where }) {
      const index = addresses.findIndex((a) => a.id === where.id);
      return addresses.splice(index, 1)[0];
    },
  };

  return {
    customer: customerModel,
    address: addressModel,
    order: {
      async count() { return 0; },
      async findMany() { return []; },
      async findUnique() { return null; },
    },
    product: {
      async findMany() { return []; },
      async findUnique() { return null; },
    },
    async $transaction(arg) {
      if (Array.isArray(arg)) return Promise.all(arg);
      if (typeof arg === 'function') return arg(this);
      throw new Error('Unsupported transaction form');
    },
    __addresses: addresses,
    __customers: customers,
  };
}

function buildApp() {
  const prisma = createFakePrisma();
  const app = createApp({
    prisma,
    logger: { log() {}, error() {} },
    sessionSecret: 'test-secret-32-characters-long-enough',
    authRateLimit: false,
    loginRateLimit: false,
    orderRateLimit: false,
  });
  return { app, prisma };
}

function validAddress(overrides = {}) {
  return {
    fullName: 'Ishan Rao',
    phone: '+91 98200 11111',
    addressLine1: '12 Marine Drive',
    addressLine2: 'Apartment 4B',
    landmark: 'Near the promenade',
    locality: 'Churchgate',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400020',
    country: 'IN',
    label: 'Home',
    isDefault: false,
    ...overrides,
  };
}

/** Register + log in a fresh customer, returning its session + CSRF token. */
async function login(app, email) {
  const creds = { email, password: 'securepassword123' };
  const register = await request(app)
    .post('/api/auth/register')
    .send({ ...creds, name: 'Test Customer', phone: '+91 98200 00000' });
  assert.equal(register.status, 201);

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
  assert.ok(jar['zaevi.sid'], 'login sets the session cookie');
  assert.ok(csrf, 'login sets the CSRF cookie');
  return {
    cookieHeader: Object.entries(jar).map(([n, v]) => `${n}=${v}`).join('; '),
    csrf,
    customerId: register.body.data.id,
  };
}

test('GET /api/customer/addresses without a session is rejected', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/api/customer/addresses');
  assert.equal(res.status, 401);
});

test('POST /api/customer/addresses without a session creates nothing', async () => {
  const { app, prisma } = buildApp();
  const res = await request(app).post('/api/customer/addresses').send(validAddress());
  assert.equal(res.status, 401);
  assert.equal(prisma.__addresses.length, 0);
});

test('middleware rejects unauthenticated PATCH, DELETE and default toggles', async () => {
  const { app } = buildApp();
  const patch = await request(app).patch('/api/customer/addresses/1').send(validAddress());
  const del = await request(app).delete('/api/customer/addresses/1');
  const def = await request(app).post('/api/customer/addresses/1/default');
  assert.equal(patch.status, 401);
  assert.equal(del.status, 401);
  assert.equal(def.status, 401);
});

test('a signed-in customer can create, list, update and delete an address', async () => {
  const { app, prisma } = buildApp();
  const session = await login(app, 'owner@example.com');

  const created = await request(app)
    .post('/api/customer/addresses')
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrf)
    .send(validAddress());
  assert.equal(created.status, 201);
  assert.equal(created.body.data.customerId, session.customerId, 'owned by the session customer');
  assert.equal(created.body.data.fullName, 'Ishan Rao');
  assert.equal(created.body.data.isDefault, false);
  const id = created.body.data.id;
  assert.ok(id);

  const list = await request(app).get('/api/customer/addresses').set('Cookie', session.cookieHeader);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].id, id);

  const updated = await request(app)
    .patch(`/api/customer/addresses/${id}`)
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrf)
    .send({ city: 'Pune', postalCode: '411001' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.city, 'Pune');
  assert.equal(updated.body.data.postalCode, '411001');
  assert.equal(updated.body.data.addressLine1, '12 Marine Drive', 'unspecified fields are preserved');

  const removed = await request(app)
    .delete(`/api/customer/addresses/${id}`)
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrf);
  assert.equal(removed.status, 200);
  assert.equal(prisma.__addresses.length, 0);
});

test('the client-supplied customerId is ignored; the session owns the address', async () => {
  const { app, prisma } = buildApp();
  const session = await login(app, 'spoof@example.com');
  const res = await request(app)
    .post('/api/customer/addresses')
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrf)
    .send(validAddress({ customerId: 9999 }));
  assert.equal(res.status, 201);
  assert.equal(res.body.data.customerId, session.customerId);
  assert.equal(prisma.__addresses[0].customerId, session.customerId);
});

test('setting a default unsets the previous default for the same customer only', async () => {
  const { app, prisma } = buildApp();
  const session = await login(app, 'defaults@example.com');
  const auth = (req) => req.set('Cookie', session.cookieHeader).set('x-csrf-token', session.csrf);

  const first = await auth(request(app).post('/api/customer/addresses')).send(validAddress({ isDefault: true }));
  const second = await auth(request(app).post('/api/customer/addresses')).send(validAddress({ label: 'Work', isDefault: true }));
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const rows = prisma.__addresses.filter((a) => a.customerId === session.customerId);
  assert.equal(rows.filter((a) => a.isDefault).length, 1, 'exactly one default per customer');
  assert.equal(rows.find((a) => a.isDefault).id, second.body.data.id);

  const toggled = await auth(request(app).post(`/api/customer/addresses/${first.body.data.id}/default`)).send({});
  assert.equal(toggled.status, 200);
  const after = prisma.__addresses.filter((a) => a.customerId === session.customerId);
  assert.equal(after.filter((a) => a.isDefault).length, 1);
  assert.equal(after.find((a) => a.isDefault).id, first.body.data.id);
});

test('another customer cannot read, update, delete or default a foreign address', async () => {
  const { app, prisma } = buildApp();
  const owner = await login(app, 'owner2@example.com');
  const intruder = await login(app, 'intruder@example.com');

  const created = await request(app)
    .post('/api/customer/addresses')
    .set('Cookie', owner.cookieHeader)
    .set('x-csrf-token', owner.csrf)
    .send(validAddress({ fullName: 'Owner Only' }));
  assert.equal(created.status, 201);
  const id = created.body.data.id;

  const list = await request(app).get('/api/customer/addresses').set('Cookie', intruder.cookieHeader);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 0, 'no cross-customer leakage');

  const patch = await request(app)
    .patch(`/api/customer/addresses/${id}`)
    .set('Cookie', intruder.cookieHeader)
    .set('x-csrf-token', intruder.csrf)
    .send({ city: 'Hacked' });
  assert.equal(patch.status, 404);

  const del = await request(app)
    .delete(`/api/customer/addresses/${id}`)
    .set('Cookie', intruder.cookieHeader)
    .set('x-csrf-token', intruder.csrf);
  assert.equal(del.status, 404);

  const def = await request(app)
    .post(`/api/customer/addresses/${id}/default`)
    .set('Cookie', intruder.cookieHeader)
    .set('x-csrf-token', intruder.csrf);
  assert.equal(def.status, 404);

  assert.equal(prisma.__addresses.length, 1, 'the foreign row is untouched');
  assert.equal(prisma.__addresses[0].city, 'Mumbai');
  assert.equal(prisma.__addresses[0].isDefault, false);
});

test('required fields and Indian phone/PIN formats are validated', async () => {
  const { app, prisma } = buildApp();
  const session = await login(app, 'validate@example.com');
  const post = (body) =>
    request(app)
      .post('/api/customer/addresses')
      .set('Cookie', session.cookieHeader)
      .set('x-csrf-token', session.csrf)
      .send(body);

  const cases = [
    [{ fullName: '' }, /full name/i],
    [{ phone: '' }, /phone/i],
    [{ phone: '12' }, /phone/i],
    [{ addressLine1: '' }, /address/i],
    [{ city: '' }, /city/i],
    [{ state: '' }, /state/i],
    [{ postalCode: '' }, /postal/i],
    [{ postalCode: '12ab' }, /postal/i],
    [{ country: 'IND' }, /country/i],
  ];
  for (const [override, pattern] of cases) {
    const res = await post(validAddress(override));
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(override)}`);
    assert.match(res.body.error.message, pattern);
  }
  assert.equal(prisma.__addresses.length, 0, 'invalid submissions never persist');
});

test('a malformed address id is rejected with 400', async () => {
  const { app } = buildApp();
  const session = await login(app, 'badid@example.com');
  const res = await request(app)
    .patch('/api/customer/addresses/abc')
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', session.csrf)
    .send({ city: 'Pune' });
  assert.equal(res.status, 400);
});

test('authenticated address writes require a matching CSRF token', async () => {
  const { app, prisma } = buildApp();
  const session = await login(app, 'csrf@example.com');

  const missing = await request(app)
    .post('/api/customer/addresses')
    .set('Cookie', session.cookieHeader)
    .send(validAddress());
  assert.equal(missing.status, 403);

  const wrong = await request(app)
    .post('/api/customer/addresses')
    .set('Cookie', session.cookieHeader)
    .set('x-csrf-token', 'not-the-token')
    .send(validAddress());
  assert.equal(wrong.status, 403);

  const delMissing = await request(app)
    .delete('/api/customer/addresses/1')
    .set('Cookie', session.cookieHeader);
  assert.equal(delMissing.status, 403);

  assert.equal(prisma.__addresses.length, 0);
});
