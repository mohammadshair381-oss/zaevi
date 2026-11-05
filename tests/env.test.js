import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEnv, EnvValidationError } from '../src/config/env.js';

test('loadEnv applies defaults when DATABASE_URL is present', () => {
  const config = loadEnv({ DATABASE_URL: 'mysql://root:password@localhost:3306/zaevi' });
  assert.equal(config.NODE_ENV, 'development');
  assert.equal(config.PORT, 3000);
  assert.equal(config.DATABASE_URL, 'mysql://root:password@localhost:3306/zaevi');
});

test('loadEnv fails when DATABASE_URL is missing', () => {
  assert.throws(() => loadEnv({}), (error) => {
    assert.ok(error instanceof EnvValidationError);
    assert.match(error.message, /DATABASE_URL is required/);
    return true;
  });
});

test('loadEnv rejects an invalid connection string scheme', () => {
  assert.throws(
    () => loadEnv({ DATABASE_URL: 'http://localhost:3306/zaevi' }),
    /must start with "mysql:\/\/"/
  );
});

test('loadEnv rejects mongodb connection strings', () => {
  assert.throws(
    () => loadEnv({ DATABASE_URL: 'mongodb://localhost:27017/zaevi' }),
    /must start with "mysql:\/\/"/
  );
  assert.throws(
    () => loadEnv({ DATABASE_URL: 'mongodb+srv://cluster.example.net/zaevi' }),
    /must start with "mysql:\/\/"/
  );
});

test('loadEnv rejects an invalid PORT', () => {
  assert.throws(
    () => loadEnv({ DATABASE_URL: 'mysql://root:password@localhost:3306/zaevi', PORT: 'not-a-port' }),
    /PORT must be an integer/
  );
});

test('loadEnv rejects an unsupported NODE_ENV', () => {
  assert.throws(
    () => loadEnv({ DATABASE_URL: 'mysql://root:password@localhost:3306/zaevi', NODE_ENV: 'staging' }),
    /NODE_ENV must be one of/
  );
});

test('loadEnv accepts mysql connection with custom port', () => {
  const config = loadEnv({
    DATABASE_URL: 'mysql://user:pass@localhost:3306/zaevi',
    PORT: '8080',
    NODE_ENV: 'test',
  });
  assert.equal(config.PORT, 8080);
  assert.equal(config.NODE_ENV, 'test');
  assert.equal(config.DATABASE_URL, 'mysql://user:pass@localhost:3306/zaevi');
});

test('loadEnv requires a strong SESSION_SECRET when NODE_ENV is production', () => {
  const base = { DATABASE_URL: 'mysql://user:pass@localhost:3306/zaevi', NODE_ENV: 'production' };
  assert.throws(() => loadEnv(base), /SESSION_SECRET is required in production/);
  assert.throws(() => loadEnv({ ...base, SESSION_SECRET: 'short' }), /at least 32 characters/);
  const config = loadEnv({ ...base, SESSION_SECRET: 'x'.repeat(32) });
  assert.equal(config.NODE_ENV, 'production');
});

test('loadEnv applies order rate-limit defaults', () => {
  const config = loadEnv({ DATABASE_URL: 'mysql://root:password@localhost:3306/zaevi' });
  assert.equal(config.ORDER_RATE_LIMIT_MAX, 30);
  assert.equal(config.ORDER_RATE_LIMIT_WINDOW_MS, 60000);
});

test('loadEnv accepts valid order rate-limit overrides', () => {
  const config = loadEnv({
    DATABASE_URL: 'mysql://root:password@localhost:3306/zaevi',
    ORDER_RATE_LIMIT_MAX: '12',
    ORDER_RATE_LIMIT_WINDOW_MS: '5000',
  });
  assert.equal(config.ORDER_RATE_LIMIT_MAX, 12);
  assert.equal(config.ORDER_RATE_LIMIT_WINDOW_MS, 5000);
});

test('loadEnv rejects invalid order rate-limit values', () => {
  const base = 'mysql://root:password@localhost:3306/zaevi';
  for (const bad of ['0', '-5', 'abc', '1.5']) {
    assert.throws(
      () => loadEnv({ DATABASE_URL: base, ORDER_RATE_LIMIT_MAX: bad }),
      /ORDER_RATE_LIMIT_MAX must be a positive integer/,
      `ORDER_RATE_LIMIT_MAX=${bad}`
    );
    assert.throws(
      () => loadEnv({ DATABASE_URL: base, ORDER_RATE_LIMIT_WINDOW_MS: bad }),
      /ORDER_RATE_LIMIT_WINDOW_MS must be a positive integer/,
      `ORDER_RATE_LIMIT_WINDOW_MS=${bad}`
    );
  }
});
