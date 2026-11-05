/**
 * Simple in-memory CMS cache for the single-instance deployment model.
 *
 * This is intentionally process-local. It must be invalidated whenever an
 * administrator publishes, reverts, restores, or updates CMS content.
 */

const cache = new Map();

export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached(key, value, ttlMs = 30000) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateCmsCache(key) {
  if (key) {
    cache.delete(key);
    return;
  }
  cache.clear();
}

export default { getCached, setCached, invalidateCmsCache };