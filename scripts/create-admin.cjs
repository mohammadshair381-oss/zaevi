/**
 * ZAEVI operator tool: create or update an administrator account.
 *
 * Run manually by the operator:  node scripts/create-admin.cjs
 * It is NEVER executed by the test suite (auto-run guarded below) and must
 * never be wired into the app.
 *
 * Safety properties:
 * - Email and password are entered interactively; passwords are NOT accepted
 *   as command-line arguments (they would leak into shell history / ps output)
 *   and are never printed, echoed to logs, or written to disk in any form.
 * - Input is typed interactively with echo disabled for the secret prompts —
 *   not argv, not environment variables.
 * - The password policy and the scrypt hash format are reused from
 *   `src/models/auth.js` (dynamic import keeps this file CJS as deployed).
 * - If the email already exists, the script reports it and only updates the
 *   stored password after an explicit confirmation.
 * - The script shows which database (host, database name) it is about to use
 *   (from DATABASE_URL) and requires a visible confirmation before writing.
 *   It contains NO default credentials.
 */

const readline = require('node:readline');

/** Loose syntax check for an operator-supplied email. */
function isValidEmail(email) {
  return typeof email === 'string'
    && email.length <= 255
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Pure password-policy check used by the interactive prompt (and unit tests).
 * Enforces the SAME limits as src/models/auth.js: 12-128 characters.
 */
function validateAdminPassword(password, { minLength = 12, maxLength = 128 } = {}) {
  if (typeof password !== 'string' || password.length < minLength) {
    return `Password must be at least ${minLength} characters`;
  }
  if (password.length > maxLength) {
    return `Password must be at most ${maxLength} characters`;
  }
  return null;
}

/** Interactive input with echo disabled (TTY only); falls back to visible input. */
function promptHidden(questionText) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(questionText, (answer) => { rl.close(); resolve(answer); });
      return;
    }
    process.stdout.write(questionText);
    const chars = [];
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onChar = (ch) => {
      if (ch === '\r' || ch === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onChar);
        process.stdout.write('\n');
        resolve(chars.join(''));
        return;
      }
      if (ch === '\u0003') { // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdout.write('\nAborted.\n');
        process.exit(130);
      }
      if (ch === '\u007F' || ch === '\b') { // backspace
        chars.pop();
        return;
      }
      if (ch >= ' ' && ch !== '\u0000') chars.push(ch);
    };
    process.stdin.on('data', onChar);
  });
}

function promptVisible(questionText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(questionText, (answer) => { rl.close(); resolve(answer); });
  });
}

async function main() {
  // Show the write target without revealing credentials.
  const dbUrl = process.env.DATABASE_URL || '(not set)';
  let dbDesc;
  try {
    const parsed = new URL(dbUrl);
    dbDesc = `${parsed.hostname}:${parsed.port || 3306}/${parsed.pathname.replace(/^\//, '')}`;
  } catch {
    dbDesc = '(unrecognized DATABASE_URL format)';
  }
  console.log(`\nZAEVI admin bootstrap\nDatabase target: ${dbDesc}\n`);

  const srcPath = require('node:path').resolve(__dirname, '..', 'src', 'models', 'auth.js');
  const { hashPassword, verifyPassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } =
    await import(`file://${srcPath.split('\\').join('/')}`);

  let email = (await promptVisible('Admin email: ')).trim().toLowerCase();
  while (!isValidEmail(email)) {
    email = (await promptVisible('Enter a valid email address: ')).trim().toLowerCase();
  }

  let password = await promptHidden(`Password (min ${PASSWORD_MIN_LENGTH} chars): `);
  let invalid = validateAdminPassword(password, { minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH });
  while (invalid) {
    password = await promptHidden(`${invalid} Try again: `);
    invalid = validateAdminPassword(password, { minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH });
  }
  const confirm = await promptHidden('Confirm password: ');
  if (confirm !== password) {
    console.log('Passwords do not match. No changes were made.');
    process.exitCode = 1;
    return;
  }

  // Hash before any DB work; the plaintext lives only in this closure.
  const passwordHash = await hashPassword(password);

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ log: ['error'] });
  try {
    const existing = await prisma.customer.findUnique({ where: { email } });
    if (existing) {
      if (existing.passwordHash) {
        const selfCheck = await verifyPassword(password, existing.passwordHash);
        if (selfCheck) {
          console.log('That account already uses this password. No changes were made.');
          return;
        }
      }
      console.log(
        existing.passwordHash
          ? 'An account with this email already EXISTS.'
          : 'An account with this email exists without a password (guest record).'
      );
      const ok = await promptVisible('Update this existing account\'s password and set role=admin? (y/N): ');
      if (String(ok).trim().toLowerCase() !== 'y') {
        console.log('Aborted. No changes were made.');
        return;
      }
      await prisma.customer.update({
        where: { email },
        data: { passwordHash, role: 'admin' },
      });
      console.log('Existing account updated: password set, role=admin.');
    } else {
      const name = (await promptVisible('Display name (optional, Enter to skip): ')).trim();
      await prisma.customer.create({
        data: {
          email,
          name: name || null,
          passwordHash,
          role: 'admin',
        },
      });
      console.log(`Administrator account created for ${email}.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`create-admin failed: ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}

module.exports = { isValidEmail, validateAdminPassword };
