/**
 * Email one-time codes, password reset and password change, through the real routes and
 * session store. A code must never reach a log outside development, must work once, and
 * no session may begin until it has been entered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/models/auth.js';
import { OTP_MAX_ATTEMPTS, OTP_MAX_SENDS, OTP_RESEND_COOLDOWN_MS, canLogOtp, otpAvailability, sendOtpEmail } from '../src/services/email-otp.js';

const silentLogger = { error() {}, warn() {}, info() {}, log() {} };
const SESSION_SECRET = 'test-session-secret-at-least-32-characters';
const EMAIL = 'security@example.com';
const OLD_PASSWORD = 'old-password-123';
const NEW_PASSWORD = 'brand-new-password-1';
const SMTP_ENV = { SMTP_HOST: 'mail.example.com', SMTP_USER: 'store', SMTP_PASS: 'secret', EMAIL_FROM: 'store@example.com' };
const CODE = '123456';
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const saved = {};
test.before(() => {
  for (const key of ['NODE_ENV', ...Object.keys(SMTP_ENV)]) saved[key] = process.env[key];
  process.env.NODE_ENV = 'test';
  Object.assign(process.env, SMTP_ENV);
});
test.after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Runs without SMTP settings, as a site with no email would. */
async function withoutEmail(fn) {
  for (const key of Object.keys(SMTP_ENV)) delete process.env[key];
  try {
    return await fn();
  } finally {
    Object.assign(process.env, SMTP_ENV);
  }
}

function matches(row, where) {
  return Object.entries(where).every(([key, want]) => {
    if (want && typeof want === 'object' && !(want instanceof Date)) {
      if ('lt' in want) return row[key] < want.lt;
      if ('gt' in want) return row[key] > want.gt;
      if ('not' in want) return row[key] !== want.not;
    }
    return row[key] === want;
  });
}

function apply(row, data) {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
  }
  return row;
}

async function build({ emailOtp = true, customers = {}, failDelivery = false } = {}) {
  const account = { id: 1, email: EMAIL, name: 'Test', role: 'customer', phone: null, createdAt: new Date(), emailVerifiedAt: new Date(), passwordHash: await hashPassword(OLD_PASSWORD), ...customers };
  const people = [account];
  const otps = [];
  const sent = [];
  const find = (where) => people.find((c) => (where.email ? c.email === where.email : c.id === where.id)) || null;
  const prisma = {
    otps,
    people,
    customer: {
      findUnique: async ({ where }) => find(where),
      update: async ({ where, data }) => Object.assign(find(where), data),
      create: async ({ data }) => { const row = { id: people.length + 1, role: 'customer', createdAt: new Date(), emailVerifiedAt: null, ...data }; people.push(row); return row; },
    },
    emailOtp: {
      findUnique: async ({ where }) => otps.find((o) => o.challengeHash === where.challengeHash) || null,
      findFirst: async ({ where }) => otps.find((o) => matches(o, where)) || null,
      create: async ({ data }) => { const row = { id: otps.length + 100, attempts: 0, sendCount: 1, consumedAt: null, ...data }; otps.push(row); return row; },
      update: async ({ where, data }) => apply(otps.find((o) => o.id === where.id), data),
      updateMany: async ({ where, data }) => {
        const rows = otps.filter((o) => matches(o, where));
        rows.forEach((o) => apply(o, data));
        return { count: rows.length };
      },
      deleteMany: async ({ where }) => {
        const keep = otps.filter((o) => !matches(o, where));
        otps.length = 0;
        otps.push(...keep);
        return { count: 0 };
      },
    },
    $transaction: async (fn) => fn(prisma),
  };
  const otpDeliver = async (message) => {
    if (failDelivery) throw new Error('SMTP refused');
    sent.push(message);
  };
  const app = createApp({ prisma, logger: silentLogger, sessionSecret: SESSION_SECRET, authRateLimit: false, loginRateLimit: false, emailOtp, otpDeliver });
  return { app, prisma, sent, account };
}

