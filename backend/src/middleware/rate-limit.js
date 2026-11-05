/**
 * Dependency-free, in-memory, fixed-window rate limiter.
 *
 * Counters live in a per-process `Map` keyed by the client address, so they
 * are local to a single Node process: they reset on restart and are NOT shared
 * across multiple instances or worker processes. This is therefore NOT
 * distributed rate limiting — a multi-instance deployment would need a shared
 * store (e.g. Redis) or an edge/proxy limiter, neither of which is in scope.
 *
 * Client identity comes from `req.ip`, with one exception: a request carrying the
 * correct PROXY_SECRET came through our Vercel proxy, which overwrites
 * `X-Forwarded-For` with the visitor's address, so that address is used. `trust proxy`
 * stays disabled and a forwarded header is otherwise ignored, so a caller reaching this
 * server directly cannot reset its own bucket by sending a header. Without PROXY_SECRET,
 * every visitor behind a proxy shares one limit.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import { HttpError } from './errors.js';

/** Set by the proxy rules in vercel.json. */
export const PROXY_SECRET_HEADER = 'x-zaevi-proxy-secret';

export const DEFAULT_WINDOW_MS = 60_000;
export const DEFAULT_MAX = 30;
export const DEFAULT_MESSAGE = 'Too Many Requests';

/** Coerce a value to a positive integer, falling back when it is not one. */
function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const digest = (value) => createHash('sha256').update(String(value)).digest();

/** The visitor's address, trusting a forwarded one only from our own proxy. */
export function clientAddress(req, secret = process.env.PROXY_SECRET) {
  const presented = req?.headers?.[PROXY_SECRET_HEADER];
  if (secret && typeof presented === 'string' && timingSafeEqual(digest(presented), digest(secret))) {
    // Hosts behind Vercel append to this header, so the visitor is always the first entry.
    const visitor = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (isIP(visitor)) return visitor;
  }
  return req?.ip || req?.socket?.remoteAddress || 'unknown';
}

const defaultKey = (req) => clientAddress(req);

/**
 * Build an Express middleware enforcing a fixed-window request limit per key.
 *
 * @param {object} [options]
 * @param {number} [options.windowMs] window length in milliseconds
 * @param {number} [options.max] max requests allowed per window per key
 * @param {(req:object)=>string} [options.keyGenerator] client key (defaults to clientAddress)
 * @param {()=>number} [options.now] clock, injectable for deterministic tests
 * @param {string} [options.message] 429 message (must stay non-sensitive)
 * @returns {(req:object,res:object,next:Function)=>void}
 */
export function createRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  max = DEFAULT_MAX,
  keyGenerator = defaultKey,
  now = Date.now,
  message = DEFAULT_MESSAGE,
} = {}) {
  const limit = positiveInt(max, DEFAULT_MAX);
  const window = positiveInt(windowMs, DEFAULT_WINDOW_MS);
  const buckets = new Map();
  let lastSweep = 0;

  // Drop expired buckets occasionally so memory stays bounded without a timer
  // (a `setInterval` would keep the process alive). At most one full sweep per
  // window, which keeps live entries to those seen within ~2 windows.
  function sweep(time) {
    if (time - lastSweep < window) return;
    lastSweep = time;
    for (const [key, bucket] of buckets) {
      if (time >= bucket.resetAt) buckets.delete(key);
    }
  }

  function rateLimiter(req, res, next) {
    const time = now();
    sweep(time);

    const key = String(keyGenerator(req));
    let bucket = buckets.get(key);
    if (!bucket || time >= bucket.resetAt) {
      bucket = { count: 0, resetAt: time + window };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, limit - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - time) / 1000));

    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (bucket.count > limit) {
      res.setHeader('Retry-After', String(resetSeconds));
      // Reuse the standardized `{ error: { status, message } }` response via
      // the shared error handler. 429 is < 500, so it is not logged and no
      // stack is disclosed.
      return next(new HttpError(429, message));
    }

    return next();
  }

  // Exposed for tests/inspection only; the Map is the live in-process store.
  rateLimiter.buckets = buckets;
  return rateLimiter;
}

export default createRateLimiter;
