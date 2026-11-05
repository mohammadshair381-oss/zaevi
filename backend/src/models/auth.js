/**
 * Password hashing and authentication utilities.
 * Uses Node.js built-in crypto (scrypt) — no external dependencies.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/** Scrypt parameters — tuned for security and performance. */
const SCRYPT_N = 16384; // CPU/memory cost
const SCRYPT_R = 8;     // Block size
const SCRYPT_P = 1;     // Parallelization
const SCRYPT_DKLEN = 64; // Derived key length (bytes)
const SALT_BYTES = 16;  // Salt length (bytes)

/** Password validation constants. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Stored hash format: `scrypt$N=16384,r=8,p=1$saltBase64$hashBase64` */
const HASH_PREFIX = 'scrypt';

/**
 * Hash a password using scrypt with a random salt.
 * @param {string} password
 * @returns {Promise<string>} Stored hash string (includes salt and parameters)
 */
export async function hashPassword(password) {
  if (typeof password !== 'string') {
    throw new TypeError('Password must be a string');
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }

  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await scryptAsync(password, salt, SCRYPT_DKLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  const params = `N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}`;
  const saltB64 = salt.toString('base64');
  const hashB64 = derivedKey.toString('base64');
  return `${HASH_PREFIX}$${params}$${saltB64}$${hashB64}`;
}

/**
 * Verify a password against a stored hash.
 * @param {string} password Plaintext password
 * @param {string} storedHash Hash string from hashPassword()
 * @returns {Promise<boolean>} True if password matches
 */
export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') {
    return false;
  }

  try {
    const parts = storedHash.split('$');
    if (parts.length !== 4 || parts[0] !== HASH_PREFIX) {
      return false; // Unknown format
    }

    const [, paramsStr, saltB64, hashB64] = parts;
    const params = parseParams(paramsStr);
    if (!params) return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expectedHash = Buffer.from(hashB64, 'base64');

    const derivedKey = await scryptAsync(password, salt, expectedHash.length, params);
    return timingSafeEqual(derivedKey, expectedHash);
  } catch {
    // Any parsing/verification error = mismatch (don't leak details)
    return false;
  }
}

function parseParams(paramsStr) {
  try {
    const params = {};
    for (const part of paramsStr.split(',')) {
      const [key, value] = part.split('=');
      if (key === 'N') params.N = parseInt(value, 10);
      else if (key === 'r') params.r = parseInt(value, 10);
      else if (key === 'p') params.p = parseInt(value, 10);
    }
    if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
      return null;
    }
    return params;
  } catch {
    return null;
  }
}

/**
 * Generate a cryptographically random session ID.
 * @returns {string} URL-safe base64 session ID (32 bytes = 43 chars)
 */
export function generateSessionId() {
  return randomBytes(32).toString('base64url');
}

import { createHash } from 'node:crypto';

/**
 * Hash a session ID for server-side storage (prevents exposure if store is compromised).
 * @param {string} sessionId
 * @returns {string} SHA-256 hash (hex)
 */
export function hashSessionId(sessionId) {
  return createHash('sha256').update(sessionId).digest('hex');
}

export default {
  hashPassword,
  verifyPassword,
  generateSessionId,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
};