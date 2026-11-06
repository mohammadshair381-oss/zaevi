// Editing products must not disturb IDs, past orders or stored data. These run the real
// admin routes against the real tables of the development database, inside a transaction
// that is always rolled back, so nothing is left behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { resolveDatabaseName } from '../src/config/database.js';
import { getDbClient, disconnectDB } from '../src/db/connect.js';

// Live tests only ever run on a database whose name ends in zaevi_test.
if (process.env.MONGODB_URI && !resolveDatabaseName().endsWith('zaevi_test')) {
  throw new Error('product-edit.db.test.js refuses to run against this database');
}


const silentLogger = { error() {}, warn() {}, info() {}, log() {} };
const SESSION_SECRET = 'test-session-secret-at-least-32-characters';
const ROLLBACK_MESSAGE = 'rollback this test';

async function connect(t) {
  if (!process.env.MONGODB_URI) {
    t.skip('MONGODB_URI is not set; skipping live database test');
    return null;
  }
  const client = getDbClient();
  try {
    await client.$ping();
    return client;
  } catch {
    t.skip('the database is not reachable; skipping live database test');
    return null;
  }
}

test.after(() => disconnectDB());

/** Runs `fn` with a signed-in admin against a transaction that never commits. */
async function inRolledBackTransaction(client, fn) {
  let finished = false;
  try {
    await client.$transaction(async (tx) => {
      const db = new Proxy(tx, {
        get: (target, key) => (key === '$transaction' ? (work) => work(tx) : target[key]),
      });
      const app = createApp({ db, logger: silentLogger, sessionSecret: SESSION_SECRET, authRateLimit: false, loginRateLimit: false });
      const login = await request(app).post('/api/auth/login').send({ email: 'demo.admin@zaevi.test', password: 'DemoAdmin123!' });
      assert.equal(login.status, 200);
      const pairs = login.headers['set-cookie'].map((c) => c.split(';')[0]);
      const csrf = decodeURIComponent(pairs.find((c) => c.startsWith('zaevi.csrf=')).slice('zaevi.csrf='.length));
      const patch = (id, body) => request(app).patch(`/api/admin/products/${encodeURIComponent(id)}`)
        .set('Cookie', pairs.join('; ')).set('x-csrf-token', csrf).send(body);
      await fn({ tx, patch });
      finished = true;
      throw new Error(ROLLBACK_MESSAGE);
    }, { timeout: 60000, maxWait: 10000 });
  } catch (error) {
    if (error.message !== ROLLBACK_MESSAGE) throw error;
  }
  assert.equal(finished, true);
}

const productWithSizes = (client, id) => client.product.findUnique({ where: { id }, include: { sizes: { orderBy: { position: 'asc' } } } });
const withoutTime = ({ updatedAt, ...rest }) => rest;

test('editing a product leaves past orders exactly as they were', async (t) => {
  const client = await connect(t);
  if (!client) return;
  const item = await client.orderItem.findFirst({ where: { productId: { not: null } } });
  if (!item) { t.skip('No order to compare with'); return; }
  const before = await client.orderItem.findMany({ where: { productId: item.productId }, orderBy: { id: 'asc' } });
  const orderBefore = await client.order.findUnique({ where: { id: item.orderId } });

  await inRolledBackTransaction(client, async ({ tx, patch }) => {
    const res = await patch(item.productId, { name: 'Renamed In Test', price: 99, imageUrl: 'https://example.com/new.jpg', available: false, sizes: ['ZZ'] });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, item.productId);
    assert.equal(res.body.data.name, 'Renamed In Test');
    assert.deepEqual(await tx.orderItem.findMany({ where: { productId: item.productId }, orderBy: { id: 'asc' } }), before);
    const order = await tx.order.findUnique({ where: { id: item.orderId } });
    assert.equal(order.reference, orderBefore.reference);
    assert.equal(order.totalMinor, orderBefore.totalMinor);
  });
});

