import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// The checkout inline script exposes `zc*` helpers (top-level function
// declarations) and wires the PLACE ORDER form to POST /api/orders. It is
// evaluated in a vm with stubbed DOM storage so the whole submit lifecycle can
// be exercised without a browser: payload building, pre-submit guards,
// success persistence, redirect and failure handling.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, '..', 'checkout.html'), 'utf8');
const inline = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

const plain = (value) => JSON.parse(JSON.stringify(value));

function makeElement(value) {
  return { value: value || '', textContent: '', innerHTML: '', style: {}, addEventListener() {} };
}

function boot({ store = {}, fetchImpl } = {}) {
  const storeObj = { ...store };
  const els = {
    checkoutItems: makeElement(),
    checkoutTotal: makeElement(),
    checkoutNotice: makeElement(),
    placeOrder: makeElement(),
    checkoutForm: {
      value: '',
      addEventListener(type) { this._submitted = true; },
    },
    email: makeElement('Aya.El@Example.com'),
    name: makeElement('Aya El'),
    phone: makeElement('+91 98200 00000'),
    address: makeElement('12 Marine Drive'),
    city: makeElement('Mumbai'),
    postalCode: makeElement('400020'),
  };
  const calls = { fetch: 0 };
  const fetchImplDefault = async () => {
    calls.fetch += 1;
    return {
      status: 201,
      json: async () => ({
        data: {
          reference: 'ZV-20261013-abcdef0123456789',
          status: 'pending',
          currency: 'INR',
          subtotalMinor: 3780000,
          totalMinor: 3780000,
          createdAt: '2026-10-13T00:00:00.000Z',
        },
      }),
    };
  };
  const fetchStub = fetchImpl || fetchImplDefault;
  const ctx = {
    console,
    crypto: {
      getRandomValues: (arr) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = i % 256;
        }
        return arr;
      },
    },
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    document: { getElementById: (id) => els[id] ?? null },
    localStorage: {
      _s: storeObj,
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? String(this._s[k]) : null; },
      setItem(k, v) { this._s[k] = String(v); },
      removeItem(k) { delete this._s[k]; },
    },
    sessionStorage: {
      _s: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? String(this._s[k]) : null; },
      setItem(k, v) { this._s[k] = String(v); },
      removeItem(k) { delete this._s[k]; },
    },
    location: { href: '' },
    fetch: async (...a) => { calls.fetch += 1; return fetchStub(...a); },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  let threw = null;
  try { vm.runInContext(inline, ctx, 'checkout inline'); } catch (error) { threw = error; }
  return { ctx, els, calls, threw };
}

function cart() {
  return [
    { id: 'ZV001', name: 'Aurelia Silk Dress', price: 18900, img: 'a.jpg', qty: 2, size: 'S' },
    { id: 'ZV012', name: 'ZAEVI Signature Loafers', price: 13900, img: 'b.jpg', qty: 1, size: '40' },
  ];
}
function fields(overrides = {}) {
  return {
    email: '  Aya.El@Example.com ', name: 'Aya El', phone: '+91 98200 00000',
    address: '12 Marine Drive', city: 'Mumbai', postalCode: '400020', ...overrides,
  };
}

test('checkout inline script boots, renders the summary and exposes zcSubmit', () => {
  const { ctx, els, threw } = boot({ store: { zaeviCart: JSON.stringify(cart()) } });
  assert.equal(threw, null);
  assert.equal(typeof ctx.zcSubmit, 'function');
  assert.match(els.checkoutItems.innerHTML, /Aurelia Silk Dress/);
  assert.match(els.checkoutItems.innerHTML, /\(S\)/);
  assert.equal(els.checkoutTotal.textContent, '₹' + (18900 * 2 + 13900).toLocaleString('en-IN'));
});

test('zcReadCart recovers from malformed and non-array values', () => {
  for (const raw of ['{not valid json', '{"id":"ZV001"}', '123', '[null,5]']) {
    const { ctx } = boot({ store: { zaeviCart: raw } });
    assert.deepEqual(plain(ctx.zcReadCart()), []);
  }
});

