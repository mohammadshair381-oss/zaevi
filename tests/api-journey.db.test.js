// Walks the whole shop over HTTP on a real MongoDB database: every route group a customer or
// admin uses, including ones that only ever had fake clients or no tests at all. Razorpay is
// stubbed. Skipped when no database is reachable, and refuses any database not named *zaevi_test.
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { resolveDatabaseName } from '../src/config/database.js';
import { getDbClient, disconnectDB } from '../src/db/connect.js';
import { hashPassword } from '../src/models/auth.js';
import { STUDIO_DEFAULT_STATE } from '../src/models/site-studio.js';

if (process.env.MONGODB_URI && !resolveDatabaseName().endsWith('zaevi_test')) {
  throw new Error('api-journey.db.test.js refuses to run against this database');
}

const SECRET = 'api-journey-test-secret-of-32-characters';
const TAG = crypto.randomBytes(4).toString('hex');
const PASSWORD = 'Journey-Password-2026!';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2XQAAAAASUVORK5CYII=';
const silentLogger = { error() {}, warn() {}, info() {}, log() {} };

function browser(app) {
  const cookies = new Map();
  const call = async (method, url, body, headers = {}) => {
    let req = request(app)[method](url);
    if (cookies.size) req = req.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    if (cookies.has('zaevi.csrf')) req = req.set('x-csrf-token', decodeURIComponent(cookies.get('zaevi.csrf')));
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    const res = await (body === undefined ? req : req.send(body));
    for (const line of res.headers['set-cookie'] ?? []) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(line)) cookies.delete(pair.slice(0, at));
      else cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return res;
  };
  return {
    get: (url) => call('get', url),
    post: (url, body = {}, headers) => call('post', url, body, headers),
    put: (url, body = {}) => call('put', url, body),
    patch: (url, body = {}) => call('patch', url, body),
    del: (url) => call('delete', url),
    signIn: (email, password = PASSWORD) => call('post', '/api/auth/login', { email, password }),
  };
}

const ok = (res, status = 200) => {
  assert.equal(res.status, status, `${res.request?.method} ${res.request?.url}: ${JSON.stringify(res.body).slice(0, 300)}`);
  return res.body.data ?? res.body;
};

const orderBody = (email, extra = {}) => ({
  email,
  phone: '9876543210',
  shippingName: 'Journey Tester',
  shippingAddress: '12 Silk Lane',
  shippingCity: 'Mumbai',
  shippingPostalCode: '400001',
  shippingCountry: 'IN',
  items: [{ productId: 'ZV001', size: 'S', quantity: 2 }, { productId: 'ZV003', size: 'M', quantity: 1 }],
  ...extra,
});
const key = () => `journey-${crypto.randomBytes(6).toString('hex')}`;