test('an edit cannot change a product ID', async (t) => {
  const client = await connect(t);
  if (!client) return;
  await inRolledBackTransaction(client, async ({ tx, patch }) => {
    const res = await patch('ZV001', { id: 'ZV999', name: 'Still ZV001' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, 'ZV001');
    assert.equal(await tx.product.findUnique({ where: { id: 'ZV999' } }), null);
  });
});

test('saving the edit form unchanged leaves every product identical', async (t) => {
  const client = await connect(t);
  if (!client) return;
  const products = await client.product.findMany({ include: { sizes: { orderBy: { position: 'asc' } } }, orderBy: { id: 'asc' } });
  assert.ok(products.length > 0);
  await inRolledBackTransaction(client, async ({ tx, patch }) => {
    for (const product of products) {
      const res = await patch(product.id, {
        name: product.name,
        price: product.price,
        category: product.category,
        gender: product.gender,
        color: product.color,
        description: product.description,
        imageUrl: product.imageUrl,
        hoverImageUrl: product.hoverImageUrl === product.imageUrl ? '' : product.hoverImageUrl,
        available: product.available,
        sizes: product.sizes.map((row) => row.size),
      });
      assert.equal(res.status, 200, `${product.id}: ${JSON.stringify(res.body).slice(0, 160)}`);
      assert.deepEqual(withoutTime(await productWithSizes(tx, product.id)), withoutTime(product), product.id);
    }
  });
});

test('a partial edit touches only what was sent', async (t) => {
  const client = await connect(t);
  if (!client) return;
  const before = await productWithSizes(client, 'ZV002');
  await inRolledBackTransaction(client, async ({ tx, patch }) => {
    assert.equal((await patch('ZV002', { available: !before.available })).status, 200);
    const after = await productWithSizes(tx, 'ZV002');
    assert.equal(after.available, !before.available);
    assert.deepEqual(withoutTime({ ...after, available: before.available }), withoutTime(before));
  });
});

test('changing sizes keeps the rows of sizes that stay, including the unused stock column', async (t) => {
  const client = await connect(t);
  if (!client) return;
  await inRolledBackTransaction(client, async ({ tx, patch }) => {
    const before = await tx.productSize.findMany({ where: { productId: 'ZV003' }, orderBy: { position: 'asc' } });
    assert.ok(before.length >= 2);
    const [kept, ...others] = before;
    const { ProductSize } = await tx.$models();
    await ProductSize.updateOne({ _id: kept.id }, { $set: { stock: 7 } }, { session: tx.$session });

    const res = await patch('ZV003', { sizes: ['NEW', kept.size] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.sizes, ['NEW', kept.size]);

    const after = await tx.productSize.findMany({ where: { productId: 'ZV003' }, orderBy: { position: 'asc' } });
    assert.equal(after.length, 2);
    assert.equal(after[1].id, kept.id, 'the row was kept, not recreated');
    assert.equal(after[1].position, 1);
    const { stock } = await ProductSize.findById(kept.id).select('+stock').session(tx.$session).lean();
    assert.equal(Number(stock), 7);
    const removed = await tx.productSize.count({ where: { id: { in: others.map((row) => row.id) } } });
    assert.equal(removed, 0);
  });
});

test('clearing the second photo shows the main photo on hover, and photos are otherwise kept', async (t) => {
  const client = await connect(t);
  if (!client) return;
  const before = await client.product.findUnique({ where: { id: 'ZV004' } });
  await inRolledBackTransaction(client, async ({ tx, patch }) => {
    await patch('ZV004', { name: 'Name only' });
    let row = await tx.product.findUnique({ where: { id: 'ZV004' } });
    assert.equal(row.imageUrl, before.imageUrl);
    assert.equal(row.hoverImageUrl, before.hoverImageUrl);

    await patch('ZV004', { hoverImageUrl: '' });
    row = await tx.product.findUnique({ where: { id: 'ZV004' } });
    assert.equal(row.hoverImageUrl, before.imageUrl);

    await patch('ZV004', { imageUrl: 'https://example.com/new.jpg', hoverImageUrl: '' });
    row = await tx.product.findUnique({ where: { id: 'ZV004' } });
    assert.equal(row.imageUrl, 'https://example.com/new.jpg');
    assert.equal(row.hoverImageUrl, 'https://example.com/new.jpg');
  });
  assert.equal((await client.product.findUnique({ where: { id: 'ZV004' } })).imageUrl, before.imageUrl, 'rolled back');
});

test('a bad edit changes nothing', async (t) => {
  const client = await connect(t);
  if (!client) return;
  const before = await productWithSizes(client, 'ZV005');
  await inRolledBackTransaction(client, async ({ tx, patch }) => {
    for (const body of [{ price: 0 }, { price: 10.5 }, { imageUrl: 'javascript:alert(1)' }, { sizes: [] }, { name: '' }, { gender: 'Kids' }]) {
      assert.equal((await patch('ZV005', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await patch('NOPE', { name: 'x' })).status, 404);
    assert.deepEqual(withoutTime(await productWithSizes(tx, 'ZV005')), withoutTime(before));
  });
});