const cookieHeader = (res) => (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');
const hasSession = (res) => (res.headers['set-cookie'] || []).some((c) => c.startsWith('zaevi.sid=') && !c.startsWith('zaevi.sid=;'));
const login = (app, password = OLD_PASSWORD) => request(app).post('/api/auth/login').send({ email: EMAIL, password });
const verify = (app, challenge, code) => request(app).post('/api/auth/otp/verify').send({ challenge, code });
const isSignedIn = async (app, header) => (await request(app).get('/api/auth/me').set('Cookie', header)).body.data !== null;

async function signIn(ctx, password = OLD_PASSWORD) {
  const first = await login(ctx.app, password);
  assert.equal(first.status, 200);
  const res = await verify(ctx.app, first.body.data.challenge, ctx.sent[ctx.sent.length - 1].code);
  assert.equal(res.status, 200);
  const header = cookieHeader(res);
  return { res, header, csrf: decodeURIComponent(/zaevi\.csrf=([^;]+)/.exec(header)[1]) };
}

async function captureConsole(fn) {
  const lines = [];
  const { log, error, warn, info } = console;
  const record = (...args) => { lines.push(args.map(String).join(' ')); };
  Object.assign(console, { log: record, error: record, warn: record, info: record });
  try {
    await fn();
  } finally {
    Object.assign(console, { log, error, warn, info });
  }
  return lines.join('\n');
}

/* ---------- Signing in ---------- */
test('sign-in: a correct password alone starts no session and reveals no account details', async () => {
  const ctx = await build();
  const res = await login(ctx.app);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.otpRequired, true);
  assert.equal(hasSession(res), false);
  assert.equal('role' in res.body.data, false);
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].email, EMAIL);
  assert.equal(ctx.sent[0].purpose, 'login');
  assert.match(ctx.sent[0].code, /^\d{6}$/);
  assert.equal(JSON.stringify(res.body).includes(ctx.sent[0].code), false, 'the code is never in the response');
});

test('sign-in: the right code starts a session and returns the role', async () => {
  const ctx = await build({ customers: { role: 'admin' } });
  const first = await login(ctx.app);
  const res = await verify(ctx.app, first.body.data.challenge, ctx.sent[0].code);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.role, 'admin');
  assert.equal(hasSession(res), true);
  assert.equal(await isSignedIn(ctx.app, cookieHeader(res)), true);
});

test('sign-in: a wrong password sends no code', async () => {
  const ctx = await build();
  assert.equal((await login(ctx.app, 'wrong-password-123')).status, 401);
  assert.equal(ctx.sent.length, 0);
  assert.equal(ctx.prisma.otps.length, 0);
});

test('codes: only hashes are stored, and they last ten minutes', async () => {
  const ctx = await build();
  const first = await login(ctx.app);
  const row = ctx.prisma.otps[0];
  assert.match(row.codeHash, /^[a-f0-9]{64}$/);
  assert.match(row.challengeHash, /^[a-f0-9]{64}$/);
  const stored = JSON.stringify(row);
  assert.equal(stored.includes(ctx.sent[0].code), false);
  assert.equal(stored.includes(first.body.data.challenge), false);
  const lifetime = row.expiresAt.getTime() - Date.now();
  assert.ok(lifetime > 9 * 60000 && lifetime <= 10 * 60000);
});

test('codes: wrong guesses say how many remain, then the code stops working even if correct', async () => {
  const ctx = await build();
  const first = await login(ctx.app);
  const { challenge } = first.body.data;
  const wrong = ctx.sent[0].code === '000000' ? '111111' : '000000';
  for (let left = OTP_MAX_ATTEMPTS - 1; left > 0; left -= 1) {
    const res = await verify(ctx.app, challenge, wrong);
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, new RegExp(`${left} tr`));
  }
  const last = await verify(ctx.app, challenge, wrong);
  assert.match(last.body.error.message, /start again/);
  const correct = await verify(ctx.app, challenge, ctx.sent[0].code);
  assert.equal(correct.status, 400);
  assert.equal(hasSession(correct), false);
});

test('codes: guesses made at the same moment cannot exceed the limit', async () => {
  const ctx = await build();
  const first = await login(ctx.app);
  const wrong = ctx.sent[0].code === '000000' ? '111111' : '000000';
  await Promise.all(Array.from({ length: OTP_MAX_ATTEMPTS * 3 }, () => verify(ctx.app, first.body.data.challenge, wrong)));
  assert.equal(ctx.prisma.otps[0].attempts, OTP_MAX_ATTEMPTS);
});

