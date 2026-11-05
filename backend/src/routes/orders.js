/**
 * Order API.
 *
 *   POST /api/orders  - validate a checkout payload, price it from the
 *                       database, and persist Order + OrderItem rows in a
 *                       single transaction. ZAEVI is produced on demand: no
 *                       stock is checked, deducted or required at checkout,
 *                       and all transactional guarantees (idempotency, pricing
 *                       from the catalog, snapshots) are preserved.
 *   POST /api/orders/track
 *                     - public production-status lookup by order reference and
 *                       checkout email (rate limited; no PII beyond the order).
 *
 * Like the product router this is a factory taking a `getDb()` resolver so
 * tests can inject an in-memory client. No authentication or payment logic
 * lives here beyond the session gate; an order is *placed*, not paid.
 */
import { Router } from 'express';

import { getDbClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import {
  buildCanonicalPayload,
  buildOrderLines,
  generateOrderReference,
  hashCanonicalPayload,
  hashIdempotencyKey,
  parseIdempotencyKey,
  parseOrderRequest,
  parseOrderTrackingRequest,
  serializeOrder,
  shippingFromAddress,
} from '../models/order.js';
import {
  buildOrderStatusTimeline,
  getOrderStatusLabel,
} from '../models/order-status.js';

/** How many times to regenerate a reference before giving up. */
export const MAX_REFERENCE_ATTEMPTS = 5;

/** True for a database unique-constraint violation (`duplicate-key`). */
function isUniqueViolation(error) {
  return Boolean(error) && error.code === 'DUPLICATE_KEY';
}

/** Check if a duplicate-key error is for the idempotencyKey unique constraint. */
function isIdempotencyKeyCollision(error) {
  return isUniqueViolation(error) && error.meta?.target?.includes('idempotencyKey');
}

/** Create or link the customer for this checkout, keyed by normalized email. */
async function upsertCustomer(tx, draft) {
  const update = {};
  if (draft.name) update.name = draft.name;
  if (draft.phone) update.phone = draft.phone;

  const create = { email: draft.email };
  if (draft.name) create.name = draft.name;
  if (draft.phone) create.phone = draft.phone;

  return tx.customer.upsert({ where: { email: draft.email }, create, update });
}

export function createOrdersRouter({ getDb, orderRateLimit, requireAuthForOrders = false } = {}) {
  const resolveDb = getDb ?? getDbClient;
  const router = Router();

  // Order creation is rate limited per client IP (see rate-limit.js). Applied
  // only to this route so product browsing and unrelated endpoints are
  // unaffected. `orderRateLimit: false` disables it (used by focused tests).
  const orderLimiter =
    orderRateLimit === false ? (req, res, next) => next() : createRateLimiter(orderRateLimit || {});

  // Checkout policy: the ZAEVI storefront requires a signed-in customer before
  // an order can be created (`server.js` enables this). It is enforced in two
  // layers: the checkout page sends the customer to sign in, and the server
  // rejects any order without a valid session. `requireAuth` rejects guests with
  // 401; `validateCsrf` additionally requires the double-submit token on the
  // authenticated POST (it is a no-op for guest requests).
  //
  // Default is `false` so API consumers and the existing test suite built on
  // guest checkout keep working unchanged; guest support is NOT deleted.
  const authGuards = requireAuthForOrders ? [requireAuth, validateCsrf] : [];

  // POST /api/orders/track
  // Public, read-only tracking lookup: reference + checkout email in the body
  // (POST keeps the email out of URLs and access logs). The same per-IP limiter
  // protects this endpoint from enumeration attempts. A reference/email mismatch
  // returns the same 404 as an unknown reference.
  router.post('/orders/track', orderLimiter, async (req, res, next) => {
    try {
      const lookup = parseOrderTrackingRequest(req.body);
      const db = resolveDb();
      const order = await db.order.findUnique({
        where: { reference: lookup.reference },
        include: { items: true },
      });
      const storedEmail = String(order?.contactEmail ?? '').trim().toLowerCase();
      if (!order || storedEmail !== lookup.email) {
        throw new HttpError(404, 'Order not found');
      }
      return res.status(200).json({
        data: {
          ...serializeOrder(order),
          statusLabel: getOrderStatusLabel(order.status),
          timeline: buildOrderStatusTimeline(order.status),
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/orders
  router.post('/orders', orderLimiter, ...authGuards, async (req, res, next) => {
    try {
      const rawIdempotencyKey = parseIdempotencyKey(req.headers['idempotency-key']);
      // Hash the key for secure at-rest storage. The database stores only the hash.
      const idempotencyKeyHash = hashIdempotencyKey(rawIdempotencyKey);
      const draft = parseOrderRequest(req.body);
      const db = resolveDb();

      // The verified session identity (never client-supplied). Used for address
      // ownership checks and for linking the order to the signed-in customer.
      const sessionCustomerId =
        req.customerId ??
        (req.session && req.session.isAuthenticated ? req.session.customerId : null);

      // Resolve a saved delivery address before the payload is hashed: the
      // shipping snapshot must be rebuilt from the owned row, never from
      // client-supplied fields.
      if (draft.addressId) {
        if (!sessionCustomerId) {
          throw new HttpError(401, 'Authentication required');
        }
        const savedAddress = await db.address.findFirst({
          where: { id: draft.addressId, customerId: sessionCustomerId },
        });
        if (!savedAddress) {
          throw new HttpError(400, 'Selected delivery address is not available');
        }
        draft.shipping = shippingFromAddress(savedAddress);
        if (!draft.phone && savedAddress.phone) draft.phone = savedAddress.phone;
      }

      // Build canonical payload and hash BEFORE loading products or calculating prices.
      const canonicalPayload = buildCanonicalPayload(draft);
      const payloadHash = hashCanonicalPayload(canonicalPayload);

      // Fast path: check for existing order with this idempotency key hash.
      // For backward compatibility with pre-migration records that store the raw key,
      // also check by raw key if the hash lookup returns nothing.
      let existing = await db.order.findUnique({
        where: { idempotencyKey: idempotencyKeyHash },
        include: { items: true },
      });

      if (!existing) {
        // Fallback: check if a pre-migration record exists with the raw key.
        existing = await db.order.findUnique({
          where: { idempotencyKey: rawIdempotencyKey },
          include: { items: true },
        });
      }

      if (existing) {
        // If we found a record with the raw key, migrate it to store the hash.
        if (existing.idempotencyKey === rawIdempotencyKey) {
          await db.order.update({
            where: { id: existing.id },
            data: { idempotencyKey: idempotencyKeyHash },
          });
          existing.idempotencyKey = idempotencyKeyHash;
        }
        if (existing.idempotencyHash !== payloadHash) {
          throw new HttpError(409, 'Idempotency key reused with different checkout details');
        }
        // Matching hash: return the original stored order immediately.
        // Do not revalidate product availability or recalculate prices for an already-created order.
        return res.status(200).json({ data: serializeOrder(existing) });
      }

      // New key: load products, validate availability/sizes, calculate prices.
      const productIds = [...new Set(draft.items.map((item) => item.productId))];
      const products = await db.product.findMany({
        where: { id: { in: productIds } },
        include: { sizes: true },
      });
      const built = buildOrderLines(products, draft.items);

      // Optional coupon validation and discount calculation
      let appliedCoupon = null;
      let discountMinor = 0;
      if (draft.couponCode && typeof db.coupon?.findUnique === 'function') {
        const c = await db.coupon.findUnique({ where: { code: draft.couponCode.toUpperCase() } });
        const { assertCouponUsable, calculateCouponDiscount } = await import('./coupons.js');
        await assertCouponUsable(db, c, {
          subtotalMinor: built.subtotalMinor,
          email: draft.email,
          customerId: sessionCustomerId ?? null,
        });
        appliedCoupon = c;
        discountMinor = calculateCouponDiscount({ coupon: c, subtotalMinor: built.subtotalMinor });
      }
      const finalTotalMinor = Math.max(0, built.subtotalMinor - discountMinor);

      // Create new order with idempotency metadata (storing the key hash).
      let order = null;
      for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS && !order; attempt += 1) {
        const reference = generateOrderReference();
        try {
          order = await db.$transaction(async (tx) => {
            // Link the order to the verified session customer when signed in;
            // guests still key off the normalized contact email.
            const customerId = sessionCustomerId ?? (await upsertCustomer(tx, draft)).id;
            const cfg = typeof tx.deliveryEstimateConfig?.findUnique === 'function' ? await tx.deliveryEstimateConfig.findUnique({ where: { id: 1 } }) : null;
            const { calculateEstimates } = await import('../models/lifecycle.js');
            const estimates = calculateEstimates(cfg || undefined, new Date());
            const created = await tx.order.create({
              data: {
                reference,
                idempotencyKey: idempotencyKeyHash,
                idempotencyHash: payloadHash,
                customerId,
                status: 'pending',
                currency: 'INR',
                subtotalMinor: built.subtotalMinor,
                discountMinor,
                totalMinor: finalTotalMinor,
                couponId: appliedCoupon ? appliedCoupon.id : null,
                notes: draft.notes || null,
                estimatedProductionCompleteAt: estimates.estimatedProductionCompleteAt,
                estimatedDispatchAt: estimates.estimatedDispatchAt,
                contactEmail: draft.email,
                contactPhone: draft.phone,
                shippingName: draft.shipping.name,
                shippingAddress: draft.shipping.address,
                shippingCity: draft.shipping.city,
                shippingPostalCode: draft.shipping.postalCode,
                shippingCountry: draft.shipping.country,
                items: { create: built.lines },
              },
              include: { items: true },
            });
            if (appliedCoupon && typeof tx.couponUsage?.create === 'function') {
              await tx.couponUsage.create({
                data: {
                  couponId: appliedCoupon.id,
                  orderId: created.id,
                  customerId,
                  discountAmountMinor: discountMinor,
                },
              });
              // Conditional, so concurrent orders cannot exceed the total usage limit.
              const claimed = await tx.coupon.updateMany({
                where: {
                  id: appliedCoupon.id,
                  ...(appliedCoupon.usageLimit ? { usedCount: { lt: appliedCoupon.usageLimit } } : {}),
                },
                data: { usedCount: { increment: 1 } },
              });
              if (claimed.count === 0) {
                throw new HttpError(400, 'This promo code has reached its maximum usage limit');
              }
            }
            if (typeof tx.orderStatusHistory?.create === "function") await tx.orderStatusHistory.create({
              data: {
                orderId: created.id,
                previousStatus: null,
                newStatus: 'pending',
                note: 'Order created',
                visibility: 'customer',
                changedBy: customerId || null,
              },
            });
            return created;
          });
        } catch (error) {
          if (isIdempotencyKeyCollision(error)) {
            // Lost race on idempotency key — winner already committed; fetch and compare hash.
            const winner = await db.order.findUnique({
              where: { idempotencyKey: idempotencyKeyHash },
              include: { items: true },
            });
            if (winner && winner.idempotencyHash === payloadHash) {
              order = winner;
              break;
            }
            throw new HttpError(409, 'Idempotency key reused with different checkout details');
          }
          if (isUniqueViolation(error)) {
            // Reference collision — retry with new reference (same idempotency key).
            continue;
          }
          throw error;
        }
      }
      if (!order) {
        throw new HttpError(500, 'Could not allocate a unique order reference');
      }

      try {
        const { notifyOrderConfirmed } = await import('../services/notification.js');
        await notifyOrderConfirmed(db, { order });
      } catch (e) {
        // notification failures never disrupt the order response
      }

      res.status(201).json({ data: serializeOrder(order) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createOrdersRouter;