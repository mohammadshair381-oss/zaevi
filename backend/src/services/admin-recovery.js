/**
 * Emergency admin sign-in for when email is down and sign-in codes cannot arrive.
 *
 * It replaces only the emailed code. The admin's password and the database role check
 * still apply. It is off unless every setting below is valid, the window is at most 24
 * hours, each code works once, and only a hash of the code is ever stored on the server.
 * Generate settings with `npm run admin:recovery`.
 */
import { createHash } from 'node:crypto';

import { normalizeEmail } from '../models/customer.js';

export const MAX_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RECOVERY_NOTIFICATION_TYPE = 'admin_recovery_used';

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_HASH_FORMAT = /^[^$\s]+\$[^$\s]+\$[^$\s]+\$[^$\s]+$/;
const DISABLED = Object.freeze({ enabled: false, problem: null });

/** Whether recovery is switched on right now, and if a setting is wrong, why it is not. */
export function adminRecoveryConfig(env = process.env, now = Date.now()) {
  if (env.ADMIN_RECOVERY_ENABLED !== 'true') return DISABLED;
  const off = (problem) => ({ enabled: false, problem });

  let email = '';
  try {
    email = normalizeEmail(env.ADMIN_RECOVERY_EMAIL);
  } catch {
    // Reported below.
  }
  if (!EMAIL_FORMAT.test(email)) return off('ADMIN_RECOVERY_EMAIL is not a valid email address');
  const codeHash = String(env.ADMIN_RECOVERY_CODE_HASH ?? '').trim();
  if (!CODE_HASH_FORMAT.test(codeHash)) return off('ADMIN_RECOVERY_CODE_HASH is not a generated hash');

  const expiresAt = Date.parse(String(env.ADMIN_RECOVERY_EXPIRES_AT ?? ''));
  if (Number.isNaN(expiresAt)) return off('ADMIN_RECOVERY_EXPIRES_AT is not a date and time');
  if (expiresAt <= now) return off('ADMIN_RECOVERY_EXPIRES_AT has passed');
  if (expiresAt - now > MAX_RECOVERY_WINDOW_MS) return off('ADMIN_RECOVERY_EXPIRES_AT is more than 24 hours away');

  return { enabled: true, problem: null, email, codeHash, expiresAt: new Date(expiresAt) };
}

/** Identifies a code in the audit record without revealing the code or its hash. */
export function recoveryFingerprint(codeHash) {
  return createHash('sha256').update(codeHash).digest('hex').slice(0, 32);
}
