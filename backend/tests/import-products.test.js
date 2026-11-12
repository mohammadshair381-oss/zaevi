import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildProductCreateData,
  buildProductUpdateData,
  productScalarChanged,
  sizesEqual,
  importProducts,
  importOneProduct,
  formatSummary,
  SCALAR_FIELDS,
} from '../scripts/import-products.js';
import { normalizeProduct } from '../src/models/product.js';

// Mock tests: an in-memory fake data client exercises the import logic
// (mapping, upsert/skip behaviour, duplicate prevention) with no database.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawProducts = JSON.parse(
  readFileSync(path.join(__dirname, '..', '..', 'frontend', 'data', 'products.json'), 'utf8')
);

function silentLogger() {
  return { log() {}, error() {} };
}

/**
 * Minimal in-memory stand-in for the database Product / ProductSize delegates.
 * Mirrors the (productId, size) unique constraint so duplicate creation would
 * surface as a duplicate map entry.
 */
function createFakeDb() {
  const products = new Map();

  const fake = {
    product: {
      async findUnique({ where }) {
        const record = products.get(where.id);
        if (!record) return null;
        return {
          ...record,
          sizes: [...record.sizes.values()].sort((a, b) => a.position - b.position),
        };
      },
      async create({ data }) {
        const { sizes, ...scalars } = data;
        const sizeMap = new Map();
        for (const size of sizes.create) {
          sizeMap.set(size.size, { productId: scalars.id, ...size });
        }
        products.set(scalars.id, { ...scalars, available: true, sizes: sizeMap });
        return { ...scalars };
      },
      async update({ where, data }) {
        const record = products.get(where.id);
        Object.assign(record, data);
        return { ...record };
      },
    },
    productSize: {
      async upsert({ where, create, update }) {
        const record = products.get(where.productId_size.productId);
        const key = where.productId_size.size;
        if (record.sizes.has(key)) {
          Object.assign(record.sizes.get(key), update);
        } else {
          record.sizes.set(key, { ...create });
        }
        return record.sizes.get(key);
      },
    },
    async $transaction(fn) {
      return fn(this);
    },
    // Test-only helpers.
    _products: products,
    _sizeRowCount() {
      let count = 0;
      for (const record of products.values()) count += record.sizes.size;
      return count;
    },
  };

  return fake;
}

test('buildProductCreateData maps every source field and orders sizes', () => {
  const desired = normalizeProduct(rawProducts[0]);
  const data = buildProductCreateData(desired);

  assert.equal(data.id, 'ZV001');
  assert.equal(data.name, 'Aurelia Silk Dress');
  assert.equal(data.category, 'Dresses');
  assert.equal(data.gender, 'Women');
  assert.equal(data.price, 18900);
  assert.equal(data.color, 'Noir');
  assert.equal(data.imageUrl, rawProducts[0].img);
  assert.equal(data.hoverImageUrl, rawProducts[0].hover);
  assert.equal(data.description, rawProducts[0].desc);
  assert.equal(data.available, undefined, 'available must come from the schema default');
  assert.deepEqual(data.sizes.create, [
    { size: 'XS', position: 0 },
    { size: 'S', position: 1 },
    { size: 'M', position: 2 },
    { size: 'L', position: 3 },
  ]);
});

test('buildProductUpdateData contains only catalog scalar fields', () => {
  const desired = normalizeProduct(rawProducts[0]);
  const data = buildProductUpdateData(desired);
  assert.deepEqual(Object.keys(data).sort(), [...SCALAR_FIELDS].sort());
  assert.equal(data.price, 18900);
  assert.equal(data.id, undefined);
  assert.equal(data.sizes, undefined);
});

test('productScalarChanged detects real changes only', () => {
  const desired = normalizeProduct(rawProducts[0]);
  const existing = { ...desired };
  assert.equal(productScalarChanged(existing, desired), false);
  assert.equal(productScalarChanged({ ...existing, price: 1 }, desired), true);
  assert.equal(productScalarChanged({ ...existing, name: 'Other' }, desired), true);
});

