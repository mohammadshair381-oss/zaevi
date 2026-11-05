import test from 'node:test';
import assert from 'node:assert/strict';

// Live database test: verifies the applied commerce migration (Customer, Order,
// OrderItem), the foreign-key semantics and that the existing catalog is
// untouched. Skipped (never failed) when MONGODB_URI is unset or unreachable.
import 'dotenv/config';

import { resolveDatabaseName } from '../src/config/database.js';
import { MODELS } from '../src/db/schema.js';
import { getDbClient, disconnectDB } from '../src/db/connect.js';
import { rupeesToPaise, lineTotalMinor } from '../src/models/money.js';

// Live tests only ever run on a database whose name ends in zaevi_test.
if (process.env.MONGODB_URI && !resolveDatabaseName().endsWith('zaevi_test')) {
  throw new Error('orders.db.test.js refuses to run against this database');
}

const CUSTOMER_COLUMNS = ['id', 'email', 'name', 'phone', 'createdAt', 'updatedAt'];
const ORDER_COLUMNS = [
  'id',
  'reference',
  'customerId',
  'status',
  'currency',
  'subtotalMinor',
  'totalMinor',
  'contactEmail',
  'contactPhone',
  'shippingName',
  'shippingAddress',
  'shippingCity',
  'shippingPostalCode',
  'shippingCountry',
  'createdAt',
  'updatedAt',
];
const ORDER_ITEM_COLUMNS = [
  'id',
  'orderId',
  'productId',
  'productSku',
  'productName',
  'size',
  'unitPriceMinor',
  'quantity',
  'lineTotalMinor',
  'createdAt',
];

const ROLLBACK = new Error('ROLLBACK_TEST_MARKER');

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