test('codes: a code works once, even when used twice at the same moment', async () => {
  const ctx = await build();
  const first = await login(ctx.app);
  const results = await Promise.all([1, 2].map(() => verify(ctx.app, first.body.data.challenge, ctx.sent[0].code)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.equal((await verify(ctx.app, first.body.data.challenge, ctx.sent[0].code)).status, 400);
});

test('codes: expired, malformed and mismatched requests start no session', async () => {
  const ctx = await build();
  const first = await login(ctx.app);
  const { code } = ctx.sent[0];
  const { challenge } = first.body.data;
  for (const [c, k] of [['not-hex', code], ['a'.repeat(64), code], [undefined, code], [challenge, 'abcdef'], [challenge, '12345'], [challenge, undefined]]) {
    const res = await verify(ctx.app, c, k);
    assert.equal(res.status, 400, String(c));
    assert.equal(hasSession(res), false);
  }
  ctx.prisma.otps[0].expiresAt = new Date(Date.now() - 1000);
  assert.equal((await verify(ctx.app, challenge, code)).status, 400);
});

test('codes: a code from one person cannot be used with another request', async () => {
  const ctx = await build();
  const first = await login(ctx.app);
  const firstCode = ctx.sent[0].code;
  const second = await login(ctx.app);
  assert.equal((await verify(ctx.app, first.body.data.challenge, firstCode)).status, 400, 'a newer sign-in replaces the older code');
  assert.equal((await verify(ctx.app, second.body.data.challenge, ctx.sent[1].code)).status, 200);
});

test('resend: waits a minute between codes, replaces the old one, and stops after the limit', async () => {
  const ctx = await build();
  const { challenge } = (await login(ctx.app)).body.data;
  const resend = () => request(ctx.app).post('/api/auth/otp/resend').send({ challenge });
  const early = await resend();
  assert.equal(early.status, 429);
  assert.match(early.body.error.message, /wait \d+ seconds/);
  assert.equal(ctx.sent.length, 1);

  ctx.prisma.otps[0].attempts = 3;
  ctx.prisma.otps[0].lastSentAt = new Date(Date.now() - OTP_RESEND_COOLDOWN_MS - 1000);
  assert.equal((await resend()).status, 200);
  assert.equal(ctx.sent.length, 2);
  assert.equal(ctx.prisma.otps[0].attempts, 0);
  if (ctx.sent[0].code !== ctx.sent[1].code) assert.equal((await verify(ctx.app, challenge, ctx.sent[0].code)).status, 400, 'the old code is gone');

  ctx.prisma.otps[0].sendCount = OTP_MAX_SENDS;
  ctx.prisma.otps[0].lastSentAt = new Date(Date.now() - OTP_RESEND_COOLDOWN_MS - 1000);
  assert.equal((await resend()).status, 400);
  assert.equal(ctx.sent.length, 2);
});

test('email failure: says so plainly, starts nothing and leaves no usable code', async () => {
  const ctx = await build({ failDelivery: true });
  const output = await captureConsole(async () => {
    const res = await login(ctx.app);
    assert.equal(res.status, 503);
    assert.match(res.body.error.message, /could not email your code/);
    assert.equal(hasSession(res), false);
  });
  assert.equal(ctx.prisma.otps.length, 0);
  assert.match(output, /SMTP refused/);
});

test('no email set up: sign-in and sign-up refuse clearly, before creating anything', async () => {
  const ctx = await build();
  await withoutEmail(async () => {
    assert.deepEqual(otpAvailability({ NODE_ENV: 'production' }), { available: false, viaServerLog: false });
    const res = await login(ctx.app);
    assert.equal(res.status, 503);
    assert.match(res.body.error.message, /email is not set up/);
    const signup = await request(ctx.app).post('/api/auth/register').send({ email: 'new@example.com', password: NEW_PASSWORD });
    assert.equal(signup.status, 503);
  });
  assert.equal(ctx.prisma.otps.length, 0);
  assert.equal(ctx.prisma.people.length, 1);
});

test('createApp leaves codes off unless asked, so other tests can still sign in directly', async () => {
  const ctx = await build({ emailOtp: false });
  const res = await login(ctx.app);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.email, EMAIL);
  assert.equal(hasSession(res), true);
  assert.equal(ctx.sent.length, 0);
});

/* ---------- Signing up ---------- */
test('sign-up: the account stays unconfirmed and signed out until the code is entered', async () => {
  const ctx = await build();
  const res = await request(ctx.app).post('/api/auth/register').send({ email: 'new@example.com', password: NEW_PASSWORD, name: 'New' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.otpRequired, true);
  assert.equal(hasSession(res), false);
  const created = ctx.prisma.people.find((c) => c.email === 'new@example.com');
  assert.equal(created.emailVerifiedAt, null);
  assert.equal(ctx.sent[0].purpose, 'signup');

  const done = await verify(ctx.app, res.body.data.challenge, ctx.sent[0].code);
  assert.equal(done.status, 200);
  assert.equal(hasSession(done), true);
  assert.ok(created.emailVerifiedAt instanceof Date);
});

test('sign-up: a confirmed address cannot be taken over by registering it again', async () => {
  const ctx = await build();
  const before = ctx.account.passwordHash;
  const res = await request(ctx.app).post('/api/auth/register').send({ email: EMAIL, password: NEW_PASSWORD });
  assert.equal(res.status, 409);
  assert.equal(ctx.account.passwordHash, before);
  assert.equal(ctx.sent.length, 0);
});

test('sign-up: an unconfirmed address can register again, but only the emailed code gets in', async () => {
  const ctx = await build({ customers: { emailVerifiedAt: null } });
  const res = await request(ctx.app).post('/api/auth/register').send({ email: EMAIL, password: NEW_PASSWORD });
  assert.equal(res.status, 201);
  assert.equal(hasSession(res), false);
  assert.equal(await verifyPassword(NEW_PASSWORD, ctx.account.passwordHash), true);
  assert.equal(ctx.sent[0].email, EMAIL, 'the code goes to the address owner');
  assert.equal(ctx.account.emailVerifiedAt, null);
});

/* ---------- Password reset ---------- */
const forgot = (app, email) => request(app).post('/api/auth/forgot-password').send({ email });

test('reset: the answer never reveals who has an account', async () => {
  const ctx = await build();
  const known = await forgot(ctx.app, EMAIL);
  const unknown = await forgot(ctx.app, 'nobody@example.com');
  const invalid = await forgot(ctx.app, 'not-an-email');
  for (const res of [known, unknown, invalid]) {
    assert.equal(res.status, 200);
    assert.match(res.body.data.challenge, /^[a-f0-9]{64}$/);
    assert.equal(res.body.data.message, known.body.data.message);
  }
  assert.doesNotMatch(known.body.data.message, /has been sent/);
  await wait(60);
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].purpose, 'reset');
  const wrongMessage = (await request(ctx.app).post('/api/auth/reset-password').send({ challenge: known.body.data.challenge, code: ctx.sent[0].code === '000000' ? '111111' : '000000', password: NEW_PASSWORD })).body.error.message;
  const unknownMessage = (await request(ctx.app).post('/api/auth/reset-password').send({ challenge: unknown.body.data.challenge, code: '000000', password: NEW_PASSWORD })).body.error.message;
  assert.equal(wrongMessage, unknownMessage);
});