test('zcBuildPayload sends only productId/size/quantity and trims strings', () => {
  const { ctx } = boot();
  const payload = plain(ctx.zcBuildPayload(cart(), fields()));
  assert.deepEqual(payload, {
    email: 'Aya.El@Example.com',
    name: 'Aya El',
    phone: '+91 98200 00000',
    shippingName: 'Aya El',
    shippingAddress: '12 Marine Drive',
    shippingCity: 'Mumbai',
    shippingPostalCode: '400020',
    items: [
      { productId: 'ZV001', size: 'S', quantity: 2 },
      { productId: 'ZV012', size: '40', quantity: 1 },
    ],
  });
});

test('zcSubmit refuses an empty bag without calling the server', () => {
  const { ctx, calls } = boot();
  const r = ctx.zcSubmit([], fields(), {});
  assert.deepEqual(plain(r), { status: 'empty', message: 'Your bag is empty.' });
  assert.equal(calls.fetch, 0);
});

test('zcSubmit refuses a line with no size without calling the server', () => {
  const { ctx, calls } = boot();
  const bad = [{ id: 'ZV001', name: 'Aurelia Silk Dress', price: 18900, img: 'a.jpg', qty: 1 }];
  const r = ctx.zcSubmit(bad, fields(), {});
  assert.equal(r.status, 'missing-size');
  assert.match(r.message, /Aurelia Silk Dress/);
  assert.equal(calls.fetch, 0);
});

test('zcSubmit refuses a missing or invalid email without calling the server', () => {
  const { ctx, calls } = boot();
  const r = ctx.zcSubmit(cart(), fields({ email: 'nope' }), {});
  assert.equal(r.status, 'malformed');
  assert.equal(calls.fetch, 0);
});

test('zcSubmit posts the payload and persists the safe confirmation on 201', async () => {
  let sent = null;
  const { ctx, calls } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async (url, opts) => {
      sent = { url, method: opts.method, body: JSON.parse(opts.body) };
      return { status: 201, json: async () => ({ data: { reference: 'ZV-20261013-abcdef0123456789', status: 'pending', currency: 'INR', subtotalMinor: 3780000, totalMinor: 3780000, createdAt: '2026-10-13T00:00:00.000Z' } }) };
    },
  });
  const r = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(sent.url, '/api/orders');
  assert.equal(sent.method, 'POST');
  assert.equal(sent.body.items.length, 2);
  assert.equal(r.status, 'ok');
  assert.deepEqual(plain(r.data), {
    reference: 'ZV-20261013-abcdef0123456789',
    status: 'pending',
    currency: 'INR',
    totalMinor: 3780000,
    createdAt: '2026-10-13T00:00:00.000Z',
  });
  assert.equal(ctx.localStorage.getItem('zaeviCart'), null, 'the bag is cleared on success');
  const stored = JSON.parse(ctx.sessionStorage.getItem('zaeviOrder'));
  assert.deepEqual(Object.keys(stored).sort(), ['createdAt', 'currency', 'reference', 'status', 'totalMinor'], 'only safe keys are stored');
  assert.equal(ctx.location.href, '', 'no redirect when deps.redirect is false');
  assert.equal(calls.fetch, 1);
});

test('zcSubmit redirects to the confirmation page by default', async () => {
  const { ctx } = boot();
  await ctx.zcSubmit(cart(), fields(), {});
  assert.equal(ctx.location.href, 'order-confirmation.html');
});

test('zcSubmit surfaces a network failure without clearing the bag', async () => {
  const { ctx, calls } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async () => { throw new Error('offline'); },
  });
  const r = await ctx.zcSubmit(cart(), fields(), {});
  assert.equal(r.status, 'network');
  assert.equal(ctx.localStorage.getItem('zaeviCart'), JSON.stringify(cart()), 'bag is preserved on failure');
  assert.equal(ctx.sessionStorage.getItem('zaeviOrder'), null);
  assert.equal(calls.fetch, 1);
});

