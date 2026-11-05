/**
 * Custom session middleware — dependency-free, in-memory store.
 *
 * Limitations (documented):
 * - Sessions are process-local: they reset on server restart and are NOT shared
 *   across multiple instances/workers. This is NOT distributed session management.
 * - For multi-instance deployments, a shared session store (e.g., Redis) would be
 *   required — out of scope for this implementation.
 * - The session secret MUST be set via SESSION_SECRET env var in production.
 */

import { randomBytes } from 'node:crypto';
import { hashSessionId } from '../models/auth.js';

/** Default session lifetime: 24 hours. */
export const DEFAULT_SESSION_MAX_AGE = 24 * 60 * 60 * 1000;

/** Cookie name for the session ID. */
export const SESSION_COOKIE_NAME = 'zaevi.sid';

/** In-memory session store: sessionIdHash -> { customerId, createdAt, expiresAt, data } */
const sessions = new Map();
let lastSweep = 0;

/** Session store interface. */
export const sessionStore = {
  /**
   * Create a new session for a customer.
   * @param {number} customerId
   * @param {number} [maxAgeMs] Session lifetime
   * @returns {Promise<{ sessionId: string, sessionIdHash: string, expiresAt: number }>}
   */
  async create(customerId, maxAgeMs = DEFAULT_SESSION_MAX_AGE) {
    const sessionId = randomBytes(32).toString('base64url');
    const sessionIdHash = hashSessionId(sessionId);
    const now = Date.now();
    const expiresAt = now + maxAgeMs;

    sessions.set(sessionIdHash, {
      customerId,
      createdAt: now,
      expiresAt,
      data: {},
    });

    return { sessionId, sessionIdHash, expiresAt };
  },

  /**
   * Get session by session ID hash.
   * @param {string} sessionIdHash
   * @returns {Promise<{ customerId: number, data: object } | null>}
   */
  async get(sessionIdHash) {
    const now = Date.now();
    const session = sessions.get(sessionIdHash);
    if (!session || session.expiresAt <= now) {
      if (session) sessions.delete(sessionIdHash);
      return null;
    }
    return { customerId: session.customerId, data: session.data };
  },

  /**
   * Update session data.
   * @param {string} sessionIdHash
   * @param {object} data
   * @returns {Promise<boolean>} True if updated
   */
  async set(sessionIdHash, data) {
    const session = sessions.get(sessionIdHash);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) sessions.delete(sessionIdHash);
      return false;
    }
    session.data = { ...session.data, ...data };
    return true;
  },

  /**
   * Destroy a session (logout).
   * @param {string} sessionIdHash
   * @returns {Promise<boolean>} True if destroyed
   */
  async destroy(sessionIdHash) {
    return sessions.delete(sessionIdHash);
  },

  /**
   * End every session a customer has, for example after a password change.
   * @param {number} customerId
   * @param {{ exceptHash?: string }} [options] A session to keep
   * @returns {Promise<number>} How many sessions ended
   */
  async destroyAllForCustomer(customerId, { exceptHash } = {}) {
    let ended = 0;
    for (const [hash, session] of sessions) {
      if (session.customerId === customerId && hash !== exceptHash) {
        sessions.delete(hash);
        ended += 1;
      }
    }
    return ended;
  },

  /**
   * Regenerate session ID (prevent fixation) while preserving customerId.
   * @param {string} oldSessionIdHash
   * @returns {Promise<{ sessionId: string, sessionIdHash: string, expiresAt: number } | null>}
   */
  async regenerate(oldSessionIdHash) {
    const session = sessions.get(oldSessionIdHash);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) sessions.delete(oldSessionIdHash);
      return null;
    }
    const { customerId, data } = session;
    // Delete old, create new
    sessions.delete(oldSessionIdHash);
    const newSession = await this.create(customerId, session.expiresAt - Date.now());
    // Preserve any additional session data
    const newSessionData = sessions.get(newSession.sessionIdHash);
    if (newSessionData) {
      newSessionData.data = data;
    }
    return newSession;
  },

  /**
   * Sweep expired sessions. Called periodically.
   */
  sweep() {
    const now = Date.now();
    for (const [hash, session] of sessions) {
      if (session.expiresAt <= now) {
        sessions.delete(hash);
      }
    }
  },

  /** Get store size (for testing/monitoring). */
  size() {
    return sessions.size;
  },
};

