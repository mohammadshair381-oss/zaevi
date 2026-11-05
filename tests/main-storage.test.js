import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// main.js is a classic (non-module) browser script, so it cannot be imported
// directly. Instead it is evaluated in an isolated `node:vm` context with a
// stub DOM + localStorage, exactly as a browser would load it. Top-level
// function declarations become properties of the context global, so the
// storage helpers (`readStoredList`, `readCart`, `readWishlist`) can be called
// and asserted directly. This is a runtime-level test, not a browser test.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

// Values produced inside the vm context use that realm's Array/Object
// prototypes, which strict deep-equality rejects. Normalize to this realm.
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
  try {
    vm.runInContext(mainSource, ctx, 'main.js');
  } catch (error) {
    threw = error;
  }
  return { ctx, threw, localStorage };
}

test('storage helpers are exposed at top level', () => {
  const { ctx } = boot();
  assert.equal(typeof ctx.readStoredList, 'function');
  assert.equal(typeof ctx.readCart, 'function');
  assert.equal(typeof ctx.readWishlist, 'function');
});

test('malformed cart JSON does not throw at load and recovers to []', () => {
  const { ctx, threw } = boot({ zaeviCart: '{not valid json' });
  assert.equal(threw, null, 'top-level script must not throw on malformed cart JSON');
  assert.deepEqual(plain(ctx.readCart()), []);
  assert.deepEqual(plain(ctx.readWishlist()), []);
  assert.equal(ctx.localStorage.getItem('zaeviCart'), '{not valid json', 'raw value must not be deleted');
});

test('malformed wishlist JSON does not throw at load and recovers to []', () => {
  const { ctx, threw } = boot({ zaeviWish: 'nope' });
  assert.equal(threw, null, 'top-level script must not throw on malformed wishlist JSON');
  assert.deepEqual(plain(ctx.readWishlist()), []);
});

test('valid cart and wishlist data is preserved unchanged', () => {
  const cart = [
    { id: 'ZV001', name: 'Aurelia Silk Dress', price: 18900, img: 'a.jpg', qty: 2 },
    { id: 'ZV012', name: 'ZAEVI Signature Loafers', price: 13900, img: 'b.jpg', qty: 1 },
  ];
  const wishlist = ['ZV001', 'ZV012'];
  const { ctx, threw } = boot({ zaeviCart: JSON.stringify(cart), zaeviWish: JSON.stringify(wishlist) });
  assert.equal(threw, null);
  assert.deepEqual(plain(ctx.readCart()), cart);
  assert.deepEqual(plain(ctx.readWishlist()), wishlist);
});

test('non-array stored values recover to []', () => {
  for (const raw of ['{}', '123', '"a string"', 'null', 'true']) {
    const cart = boot({ zaeviCart: raw });
    assert.deepEqual(plain(cart.ctx.readCart()), [], `cart ${raw}`);
    const wish = boot({ zaeviWish: raw });
    assert.deepEqual(plain(wish.ctx.readWishlist()), [], `wishlist ${raw}`);
  }
});

test('absent keys recover to []', () => {
  const { ctx } = boot();
  assert.deepEqual(plain(ctx.readCart()), []);
  assert.deepEqual(plain(ctx.readWishlist()), []);
});

test('structurally invalid entries are dropped, valid ones kept', () => {
  const storedCart = [null, { id: 'ZV001', name: 'X', price: 100, img: 'a', qty: 2 }, 5, { id: 42, qty: 1 }, { id: 'ZV002', qty: 0 }, { id: 'ZV003' }];
  const { ctx } = boot({ zaeviCart: JSON.stringify(storedCart) });
  assert.deepEqual(plain(ctx.readCart()), [{ id: 'ZV001', name: 'X', price: 100, img: 'a', qty: 2 }]);

  const storedWish = ['ZV001', 5, '', null, 'ZV002'];
  const wish = boot({ zaeviWish: JSON.stringify(storedWish) });
  assert.deepEqual(plain(wish.ctx.readWishlist()), ['ZV001', 'ZV002']);
});

test('product cards expose persisted wishlist state and accessible toggle semantics', () => {
  const { ctx } = boot({ zaeviWish: JSON.stringify(['ZV001']) });
  const product = {
    id: 'ZV001',
    name: 'Aurelia Silk Dress',
    cat: 'Dresses',
    color: 'Ivory',
    price: 18900,
    sizes: ['S', 'M'],
    img: '/assets/zaevi-icon.png',
    hover: '/assets/zaevi-icon.png',
  };
  const html = ctx.card(product);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /Remove Aurelia Silk Dress from wishlist/);
  assert.match(html, /<span aria-hidden="true">♥<\/span>/);
  assert.match(html, /alt="" aria-hidden="true"/);
});

