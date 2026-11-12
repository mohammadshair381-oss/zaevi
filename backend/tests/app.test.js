import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';


import { createApp } from '../src/app.js';

// Requiring the database Client implicitly loads the project `.env`, which would
// let the "disconnected" health assertion below reach a live database on a
// developer machine. Pin the datasource to an unreachable host so this test
// deterministically exercises the disconnected path. (database's dotenv loader
// does not override an already-defined variable.)
process.env.MONGODB_URI = 'mongodb://root:root@127.0.0.1:1/zaevi';

const app = createApp();

test('GET /api/health reports degraded with 503 when the database is disconnected', async () => {
  const res = await request(app).get('/api/health');

  assert.equal(res.status, 503);
  assert.equal(res.body.status, 'degraded');
  assert.equal(res.body.service, 'zaevi-backend');
  assert.equal(res.body.database.status, 'disconnected');
  assert.equal(res.body.database.provider, 'mongoose:mongodb');
  assert.ok(res.body.timestamp);
  assert.equal(typeof res.body.uptime, "number");
});

const STOREFRONT_PAGES = [
  '/index.html',
  '/women.html',
  '/men.html',
  '/collections.html',
  '/product.html',
  '/about.html',
  '/journal.html',
  '/journal-language-of-black.html',
  '/journal-behind-the-collection.html',
  '/journal-new-silhouette.html',
  '/account.html',
  '/wishlist.html',
  '/checkout.html',
  '/order-confirmation.html',
  '/track.html',
  '/contact.html',
  '/faq.html',
  '/size-guide.html',
  '/shipping.html',
  '/returns.html',
];

test('existing storefront pages are still served unchanged', async () => {
  for (const page of STOREFRONT_PAGES) {
    const res = await request(app).get(page);
    assert.equal(res.status, 200, `${page} should be served`);
    assert.match(res.headers['content-type'], /text\/html/);
  }
});

test('/admin.html is blocked at the static layer (no anonymous access)', async () => {
  const res = await request(app).get('/admin.html');
  assert.equal(res.status, 404);
});

test('static assets and data files remain accessible', async () => {
  const css = await request(app).get('/css/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);

  const logo = await request(app).get('/assets/zaevi-wordmark.png');
  assert.equal(logo.status, 200);
  assert.match(logo.headers['content-type'], /image\/png/);

  const products = await request(app).get('/data/products.json');
  assert.equal(products.status, 200);
  assert.match(products.headers['content-type'], /application\/json/);

  const robots = await request(app).get('/robots.txt');
  assert.equal(robots.status, 200);
});

test('unknown API routes return a JSON 404', async () => {
  const res = await request(app).get('/api/does-not-exist');

  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.body.error.status, 404);
});
