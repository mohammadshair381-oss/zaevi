/**
 * Environment configuration with validation.
 *
 * Values are read from an injected source object (defaults to process.env) so
 * that the validation logic can be unit-tested without mutating global state.
 */

const SUPPORTED_ENVS = ['development', 'test', 'production'];

const DEFAULTS = Object.freeze({
  NODE_ENV: 'development',
  PORT: '3000',
  ORDER_RATE_LIMIT_MAX: '30',
  ORDER_RATE_LIMIT_WINDOW_MS: '60000',
  // Authentication
  SESSION_SECRET: '', // Required in production; must be >= 32 chars
  AUTH_RATE_LIMIT_MAX: '10',
  AUTH_RATE_LIMIT_WINDOW_MS: '900000', // 15 minutes
});

class EnvValidationError extends Error {
  constructor(messages) {
    super(`Invalid environment configuration:\n - ${messages.join('\n - ')}`);
    this.name = 'EnvValidationError';
    this.details = messages;
  }
}

function normalize(source) {
  const errors = [];

  const nodeEnv = source.NODE_ENV ?? DEFAULTS.NODE_ENV;
  if (!SUPPORTED_ENVS.includes(nodeEnv)) {
    errors.push(`NODE_ENV must be one of ${SUPPORTED_ENVS.join(', ')} (received "${nodeEnv}")`);
  }

  const rawPort = source.PORT ?? DEFAULTS.PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    errors.push(`PORT must be an integer between 0 and 65535 (received "${rawPort}")`);
  }

  const rawDbUrl = source.MONGODB_URI;
  if (rawDbUrl === undefined || String(rawDbUrl).trim() === '') {
    errors.push('MONGODB_URI is required but was not set');
  } else if (!/^mongodb(\+srv)?:\/\/.+/i.test(String(rawDbUrl).trim())) {
    errors.push('MONGODB_URI must start with "mongodb://" or "mongodb+srv://"');
  }

  // Optional order-creation rate limit (per client IP). Both values must be
  // positive integers; absent values fall back to the defaults above.
  const rawRateMax = source.ORDER_RATE_LIMIT_MAX ?? DEFAULTS.ORDER_RATE_LIMIT_MAX;
  const rateMax = Number(rawRateMax);
  if (!Number.isInteger(rateMax) || rateMax <= 0) {
    errors.push(`ORDER_RATE_LIMIT_MAX must be a positive integer (received "${rawRateMax}")`);
  }

  const rawRateWindow = source.ORDER_RATE_LIMIT_WINDOW_MS ?? DEFAULTS.ORDER_RATE_LIMIT_WINDOW_MS;
  const rateWindow = Number(rawRateWindow);
  if (!Number.isInteger(rateWindow) || rateWindow <= 0) {
    errors.push(`ORDER_RATE_LIMIT_WINDOW_MS must be a positive integer (received "${rawRateWindow}")`);
  }

  // Authentication configuration. Validate against the injected NODE_ENV value
  // so production rules are exercised by config tests, not only when the
  // process happens to be running in production.
  const sessionSecret = source.SESSION_SECRET ?? DEFAULTS.SESSION_SECRET;
  if (nodeEnv === 'production') {
    if (!sessionSecret || sessionSecret.trim() === '') {
      errors.push('SESSION_SECRET is required in production');
    } else if (sessionSecret.length < 32) {
      errors.push('SESSION_SECRET must be at least 32 characters in production');
    }
  }

  const rawAuthRateMax = source.AUTH_RATE_LIMIT_MAX ?? DEFAULTS.AUTH_RATE_LIMIT_MAX;
  const authRateMax = Number(rawAuthRateMax);
  if (!Number.isInteger(authRateMax) || authRateMax <= 0) {
    errors.push(`AUTH_RATE_LIMIT_MAX must be a positive integer (received "${rawAuthRateMax}")`);
  }

  const rawAuthRateWindow = source.AUTH_RATE_LIMIT_WINDOW_MS ?? DEFAULTS.AUTH_RATE_LIMIT_WINDOW_MS;
  const authRateWindow = Number(rawAuthRateWindow);
  if (!Number.isInteger(authRateWindow) || authRateWindow <= 0) {
    errors.push(`AUTH_RATE_LIMIT_WINDOW_MS must be a positive integer (received "${rawAuthRateWindow}")`);
  }

  if (errors.length > 0) {
    throw new EnvValidationError(errors);
  }

  return Object.freeze({
    NODE_ENV: nodeEnv,
    PORT: port,
    MONGODB_URI: String(rawDbUrl).trim(),
    ORDER_RATE_LIMIT_MAX: rateMax,
    ORDER_RATE_LIMIT_WINDOW_MS: rateWindow,
    SESSION_SECRET: sessionSecret,
    AUTH_RATE_LIMIT_MAX: authRateMax,
    AUTH_RATE_LIMIT_WINDOW_MS: authRateWindow,
  });
}

/**
 * Validate and return the resolved configuration.
 * Throws EnvValidationError when required configuration is missing or invalid.
 * @param {NodeJS.ProcessEnv|Record<string,string>} [source]
 */
export function loadEnv(source = process.env) {
  return normalize(source);
}

export { EnvValidationError, SUPPORTED_ENVS };
