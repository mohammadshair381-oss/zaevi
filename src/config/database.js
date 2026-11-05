/**
 * Decides which database this process may use. This is the only place that decides.
 *
 * - Development and test use `zaevi_test`, even if DATABASE_URL names `zaevi`, so a
 *   local run can never touch production data.
 * - Production uses `zaevi` only when NODE_ENV=production, ZAEVI_PRODUCTION_DB_APPROVED=true
 *   and DATABASE_URL names `zaevi`. Anything less refuses to start, so a live site
 *   can never silently run on test data.
 */
export const DEVELOPMENT_DATABASE = 'zaevi_test';
export const PRODUCTION_DATABASE = 'zaevi';

const DEFAULT_DEVELOPMENT_URL = `mysql://root@127.0.0.1:3306/${DEVELOPMENT_DATABASE}`;
const URL_PARTS = /^(mysql:\/\/[^/]*\/)([^/?]*)(\?.*)?$/i;

export class DatabaseConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

/** The database name in a mysql:// URL, or null if it cannot be read. */
export function databaseNameOf(url) {
  const match = URL_PARTS.exec(String(url ?? '').trim());
  return match ? match[2] : null;
}

function withDatabaseName(url, name) {
  return String(url).trim().replace(URL_PARTS, (_, prefix, _name, query = '') => `${prefix}${name}${query}`);
}

export function resolveDatabaseUrl(env = process.env) {
  if (env.NODE_ENV === 'production') {
    if (env.ZAEVI_PRODUCTION_DB_APPROVED !== 'true') {
      throw new DatabaseConfigError(
        'Production is not approved to use a database yet. Set ZAEVI_PRODUCTION_DB_APPROVED=true when launch is approved.'
      );
    }
    const url = String(env.DATABASE_URL ?? '').trim();
    if (databaseNameOf(url) !== PRODUCTION_DATABASE) {
      throw new DatabaseConfigError(`In production, DATABASE_URL must name the "${PRODUCTION_DATABASE}" database.`);
    }
    return url;
  }

  const url = String(env.TEST_DATABASE_URL || env.DATABASE_URL || DEFAULT_DEVELOPMENT_URL).trim();
  return databaseNameOf(url) === PRODUCTION_DATABASE ? withDatabaseName(url, DEVELOPMENT_DATABASE) : url;
}

/**
 * Applies the same rule to Prisma CLI commands, so `npx prisma migrate deploy` cannot
 * reach production from a development shell. An unapproved production shell gets no
 * URL at all: commands that need a database fail, while `prisma generate` still works.
 */
export function applyDatabaseUrlToEnv(env = process.env) {
  try {
    env.DATABASE_URL = resolveDatabaseUrl(env);
  } catch (error) {
    if (!(error instanceof DatabaseConfigError)) throw error;
    delete env.DATABASE_URL;
  }
}
