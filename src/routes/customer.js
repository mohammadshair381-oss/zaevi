/**
 * Customer order history endpoints.
 *
 *   GET /api/customer/orders
 *     - Requires authenticated session
 *     - Returns paginated orders for the authenticated customer
 *     - Never accepts client-provided customer ID
 *     - Ownership enforced by server-side session
 *
 *   GET /api/customer/orders/:reference
 *     - Requires authenticated session
 *     - Returns one order (items, shipping snapshot, production timeline)
 *     - Ownership is enforced in the query: a reference belonging to another
 *       customer is indistinguishable from an unknown reference (404).
 *
 * Both responses are derived from the persisted order row. No delivery event,
 * carrier, payment or status-history data is invented: those models do not
 * exist yet, so they are simply not returned.
 */

import { Router } from 'express';

import { getPrismaClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import { hashSessionId } from '../models/auth.js';
import { sessionStore } from '../middleware/session.js';
import { serializeOrder } from '../models/order.js';
import {
  buildOrderStatusTimeline,
  getOrderStatusLabel,
} from '../models/order-status.js';

/** Maximum page size for pagination. */
const MAX_PAGE_SIZE = 50;
/** Default page size. */
const DEFAULT_PAGE_SIZE = 20;
/** Reference column length, mirrored from the Order model. */
const MAX_REFERENCE_LENGTH = 32;

/**
 * Customer-facing order shape: the existing public serializer plus the
 * authoritative status label/timeline. The order's `updatedAt` is exposed as
 * "last updated" (it is a real column); it is not presented as a per-stage
 * completion timestamp.
 */
export function serializeCustomerOrder(order) {
  return {
    ...serializeOrder(order),
    statusLabel: getOrderStatusLabel(order.status),
    timeline: buildOrderStatusTimeline(order.status),
    updatedAt: order.updatedAt ?? null,
  };
}

const RETURN_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns and replacements close 14 days after delivery, matching the published policy.
 * An order with no recorded delivery date is left open rather than wrongly refused.
 */
export async function assertWithinReturnWindow(prisma, orderId, now = new Date()) {
  const delivered = typeof prisma.orderStatusHistory?.findFirst === 'function'
    ? await prisma.orderStatusHistory.findFirst({
      where: { orderId, newStatus: 'delivered' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    : null;
  if (delivered && now.getTime() - new Date(delivered.createdAt).getTime() > RETURN_WINDOW_DAYS * DAY_MS) {
    throw new HttpError(400, `The ${RETURN_WINDOW_DAYS}-day return period for this order has ended. Please contact us for help.`);
  }
}

export function createCustomerRouter({ getPrisma } = {}) {
  const resolvePrisma = getPrisma ?? getPrismaClient;
  const router = Router();

  // All customer routes require authentication
  router.use(requireAuth);

  /**
   * GET /api/customer/orders
   * Query params: page (default 1), limit (default 20, max 50)
   * Returns paginated orders for the authenticated customer.
   */
  router.get('/orders', async (req, res, next) => {
    try {
      const customerId = req.customerId;
      if (!customerId) {
        // Should not happen if requireAuth works
        throw new HttpError(401, 'Authentication required');
      }

      // Parse and validate pagination params
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));
      const skip = (page - 1) * limit;

      const prisma = resolvePrisma();

      // Get total count for pagination metadata
      const total = await prisma.order.count({
        where: { customerId },
      });

      // Fetch orders with items, newest first
      const orders = await prisma.order.findMany({
        where: { customerId },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      });

      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        data: orders.map(serializeCustomerOrder),
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/customer/orders/:reference
   * One order belonging to the authenticated customer, including the shipping
   * snapshot captured at purchase time. Returns 404 for a reference owned by a
   * different customer so references cannot be probed.
   */
  router.get('/orders/:reference', async (req, res, next) => {
    try {
      const customerId = req.customerId;
      if (!customerId) {
        throw new HttpError(401, 'Authentication required');
      }

      const reference = String(req.params.reference ?? '').trim();
      if (reference === '' || reference.length > MAX_REFERENCE_LENGTH) {
        throw new HttpError(404, 'Order not found');
      }

      const prisma = resolvePrisma();
      const order = await prisma.order.findFirst({
        where: { reference, customerId },
        include: {
          items: true,
          statusHistory: { orderBy: { createdAt: 'asc' } },
          shipments: { orderBy: { createdAt: 'asc' } },
          cancellationRequest: true,
          returnRequests: { include: { items: true, returnShipment: true }, orderBy: { createdAt: 'desc' } },
          replacementRequests: { include: { items: true, replacementShipment: true }, orderBy: { createdAt: 'desc' } },
        },
      });
      if (!order) {
        throw new HttpError(404, 'Order not found');
      }

      res.status(200).json({
        data: {
          ...serializeCustomerOrder(order),
          items: (order.items || []).map((it) => ({
            id: it.id,
            productId: it.productId,
            productSku: it.productSku,
            productName: it.productName,
            size: it.size,
            unitPriceMinor: it.unitPriceMinor,
            quantity: it.quantity,
            lineTotalMinor: it.lineTotalMinor,
          })),
          // Snapshot captured at checkout, never re-read from the address book.
          shipping: {
            name: order.shippingName ?? null,
            address: order.shippingAddress ?? null,
            city: order.shippingCity ?? null,
            postalCode: order.shippingPostalCode ?? null,
            country: order.shippingCountry ?? null,
          },
          contactEmail: order.contactEmail ?? null,
          contactPhone: order.contactPhone ?? null,
          statusHistory: order.statusHistory || [],
          shipments: order.shipments || [],
          cancellationRequest: order.cancellationRequest || null,
          returnRequests: order.returnRequests || [],
          replacementRequests: order.replacementRequests || [],
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/customer/orders/:reference/cancel
  router.post('/orders/:reference/cancel', validateCsrf, async (req, res, next) => {
    try {
      const customerId = req.customerId;
      const reference = String(req.params.reference || '').trim();
      const prisma = resolvePrisma();
      const order = await prisma.order.findFirst({ where: { reference, customerId } });
      if (!order) throw new HttpError(404, 'Order not found');
      if (order.status === 'shipped' || order.status === 'delivered') {
        throw new HttpError(400, 'Cancellation is not available for this order');
      }
      if (order.status === 'cancelled') {
        throw new HttpError(400, 'Order is already cancelled');
      }
      const existing = await prisma.cancellationRequest.findUnique({ where: { orderId: order.id } });
      if (existing && existing.status === 'pending') {
        throw new HttpError(409, 'A cancellation request is already pending');
      }
      if (existing) {
        throw new HttpError(409, 'We have already answered a cancellation request for this order. Please contact us if you need more help.');
      }
      const direct = order.status === 'pending';
      const reason = String((req.body && req.body.reason) || '').trim().slice(0, 500) || 'Customer requested cancellation';
      if (direct) {
        await prisma.$transaction(async (tx) => {
          const r = await tx.order.updateMany({ where: { id: order.id, status: 'pending' }, data: { status: 'cancelled' } });
          if (r.count !== 1) throw new HttpError(409, 'Order status changed concurrently');
          await tx.orderStatusHistory.create({
            data: { orderId: order.id, previousStatus: 'pending', newStatus: 'cancelled', note: reason, visibility: 'customer', changedBy: customerId },
          });
          await tx.cancellationRequest.create({
            data: { orderId: order.id, reason, status: 'approved', requestedBy: customerId, requesterEmail: (await tx.customer.findUnique({ where: { id: customerId }, select: { email: true } })).email, decidedBy: customerId, decidedAt: new Date() },
          });
        });
      } else {
        await prisma.cancellationRequest.create({
          data: { orderId: order.id, reason, status: 'pending', requestedBy: customerId, requesterEmail: (await prisma.customer.findUnique({ where: { id: customerId }, select: { email: true } })).email },
        });
      }
      res.status(201).json({ data: { ok: true, direct } });
    } catch (error) { next(error); }
  });

  // POST /api/customer/orders/:reference/return
  router.post('/orders/:reference/return', validateCsrf, async (req, res, next) => {
    try {
      const customerId = req.customerId;
      const reference = String(req.params.reference || '').trim();
      const prisma = resolvePrisma();
      const order = await prisma.order.findFirst({ where: { reference, customerId }, include: { items: true } });
      if (!order) throw new HttpError(404, 'Order not found');
      if (order.status !== 'delivered') throw new HttpError(400, 'Returns are only available for delivered orders');
      await assertWithinReturnWindow(prisma, order.id);
      const body = req.body || {};
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) throw new HttpError(400, 'At least one item is required');
      // Validate items and quantities
      const orderItemMap = new Map(order.items.map((i) => [i.id, i]));
      const requested = [];
      for (const it of items) {
        const id = Number(it.orderItemId);
        const qty = Number(it.quantity);
        const oi = orderItemMap.get(id);
        if (!oi) throw new HttpError(400, 'Invalid order item');
        if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, 'Invalid quantity');
        requested.push({ orderItemId: id, quantity: qty, oi });
      }
      // Check eligibility pool
      const existingReturns = await prisma.returnRequest.findMany({ where: { orderId: order.id }, include: { items: true } });
      const existingReplacements = await prisma.replacementRequest.findMany({ where: { orderId: order.id }, include: { items: true } });
      const reservedByItem = new Map();
      for (const r of [...existingReturns, ...existingReplacements]) {
        if (r.status === 'rejected') continue;
        for (const it of r.items) {
          reservedByItem.set(it.orderItemId, (reservedByItem.get(it.orderItemId) || 0) + it.quantity);
        }
      }
      for (const r of requested) {
        const oi = r.oi;
        const reserved = reservedByItem.get(r.orderItemId) || 0;
        if (r.quantity + reserved > oi.quantity) throw new HttpError(400, 'Requested quantity exceeds available eligibility');
      }
      const reason = String(body.reason || '').trim().slice(0, 500) || 'Customer requested return';
      const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { email: true } });
      const rr = await prisma.returnRequest.create({
        data: {
          orderId: order.id,
          reason,
          requestedBy: customerId,
          requesterEmail: customer.email,
          items: { create: requested.map((r) => ({ orderItemId: r.orderItemId, quantity: r.quantity })) },
        },
        include: { items: true },
      });
      res.status(201).json({ data: rr });
    } catch (error) { next(error); }
  });

  // POST /api/customer/orders/:reference/replacement
  router.post('/orders/:reference/replacement', validateCsrf, async (req, res, next) => {
    try {
      const customerId = req.customerId;
      const reference = String(req.params.reference || '').trim();
      const prisma = resolvePrisma();
      const order = await prisma.order.findFirst({ where: { reference, customerId }, include: { items: true } });
      if (!order) throw new HttpError(404, 'Order not found');
      if (order.status !== 'delivered') throw new HttpError(400, 'Replacements are only available for delivered orders');
      await assertWithinReturnWindow(prisma, order.id);
      const body = req.body || {};
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) throw new HttpError(400, 'At least one item is required');
      const orderItemMap = new Map(order.items.map((i) => [i.id, i]));
      const requested = [];
      for (const it of items) {
        const id = Number(it.orderItemId);
        const qty = Number(it.quantity);
        const oi = orderItemMap.get(id);
        if (!oi) throw new HttpError(400, 'Invalid order item');
        if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, 'Invalid quantity');
        requested.push({ orderItemId: id, quantity: qty, oi });
      }
      const existingReturns = await prisma.returnRequest.findMany({ where: { orderId: order.id }, include: { items: true } });
      const existingReplacements = await prisma.replacementRequest.findMany({ where: { orderId: order.id }, include: { items: true } });
      const reservedByItem = new Map();
      for (const r of [...existingReturns, ...existingReplacements]) {
        if (r.status === 'rejected') continue;
        for (const it of r.items) {
          reservedByItem.set(it.orderItemId, (reservedByItem.get(it.orderItemId) || 0) + it.quantity);
        }
      }
      for (const r of requested) {
        const reserved = reservedByItem.get(r.orderItemId) || 0;
        if (r.quantity + reserved > r.oi.quantity) throw new HttpError(400, 'Requested quantity exceeds available eligibility');
      }
      const reason = String(body.reason || '').trim().slice(0, 500) || 'Customer requested replacement';
      const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { email: true } });
      const rr = await prisma.replacementRequest.create({
        data: {
          orderId: order.id,
          reason,
          requestedBy: customerId,
          requesterEmail: customer.email,
          items: { create: requested.map((r) => ({ orderItemId: r.orderItemId, quantity: r.quantity })) },
        },
        include: { items: true },
      });
      res.status(201).json({ data: rr });
    } catch (error) { next(error); }
  });

  // GET /api/customer/notifications
  router.get('/notifications', async (req, res, next) => {
    try {
      const customerId = req.customerId;
      const prisma = resolvePrisma();
      const notifications = await prisma.notification.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      res.json({ data: notifications });
    } catch (error) { next(error); }
  });

  // PATCH /api/customer/profile
  router.patch('/profile', validateCsrf, async (req, res, next) => {
    try {
      const customerId = req.customerId;
      const prisma = resolvePrisma();
      const b = req.body || {};
      const data = {};
      if (b.name !== undefined) data.name = String(b.name).trim().slice(0, 200) || null;
      if (b.phone !== undefined) {
        const phone = String(b.phone).trim();
        if (phone && !/^\+?\d{8,15}$/.test(phone)) {
          throw new HttpError(400, 'Phone must be between 8 and 15 digits');
        }
        data.phone = phone || null;
      }
      const updated = await prisma.customer.update({
        where: { id: customerId },
        data,
        select: { id: true, email: true, name: true, phone: true, role: true },
      });
      res.json({ data: updated });
    } catch (error) { next(error); }
  });

  // POST /api/customer/change-password
  router.post('/change-password', validateCsrf, async (req, res, next) => {
    try {
      const customerId = req.customerId;
      const prisma = resolvePrisma();
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        throw new HttpError(400, 'Current and new password are required');
      }
      if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
        throw new HttpError(400, 'New password must be between 12 and 128 characters');
      }
      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!customer || !customer.passwordHash) {
        throw new HttpError(400, 'Account does not support password changes');
      }
      const { verifyPassword, hashPassword } = await import('../models/auth.js');
      const valid = await verifyPassword(currentPassword, customer.passwordHash);
      if (!valid) {
        throw new HttpError(401, 'Current password is incorrect');
      }
      const newHash = await hashPassword(newPassword);
      await prisma.$transaction(async (tx) => {
        await tx.customer.update({
          where: { id: customerId },
          data: { passwordHash: newHash },
        });
        // A reset code requested earlier must not outlive the password it was meant to replace.
        await tx.emailOtp.deleteMany({ where: { customerId, purpose: 'reset' } });
      });
      // Every other device is signed out, and this one continues on a new session ID.
      const newSessionId = await req.session.regenerate();
      if (newSessionId) req.session.setCookie(newSessionId);
      await sessionStore.destroyAllForCustomer(customerId, {
        exceptHash: newSessionId ? hashSessionId(newSessionId) : undefined,
      });
      res.json({ data: { message: 'Password updated. Other devices have been signed out.' } });
    } catch (error) { next(error); }
  });

  return router;
}

export default createCustomerRouter;
