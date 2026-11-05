import { Router } from 'express';
import { getPrismaClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { requireAuth, createRequireAdmin } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';

export function createReviewsRouter({ getPrisma } = {}) {
  const resolvePrisma = getPrisma ?? getPrismaClient;
  const router = Router();
  const requireAdmin = createRequireAdmin({ getPrisma: resolvePrisma });

  // -------------------------------------------------------------------------
  // Public & Customer Endpoints
  // -------------------------------------------------------------------------

  // GET /api/products/:id/reviews
  router.get('/products/:id/reviews', async (req, res, next) => {
    try {
      const productId = String(req.params.id || '').trim();
      const prisma = resolvePrisma();

      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product) throw new HttpError(404, 'Product not found');

      const reviews = await prisma.review.findMany({
        where: { productId, status: 'approved' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          authorName: true,
          rating: true,
          title: true,
          content: true,
          verifiedPurchase: true,
          helpfulCount: true,
          createdAt: true,
        },
      });

      const total = reviews.length;
      const averageRating = total > 0 ? Number((reviews.reduce((acc, r) => acc + r.rating, 0) / total).toFixed(1)) : 0;

      return res.status(200).json({
        data: {
          reviews,
          stats: {
            total,
            averageRating,
          },
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/products/:id/reviews (Customer only)
  router.post('/products/:id/reviews', requireAuth, validateCsrf, async (req, res, next) => {
    try {
      const productId = String(req.params.id || '').trim();
      const prisma = resolvePrisma();

      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product) throw new HttpError(404, 'Product not found');

      const { rating, title, content } = req.body || {};
      const numRating = Number(rating);

      if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
        throw new HttpError(400, 'Rating must be an integer between 1 and 5');
      }

      const cleanContent = String(content || '').trim();
      if (!cleanContent || cleanContent.length < 5) {
        throw new HttpError(400, 'Review comment must be at least 5 characters');
      }

      const cleanTitle = title ? String(title).trim().slice(0, 200) : null;

      const customer = await prisma.customer.findUnique({
        where: { id: req.customerId },
        select: { name: true, email: true },
      });

      const authorName = customer?.name || customer?.email?.split('@')[0] || 'Verified Patron';

      // Check if customer previously bought this product on a delivered/shipped order
      const purchaseCount = await prisma.orderItem.count({
        where: {
          productId,
          order: {
            customerId: req.customerId,
            status: { in: ['delivered', 'shipped', 'packed', 'quality_check', 'in_production', 'confirmed', 'pending'] },
          },
        },
      });

      const review = await prisma.review.create({
        data: {
          productId,
          customerId: req.customerId,
          authorName,
          rating: numRating,
          title: cleanTitle,
          content: cleanContent,
          verifiedPurchase: purchaseCount > 0,
          status: 'approved', // Auto-approved or pending based on policy; approved for immediate responsiveness
        },
      });

      return res.status(201).json({
        data: {
          message: 'Thank you for your review.',
          review: {
            id: review.id,
            rating: review.rating,
            title: review.title,
            content: review.content,
            verifiedPurchase: review.verifiedPurchase,
            createdAt: review.createdAt,
          },
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/reviews/:id/helpful
  router.post('/reviews/:id/helpful', async (req, res, next) => {
    try {
      const reviewId = Number(req.params.id);
      if (!Number.isInteger(reviewId) || reviewId < 1) {
        throw new HttpError(400, 'Invalid review ID');
      }

      const prisma = resolvePrisma();
      const updated = await prisma.review.update({
        where: { id: reviewId },
        data: { helpfulCount: { increment: 1 } },
        select: { id: true, helpfulCount: true },
      });

      return res.status(200).json({ data: updated });
    } catch (error) {
      return next(error);
    }
  });

  // -------------------------------------------------------------------------
  // Admin Endpoints
  // -------------------------------------------------------------------------

  // GET /api/admin/reviews
  router.get('/admin/reviews', requireAdmin, async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const status = req.query.status ? String(req.query.status).trim() : undefined;
      const where = status ? { status } : {};

      const reviews = await prisma.review.findMany({
        where,
        include: {
          product: { select: { id: true, name: true } },
          customer: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      return res.status(200).json({ data: reviews });
    } catch (error) {
      return next(error);
    }
  });

  // PATCH /api/admin/reviews/:id
  router.patch('/admin/reviews/:id', requireAdmin, validateCsrf, async (req, res, next) => {
    try {
      const reviewId = Number(req.params.id);
      const status = String(req.body?.status || '').trim().toLowerCase();

      if (!['approved', 'rejected', 'pending'].includes(status)) {
        throw new HttpError(400, 'Invalid status. Must be approved, rejected, or pending.');
      }

      const prisma = resolvePrisma();
      const review = await prisma.review.update({
        where: { id: reviewId },
        data: { status },
      });

      return res.status(200).json({ data: review });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createReviewsRouter;

