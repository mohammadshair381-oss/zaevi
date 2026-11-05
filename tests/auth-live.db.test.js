import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import 'dotenv/config';



import { resolveDatabaseName } from '../src/config/database.js';
import { getDbClient } from '../src/db/connect.js';
import { hashPassword, verifyPassword } from '../src/models/auth.js';

// Live tests only ever run on a database whose name ends in zaevi_test.
if (process.env.MONGODB_URI && !resolveDatabaseName().endsWith('zaevi_test')) {
  throw new Error('auth-live.db.test.js refuses to run against this database');
}

function uniqueSuffix() {
  return randomBytes(6).toString('hex');
}

test('zaevi_test: guest customer account claiming, password hashing, and order ownership', async (t) => {
  if (!process.env.MONGODB_URI) {
    t.skip('MONGODB_URI not set; skipping live DB test');
    return;
  }
  const db = getDbClient();
  try {
    await db.$ping();
  } catch (error) {
    t.diagnostic(`the database unreachable: ${error.message}`);
    t.skip('the database unreachable');
    return;
  }

  const suffix = uniqueSuffix();
  const guestEmail = `guest-${suffix}@zaevi.test`;
  const securePassword = 'NewGuestPassword123!';

  let customerId = null;
  let orderId = null;

  try {
    // 1. Simulate guest checkout: Customer row created with passwordHash: null
    const guestCustomer = await db.customer.create({
      data: {
        email: guestEmail,
        name: 'Guest Customer',
        phone: '+91 98200 00000',
        passwordHash: null,
        role: 'customer',
      },
    });
    customerId = guestCustomer.id;
    assert.equal(guestCustomer.passwordHash, null);

    // 2. Link an order to this guest customer
    const order = await db.order.create({
      data: {
        reference: `ZV-TEST-${suffix}`,
        status: 'pending',
        customer: { connect: { id: guestCustomer.id } },
        contactEmail: guestEmail,
        totalMinor: 1500000,
        subtotalMinor: 1500000,
        currency: 'INR',
        shippingAddress: JSON.stringify({
          fullName: 'Guest Customer',
          addressLine1: '123 Atelier Street',
          city: 'Mumbai',
          postalCode: '400001',
          state: 'Maharashtra',
          country: 'IN',
        }),
      },
    });
    orderId = order.id;

    // 3. Guest registers with the same email address
    const hashedPassword = await hashPassword(securePassword);

    const result = await db.customer.updateMany({
      where: { id: guestCustomer.id, passwordHash: null },
      data: {
        passwordHash: hashedPassword,
        name: 'Registered Customer',
        phone: '+91 98200 11111',
      },
    });
    assert.equal(result.count, 1, 'Account successfully claimed');

    // 4. Verify password verifies correctly
    const claimedCustomer = await db.customer.findUnique({
      where: { id: guestCustomer.id },
    });
    assert.equal(claimedCustomer.id, guestCustomer.id, 'Customer ID was preserved');
    assert.equal(claimedCustomer.name, 'Registered Customer');
    assert.equal(claimedCustomer.phone, '+91 98200 11111');

    const isValidPassword = await verifyPassword(securePassword, claimedCustomer.passwordHash);
    assert.equal(isValidPassword, true, 'Claimed password hash verifies with scrypt');

    // 5. Verify existing orders are still owned by this customer
    const customerOrders = await db.order.findMany({
      where: { customerId: claimedCustomer.id },
    });
    assert.equal(customerOrders.length, 1);
    assert.equal(customerOrders[0].reference, `ZV-TEST-${suffix}`);
    assert.equal(customerOrders[0].totalMinor, 1500000);

    // 6. Verify duplicate claim attempt fails
    const secondClaim = await db.customer.updateMany({
      where: { id: guestCustomer.id, passwordHash: null },
      data: { passwordHash: hashedPassword },
    });
    assert.equal(secondClaim.count, 0, 'Second claim fails because password is now set');

  } finally {
    // Cleanup rows created during this test
    if (orderId) {
      await db.order.deleteMany({ where: { id: orderId } });
    }
    if (customerId) {
      await db.customer.deleteMany({ where: { id: customerId } });
    }
    await db.$disconnect();
  }
});