test('sizesEqual compares size, order and position', () => {
  const desired = normalizeProduct(rawProducts[0]);
  assert.equal(sizesEqual(desired.sizes, desired.sizes), true);
  assert.equal(
    sizesEqual(
      [
        { size: 'L', position: 3 },
        { size: 'M', position: 2 },
        { size: 'S', position: 1 },
        { size: 'XS', position: 0 },
      ],
      desired.sizes
    ),
    true,
    'order in storage is irrelevant when positions are correct'
  );
  assert.equal(sizesEqual(desired.sizes.slice(0, 3), desired.sizes), false);
  assert.equal(
    sizesEqual(
      [
        { size: 'XS', position: 1 },
        { size: 'S', position: 0 },
        { size: 'M', position: 2 },
        { size: 'L', position: 3 },
      ],
      desired.sizes
    ),
    false,
    'swapped positions must be detected'
  );
});

test('first import creates all 12 products with 49 ordered size rows', async () => {
  const db = createFakeDb();
  const summary = await importProducts({ db, raw: rawProducts, logger: silentLogger() });

  assert.deepEqual(
    { created: summary.created, updated: summary.updated, skipped: summary.skipped, failed: summary.failed },
    { created: 12, updated: 0, skipped: 0, failed: 0 }
  );
  assert.equal(db._products.size, 12);
  assert.equal(db._sizeRowCount(), 49);

  for (const record of db._products.values()) {
    const source = rawProducts.find((p) => p.id === record.id);
    assert.deepEqual(
      [...record.sizes.values()].sort((a, b) => a.position - b.position).map((s) => s.size),
      source.sizes
    );
  }
});

test('second import creates no duplicates and skips all 12', async () => {
  const db = createFakeDb();
  await importProducts({ db, raw: rawProducts, logger: silentLogger() });
  const summary = await importProducts({ db, raw: rawProducts, logger: silentLogger() });

  assert.deepEqual(
    { created: summary.created, updated: summary.updated, skipped: summary.skipped, failed: summary.failed },
    { created: 0, updated: 0, skipped: 12, failed: 0 }
  );
  assert.equal(db._products.size, 12, 'no duplicate products');
  assert.equal(db._sizeRowCount(), 49, 'no duplicate size rows');
});

test('a changed product is updated in place, not duplicated', async () => {
  const db = createFakeDb();
  await importProducts({ db, raw: rawProducts, logger: silentLogger() });

  const edited = rawProducts.map((p) => (p.id === 'ZV001' ? { ...p, price: 19900, name: 'Aurelia Silk Dress II' } : p));
  const summary = await importProducts({ db, raw: edited, logger: silentLogger() });

  assert.deepEqual(
    { created: summary.created, updated: summary.updated, skipped: summary.skipped, failed: summary.failed },
    { created: 0, updated: 1, skipped: 11, failed: 0 }
  );
  assert.equal(db._products.size, 12);
  assert.equal(db._products.get('ZV001').price, 19900);
  assert.equal(db._products.get('ZV001').name, 'Aurelia Silk Dress II');
});

test('invalid entries fail without aborting the run', async () => {
  const db = createFakeDb();
  const broken = rawProducts.map((p) => (p.id === 'ZV005' ? { ...p, price: 12.5 } : p));
  const summary = await importProducts({ db, raw: broken, logger: silentLogger() });

  assert.equal(summary.created, 11);
  assert.equal(summary.failed, 1);
  assert.equal(summary.failures[0].id, 'ZV005');
  assert.match(summary.failures[0].error, /price must be a whole number/);
  assert.equal(db._products.has('ZV005'), false);
});

test('duplicate ids in the source are rejected after the first', async () => {
  const db = createFakeDb();
  const summary = await importProducts({
    db,
    raw: [rawProducts[0], rawProducts[0]],
    logger: silentLogger(),
  });

  assert.equal(summary.created, 1);
  assert.equal(summary.failed, 1);
  assert.match(summary.failures[0].error, /duplicate product id/);
});

test('importOneProduct returns created then skipped', async () => {
  const db = createFakeDb();
  const desired = normalizeProduct(rawProducts[1]);
  assert.equal(await importOneProduct(db, desired), 'created');
  assert.equal(await importOneProduct(db, desired), 'skipped');
});

test('formatSummary reports every counter', () => {
  const line = formatSummary({ total: 12, created: 12, updated: 0, skipped: 0, failed: 0 });
  assert.match(line, /12 created, 0 updated, 0 skipped, 0 failed \(of 12\)/);
});