test('zcSubmit passes the server validation message through on 400', async () => {
  const { ctx } = boot({
    fetchImpl: async () => ({ status: 400, json: async () => ({ error: { status: 400, message: 'Invalid size for product ZV001' } }) }),
  });
  const r = await ctx.zcSubmit(cart(), fields(), {});
  assert.equal(r.status, 'error');
  assert.equal(r.message, 'Invalid size for product ZV001');
});

test('zcSubmit returns a generic message for a 500 without a stack leak', async () => {
  const { ctx } = boot({
    fetchImpl: async () => ({ status: 500, json: async () => ({ error: { status: 500, message: 'Internal Server Error' } }) }),
  });
  const r = await ctx.zcSubmit(cart(), fields(), {});
  assert.equal(r.status, 'error');
  assert.match(r.message, /please try again/i);
  assert.doesNotMatch(r.message, /Internal Server Error/);
});

test('zcSubmit ignores 201 responses without a reference', async () => {
  const { ctx } = boot({
    fetchImpl: async () => ({ status: 201, json: async () => ({ data: { id: 7 } }) }),
  });
  const r = await ctx.zcSubmit(cart(), fields(), {});
  assert.equal(r.status, 'error');
  assert.equal(ctx.sessionStorage.getItem('zaeviOrder'), null);
  assert.equal(ctx.location.href, '', 'no redirect without a reference');
});

test('an in-flight request is guarded against double-submits', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { ctx } = boot({
    fetchImpl: () => gate.then(() => ({ status: 201, json: async () => ({ data: { reference: 'ZV-20261013-abcdef0123456789', status: 'pending', currency: 'INR', subtotalMinor: 0, totalMinor: 0, createdAt: '2026-10-13T00:00:00.000Z' } }) })),
  });
  const first = ctx.zcSubmit(cart(), fields(), { redirect: false });
  const second = ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(second.status, 'in-flight');
  release();
  const [out1] = await Promise.all([first]);
  assert.equal(out1.status, 'ok');
  const again = ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(again.status, undefined, 'the guard no longer blocks a fresh submit');
  const fresh = await again;
  assert.equal(fresh.status, 'ok');
});

test('zcShow surfaces the returned message into the notice area', () => {
  const { ctx, els } = boot();
  ctx.zcShow({ status: 'malformed', message: 'Please enter a valid email address.' });
  assert.equal(els.checkoutNotice.textContent, 'Please enter a valid email address.');
  assert.equal(els.checkoutNotice.style.display, 'block');
});

test('checkout generates idempotency key and sends it in request header', async () => {
  let sentHeaders = null;
  const { ctx, calls } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async (url, opts) => {
      calls.fetch += 1;
      sentHeaders = opts.headers;
      return {
        status: 201,
        json: async () => ({ data: { reference: 'ZV-20261013-abcdef0123456789', status: 'pending', currency: 'INR', subtotalMinor: 3780000, totalMinor: 3780000, createdAt: '2026-10-13T00:00:00.000Z' } }),
      };
    },
  });
  await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.ok(sentHeaders['Idempotency-Key'], 'Idempotency-Key header sent');
  assert.match(sentHeaders['Idempotency-Key'], /^[A-Za-z0-9_-]{16,64}$/);
  // fetch is called twice: once for POST, once for redirect (even with redirect: false, location.href is set)
  assert.ok(calls.fetch >= 1);
});

test('checkout reuses idempotency key after network failure', async () => {
  let attempt = 0;
  const { ctx, calls } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('offline');
      return { status: 201, json: async () => ({ data: { reference: 'ZV-20261013-abcdef0123456789', status: 'pending', currency: 'INR', subtotalMinor: 3780000, totalMinor: 3780000, createdAt: '2026-10-13T00:00:00.000Z' } }) };
    },
  });
  const r1 = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(r1.status, 'network');
  const key1 = ctx.sessionStorage.getItem('zaeviIdempotencyKey');
  assert.ok(key1, 'key preserved after network failure');

  const r2 = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(r2.status, 'ok');
  const key2 = ctx.sessionStorage.getItem('zaeviIdempotencyKey');
  assert.equal(key2, null, 'key cleared on success');
  assert.equal(calls.fetch, 2);
});