test('the whole shop works over HTTP on a real database', async (t) => {
  if (!process.env.MONGODB_URI) return t.skip('MONGODB_URI is not set; skipping live database test');
  const db = getDbClient();
  try {
    await db.$ping();
  } catch (error) {
    t.diagnostic(`database unavailable: ${error.message}`);
    return t.skip('MongoDB is not reachable; skipping live database test');
  }

  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_journey';
  process.env.RAZORPAY_KEY_SECRET = 'journey-key-secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'journey-webhook-secret';
  const razorpay = [];
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.razorpay.com/')) return realFetch(url, options);
    razorpay.push(String(url));
    const body = String(url).endsWith('/refund') ? { id: `rfnd_${key()}` } : { id: `order_${key()}` };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const app = createApp({ logger: silentLogger, sessionSecret: SECRET, requireAuthForOrders: true, orderRateLimit: false, loginRateLimit: false, authRateLimit: false, contactRateLimit: false, newsletterRateLimit: false });
  const passwordHash = await hashPassword(PASSWORD);
  const adminEmail = `journey-admin-${TAG}@zaevi.test`;
  const shopperEmail = `journey-shopper-${TAG}@zaevi.test`;
  const adminRow = await db.customer.create({ data: { email: adminEmail, role: 'admin', name: 'Journey Admin', passwordHash, emailVerifiedAt: new Date() } });
  const shopperRow = await db.customer.create({ data: { email: shopperEmail, name: 'Journey Shopper', passwordHash, emailVerifiedAt: new Date() } });
  const created = { products: [], coupons: [], reviews: [], messages: [], media: [], pages: [] };
  const studioBefore = await db.siteStudio.findUnique({ where: { id: 1 } });
  const shopper = browser(app);
  const admin = browser(app);
  ok(await shopper.signIn(shopperEmail));
  ok(await admin.signIn(adminEmail));

  try {
    let order, couponId, firstAddress;

    await t.test('catalogue', async () => {
      const list = ok(await browser(app).get('/api/products?limit=100'));
      assert.equal(list.length, 12);
      const page = (await browser(app).get('/api/products?limit=5&page=2')).body;
      assert.equal(page.data.length, 5);
      assert.equal(page.pagination.total, 12);
      const product = ok(await browser(app).get('/api/products/ZV001'));
      assert.ok(product.sizes.length > 0);
      assert.equal('stock' in product, false);
      assert.equal(ok(await browser(app).get('/api/products/zv001')).id, 'ZV001', 'ids ignore case, as they did');
      assert.equal((await browser(app).get('/api/products/NOPE')).status, 404);
      const category = list[0].category;
      assert.ok(ok(await browser(app).get(`/api/products?category=${encodeURIComponent(category.toUpperCase())}`)).length > 0, 'category ignores case');
      const word = list[0].name.split(' ')[0].toLowerCase();
      assert.ok(ok(await browser(app).get(`/api/products?search=${encodeURIComponent(word)}`)).some((p) => p.id === list[0].id), 'search ignores case');
    });

    await t.test('profile and addresses', async () => {
      assert.equal(ok(await shopper.get('/api/auth/me')).email, shopperEmail);
      assert.equal(ok(await shopper.patch('/api/customer/profile', { name: 'New Name', phone: '9876543210' })).name, 'New Name');
      const address = (extra) => ({ fullName: 'Journey Tester', phone: '9876543210', addressLine1: '12 Silk Lane', city: 'Mumbai', state: 'Maharashtra', postalCode: '400001', ...extra });
      firstAddress = ok(await shopper.post('/api/customer/addresses', address({ isDefault: true })), 201);
      const second = ok(await shopper.post('/api/customer/addresses', address({ label: 'Office' })), 201);
      ok(await shopper.post(`/api/customer/addresses/${second.id}/default`));
      let all = ok(await shopper.get('/api/customer/addresses'));
      assert.deepEqual(all.filter((a) => a.isDefault).map((a) => a.id), [second.id], 'only one default');
      assert.equal(all[0].id, second.id, 'default listed first');
      assert.equal(ok(await shopper.patch(`/api/customer/addresses/${second.id}`, { city: 'Pune' })).city, 'Pune');
      assert.equal((await admin.patch(`/api/customer/addresses/${second.id}`, { city: 'Other' })).status, 404, 'not someone else\'s address');
      ok(await shopper.del(`/api/customer/addresses/${second.id}`));
      all = ok(await shopper.get('/api/customer/addresses'));
      assert.equal(all.length, 1);
    });

    await t.test('coupons: admin management and preview', async () => {
      const code = `J${TAG}`.toUpperCase();
      const coupon = ok(await admin.post('/api/admin/coupons', { code, discountType: 'percentage', discountValue: 10, usageLimit: 1 }), 201);
      couponId = coupon.id;
      created.coupons.push(coupon.id);
      assert.equal((await admin.post('/api/admin/coupons', { code, discountValue: 5 })).status, 409);
      assert.equal((await shopper.get('/api/admin/coupons')).status, 404);
      assert.ok(ok(await admin.get('/api/admin/coupons')).some((c) => c.id === coupon.id));
      assert.equal(ok(await admin.patch(`/api/admin/coupons/${coupon.id}`, { description: 'Journey' })).description, 'Journey');
      const preview = ok(await shopper.post('/api/coupons/validate', { code: code.toLowerCase(), subtotalMinor: 100000, email: shopperEmail }));
      assert.equal(preview.discountMinor, 10000);
    });

    await t.test('checkout with a saved address and a coupon', async () => {
      const code = `J${TAG}`.toUpperCase();
      const k = key();
      const body = orderBody(shopperEmail, { addressId: firstAddress.id, couponCode: code });
      order = ok(await shopper.post('/api/orders', body, { 'Idempotency-Key': k }), 201);
      const row = await db.order.findUnique({ where: { reference: order.reference } });
      assert.ok(row.discountMinor > 0);
      assert.equal(row.totalMinor, row.subtotalMinor - row.discountMinor);
      assert.equal(order.totalMinor, row.totalMinor);
      assert.equal(order.items.length, 2);
      assert.equal(ok(await shopper.post('/api/orders', body, { 'Idempotency-Key': k })).reference, order.reference, 'a repeat returns the same order');
      assert.equal((await shopper.post('/api/orders', orderBody(shopperEmail, { addressId: firstAddress.id, couponCode: code, items: [{ productId: 'ZV001', size: 'S', quantity: 5 }] }), { 'Idempotency-Key': k })).status, 409);
      assert.equal((await browser(app).post('/api/orders', body, { 'Idempotency-Key': key() })).status, 401);
      const stored = await db.coupon.findUnique({ where: { id: couponId } });
      assert.equal(stored.usedCount, 1);
      assert.equal(await db.couponUsage.count({ where: { couponId } }), 1);
      assert.equal((await admin.post('/api/orders', orderBody(adminEmail, { couponCode: code }), { 'Idempotency-Key': key() })).status, 400, 'used up');
      assert.ok(await db.notification.findFirst({ where: { recipientEmail: shopperEmail, type: 'order_confirmation' } }));
    });

    await t.test('a product edit never rewrites a past order', async () => {
      const before = (await db.order.findUnique({ where: { reference: order.reference }, include: { items: true } })).items;
      const product = await db.product.findUnique({ where: { id: 'ZV001' } });
      ok(await admin.patch('/api/admin/products/ZV001', { price: product.price + 1 }));
      const after = (await db.order.findUnique({ where: { reference: order.reference }, include: { items: true } })).items;
      assert.deepEqual(after, before);
      ok(await admin.patch('/api/admin/products/ZV001', { price: product.price }));
    });

    await t.test('order views, tracking and invoice', async () => {
      const list = (await shopper.get('/api/customer/orders')).body;
      assert.ok(list.data.some((o) => o.reference === order.reference));
      const detail = ok(await shopper.get(`/api/customer/orders/${order.reference}`));
      assert.equal(detail.items.length, 2);
      assert.ok(detail.statusHistory?.length >= 1 || detail.timeline);
      assert.equal((await admin.get(`/api/customer/orders/${order.reference}`)).status, 404, 'not another customer\'s order');
      assert.equal(ok(await browser(app).post('/api/orders/track', { reference: order.reference, email: shopperEmail })).reference, order.reference);
      assert.equal((await browser(app).post('/api/orders/track', { reference: order.reference, email: 'wrong@zaevi.test' })).status, 404);
      const invoice = await shopper.get(`/api/orders/${order.reference}/invoice`);
      assert.equal(invoice.status, 200);
      assert.ok(invoice.text.includes(order.reference));
      assert.ok(invoice.text.includes('NOT YET PAID'));
      assert.equal((await admin.get(`/api/orders/${order.reference}/invoice`)).status, 200, 'admins can see any invoice');
    });

    let payment, razorpayOrderId, paymentId;
    await t.test('payment: create, verify, webhook', async () => {
      const made = ok(await shopper.post(`/api/payments/orders/${order.reference}/create`));
      razorpayOrderId = made.razorpayOrderId;
      assert.equal(made.amount, order.totalMinor);
      paymentId = `pay_${key()}`;
      const signature = (o, p) => crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${o}|${p}`).digest('hex');
      assert.equal((await shopper.post('/api/payments/verify', { razorpay_order_id: razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: 'bad' })).status, 400);
      assert.equal((await admin.post('/api/payments/verify', { razorpay_order_id: razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature(razorpayOrderId, paymentId) })).status, 404, 'not someone else\'s payment');
      ok(await shopper.post('/api/payments/verify', { razorpay_order_id: razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature(razorpayOrderId, paymentId) }));
      payment = await db.payment.findFirst({ where: { providerOrderId: razorpayOrderId } });
      assert.equal(payment.status, 'captured');
      assert.equal(payment.providerPaymentId, paymentId);
      assert.equal((await shopper.post(`/api/payments/orders/${order.reference}/create`)).status, 409, 'already paid');
      assert.ok(ok(await shopper.get('/api/customer/payments')).some((p) => p.id === payment.id));
      assert.ok(ok(await admin.get('/api/admin/payments')).some((p) => p.id === payment.id));
      assert.equal((await shopper.get('/api/admin/payments')).status, 404);
      assert.ok((await shopper.get(`/api/orders/${order.reference}/invoice`)).text.includes(paymentId));

      const send = (event) => {
        const raw = JSON.stringify(event);
        return request(app).post('/api/payments/webhook').set('Content-Type', 'application/json')
          .set('x-razorpay-signature', crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex')).send(raw);
      };
      const eventId = `evt_${key()}`;
      const failed = { id: eventId, event: 'payment.failed', payload: { payment: { entity: { id: paymentId, order_id: razorpayOrderId, error_code: 'X' } } } };
      assert.equal((await send(failed)).status, 200);
      assert.equal((await db.payment.findUnique({ where: { id: payment.id } })).status, 'captured', 'a late failure cannot undo a capture');
      assert.equal((await send(failed)).body.data.duplicate, true, 'a repeated event is ignored');
      assert.equal(await db.paymentEvent.count({ where: { eventId } }), 1);
      await db.paymentEvent.delete({ where: { eventId } });
    });

    await t.test('refunds', async () => {
      assert.equal((await shopper.post(`/api/admin/payments/${payment.id}/refund`, { amountMinor: 100 })).status, 404);
      assert.equal((await admin.post(`/api/admin/payments/${payment.id}/refund`, { amountMinor: payment.amountMinor + 1 })).status, 400);
      ok(await admin.post(`/api/admin/payments/${payment.id}/refund`, { amountMinor: 100, reason: 'Journey' }));
      const refunds = await db.refund.findMany({ where: { paymentId: payment.id } });
      assert.equal(refunds.length, 1);
      assert.equal(refunds[0].status, 'processed');
      assert.equal((await admin.post(`/api/admin/payments/${payment.id}/refund`, { amountMinor: payment.amountMinor })).status, 400, 'cannot exceed what is left');
      assert.ok(await db.notification.findFirst({ where: { recipientEmail: shopperEmail, type: 'refund_processed' } }));
      assert.ok(razorpay.some((u) => u.endsWith('/refund')));
    });

    await t.test('production workflow, history and shipment', async () => {
      assert.equal((await admin.patch(`/api/admin/orders/${order.reference}/status`, { status: 'delivered' })).status >= 400, true, 'stages cannot be skipped');
      for (const status of ['confirmed', 'in_production', 'quality_check', 'packed']) {
        assert.equal(ok(await admin.patch(`/api/admin/orders/${order.reference}/status`, { status, note: `to ${status}`, visibility: status === 'packed' ? 'internal' : 'customer' })).status, status);
      }
      const shipment = ok(await admin.post(`/api/admin/orders/${order.reference}/shipment`, { carrier: 'Journey Post', trackingNumber: `T${TAG}` }), 201);
      assert.equal(shipment.carrier, 'Journey Post');
      for (const status of ['shipped', 'delivered']) ok(await admin.patch(`/api/admin/orders/${order.reference}/status`, { status }));
      const history = ok(await admin.get(`/api/admin/orders/${order.reference}/history`));
      assert.ok(history.length >= 7);
      assert.ok(history.some((h) => h.newStatus === 'delivered'));
      const seen = ok(await shopper.get(`/api/customer/orders/${order.reference}`));
      assert.equal(JSON.stringify(seen).includes('to packed'), false, 'internal notes stay internal');
      assert.ok(JSON.stringify(seen).includes(`T${TAG}`), 'the customer sees tracking');
      const shipped = (await admin.get('/api/admin/shipments?dispatched=false')).body;
      assert.ok(Array.isArray(shipped.data));
      assert.ok((await admin.get('/api/admin/shipments')).body.data.some((s) => s.id === shipment.id));
      assert.equal(ok(await admin.patch(`/api/admin/orders/${order.reference}/estimate`, { estimatedDispatchAt: '2030-01-01T00:00:00.000Z' })).reference, order.reference);
    });

    await t.test('returns and replacements, with admin decisions', async () => {
      const detail = ok(await shopper.get(`/api/customer/orders/${order.reference}`));
      const [first, second] = detail.items;
      assert.ok(first.id, 'order items expose their id');
      const made = ok(await shopper.post(`/api/customer/orders/${order.reference}/return`, { reason: 'Too big', items: [{ orderItemId: first.id, quantity: first.quantity }] }), 201);
      assert.equal(made.status, 'pending');
      assert.equal((await shopper.post(`/api/customer/orders/${order.reference}/replacement`, { reason: 'Again', items: [{ orderItemId: first.id, quantity: 1 }] })).status, 400, 'cannot exceed what was ordered');
      const replacement = ok(await shopper.post(`/api/customer/orders/${order.reference}/replacement`, { reason: 'Wrong size', items: [{ orderItemId: second.id, quantity: 1 }] }), 201);

      const returns = ok(await admin.get('/api/admin/return-requests'));
      assert.ok(returns.find((r) => r.id === made.id)?.order?.reference === order.reference);
      ok(await admin.patch(`/api/admin/return-requests/${made.id}`, { status: 'approved', refundStatus: 'pending' }));
      assert.equal((await db.returnRequest.findUnique({ where: { id: made.id } })).decidedBy, adminRow.id);

      const replacements = ok(await admin.get('/api/admin/replacement-requests'));
      assert.ok(replacements.some((r) => r.id === replacement.id));
      const outbound = ok(await admin.post(`/api/admin/orders/${order.reference}/shipment`, { type: 'replacement', carrier: 'Swap', replacementRequestId: replacement.id }), 201);
      assert.equal((await db.replacementRequest.findUnique({ where: { id: replacement.id } })).replacementShipmentId, outbound.id, 'the shipment links to its request');
      ok(await admin.patch(`/api/admin/replacement-requests/${replacement.id}`, { status: 'approved' }));
      const returnShipment = ok(await admin.post(`/api/admin/orders/${order.reference}/shipment`, { type: 'return', returnRequestId: made.id }), 201);
      const linked = ok(await shopper.get(`/api/customer/orders/${order.reference}`));
      assert.equal(linked.returnRequests.find((r) => r.id === made.id).returnShipment?.id, returnShipment.id);
      assert.equal((await shopper.get('/api/admin/return-requests')).status, 404);
    });

    await t.test('cancellations', async () => {
      const direct = ok(await shopper.post('/api/orders', orderBody(shopperEmail), { 'Idempotency-Key': key() }), 201);
      assert.equal(ok(await shopper.post(`/api/customer/orders/${direct.reference}/cancel`, { reason: 'Changed my mind' }), 201).direct, true);
      assert.equal((await db.order.findUnique({ where: { reference: direct.reference } })).status, 'cancelled');
      assert.equal((await shopper.post(`/api/customer/orders/${direct.reference}/cancel`, {})).status, 400);

      const requested = ok(await shopper.post('/api/orders', orderBody(shopperEmail), { 'Idempotency-Key': key() }), 201);
      ok(await admin.patch(`/api/admin/orders/${requested.reference}/status`, { status: 'confirmed' }));
      assert.equal(ok(await shopper.post(`/api/customer/orders/${requested.reference}/cancel`, { reason: 'Please' }), 201).direct, false);
      assert.equal((await shopper.post(`/api/customer/orders/${requested.reference}/cancel`, {})).status, 409, 'only one request per order');
      const pending = ok(await admin.get('/api/admin/cancellation-requests')).find((r) => r.order?.reference === requested.reference);
      assert.ok(pending);
      ok(await admin.patch(`/api/admin/cancellation-requests/${pending.id}`, { status: 'approved' }));
      assert.equal((await db.order.findUnique({ where: { reference: requested.reference } })).status, 'cancelled');
    });

    await t.test('reviews', async () => {
      assert.equal((await browser(app).post('/api/products/ZV001/reviews', { rating: 5, content: 'Lovely dress' })).status, 401);
      assert.equal((await shopper.post('/api/products/ZV001/reviews', { rating: 9, content: 'Lovely dress' })).status, 400);
      const { review } = ok(await shopper.post('/api/products/ZV001/reviews', { rating: 5, title: 'Lovely', content: 'Lovely dress' }), 201);
      created.reviews.push(review.id);
      assert.equal((await db.review.findUnique({ where: { id: review.id } })).verifiedPurchase, true, 'bought it, so verified');
      assert.equal(ok(await browser(app).post(`/api/reviews/${review.id}/helpful`)).helpfulCount, 1);
      const reviews = ok(await browser(app).get('/api/products/ZV001/reviews'));
      assert.ok((reviews.reviews ?? reviews).some((r) => r.id === review.id));
      assert.ok(ok(await admin.get('/api/admin/reviews')).some((r) => r.id === review.id && r.product?.id === 'ZV001'));
      assert.equal(ok(await admin.patch(`/api/admin/reviews/${review.id}`, { status: 'rejected' })).status, 'rejected');
      const after = ok(await browser(app).get('/api/products/ZV001/reviews'));
      assert.equal((after.reviews ?? after).some((r) => r.id === review.id), false, 'rejected reviews are hidden');
    });

    await t.test('contact and newsletter', async () => {
      const email = `journey-news-${TAG}@zaevi.test`;
      ok(await browser(app).post('/api/contact', { name: 'Journey', email, subject: 'Order support', message: 'Where is my order?' }), 201);
      const stored = await db.contactMessage.findFirst({ where: { email } });
      assert.ok(stored);
      created.messages.push(stored.id);
      assert.ok((await admin.get('/api/admin/contact-messages')).body.data.some((m) => m.id === stored.id));
      assert.equal(ok(await admin.patch(`/api/admin/contact-messages/${stored.id}`, { status: 'read' })).status, 'read');
      assert.equal((await admin.patch('/api/admin/contact-messages/987654321', { status: 'read' })).status, 404);
      ok(await admin.post(`/api/admin/contact-messages/${stored.id}/notify`));

      ok(await browser(app).post('/api/newsletter/subscribe', { email }), 201);
      ok(await browser(app).post('/api/newsletter/subscribe', { email: email.toUpperCase() }));
      assert.equal(await db.newsletterSubscriber.count({ where: { email } }), 1);
      ok(await browser(app).post('/api/newsletter/unsubscribe', { email }));
      assert.equal((await db.newsletterSubscriber.findUnique({ where: { email } })).status, 'unsubscribed');
      ok(await browser(app).post('/api/newsletter/subscribe', { email }));
      assert.equal((await db.newsletterSubscriber.findUnique({ where: { email } })).status, 'subscribed');
      await db.newsletterSubscriber.delete({ where: { email } });
    });

    await t.test('notifications', async () => {
      assert.ok(ok(await shopper.get('/api/customer/notifications')).length > 0);
      const all = ok(await admin.get('/api/admin/notifications'));
      assert.ok(all.length > 0);
      const mine = await db.notification.findFirst({ where: { recipientEmail: shopperEmail } });
      ok(await admin.post(`/api/admin/notifications/${mine.id}/retry`));
    });

    await t.test('admin dashboard, analytics and export', async () => {
      const stats = ok(await admin.get('/api/admin/stats'));
      assert.ok(stats.orders.total >= 1);
      assert.ok(stats.orders.byStatus.some((row) => row.status === 'delivered' && row.count >= 1));
      assert.ok(stats.totalOrderValueMinor > 0);
      const attention = ok(await admin.get('/api/admin/attention'));
      assert.equal(typeof attention.newOrders, 'number');
      assert.ok((await admin.get('/api/admin/orders?page=1&limit=5')).body.data.length <= 5);
      assert.ok((await admin.get('/api/admin/orders?status=delivered')).body.data.every((o) => o.status === 'delivered'));
      assert.equal(ok(await admin.get(`/api/admin/orders/${order.reference}`)).reference, order.reference);
      assert.ok(ok(await admin.get('/api/admin/analytics/sales')).length > 0);
      const top = ok(await admin.get('/api/admin/analytics/top-products'));
      assert.ok(top.some((row) => row.productId === 'ZV001' && row._sum.quantity >= 2));
      const csv = await admin.get('/api/admin/orders/export/csv');
      assert.equal(csv.status, 200);
      assert.ok(csv.text.includes(order.reference));
      assert.equal(ok(await admin.get('/api/admin/email-status')).configured, false);
      assert.equal((await admin.get('/admin')).status, 200);
      assert.equal((await shopper.get('/admin')).status, 404);
    });

    await t.test('delivery settings', async () => {
      const before = await db.deliveryEstimateConfig.findUnique({ where: { id: 1 } });
      try {
        const saved = ok(await admin.patch('/api/admin/delivery-config', { productionDays: 9 }));
        assert.equal(saved.productionDays, 9);
        assert.equal(ok(await admin.get('/api/admin/delivery-config')).productionDays, 9);
      } finally {
        if (before) await db.deliveryEstimateConfig.update({ where: { id: 1 }, data: { productionDays: before.productionDays } });
        else await db.deliveryEstimateConfig.delete({ where: { id: 1 } });
      }
    });

    await t.test('product management', async () => {
      const made = ok(await admin.post('/api/admin/products', { name: `Journey ${TAG}`, category: 'Dresses', gender: 'Women', price: 1000, color: 'Black', description: 'Journey product', imageUrl: 'https://images.unsplash.com/photo-1', sizes: ['S', 'M'] }), 201);
      created.products.push(made.id);
      assert.match(made.id, /^ZV\d+$/);
      assert.deepEqual(made.sizes, ['S', 'M']);
      const edited = ok(await admin.patch(`/api/admin/products/${made.id}`, { sizes: ['M', 'L'], available: false }));
      assert.deepEqual(edited.sizes, ['M', 'L']);
      assert.equal(edited.available, false);
      assert.ok((await admin.get('/api/admin/products?limit=50')).body.data.some((p) => p.id === made.id));
      assert.equal((await shopper.patch(`/api/admin/products/${made.id}`, { price: 1 })).status, 404);
    });

    await t.test('CMS pages, settings, homepage and media', async () => {
      const settings = ok(await admin.get('/api/admin/cms/settings'));
      assert.ok(settings);
      const { id: settingsId, updatedBy, createdAt, updatedAt, ...editable } = settings;
      const put = ok(await admin.put('/api/admin/cms/settings', { ...editable, announcementText: `Journey ${TAG}` }));
      assert.equal(put.announcementText, `Journey ${TAG}`);
      assert.equal(ok(await browser(app).get('/api/cms/settings')).announcementText, `Journey ${TAG}`);
      await db.websiteSetting.update({ where: { id: 1 }, data: { announcementText: settings.announcementText } });

      const slug = `journey-${TAG}`;
      const page = ok(await admin.post('/api/admin/cms/pages', { slug, title: 'Journey' }), 201);
      created.pages.push(page.id);
      assert.equal(page.draftRevision.version, 1);
      const firstRevision = page.draftRevision.id;
      assert.equal((await admin.post('/api/admin/cms/pages', { slug, title: 'Twice' })).status, 409);
      const updated = ok(await admin.put(`/api/admin/cms/pages/${slug}`, { title: 'Journey 2', snapshot: { title: 'Journey 2', components: [{ id: 'hero-1', type: 'hero', props: { heading: 'Hello' } }] } }));
      assert.equal(updated.draftRevision.version, 2);
      assert.equal((await browser(app).get(`/api/cms/pages/${slug}/published`)).status, 404, 'a draft stays private');
      const published = ok(await admin.post(`/api/admin/cms/pages/${slug}/publish`));
      assert.equal(published.status, 'published');
      assert.ok(JSON.stringify(ok(await browser(app).get(`/api/cms/pages/${slug}/published`))).includes('Hello'));
      assert.ok(ok(await admin.get(`/api/admin/cms/pages/${slug}/revisions`)).length >= 2);
      ok(await admin.post(`/api/admin/cms/pages/${slug}/revert`));
      assert.equal(ok(await admin.post(`/api/admin/cms/pages/${slug}/revisions/${firstRevision}/restore`)).status !== undefined, true);
      assert.ok((await admin.get('/api/admin/cms/pages')).body.data.some((p) => p.slug === slug));

      const homepage = ok(await admin.get('/api/admin/cms/homepage'));
      assert.ok(homepage);

      const media = ok(await admin.post('/api/admin/cms/media', { data: PNG, mimeType: 'image/png', alt: 'Journey' }), 201);
      created.media.push(media.id);
      const image = await browser(app).get(media.url);
      assert.equal(image.status, 200);
      assert.ok((await admin.get('/api/admin/cms/media')).body.data.some((m) => m.id === media.id));
      assert.equal((await admin.del(`/api/admin/cms/media/${media.id}`)).status, 204);
      created.media.pop();
      assert.equal((await browser(app).get(media.url)).status, 404);
    });

    await t.test('Site Studio: draft, publish, undo and discard, with JSON kept exactly', async () => {
      const state = (text) => ({ ...structuredClone(STUDIO_DEFAULT_STATE), blocks: [...structuredClone(STUDIO_DEFAULT_STATE.blocks), { id: 'r', type: 'ribbon', text }] });
      const draft = ok(await admin.put('/api/admin/studio', { draft: state('First') }));
      assert.equal(draft.hasUnpublishedChanges, true);
      ok(await admin.post('/api/admin/studio/publish'));
      const live = () => browser(app).get('/api/site/studio').then((r) => r.body.data);
      assert.ok(JSON.stringify(await live()).includes('First'));
      ok(await admin.put('/api/admin/studio', { draft: state('Second') }));
      assert.ok(JSON.stringify(await live()).includes('First'), 'a draft does not change the live site');
      assert.ok(JSON.stringify(ok(await admin.post('/api/admin/studio/discard'))).includes('First'));
      ok(await admin.put('/api/admin/studio', { draft: state('Third') }));
      ok(await admin.post('/api/admin/studio/publish'));
      ok(await admin.post('/api/admin/studio/undo'));
      assert.ok(JSON.stringify(await live()).includes('First'));
      assert.equal((await shopper.get('/api/admin/studio')).status, 404);
    });

    await t.test('coupon delete keeps the order and clears the link', async () => {
      assert.equal((await db.order.findUnique({ where: { reference: order.reference } })).couponId, couponId);
      ok(await admin.del(`/api/admin/coupons/${couponId}`));
      created.coupons.pop();
      const kept = await db.order.findUnique({ where: { reference: order.reference } });
      assert.equal(kept.couponId, null);
      assert.ok(kept.discountMinor > 0, 'the discount given stays on the order');
      assert.equal(await db.couponUsage.count({ where: { couponId } }), 0);
    });

    await t.test('changing a password', async () => {
      const newPassword = 'Journey-Changed-2026!';
      assert.equal((await shopper.post('/api/customer/change-password', { currentPassword: 'wrong-wrong-wrong', newPassword })).status, 401);
      ok(await shopper.post('/api/customer/change-password', { currentPassword: PASSWORD, newPassword }));
      assert.equal((await browser(app).signIn(shopperEmail, PASSWORD)).status, 401);
      ok(await browser(app).signIn(shopperEmail, newPassword));
    });

    await t.test('sign-out', async () => {
      ok(await shopper.post('/api/auth/logout'));
      assert.equal(ok(await shopper.get('/api/auth/me')).email, undefined);
    });
  } finally {
    globalThis.fetch = realFetch;
    for (const name of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    const ids = [adminRow.id, shopperRow.id];
    const orders = await db.order.findMany({ where: { customerId: { in: ids } }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    const payments = await db.payment.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await db.refund.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.notification.deleteMany({ where: { recipientEmail: { in: [adminEmail, shopperEmail] } } });
    await db.review.deleteMany({ where: { id: { in: created.reviews } } });
    await db.contactMessage.deleteMany({ where: { id: { in: created.messages } } });
    await db.coupon.deleteMany({ where: { id: { in: created.coupons } } });
    await db.product.deleteMany({ where: { id: { in: created.products } } });
    await db.cmsPage.deleteMany({ where: { id: { in: created.pages } } });
    await db.mediaAsset.deleteMany({ where: { id: { in: created.media } } });
    if (studioBefore) await db.siteStudio.update({ where: { id: 1 }, data: { draft: studioBefore.draft, published: studioBefore.published, previous: studioBefore.previous, publishedAt: studioBefore.publishedAt } });
    else await db.siteStudio.deleteMany({ where: { id: 1 } });
    await db.customer.deleteMany({ where: { id: { in: ids } } });
    await disconnectDB();
  }
});
