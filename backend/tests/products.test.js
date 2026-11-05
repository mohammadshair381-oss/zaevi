import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { normalizeProduct } from '../src/models/product.js';
import {
  parseProductListQuery,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from '../src/models/product-query.js';
import { buildProductWhere, serializeProduct } from '../src/routes/products.js';

// Mock tests: an in-memory fake data client backs the API so the filters,
// pagination and error handling can be exercised without a live database.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawProducts = JSON.parse(
  readFileSync(path.join(__dirname, '..', '..', 'frontend', 'data', 'products.json'), 'utf8')
);

function loadCatalog() {
  return rawProducts.map((entry) => {
    const normalized = normalizeProduct(entry);
    return {
      ...normalized,
      sizes: normalized.sizes.map((size) => ({
        productId: normalized.id,
        size: size.size,
        position: size.position,
      })),
    };
  });
}

function withSortedSizes(row) {
  return { ...row, sizes: [...row.sizes].sort((a, b) => a.position - b.position) };
}

function matchesWhere(row, where) {
  if (!where) return true;
  if (
    where.category !== undefined &&
    row.category.toLowerCase() !== String(where.category).toLowerCase()
  ) {
    return false;
  }
  if (where.gender !== undefined && row.gender !== where.gender) return false;
  if (where.OR) {
    const hit = where.OR.some((clause) =>
      Object.entries(clause).every(([field, condition]) => {
        const value = String(row[field] ?? '').toLowerCase();
        if (condition.contains !== undefined) {
          return value.includes(String(condition.contains).toLowerCase());
        }
        if (condition.equals !== undefined) return value === String(condition.equals).toLowerCase();
        return false;
      })
    );
    if (!hit) return false;
  }
  return true;
}

function createFakeDb(rows) {
  return {
    product: {
      async count({ where } = {}) {
        return rows.filter((row) => matchesWhere(row, where)).length;
      },
      async findMany({ where, orderBy, skip = 0, take = rows.length } = {}) {
        let list = rows.filter((row) => matchesWhere(row, where));
        if (orderBy && orderBy.id === 'asc') {
          list = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        }
        return list.slice(skip, skip + take).map(withSortedSizes);
      },
      async findUnique({ where } = {}) {
        const row = rows.find((candidate) => candidate.id === where.id);
        return row ? withSortedSizes(row) : null;
      },
    },
  };
}

const silentLogger = { log() {}, error() {} };
const catalog = loadCatalog();
const app = createApp({ db: createFakeDb(catalog), logger: silentLogger });

function ids(body) {
  return body.data.map((product) => product.id);
}

test('GET /api/products returns all products with pagination metadata', async () => {
  const res = await request(app).get('/api/products');

  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 12);
  assert.deepEqual(res.body.pagination, {
    page: 1,
    limit: DEFAULT_LIMIT,
    total: 12,
    totalPages: 1,
  });

  const first = res.body.data[0];
  assert.deepEqual(first.sizes, ['XS', 'S', 'M', 'L']);
  assert.equal(first.id, 'ZV001');
  assert.equal(first.category, 'Dresses');
  assert.equal(first.price, 18900);
});

test('GET /api/products returns an empty result set with zeroed pagination', async () => {
  const res = await request(app).get('/api/products?category=Hats');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
  assert.deepEqual(res.body.pagination, { page: 1, limit: DEFAULT_LIMIT, total: 0, totalPages: 0 });
});

test('GET /api/products filters by category (case-insensitively)', async () => {
  const res = await request(app).get('/api/products?category=dresses');
  assert.equal(res.status, 200);
  assert.deepEqual(ids(res.body), ['ZV001', 'ZV006']);
  assert.equal(res.body.pagination.total, 2);
});

test('GET /api/products filters by gender', async () => {
  const men = await request(app).get('/api/products?gender=Men');
  assert.equal(men.status, 200);
  assert.deepEqual(ids(men.body), ['ZV007', 'ZV008', 'ZV009', 'ZV010']);

  const unisex = await request(app).get('/api/products?gender=unisex');
  assert.deepEqual(ids(unisex.body), ['ZV011', 'ZV012']);
});

test('GET /api/products search matches name, description and color', async () => {
  const byName = await request(app).get('/api/products?search=silk');
  assert.deepEqual(ids(byName.body), ['ZV001']);

  const byDescription = await request(app).get('/api/products?search=velvet');
  assert.deepEqual(ids(byDescription.body), ['ZV010']);

  const byColor = await request(app).get('/api/products?search=noir');
  assert.deepEqual(ids(byColor.body), ['ZV001', 'ZV011']);

  const none = await request(app).get('/api/products?search=zzzznomatch');
  assert.deepEqual(none.body.data, []);
});

test('GET /api/products combines filters', async () => {
  const res = await request(app).get('/api/products?gender=Women&category=Dresses');
  assert.deepEqual(ids(res.body), ['ZV001', 'ZV006']);
});