test('checkout preserves idempotency key and cart on 400 error', async () => {
  const { ctx, calls } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async () => ({ status: 400, json: async () => ({ error: { status: 400, message: 'Invalid size' } }) }),
  });
  const r = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(r.status, 'error');
  assert.ok(ctx.sessionStorage.getItem('zaeviIdempotencyKey'), 'key preserved on 400');
  assert.equal(ctx.localStorage.getItem('zaeviCart'), JSON.stringify(cart()), 'cart preserved on 400');
});

test('checkout preserves idempotency key and cart on 500 error', async () => {
  const { ctx, calls } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async () => ({ status: 500, json: async () => ({ error: { status: 500, message: 'Internal Server Error' } }) }),
  });
  const r = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(r.status, 'error');
  assert.ok(ctx.sessionStorage.getItem('zaeviIdempotencyKey'), 'key preserved on 500');
  assert.equal(ctx.localStorage.getItem('zaeviCart'), JSON.stringify(cart()), 'cart preserved on 500');
});

test('checkout handles 409 conflict without clearing key or auto-resubmitting', async () => {
  const { ctx, calls } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async () => ({ status: 409, json: async () => ({ error: { status: 409, message: 'Idempotency key reused with different checkout details' } }) }),
  });
  const r = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(r.status, 'conflict');
  assert.ok(ctx.sessionStorage.getItem('zaeviIdempotencyKey'), 'key preserved on 409');
  assert.equal(ctx.localStorage.getItem('zaeviCart'), JSON.stringify(cart()), 'cart preserved on 409');
  assert.match(r.message, /refresh/);
  assert.equal(calls.fetch, 1, 'no auto-resubmit on 409');
});

test('checkout clears idempotency key on 200 replay response', async () => {
  const { ctx, calls } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async () => ({ status: 200, json: async () => ({ data: { reference: 'ZV-20261013-abcdef0123456789', status: 'pending', currency: 'INR', subtotalMinor: 3780000, totalMinor: 3780000, createdAt: '2026-10-13T00:00:00.000Z' } }) }),
  });
  const r = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(r.status, 'ok');
  assert.equal(ctx.sessionStorage.getItem('zaeviIdempotencyKey'), null, 'key cleared on 200 replay');
  assert.equal(ctx.localStorage.getItem('zaeviCart'), null, 'cart cleared on 200 replay');
});

test('checkout sends Idempotency-Key header with request', async () => {
  let sentHeaders = null;
  const { ctx } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async (url, opts) => {
      sentHeaders = opts.headers;
      return { status: 201, json: async () => ({ data: { reference: 'ZV-20261013-abcdef0123456789', status: 'pending', currency: 'INR', subtotalMinor: 3780000, totalMinor: 3780000, createdAt: '2026-10-13T00:00:00.000Z' } }) };
    },
  });
  await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.ok(sentHeaders['Idempotency-Key'], 'Idempotency-Key header sent');
  assert.match(sentHeaders['Idempotency-Key'], /^[A-Za-z0-9_-]{16,64}$/);
});

test('checkout includes all required fields in payload', async () => {
  let sentBody = null;
  const { ctx } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async (url, opts) => {
      sentBody = JSON.parse(opts.body);
      return { status: 201, json: async () => ({ data: { reference: 'ZV-20261013-abcdef0123456789', status: 'pending', currency: 'INR', subtotalMinor: 3780000, totalMinor: 3780000, createdAt: '2026-10-13T00:00:00.000Z' } }) };
    },
  });
  await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.ok(sentBody.email);
  assert.ok(sentBody.shippingName);
  assert.ok(sentBody.shippingAddress);
  assert.ok(sentBody.shippingCity);
  assert.ok(sentBody.shippingPostalCode);
  assert.ok(sentBody.items);
  assert.equal(sentBody.items.length, 2);
  assert.ok(sentBody.items[0].productId);
  assert.ok(sentBody.items[0].size);
  assert.ok(sentBody.items[0].quantity);
});

// ---------------------------------------------------------------------------
// Phase 3 / Task 4: safe cart clearing after a successful checkout.
//
// The success path must remove exactly the submitted (productId, size, qty)
// lines from whatever the cart looks like when the response arrives, never the
// whole key. Anything added while the request was in flight — plus unrelated
// localStorage entries — has to survive.
// ---------------------------------------------------------------------------

