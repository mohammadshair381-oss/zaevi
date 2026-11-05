import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Regression tests for the bag → checkout navigation bug.
//
// Root cause: the drawer CHECKOUT button (`.drawer .checkout`, present on every
// storefront page) had no click handler bound — the wiring layer that lives on
// the checkout page itself was never present in main.js, so clicking did
// nothing. main.js must bind the button and navigate account-first:
//   authenticated → checkout.html
//   anonymous     → account.html?next=checkout.html (validated same-origin)
//   check failed  → recoverable message, no navigation, no order attempt
//
// main.js is a classic (non-module) browser script, so it is evaluated in an
// isolated `node:vm` context with a stub DOM (same approach as
// main-storage.test.js) and the real click handler is exercised.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function makeElement(tag) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {}, dataset: {}, textContent: '', innerHTML: '', hidden: false, value: '',
    _handlers: {},
    addEventListener(type, handler) { (this._handlers[type] ||= []).push(handler); },
    append() {}, appendChild() {}, insertAdjacentHTML() {}, insertBefore() {}, remove() {},
    setAttribute() {}, removeAttribute() {},
    getAttribute() { return null; },
    parentNode: null,
    querySelector() { return null; }, querySelectorAll() { return []; },
    onclick: null,
    __zaeviCheckoutWired: false,
  };
}

function cartRow() {
  return { id: 'ZV001', name: 'Aurelia Silk Dress', price: 18990, img: '', qty: 1, size: 'S' };
}

/**
 * Boot main.js in a vm with:
 * - a drawer containing one checkout button, and the #checkoutAuthError slot;
 * - localStorage seeded with a non-empty bag;
 * - a stubbed fetch answering /api/auth/me via `meResponder`.
 * Returns { ctx, checkoutBtn, errEl, fetchCalls, threw }.
 */
