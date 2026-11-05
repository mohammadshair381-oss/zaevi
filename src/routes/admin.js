/**
 * Admin API and page router.
 *
 *   GET /admin                          - protected admin console page (serves admin.html)
 *   GET /api/admin/stats                - real dashboard statistics from the database
 *   GET /api/admin/orders               - paginated order list, optional status filter
 *   GET /api/admin/orders/:reference    - single order incl. items and customer contact
 *   PATCH /api/admin/orders/:reference/status
 *                                       - advance the production workflow
 *                                         (validated transition, CSRF-protected)
 *   GET /api/admin/products             - paginated catalog listing (availability only)
 *
 * Every route is guarded by `requireAdmin`, which re-verifies the customer's
 * 'admin' role against the database on EACH request using the verified session
 * customerId. Anonymous and ordinary-customer requests receive 404 (not 401/403)
 * so the admin surface's existence is not disclosed. The status write endpoint
 * additionally passes `validateCsrf` (wired into the API gate).
 */
import { getEmailConfig } from '../services/email.js';
import { adminRecoveryConfig } from '../services/admin-recovery.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';

import { getPrismaClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { createRequireAdmin } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import { notifyStatusUpdate, notifyShipmentDispatched, retryNotification } from '../services/notification.js';
import { deliverContactNotification } from './contact.js';
import { addSiteStudioAdminRoutes } from './site-studio.js';
import { isSafeStudioUrl } from '../models/site-studio.js';
import { serializeProduct } from './products.js';
import { serializeOrder } from '../models/order.js';
import {
  assertOrderStatusTransition,
  getAllowedNextStatuses,
  getOrderStatusLabel,
  parseOrderStatusUpdateBody,
} from '../models/order-status.js';

/** Project root (mirrors src/app.js): two levels up from src/routes. */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Maximum page size for both admin listings. */
const MAX_PAGE_SIZE = 50;
/** Default page size. */
const DEFAULT_PAGE_SIZE = 20;
/** Reference column length, mirrored from the Order model. */
const MAX_REFERENCE_LENGTH = 32;
/** Status filter shape mirrors the Order.status column (VarChar 20). */
const MAX_STATUS_LENGTH = 20;
/** Role value stored in Customer.role; single comparison point for the gate. */
export const ADMIN_ROLE = 'admin';
const CONTACT_STATUSES = new Set(['new', 'read', 'resolved']);
const PRODUCT_GENDERS = new Set(['Women', 'Men', 'Unisex']);

/** Validates an add or edit product form. Sizes are options only: ZAEVI holds no stock. */
export function parseProductInput(body, { partial = false } = {}) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const data = {};
  const text = (key, label, max) => {
    if (input[key] === undefined) {
      if (!partial) throw new HttpError(400, `${label} is required`);
      return;
    }
    const value = String(input[key] ?? '').trim();
    if (!value) throw new HttpError(400, `${label} is required`);
    if (value.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer`);
    data[key] = value;
  };
  text('name', 'Name', 200);
  text('category', 'Category', 100);
  text('color', 'Colour', 50);
  text('description', 'Description', 4000);
  text('imageUrl', 'Main photo', 1024);
  if (input.hoverImageUrl !== undefined && String(input.hoverImageUrl).trim() !== '') {
    data.hoverImageUrl = String(input.hoverImageUrl).trim().slice(0, 1024);
  } else if (!partial) {
    data.hoverImageUrl = data.imageUrl;
  }
  for (const key of ['imageUrl', 'hoverImageUrl']) {
    if (data[key] !== undefined && !isSafeStudioUrl(data[key])) {
      throw new HttpError(400, 'Photos must be uploaded images or https:// links');
    }
  }
  if (input.gender !== undefined || !partial) {
    if (!PRODUCT_GENDERS.has(input.gender)) throw new HttpError(400, 'Choose Women, Men or Unisex');
    data.gender = input.gender;
  }
  if (input.price !== undefined || !partial) {
    const price = Number(input.price);
    if (!Number.isInteger(price) || price <= 0) throw new HttpError(400, 'Price must be a whole number of rupees above 0');
    data.price = price;
  }
  if (input.available !== undefined) {
    if (typeof input.available !== 'boolean') throw new HttpError(400, 'Available must be true or false');
    data.available = input.available;
  }

  let sizes;
  if (input.sizes !== undefined || !partial) {
    if (!Array.isArray(input.sizes)) throw new HttpError(400, 'Add at least one size');
    // The database treats "s" and "S" as the same size, so duplicates are matched the same way.
    const seen = new Set();
    sizes = input.sizes.map((size) => String(size ?? '').trim()).filter((size) => {
      const key = size.toLowerCase();
      if (!size || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (sizes.length === 0) throw new HttpError(400, 'Add at least one size');
    if (sizes.some((size) => size.length > 20)) throw new HttpError(400, 'Each size must be 20 characters or fewer');
  }
  return { data, sizes };
}

/** Validate {page,limit} query params against the shared pagination contract. */
export function parsePagination(query = {}) {
  const rawPage = query.page === undefined || query.page === '' ? '1' : query.page;
  const rawLimit = query.limit === undefined || query.limit === '' ? String(DEFAULT_PAGE_SIZE) : query.limit;
  const page = Number(rawPage);
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new HttpError(400, '"page" must be a positive integer');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new HttpError(400, `"limit" must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  return { page, limit };
}

/** Validate the optional status filter (free-form column value, bounded length). */
export function parseStatusFilter(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new HttpError(400, '"status" must be a string');
  const status = raw.trim();
  if (status === '') return null;
  if (status.length > MAX_STATUS_LENGTH) {
    throw new HttpError(400, `"status" must be at most ${MAX_STATUS_LENGTH} characters`);
  }
  return status;
}

/** Customer identity fields an administrator may see. passwordHash/session data
 *  are never selected and therefore can never leak, even by accident. */
const ADMIN_CUSTOMER_SELECT = {
  select: { id: true, email: true, name: true, phone: true, createdAt: true },
};

/** Admin-facing order serialization: adds the customer identity + contact snapshot. */
export function serializeAdminOrder(order) {
  const base = serializeOrder(order);
  return {
    ...base,
    statusLabel: getOrderStatusLabel(order.status),
    // Only the transitions the current state actually permits. Terminal or
    // unknown statuses return an empty list, so the UI cannot offer an invalid
    // change (the API validates again regardless of what the UI sends).
    allowedNextStatuses: getAllowedNextStatuses(order.status).map((value) => ({
      value,
      label: getOrderStatusLabel(value),
    })),
    contactEmail: order.contactEmail ?? null,
    contactPhone: order.contactPhone ?? null,
    customer: order.customer ? { ...order.customer } : null,
  };
}

/** Dashboard statistics derived entirely from persisted rows; no projections. */
export async function buildAdminStats(prisma) {
  const [orderTotal, customerTotal, statusRows, valueRows] = await Promise.all([
    prisma.order.count(),
    prisma.customer.count(),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
    prisma.order.aggregate({ _sum: { totalMinor: true } }),
  ]);
  return {
    orders: {
      total: orderTotal,
      byStatus: statusRows.map((row) => ({ status: row.status, count: row._count._all })),
    },
    customers: { total: customerTotal },
    // Integer paise. The UI must label this as TOTAL ORDER VALUE, never
    // "revenue" — orders are not paid (no payment integration exists yet).
    totalOrderValueMinor: valueRows._sum.totalMinor ?? 0,
    currency: 'INR',
  };
}

/**
 * Admin-facing catalog serialization. ZAEVI is produced on demand: there is no
 * warehouse stock, so the admin listing deliberately carries no stock data —
 * it is the public serializer shape plus nothing inventorial.
 */
export function serializeAdminProduct(row) {
  return serializeProduct(row);
}

export function createAdminRouter({ getPrisma, root } = {}) {
  const resolvePrisma = getPrisma ?? getPrismaClient;
  const requireAdmin = createRequireAdmin({ getPrisma: resolvePrisma });
  const router = Router();

  // ---- Protected page -------------------------------------------------------
  // Serves admin.html only to verified administrators. Anonymous and
  // ordinary-customer requests get 404 from the gate.
  const sendAdminPage = (res, file) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(path.join(root ?? projectRoot, file));
  };

  router.get('/admin', requireAdmin, (req, res) => sendAdminPage(res, 'admin.html'));

  // Emergency sign-in page. It exists only while valid recovery settings are in place.
  router.get('/admin/recovery', (req, res, next) => (
    adminRecoveryConfig().enabled ? sendAdminPage(res, 'admin-recovery.html') : next()
  ));

  // GlowCare-style homepage editor foundation (Phase A). Served only to
  // verified administrators; data endpoints remain behind requireAdmin/CSRF.
  router.get('/admin/studio', requireAdmin, (req, res) => sendAdminPage(res, 'site-studio.html'));

  router.get('/admin/homepage-editor', requireAdmin, (req, res) => sendAdminPage(res, 'homepage-editor.html'));

  // ---- Protected APIs -------------------------------------------------------
  // requireAdmin gates every API (404 for anon/customers); validateCsrf adds
  // the double-submit token check for authenticated state-changing methods
  // (POST/PUT/PATCH/DELETE). GETs pass through untouched.
  const api = Router();
  api.use(requireAdmin, validateCsrf);

  api.get('/stats', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const stats = await buildAdminStats(prisma);
      return res.status(200).json({ data: stats });
    } catch (error) {
      return next(error);
    }
  });

  api.get('/orders', async (req, res, next) => {
    try {
      const { page, limit } = parsePagination(req.query);
      const status = parseStatusFilter(req.query.status);
      const prisma = resolvePrisma();
      const where = status ? { status } : {};
      const total = await prisma.order.count({ where });
      const rows = await prisma.order.findMany({
        where,
        include: { items: true, customer: ADMIN_CUSTOMER_SELECT },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      });
      return res.status(200).json({
        data: rows.map(serializeAdminOrder),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      return next(error);
    }
  });

  api.get('/orders/:reference', async (req, res, next) => {
    try {
      const reference = String(req.params.reference ?? '').trim();
      if (reference === '' || reference.length > MAX_REFERENCE_LENGTH) {
        throw new HttpError(404, 'Order not found');
      }
      const prisma = resolvePrisma();
      const order = await prisma.order.findUnique({
        where: { reference },
        include: { items: true, customer: ADMIN_CUSTOMER_SELECT },
      });
      if (!order) {
        throw new HttpError(404, 'Order not found');
      }
      return res.status(200).json({ data: serializeAdminOrder(order) });
    } catch (error) {
      return next(error);
    }
  });

  // PATCH /api/admin/orders/:reference/status
  // Advance an order through the production workflow. The update is conditioned
  // on the status that was read, so two concurrent admins cannot skip or
  // overwrite each other's transition. CSRF is enforced by the router-level
  // `validateCsrf` above.
  api.patch('/orders/:reference/status', async (req, res, next) => {
    try {
      const reference = String(req.params.reference ?? '').trim();
      if (reference === '' || reference.length > MAX_REFERENCE_LENGTH) {
        throw new HttpError(404, 'Order not found');
      }
      const { status: nextStatus } = parseOrderStatusUpdateBody(req.body);
      const prisma = resolvePrisma();

      const current = await prisma.order.findUnique({
        where: { reference },
        select: { status: true },
      });
      if (!current) {
        throw new HttpError(404, 'Order not found');
      }
      assertOrderStatusTransition(current.status, nextStatus);

      if (current.status !== nextStatus) {
        const runTx = typeof prisma.$transaction === 'function' ? prisma.$transaction.bind(prisma) : async (fn) => fn(prisma);
        await runTx(async (tx) => {
          const result = await tx.order.updateMany({
            where: { reference, status: current.status },
            data: { status: nextStatus },
          });
          if (result.count === 0) {
            const latest = await tx.order.findUnique({ where: { reference }, select: { status: true } });
            if (!latest) throw new HttpError(404, 'Order not found');
            assertOrderStatusTransition(latest.status, nextStatus);
            throw new HttpError(409, 'Order status was changed concurrently; reload and try again');
          }
          const row = await tx.order.findUnique({ where: { reference }, select: { id: true } });
          if (typeof tx.orderStatusHistory?.create === "function") await tx.orderStatusHistory.create({
            data: {
              orderId: row.id,
              previousStatus: current.status,
              newStatus: nextStatus,
              note: req.body && req.body.note ? String(req.body.note).slice(0, 500) : null,
              visibility: (req.body && req.body.visibility === 'internal') ? 'internal' : 'customer',
              changedBy: req.customerId || null,
            },
          });
        });
      }

      const updated = await prisma.order.findUnique({
        where: { reference },
        include: { items: true, customer: ADMIN_CUSTOMER_SELECT },
      });
      if (!updated) {
        throw new HttpError(404, 'Order not found');
      }
      if (current.status !== nextStatus && req.body?.visibility !== 'internal') {
        await notifyStatusUpdate(prisma, { order: updated, newStatus: nextStatus, label: getOrderStatusLabel(nextStatus) });
      }
      return res.status(200).json({ data: serializeAdminOrder(updated) });
    } catch (error) {
      return next(error);
    }
  });

  api.get('/products', async (req, res, next) => {
    try {
      const { page, limit } = parsePagination(req.query);
      const prisma = resolvePrisma();
      const total = await prisma.product.count();
      const rows = await prisma.product.findMany({
        include: { sizes: { orderBy: { position: 'asc' } } },
        orderBy: { id: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      });
      return res.status(200).json({
        data: rows.map(serializeAdminProduct),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      return next(error);
    }
  });

  // Add and edit products. There are deliberately no stock quantities: ZAEVI is produced
  // on demand. Products are hidden with `available`, never deleted, so past orders stay intact.
  api.post('/products', async (req, res, next) => {
    try {
      const { data, sizes } = parseProductInput(req.body);
      const prisma = resolvePrisma();
      const existing = await prisma.product.findMany({ select: { id: true } });
      const highest = existing.reduce((max, row) => {
        const match = /^ZV(\d+)$/.exec(row.id);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0);
      const id = `ZV${String(highest + 1).padStart(3, '0')}`;
      const row = await prisma.product.create({
        data: { id, ...data, sizes: { create: sizes.map((size, position) => ({ size, position })) } },
        include: { sizes: { orderBy: { position: 'asc' } } },
      });
      res.status(201).json({ data: serializeAdminProduct(row) });
    } catch (e) {
      // Two products saved at the same moment would pick the same new ID. Neither is overwritten.
      if (e.code === 'P2002') return next(new HttpError(409, 'Another product was added at the same moment. Please save again.'));
      next(e);
    }
  });

  api.patch('/products/:id', async (req, res, next) => {
    try {
      const id = String(req.params.id || '').trim();
      const { data, sizes } = parseProductInput(req.body, { partial: true });
      const prisma = resolvePrisma();
      const current = await prisma.product.findUnique({ where: { id }, select: { id: true, imageUrl: true } });
      if (!current) throw new HttpError(404, 'Product not found');
      // Clearing the second photo means the main photo is also shown on hover.
      if (req.body?.hoverImageUrl !== undefined && String(req.body.hoverImageUrl ?? '').trim() === '') {
        data.hoverImageUrl = data.imageUrl ?? current.imageUrl;
      }
      const row = await prisma.$transaction(async (tx) => {
        if (sizes) {
          // Sizes that stay keep their row, so anything else stored on them is preserved.
          const stored = await tx.productSize.findMany({ where: { productId: id }, select: { id: true, size: true } });
          const storedBySize = new Map(stored.map((row) => [row.size.toLowerCase(), row]));
          const kept = new Set(sizes.map((size) => size.toLowerCase()));
          const removed = stored.filter((row) => !kept.has(row.size.toLowerCase())).map((row) => row.id);
          if (removed.length) await tx.productSize.deleteMany({ where: { id: { in: removed } } });
          for (const [position, size] of sizes.entries()) {
            const existing = storedBySize.get(size.toLowerCase());
            if (existing) await tx.productSize.update({ where: { id: existing.id }, data: { size, position } });
            else await tx.productSize.create({ data: { productId: id, size, position } });
          }
        }
        return tx.product.update({
          where: { id },
          data,
          include: { sizes: { orderBy: { position: 'asc' } } },
        });
      });
      res.json({ data: serializeAdminProduct(row) });
    } catch (e) { next(e); }
  });

  // Whether email can reach anyone, so the admin panel can say so plainly.
  api.get('/email-status', (req, res) => {
    res.json({ data: { configured: getEmailConfig().configured } });
  });

  // What needs a person's attention, for the dashboard.
  api.get('/attention', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const [newOrders, cancellations, returns, replacements, messages, reviews, failedEmails] = await Promise.all([
        prisma.order.count({ where: { status: 'pending' } }),
        prisma.cancellationRequest.count({ where: { status: 'pending' } }),
        prisma.returnRequest.count({ where: { status: 'pending' } }),
        prisma.replacementRequest.count({ where: { status: 'pending' } }),
        prisma.contactMessage.count({ where: { status: 'new' } }),
        prisma.review.count({ where: { status: 'pending' } }),
        prisma.notification.count({ where: { status: 'failed' } }),
      ]);
      res.json({ data: { newOrders, cancellations, returns, replacements, messages, reviews, failedEmails } });
    } catch (e) { next(e); }
  });

  addSiteStudioAdminRoutes(api, resolvePrisma);

  // Lifecycle management endpoints
  api.get('/delivery-config', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const cfg = await prisma.deliveryEstimateConfig.findUnique({ where: { id: 1 } });
      res.json({ data: cfg || { id: 1, productionDays: 7, qualityCheckDays: 2, packingDays: 2, shippingDays: 5, bufferDays: 2 } });
    } catch (e) { next(e); }
  });
  api.patch('/delivery-config', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const b = req.body || {};
      const data = {};
      for (const k of ['productionDays','qualityCheckDays','packingDays','shippingDays','bufferDays']) {
        if (b[k] !== undefined) data[k] = Number(b[k]);
      }
      data.updatedBy = req.customerId || null;
      const cfg = await prisma.deliveryEstimateConfig.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
      });
      res.json({ data: cfg });
    } catch (e) { next(e); }
  });

  api.get('/orders/:reference/history', async (req, res, next) => {
    try {
      const reference = String(req.params.reference || '').trim();
      const prisma = resolvePrisma();
      const order = await prisma.order.findUnique({ where: { reference }, select: { id: true } });
      if (!order) throw new HttpError(404, 'Order not found');
      const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
      res.json({ data: history });
    } catch (e) { next(e); }
  });

  api.post('/orders/:reference/shipment', async (req, res, next) => {
    try {
      const reference = String(req.params.reference || '').trim();
      const prisma = resolvePrisma();
      const order = await prisma.order.findUnique({ where: { reference } });
      if (!order) throw new HttpError(404, 'Order not found');
      const b = req.body || {};
      const data = {
        orderId: order.id,
        type: b.type || 'outbound',
        carrier: b.carrier || null,
        trackingNumber: b.trackingNumber || null,
        trackingUrl: b.trackingUrl || null,
        dispatchedAt: b.dispatchedAt ? new Date(b.dispatchedAt) : null,
        estimatedDeliveryAt: b.estimatedDeliveryAt ? new Date(b.estimatedDeliveryAt) : null,
        deliveredAt: b.deliveredAt ? new Date(b.deliveredAt) : null,
      };
      // link to request if provided
      if (b.replacementRequestId) data.replacementRequest = { connect: { id: Number(b.replacementRequestId) } };
      if (b.returnRequestId) data.returnRequest = { connect: { id: Number(b.returnRequestId) } };
      const shipment = await prisma.shipment.create({ data });
      if (data.type === 'outbound') await notifyShipmentDispatched(prisma, { order, shipment });
      res.status(201).json({ data: shipment });
    } catch (e) { next(e); }
  });

  api.patch('/orders/:reference/estimate', async (req, res, next) => {
    try {
      const reference = String(req.params.reference || '').trim();
      const prisma = resolvePrisma();
      const b = req.body || {};
      const data = {};
      if (b.estimatedProductionCompleteAt) data.estimatedProductionCompleteAt = new Date(b.estimatedProductionCompleteAt);
      if (b.estimatedDispatchAt) data.estimatedDispatchAt = new Date(b.estimatedDispatchAt);
      const order = await prisma.order.update({ where: { reference }, data });
      res.json({ data: order });
    } catch (e) { next(e); }
  });

  api.get('/cancellation-requests', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const rows = await prisma.cancellationRequest.findMany({ include: { order: true, requester: { select: { id: true, email: true, name: true } } }, orderBy: { createdAt: 'desc' } });
      res.json({ data: rows });
    } catch (e) { next(e); }
  });
  api.patch('/cancellation-requests/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const prisma = resolvePrisma();
      const b = req.body || {};
      const status = b.status;
      const cr = await prisma.cancellationRequest.findUnique({ where: { id }, include: { order: true } });
      if (!cr) throw new HttpError(404, 'Not found');
      if (status === 'approved') {
        await prisma.$transaction(async (tx) => {
          const r = await tx.order.updateMany({ where: { id: cr.orderId, status: cr.order.status }, data: { status: 'cancelled' } });
          if (r.count !== 1) throw new HttpError(409, 'Concurrent change');
          if (typeof tx.orderStatusHistory?.create === "function") await tx.orderStatusHistory.create({ data: { orderId: cr.orderId, previousStatus: cr.order.status, newStatus: 'cancelled', note: b.note || cr.reason, visibility: b.visibility === 'internal' ? 'internal' : 'customer', changedBy: req.customerId || null } });
          await tx.cancellationRequest.update({ where: { id }, data: { status: 'approved', decidedBy: req.customerId || null, deciderEmail: null, decidedAt: new Date() } });
        });
      } else {
        await prisma.cancellationRequest.update({ where: { id }, data: { status: status || 'rejected', decidedBy: req.customerId || null, decidedAt: new Date() } });
      }
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  api.get('/return-requests', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const rows = await prisma.returnRequest.findMany({ include: { order: true, items: true, requester: { select: { id: true, email: true, name: true } } }, orderBy: { createdAt: 'desc' } });
      res.json({ data: rows });
    } catch (e) { next(e); }
  });
  api.patch('/return-requests/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const prisma = resolvePrisma();
      const b = req.body || {};
      const status = b.status;
      const data = { status: status || undefined, decidedBy: req.customerId || null, decidedAt: new Date() };
      if (b.receivedAt) data.receivedAt = new Date(b.receivedAt);
      if (b.refundStatus) data.refundStatus = b.refundStatus;
      await prisma.returnRequest.update({ where: { id }, data });
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  api.get('/replacement-requests', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const rows = await prisma.replacementRequest.findMany({ include: { order: true, items: true, requester: { select: { id: true, email: true, name: true } } }, orderBy: { createdAt: 'desc' } });
      res.json({ data: rows });
    } catch (e) { next(e); }
  });
  api.patch('/replacement-requests/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const prisma = resolvePrisma();
      const b = req.body || {};
      const status = b.status;
      const data = { status: status || undefined, decidedBy: req.customerId || null, decidedAt: new Date() };
      if (b.replacementShipmentId) data.replacementShipmentId = Number(b.replacementShipmentId);
      await prisma.replacementRequest.update({ where: { id }, data });
      res.json({ data: { ok: true } });
    } catch (e) { next(e); }
  });

  api.get('/orders/:reference/history', async (req, res, next) => {
    try {
      const reference = String(req.params.reference || '').trim();
      const prisma = resolvePrisma();
      const order = await prisma.order.findUnique({ where: { reference }, select: { id: true } });
      if (!order) throw new HttpError(404, 'Order not found');
      const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
      res.json({ data: history });
    } catch (e) { next(e); }
  });

  api.get('/shipments', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const type = req.query.type ? String(req.query.type).trim() : null;
      const dispatched = req.query.dispatched;
      const delivered = req.query.delivered;
      const where = {};
      if (type) where.type = type;
      if (dispatched === 'true') where.dispatchedAt = { not: null };
      if (dispatched === 'false') where.dispatchedAt = null;
      if (delivered === 'true') where.deliveredAt = { not: null };
      if (delivered === 'false') where.deliveredAt = null;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const skip = (page - 1) * limit;
      const [total, rows] = await Promise.all([
        prisma.shipment.count({ where }),
        prisma.shipment.findMany({
          where,
          include: { order: { include: { customer: { select: { id: true, email: true, name: true } } } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
      ]);
      res.json({ data: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (e) { next(e); }
  });

  // Attempt a stored notification again, for example after SMTP has been configured.
  api.post('/notifications/:id/retry', async (req, res, next) => {
    try {
      const row = await retryNotification(resolvePrisma(), Number(req.params.id));
      if (!row) throw new HttpError(404, 'Notification not found');
      res.json({ data: row });
    } catch (e) { next(e); }
  });

  api.get('/contact-messages', async (req, res, next) => {
    try {
      const { page, limit } = parsePagination(req.query);
      const prisma = resolvePrisma();
      const where = CONTACT_STATUSES.has(req.query.status) ? { status: req.query.status } : {};
      const [rows, total] = await Promise.all([
        prisma.contactMessage.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.contactMessage.count({ where }),
      ]);
      res.json({ data: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (e) { next(e); }
  });

  api.patch('/contact-messages/:id', async (req, res, next) => {
    try {
      if (!CONTACT_STATUSES.has(req.body?.status)) throw new HttpError(400, 'Invalid message status');
      const prisma = resolvePrisma();
      const id = Number(req.params.id);
      const { count } = await prisma.contactMessage.updateMany({ where: { id }, data: { status: req.body.status } });
      if (count === 0) throw new HttpError(404, 'Message not found');
      res.json({ data: await prisma.contactMessage.findUnique({ where: { id } }) });
    } catch (e) { next(e); }
  });

  api.post('/contact-messages/:id/notify', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const row = await prisma.contactMessage.findUnique({ where: { id: Number(req.params.id) } });
      if (!row) throw new HttpError(404, 'Message not found');
      res.json({ data: await deliverContactNotification(prisma, row) });
    } catch (e) { next(e); }
  });

  api.get('/notifications', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const rows = await prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      res.json({ data: rows });
    } catch (e) { next(e); }
  });

  api.get('/analytics/sales', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const orders = await prisma.order.findMany({
        select: { createdAt: true, totalMinor: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      const byDate = {};
      for (const o of orders) {
        const date = o.createdAt ? o.createdAt.toISOString().slice(0, 10) : 'unknown';
        if (!byDate[date]) byDate[date] = { date, orderCount: 0, totalMinor: 0 };
        byDate[date].orderCount += 1;
        if (o.status !== 'cancelled') byDate[date].totalMinor += o.totalMinor;
      }
      res.json({ data: Object.values(byDate) });
    } catch (e) { next(e); }
  });

  api.get('/analytics/top-products', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const items = await prisma.orderItem.groupBy({
        by: ['productId', 'productName'],
        _sum: { quantity: true, lineTotalMinor: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 10,
      });
      res.json({ data: items });
    } catch (e) { next(e); }
  });

  api.get('/orders/export/csv', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const rows = await prisma.order.findMany({
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });
      let csv = 'Reference,CreatedAt,CustomerEmail,Status,SubtotalINR,DiscountINR,TotalINR,ItemsCount\n';
      for (const o of rows) {
        const email = (o.contactEmail || '').replace(/,/g, ' ');
        const date = o.createdAt ? o.createdAt.toISOString() : '';
        const subtotal = (o.subtotalMinor / 100).toFixed(2);
        const discount = ((o.discountMinor || 0) / 100).toFixed(2);
        const total = (o.totalMinor / 100).toFixed(2);
        const count = o.items ? o.items.length : 0;
        csv += `${o.reference},${date},${email},${o.status},${subtotal},${discount},${total},${count}\n`;
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="zaevi-orders.csv"');
      res.send(csv);
    } catch (e) { next(e); }
  });

  router.use('/api/admin', api);
  return router;
}

export default createAdminRouter;
