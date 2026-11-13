import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { pageFileFor } from '../src/middleware/clean-urls.js';
import { isPublicStaticPath } from '../src/middleware/security.js';
import { buildStatic } from '../scripts/build-static.mjs';

// Keep the app away from any real database (see app.test.js).
process.env.MONGODB_URI = 'mongodb://root:root@127.0.0.1:1/zaevi';

const root = path.resolve(import.meta.dirname, '..', '..');
const frontend = path.join(root, 'frontend');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const app = createApp();

/** Every public storefront page except the homepage, by clean name. */
const PAGES = readdirSync(frontend)
  .filter((file) => file.endsWith('.html') && isPublicStaticPath(`/${file}`))
  .map((file) => file.slice(0, -5))
  .filter((name) => name !== 'index')
  .sort();

const cleanRoute = () => JSON.parse(read('vercel.json')).routes.find((route) => route.dest === '/$1.html');

test('the storefront has 24 pages with clean addresses, besides the homepage', () => {
  assert.equal(PAGES.length, 24);
  for (const name of ['about', 'collections', 'contact', 'account', 'product', 'reset-password']) assert.ok(PAGES.includes(name), name);
  for (const name of ['admin', 'admin-recovery', 'site-studio', 'homepage-editor']) assert.ok(!PAGES.includes(name), name);
});

test('vercel.json maps exactly the storefront pages, with no catch-all', () => {
  const route = cleanRoute();
  assert.ok(route, 'clean-address route present');
  assert.deepEqual(Object.keys(route).sort(), ['dest', 'src']);
  const listed = route.src.match(/^\^\/\(([^)]+)\)\$$/)[1].split('|').sort();
  assert.deepEqual(listed, PAGES);
  const pattern = new RegExp(route.src);
  for (const name of PAGES) {
    assert.equal(`/${name}`.replace(pattern, route.dest), `/${name}.html`, name);
  }
  for (const url of ['/', '/index', '/about.html', '/about/', '/About', '/aboutx', '/api/products', '/api/about',
    '/admin', '/admin/', '/admin/studio', '/admin.html', '/admin-recovery', '/css/style.css', '/assets/zaevi-icon.png',
    '/js/main.js', '/data/products.json', '/robots.txt', '/sitemap.xml', '/shop', '/product/ZV001']) {
    assert.equal(pattern.test(url), false, url);
  }
});

test('every clean address on Vercel points at a file the static build publishes', async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'zaevi-clean-'));
  try {
    const files = await buildStatic({ outDir });
    for (const name of PAGES) assert.ok(files.includes(`${name}.html`), name);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('the server serves each clean address with the same page as its .html address', async () => {
  for (const name of PAGES) {
    const clean = await request(app).get(`/${name}`);
    const old = await request(app).get(`/${name}.html`);
    assert.equal(clean.status, 200, `/${name}`);
    assert.match(clean.headers['content-type'], /text\/html/);
    assert.equal(old.status, 200, `/${name}.html still works`);
    assert.equal(clean.text, old.text, name);
  }
  const home = await request(app).get('/');
  assert.equal(home.status, 200);
  assert.equal(home.text, (await request(app).get('/index.html')).text);
});

test('query strings reach the page and HEAD works', async () => {
  const product = await request(app).get('/product?id=ZV002');
  assert.equal(product.status, 200);
  assert.equal(product.text, readFileSync(path.join(frontend, 'product.html'), 'utf8'));
  assert.equal((await request(app).get('/reset-password?token=abc')).status, 200);
  assert.equal((await request(app).head('/about')).status, 200);
});

test('clean addresses never reach admin pages, unknown names or other routes', async () => {
  for (const url of ['/index', '/about/', '/About', '/shop', '/admin-recovery', '/site-studio', '/homepage-editor', '/admin.html', '/admin-recovery.html']) {
    assert.equal((await request(app).get(url)).status, 404, url);
  }
  assert.equal(pageFileFor('/admin'), null);
  assert.equal(pageFileFor('/about'), '/about.html');
  const api = await request(app).get('/api/no-such-route');
  assert.equal(api.status, 404);
  assert.match(api.headers['content-type'], /application\/json/);
  assert.equal((await request(app).post('/about')).status, 404, 'only GET and HEAD are mapped');
  assert.equal((await request(app).get('/css/style.css')).status, 200);
  assert.equal((await request(app).get('/assets/zaevi-icon.png')).status, 200);
});

/** Runs the address tidy-up at the top of main.js against a stub browser. */
function tidy(pathname, search = '', hash = '') {
  const source = read('frontend/js/main.js');
  const snippet = source.slice(source.indexOf('(function(){'), source.indexOf('})();') + 5);
  const calls = [];
  const history = { state: null, replaceState: (...args) => calls.push(args[2]) };
  vm.runInNewContext(snippet, { location: { pathname, search, hash }, history, window: { history } });
  return calls;
}

test('main.js shows the clean address for an old .html address, keeping query and fragment', () => {
  assert.deepEqual(tidy('/product.html', '?id=ZV002', '#details'), ['/product?id=ZV002#details']);
  assert.deepEqual(tidy('/reset-password.html', '?token=abc'), ['/reset-password?token=abc']);
  assert.deepEqual(tidy('/index.html', '?studioPreview=1'), ['/?studioPreview=1']);
  assert.deepEqual(tidy('/about.html'), ['/about']);
  for (const pathname of ['/', '/about', '/admin/studio', '/admin/admin.html', '/css/style.css']) {
    assert.deepEqual(tidy(pathname), [], pathname);
  }
});

test('storefront pages link to clean addresses', () => {
  const pageNames = new Set(['index', ...PAGES]);
  for (const file of readdirSync(frontend).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(path.join(frontend, file), 'utf8');
    for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
      const page = /^(?:\.\/)?([a-z0-9-]+)\.html(?:[?#]|$)/.exec(href);
      assert.ok(!page || !pageNames.has(page[1]), `${file} still links to ${href}`);
    }
  }
  const sitemap = read('frontend/sitemap.xml');
  assert.doesNotMatch(sitemap, /\.html</);
  assert.match(sitemap, /<loc>https:\/\/www\.zaevi\.com\/about<\/loc>/);
});
