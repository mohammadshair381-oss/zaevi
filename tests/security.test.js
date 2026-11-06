import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { isBlockedPath, isPublicStaticPath } from '../src/middleware/security.js';

const app = createApp();

const PROTECTED = [
  '/.env',
  '/.env.example',
  '/package.json',
  '/package-lock.json',
  '/.gitignore',
  '/src/server.js',
  '/src/config/env.js',
  '/node_modules/express/package.json',
  '/tests/app.test.js',
  '/%2e%2e/package.json',
];

test('sensitive files cannot be retrieved over HTTP', async () => {
  for (const target of PROTECTED) {
    const res = await request(app).get(target);
    assert.equal(res.status, 404, `${target} must not be served`);
  }
});

const INTERNAL_FILES = [
  '/FINAL_REPORT.md',
  '/TASK4_REPORT.md',
  '/TASK5-1_AUDIT_REPORT.md',
  '/README.md',
  '/test_output.txt',
  '/final_summary.txt',
  '/compare_output.txt',
  '/main.js.bak',
  '/main.js.bak4',
  '/main.js.bak5',
  '/main.js.new',
  '/main.js.fixed',
  '/main.js.append',
  '/main.js.pre-cleanup',
  '/style.css.bak',
  '/check_db.mjs',
  '/scripts/create-admin.cjs',
  '/admin.html',
  '/prisma.config.ts',
  '/src/db/schema.js',
  '/prisma/migrations/20261021060000_add_product_size_stock/migration.sql',
];

test('internal reports, output, backups and helper scripts are not public', async () => {
  for (const target of INTERNAL_FILES) {
    const res = await request(app).get(target);
    assert.equal(res.status, 404, `${target} must not be served`);
  }
});

test('public storefront files remain available under the explicit allowlist', async () => {
  for (const target of [
    '/',
    '/index.html',
    '/product.html',
    '/main.js',
    '/cms-public.js',
    '/style.css',
    '/admin.css',
    '/assets/zaevi-icon.png',
    '/assets/zaevi-wordmark.png',
    '/products.json',
    '/robots.txt',
    '/sitemap.xml',
  ]) {
    const res = await request(app).get(target);
    assert.equal(res.status, 200, `${target} must remain public`);
  }
});

test('allowlist rejects traversal, encoded traversal and unlisted asset types', async () => {
  for (const target of [
    '/assets/../FINAL_REPORT.md',
    '/assets/%2e%2e/FINAL_REPORT.md',
    '/assets/%252e%252e/FINAL_REPORT.md',
    '/api/../FINAL_REPORT.md',
    '/api/%2e%2e/FINAL_REPORT.md',
    '/api/..%2fFINAL_REPORT.md',
    '/%46INAL_REPORT.md',
    '/assets/internal.txt',
  ]) {
    const res = await request(app).get(target);
    assert.equal(res.status, 404, `${target} must not be served`);
  }
});

test('unknown API routes still return JSON rather than the static 404', async () => {
  const res = await request(app).get('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.body.error.status, 404);
});

test('protected responses never leak configuration contents', async () => {
  const env = await request(app).get('/.env');
  assert.doesNotMatch(env.text ?? '', /MONGODB_URI/);

  const pkg = await request(app).get('/package.json');
  assert.doesNotMatch(pkg.text ?? '', /"dependencies"/);
});

test('isBlockedPath classifies paths correctly', () => {
  assert.equal(isBlockedPath('/index.html'), false);
  assert.equal(isBlockedPath('/assets/zaevi-icon.png'), false);
  assert.equal(isBlockedPath('/.env'), true);
  assert.equal(isBlockedPath('/src/app.js'), true);
  assert.equal(isBlockedPath('/node_modules/@prisma/client/default.js'), true);
});

test('isPublicStaticPath allows only the explicit storefront surface', () => {
  assert.equal(isPublicStaticPath('/'), true);
  assert.equal(isPublicStaticPath('/index.html'), true);
  assert.equal(isPublicStaticPath('/main.js'), true);
  assert.equal(isPublicStaticPath('/assets/zaevi-icon.png'), true);
  assert.equal(isPublicStaticPath('/products.json'), true);
  assert.equal(isPublicStaticPath('/FINAL_REPORT.md'), false);
  assert.equal(isPublicStaticPath('/README.md'), false);
  assert.equal(isPublicStaticPath('/main.js.bak'), false);
  assert.equal(isPublicStaticPath('/check_db.mjs'), false);
  assert.equal(isPublicStaticPath('/admin.html'), false);
  assert.equal(isPublicStaticPath('/assets/../FINAL_REPORT.md'), false);
  assert.equal(isPublicStaticPath('/assets/%2e%2e/FINAL_REPORT.md'), false);
  assert.equal(isPublicStaticPath('/%252e%252e/package.json'), false);
});