test('live database: commerce collections, fields and relationships match the schema', async (t) => {
  const db = await connectOrSkip(t);
  if (!db) return;

  try {
    const { Customer, Order, OrderItem } = await db.$models();
    const names = (await Customer.db.db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
    for (const name of ['customers', 'orders', 'orderItems', 'products']) {
      assert.ok(names.includes(name), `${name} collection must exist`);
    }
    for (const [model, columns] of [[Customer, CUSTOMER_COLUMNS], [Order, ORDER_COLUMNS], [OrderItem, ORDER_ITEM_COLUMNS]]) {
      for (const column of columns.filter((c) => c !== 'id')) {
        assert.ok(model.schema.path(column), `${model.modelName}.${column} must exist`);
      }
    }
    const rule = (model, field) => Object.values(MODELS[model].relations).find((r) => r.local === field);
    assert.deepEqual([rule('Order', 'customerId').model, rule('Order', 'customerId').onDelete], ['Customer', 'SetNull']);
    assert.deepEqual([rule('OrderItem', 'orderId').model, rule('OrderItem', 'orderId').onDelete], ['Order', 'Cascade']);
    assert.deepEqual([rule('OrderItem', 'productId').model, rule('OrderItem', 'productId').onDelete], ['Product', 'SetNull']);
    assert.deepEqual([rule('ProductSize', 'productId').model, rule('ProductSize', 'productId').onDelete], ['Product', 'Cascade']);
  } finally {
    await disconnectDB();
  }
});

test('live database: customers, guest orders and item snapshots behave correctly', async (t) => {
  const db = await connectOrSkip(t);
  if (!db) return;

  try {
    const product = await db.product.findUnique({ where: { id: 'ZV001' }, include: { sizes: true } });
    assert.ok(product, 'catalog product ZV001 must exist for the snapshot test');
    const unitPriceMinor = rupeesToPaise(product.price);
    const lineTotal = lineTotalMinor(unitPriceMinor, 2);

    await assert.rejects(
      db.$transaction(async (tx) => {
        // Guest order without a customer.
        const guest = await tx.order.create({
          data: {
            reference: 'TST-GUEST-0001',
            subtotalMinor: lineTotal,
            totalMinor: lineTotal,
            contactEmail: 'guest@zaevi.test',
            shippingCountry: 'IN',
            items: {
              create: [
                {
                  productId: product.id,
                  productSku: product.id,
                  productName: product.name,
                  size: 'S',
                  unitPriceMinor,
                  quantity: 2,
                  lineTotalMinor: lineTotal,
                },
              ],
            },
          },
          include: { items: true },
        });
        assert.equal(guest.customerId, null, 'guest order must not require a customer');
        assert.equal(guest.status, 'pending');
        assert.equal(guest.currency, 'INR');
        assert.equal(guest.items.length, 1);
        assert.ok(guest.items[0].productSku === product.id);
        assert.ok(guest.items[0].productName === product.name);
        assert.equal(guest.items[0].unitPriceMinor, unitPriceMinor);
        assert.equal(guest.items[0].lineTotalMinor, lineTotal);

        // Deleting the order must cascade its items.
        await tx.order.delete({ where: { id: guest.id } });
        assert.equal(await tx.orderItem.count({ where: { orderId: guest.id } }), 0);

        // Deleting the product must NULL the live reference but keep the snapshot.
        const o2 = await tx.order.create({
          data: {
            reference: 'TST-GUEST-0002',
            subtotalMinor: unitPriceMinor,
            totalMinor: unitPriceMinor,
            contactEmail: 'guest@zaevi.test',
            items: {
              create: [
                {
                  productId: product.id,
                  productSku: product.id,
                  productName: product.name,
                  unitPriceMinor,
                  quantity: 1,
                  lineTotalMinor: unitPriceMinor,
                },
              ],
            },
          },
        });
        const item = await tx.orderItem.findFirst({ where: { orderId: o2.id } });
        assert.equal(item.productId, product.id);
        await tx.product.delete({ where: { id: product.id } });
        const afterDelete = await tx.orderItem.findUnique({ where: { id: item.id } });
        assert.equal(afterDelete.productId, null, 'productId must be NULLed on product delete');
        assert.equal(afterDelete.productSku, product.id, 'snapshot SKU must survive product deletion');
        assert.equal(afterDelete.productName, product.name, 'snapshot name must survive');

        // Customer is optional but linkable; deleting a customer NULLs orders.
        const customer = await tx.customer.create({ data: { email: 'aya.el@zaevi.test', name: 'Aya El' } });
        const o3 = await tx.order.create({
          data: {
            reference: 'TST-CUST-0003',
            customerId: customer.id,
            subtotalMinor: unitPriceMinor,
            totalMinor: unitPriceMinor,
            contactEmail: customer.email,
          },
        });
        assert.equal((await tx.order.findUnique({ where: { id: o3.id } })).customerId, customer.id);
        await tx.customer.delete({ where: { id: customer.id } });
        assert.equal((await tx.order.findUnique({ where: { id: o3.id } })).customerId, null);

        throw ROLLBACK;
      }),
      (error) => error === ROLLBACK
    );

    // Nothing above may persist. The markers are unique to this test so the
    // checks stay correct even while other live-database test files run against
    // the same schema in parallel.
    const references = ['TST-GUEST-0001', 'TST-GUEST-0002', 'TST-CUST-0003'];
    assert.equal(
      await db.order.count({ where: { reference: { in: references } } }),
      0,
      'no test orders may survive the rollback'
    );
    assert.equal(
      await db.orderItem.count({ where: { order: { reference: { in: references } } } }),
      0,
      'no test order items may survive the rollback'
    );
    assert.equal(
      await db.customer.count({ where: { email: { in: ['guest@zaevi.test', 'aya.el@zaevi.test'] } } }),
      0,
      'no test customers may survive the rollback'
    );
    assert.ok(
      await db.product.findUnique({ where: { id: product.id } }),
      'the deleted catalog product must be restored by the rollback'
    );
  } finally {
    await disconnectDB();
  }
});

test('live database: the existing 12 products and 49 sizes are unchanged', async (t) => {
  const db = await connectOrSkip(t);
  if (!db) return;

  try {
    assert.equal(await db.product.count(), 12);
    assert.equal(await db.productSize.count(), 49);

    const ids = await db.product.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    assert.deepEqual(
      ids.map((row) => row.id),
      Array.from({ length: 12 }, (_, i) => `ZV${String(i + 1).padStart(3, '0')}`)
    );
  } finally {
    await disconnectDB();
  }
});