import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { databaseNameOf, resolveDatabase, resolveDatabaseName } from '../src/config/database.js';
import { getOfficialContactEmail, deliverContactNotification } from '../src/routes/contact.js';
import { getInvoiceGstinLabel } from '../src/routes/payments.js';
import { CMS_DEFAULT_SETTINGS } from '../src/models/cms.js';

const PROD = 'mongodb://user:pw@db.example:27017/zaevi';
const ATLAS_NO_NAME = 'mongodb+srv://user:pw@cluster.example.mongodb.net/?retryWrites=true';
const silentLogger = { error() {}, warn() {}, info() {}, log() {} };

test('development and test always use zaevi_test, whatever .env says', () => {
  for (const NODE_ENV of ['development', 'test', undefined]) {
    assert.equal(resolveDatabase({ NODE_ENV, MONGODB_URI: PROD }).dbName, 'zaevi_test');
    assert.equal(resolveDatabase({ NODE_ENV, MONGODB_URI: ATLAS_NO_NAME }).dbName, 'zaevi_test');
    assert.equal(resolveDatabaseName({ NODE_ENV }), 'zaevi_test');
  }
});

test('development never switches to production, even with the approval flag', () => {
  assert.equal(resolveDatabase({ NODE_ENV: 'development', MONGODB_URI: PROD, ZAEVI_PRODUCTION_DB_APPROVED: 'true' }).dbName, 'zaevi_test');
});

test('a password containing the database name is not mistaken for it', () => {
  assert.equal(databaseNameOf('mongodb://user:zaevi@localhost:27017/zaevi_test'), 'zaevi_test');
  assert.equal(databaseNameOf('mongodb+srv://user:zaevi@cluster.example.mongodb.net/?retryWrites=true'), null);
});

test('other development database names are respected', () => {
  assert.equal(resolveDatabase({ NODE_ENV: 'development', MONGODB_URI: 'mongodb://localhost:27017/zaevi_copy' }).dbName, 'zaevi_copy');
});

test('a link is required', () => {
  assert.throws(() => resolveDatabase({ NODE_ENV: 'development' }), /MONGODB_URI is required/);
  assert.throws(() => resolveDatabase({ NODE_ENV: 'production', ZAEVI_PRODUCTION_DB_APPROVED: 'true' }), /MONGODB_URI is required/);
});

test('production refuses to start without explicit approval', () => {
  assert.throws(() => resolveDatabase({ NODE_ENV: 'production', MONGODB_URI: PROD }), /not approved/);
  assert.throws(() => resolveDatabase({ NODE_ENV: 'production', MONGODB_URI: PROD, ZAEVI_PRODUCTION_DB_APPROVED: 'yes' }), /not approved/);
});

test('production never falls back to test data', () => {
  const approved = { NODE_ENV: 'production', ZAEVI_PRODUCTION_DB_APPROVED: 'true' };
  assert.throws(() => resolveDatabase({ ...approved, MONGODB_URI: 'mongodb://localhost/zaevi_test' }), /must name the "zaevi"/);
});

test('production uses zaevi once it is explicitly approved', () => {
  const approved = { NODE_ENV: 'production', ZAEVI_PRODUCTION_DB_APPROVED: 'true' };
  assert.equal(resolveDatabase({ ...approved, MONGODB_URI: PROD }).dbName, 'zaevi');
  assert.equal(resolveDatabase({ ...approved, MONGODB_URI: ATLAS_NO_NAME }).dbName, 'zaevi');
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
    const app = createApp({ db: {}, logger: silentLogger, sessionSecret: 'test-session-secret-at-least-32-characters' });
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
  const db = { contactMessage: { update: async ({ data }) => { updates.push(data); return data; } } };
  await deliverContactNotification(db, { id: 1, email: 'a@example.com', name: 'A', subject: 'Press', message: 'Hello there' }, { env: { CONTACT_EMAIL: 'help@example.com' } });
  assert.equal(updates[0].notifyStatus, 'not_configured');
  assert.match(updates[0].notifyError, /SMTP_HOST/);
});

test('no unverified address or 30-day claim remains in the storefront', () => {
  const files = ['../frontend/contact.html', '../frontend/privacy.html', '../frontend/terms.html', '../frontend/accessibility.html', '../frontend/js/luxury-enhancements.js', 'src/routes/payments.js'];
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
  const main = readFileSync(new URL('../../frontend/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /const profile=result\.data&&result\.data\.data;/);
  assert.match(main, /profile\.role==='admin'\)\{\s+try\{location\.href='\/admin'\}/);
  assert.match(main, /p\.role==='admin'\?'<a class="button button--primary acct-admin-link" href="\/admin">/);
  assert.match(readFileSync(new URL('../../frontend/admin/admin.html', import.meta.url), 'utf8'), /href="\/admin\/studio"/);
});

test('dashboard links exist only for administrators', () => {
  const main = readFileSync(new URL('../../frontend/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /const isAdmin=Boolean\(profile&&profile\.role==='admin'\);/);
  assert.match(main, /if\(!isAdmin\)return;/);
});

test('order confirmation only fetches Razorpay when a customer chooses to pay', () => {
  const page = readFileSync(new URL('../../frontend/order-confirmation.html', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /<script src="https:\/\/checkout\.razorpay\.com/);
  assert.match(page, /await zcLoadRazorpay\(\);\s*const rzp=new \(window\.Razorpay\)\(options\);/);
});
