import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import healthRouter from './routes/health.js';
import { createProductsRouter } from './routes/products.js';
import { createOrdersRouter } from './routes/orders.js';
import { createPaymentsRouter } from './routes/payments.js';
import { createAuthRouter } from './routes/auth.js';
import { createCustomerRouter } from './routes/customer.js';
import { createAddressRouter } from './routes/addresses.js';
import { createAdminRouter } from './routes/admin.js';
import { createCmsRouter, createCmsPublicRouter } from './routes/cms.js';
import { createNewsletterRouter } from './routes/newsletter.js';
import { createReviewsRouter } from './routes/reviews.js';
import { createCouponsRouter } from './routes/coupons.js';
import { createContactRouter } from './routes/contact.js';
import { createSiteStudioPublicRouter } from './routes/site-studio.js';
import { getPrismaClient } from './db/connect.js';
import { publicStaticPaths, securityHeaders } from './middleware/security.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';
import { sessionMiddleware } from './middleware/session.js';
import { issueCsrfToken } from './middleware/csrf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Project root that holds the existing static storefront. Backend source lives
 * in `src/`, but the storefront files are served in place (not moved).
 */
export const projectRoot = path.resolve(__dirname, '..');

/**
 * Build the Express application.
 */
export function createApp({ 
  root = projectRoot, 
  logger = console, 
  prisma, 
  orderRateLimit, 
  sessionSecret,
  authRateLimit,
  loginRateLimit,
  requireAuthForOrders = false,
  emailOtp = false,
  otpDeliver,
} = {}) {
  const app = express();
  const resolvePrisma = () => prisma ?? getPrismaClient();

  app.disable('x-powered-by');

  // Baseline security headers for every response (API, static, 404, errors).
  app.use(securityHeaders());

  app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
  app.use(express.json({ limit: '1mb' }));

  // Session middleware (required for authentication)
  const sessionSecretValue = sessionSecret ?? process.env.SESSION_SECRET;
  if (sessionSecretValue) {
    app.use(sessionMiddleware({ sessionSecret: sessionSecretValue }));
  }

  // Routes that are safe to cache set their own value after this.
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // API routes are registered before the static-file handler.
  app.use('/api', healthRouter);
  app.use('/api', createProductsRouter({ getPrisma: resolvePrisma }));
  app.use('/api', createPaymentsRouter({ getPrisma: resolvePrisma }));
  app.use('/api', createOrdersRouter({
    getPrisma: resolvePrisma,
    orderRateLimit,
    requireAuthForOrders,
  }));

  // CSRF token issuance for authenticated endpoints (before auth routes so tokens are available for login)
  app.use('/api', issueCsrfToken);

  app.use('/api', createAuthRouter({ 
    getPrisma: resolvePrisma,
    authRateLimit,
    loginRateLimit,
    emailOtp,
    otpDeliver,
  }));
  // Customer routes mounted at /api/customer to avoid middleware conflicts
  app.use('/api/customer', createCustomerRouter({ getPrisma: resolvePrisma }));
  app.use('/api/customer', createAddressRouter({ getPrisma: resolvePrisma }));
  app.use('/api', issueCsrfToken);

  // Marketing, Reviews & Coupons
  app.use('/api/newsletter', createNewsletterRouter({ getPrisma: resolvePrisma }));
  app.use('/api', createContactRouter({ getPrisma: resolvePrisma }));
  app.use('/api', createSiteStudioPublicRouter({ getPrisma: resolvePrisma }));
  app.use('/api/coupons', createCouponsRouter({ getPrisma: resolvePrisma }));
  app.use('/api', createReviewsRouter({ getPrisma: resolvePrisma }));

  // Admin console: protected page (/admin) + read-only APIs (/api/admin/*),
  // all behind the per-request role gate. Mounted BEFORE the static handler;
  // direct static access to admin.html is blocked in middleware/security.js.
  app.use(createAdminRouter({ getPrisma: resolvePrisma, root }));
  app.use('/api', createCouponsRouter({ getPrisma: resolvePrisma }));

  // CMS backend foundation (admin-only).
  app.use('/api/admin/cms', createCmsRouter({ getPrisma: resolvePrisma }));

  // Public CMS read-only endpoints. These expose published content only.
  app.use('/api/cms', createCmsPublicRouter({ getPrisma: resolvePrisma }));

  // Unmatched API paths are JSON 404s and must never fall through to the
  // static handler (including crafted `/api/../...` paths).
  app.use('/api', notFoundHandler());

  // Serve only the explicit storefront allowlist.
  app.use(publicStaticPaths());

  // Serve the existing storefront in place.
  app.use(
    express.static(root, {
      index: 'index.html',
      dotfiles: 'deny',
      redirect: true,
    })
  );

  app.use(notFoundHandler());
  app.use(errorHandler({ logger }));

  return app;
}

export default createApp;
