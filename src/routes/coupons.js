import { Router } from 'express';
import { getDbClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { createRequireAdmin } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';

export function calculateCouponDiscount({ coupon, subtotalMinor }) {
  let discountMinor = 0;
  if (coupon.discountType === 'percentage') {
    discountMinor = Math.round(subtotalMinor * (coupon.discountValue / 100));
    if (coupon.maxDiscountMinor && discountMinor > coupon.maxDiscountMinor) {
      discountMinor = coupon.maxDiscountMinor;
    }
  } else if (coupon.discountType === 'fixed') {
    discountMinor = Math.min(coupon.discountValue, subtotalMinor);
  }
  return Math.min(discountMinor, subtotalMinor);
}

/**
 * Throws an HttpError explaining why this coupon cannot be used. The checkout
 * preview and order creation both call this, so a discount that was shown can
 * never be silently dropped from the order.
 */
export async function assertCouponUsable(db, coupon, { subtotalMinor, email, customerId }) {
  if (!coupon || !coupon.isActive) throw new HttpError(404, 'Invalid or expired promo code');

  const now = new Date();
  if (coupon.startsAt && now < coupon.startsAt) throw new HttpError(400, 'This promo code is not active yet');
  if (coupon.expiresAt && now > coupon.expiresAt) throw new HttpError(400, 'This promo code has expired');

  if (coupon.minOrderMinor && subtotalMinor < coupon.minOrderMinor) {
    const minRupees = Math.round(coupon.minOrderMinor / 100);
    throw new HttpError(400, `Minimum order value of ₹${minRupees} required for this code`);
  }
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
    throw new HttpError(400, 'This promo code has reached its maximum usage limit');
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (coupon.requiresNewsletter) {
    const subscriber = normalizedEmail
      ? await db.newsletterSubscriber.findUnique({ where: { email: normalizedEmail } })
      : null;
    if (!subscriber || subscriber.status !== 'subscribed') {
      throw new HttpError(400, 'This code is for ZAEVI newsletter subscribers. Use the email address you subscribed with.');
    }
  }

  // One use per customer unless the coupon allows more. Checks both the account and
  // the email address, so a second account with the same email cannot reuse it.
  const owners = [];
  if (customerId) owners.push({ customerId });
  if (normalizedEmail) owners.push({ order: { contactEmail: normalizedEmail } });
  if (owners.length > 0 && typeof db.couponUsage?.count === 'function') {
    const pastUsage = await db.couponUsage.count({ where: { couponId: coupon.id, OR: owners } });
    if (pastUsage >= (coupon.perCustomerLimit ?? 1)) {
      throw new HttpError(400, 'You have already redeemed this promo code');
    }
  }
}

export function createCouponsRouter({ getDb } = {}) {
  const resolveDb = getDb ?? getDbClient;
  const router = Router();
  const requireAdmin = createRequireAdmin({ getDb: resolveDb });

  // -------------------------------------------------------------------------
  // Public / Customer Validation Endpoint
  // -------------------------------------------------------------------------

  // POST /api/coupons/validate
  router.post('/validate', async (req, res, next) => {
    try {
      const code = String(req.body?.code || '').trim().toUpperCase();
      const subtotalMinor = Number(req.body?.subtotalMinor);

      if (!code) throw new HttpError(400, 'Please enter a promo code');
      if (!Number.isInteger(subtotalMinor) || subtotalMinor <= 0) {
        throw new HttpError(400, 'Valid subtotal is required to apply promo code');
      }

      const db = resolveDb();
      const coupon = await db.coupon.findUnique({ where: { code } });
      const customerId = req.session?.isAuthenticated ? req.session.customerId : null;
      await assertCouponUsable(db, coupon, { subtotalMinor, email: req.body?.email, customerId });

      const discountMinor = calculateCouponDiscount({ coupon, subtotalMinor });
      const newTotalMinor = Math.max(0, subtotalMinor - discountMinor);

      return res.status(200).json({
        data: {
          code: coupon.code,
          description: coupon.description,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          discountMinor,
          newTotalMinor,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  // -------------------------------------------------------------------------
  // Admin Endpoints
  // -------------------------------------------------------------------------

  // GET /api/admin/coupons
  router.get('/admin/coupons', requireAdmin, async (req, res, next) => {
    try {
      const db = resolveDb();
      const coupons = await db.coupon.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return res.status(200).json({ data: coupons });
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/admin/coupons
  router.post('/admin/coupons', requireAdmin, validateCsrf, async (req, res, next) => {
    try {
      const b = req.body || {};
      const code = String(b.code || '').trim().toUpperCase();
      if (!code || code.length < 3) throw new HttpError(400, 'Coupon code must be at least 3 characters');

      const discountType = b.discountType === 'fixed' ? 'fixed' : 'percentage';
      const discountValue = Number(b.discountValue);
      if (!Number.isInteger(discountValue) || discountValue <= 0) {
        throw new HttpError(400, 'Discount value must be a positive integer');
      }

      const db = resolveDb();
      const existing = await db.coupon.findUnique({ where: { code } });
      if (existing) throw new HttpError(409, `Coupon with code "${code}" already exists`);

      const coupon = await db.coupon.create({
        data: {
          code,
          description: b.description ? String(b.description).trim().slice(0, 255) : null,
          discountType,
          discountValue,
          minOrderMinor: b.minOrderMinor ? Number(b.minOrderMinor) : 0,
          maxDiscountMinor: b.maxDiscountMinor ? Number(b.maxDiscountMinor) : null,
          startsAt: b.startsAt ? new Date(b.startsAt) : null,
          expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
          usageLimit: b.usageLimit ? Number(b.usageLimit) : null,
          isActive: b.isActive !== false,
        },
      });

      return res.status(201).json({ data: coupon });
    } catch (error) {
      return next(error);
    }
  });

  // PATCH /api/admin/coupons/:id
  router.patch('/admin/coupons/:id', requireAdmin, validateCsrf, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const data = {};

      if (b.isActive !== undefined) data.isActive = Boolean(b.isActive);
      if (b.description !== undefined) data.description = String(b.description).trim();
      if (b.usageLimit !== undefined) data.usageLimit = b.usageLimit ? Number(b.usageLimit) : null;
      if (b.expiresAt !== undefined) data.expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
      if (b.perCustomerLimit !== undefined) data.perCustomerLimit = b.perCustomerLimit ? Number(b.perCustomerLimit) : null;
      if (b.requiresNewsletter !== undefined) data.requiresNewsletter = Boolean(b.requiresNewsletter);

      const db = resolveDb();
      const coupon = await db.coupon.update({
        where: { id },
        data,
      });

      return res.status(200).json({ data: coupon });
    } catch (error) {
      return next(error);
    }
  });

  // DELETE /api/admin/coupons/:id
  router.delete('/admin/coupons/:id', requireAdmin, validateCsrf, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const db = resolveDb();
      await db.coupon.delete({ where: { id } });
      return res.status(200).json({ data: { ok: true } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createCouponsRouter;

