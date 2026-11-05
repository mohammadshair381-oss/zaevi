/**
 * Prepares the database this environment may use: creates any missing collections and
 * indexes, and adds the default settings and newsletter coupon if they are absent.
 * Safe to run repeatedly, and it never changes existing records. Run it once on a new
 * database, and again after index changes:
 *
 *   npm run db:setup
 */
import 'dotenv/config';

import { resolveDatabaseName } from '../src/config/database.js';
import { disconnectDB, getDatabaseHandles, getDbClient } from '../src/db/connect.js';
import { setupDatabase } from '../src/db/models.js';
import { CMS_DEFAULT_SETTINGS } from '../src/models/cms.js';

/** The newsletter offer: 10% off, once per customer, for subscribers, until 3 November 2027 23:59 IST. */
const NEWSLETTER_COUPON = {
  code: 'ATELIER10',
  description: 'Newsletter welcome offer: 10% off one order',
  discountType: 'percentage',
  discountValue: 10,
  minOrderMinor: 0,
  expiresAt: new Date('2027-11-03T18:29:59.000Z'),
  usageLimit: 1000,
  perCustomerLimit: 1,
  requiresNewsletter: true,
  isActive: true,
};

try {
  const { connection, models } = await getDatabaseHandles();
  const created = await setupDatabase(connection, models);
  const db = getDbClient();
  const added = [];
  if (!(await db.websiteSetting.findUnique({ where: { id: 1 } }))) {
    await db.websiteSetting.create({ data: { id: 1, ...CMS_DEFAULT_SETTINGS } });
    added.push('default settings');
  }
  if (!(await db.coupon.findUnique({ where: { code: NEWSLETTER_COUPON.code } }))) {
    await db.coupon.create({ data: NEWSLETTER_COUPON });
    added.push(NEWSLETTER_COUPON.code);
  }
  console.log(`[db:setup] ${resolveDatabaseName()}: ${created.length} collections created, all indexes in place, added: ${added.join(', ') || 'nothing'}`);
} catch (error) {
  console.error(`[db:setup] failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDB();
}
