import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { CONTENT_SECURITY_POLICY } from '../src/middleware/security.js';

const app = createApp();

const BASELINE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

function assertBaselineHeaders(res, label) {
  for (const [name, value] of Object.entries(BASELINE_HEADERS)) {
    assert.equal(res.headers[name], value, `${label}: ${name} should be ${value}`);
  }
}

test('baseline security headers are present on static-file responses', async () => {
  for (const target of ['/', '/index.html', '/css/style.css', '/assets/zaevi-wordmark.png']) {
    const res = await request(app).get(target);
    assert.equal(res.status, 200, `${target} should be served`);
    assertBaselineHeaders(res, target);
  }
});

test('baseline security headers are present on API responses', async () => {
  const res = await request(app).get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /application\/json/);
  assertBaselineHeaders(res, '/api/does-not-exist');
});

test('baseline security headers are present on blocked sensitive paths', async () => {
  for (const target of ['/.env', '/package.json', '/src/server.js', '/node_modules/express/package.json']) {
    const res = await request(app).get(target);
    assert.equal(res.status, 404, `${target} must stay blocked`);
    assertBaselineHeaders(res, target);
  }
});

test('X-Powered-By is not disclosed', async () => {
  const res = await request(app).get('/index.html');
  assert.equal(res.headers['x-powered-by'], undefined);
});

test('CSP is delivered as Report-Only and never as an enforcing policy', async () => {
  const res = await request(app).get('/index.html');
  assert.equal(res.headers['content-security-policy'], undefined);
  assert.ok(res.headers['content-security-policy-report-only']);
  assert.equal(res.headers['content-security-policy-report-only'], CONTENT_SECURITY_POLICY);
});

test('CSP documents the external sources and inline usage required by the storefront', () => {
  const policy = CONTENT_SECURITY_POLICY;
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /script-src 'self' 'unsafe-inline'/);
  assert.match(policy, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
  assert.match(policy, /img-src 'self' data: https:\/\/images\.unsplash\.com/);
  assert.match(policy, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
  assert.match(policy, /connect-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /frame-ancestors 'self'/);
  assert.match(policy, /form-action 'self'/);
});

test('Strict-Transport-Security is not sent over local HTTP', async () => {
  const res = await request(app).get('/index.html');
  assert.equal(res.headers['strict-transport-security'], undefined);
});

test('security headers do not alter existing status codes or bodies', async () => {
  const home = await request(app).get('/index.html');
  assert.equal(home.status, 200);

  const missingApi = await request(app).get('/api/does-not-exist');
  assert.equal(missingApi.status, 404);
  assert.equal(missingApi.body.error.status, 404);

  const blocked = await request(app).get('/.env');
  assert.equal(blocked.status, 404);
  assert.equal(blocked.text, 'Not Found');
  assert.doesNotMatch(blocked.text ?? '', /MONGODB_URI/);
});
