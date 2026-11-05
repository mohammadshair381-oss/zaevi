import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { sendEmail, getEmailConfig, transportOptions, verifyEmailConnection } from '../src/services/email.js';
import { recordNotification, retryNotification } from '../src/services/notification.js';
import { deliverContactNotification, parseContactMessage } from '../src/routes/contact.js';
import { assertCouponUsable } from '../src/routes/coupons.js';
import { findNewsletterOffer } from '../src/routes/newsletter.js';
import { isPublicStaticPath } from '../src/middleware/security.js';

const silentLogger = { error() {}, warn() {}, info() {}, log() {} };
const SESSION_SECRET = 'test-session-secret-at-least-32-characters';

/** A minimal SMTP server, so delivery is tested over a real socket without any account. */
function startSmtpServer() {
  const messages = [];
  const signIns = [];
  const server = net.createServer((socket) => {
    let inData = false;
    let data = '';
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk) => {
      const text = chunk.toString();
      if (inData) {
        data += text;
        if (data.endsWith('\r\n.\r\n')) {
          inData = false;
          messages.push(data);
          data = '';
          socket.write('250 queued\r\n');
        }
        return;
      }
      for (const line of text.split('\r\n').filter(Boolean)) {
        if (/^EHLO/i.test(line)) socket.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH PLAIN /i.test(line)) {
          const [, user, pass] = Buffer.from(line.split(' ')[2], 'base64').toString().split(String.fromCharCode(0));
          signIns.push({ user, pass });
          socket.write(user === 'store-user' && pass === 'store-pass' ? '235 signed in\r\n' : '535 wrong password\r\n');
        }
        else if (/^HELO/i.test(line)) socket.write('250 test\r\n');
        else if (/^DATA/i.test(line)) { inData = true; socket.write('354 go\r\n'); }
        else if (/^QUIT/i.test(line)) { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 ok\r\n');
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, messages, signIns, close: () => new Promise((r) => server.close(r)) }));
  });
}

const smtpEnv = (port) => ({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_USER: 'store-user', SMTP_PASS: 'store-pass', EMAIL_FROM: 'ZAEVI <no-reply@example.com>', CONTACT_NOTIFY_EMAIL: 'team@example.com' });

test('email: reports not_configured without attempting delivery', async () => {
  assert.equal(getEmailConfig({}).configured, false);
  const result = await sendEmail({ to: 'a@example.com', subject: 's', text: 't' }, { env: {} });
  assert.equal(result.status, 'not_configured');
});

test('email: delivers over SMTP and reports sent', async () => {
  const smtp = await startSmtpServer();
  try {
    const result = await sendEmail({ to: 'a@example.com', subject: 'Hello there', text: 'Body text' }, { env: smtpEnv(smtp.port) });
    assert.equal(result.status, 'sent');
    assert.equal(smtp.messages.length, 1);
    assert.match(smtp.messages[0], /Subject: Hello there/);
    assert.match(smtp.messages[0], /Body text/);
  } finally {
    await smtp.close();
  }
});

test('email: all four settings are required, so nothing is ever sent without signing in', () => {
  const all = { SMTP_HOST: 'mail.example.com', SMTP_USER: 'u', SMTP_PASS: 'p', EMAIL_FROM: 'a@example.com' };
  assert.equal(getEmailConfig(all).configured, true);
  for (const key of Object.keys(all)) {
    assert.equal(getEmailConfig({ ...all, [key]: '' }).configured, false, key);
  }
});

test('email: signs in to the mail server with the configured username and password', async () => {
  const smtp = await startSmtpServer();
  try {
    const result = await sendEmail({ to: 'a@example.com', subject: 's', text: 't' }, { env: smtpEnv(smtp.port) });
    assert.equal(result.status, 'sent');
    assert.deepEqual(smtp.signIns, [{ user: 'store-user', pass: 'store-pass' }]);
    assert.equal((await verifyEmailConnection({ env: smtpEnv(smtp.port) })).status, 'ok');
  } finally {
    await smtp.close();
  }
});

test('email: a wrong password is reported as failed and sends nothing', async () => {
  const smtp = await startSmtpServer();
  try {
    const env = { ...smtpEnv(smtp.port), SMTP_PASS: 'wrong-password' };
    const result = await sendEmail({ to: 'a@example.com', subject: 's', text: 't' }, { env });
    assert.equal(result.status, 'failed');
    assert.equal(smtp.messages.length, 0);
    assert.doesNotMatch(result.error, /wrong-password/, 'the password is never in the error');
    assert.equal((await verifyEmailConnection({ env })).status, 'failed');
  } finally {
    await smtp.close();
  }
});