test('reset: repeated requests do not flood an inbox or replace the code', async () => {
  const ctx = await build();
  await forgot(ctx.app, EMAIL);
  await wait(40);
  await forgot(ctx.app, EMAIL);
  await forgot(ctx.app, EMAIL);
  await wait(40);
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.prisma.otps.length, 1);
});

test('reset: the right code changes the password once, and signs out every device', async () => {
  const ctx = await build();
  const phone = await signIn(ctx);
  const laptop = await signIn(ctx);
  const { challenge } = (await forgot(ctx.app, EMAIL)).body.data;
  await wait(40);
  const { code } = ctx.sent[ctx.sent.length - 1];

  const res = await request(ctx.app).post('/api/auth/reset-password').set('Cookie', phone.header).send({ challenge, code, password: NEW_PASSWORD });
  assert.equal(res.status, 200);
  assert.match(res.body.data.message, /signed out/);
  assert.equal(await verifyPassword(NEW_PASSWORD, ctx.account.passwordHash), true);
  assert.equal(await isSignedIn(ctx.app, phone.header), false);
  assert.equal(await isSignedIn(ctx.app, laptop.header), false);
  assert.ok(res.headers['set-cookie'].some((c) => c.startsWith('zaevi.sid=;')), 'cookie cleared');
  assert.equal((await login(ctx.app, OLD_PASSWORD)).status, 401);

  const again = await request(ctx.app).post('/api/auth/reset-password').send({ challenge, code, password: 'another-password-33' });
  assert.equal(again.status, 400);
  assert.equal(await verifyPassword(NEW_PASSWORD, ctx.account.passwordHash), true);
});