/**
 * Parse cookie header to extract session ID.
 * @param {string} cookieHeader
 * @returns {string | null}
 */
function parseSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split('=');
    if (name === SESSION_COOKIE_NAME) {
      return valueParts.join('=');
    }
  }
  return null;
}

/**
 * Build session cookie options based on environment.
 * @param {boolean} isProduction
 * @param {number} maxAgeMs
 * @returns {object}
 */
function cookieOptions(isProduction, maxAgeMs) {
  return {
    httpOnly: true,
    secure: isProduction,      // Secure in production (HTTPS)
    sameSite: 'lax',           // Lax: sent on top-level navigations
    maxAge: maxAgeMs,
    path: '/',
    // domain: not set (current host only)
  };
}

/**
 * Express middleware for session management.
 * Attaches `req.session` with { customerId, data, touch(), destroy(), regenerate() }.
 * @param {object} options
 * @param {string} options.sessionSecret Required in production
 * @param {number} [options.maxAge] Session lifetime in ms
 */
export function sessionMiddleware({ sessionSecret, maxAge = DEFAULT_SESSION_MAX_AGE } = {}) {
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET is required');
  }
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be a string of at least 32 characters');
  }

  const isProduction = process.env.NODE_ENV === 'production';

  // Periodic sweep of expired sessions (lazy, on each request)
  function maybeSweep() {
    if (now - lastSweep > maxAge) {
      lastSweep = now;
      sessionStore.sweep();
    }
  }

  let now = Date.now();

  return function sessionMiddleware(req, res, next) {
    now = Date.now();
    maybeSweep();

    const cookieHeader = req.headers.cookie;
    const sessionId = parseSessionCookie(cookieHeader);

    let sessionIdHash = null;
    let sessionData = null;
    let sessionCustomerId = null;
    let isNew = false;

    const loadSession = async () => {
      if (sessionId) {
        sessionIdHash = hashSessionId(sessionId);
        const session = await sessionStore.get(sessionIdHash);
        if (session) {
          sessionCustomerId = session.customerId;
          sessionData = session.data;
        }
      }

      if (!sessionCustomerId) {
        // No valid session - create empty session context
        isNew = true;
        sessionData = {};
      }
    };

    // Attach session object to request
    req.session = {
      get customerId() {
        return sessionCustomerId;
      },
      get data() {
        return sessionData;
      },
      get isNew() {
        return isNew;
      },
      get isAuthenticated() {
        return sessionCustomerId !== null;
      },

      /**
       * Mark session as modified (will persist on response).
       * @param {object} data
       */
      touch(data) {
        if (sessionIdHash && sessionData) {
          Object.assign(sessionData, data);
          sessionStore.set(sessionIdHash, sessionData);
        }
      },

      /**
       * Destroy the session and clear the cookie.
       */
      async destroy() {
        if (sessionIdHash) {
          await sessionStore.destroy(sessionIdHash);
          sessionIdHash = null;
        }
        sessionCustomerId = null;
        sessionData = null;
        isNew = true;
        clearCookie(res);
      },

      /**
       * Regenerate session ID (e.g., after login to prevent fixation).
       * @returns {Promise<string>} New session ID (for setting cookie)
       */
      async regenerate() {
        if (!sessionCustomerId) return null;
        const oldHash = sessionIdHash;
        const newSession = await sessionStore.regenerate(oldHash);
        if (newSession) {
          sessionIdHash = newSession.sessionIdHash;
          isNew = true;
          return newSession.sessionId;
        }
        return null;
      },

      /**
       * Set the session cookie on the response.
       * @param {string} sessionId
       */
      setCookie(sessionId) {
        if (!sessionId) return;
        const opts = cookieOptions(isProduction, maxAge);
        res.cookie(SESSION_COOKIE_NAME, sessionId, opts);
      },

      /**
       * Clear the session cookie.
       */
      clearCookie() {
        clearCookie(res);
      },
    };

    // Async load, then next
    loadSession().then(() => next()).catch(next);
  };
}

/** Clear session cookie with matching attributes. */
function clearCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export default sessionMiddleware;