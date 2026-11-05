import test from 'node:test';
import assert from 'node:assert/strict';

// Live database test: this file talks to a real MySQL/MariaDB instance via
// Prisma and verifies the applied migration. It is skipped (never failed)
// when DATABASE_URL is unset or the server is unreachable, so `npm test`
// still passes without a database.
import 'dotenv/config';

import { getPrismaClient, disconnectDB } from '../src/db/connect.js';

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
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is not set; skipping live database test');
    return null;
  }
  const prisma = getPrismaClient();
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return prisma;
  } catch (error) {
    t.diagnostic(`database unavailable: ${error.message}`);
    t.skip('MySQL is not reachable; skipping live database test');
    return null;
  }
}

test('live database: Product and ProductSize tables match the schema', async (t) => {
  const prisma = await connectOrSkip(t);
  if (!prisma) return;

  try {
    const tables = await prisma.$queryRawUnsafe(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()'
    );
    const tableNames = tables.map((row) => String(row.name).toLowerCase());
    assert.ok(tableNames.includes('product'), 'Product table must exist');
    assert.ok(tableNames.includes('productsize'), 'ProductSize table must exist');

    const columns = await prisma.$queryRawUnsafe(
      "SELECT table_name AS t, column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE()"
    );

    const productColumns = new Set(
      columns.filter((c) => String(c.t).toLowerCase() === 'product').map((c) => String(c.name))
    );
    for (const column of PRODUCT_COLUMNS) {
      assert.ok(productColumns.has(column), `Product.${column} must exist`);
    }

    const sizeColumns = new Set(
      columns.filter((c) => String(c.t).toLowerCase() === 'productsize').map((c) => String(c.name))
    );
    for (const column of PRODUCT_SIZE_COLUMNS) {
      assert.ok(sizeColumns.has(column), `ProductSize.${column} must exist`);
    }
  } finally {
    await disconnectDB();
  }
});
