/**
 * CSRF protection for authenticated state-changing endpoints.
 *
 * Strategy: Double-submit cookie pattern.
 * - Server generates a cryptographically random CSRF token on login/session creation
 * - Token is stored in session (server-side) and sent as a cookie (SameSite=Lax)
 * - For state-changing requests, client must send the token in a custom header
 * - Server verifies the header matches the session-stored token
 *
 * Why not Idempotency-Key:
 * - Idempotency-Key is for order deduplication, not CSRF
 * - Idempotency-Key is predictable (client-generated) and meant for replay
 * - CSRF token must be secret and server-generated
 *
 * Protected routes (cookie-authenticated, state-changing):
 * - POST /api/auth/logout
 * - POST /api/orders (when authenticated) — but guest checkout uses Idempotency-Key
 *
 * CSRF-exempt routes:
 * - Guest checkout (POST /api/orders without session) — uses Idempotency-Key
 * - GET requests
 * - Public endpoints (register, login, product APIs)
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.js';

/** Header name for CSRF token submission. */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Cookie name for CSRF token (same-site, not HttpOnly so JS can read it). */
export const CSRF_COOKIE_NAME = 'zaevi.csrf';

/**
 * Generate a new CSRF token.
 * @returns {string} URL-safe base64 token
 */
export function generateCsrfToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Middleware to issue CSRF token cookie on login/session creation.
 * Attaches `req.csrfToken` for convenience.
 */
export function issueCsrfToken(req, res, next) {
  if (!req.session) {
    // No session middleware - skip CSRF token issuance
    return next();
  }

  // If session already has a CSRF token, reuse it
  if (!req.session.data.csrfToken) {
    req.session.data.csrfToken = generateCsrfToken();
    req.session.touch({ csrfToken: req.session.data.csrfToken });
  }

  // Expose token to route handlers
  req.csrfToken = req.session.data.csrfToken;

  // Set CSRF cookie (not HttpOnly so frontend JS can read it for AJAX)
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie(CSRF_COOKIE_NAME, req.csrfToken, {
    httpOnly: false,           // JS needs to read it
    secure: isProduction,      // Secure in production
    sameSite: 'lax',           // Lax for top-level navigation
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });

  next();
}

/**
 * Middleware to validate CSRF token on state-changing requests.
 * Only applies to authenticated sessions (cookie-based auth).
 * Guest requests (no session) are exempt — they use Idempotency-Key.
 */
export function validateCsrf(req, res, next) {
  // Only validate for authenticated sessions with cookie auth
  if (!req.session || !req.session.isAuthenticated) {
    // Guest request — exempt from CSRF (uses Idempotency-Key)
    return next();
  }

  // Only validate state-changing methods
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  const sessionToken = req.session.data?.csrfToken;
  if (!sessionToken) {
    return next(new HttpError(403, 'CSRF token missing from session'));
  }

  // Only accept CSRF token from header (for AJAX/API requests)
  // Cookie fallback is not allowed for API endpoints
  const headerToken = req.headers[CSRF_HEADER_NAME.toLowerCase()];
  if (!headerToken) {
    return next(new HttpError(403, 'CSRF token required in header'));
  }

  // Use timing-safe comparison
  const providedBuf = Buffer.from(headerToken);
  const expectedBuf = Buffer.from(sessionToken);

  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return next(new HttpError(403, 'Invalid CSRF token'));
  }

  next();
}

/**
 * Clear CSRF cookie on logout.
 */
export function clearCsrfCookie(res) {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export default { generateCsrfToken, issueCsrfToken, validateCsrf, clearCsrfCookie };