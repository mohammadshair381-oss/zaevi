import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, beforeEach, afterEach } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { isPublicStaticPath } from '../src/middleware/security.js';
import { hashPassword } from '../src/models/auth.js';
import { adminRecoveryConfig, MAX_RECOVERY_WINDOW_MS, RECOVERY_NOTIFICATION_TYPE } from '../src/services/admin-recovery.js';

const SECRET = 'a-session-secret-of-at-least-32-characters';
const CODE = 'k3Yt0pV8uQeW1nZr5sLm9xAb2cDf6gHj7iOp4TuYvWs';
const PASSWORD = 'Correct-Horse-Battery-1';
const ADMIN_EMAIL = 'owner@zaevi.test';
const KEYS = ['ADMIN_RECOVERY_ENABLED', 'ADMIN_RECOVERY_EMAIL', 'ADMIN_RECOVERY_CODE_HASH', 'ADMIN_RECOVERY_EXPIRES_AT'];

let codeHash;
let passwordHash;
const saved = {};

function fakeDb() {
  const people = [
    { id: 1, email: ADMIN_EMAIL, name: 'Owner', phone: null, role: 'admin', passwordHash, createdAt: new Date() },
    { id: 2, email: 'shopper@zaevi.test', name: 'Shopper', phone: null, role: 'customer', passwordHash, createdAt: new Date() },
  ];
  const notifications = [];
  return {
    notifications,
    customer: {
      findUnique: async ({ where }) => people.find((p) => (where.id ? p.id === where.id : p.email === where.email)) ?? null,
    },
    notification: {
      findFirst: async ({ where }) => notifications.find((n) => n.type === where.type && n.content.includes(where.content.contains)) ?? null,
      create: async ({ data }) => { const row = { id: notifications.length + 1, ...data }; notifications.push(row); return row; },
      update: async ({ where, data }) => Object.assign(notifications.find((n) => n.id === where.id), data),
    },
  };
}

const build = (db = fakeDb()) => ({
  db,
  app: createApp({ db, sessionSecret: SECRET, logger: { log() {}, error() {} }, emailOtp: true, loginRateLimit: false, authRateLimit: false }),
});

