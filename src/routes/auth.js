/**
 * Authentication routes.
 *
 *   POST /api/auth/register   - register a new customer account
 *   POST /api/auth/login      - login with email and password
 *   POST /api/auth/logout     - logout (invalidate session)
 *   GET  /api/auth/me         - get current customer profile
 *
 * All endpoints use the standard error format.
 * Passwords are hashed with scrypt (see src/models/auth.js).
 * Sessions are server-side, cookie-based (see src/middleware/session.js).
 * CSRF protection on state-changing endpoints (see src/middleware/csrf.js).
 */

import { Router } from 'express';

import { getDbClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { issueCsrfToken, validateCsrf, clearCsrfCookie } from '../middleware/csrf.js';
import { sessionStore } from '../middleware/session.js';
import { hashSessionId } from '../models/auth.js';
import { normalizeEmail } from '../models/customer.js';
import {
  RECOVERY_NOTIFICATION_TYPE,
  adminRecoveryConfig,
  recoveryFingerprint,
} from '../services/admin-recovery.js';
import { recordNotification } from '../services/notification.js';
import {
  OTP_MAX_ATTEMPTS,
  OTP_PURPOSES,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  canLogOtp,
  checkOtp,
  issueOtp,
  newChallenge,
  otpAvailability,
  resendOtp,
  sendOtpEmail,
} from '../services/email-otp.js';

const RESET_REQUEST_MESSAGE = 'If an account exists for that email, we will send a 6-digit code. It can take a few minutes to arrive.';
const RESET_DEVELOPMENT_MESSAGE = 'Email is not set up here. If an account exists for that email, the code is in the server log.';
const RESET_UNAVAILABLE_MESSAGE = 'Password reset by email is not available yet. Please contact us and we will help you.';
const OTP_UNAVAILABLE_MESSAGE = 'Sign-in codes cannot be sent right now because email is not set up. Please contact us.';
const OTP_SEND_FAILED_MESSAGE = 'We could not email your code. Please try again in a few minutes.';
const OTP_EXPIRED_MESSAGE = 'This code has expired or been used too many times. Please start again to get a new one.';
const RESET_CODE_MESSAGE = 'That code is not correct or has expired. Please check it or ask for a new one.';

/** Fields of an account that are safe to return. The password hash is never included. */
const publicProfile = (customer) => ({
  id: customer.id,
  email: customer.email,
  name: customer.name,
  phone: customer.phone,
  createdAt: customer.createdAt,
  role: customer.role,
});

/** Signs this browser in, keeping the CSRF token from before sign-in. */
async function startSession(req, res, customer) {
  if (!req.session) {
    throw new HttpError(500, 'Session middleware not configured');
  }
  const csrfToken = req.session.data?.csrfToken;
  const { sessionId } = await sessionStore.create(customer.id);
  req.session.setCookie(sessionId);
  if (csrfToken) {
    await sessionStore.set(hashSessionId(sessionId), { csrfToken });
  }
  issueCsrfToken(req, res, () => {});
}

const otpResponse = (customer, purpose, challenge) => ({
  otpRequired: true,
  purpose,
  challenge,
  email: customer.email,
  expiresInSeconds: OTP_TTL_MS / 1000,
  resendInSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
  maxAttempts: OTP_MAX_ATTEMPTS,
  viaServerLog: canLogOtp(customer.email),
});
import { hashPassword, verifyPassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../models/auth.js';

/** Rate limiters for auth endpoints (separate from order limiter). */
import { createRateLimiter } from '../middleware/rate-limit.js';

function createAuthRateLimiter(options) {
  if (options === false || options?.max === 0) return (req, res, next) => next();
  const opts = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: 'Too many authentication attempts, please try again later',
    ...(options || {}),
  };
  return createRateLimiter(opts);
}

function createLoginRateLimiter(options) {
  if (options === false || options?.max === 0) return (req, res, next) => next();
  const opts = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: 'Too many login attempts, please try again later',
    ...(options || {}),
  };
  return createRateLimiter(opts);
}

