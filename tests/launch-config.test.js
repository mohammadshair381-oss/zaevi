import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { applyDatabaseUrlToEnv, databaseNameOf, resolveDatabaseUrl } from '../src/config/database.js';
import { getOfficialContactEmail, deliverContactNotification } from '../src/routes/contact.js';
import { getInvoiceGstinLabel } from '../src/routes/payments.js';
import { CMS_DEFAULT_SETTINGS } from '../src/models/cms.js';

const PROD = 'mysql://user:pw@db.example:3306/zaevi';
const silentLogger = { error() {}, warn() {}, info() {}, log() {} };

test('development and test always use zaevi_test, whatever .env says', () => {
  for (const NODE_ENV of ['development', 'test', undefined]) {
    assert.equal(databaseNameOf(resolveDatabaseUrl({ NODE_ENV, DATABASE_URL: PROD })), 'zaevi_test');
    assert.equal(databaseNameOf(resolveDatabaseUrl({ NODE_ENV })), 'zaevi_test');
  }
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: `${PROD}?connection_limit=5` }), 'mysql://user:pw@db.example:3306/zaevi_test?connection_limit=5');
});

test('development never switches to production, even with the approval flag', () => {
  const url = resolveDatabaseUrl({ NODE_ENV: 'development', DATABASE_URL: PROD, ZAEVI_PRODUCTION_DB_APPROVED: 'true' });
  assert.equal(databaseNameOf(url), 'zaevi_test');
});

test('a password containing the database name is not rewritten', () => {
  const url = resolveDatabaseUrl({ NODE_ENV: 'development', DATABASE_URL: 'mysql://user:zaevi@localhost:3306/zaevi' });
  assert.equal(url, 'mysql://user:zaevi@localhost:3306/zaevi_test');
});

test('other development database names are respected', () => {
  const url = 'mysql://root@127.0.0.1:3306/zaevi_copy';
  assert.equal(resolveDatabaseUrl({ NODE_ENV: 'development', DATABASE_URL: url }), url);
});

test('production refuses to start without explicit approval', () => {
  assert.throws(() => resolveDatabaseUrl({ NODE_ENV: 'production', DATABASE_URL: PROD }), /not approved/);
  assert.throws(() => resolveDatabaseUrl({ NODE_ENV: 'production', DATABASE_URL: PROD, ZAEVI_PRODUCTION_DB_APPROVED: 'yes' }), /not approved/);
});

test('production never falls back to test data', () => {
  const approved = { NODE_ENV: 'production', ZAEVI_PRODUCTION_DB_APPROVED: 'true' };
  assert.throws(() => resolveDatabaseUrl(approved), /must name the "zaevi"/);
  assert.throws(() => resolveDatabaseUrl({ ...approved, DATABASE_URL: 'mysql://root@localhost/zaevi_test' }), /must name the "zaevi"/);
  assert.throws(() => resolveDatabaseUrl({ ...approved, TEST_DATABASE_URL: PROD.replace('/zaevi', '/zaevi_test') }), /must name the "zaevi"/);
});

test('production uses zaevi once it is explicitly approved', () => {
  assert.equal(resolveDatabaseUrl({ NODE_ENV: 'production', ZAEVI_PRODUCTION_DB_APPROVED: 'true', DATABASE_URL: PROD }), PROD);
});

test('Prisma CLI follows the same rules', () => {
  const dev = { NODE_ENV: 'development', DATABASE_URL: PROD };
  applyDatabaseUrlToEnv(dev);
  assert.equal(databaseNameOf(dev.DATABASE_URL), 'zaevi_test');

  const unapproved = { NODE_ENV: 'production', DATABASE_URL: PROD };
  applyDatabaseUrlToEnv(unapproved);
  assert.equal(unapproved.DATABASE_URL, undefined);
});

test('CMS settings migration matches the application defaults and overwrites nothing', () => {
  const sql = readFileSync(new URL('../prisma/migrations/20261104120000_seed_default_website_settings/migration.sql', import.meta.url), 'utf8');
  assert.match(sql, /INSERT IGNORE INTO `WebsiteSetting`/);
  assert.doesNotMatch(sql, /\b(UPDATE|DELETE|DROP|TRUNCATE)\b/);
  for (const [key, value] of Object.entries(CMS_DEFAULT_SETTINGS)) {
    assert.match(sql, new RegExp(`\`${key}\``), `missing column ${key}`);
    if (typeof value === 'string' && value) assert.ok(sql.includes(`'${value}'`), `value for ${key}`);
  }
});

