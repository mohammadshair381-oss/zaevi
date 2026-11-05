/**
 * Creates settings for an emergency admin sign-in. See docs/deployment.md.
 *
 *   npm run admin:recovery -- owner@your-domain.com [hours, default 4, at most 24]
 *
 * Prints a new random code once and writes nothing to disk. Only its hash goes on the
 * server, and the code itself stays with the person who will use it.
 */
import { randomBytes } from 'node:crypto';

import { hashPassword } from '../src/models/auth.js';
import { normalizeEmail } from '../src/models/customer.js';

const [rawEmail, rawHours = '4'] = process.argv.slice(2);
const hours = Number(rawHours);

let email = '';
try {
  email = normalizeEmail(rawEmail);
} catch {
  // Reported below.
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run admin:recovery -- owner@your-domain.com [hours]');
  process.exit(1);
}
if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
  console.error('Hours must be more than 0 and at most 24.');
  process.exit(1);
}

const code = randomBytes(32).toString('base64url');
const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

console.log(`Recovery code, shown only now. Keep it out of chat, tickets and Git:

  ${code}

Add these on Render, then sign in at https://YOUR-DOMAIN/admin/recovery before ${expiresAt}:

ADMIN_RECOVERY_ENABLED=true
ADMIN_RECOVERY_EMAIL=${email}
ADMIN_RECOVERY_EXPIRES_AT=${expiresAt}
ADMIN_RECOVERY_CODE_HASH=${await hashPassword(code)}

Remove all four once email is working again.`);