test('reset: a too-short password is refused without using up a guess', async () => {
  const ctx = await build();
  const { challenge } = (await forgot(ctx.app, EMAIL)).body.data;
  await wait(40);
  assert.equal((await request(ctx.app).post('/api/auth/reset-password').send({ challenge, code: ctx.sent[0].code, password: 'short' })).status, 400);
  assert.equal(ctx.prisma.otps[0].attempts, 0);
  assert.equal(ctx.prisma.otps[0].consumedAt, null);
});

test('reset: a sign-in code cannot reset a password, and a reset code cannot sign in', async () => {
  const ctx = await build();
  const before = ctx.account.passwordHash;
  const first = await login(ctx.app);
  const blocked = await request(ctx.app).post('/api/auth/reset-password').send({ challenge: first.body.data.challenge, code: ctx.sent[0].code, password: NEW_PASSWORD });
  assert.equal(blocked.status, 400);
  assert.equal(ctx.account.passwordHash, before);

  const { challenge } = (await forgot(ctx.app, EMAIL)).body.data;
  await wait(40);
  const res = await verify(ctx.app, challenge, ctx.sent[ctx.sent.length - 1].code);
  assert.equal(res.status, 400);
  assert.equal(hasSession(res), false);
});

test('reset: without email, it says so and creates nothing', async () => {
  const ctx = await build();
  await withoutEmail(async () => {
    const status = await request(ctx.app).get('/api/auth/password-reset/status');
    assert.equal(status.body.data.available, false);
    const res = await forgot(ctx.app, EMAIL);
    assert.equal(res.status, 503);
    assert.match(res.body.error.message, /not available yet/);
    assert.doesNotMatch(JSON.stringify(res.body), /we will send/i);
    await wait(40);
  });
  assert.equal(ctx.prisma.otps.length, 0);
});

/* ---------- Logs ---------- */
const refusal = async () => ({ status: 'not_configured', error: 'Email is not configured' });
const DEV = { NODE_ENV: 'development', DATABASE_URL: 'mysql://root@127.0.0.1:3306/zaevi_test' };

test('logs: a code reaches the log only in development on the development database, when email cannot deliver', async () => {
  const logged = await captureConsole(() => sendOtpEmail({ email: 'a@example.com', code: CODE, purpose: 'login' }, { env: DEV, send: refusal }));
  assert.match(logged, new RegExp(CODE));
  assert.equal(canLogOtp('a@example.com', DEV), true);
});

test('logs: .test demo addresses log their code in development, while real addresses are emailed', async () => {
  const withSmtp = { ...DEV, ...SMTP_ENV };
  const sent = [];
  const send = async (message) => { sent.push(message); return { status: 'sent', error: null }; };
  const demo = await captureConsole(() => sendOtpEmail({ email: 'demo.admin@zaevi.test', code: CODE, purpose: 'login' }, { env: withSmtp, send }));
  assert.match(demo, new RegExp(CODE));
  assert.equal(sent.length, 0);
  const real = await captureConsole(() => sendOtpEmail({ email: 'real@example.com', code: CODE, purpose: 'login' }, { env: withSmtp, send }));
  assert.doesNotMatch(real, new RegExp(CODE));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, new RegExp(CODE));
});

