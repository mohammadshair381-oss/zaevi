import test from 'node:test';
import assert from 'node:assert/strict';

// Live database test: verifies the applied commerce migration (Customer, Order,
// OrderItem), the foreign-key semantics and that the existing catalog is
// untouched. Skipped (never failed) when DATABASE_URL is unset or unreachable.
import 'dotenv/config';

import { getPrismaClient, disconnectDB } from '../src/db/connect.js';
import { rupeesToPaise, lineTotalMinor } from '../src/models/money.js';

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

async function tableNames(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()'
  );
  return new Set(rows.map((r) => String(r.name).toLowerCase()));
}

async function columnNamesFor(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
    table
  );
  return new Set(rows.map((r) => String(r.name)));
}

async function foreignKeys(prisma) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT kcu.table_name AS tbl, kcu.column_name AS col,
           kcu.referenced_table_name AS ref, rc.delete_rule AS rule
    FROM information_schema.key_column_usage kcu
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_schema = kcu.constraint_schema AND rc.constraint_name = kcu.constraint_name
    WHERE kcu.constraint_schema = DATABASE() AND kcu.referenced_table_name IS NOT NULL
  `);
  const key = (r) => `${String(r.tbl).toLowerCase()}.${String(r.col).toLowerCase()}`;
  return new Map(rows.map((r) => [key(r), { ref: String(r.ref).toLowerCase(), rule: String(r.rule).toLowerCase() }]));
}

test('live database: commerce tables, columns and relationships match the schema', async (t) => {
  const prisma = await connectOrSkip(t);
  if (!prisma) return;

  try {
    const tables = await tableNames(prisma);
    for (const name of ['customer', 'order', 'orderitem']) {
      assert.ok(tables.has(name), `${name} table must exist`);
    }
    assert.ok(tables.has('product'), 'existing Product table must remain');

    assert.ok((await columnNamesFor(prisma, 'Customer')).size > 0);
    for (const table of [
      ['Customer', CUSTOMER_COLUMNS],
      ['Order', ORDER_COLUMNS],
      ['OrderItem', ORDER_ITEM_COLUMNS],
    ]) {
      const columns = await columnNamesFor(prisma, table[0]);
      for (const column of table[1]) {
        assert.ok(columns.has(column), `${table[0]}.${column} must exist`);
      }
    }

    const fks = await foreignKeys(prisma);
    assert.deepEqual(fks.get('order.customerid'), { ref: 'customer', rule: 'set null' });
    assert.deepEqual(fks.get('orderitem.orderid'), { ref: 'order', rule: 'cascade' });
    assert.deepEqual(fks.get('orderitem.productid'), { ref: 'product', rule: 'set null' });
    assert.deepEqual(fks.get('productsize.productid'), { ref: 'product', rule: 'cascade' });
  } finally {
    await disconnectDB();
  }
});

test('live database: customers, guest orders and item snapshots behave correctly', async (t) => {
  const prisma = await connectOrSkip(t);
  if (!prisma) return;

  try {
    const product = await prisma.product.findUnique({ where: { id: 'ZV001' }, include: { sizes: true } });
    assert.ok(product, 'catalog product ZV001 must exist for the snapshot test');
    const unitPriceMinor = rupeesToPaise(product.price);
    const lineTotal = lineTotalMinor(unitPriceMinor, 2);

    await assert.rejects(
      prisma.$transaction(async (tx) => {
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
      await prisma.order.count({ where: { reference: { in: references } } }),
      0,
      'no test orders may survive the rollback'
    );
    assert.equal(
      await prisma.orderItem.count({ where: { order: { reference: { in: references } } } }),
      0,
      'no test order items may survive the rollback'
    );
    assert.equal(
      await prisma.customer.count({ where: { email: { in: ['guest@zaevi.test', 'aya.el@zaevi.test'] } } }),
      0,
      'no test customers may survive the rollback'
    );
    assert.ok(
      await prisma.product.findUnique({ where: { id: product.id } }),
      'the deleted catalog product must be restored by the rollback'
    );
  } finally {
    await disconnectDB();
  }
});

test('live database: the existing 12 products and 49 sizes are unchanged', async (t) => {
  const prisma = await connectOrSkip(t);
  if (!prisma) return;

  try {
    assert.equal(await prisma.product.count(), 12);
    assert.equal(await prisma.productSize.count(), 49);

    const ids = await prisma.product.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    assert.deepEqual(
      ids.map((row) => row.id),
      Array.from({ length: 12 }, (_, i) => `ZV${String(i + 1).padStart(3, '0')}`)
    );
  } finally {
    await disconnectDB();
  }
});