test('email: the password is never sent over an unencrypted connection to another machine', () => {
  const base = { host: 'mail.example.com', port: 587, secure: false, user: 'u', pass: 'p' };
  assert.equal(transportOptions(base).requireTLS, true);
  assert.deepEqual(transportOptions(base).auth, { user: 'u', pass: 'p' });
  assert.equal(transportOptions({ ...base, port: 465, secure: true }).requireTLS, false, 'port 465 is already encrypted');
  assert.equal(transportOptions({ ...base, host: '127.0.0.1' }).requireTLS, false, 'a relay on this machine');
});

test('email: a refused connection is reported as failed, never thrown', async () => {
  const closed = await startSmtpServer();
  const { port } = closed;
  await closed.close();
  const result = await sendEmail({ to: 'a@example.com', subject: 's', text: 't' }, { env: smtpEnv(port) });
  assert.equal(result.status, 'failed');
  assert.ok(result.error);
});

function contactDb() {
  const rows = [];
  return {
    rows,
    contactMessage: {
      create: async ({ data }) => { const row = { id: rows.length + 1, ...data }; rows.push(row); return row; },
      update: async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id), data),
    },
  };
}
const validMessage = { name: 'Asha', email: 'Asha@Example.com', subject: 'Order support', message: 'Where is my order?', order: 'ZV-1' };

test('contact: stores a valid message and returns no invented case number', async () => {
  const db = contactDb();
  const app = createApp({ db, logger: silentLogger, sessionSecret: SESSION_SECRET });
  const res = await request(app).post('/api/contact').send(validMessage);
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { data: { received: true } });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].email, 'asha@example.com');
  assert.equal(db.rows[0].orderReference, 'ZV-1');
});

test('contact: rejects invalid input and stores nothing', async () => {
  const db = contactDb();
  const app = createApp({ db, logger: silentLogger, sessionSecret: SESSION_SECRET });
  for (const bad of [{ ...validMessage, email: 'nope' }, { ...validMessage, name: ' ' }, { ...validMessage, subject: 'Other' }, { ...validMessage, message: 'hi' }]) {
    const res = await request(app).post('/api/contact').send(bad);
    assert.equal(res.status, 400);
  }
  assert.equal(db.rows.length, 0);
});

test('contact: the honeypot field is not stored', async () => {
  const db = contactDb();
  const app = createApp({ db, logger: silentLogger, sessionSecret: SESSION_SECRET });
  const res = await request(app).post('/api/contact').send({ ...validMessage, website: 'http://spam.example' });
  assert.equal(res.status, 201);
  assert.equal(db.rows.length, 0);
});

test('contact: a database failure is an error, not a false success', async () => {
  const db = { contactMessage: { create: async () => { throw new Error('db down'); } } };
  const app = createApp({ db, logger: silentLogger, sessionSecret: SESSION_SECRET });
  const res = await request(app).post('/api/contact').send(validMessage);
  assert.equal(res.status, 500);
});

test('contact: line breaks cannot reach email headers', () => {
  const parsed = parseContactMessage({ ...validMessage, name: 'Asha\r\nBcc: victim@example.com' });
  assert.doesNotMatch(parsed.name, /[\r\n]/);
});

test('contact: notification outcome is recorded for sent, failed and unconfigured', async () => {
  const db = contactDb();
  const row = await db.contactMessage.create({ data: parseContactMessage(validMessage) });

  await deliverContactNotification(db, row, { env: {} });
  assert.equal(db.rows[0].notifyStatus, 'not_configured');

  const smtp = await startSmtpServer();
  await deliverContactNotification(db, row, { env: smtpEnv(smtp.port) });
  assert.equal(db.rows[0].notifyStatus, 'sent');
  assert.equal(db.rows[0].notifyError, null);
  assert.match(smtp.messages[0], /Reply-To: asha@example.com/);
  const { port } = smtp;
  await smtp.close();

  await deliverContactNotification(db, row, { env: smtpEnv(port) });
  assert.equal(db.rows[0].notifyStatus, 'failed');
  assert.ok(db.rows[0].notifyError);
});

test('notifications: stored first, with the real outcome and no fake recipient', async () => {
  const rows = [];
  const db = {
    notification: {
      create: async ({ data }) => { const row = { id: rows.length + 1, ...data }; rows.push(row); return { ...row }; },
      update: async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id), data),
      findUnique: async ({ where }) => rows.find((r) => r.id === where.id) || null,
    },
  };
  assert.equal(await recordNotification(db, { type: 'x', subject: 's', content: 'c' }), null);
  const row = await recordNotification(db, { recipientEmail: 'a@example.com', type: 'x', subject: 's', content: 'c' });
  assert.equal(row.status, 'pending');
  const retried = await retryNotification(db, row.id);
  assert.notEqual(retried.status, 'sent');
  assert.equal(await retryNotification(db, 999), null);
});

