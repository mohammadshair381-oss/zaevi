/**
 * ZAEVI operator tool: seed demo customer and administrator accounts.
 *
 * Usage:
 *   node scripts/seed-demo-account.cjs
 *
 * Safety properties:
 * - Strictly targets zaevi_test ONLY. Refuses to run against production or dev.
 * - Reuses scrypt hash format and verifyPassword from src/models/auth.js.
 * - Upserts demo accounts safely with valid >= 12 character passwords.
 * - Verifies the created accounts and passwords before exiting.
 */

const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

async function main() {
  // Demo credentials are for development and testing only.
  if (process.env.NODE_ENV === 'production') {
    console.error('Safety guard violation: demo accounts must never be seeded in production.');
    process.exit(1);
  }

  const targetUrl = process.env.TEST_DATABASE_URL || 'mysql://root@127.0.0.1:3306/zaevi_test';

  if (!targetUrl.endsWith('zaevi_test')) {
    console.error(`Safety guard violation: Refusing to run against "${targetUrl}". Only zaevi_test is allowed.`);
    process.exit(1);
  }

  console.log(`Database target verified: ${targetUrl}`);

  const authPath = path.resolve(__dirname, '..', 'src', 'models', 'auth.js');
  const { hashPassword, verifyPassword } = await import(`file://${authPath.split('\\').join('/')}`);

  const cmsPath = path.resolve(__dirname, '..', 'src', 'models', 'cms.js');
  const { CMS_DEFAULT_SETTINGS } = await import(`file://${cmsPath.split('\\').join('/')}`);

  const prisma = new PrismaClient({
    datasources: { db: { url: targetUrl } },
    log: ['error'],
  });

  try {
    // Fixed development credentials, deliberately kept here. They must not change, and
    // the guards above keep them out of every database except zaevi_test.
    const accounts = [
      {
        email: 'demo.customer@zaevi.test',
        password: 'DemoCustomer123!',
        name: 'Demo Customer',
        phone: '+91 98200 11111',
        role: 'customer',
      },
      {
        email: 'demo.admin@zaevi.test',
        password: 'DemoAdmin123!',
        name: 'Demo Administrator',
        phone: '+91 98200 99999',
        role: 'admin',
      },
      {
        email: 'client@zaevi.test',
        password: 'Password12345!',
        name: 'ZAEVI Client',
        phone: '+91 98200 12345',
        role: 'customer',
      },
      {
        email: 'admin@zaevi.test',
        password: 'AdminPassword123!',
        name: 'Atelier Director',
        phone: '+91 98200 99999',
        role: 'admin',
      },
    ];

    for (const acc of accounts) {
      const passwordHash = await hashPassword(acc.password);
      const user = await prisma.customer.upsert({
        where: { email: acc.email },
        update: {
          passwordHash,
          name: acc.name,
          phone: acc.phone,
          role: acc.role,
        },
        create: {
          email: acc.email,
          passwordHash,
          name: acc.name,
          phone: acc.phone,
          role: acc.role,
        },
      });

      const isValid = await verifyPassword(acc.password, user.passwordHash);
      if (!isValid) {
        throw new Error(`Password verification failed for ${acc.email} immediately after upsert`);
      }
      console.log(`✓ Account verified: ${acc.email} (ID: ${user.id}, Role: ${user.role})`);
    }

    // Ensure WebsiteSetting id: 1 exists
    const existingSettings = await prisma.websiteSetting.findUnique({ where: { id: 1 } });
    if (!existingSettings) {
      await prisma.websiteSetting.create({
        data: { id: 1, ...CMS_DEFAULT_SETTINGS },
      });
      console.log('✓ Website settings seeded (ID: 1)');
    } else {
      console.log('✓ Website settings already present (ID: 1)');
    }

    console.log('\nAll demo accounts and CMS settings successfully verified in zaevi_test.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Seed demo account failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