export function createAuthRouter({ getDb, authRateLimit, loginRateLimit, emailOtp = false, otpDeliver = sendOtpEmail } = {}) {
  const resolveDb = getDb ?? getDbClient;
  const router = Router();

  // Create rate limiters per app instance (allows test configuration)
  const authRateLimiter = createAuthRateLimiter(authRateLimit);
  const loginRateLimiter = createLoginRateLimiter(loginRateLimit);
  const otpRateLimiter = createAuthRateLimiter(authRateLimit);

  /** Emails a code, or explains plainly why it cannot. No session exists until it is entered. */
  const beginOtp = async (db, customer, purpose) => {
    if (!otpAvailability().available) throw new HttpError(503, OTP_UNAVAILABLE_MESSAGE);
    try {
      const { challenge } = await issueOtp(db, { customerId: customer.id, email: customer.email, purpose }, { deliver: otpDeliver });
      return otpResponse(customer, purpose, challenge);
    } catch (error) {
      console.error(`[auth] Could not send a ${purpose} code: ${error.code || error.message}`);
      throw new HttpError(503, OTP_SEND_FAILED_MESSAGE);
    }
  };

  /**
   * POST /api/auth/register
   * Register a new customer account.
   * Body: { email, password, name?, phone? }
   */
  router.post('/auth/register', authRateLimiter, async (req, res, next) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        throw new HttpError(400, 'Request body must be a JSON object');
      }

      // Validate email
      let email;
      try {
        email = normalizeEmail(body.email);
      } catch {
        throw new HttpError(400, '"email" is required and must be a string');
      }
      if (!email) {
        throw new HttpError(400, '"email" is required');
      }
      if (email.length > 255) {
        throw new HttpError(400, '"email" must be at most 255 characters');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpError(400, '"email" must be a valid email address');
      }

      // Validate password
      const password = body.password;
      if (typeof password !== 'string') {
        throw new HttpError(400, '"password" is required and must be a string');
      }
      if (password.length < PASSWORD_MIN_LENGTH) {
        throw new HttpError(400, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
      }
      if (password.length > PASSWORD_MAX_LENGTH) {
        throw new HttpError(400, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
      }

      // Optional fields
      const name = body.name && typeof body.name === 'string' && body.name.trim().length > 0
        ? body.name.trim().slice(0, 200)
        : null;
      const phone = body.phone && typeof body.phone === 'string' && body.phone.trim().length > 0
        ? body.phone.trim().slice(0, 32)
        : null;

      if (emailOtp && !otpAvailability().available) {
        throw new HttpError(503, OTP_UNAVAILABLE_MESSAGE);
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      const db = resolveDb();

      // Check if customer already exists (e.g. from guest checkout)
      let customer;
      const existing = await db.customer.findUnique({ where: { email } });
      if (existing) {
        if (!existing.passwordHash && typeof db.customer.updateMany === 'function') {
          // Atomic claim: only update if passwordHash is STILL null (concurrent safe)
          const result = await db.customer.updateMany({
            where: { id: existing.id, passwordHash: null },
            data: {
              passwordHash,
              name: name || existing.name,
              phone: phone || existing.phone,
            },
          });
          if (result.count === 0) {
            throw new HttpError(409, 'An account with this email already exists');
          }
          customer = await db.customer.findUnique({ where: { id: existing.id } });
        } else if (!existing.passwordHash && typeof db.customer.update === 'function') {
          customer = await db.customer.update({
            where: { id: existing.id },
            data: {
              passwordHash,
              name: name || existing.name,
              phone: phone || existing.phone,
            },
          });
        } else if (emailOtp && !existing.emailVerifiedAt) {
          // Nobody has proved they own this address yet, so the newest sign-up replaces the
          // password. Whoever did this still cannot get in without the emailed code.
          customer = await db.customer.update({
            where: { id: existing.id },
            data: { passwordHash, name: name || existing.name, phone: phone || existing.phone },
          });
        } else {
          throw new HttpError(409, 'An account with this email already exists');
        }
      } else {
        try {
          customer = await db.customer.create({
            data: {
              email,
              name,
              phone,
              passwordHash,
            },
          });
        } catch (error) {
          if (error.code === 'DUPLICATE_KEY' && error.meta?.target?.includes('email')) {
            // Generic error — don't reveal if email exists
            throw new HttpError(409, 'An account with this email already exists');
          }
          throw error;
        }
      }

      if (emailOtp) {
        return res.status(201).json({ data: await beginOtp(db, customer, OTP_PURPOSES.SIGNUP) });
      }

      // Return safe profile (no password hash)
      res.status(201).json({ data: publicProfile(customer) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/auth/login
   * Login with email and password.
   * Creates session, regenerates session ID, issues CSRF token.
   * Body: { email, password }
   */
  router.post('/auth/login', loginRateLimiter, async (req, res, next) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        throw new HttpError(400, 'Request body must be a JSON object');
      }

      // Normalize email
      let email;
      try {
        email = normalizeEmail(body.email);
      } catch {
        throw new HttpError(401, 'Invalid email or password');
      }

      const password = body.password;
      if (typeof password !== 'string' || password === '') {
        throw new HttpError(401, 'Invalid email or password');
      }

      const db = resolveDb();

      // Find customer by email
      const customer = await db.customer.findUnique({
        where: { email },
      });

      // Generic error — don't reveal if email exists
      if (!customer || !customer.passwordHash) {
        throw new HttpError(401, 'Invalid email or password');
      }

      // Verify password
      const isValid = await verifyPassword(password, customer.passwordHash);
      if (!isValid) {
        throw new HttpError(401, 'Invalid email or password');
      }

      if (emailOtp) {
        return res.status(200).json({ data: await beginOtp(db, customer, OTP_PURPOSES.LOGIN) });
      }

      await startSession(req, res, customer);
      res.status(200).json({ data: publicProfile(customer) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/auth/admin-recovery
   * Emergency admin sign-in for when email is down. See services/admin-recovery.js.
   * Without valid settings this route does not exist. Each check fails the same way.
   */
  const recoveryInUse = new Set();
  router.post('/auth/admin-recovery', (req, res, next) => {
    next(adminRecoveryConfig().enabled ? undefined : 'route');
  }, loginRateLimiter, async (req, res, next) => {
    const refuse = () => {
      console.warn('[security] A failed emergency admin sign-in attempt was refused');
      return new HttpError(401, 'Those details are not correct');
    };
    let fingerprint = null;
    try {
      const config = adminRecoveryConfig();
      const { email: rawEmail, password, recoveryCode } = req.body ?? {};
      if (typeof password !== 'string' || !(await verifyPassword(String(recoveryCode ?? ''), config.codeHash))) {
        throw refuse();
      }
      let email;
      try {
        email = normalizeEmail(rawEmail);
      } catch {
        throw refuse();
      }
      const db = resolveDb();
      const customer = email === config.email ? await db.customer.findUnique({ where: { email } }) : null;
      if (!customer?.passwordHash || customer.role !== 'admin' || !(await verifyPassword(password, customer.passwordHash))) {
        throw refuse();
      }

      const claim = recoveryFingerprint(config.codeHash);
      if (recoveryInUse.has(claim)) throw refuse();
      recoveryInUse.add(claim);
      fingerprint = claim;

      const used = await db.notification.findFirst({
        where: { type: RECOVERY_NOTIFICATION_TYPE, content: { contains: claim } },
      });
      if (used) throw refuse();

      // The stored record is what makes the code single-use, so no record means no sign-in.
      const record = await recordNotification(db, {
        customerId: customer.id,
        recipientEmail: customer.email,
        type: RECOVERY_NOTIFICATION_TYPE,
        subject: 'ZAEVI emergency admin sign-in was used',
        content: `The emergency admin sign-in was used for your account at ${new Date().toISOString()}. If this was not you, remove the ADMIN_RECOVERY settings on the server and change your password now. Reference: ${claim}`,
      });
      if (!record) throw new HttpError(503, 'Emergency sign-in is unavailable because the database could not record it.');

      await startSession(req, res, customer);
      console.warn(`[security] Emergency admin sign-in used for account ${customer.id}`);
      res.status(200).json({ data: publicProfile(customer) });
    } catch (error) {
      next(error);
    } finally {
      if (fingerprint) recoveryInUse.delete(fingerprint);
    }
  });

  /**
   * POST /api/auth/otp/verify
   * The second step of signing up or signing in. Only now does a session begin.
   */
  router.post('/auth/otp/verify', otpRateLimiter, async (req, res, next) => {
    try {
      const db = resolveDb();
      const result = await checkOtp(db, {
        challenge: req.body?.challenge,
        code: req.body?.code,
        purposes: [OTP_PURPOSES.SIGNUP, OTP_PURPOSES.LOGIN],
      });
      if (result.status === 'wrong') {
        throw new HttpError(400, `That code is not correct. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'try' : 'tries'} left.`);
      }
      if (result.status !== 'ok') throw new HttpError(400, OTP_EXPIRED_MESSAGE);

      let customer = await db.customer.findUnique({ where: { id: result.record.customerId } });
      if (!customer) throw new HttpError(400, OTP_EXPIRED_MESSAGE);
      if (!customer.emailVerifiedAt) {
        customer = await db.customer.update({ where: { id: customer.id }, data: { emailVerifiedAt: new Date() } });
      }
      await startSession(req, res, customer);
      res.status(200).json({ data: publicProfile(customer) });
    } catch (error) {
      next(error);
    }
  });

  /** POST /api/auth/otp/resend */
  router.post('/auth/otp/resend', otpRateLimiter, async (req, res, next) => {
    try {
      if (!otpAvailability().available) throw new HttpError(503, OTP_UNAVAILABLE_MESSAGE);
      const db = resolveDb();
      let result;
      try {
        result = await resendOtp(db, {
          challenge: req.body?.challenge,
          getEmail: async (id) => (await db.customer.findUnique({ where: { id }, select: { email: true } }))?.email,
        }, { deliver: otpDeliver });
      } catch (error) {
        console.error(`[auth] Could not resend a code: ${error.code || error.message}`);
        throw new HttpError(503, OTP_SEND_FAILED_MESSAGE);
      }
      if (result.status === 'wait') throw new HttpError(429, `Please wait ${result.seconds} seconds before asking for another code.`);
      if (result.status === 'limit' || result.status === 'expired') throw new HttpError(400, OTP_EXPIRED_MESSAGE);
      // A reset request for an unknown email looks the same as one for a real account.
      res.json({ data: { message: 'If this request is still active, a new code is on its way.', resendInSeconds: OTP_RESEND_COOLDOWN_MS / 1000 } });
    } catch (error) {
      next(error);
    }
  });

  /** GET /api/auth/password-reset/status: lets the page say so when reset cannot work. */
  router.get('/auth/password-reset/status', (req, res) => {
    res.json({ data: otpAvailability() });
  });

  /**
   * POST /api/auth/forgot-password
   * The answer is sent before any lookup, so neither its wording, its timing nor a failure
   * can reveal who has an account. Unknown addresses get a challenge that matches nothing.
   */
  router.post('/auth/forgot-password', authRateLimiter, (req, res, next) => {
    const { available, viaServerLog } = otpAvailability();
    if (!available) return next(new HttpError(503, RESET_UNAVAILABLE_MESSAGE));
    const challenge = newChallenge();
    res.status(200).json({
      data: {
        message: viaServerLog ? RESET_DEVELOPMENT_MESSAGE : RESET_REQUEST_MESSAGE,
        challenge,
        expiresInSeconds: OTP_TTL_MS / 1000,
        resendInSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
      },
    });
    return (async () => {
      let email = null;
      try {
        email = normalizeEmail(req.body?.email);
      } catch {
        return;
      }
      if (!email) return;
      const db = resolveDb();
      const customer = await db.customer.findUnique({ where: { email }, select: { id: true, email: true, passwordHash: true } });
      if (!customer?.passwordHash) return;
      // Repeated requests must not flood someone's inbox, or replace the code they are about to use.
      const recent = await db.emailOtp.findFirst({
        where: { customerId: customer.id, purpose: OTP_PURPOSES.RESET, consumedAt: null, lastSentAt: { gt: new Date(Date.now() - OTP_RESEND_COOLDOWN_MS) } },
      });
      if (recent) return;
      await issueOtp(db, { customerId: customer.id, email: customer.email, purpose: OTP_PURPOSES.RESET, challenge }, { deliver: otpDeliver });
    })().catch((error) => {
      console.error(`[auth] Password reset request failed: ${error.code || error.message}`);
    });
  });

  /** POST /api/auth/reset-password */
  router.post('/auth/reset-password', authRateLimiter, async (req, res, next) => {
    try {
      const password = req.body?.password;
      if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
        throw new HttpError(400, `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`);
      }
      const db = resolveDb();
      const result = await checkOtp(db, { challenge: req.body?.challenge, code: req.body?.code, purposes: [OTP_PURPOSES.RESET] });
      if (result.status !== 'ok') throw new HttpError(400, RESET_CODE_MESSAGE);

      const { customerId, id } = result.record;
      const passwordHash = await hashPassword(password);
      await db.$transaction(async (tx) => {
        await tx.customer.update({ where: { id: customerId }, data: { passwordHash, emailVerifiedAt: new Date() } });
        await tx.emailOtp.deleteMany({ where: { customerId, id: { not: id } } });
      });
      await sessionStore.destroyAllForCustomer(customerId);
      if (req.session?.customerId === customerId) {
        await req.session.destroy();
        clearCsrfCookie(res);
      }
      res.status(200).json({ data: { message: 'Your password has been changed and every device has been signed out. You can now sign in.' } });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/auth/logout
   * Invalidate session and clear cookies.
   * Requires authentication + CSRF.
   */
  router.post('/auth/logout', requireAuth, validateCsrf, async (req, res, next) => {
    try {
      await req.session.destroy();
      clearCsrfCookie(res);
      res.status(200).json({ data: { message: 'Logged out successfully' } });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/auth/me
   * Get current customer profile from session.
   * Returns null if not authenticated.
   */
  router.get('/auth/me', async (req, res, next) => {
    try {
      if (!req.session || !req.session.isAuthenticated) {
        return res.status(200).json({ data: null });
      }

      const db = resolveDb();
      const customer = await db.customer.findUnique({
        where: { id: req.session.customerId },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          createdAt: true,
          role: true,
          // passwordHash explicitly excluded
        },
      });

      if (!customer) {
        // Session exists but customer deleted — invalidate session
        await req.session.destroy();
        const { clearCsrfCookie } = await import('../middleware/csrf.js');
        clearCsrfCookie(res);
        return res.status(200).json({ data: null });
      }

      res.status(200).json({ data: customer });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createAuthRouter;