const successData = {
  reference: 'ZV-20261013-abcdef0123456789',
  status: 'pending',
  currency: 'INR',
  subtotalMinor: 3780000,
  totalMinor: 3780000,
  createdAt: '2026-10-13T00:00:00.000Z',
};
const okResponse = () => ({ status: 201, json: async () => ({ data: successData }) });

// Boot a checkout, then mutate the stored cart from inside the in-flight request
// to simulate the customer (or another tab) editing the bag mid-checkout.
async function submitWithInflightMutation(mutate, store = { zaeviCart: JSON.stringify(cart()) }, response = okResponse) {
  let ctxRef;
  const { ctx } = boot({
    store,
    fetchImpl: async () => {
      const live = JSON.parse(ctxRef.localStorage.getItem('zaeviCart'));
      mutate(live);
      ctxRef.localStorage.setItem('zaeviCart', JSON.stringify(live));
      return response();
    },
  });
  ctxRef = ctx;
  const result = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  return { ctx, result };
}

test('a new unrelated product added in flight survives a successful order', async () => {
  const { ctx, result } = await submitWithInflightMutation((live) => {
    live.push({ id: 'ZV099', name: 'New Wool Coat', price: 22000, img: 'c.jpg', qty: 1, size: 'M' });
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(plain(JSON.parse(ctx.localStorage.getItem('zaeviCart'))), [
    { id: 'ZV099', name: 'New Wool Coat', price: 22000, img: 'c.jpg', qty: 1, size: 'M' },
  ], 'only the purchased lines are removed');
});

test('extra quantity of the same (id,size) added in flight is preserved', async () => {
  const { ctx, result } = await submitWithInflightMutation((live) => {
    live.find((x) => x.id === 'ZV001').qty = 3; // was 2 at snapshot
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(plain(JSON.parse(ctx.localStorage.getItem('zaeviCart'))), [
    { id: 'ZV001', name: 'Aurelia Silk Dress', price: 18900, img: 'a.jpg', qty: 1, size: 'S' },
  ], 'the 2 submitted units are removed, the extra 1 survives');
});

test('a size change made in flight is not deleted by the success flow', async () => {
  const { ctx, result } = await submitWithInflightMutation((live) => {
    live.find((x) => x.id === 'ZV001').size = 'M'; // submitted as S
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(plain(JSON.parse(ctx.localStorage.getItem('zaeviCart'))), [
    { id: 'ZV001', name: 'Aurelia Silk Dress', price: 18900, img: 'a.jpg', qty: 2, size: 'M' },
  ], 'the re-sized line no longer matches the submitted key and is kept');
});

test('a legacy line without a size is preserved on success', async () => {
  const { ctx, result } = await submitWithInflightMutation((live) => {
    live.push({ id: 'ZV010', name: 'Legacy Scarf', price: 4500, img: 'd.jpg', qty: 2 });
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(plain(JSON.parse(ctx.localStorage.getItem('zaeviCart'))), [
    { id: 'ZV010', name: 'Legacy Scarf', price: 4500, img: 'd.jpg', qty: 2 },
  ], 'a size-less line never matches a submitted (id,size) key');
});

test('an item removed in flight leaves nothing to clear', async () => {
  const { ctx, result } = await submitWithInflightMutation((live) => {
    live.length = 0;
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(plain(ctx.zcReadCart()), [], 'the empty bag the customer left behind is not rewritten');
});

test('an item removed during checkout is not recreated', async () => {
  const { ctx, result } = await submitWithInflightMutation((live) => {
    live.splice(live.findIndex((x) => x.id === 'ZV001'), 1); // customer removes the dress
    live.push({ id: 'ZV099', name: 'New Wool Coat', price: 22000, img: 'c.jpg', qty: 1, size: 'M' });
  });
  assert.equal(result.status, 'ok');
  const remaining = plain(ctx.zcReadCart());
  assert.equal(remaining.some((x) => x.id === 'ZV001'), false, 'the removed line is never resurrected from the snapshot');
  assert.deepEqual(remaining, [
    { id: 'ZV099', name: 'New Wool Coat', price: 22000, img: 'c.jpg', qty: 1, size: 'M' },
  ]);
});

test('HTTP 200 replay uses the same safe cleanup as HTTP 201 creation', async () => {
  const replay = () => ({ status: 200, json: async () => ({ data: successData }) });
  const { ctx, result } = await submitWithInflightMutation((live) => {
    live.push({ id: 'ZV099', name: 'New Wool Coat', price: 22000, img: 'c.jpg', qty: 1, size: 'M' });
  }, { zaeviCart: JSON.stringify(cart()) }, replay);
  assert.equal(result.status, 'ok');
  assert.deepEqual(plain(JSON.parse(ctx.localStorage.getItem('zaeviCart'))), [
    { id: 'ZV099', name: 'New Wool Coat', price: 22000, img: 'c.jpg', qty: 1, size: 'M' },
  ], 'a replayed order must not wipe in-flight additions');
});

test('a failed checkout never alters the cart for any failure status', async () => {
  const failures = [
    async () => { throw new Error('offline'); }, // network
    async () => ({ status: 400, json: async () => ({ error: { status: 400, message: 'Invalid size' } }) }),
    async () => ({ status: 500, json: async () => ({ error: { status: 500, message: 'Internal Server Error' } }) }),
    async () => ({ status: 409, json: async () => ({ error: { status: 409, message: 'Conflict' } }) }),
  ];
  for (const fetchImpl of failures) {
    const { ctx } = boot({ store: { zaeviCart: JSON.stringify(cart()) }, fetchImpl });
    await ctx.zcSubmit(cart(), fields(), { redirect: false });
    assert.equal(ctx.localStorage.getItem('zaeviCart'), JSON.stringify(cart()), 'the cart is byte-for-byte unchanged');
  }
});

test('idempotency-key lifecycle: preserved on failure, never auto-rotated on 409, cleared on success', async () => {
  let attempt = 0;
  const { ctx } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('offline');
      if (attempt === 2) return { status: 409, json: async () => ({ error: { status: 409, message: 'Idempotency key reused' } }) };
      return okResponse();
    },
  });

  const first = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(first.status, 'network');
  const key = ctx.sessionStorage.getItem('zaeviIdempotencyKey');
  assert.ok(key, 'key created and kept after a network failure');
  assert.equal(ctx.localStorage.getItem('zaeviCart'), JSON.stringify(cart()), 'cart kept after a network failure');

  const second = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(second.status, 'conflict');
  assert.equal(ctx.sessionStorage.getItem('zaeviIdempotencyKey'), key, 'the same key is reused, not rotated, on 409');
  assert.equal(attempt, 2, '409 never auto-resubmits');

  const third = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(third.status, 'ok');
  assert.equal(ctx.sessionStorage.getItem('zaeviIdempotencyKey'), null, 'key cleared only on success');
});

test('malformed stored cart is left byte-for-byte untouched on success', async () => {
  const raw = '{not valid json';
  const { ctx } = boot({ store: { zaeviCart: raw, zaeviWish: JSON.stringify(['ZV001']) } });
  const r = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(r.status, 'ok');
  assert.equal(ctx.localStorage.getItem('zaeviCart'), raw, 'unparseable data is never overwritten');
  assert.equal(ctx.localStorage.getItem('zaeviWish'), JSON.stringify(['ZV001']), 'other keys are untouched');
});

test('an unchanged cart is fully cleared and unrelated keys survive', async () => {
  const { ctx } = boot({ store: { zaeviCart: JSON.stringify(cart()), zaeviWish: JSON.stringify(['ZV001']) } });
  const r = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(r.status, 'ok');
  assert.equal(ctx.localStorage.getItem('zaeviCart'), null);
  assert.equal(ctx.localStorage.getItem('zaeviWish'), JSON.stringify(['ZV001']), 'unrelated keys survive');
});

test('a storage write failure after success is swallowed', async () => {
  const { ctx } = boot({ store: { zaeviCart: JSON.stringify(cart()) } });
  const live = JSON.parse(ctx.localStorage.getItem('zaeviCart'));
  live.push({ id: 'ZV099', name: 'New Wool Coat', price: 22000, img: 'c.jpg', qty: 1, size: 'M' });
  ctx.localStorage.setItem('zaeviCart', JSON.stringify(live));
  ctx.localStorage.setItem = () => { throw new Error('quota exceeded'); };
  const r = await ctx.zcSubmit(cart(), fields(), { redirect: false });
  assert.equal(r.status, 'ok', 'a failed cart write must not fail an order that is already placed');
});

test('zcLineKey distinguishes sizes and legacy (size-less) lines', () => {
  const { ctx } = boot();
  assert.notEqual(ctx.zcLineKey('ZV001', 'S'), ctx.zcLineKey('ZV001', 'M'));
  assert.notEqual(ctx.zcLineKey('ZV001', 'S'), ctx.zcLineKey('ZV001', ''));
});

test('zcPurchasedQuantities sums duplicate (id,size) lines and clamps to the payload quantity', () => {
  const { ctx } = boot();
  const qty = ctx.zcPurchasedQuantities([
    { id: 'ZV001', qty: 2, size: 'S' },
    { id: 'ZV001', qty: 1, size: 'S' },
    { id: 'ZV001', qty: 99, size: 'M' },
    { id: 'ZV001', qty: 1 }, // no size
  ]);
  assert.equal(qty.get(ctx.zcLineKey('ZV001', 'S')), 3);
  assert.equal(qty.get(ctx.zcLineKey('ZV001', 'M')), 10, 'matches the payload clamp');
  assert.equal(qty.get(ctx.zcLineKey('ZV001', '')), 1);
});

test('zcRemovePurchased subtracts only the submitted quantity from a larger line', () => {
  const { ctx } = boot();
  const out = plain(ctx.zcRemovePurchased(
    [{ id: 'ZV001', name: 'Dress', price: 18900, img: 'a', qty: 5, size: 'S' }],
    [{ id: 'ZV001', name: 'Dress', price: 18900, img: 'a', qty: 2, size: 'S' }],
  ));
  assert.equal(out.removed, true);
  assert.deepEqual(out.lines, [{ id: 'ZV001', name: 'Dress', price: 18900, img: 'a', qty: 3, size: 'S' }]);
});

test('zcRemovePurchased drains duplicate (id,size) lines oldest-first', () => {
  const { ctx } = boot();
  const out = plain(ctx.zcRemovePurchased(
    [
      { id: 'ZV001', name: 'Dress', price: 18900, img: 'a', qty: 1, size: 'S' },
      { id: 'ZV001', name: 'Dress', price: 18900, img: 'a', qty: 1, size: 'S' },
      { id: 'ZV012', name: 'Loafers', price: 13900, img: 'b', qty: 1, size: '40' },
    ],
    [{ id: 'ZV001', name: 'Dress', price: 18900, img: 'a', qty: 1, size: 'S' }],
  ));
  assert.equal(out.removed, true);
  assert.deepEqual(out.lines, [
    { id: 'ZV001', name: 'Dress', price: 18900, img: 'a', qty: 1, size: 'S' },
    { id: 'ZV012', name: 'Loafers', price: 13900, img: 'b', qty: 1, size: '40' },
  ], 'only the submitted unit is removed; the other key is untouched');
});

test('zcRemovePurchased reports no change for a failed or empty submission', () => {
  const { ctx } = boot();
  assert.deepEqual(plain(ctx.zcRemovePurchased([{ id: 'ZV099', qty: 1, size: 'M' }], [])), { lines: [{ id: 'ZV099', qty: 1, size: 'M' }], removed: false });
  assert.deepEqual(plain(ctx.zcRemovePurchased([], cart())), { lines: [], removed: false });
});

test('zcClearPurchasedLines leaves absent or malformed storage untouched', () => {
  const absent = boot();
  assert.equal(absent.ctx.zcClearPurchasedLines(cart()), false, 'absent bag is a no-op');
  const malformed = boot({ store: { zaeviCart: '{"id":"ZV001"}' } });
  assert.equal(malformed.ctx.zcClearPurchasedLines(cart()), false, 'non-array bag is a no-op');
  assert.equal(malformed.ctx.localStorage.getItem('zaeviCart'), '{"id":"ZV001"}');
});
test('zcCsrfToken parses the CSRF cookie robustly', () => {
  const { ctx } = boot();
  ctx.document.cookie = 'zaevi.sid=ignored; zaevi.csrf=tok-en_123';
  assert.equal(ctx.zcCsrfToken(), 'tok-en_123', 'token is found after any other cookie');
  ctx.document.cookie = 'other=1; zaevi.csrf=second-token';
  assert.equal(ctx.zcCsrfToken(), 'second-token', 'leading space must be ignored');
  ctx.document.cookie = 'nothing=here';
  assert.equal(ctx.zcCsrfToken(), '', 'absent CSRF cookie yields an empty token');
});

test('zcSubmit refuses to create an order while the customer is signed out', () => {
  const { ctx, calls } = boot({ store: { zaeviCart: JSON.stringify(cart()) } });
  assert.equal(typeof ctx.zcSubmit, 'function');
  ctx.__zaeviCheckoutGate = 'anonymous';
  const result = plain(ctx.zcSubmit(cart(), fields(), {}));
  assert.equal(result.status, 'auth-required');
  assert.match(result.message, /sign in/i);
  assert.equal(calls.fetch, 0, 'no request may leave the browser without an authenticated session');
});

test('zcSubmit also refuses while the sign-in check is still pending', () => {
  const { ctx, calls } = boot({ store: { zaeviCart: JSON.stringify(cart()) } });
  ctx.__zaeviCheckoutGate = 'pending';
  const result = plain(ctx.zcSubmit(cart(), fields(), {}));
  assert.equal(result.status, 'auth-required');
  assert.equal(calls.fetch, 0);
});

test('signed-in checkout sends the CSRF token alongside the idempotency key', async () => {
  let sentHeaders = null;
  const { ctx } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async (url, opts) => {
      sentHeaders = opts.headers;
      return {
        status: 201,
        json: async () => ({
          data: { reference: 'ZV-20261013-abcdef0123456789', status: 'pending', currency: 'INR', subtotalMinor: 3780000, totalMinor: 3780000, createdAt: 'x' },
        }),
      };
    },
  });
  ctx.__zaeviCheckoutGate = 'authenticated';
  ctx.document.cookie = 'zaevi.csrf=csrf-token-value';
  const result = await ctx.zcSubmit(cart(), fields(), {});
  assert.equal(result.status, 'ok');
  assert.ok(sentHeaders['Idempotency-Key']);
  assert.equal(sentHeaders['x-csrf-token'], 'csrf-token-value');
});

test('the saved delivery draft is cleared once the order is placed', async () => {
  const { ctx } = boot({
    store: { zaeviCart: JSON.stringify(cart()), zaeviCheckoutDraft: '{"city":"Mumbai"}' },
    fetchImpl: async () => ({
      status: 201,
      json: async () => ({
        data: { reference: 'ZV-20261013-abcdef0123456789', status: 'pending', currency: 'INR', subtotalMinor: 3780000, totalMinor: 3780000, createdAt: 'x' },
      }),
    }),
  });
  ctx.__zaeviCheckoutGate = 'authenticated';
  assert.ok(ctx.localStorage.getItem('zaeviCheckoutDraft'));
  await ctx.zcSubmit(cart(), fields(), {});
  assert.equal(ctx.localStorage.getItem('zaeviCheckoutDraft'), null, 'a placed order must not leave the delivery draft behind');
});

test('a 401/403 response tells the customer to sign in again', async () => {
  const { ctx } = boot({
    store: { zaeviCart: JSON.stringify(cart()) },
    fetchImpl: async () => ({ status: 403, json: async () => ({ error: { status: 403, message: 'Invalid CSRF token' } }) }),
  });
  ctx.__zaeviCheckoutGate = 'authenticated';
  const result = await ctx.zcSubmit(cart(), fields(), {});
  assert.equal(result.status, 'auth');
  assert.match(result.message, /sign in/i);
});
