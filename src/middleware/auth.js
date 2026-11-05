/**
 * Authentication middleware for protecting routes.
 * Uses server-side session (req.session) set by sessionMiddleware.
 */

import { HttpError } from './errors.js';
import { getPrismaClient } from '../db/connect.js';
import { validateCsrf } from './csrf.js';

/**
 * Require an authenticated customer session.
 * If no valid session, returns 401 with standard error format.
 * Attaches `req.customerId` for convenience.
 */
export function requireAuth(req, res, next) {
  if (!req.session || !req.session.isAuthenticated) {
    return next(new HttpError(401, 'Authentication required'));
  }
  req.customerId = req.session.customerId;
  next();
}

/**
 * Optional authentication — attaches customerId if session exists,
 * but does not reject unauthenticated requests.
 */
export function optionalAuth(req, res, next) {
  if (req.session && req.session.isAuthenticated) {
    req.customerId = req.session.customerId;
  }
  next();
}

/**
 * Get current customer profile (safe fields only).
 * Requires authentication.
 */
export async function getCurrentCustomer(req, res, next) {
  try {
    if (!req.session || !req.session.isAuthenticated) {
      return res.status(200).json({ data: null });
    }
    // Customer data would be fetched from DB here
    // For now, we'll let the route handler fetch
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Verify CSRF token — forwards to the real implementation in csrf.js so any
 * caller importing from here gets actual protection, not a no-op.
 */
export function verifyCsrf(req, res, next) {
  return validateCsrf(req, res, next);
}

/**
 * Admin authorization gate.
 *
 * Resolves the customer's role FRESH from the database on every protected
 * request (from the verified session customerId — never from client input and
 * never cached in the session), so a role change takes effect on the next
 * request. Anonymous and authenticated ordinary customers are BOTH rejected
 * with 404 so the existence of the admin surface is not disclosed.
 *
 * Built as a factory (matching the project's router factories) so tests can
 * inject an in-memory prisma client via `createRequireAdmin({ getPrisma })`;
 * the default `requireAdmin` export resolves the real client lazily.
 */
export function createRequireAdmin({ getPrisma } = {}) {
  const resolvePrisma = getPrisma ?? getPrismaClient;
  return async function requireAdmin(req, res, next) {
    try {
      const customerId = req.session && req.session.isAuthenticated
        ? req.session.customerId
        : null;
      if (!customerId) {
        return next(new HttpError(404, 'Not Found'));
      }
      const prisma = resolvePrisma();
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { role: true },
      });
      if (!customer || customer.role !== 'admin') {
        return next(new HttpError(404, 'Not Found'));
      }
      req.customerId = customerId;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Default admin gate resolving the real Prisma client. */
export const requireAdmin = createRequireAdmin();

export default { requireAuth, optionalAuth, getCurrentCustomer, requireAdmin, createRequireAdmin, verifyCsrf };