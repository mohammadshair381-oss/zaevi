import test from 'node:test';
import assert from 'node:assert/strict';

// Live database test: this file talks to a real MongoDB database.
// database and verifies the applied migration. It is skipped (never failed)
// when MONGODB_URI is unset or the server is unreachable, so `npm test`
// still passes without a database.
import '../src/config/load-env.js';

import { resolveDatabaseName } from '../src/config/database.js';
import { getDbClient, disconnectDB } from '../src/db/connect.js';

// Live tests only ever run on a database whose name ends in zaevi_test.
if (process.env.MONGODB_URI && !resolveDatabaseName().endsWith('zaevi_test')) {
  throw new Error('product.db.test.js refuses to run against this database');
}

const PRODUCT_COLUMNS = [
  'id',
  'name',
  'category',
  'gender',
  'price',
  'color',
  'imageUrl',
  'hoverImageUrl',
  'description',
  'available',
  'createdAt',
  'updatedAt',
];

const PRODUCT_SIZE_COLUMNS = ['id', 'productId', 'size', 'position'];

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

test('live database: product and size collections exist with their indexes', async (t) => {
  const db = await connectOrSkip(t);
  if (!db) return;

  try {
    const { Product, ProductSize } = await db.$models();
    const names = (await Product.db.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
    assert.ok(names.includes('products'), 'products collection must exist');
    assert.ok(names.includes('productSizes'), 'productSizes collection must exist');
    for (const column of PRODUCT_COLUMNS.filter((c) => c !== 'id')) {
      assert.ok(Product.schema.path(column), `Product.${column} must exist`);
    }
    for (const column of PRODUCT_SIZE_COLUMNS.filter((c) => c !== 'id')) {
      assert.ok(ProductSize.schema.path(column), `ProductSize.${column} must exist`);
    }
    const unique = (await ProductSize.collection.indexes()).find((ix) => ix.name === 'ProductSize_productId_size_key');
    assert.equal(unique?.unique, true, 'a size can exist only once per product');
  } finally {
    await disconnectDB();
  }
});