function configure(email = ADMIN_EMAIL) {
  process.env.ADMIN_RECOVERY_ENABLED = 'true';
  process.env.ADMIN_RECOVERY_EMAIL = email;
  process.env.ADMIN_RECOVERY_CODE_HASH = codeHash;
  process.env.ADMIN_RECOVERY_EXPIRES_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

const attempt = (app, body = {}) => request(app)
  .post('/api/auth/admin-recovery')
  .send({ email: ADMIN_EMAIL, password: PASSWORD, recoveryCode: CODE, ...body });

beforeEach(async () => {
  codeHash ??= await hashPassword(CODE);
  passwordHash ??= await hashPassword(PASSWORD);
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test('off by default: the page and the endpoint do not exist', async () => {
  const { app } = build();
  assert.equal((await attempt(app)).status, 404);
  assert.equal((await request(app).get('/admin/recovery')).status, 404);
});

test('stays off unless every setting is valid', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const good = {
    ADMIN_RECOVERY_ENABLED: 'true',
    ADMIN_RECOVERY_EMAIL: ADMIN_EMAIL,
    ADMIN_RECOVERY_CODE_HASH: 'scrypt$N=1$salt$hash',
    ADMIN_RECOVERY_EXPIRES_AT: new Date(now + 1000).toISOString(),
  };
  assert.equal(adminRecoveryConfig(good, now).enabled, true);
  const off = (change) => adminRecoveryConfig({ ...good, ...change }, now).enabled;
  assert.equal(adminRecoveryConfig({}, now).enabled, false);
  assert.equal(off({ ADMIN_RECOVERY_ENABLED: '1' }), false);
  assert.equal(off({ ADMIN_RECOVERY_EMAIL: 'nope' }), false);
  assert.equal(off({ ADMIN_RECOVERY_CODE_HASH: 'plain-text-code' }), false);
  assert.equal(off({ ADMIN_RECOVERY_EXPIRES_AT: 'soon' }), false);
  assert.equal(off({ ADMIN_RECOVERY_EXPIRES_AT: new Date(now - 1).toISOString() }), false);
  assert.equal(off({ ADMIN_RECOVERY_EXPIRES_AT: new Date(now + MAX_RECOVERY_WINDOW_MS + 1).toISOString() }), false);
});

test('the right password and code open a normal admin session, and it is recorded', async () => {
  configure();
  const { app, db } = build();
  const page = await request(app).get('/admin/recovery');
  assert.equal(page.status, 200);
  assert.equal(page.headers['cache-control'], 'no-store');

  const signedIn = await attempt(app);
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.data.role, 'admin');
  assert.equal(signedIn.body.data.passwordHash, undefined);

  const cookie = signedIn.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  assert.equal((await request(app).get('/admin').set('Cookie', cookie)).status, 200);

  assert.equal(db.notifications.length, 1);
  const [record] = db.notifications;
  assert.equal(record.type, RECOVERY_NOTIFICATION_TYPE);
  assert.equal(record.customerId, 1);
  assert.ok(!JSON.stringify(record).includes(CODE));
  assert.ok(!JSON.stringify(record).includes(codeHash));
});

test('every failure looks the same and starts no session', async () => {
  configure();
  const { app, db } = build();
  const failures = [
    { recoveryCode: 'wrong-code-wrong-code-wrong-code' },
    { recoveryCode: undefined },
    { password: 'Wrong-Password-12345' },
    { password: undefined },
    { email: 'stranger@zaevi.test' },
    { email: 'shopper@zaevi.test' },
  ];
  const bodies = new Set();
  for (const body of failures) {
    const response = await attempt(app, body);
    assert.equal(response.status, 401, JSON.stringify(body));
    assert.ok(!(response.headers['set-cookie'] ?? []).some((c) => c.startsWith('zaevi.session=') && !c.includes('Max-Age=0')), JSON.stringify(body));
    bodies.add(JSON.stringify(response.body.error ?? response.body));
  }
  assert.equal(bodies.size, 1);
  assert.equal(db.notifications.length, 0);
});

test('a customer named in the settings still cannot get in', async () => {
  configure('shopper@zaevi.test');
  const { app, db } = build();
  assert.equal((await attempt(app, { email: 'shopper@zaevi.test' })).status, 401);
  assert.equal(db.notifications.length, 0);
});

test('a code works once, even after a restart', async () => {
  configure();
  const db = fakeDb();
  assert.equal((await attempt(build(db).app)).status, 200);
  assert.equal((await attempt(build(db).app)).status, 401);
});

test('two requests at the same moment cannot both use a code', async () => {
  configure();
  const { app } = build();
  const statuses = (await Promise.all([attempt(app), attempt(app)])).map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 401]);
});

test('no session starts if the use cannot be recorded', async () => {
  configure();
  const db = fakeDb();
  db.notification.create = async () => { throw new Error('database unavailable'); };
  const response = await attempt(build(db).app);
  assert.equal(response.status, 503);
  assert.ok(!(response.headers['set-cookie'] ?? []).some((c) => c.startsWith('zaevi.session=')));
});

test('an expired window closes the door', async () => {
  configure();
  process.env.ADMIN_RECOVERY_EXPIRES_AT = new Date(Date.now() - 1000).toISOString();
  const { app } = build();
  assert.equal((await attempt(app)).status, 404);
  assert.equal((await request(app).get('/admin/recovery')).status, 404);
});

test('the page is not a public file and nothing is hard-coded', () => {
  assert.equal(isPublicStaticPath('/admin-recovery.html'), false);
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(example, /^ADMIN_RECOVERY_ENABLED=false$/m);
  assert.match(example, /^ADMIN_RECOVERY_CODE_HASH=""$/m);
  assert.doesNotMatch(readFileSync(new URL('../render.yaml', import.meta.url), 'utf8'), /ADMIN_RECOVERY_[A-Z_]+\n/);
  for (const file of ['../src/services/admin-recovery.js', '../scripts/create-admin-recovery.mjs']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /scrypt\$|ADMIN_RECOVERY_CODE_HASH=[A-Za-z0-9]/);
  }
});
