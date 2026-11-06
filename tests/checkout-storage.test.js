import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, '..', 'checkout.html'), 'utf8');
const inline = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

// The checkout order-summary script reads the cart from localStorage. Like the
// storefront helpers it must recover from malformed data instead of throwing.
function boot(store) {
  const items = { innerHTML: '' };
  const total = { textContent: '' };
  const els = { checkoutItems: items, checkoutTotal: total, checkoutForm: null };
  const ctx = {
    document: { getElementById: (id) => els[id] ?? null },
    localStorage: {
      _s: { ...store },
      getItem(k) { return this._s[k] ?? null; },
      setItem(k, v) { this._s[k] = String(v); },
      removeItem(k) { delete this._s[k]; },
    },
    location: { href: '' },
  };
  vm.createContext(ctx);
  let threw = null;
  try { vm.runInContext(inline, ctx); } catch (e) { threw = e; }
  return { items, total, threw };
}

test('checkout inline script targets the order summary', () => {
  assert.ok(inline.includes('checkoutItems'), 'inline script should still render the order summary');
});

test('malformed cart JSON does not throw and shows the empty state', () => {
  const { threw, items, total } = boot({ zaeviCart: '{not valid json' });
  assert.equal(threw, null);
  assert.match(items.innerHTML, /Your bag is empty/);
  assert.equal(total.textContent, '₹0');
});

test('non-array cart value does not throw and shows the empty state', () => {
  const { threw, items } = boot({ zaeviCart: '{"id":"ZV001"}' });
  assert.equal(threw, null);
  assert.match(items.innerHTML, /Your bag is empty/);
});

test('structurally invalid rows are dropped while valid rows render', () => {
  const cart = [
    { id: 'ZV001', name: 'Aurelia Silk Dress', price: 18900, qty: 2 },
    { id: 'ZV002', name: 'No Qty' },
    { name: 'No Id', price: 100, qty: 1 },
    null,
    'garbage',
  ];
  const { threw, items, total } = boot({ zaeviCart: JSON.stringify(cart) });
  assert.equal(threw, null);
  assert.match(items.innerHTML, /Aurelia Silk Dress/);
  assert.doesNotMatch(items.innerHTML, /No Qty/);
  assert.doesNotMatch(items.innerHTML, /No Id/);
  assert.equal(total.textContent, '₹' + (18900 * 2).toLocaleString('en-IN'));
});

test('absent cart shows the empty state', () => {
  const { threw, items, total } = boot({});
  assert.equal(threw, null);
  assert.match(items.innerHTML, /Your bag is empty/);
  assert.equal(total.textContent, '₹0');
});