function boot({ store = {}, profile = null, meResponder } = {}) {
  const localStorage = {
    _s: { zaeviCart: JSON.stringify([cartRow()]), ...store },
    getItem(key) { return Object.prototype.hasOwnProperty.call(this._s, key) ? String(this._s[key]) : null; },
    setItem(key, value) { this._s[key] = String(value); },
    removeItem(key) { delete this._s[key]; },
  };
  const errEl = makeElement('p');
  const checkoutBtn = makeElement('button');
  const drawer = makeElement('aside');
  drawer.querySelectorAll = () => [checkoutBtn];
  drawer.querySelector = (sel) => (sel === '.checkout' ? checkoutBtn : null);
  const defaultMe = async () => ({ ok: true, status: 200, json: async () => ({ data: profile }) });
  const fetchCalls = [];
  const fetchStub = async (url, opts) => {
    fetchCalls.push(String(url));
    if (String(url).indexOf('/api/auth/me') >= 0) return (meResponder || defaultMe)(opts);
    return { ok: false, status: 503, json: async () => ({}) };
  };
  const document = {
    _listeners: {},
    querySelector(sel) {
      if (sel === '.drawer') return drawer;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.drawer .checkout') return [checkoutBtn];
      return [];
    },
    getElementById(id) { return id === 'checkoutAuthError' ? errEl : null; },
    createElement: makeElement,
    body: makeElement(),
    title: '',
    cookie: 'zaevi.csrf=t0',
    addEventListener(type, handler) { (this._listeners[type] ||= []).push(handler); },
  };
  const fireDOMContentLoaded = () => {
    for (const h of document._listeners.DOMContentLoaded || []) h();
  };
  const ctx = {
    console,
    localStorage,
    document,
    location: { href: 'http://localhost/index.html', search: '', pathname: '/index.html' },
    scrollY: 0,
    addEventListener() {},
    matchMedia: () => ({ matches: false }),
    IntersectionObserver: class { observe() {} },
    URLSearchParams,
    setTimeout: () => 0,
    clearTimeout() {},
    requestAnimationFrame: () => 0,
    fetch: fetchStub,
    Promise,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  let threw = null;
  try { vm.runInContext(mainSource, ctx, 'main.js'); } catch (error) { threw = error; }
  return { ctx, checkoutBtn, errEl, fetchCalls, fireDOMContentLoaded, threw };
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const dispatchClick = (btn) => {
  const handlers = btn._handlers.click || [];
  handlers.forEach((h) => h({ preventDefault() {} }));
  return handlers.length;
};

test('drawer CHECKOUT button is wired with a click handler at load', () => {
  const { checkoutBtn, threw } = boot({ profile: null });
  assert.equal(threw, null);
  // The handler was attached at evaluation time (before any async render pass).
  assert.equal((checkoutBtn._handlers.click || []).length, 1);
});

test('drawer CHECKOUT wiring is idempotent (no duplicate handlers across render passes)', () => {
  const { ctx, checkoutBtn } = boot({ profile: null });
  ctx.wireCheckoutButtons(); // e.g. re-invoked by a later render pass
  assert.equal((checkoutBtn._handlers.click || []).length, 1, '__zaeviCheckoutWired guard must prevent double binding');
  assert.equal(checkoutBtn.getAttribute('onclick'), null);
});

test('anonymous customer: CHECKOUT navigates to account.html with validated next path', async () => {
  const { ctx, checkoutBtn, errEl, fireDOMContentLoaded } = boot({ profile: null });
  // The load-time render pass settles the shared auth signal (as in a real browser).
  fireDOMContentLoaded();
  await settle();
  assert.equal(dispatchClick(checkoutBtn), 1);
  await settle();
  assert.equal(ctx.location.href, 'account.html?next=' + encodeURIComponent('checkout.html'));
  assert.equal(errEl.hidden, true, 'no error is shown on the anonymous path');
});

test('authenticated customer: CHECKOUT navigates to checkout.html', async () => {
  const { ctx, checkoutBtn, fireDOMContentLoaded } = boot({ profile: { id: 1, email: 'a@b.test', name: 'A' } });
  fireDOMContentLoaded();
  await settle();
  assert.equal(dispatchClick(checkoutBtn), 1);
  await settle();
  assert.equal(ctx.location.href, 'checkout.html');
});

test('failed session check: no navigation and a recoverable message (fail closed)', async () => {
  let meCalls = 0;
  const { ctx, checkoutBtn, errEl, fireDOMContentLoaded } = boot({
    meResponder: async () => { meCalls += 1; return { ok: false, status: 500, json: async () => ({}) }; },
  });
  fireDOMContentLoaded();
  await settle();
  assert.equal(dispatchClick(checkoutBtn), 1);
  await settle();
  assert.equal(meCalls, 1, 'exactly one /api/auth/me check serves both the render pass and this click');
  assert.equal(ctx.location.href, 'http://localhost/index.html', 'never navigates on a failed check');
  assert.match(errEl.textContent, /could not verify your sign-in/i);
  assert.equal(errEl.hidden, false, 'message must be visible');
});

test('the checkout entry point reuses the render pass session check (ONE /api/auth/me per page load)', async () => {
  let meCalls = 0;
  const { checkoutBtn, fireDOMContentLoaded } = boot({
    profile: null,
    meResponder: async () => { meCalls += 1; return { ok: true, status: 200, json: async () => ({ data: null }) }; },
  });
  fireDOMContentLoaded(); // render pass: checkAuth #1 and settle of the shared signal
  await settle();
  assert.equal(dispatchClick(checkoutBtn), 1); // click must NOT issue a second check
  await settle();
  assert.equal(meCalls, 1, 'click reuses the settled result instead of racing a second /api/auth/me');
});

test('a validated `next` parameter is preserved for the account redirect', () => {
  const { ctx } = boot({ profile: null });
  const url = ctx.accountNextUrl('checkout.html?ref=x');
  assert.equal(url, 'account.html?next=' + encodeURIComponent('checkout.html?ref=x'));
});

test('checkoutDestination never accepts absolute or javascript: return targets', () => {
  const { ctx } = boot({ profile: null });
  assert.equal(ctx.safeNextPath('javascript:alert(1)'), null);
  assert.equal(ctx.safeNextPath('https://evil.example/checkout.html'), null);
  assert.equal(ctx.safeNextPath('//evil.example/checkout.html'), null);
  assert.equal(ctx.safeNextPath('../checkout.html'), null);
  assert.equal(ctx.safeNextPath('checkout.html'), 'checkout.html');
});