test('logs: a code never reaches a log in production, staging or any other setting', async () => {
  const environments = [
    { NODE_ENV: 'production', ZAEVI_PRODUCTION_DB_APPROVED: 'true', DATABASE_URL: 'mysql://root@127.0.0.1:3306/zaevi' },
    { NODE_ENV: 'production', ...SMTP_ENV },
    { NODE_ENV: 'staging' },
    { NODE_ENV: 'test', DATABASE_URL: 'mysql://root@127.0.0.1:3306/zaevi_test' },
    {},
    { NODE_ENV: 'development', DATABASE_URL: 'mysql://root@127.0.0.1:3306/another_database' },
  ];
  for (const env of environments) {
    const output = await captureConsole(async () => {
      await assert.rejects(sendOtpEmail({ email: 'demo.admin@zaevi.test', code: CODE, purpose: 'login' }, { env, send: refusal }));
    });
    assert.doesNotMatch(output, new RegExp(CODE), JSON.stringify(env));
  }
});

test('logs: an email failure that repeats the code does not expose it', async () => {
  const env = { NODE_ENV: 'production' };
  const failing = async ({ text }) => ({ status: 'failed', error: `SMTP refused: ${text}` });
  await assert.rejects(sendOtpEmail({ email: 'a@example.com', code: CODE, purpose: 'login' }, { env, send: failing }), (error) => {
    assert.doesNotMatch(error.message, new RegExp(CODE));
    return true;
  });
});

test('codes are not stored in the email log', async () => {
  const ctx = await build();
  ctx.prisma.notification = { create: async () => { throw new Error('a code must not be recorded as a notification'); } };
  assert.equal((await login(ctx.app)).status, 200);
});

/* ---------- Changing a password ---------- */
test('changing a password signs out other devices, rotates this one and cancels reset codes', async () => {
  const ctx = await build();
  const here = await signIn(ctx);
  const elsewhere = await signIn(ctx);
  await forgot(ctx.app, EMAIL);
  await wait(40);
  assert.ok(ctx.prisma.otps.some((o) => o.purpose === 'reset'));

  const res = await request(ctx.app).post('/api/customer/change-password')
    .set('Cookie', here.header).set('x-csrf-token', here.csrf)
    .send({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(await verifyPassword(NEW_PASSWORD, ctx.account.passwordHash), true);
  assert.equal(await isSignedIn(ctx.app, elsewhere.header), false, 'other device signed out');
  assert.equal(await isSignedIn(ctx.app, here.header), false, 'old session ID no longer works');
  assert.equal(ctx.prisma.otps.some((o) => o.purpose === 'reset'), false);

  const newSid = res.headers['set-cookie'].map((c) => c.split(';')[0]).find((c) => c.startsWith('zaevi.sid='));
  const rotated = `${newSid}; zaevi.csrf=${encodeURIComponent(here.csrf)}`;
  assert.equal(await isSignedIn(ctx.app, rotated), true, 'this device continues');
  const again = await request(ctx.app).post('/api/customer/change-password')
    .set('Cookie', rotated).set('x-csrf-token', here.csrf)
    .send({ currentPassword: NEW_PASSWORD, newPassword: 'third-password-3333' });
  assert.equal(again.status, 200, 'CSRF token still valid on the new session');
});

test('a wrong current password changes nothing and signs nobody out', async () => {
  const ctx = await build();
  const here = await signIn(ctx);
  const elsewhere = await signIn(ctx);
  const before = ctx.account.passwordHash;
  const res = await request(ctx.app).post('/api/customer/change-password')
    .set('Cookie', here.header).set('x-csrf-token', here.csrf)
    .send({ currentPassword: 'wrong-password-123', newPassword: NEW_PASSWORD });
  assert.equal(res.status, 401);
  assert.equal(ctx.account.passwordHash, before);
  assert.equal(await isSignedIn(ctx.app, here.header), true);
  assert.equal(await isSignedIn(ctx.app, elsewhere.header), true);
});

test('one customer changing a password leaves other customers signed in', async () => {
  const { sessionStore } = await import('../src/middleware/session.js');
  const other = await sessionStore.create(999);
  const mine = await sessionStore.create(1000);
  await sessionStore.destroyAllForCustomer(1000);
  assert.ok(await sessionStore.get(other.sessionIdHash));
  assert.equal(await sessionStore.get(mine.sessionIdHash), null);
  await sessionStore.destroy(other.sessionIdHash);
});
