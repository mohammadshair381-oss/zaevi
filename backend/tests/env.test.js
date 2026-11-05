import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEnv, EnvValidationError } from '../src/config/env.js';

test('loadEnv applies defaults when MONGODB_URI is present', () => {
  const config = loadEnv({ MONGODB_URI: 'mongodb://root:password@localhost:27017/zaevi' });
  assert.equal(config.NODE_ENV, 'development');
  assert.equal(config.PORT, 3000);
  assert.equal(config.MONGODB_URI, 'mongodb://root:password@localhost:27017/zaevi');
});

test('loadEnv fails when MONGODB_URI is missing', () => {
  assert.throws(() => loadEnv({}), (error) => {
    assert.ok(error instanceof EnvValidationError);
    assert.match(error.message, /MONGODB_URI is required/);
    return true;
  });
});

test('loadEnv rejects an invalid connection string scheme', () => {
  assert.throws(
    () => loadEnv({ MONGODB_URI: 'http://localhost:3306/zaevi' }),
    /must start with "mongodb:\/\/"/
  );
});

test('loadEnv rejects old mysql connection strings and accepts both MongoDB forms', () => {
  assert.throws(() => loadEnv({ MONGODB_URI: 'mysql://root@localhost:3306/zaevi' }), /must start with "mongodb:\/\/"/);
  assert.equal(loadEnv({ MONGODB_URI: 'mongodb://localhost:27017/zaevi' }).MONGODB_URI, 'mongodb://localhost:27017/zaevi');
  assert.equal(loadEnv({ MONGODB_URI: 'mongodb+srv://cluster.example.net/zaevi' }).MONGODB_URI, 'mongodb+srv://cluster.example.net/zaevi');
});

test('loadEnv rejects an invalid PORT', () => {
  assert.throws(
    () => loadEnv({ MONGODB_URI: 'mongodb://root:password@localhost:27017/zaevi', PORT: 'not-a-port' }),
    /PORT must be an integer/
  );
});

test('loadEnv rejects an unsupported NODE_ENV', () => {
  assert.throws(
    () => loadEnv({ MONGODB_URI: 'mongodb://root:password@localhost:27017/zaevi', NODE_ENV: 'staging' }),
    /NODE_ENV must be one of/
  );
});

test('loadEnv accepts a connection with custom port', () => {
  const config = loadEnv({
    MONGODB_URI: 'mongodb://user:pass@localhost:27017/zaevi',
    PORT: '8080',
    NODE_ENV: 'test',
  });
  assert.equal(config.PORT, 8080);
  assert.equal(config.NODE_ENV, 'test');
  assert.equal(config.MONGODB_URI, 'mongodb://user:pass@localhost:27017/zaevi');
});

test('loadEnv requires a strong SESSION_SECRET when NODE_ENV is production', () => {
  const base = { MONGODB_URI: 'mongodb://user:pass@localhost:27017/zaevi', NODE_ENV: 'production' };
  assert.throws(() => loadEnv(base), /SESSION_SECRET is required in production/);
  assert.throws(() => loadEnv({ ...base, SESSION_SECRET: 'short' }), /at least 32 characters/);
  const config = loadEnv({ ...base, SESSION_SECRET: 'x'.repeat(32) });
  assert.equal(config.NODE_ENV, 'production');
});

test('loadEnv applies order rate-limit defaults', () => {
  const config = loadEnv({ MONGODB_URI: 'mongodb://root:password@localhost:27017/zaevi' });
  assert.equal(config.ORDER_RATE_LIMIT_MAX, 30);
  assert.equal(config.ORDER_RATE_LIMIT_WINDOW_MS, 60000);
});

test('loadEnv accepts valid order rate-limit overrides', () => {
  const config = loadEnv({
    MONGODB_URI: 'mongodb://root:password@localhost:27017/zaevi',
    ORDER_RATE_LIMIT_MAX: '12',
    ORDER_RATE_LIMIT_WINDOW_MS: '5000',
  });
  assert.equal(config.ORDER_RATE_LIMIT_MAX, 12);
  assert.equal(config.ORDER_RATE_LIMIT_WINDOW_MS, 5000);
});

test('loadEnv rejects invalid order rate-limit values', () => {
  const base = 'mongodb://root:password@localhost:27017/zaevi';
  for (const bad of ['0', '-5', 'abc', '1.5']) {
    assert.throws(
      () => loadEnv({ MONGODB_URI: base, ORDER_RATE_LIMIT_MAX: bad }),
      /ORDER_RATE_LIMIT_MAX must be a positive integer/,
      `ORDER_RATE_LIMIT_MAX=${bad}`
    );
    assert.throws(
      () => loadEnv({ MONGODB_URI: base, ORDER_RATE_LIMIT_WINDOW_MS: bad }),
      /ORDER_RATE_LIMIT_WINDOW_MS must be a positive integer/,
      `ORDER_RATE_LIMIT_WINDOW_MS=${bad}`
    );
  }
});
