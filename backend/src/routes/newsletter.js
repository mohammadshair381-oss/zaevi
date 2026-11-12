import { getEmailConfig } from '../services/email.js';
import { Router } from 'express';
import { getDbClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { notifyNewsletterWelcome } from '../services/notification.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The welcome offer as it really stands, read from the coupon itself. Returns null
 * if the coupon is switched off, expired or used up, so the site never promises a
 * code that checkout would reject.
 */
export async function findNewsletterOffer(db) {
  if (typeof db.coupon?.findFirst !== 'function') return null;
  const now = new Date();
  const coupon = await db.coupon.findFirst({
    where: {
      requiresNewsletter: true,
      isActive: true,
      discountType: 'percentage',
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
    orderBy: { id: 'asc' },
  });
  if (!coupon || (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit)) return null;
  const until = coupon.expiresAt
    ? ` until ${coupon.expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}`
    : '';
  return {
    code: coupon.code,
    percent: coupon.discountValue,
    expiresAt: coupon.expiresAt,
    message: `Use ${coupon.code} at checkout for ${coupon.discountValue}% off one order, with this email address${until}.`,
  };
}

/** Told to subscribers only while email is not set up, so nobody waits for a message. */
function newsletterEmailNotice() {
  return getEmailConfig().configured ? null : 'We are not sending emails yet, so nothing will arrive for now.';
}

export function createNewsletterRouter({ getDb, newsletterRateLimit } = {}) {
  const resolveDb = getDb ?? getDbClient;
  const router = Router();
  const limiter = newsletterRateLimit === false
    ? (req, res, next) => next()
    : createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000, message: 'Too many attempts. Please try again later.', ...(newsletterRateLimit || {}) });

  // POST /api/newsletter/subscribe
  router.post('/subscribe', limiter, async (req, res, next) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email || !EMAIL_REGEX.test(email) || email.length > 255) {
        throw new HttpError(400, 'Please enter a valid email address');
      }

      const db = resolveDb();
      const existing = await db.newsletterSubscriber.findUnique({ where: { email } });
      const offer = await findNewsletterOffer(db);

      if (existing) {
        if (existing.status === 'unsubscribed') {
          await db.newsletterSubscriber.update({
            where: { email },
            data: { status: 'subscribed', subscribedAt: new Date(), unsubscribedAt: null },
          });
        }
        return res.status(200).json({ data: { message: 'Thank you for subscribing to ZAEVI.', offer, emailNotice: newsletterEmailNotice() } });
      }

      await db.newsletterSubscriber.create({
        data: { email, status: 'subscribed' },
      });

      await notifyNewsletterWelcome(db, { email, offerMessage: offer?.message });

      return res.status(201).json({ data: { message: 'Thank you for subscribing to ZAEVI.', offer, emailNotice: newsletterEmailNotice() } });
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/newsletter/unsubscribe
  router.post('/unsubscribe', async (req, res, next) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email || !EMAIL_REGEX.test(email)) {
        throw new HttpError(400, 'Please enter a valid email address');
      }

      const db = resolveDb();
      const existing = await db.newsletterSubscriber.findUnique({ where: { email } });
      if (existing && existing.status === 'subscribed') {
        await db.newsletterSubscriber.update({
          where: { email },
          data: { status: 'unsubscribed', unsubscribedAt: new Date() },
        });
      }

      return res.status(200).json({ data: { message: 'You have been unsubscribed.' } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createNewsletterRouter;

