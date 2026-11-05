import { Router } from 'express';
import { getPrismaClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import crypto from 'node:crypto';
import { notifyRefundProcessed } from '../services/notification.js';
import { getOfficialContactEmail } from './contact.js';

const GSTIN_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Prints only a correctly formatted BUSINESS_GSTIN; otherwise a clearly marked placeholder. */
export function getInvoiceGstinLabel(env = process.env) {
  const gstin = String(env.BUSINESS_GSTIN || '').trim().toUpperCase();
  return GSTIN_FORMAT.test(gstin) ? `GSTIN: ${gstin}` : 'GSTIN: Not yet provided (placeholder)';
}

/** Constant-time comparison that treats a wrong-length signature as a mismatch. */
function signatureMatches(expected, provided) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createPaymentsRouter({ getPrisma } = {}) {
  const resolvePrisma = getPrisma ?? getPrismaClient;
  const router = Router();

  function isConfigured() {
    return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  }

  router.get('/payments/config', (req, res) => {
    res.json({ data: { configured: isConfigured(), keyId: process.env.RAZORPAY_KEY_ID || null } });
  });

  router.post('/payments/orders/:reference/create', requireAuth, validateCsrf, async (req, res, next) => {
    try {
      if (!isConfigured()) throw new HttpError(503, 'Payment configuration is incomplete');
      const prisma = resolvePrisma();
      const reference = String(req.params.reference || '').trim();
      const order = await prisma.order.findFirst({ where: { reference, customerId: req.customerId } });
      if (!order) throw new HttpError(404, 'Order not found');
      if (order.status === 'cancelled') throw new HttpError(400, 'Order is cancelled');
      const alreadyPaid = await prisma.payment.findFirst({ where: { orderId: order.id, status: 'captured' } });
      if (alreadyPaid) throw new HttpError(409, 'This order has already been paid');
      // Create local payment attempt
      const payment = await prisma.payment.create({
        data: { orderId: order.id, amountMinor: order.totalMinor, currency: order.currency || 'INR', status: 'created' },
      });
      // Create Razorpay order via REST
      const auth = Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');
      const rz = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + auth },
        body: JSON.stringify({ amount: order.totalMinor, currency: 'INR', receipt: reference }),
      });
      const rzJson = await rz.json().catch(() => ({}));
      if (!rz.ok || !rzJson.id) throw new HttpError(502, 'Failed to create payment order');
      await prisma.payment.update({ where: { id: payment.id }, data: { providerOrderId: rzJson.id, status: 'attempted' } });
      res.json({ data: { keyId: process.env.RAZORPAY_KEY_ID, razorpayOrderId: rzJson.id, amount: order.totalMinor, currency: 'INR', orderReference: reference } });
    } catch (e) { next(e); }
  });

  router.post('/payments/verify', requireAuth, validateCsrf, async (req, res, next) => {
    try {
      if (!isConfigured()) throw new HttpError(503, 'Payment configuration is incomplete');
      const b = req.body || {};
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = b;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) throw new HttpError(400, 'Missing payment fields');
      const prisma = resolvePrisma();
      const payment = await prisma.payment.findFirst({ where: { providerOrderId: razorpay_order_id }, include: { order: { select: { customerId: true } } } });
      if (!payment || payment.order?.customerId !== req.customerId) throw new HttpError(404, 'Payment not found');
      const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex');
      if (!signatureMatches(expected, razorpay_signature)) throw new HttpError(400, 'Invalid payment signature');
      await prisma.payment.update({ where: { id: payment.id }, data: { providerPaymentId: razorpay_payment_id, status: 'captured', capturedAt: new Date() } });
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  router.post('/payments/webhook', async (req, res, next) => {
    try {
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!secret) throw new HttpError(503, 'Webhook not configured');
      const signature = req.headers['x-razorpay-signature'];
      const raw = req.body; // Buffer expected
      const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      if (!signatureMatches(expected, signature)) throw new HttpError(400, 'Invalid webhook signature');
      const event = JSON.parse(raw.toString('utf8'));
      const eventId = event.id || event.event + ':' + (event.payload && event.payload.payment && event.payload.payment.entity && event.payload.payment.entity.id);
      const prisma = resolvePrisma();
      // idempotency
      const existing = await prisma.paymentEvent.findUnique({ where: { eventId } }).catch(() => null);
      if (existing) return res.json({ data: { ok: true, duplicate: true } });
      await prisma.paymentEvent.create({ data: { eventId, eventType: event.event, payload: raw.toString('utf8'), processedAt: new Date() } });

      // Covers the case where the customer closes the page before the browser verifies.
      const entity = event.payload?.payment?.entity;
      if (event.event === 'payment.captured' && entity?.order_id) {
        await prisma.payment.updateMany({
          where: { providerOrderId: entity.order_id },
          data: { status: 'captured', providerPaymentId: entity.id, method: entity.method || null, capturedAt: new Date() },
        });
      } else if (event.event === 'payment.failed' && entity?.order_id) {
        await prisma.payment.updateMany({
          where: { providerOrderId: entity.order_id, status: { not: 'captured' } },
          data: { status: 'failed', failureCode: entity.error_code || null, failureDescription: entity.error_description ? String(entity.error_description).slice(0, 500) : null },
        });
      }
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  router.get('/customer/payments', requireAuth, async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const orders = await prisma.order.findMany({ where: { customerId: req.customerId }, select: { id: true } });
      const ids = orders.map((o) => o.id);
      const payments = await prisma.payment.findMany({ where: { orderId: { in: ids } }, orderBy: { createdAt: 'desc' } });
      res.json({ data: payments });
    } catch (e) { next(e); }
  });

  router.get('/admin/payments', requireAuth, async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const customer = await prisma.customer.findUnique({ where: { id: req.customerId }, select: { role: true } });
      if (!customer || customer.role !== 'admin') throw new HttpError(404, 'Not Found');
      const payments = await prisma.payment.findMany({ include: { order: true }, orderBy: { createdAt: 'desc' }, take: 100 });
      res.json({ data: payments });
    } catch (e) { next(e); }
  });

  // POST /api/admin/payments/:id/refund
  router.post('/admin/payments/:id/refund', requireAuth, validateCsrf, async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const customer = await prisma.customer.findUnique({ where: { id: req.customerId }, select: { role: true } });
      if (!customer || customer.role !== 'admin') throw new HttpError(404, 'Not Found');
      const paymentId = Number(req.params.id);
      const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { refunds: true } });
      if (!payment) throw new HttpError(404, 'Payment not found');
      if (payment.status !== 'captured') throw new HttpError(400, 'Only captured payments can be refunded');
      const amount = Number((req.body && req.body.amountMinor));
      if (!Number.isInteger(amount) || amount <= 0) throw new HttpError(400, 'Invalid refund amount');
      const already = (payment.refunds || []).filter((r) => r.status === 'processed' || r.status === 'created').reduce((s, r) => s + r.amountMinor, 0);
      if (amount + already > payment.amountMinor) throw new HttpError(400, 'Refund exceeds captured amount');
      if (!isConfigured()) throw new HttpError(503, 'Payment configuration is incomplete');
      const refund = await prisma.refund.create({
        data: { paymentId, amountMinor: amount, currency: payment.currency, status: 'created', reason: (req.body && req.body.reason) || null },
      });
      // Call Razorpay refund API
      const auth = Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');
      const rz = await fetch('https://api.razorpay.com/v1/payments/' + payment.providerPaymentId + '/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + auth },
        body: JSON.stringify({ amount }),
      });
      const rzJson = await rz.json().catch(() => ({}));
      if (!rz.ok || !rzJson.id) {
        await prisma.refund.update({ where: { id: refund.id }, data: { status: 'failed', failureCode: String(rz.status), failureDescription: 'Refund failed' } });
        throw new HttpError(502, 'Refund failed');
      }
      const processed = await prisma.refund.update({ where: { id: refund.id }, data: { providerRefundId: rzJson.id, status: 'processed', processedAt: new Date() } });
      const refundedOrder = await prisma.order.findUnique({ where: { id: payment.orderId } });
      if (refundedOrder) await notifyRefundProcessed(prisma, { order: refundedOrder, refund: processed });
      res.json({ data: { ok: true, refundId: rzJson.id } });
    } catch (e) { next(e); }
  });

  // GET /api/orders/:reference/invoice (HTML)
  router.get('/orders/:reference/invoice', requireAuth, async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const reference = String(req.params.reference || '').trim();
      const customer = await prisma.customer.findUnique({ where: { id: req.customerId } });
      const isAdmin = customer?.role === 'admin';
      const where = isAdmin ? { reference } : { reference, customerId: req.customerId };
      const order = await prisma.order.findFirst({ where, include: { items: true, coupon: true } });
      if (!order) throw new HttpError(404, 'Order not found');
      const payments = await prisma.payment.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
      const captured = payments.find((p) => p.status === 'captured');

      const subtotalINR = (order.subtotalMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
      const discountINR = order.discountMinor ? (order.discountMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00';
      const totalINR = (order.totalMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
      const gstMinor = Math.round(order.totalMinor * 0.18 / 1.18);
      const cgstINR = ((gstMinor / 2) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
      const sgstINR = ((gstMinor / 2) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });

      const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Invoice — ${reference} — ZAEVI</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", serif; color: #111; margin: 0; padding: 40px; background: #fff; font-size: 13px; line-height: 1.6; }
    .invoice-card { max-width: 800px; margin: 0 auto; border: 1px solid #eee; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 24px; margin-bottom: 24px; }
    .brand h1 { font-family: "Playfair Display", Georgia, serif; font-size: 32px; letter-spacing: 2px; margin: 0 0 6px; }
    .brand p { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
    .meta { text-align: right; }
    .meta strong { font-size: 16px; display: block; margin-bottom: 4px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px; }
    .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #888; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; padding: 12px 8px; border-bottom: 1px solid #111; color: #555; }
    td { padding: 12px 8px; border-bottom: 1px solid #eee; }
    .totals { margin-left: auto; width: 320px; margin-bottom: 32px; }
    .totals-line { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
    .totals-line.grand { border-top: 2px solid #111; border-bottom: 2px solid #111; font-weight: bold; font-size: 16px; margin-top: 8px; padding: 10px 0; }
    .footer { text-align: center; font-size: 11px; color: #888; border-top: 1px solid #eee; padding-top: 24px; }
    .print-btn { display: inline-block; background: #111; color: #fff; border: none; padding: 10px 20px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; margin-bottom: 20px; }
    @media print {
      body { padding: 0; }
      .invoice-card { border: none; padding: 0; }
      .print-btn { display: none; }
    }
  </style>
</head>
<body>
  <div style="max-width:800px;margin:0 auto;text-align:right;">
    <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
  </div>
  <div class="invoice-card">
    <div class="header">
      <div class="brand">
        <h1>ZAEVI</h1>
        <p>Contemporary Luxury Atelier</p>
        <p style="margin-top:4px;">${getInvoiceGstinLabel()}</p>
      </div>
      <div class="meta">
        <strong>INVOICE</strong>
        <div>Ref: ${reference}</div>
        <div>Date: ${new Date(order.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        <div>Status: ${(order.status || '').toUpperCase()}</div>
      </div>
    </div>
    <div class="info-grid">
      <div>
        <div class="section-title">Delivery Recipient</div>
        <strong>${order.shippingName || 'Valued Patron'}</strong><br>
        ${order.shippingAddress || ''}<br>
        ${order.shippingCity ? order.shippingCity + ', ' : ''}${order.shippingPostalCode || ''}<br>
        ${order.shippingCountry || 'IN'}<br>
        ${order.contactPhone ? 'Phone: ' + order.contactPhone : ''}
      </div>
      <div>
        <div class="section-title">Order & Payment Information</div>
        <div>Email: ${order.contactEmail || ''}</div>
        ${captured ? `<div>Payment Provider: ${captured.provider.toUpperCase()}</div>` : ''}
        <div>Payment Status: ${captured ? 'PAID' : 'NOT YET PAID'}</div>
        ${captured?.providerPaymentId ? `<div>Transaction ID: ${captured.providerPaymentId}</div>` : ''}
        ${order.coupon ? `<div>Promo Code: ${order.coupon.code}</div>` : ''}
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Item & Description</th>
          <th>SKU</th>
          <th>Size</th>
          <th style="text-align:center;">Qty</th>
          <th style="text-align:right;">Unit Price</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${order.items.map(i => `
          <tr>
            <td><strong>${i.productName}</strong></td>
            <td>${i.productSku}</td>
            <td>${i.size || '—'}</td>
            <td style="text-align:center;">${i.quantity}</td>
            <td style="text-align:right;">₹${(i.unitPriceMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td style="text-align:right;">₹${(i.lineTotalMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="totals">
      <div class="totals-line">
        <span>Item Subtotal</span>
        <span>₹${subtotalINR}</span>
      </div>
      ${order.discountMinor ? `
      <div class="totals-line" style="color:#1a7a3a;">
        <span>Atelier Promotion Discount</span>
        <span>-₹${discountINR}</span>
      </div>` : ''}
      <div class="totals-line">
        <span>Complimentary Express Delivery</span>
        <span>₹0.00</span>
      </div>
      <div class="totals-line" style="font-size:11px;color:#777;">
        <span>Includes CGST (9%)</span>
        <span>₹${cgstINR}</span>
      </div>
      <div class="totals-line" style="font-size:11px;color:#777;">
        <span>Includes SGST (9%)</span>
        <span>₹${sgstINR}</span>
      </div>
      <div class="totals-line grand">
        <span>Total Payable (INR)</span>
        <span>₹${totalINR}</span>
      </div>
    </div>
    <div class="footer">
      <p>Thank you for choosing ZAEVI. Each garment is meticulously crafted to order in our atelier.</p>
      <p>Client Services: ${getOfficialContactEmail() || 'please use the contact form on our website'} · Returns accepted within 14 days of delivery.</p>
    </div>
  </div>
</body>
</html>`;
      res.type('html').send(html);
    } catch (e) { next(e); }
  });

  return router;
}