test('GSTIN: only a valid configured number is printed, otherwise a clear placeholder', () => {
  assert.match(getInvoiceGstinLabel({}), /placeholder/i);
  assert.match(getInvoiceGstinLabel({ BUSINESS_GSTIN: 'not-a-gstin' }), /placeholder/i);
  assert.equal(getInvoiceGstinLabel({ BUSINESS_GSTIN: ' 22aaaaa0000a1z5 ' }), 'GSTIN: 22AAAAA0000A1Z5');
  assert.equal(readFileSync(new URL('../src/routes/payments.js', import.meta.url), 'utf8').includes('27AABCS1429B1Z8'), false);
});

test('official contact address is configurable and never invented', async () => {
  assert.equal(getOfficialContactEmail({}), null);
  assert.equal(getOfficialContactEmail({ CONTACT_EMAIL: 'not an email' }), null);
  assert.equal(getOfficialContactEmail({ CONTACT_EMAIL: ' help@example.com ' }), 'help@example.com');

  const before = process.env.CONTACT_EMAIL;
  delete process.env.CONTACT_EMAIL;
  try {
    const app = createApp({ prisma: {}, logger: silentLogger, sessionSecret: 'test-session-secret-at-least-32-characters' });
    assert.deepEqual((await request(app).get('/api/contact/config')).body, { data: { email: null } });
    process.env.CONTACT_EMAIL = 'help@example.com';
    assert.deepEqual((await request(app).get('/api/contact/config')).body, { data: { email: 'help@example.com' } });
  } finally {
    if (before === undefined) delete process.env.CONTACT_EMAIL;
    else process.env.CONTACT_EMAIL = before;
  }
});

test('contact alerts go to the official address when no separate one is set', async () => {
  const updates = [];
  const prisma = { contactMessage: { update: async ({ data }) => { updates.push(data); return data; } } };
  await deliverContactNotification(prisma, { id: 1, email: 'a@example.com', name: 'A', subject: 'Press', message: 'Hello there' }, { env: { CONTACT_EMAIL: 'help@example.com' } });
  assert.equal(updates[0].notifyStatus, 'not_configured');
  assert.match(updates[0].notifyError, /SMTP_HOST/);
});

test('no unverified address or 30-day claim remains in the storefront', () => {
  const files = ['contact.html', 'privacy.html', 'terms.html', 'accessibility.html', 'luxury-enhancements.js', 'src/routes/payments.js'];
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /@zaevi\.(com|luxury)/, file);
    assert.doesNotMatch(text, /30[- ]day/i, file);
  }
});

test('demo admin credentials stay fixed and limited to zaevi_test', () => {
  const seed = readFileSync(new URL('../scripts/seed-demo-account.cjs', import.meta.url), 'utf8');
  assert.match(seed, /email: 'demo\.admin@zaevi\.test',\s+password: 'DemoAdmin123!'/);
  assert.match(seed, /email: 'demo\.customer@zaevi\.test',\s+password: 'DemoCustomer123!'/);
  assert.match(seed, /endsWith\('zaevi_test'\)/);
  assert.match(seed, /NODE_ENV === 'production'/);
  assert.doesNotMatch(seed, /randomBytes|Math\.random/);
});

test('scripts with hardcoded admin passwords are gone from the project', () => {
  for (const name of ['fix-admin.mjs', 'cms12a-restore-admin.mjs']) {
    assert.equal(existsSync(new URL(`../${name}`, import.meta.url)), false, name);
  }
});

test('admin login is routed to the dashboard, using the role inside the response data', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /const profile=result\.data&&result\.data\.data;/);
  assert.match(main, /profile\.role==='admin'\)\{\s+try\{location\.href='\/admin'\}/);
  assert.match(main, /p\.role==='admin'\?'<a class="button button--primary acct-admin-link" href="\/admin">/);
  assert.match(readFileSync(new URL('../admin.html', import.meta.url), 'utf8'), /href="\/admin\/studio"/);
});

test('dashboard links exist only for administrators', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /const isAdmin=Boolean\(profile&&profile\.role==='admin'\);/);
  assert.match(main, /if\(!isAdmin\)return;/);
});

test('order confirmation only fetches Razorpay when a customer chooses to pay', () => {
  const page = readFileSync(new URL('../order-confirmation.html', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /<script src="https:\/\/checkout\.razorpay\.com/);
  assert.match(page, /await zcLoadRazorpay\(\);\s*const rzp=new \(window\.Razorpay\)\(options\);/);
});
