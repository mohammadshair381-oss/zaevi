import test from 'node:test';
import assert from 'node:assert/strict';

// Live database test: exercises the product API against the real MongoDB database.
// catalog imported from products.json. It is skipped (never failed) when
// MONGODB_URI is unset or the server is unreachable, so `npm test` still
// passes without a database.
import 'dotenv/config';

import request from 'supertest';

import { createApp } from '../src/app.js';
import { resolveDatabaseName } from '../src/config/database.js';
import { getDbClient, disconnectDB } from '../src/db/connect.js';

// Live tests only ever run on a database whose name ends in zaevi_test.
if (process.env.MONGODB_URI && !resolveDatabaseName().endsWith('zaevi_test')) {
  throw new Error('products.db.test.js refuses to run against this database');
}

const silentLogger = { log() {}, error() {} };

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

test('live database: product API serves the imported catalog', async (t) => {
  const db = await connectOrSkip(t);
  if (!db) return;

  const app = createApp({ db, logger: silentLogger });

  try {
    await t.test('GET /api/products returns all 12 imported products', async () => {
      const res = await request(app).get('/api/products');
      assert.equal(res.status, 200);
      assert.equal(res.body.pagination.total, 12);
      assert.equal(res.body.pagination.totalPages, 1);
      assert.equal(res.body.data.length, 12);
      assert.deepEqual(
        res.body.data.map((p) => p.id),
        Array.from({ length: 12 }, (_, i) => `ZV${String(i + 1).padStart(3, '0')}`)
      );
    });

    await t.test('category and gender filters match the catalog', async () => {
      const dresses = await request(app).get('/api/products?category=Dresses');
      assert.deepEqual(dresses.body.data.map((p) => p.id), ['ZV001', 'ZV006']);

      const men = await request(app).get('/api/products?gender=Men');
      assert.deepEqual(men.body.data.map((p) => p.id), ['ZV007', 'ZV008', 'ZV009', 'ZV010']);
    });

    await t.test('search matches product text', async () => {
      const silk = await request(app).get('/api/products?search=silk');
      assert.deepEqual(silk.body.data.map((p) => p.id), ['ZV001']);

      const noir = await request(app).get('/api/products?search=Noir');
      assert.deepEqual(noir.body.data.map((p) => p.id).sort(), ['ZV001', 'ZV011']);
    });

    await t.test('pagination returns the right slices', async () => {
      const page2 = await request(app).get('/api/products?page=2&limit=5');
      assert.equal(page2.body.data.length, 5);
      assert.deepEqual(page2.body.pagination, { page: 2, limit: 5, total: 12, totalPages: 3 });
    });

    await t.test('GET /api/products/:id returns the product with ordered sizes', async () => {
      const res = await request(app).get('/api/products/ZV012');
      assert.equal(res.status, 200);
      assert.equal(res.body.data.name, 'ZAEVI Signature Loafers');
      assert.deepEqual(res.body.data.sizes, ['39', '40', '41', '42', '43', '44']);

      const coat = await request(app).get('/api/products/ZV002');
      assert.deepEqual(coat.body.data.sizes, ['XS', 'S', 'M', 'L', 'XL']);
    });

    await t.test('missing and malformed requests return 404 / 400', async () => {
      const missing = await request(app).get('/api/products/ZZ999');
      assert.equal(missing.status, 404);
      assert.equal(missing.body.error.status, 404);

      const invalid = await request(app).get('/api/products?page=0');
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.error.status, 400);
    });
  } finally {
    await disconnectDB();
  }
});