test('wishlist clicks persist once and synchronize the accessible pressed state', () => {
  const { ctx, localStorage } = boot();
  const attributes = {};
  const icon = { textContent: '♡' };
  const button = {
    dataset: { wish: 'ZV001', productName: 'Aurelia Silk Dress' },
    setAttribute(name, value) { attributes[name] = value; },
    querySelector() { return icon; },
    onclick: null,
  };
  const grid = {
    querySelectorAll(selector) {
      return selector === '[data-wish]' ? [button] : [];
    },
  };
  ctx.bindCards(grid);
  button.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(attributes['aria-pressed'], 'true');
  assert.equal(attributes['aria-label'], 'Remove Aurelia Silk Dress from wishlist');
  assert.equal(icon.textContent, '♥');
  assert.deepEqual(JSON.parse(localStorage.getItem('zaeviWish')), ['ZV001']);
  button.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(attributes['aria-pressed'], 'false');
  assert.equal(icon.textContent, '♡');
  assert.deepEqual(JSON.parse(localStorage.getItem('zaeviWish')), []);
});

test('failed product images are hidden and flagged for the explicit fallback', () => {
  const { ctx } = boot();
  const classes = new Set(['p1']);
  const containerClasses = new Set();
  let onError;
  const container = { classList: { add(name) { containerClasses.add(name); } } };
  const image = {
    hidden: false,
    complete: false,
    classList: { contains(name) { return classes.has(name); } },
    addEventListener(name, callback) { if (name === 'error') onError = callback; },
    closest(selector) { return selector === '.product-img' ? container : null; },
  };
  const grid = {
    querySelectorAll(selector) {
      return selector === '.product-img img' ? [image] : [];
    },
  };
  ctx.bindCards(grid);
  onError();
  assert.equal(image.hidden, true);
  assert.equal(containerClasses.has('has-image-error'), true);
});

test('product-detail image failures keep one primary fallback and omit failed secondary slots', () => {
  const { ctx } = boot();
  const frames = [];
  const images = [];
  const gallery = {
    querySelectorAll(selector) {
      return selector === '.gallery-image img' ? images : [];
    },
  };
  for (const primary of [true, false]) {
    const frameClasses = new Set(primary ? ['gallery-image', 'gallery-image--primary'] : ['gallery-image']);
    const frame = {
      classList: {
        add(name) { frameClasses.add(name); },
        contains(name) { return frameClasses.has(name); },
      },
    };
    let onError;
    const image = {
      hidden: false,
      complete: false,
      naturalWidth: 100,
      addEventListener(name, callback, options) {
        if (name === 'error') {
          onError = callback;
          assert.equal(options.once, true);
        }
      },
      closest(selector) { return selector === '.gallery-image' ? frame : null; },
    };
    images.push(image);
    frames.push({ frameClasses, image, fail: () => onError() });
  }

  ctx.bindProductGallery(gallery);
  frames[0].fail();
  frames[1].fail();

  assert.equal(frames[0].image.hidden, true);
  assert.equal(frames[0].frameClasses.has('has-image-error'), true);
  assert.equal(frames[0].frameClasses.has('is-omitted'), false);
  assert.equal(frames[1].image.hidden, true);
  assert.equal(frames[1].frameClasses.has('is-omitted'), true);
});

test('product detail renders exactly one explicit primary-image fallback', () => {
  const { ctx } = boot();
  const nodes = Object.fromEntries(
    ['#productDetail', '#pcode', '#pname', '#pprice', '#pdesc', '#gallery', '#sizes', '#addProduct']
      .map(selector => [selector, makeElement()]),
  );
  nodes['#gallery'].querySelectorAll = () => [];
  ctx.document.querySelector = selector => nodes[selector] || null;
  ctx.document.querySelectorAll = () => [];
  ctx.location.search = '?id=ZV005';
  const product = {
    id: 'ZV005',
    name: 'Serein Wide-Leg Trousers',
    price: 11900,
    desc: 'Wide-leg trousers.',
    img: 'https://example.test/primary.jpg',
    hover: 'https://example.test/alternate.jpg',
    sizes: ['XS', 'S'],
  };
  vm.runInContext(`products = ${JSON.stringify([product])}`, ctx);

  ctx.renderProduct();

  assert.equal((nodes['#gallery'].innerHTML.match(/gallery-fallback/g) || []).length, 1);
  assert.match(nodes['#gallery'].innerHTML, /gallery-image--primary/);
});
