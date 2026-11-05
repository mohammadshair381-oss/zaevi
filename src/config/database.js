/**
 * Decides which database this process may use. This is the only place that decides.
 *
 * - Development and test use `zaevi_test`, even if MONGODB_URI names `zaevi`, so a local
 *   run can never touch production data. Another name in the link is respected.
 * - Production uses `zaevi` only when NODE_ENV=production and ZAEVI_PRODUCTION_DB_APPROVED=true.
 *   A link naming any other database refuses to start, so a live site can never silently
 *   run on test data.
 */
export const DEVELOPMENT_DATABASE = 'zaevi_test';
export const PRODUCTION_DATABASE = 'zaevi';

const URI_PARTS = /^mongodb(?:\+srv)?:\/\/[^/?]*(?:\/([^?]*))?(?:\?.*)?$/i;

export class DatabaseConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

/** The database name in a MongoDB link, or null if it names none or cannot be read. */
export function databaseNameOf(uri) {
  const match = URI_PARTS.exec(String(uri ?? '').trim());
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** The database this environment may use, whether or not a link has been supplied yet. */
export function resolveDatabaseName(env = process.env) {
  const named = databaseNameOf(env.MONGODB_URI);
  if (env.NODE_ENV === 'production') {
    if (env.ZAEVI_PRODUCTION_DB_APPROVED !== 'true') {
      throw new DatabaseConfigError(
        'Production is not approved to use a database yet. Set ZAEVI_PRODUCTION_DB_APPROVED=true when launch is approved.'
      );
    }
    if (named && named !== PRODUCTION_DATABASE) {
      throw new DatabaseConfigError(`In production, MONGODB_URI must name the "${PRODUCTION_DATABASE}" database or none.`);
    }
    return PRODUCTION_DATABASE;
  }
  return named && named !== PRODUCTION_DATABASE ? named : DEVELOPMENT_DATABASE;
}

/** @returns {{ uri: string, dbName: string }} */
export function resolveDatabase(env = process.env) {
  const dbName = resolveDatabaseName(env);
  const uri = String(env.MONGODB_URI ?? '').trim();
  if (!uri) throw new DatabaseConfigError('MONGODB_URI is required.');
  return { uri, dbName };
}
