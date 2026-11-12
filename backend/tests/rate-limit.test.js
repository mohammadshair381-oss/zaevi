import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRateLimiter,
  DEFAULT_MAX,
  DEFAULT_WINDOW_MS,
} from '../src/middleware/rate-limit.js';
import { HttpError } from '../src/middleware/errors.js';

// Unit tests for the dependency-free, in-memory fixed-window limiter. The clock
// is injected so window resets are deterministic; no network or server is used.
// These are NOT multi-instance or real-network tests: the limiter is explicitly
// process-local.

function drive(limiter, req) {
  const res = {
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = String(value);
    },
  };
  let error = null;
  limiter(req, res, (err) => {
    error = err ?? null;
  });
  return { res, error };
}

test('exposes reasonable defaults', () => {
  assert.equal(DEFAULT_MAX, 30);
  assert.equal(DEFAULT_WINDOW_MS, 60000);
});

test('allows up to the limit and rejects the next request with 429', () => {
  const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => 0 });
  const first = drive(limiter, { ip: '203.0.113.7' });
  const second = drive(limiter, { ip: '203.0.113.7' });
  const third = drive(limiter, { ip: '203.0.113.7' });

  assert.equal(first.error, null, 'first request passes');
  assert.equal(second.error, null, 'second request passes');
  assert.ok(third.error instanceof HttpError, 'third request is rejected');
  assert.equal(third.error.status, 429);
  assert.match(third.error.message, /too many/i);
});

test('sets accurate rate-limit headers and Retry-After on rejection', () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 10_000, now: () => 0 });
  const allowed = drive(limiter, { ip: '203.0.113.8' });
  assert.equal(allowed.res.headers['ratelimit-limit'], '1');
  assert.equal(allowed.res.headers['ratelimit-remaining'], '0');
  assert.equal(allowed.res.headers['ratelimit-reset'], '10');
  assert.equal(allowed.res.headers['retry-after'], undefined, 'no Retry-After while allowed');

  const blocked = drive(limiter, { ip: '203.0.113.8' });
  assert.equal(blocked.res.headers['ratelimit-limit'], '1');
  assert.equal(blocked.res.headers['ratelimit-remaining'], '0');
  assert.equal(blocked.res.headers['ratelimit-reset'], '10');
  assert.equal(blocked.res.headers['retry-after'], '10', 'Retry-After present on 429');
});

test('remaining count decreases as the window is consumed', () => {
  const limiter = createRateLimiter({ max: 3, windowMs: 60_000, now: () => 0 });
  assert.equal(drive(limiter, { ip: 'a' }).res.headers['ratelimit-remaining'], '2');
  assert.equal(drive(limiter, { ip: 'a' }).res.headers['ratelimit-remaining'], '1');
  assert.equal(drive(limiter, { ip: 'a' }).res.headers['ratelimit-remaining'], '0');
});

test('the window resets after windowMs elapses', () => {
  let clock = 0;
  const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => clock });

  assert.equal(drive(limiter, { ip: 'b' }).error, null);
  const blocked = drive(limiter, { ip: 'b' });
  assert.equal(blocked.error.status, 429);

  clock = 999;
  assert.equal(drive(limiter, { ip: 'b' }).error.status, 429, 'still blocked just before reset');

  clock = 1000;
  assert.equal(drive(limiter, { ip: 'b' }).error, null, 'allowed again after the window resets');
});

test('different client IPs get independent budgets', () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 60_000, now: () => 0 });
  assert.equal(drive(limiter, { ip: '198.51.100.1' }).error, null);
  assert.equal(drive(limiter, { ip: '198.51.100.2' }).error, null, 'a different IP is not blocked');
  assert.equal(drive(limiter, { ip: '198.51.100.1' }).error.status, 429, 'the first IP is still blocked');
});

test('forwarded headers are ignored; only req.ip keys the bucket', () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 60_000, now: () => 0 });
  const first = drive(limiter, { ip: '192.0.2.5', headers: { 'x-forwarded-for': '203.0.113.1' } });
  assert.equal(first.error, null);

  // Same socket IP, attacker-chosen forwarded value: must NOT reset the bucket.
  const second = drive(limiter, { ip: '192.0.2.5', headers: { 'x-forwarded-for': '203.0.113.2' } });
  assert.equal(second.error.status, 429, 'spoofed X-Forwarded-For must not create a new key');

  const forwarded = drive(limiter, { ip: '192.0.2.5', headers: { forwarded: 'for=203.0.113.3' } });
  assert.equal(forwarded.error.status, 429, 'spoofed Forwarded must not create a new key');
});

test('falls back to the socket address when req.ip is absent', () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 60_000, now: () => 0 });
  const first = drive(limiter, { socket: { remoteAddress: '10.0.0.9' } });
  assert.equal(first.error, null);
  const second = drive(limiter, { socket: { remoteAddress: '10.0.0.9' } });
  assert.equal(second.error.status, 429);
});

test('expired buckets are swept so memory does not grow unbounded', () => {
  let clock = 0;
  const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => clock });
  for (let i = 0; i < 50; i += 1) {
    drive(limiter, { ip: `client-${i}` });
  }
  assert.equal(limiter.buckets.size, 50);

  clock = 5000; // several windows later, the next request triggers a sweep
  drive(limiter, { ip: 'fresh' });
  assert.equal(limiter.buckets.size, 1, 'all expired buckets are reclaimed, leaving only the fresh one');
});