const ATELIER10 = { id: 1, code: 'ATELIER10', isActive: true, discountType: 'percentage', discountValue: 10, usageLimit: 1000, usedCount: 0, perCustomerLimit: 1, requiresNewsletter: true, expiresAt: new Date('2027-11-03T18:29:59Z') };
function couponDb({ subscriber = { status: 'subscribed' }, usage = 0 } = {}) {
  return {
    newsletterSubscriber: { findUnique: async () => subscriber },
    couponUsage: { count: async () => usage },
    coupon: { findFirst: async () => ATELIER10 },
  };
}
const usable = (db, coupon = ATELIER10, extra = {}) => assertCouponUsable(db, coupon, { subtotalMinor: 100000, email: 'a@example.com', customerId: 7, ...extra });

test('ATELIER10: a subscriber who has not used it is accepted', async () => {
  await usable(couponDb());
});

test('ATELIER10: only for current newsletter subscribers', async () => {
  await assert.rejects(usable(couponDb({ subscriber: null })), /newsletter subscribers/);
  await assert.rejects(usable(couponDb({ subscriber: { status: 'unsubscribed' } })), /newsletter subscribers/);
  await assert.rejects(usable(couponDb(), ATELIER10, { email: '' }), /newsletter subscribers/);
});

test('ATELIER10: one use per customer', async () => {
  await assert.rejects(usable(couponDb({ usage: 1 })), /already redeemed/);
});

test('ATELIER10: expiry, total limit and active flag are enforced', async () => {
  await assert.rejects(usable(couponDb(), { ...ATELIER10, expiresAt: new Date('2020-01-01') }), /expired/);
  await assert.rejects(usable(couponDb(), { ...ATELIER10, usedCount: 1000 }), /maximum usage limit/);
  await assert.rejects(usable(couponDb(), { ...ATELIER10, isActive: false }), /Invalid or expired/);
  await assert.rejects(usable(couponDb(), null), /Invalid or expired/);
});

test('newsletter offer text comes from the coupon, and is withheld when used up', async () => {
  const offer = await findNewsletterOffer(couponDb());
  assert.equal(offer.code, 'ATELIER10');
  assert.equal(offer.percent, 10);
  assert.match(offer.message, /ATELIER10.*10% off one order.*3 November 2027/);
  const usedUp = { coupon: { findFirst: async () => ({ ...ATELIER10, usedCount: 1000 }) } };
  assert.equal(await findNewsletterOffer(usedUp), null);
});

test('newsletter subscribe returns the offer', async () => {
  const db = {
    ...couponDb(),
    newsletterSubscriber: { findUnique: async () => null, create: async () => ({ id: 1 }) },
  };
  const app = createApp({ db, logger: silentLogger, sessionSecret: SESSION_SECRET });
  const res = await request(app).post('/api/newsletter/subscribe').send({ email: 'new@example.com' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.offer.code, 'ATELIER10');
});

test('legal pages are served publicly', () => {
  for (const page of ['/privacy.html', '/terms.html', '/accessibility.html']) {
    assert.equal(isPublicStaticPath(page), true);
  }
});

test('payments: unconfigured Razorpay reports not configured and exposes no key', async () => {
  const before = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  try {
    const app = createApp({ db: {}, logger: silentLogger, sessionSecret: SESSION_SECRET });
    const res = await request(app).get('/api/payments/config');
    assert.deepEqual(res.body.data, { configured: false, keyId: null });
  } finally {
    if (before.id) process.env.RAZORPAY_KEY_ID = before.id;
    if (before.secret) process.env.RAZORPAY_KEY_SECRET = before.secret;
  }
});

test('payments: webhook rejects bad signatures, including wrong lengths, and applies a valid capture', async () => {
  const before = process.env.RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = 'unit-test-only-secret';
  const updates = [];
  const db = {
    paymentEvent: { findUnique: async () => null, create: async () => ({}) },
    payment: { updateMany: async (args) => { updates.push(args); return { count: 1 }; } },
  };
  const app = createApp({ db, logger: silentLogger, sessionSecret: SESSION_SECRET });
  const body = JSON.stringify({ id: 'evt_1', event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', method: 'upi' } } } });
  const post = (signature) => {
    const r = request(app).post('/api/payments/webhook').set('Content-Type', 'application/json');
    if (signature) r.set('x-razorpay-signature', signature);
    return r.send(body);
  };
  try {
    assert.equal((await post()).status, 400);
    assert.equal((await post('short')).status, 400);
    assert.equal(updates.length, 0);
    const signature = crypto.createHmac('sha256', 'unit-test-only-secret').update(body).digest('hex');
    assert.equal((await post(signature)).status, 200);
    assert.equal(updates[0].where.providerOrderId, 'order_1');
    assert.equal(updates[0].data.status, 'captured');
  } finally {
    if (before === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = before;
  }
});
