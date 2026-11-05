import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// The size helpers in main.js drive product-page selection and the cart
// drawer. They are evaluated in a vm context (exactly as a browser loads the
// classic script) so the top-level function declarations can be asserted
// directly. No DOM stubs are needed because the pure helpers do not touch it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'main.js'), 'utf8');

const plain = (value) => JSON.parse(JSON.stringify(value));

function makeElement() {
  return {
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {}, dataset: {}, textContent: '', innerHTML: '',
    addEventListener() {}, append() {}, appendChild() {}, insertAdjacentHTML() {},
    setAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    onclick: null,
  };
}

function boot(store = {}) {
  const localStorage = {
    _s: { ...store },
    getItem(key) { return Object.prototype.hasOwnProperty.call(this._s, key) ? String(this._s[key]) : null; },
    setItem(key, value) { this._s[key] = String(value); },
    removeItem(key) { delete this._s[key]; },
  };
  const document = {
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement: makeElement,
    body: makeElement(),
    title: '',
  };
  const ctx = {
    console,
    localStorage,
    document,
    location: { search: '' },
    scrollY: 0,
    addEventListener() {},
    matchMedia: () => ({ matches: false }),
    IntersectionObserver: class { observe() {} },
    URLSearchParams,
    setTimeout: () => 0,
    clearTimeout() {},
    requestAnimationFrame: () => 0,
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  let threw = null;
  try { vm.runInContext(mainSource, ctx, 'main.js'); } catch (error) { threw = error; }
  return { ctx, threw };
}

test('size helpers are exposed at top level', () => {
  const { ctx } = boot();
  for (const name of ['productSizes', 'isSizeDependent', 'resolveSize', 'upsertCartLine', 'add']) {
    assert.equal(typeof ctx[name], 'function', `${name} should be available`);
  }
});

test('productSizes keeps non-empty string sizes and ignores junk', () => {
  const { ctx } = boot();
  assert.deepEqual(plain(ctx.productSizes({ sizes: ['XS', '', ' S ', 'M'] })), ['XS', ' S ', 'M']);
  assert.deepEqual(plain(ctx.productSizes({ sizes: ['', ' '] })), []);
  assert.deepEqual(plain(ctx.productSizes({ sizes: [42, null, 'M'] })), ['M']);
  assert.deepEqual(plain(ctx.productSizes({})), []);
  assert.deepEqual(plain(ctx.productSizes(null)), []);
});

test('a lone generic size is not a real size choice', () => {
  const { ctx } = boot();
  for (const generic of ['One Size', 'one-size', 'One size', 'ONESIZE', 'OS', 'free size', 'FreeSize', 'universal', 'Universal']) {
    assert.equal(ctx.isSizeDependent({ sizes: [generic] }), false, `${generic} should be generic`);
  }
});

test('a real single or multi size choice is size dependent', () => {
  const { ctx } = boot();
  assert.equal(ctx.isSizeDependent({ sizes: ['42'] }), true, 'a sized article is a real choice');
  assert.equal(ctx.isSizeDependent({ sizes: ['39', '40', '41', '42', '43', '44'] }), true);
  assert.equal(ctx.isSizeDependent({ sizes: ['S', 'M', 'L'] }), true);
  assert.equal(ctx.isSizeDependent({ sizes: [] }), false);
  assert.equal(ctx.isSizeDependent({}), false);
});

test('resolveSize honours a valid requested size', () => {
  const { ctx } = boot();
  assert.equal(ctx.resolveSize({ sizes: ['XS', 'S', 'M', 'L'] }, 'M'), 'M');
  assert.equal(ctx.resolveSize({ sizes: ['39', '40', '41', '42', '43', '44'] }, '42'), '42');
});

test('resolveSize never auto-picks for a size dependent product', () => {
  const { ctx } = boot();
  assert.equal(ctx.resolveSize({ sizes: ['S', 'M', 'L'] }, undefined), null);
  assert.equal(ctx.resolveSize({ sizes: ['S', 'M', 'L'] }, 'XXL'), null, 'unknown size is rejected');
  assert.equal(ctx.resolveSize({ sizes: [] }, undefined), null);
});

test('resolveSize auto-resolves the single generic size', () => {
  const { ctx } = boot();
  assert.equal(ctx.resolveSize({ sizes: ['One Size'] }, undefined), 'One Size');
  assert.equal(ctx.resolveSize({ sizes: ['One Size'] }, 'One Size'), 'One Size');
  assert.equal(ctx.resolveSize({ sizes: ['Free Size'] }, undefined), 'Free Size');
});

test('upsertCartLine bumps the exact (product, size) line only', () => {
  const { ctx } = boot();
  const p = { id: 'ZV001', name: 'Aurelia Silk Dress', img: 'a.jpg', price: 18900 };
  const cart = [
    { id: 'ZV001', name: 'Aurelia Silk Dress', img: 'a.jpg', price: 18900, qty: 1, size: 'S' },
    { id: 'ZV012', name: 'ZAEVI Signature Loafers', img: 'b.jpg', price: 13900, qty: 1, size: '40' },
  ];
  const bumped = plain(ctx.upsertCartLine(cart, p, 'S', 1));
  assert.equal(bumped.length, 2);
  assert.equal(bumped[0].qty, 2);
  assert.equal(bumped[0].name, 'Aurelia Silk Dress');

  const withNewSize = plain(ctx.upsertCartLine(cart, p, 'M', 1));
  assert.equal(withNewSize.length, 3);
  assert.equal(withNewSize.find((x) => x.id === 'ZV001' && x.size === 'M').qty, 1);

  const untouched = plain(ctx.upsertCartLine(cart, p, 'S', 2));
  assert.equal(untouched.find((x) => x.id === 'ZV012').qty, 1, 'other lines are untouched');
});

test('upsertCartLine preserves other fields and honours a custom quantity', () => {
  const { ctx } = boot();
  const p = { id: 'ZV011', name: 'Atelier Leather Tote', img: 'c.jpg', price: 14900, extra: 'kept' };
  const out = plain(ctx.upsertCartLine([], p, 'One Size', 3));
  assert.deepEqual(out, [{ id: 'ZV011', name: 'Atelier Leather Tote', img: 'c.jpg', price: 14900, qty: 3, size: 'One Size' }]);
});

test('cart rows keep their size field when read back', () => {
  const cart = [
    { id: 'ZV001', name: 'Aurelia Silk Dress', price: 18900, img: 'a.jpg', qty: 2, size: 'S' },
    { id: 'ZV011', name: 'Atelier Leather Tote', price: 14900, img: 'c.jpg', qty: 1, size: 'One Size' },
  ];
  const { ctx, threw } = boot({ zaeviCart: JSON.stringify(cart) });
  assert.equal(threw, null);
  assert.deepEqual(plain(ctx.readCart()), cart);
});

test('malformed cart still boots and the helpers survive', () => {
  const { ctx, threw } = boot({ zaeviCart: '{not valid json' });
  assert.equal(threw, null);
  assert.deepEqual(plain(ctx.readCart()), []);
  assert.equal(ctx.resolveSize({ sizes: ['One Size'] }, undefined), 'One Size');
});