test('GET /api/products paginates with correct metadata', async () => {
  const page1 = await request(app).get('/api/products?page=1&limit=5');
  assert.equal(page1.body.data.length, 5);
  assert.deepEqual(page1.body.pagination, { page: 1, limit: 5, total: 12, totalPages: 3 });

  const page2 = await request(app).get('/api/products?page=2&limit=5');
  assert.equal(page2.body.data.length, 5);
  assert.deepEqual(ids(page2.body), ['ZV006', 'ZV007', 'ZV008', 'ZV009', 'ZV010']);

  const page3 = await request(app).get('/api/products?page=3&limit=5');
  assert.equal(page3.body.data.length, 2);
  assert.deepEqual(ids(page3.body), ['ZV011', 'ZV012']);

  const page4 = await request(app).get('/api/products?page=4&limit=5');
  assert.deepEqual(page4.body.data, []);
  assert.equal(page4.body.pagination.total, 12);
});

test('GET /api/products ignores unknown query parameters', async () => {
  const res = await request(app).get('/api/products?foo=bar&sort=nope');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 12);
});

test('GET /api/products rejects malformed query parameters with 400', async () => {
  const badQueries = [
    'page=0',
    'page=-1',
    'page=abc',
    'page=1.5',
    'limit=0',
    `limit=${MAX_LIMIT + 1}`,
    'limit=abc',
    'category=',
    'gender=Kids',
    `search=${'a'.repeat(101)}`,
  ];

  for (const query of badQueries) {
    const res = await request(app).get(`/api/products?${query}`);
    assert.equal(res.status, 400, `?${query} should be rejected`);
    assert.equal(res.body.error.status, 400);
    assert.match(res.headers['content-type'], /application\/json/);
  }
});

test('GET /api/products/:id returns one product with ordered sizes', async () => {
  const res = await request(app).get('/api/products/ZV012');

  assert.equal(res.status, 200);
  assert.equal(res.body.data.id, 'ZV012');
  assert.equal(res.body.data.name, 'ZAEVI Signature Loafers');
  assert.deepEqual(res.body.data.sizes, ['39', '40', '41', '42', '43', '44']);
});

test('GET /api/products/:id preserves the declared size order', async () => {
  const res = await request(app).get('/api/products/ZV002');
  assert.deepEqual(res.body.data.sizes, ['XS', 'S', 'M', 'L', 'XL']);
});

test('GET /api/products/:id returns 404 for a missing product', async () => {
  const res = await request(app).get('/api/products/ZZ999');

  assert.equal(res.status, 404);
  assert.equal(res.body.error.status, 404);
  assert.match(res.body.error.message, /not found/i);
});

test('GET /api/products/:id returns 404 for an over-long id', async () => {
  const res = await request(app).get(`/api/products/${'Z'.repeat(40)}`);
  assert.equal(res.status, 404);
});

test('unexpected database errors return the standardized 500 body', async () => {
  const failing = {
    product: {
      async count() {
        throw new Error('database exploded');
      },
      async findMany() {
        return [];
      },
      async findUnique() {
        throw new Error('database exploded');
      },
    },
  };
  const failingApp = createApp({ db: failing, logger: silentLogger });

  const listRes = await request(failingApp).get('/api/products');
  assert.equal(listRes.status, 500);
  assert.equal(listRes.body.error.status, 500);
  assert.equal(listRes.body.error.message, 'database exploded');

  const oneRes = await request(failingApp).get('/api/products/ZV001');
  assert.equal(oneRes.status, 500);
  assert.equal(oneRes.body.error.status, 500);
});

test('parseProductListQuery applies defaults and validates ranges', () => {
  assert.deepEqual(parseProductListQuery({}), { page: 1, limit: DEFAULT_LIMIT, category: undefined, gender: undefined, search: undefined });
  assert.equal(parseProductListQuery({ page: '2', limit: '5' }).limit, 5);
  assert.equal(parseProductListQuery({ gender: 'women' }).gender, 'Women');
  assert.throws(() => parseProductListQuery({ page: '0' }), { status: 400 });
  assert.throws(() => parseProductListQuery({ limit: String(MAX_LIMIT + 1) }), { status: 400 });
});

test('buildProductWhere omits absent filters', () => {
  assert.deepEqual(buildProductWhere({}), {});
  assert.deepEqual(buildProductWhere({ category: 'Bags' }), { category: 'Bags' });
  assert.deepEqual(buildProductWhere({ search: 'silk' }).OR.length, 3);
});

test('serializeProduct orders sizes by position', () => {
  const row = {
    id: 'ZV999',
    name: 'Test',
    category: 'Test',
    gender: 'Unisex',
    price: 1,
    color: 'Black',
    imageUrl: 'a',
    hoverImageUrl: 'b',
    description: 'c',
    available: true,
    sizes: [
      { size: 'L', position: 2 },
      { size: 'S', position: 1 },
      { size: 'M', position: 0 },
    ],
  };
  assert.deepEqual(serializeProduct(row).sizes, ['M', 'S', 'L']);
});
