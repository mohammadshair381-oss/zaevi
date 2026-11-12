import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, '..', '..', 'frontend', 'order-confirmation.html'), 'utf8');
const inline = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

const plain = (value) => JSON.parse(JSON.stringify(value));

function boot(session = {}) {
  const elements = {
    orderMessage: { textContent: '' },
    orderDetails: { textContent: '', style: { display: 'none' }, innerHTML: '' },
    orderReference: { textContent: '', style: { display: 'none' } },
  };
  const ctx = {
    document: {
      getElementById: (id) => elements[id] ?? null,
    },
    sessionStorage: {
      _s: { ...session },
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? String(this._s[k]) : null; },
      setItem(k, v) { this._s[k] = String(v); },
      removeItem(k) { delete this._s[k]; },
    },
  };
  vm.createContext(ctx);
  let threw = null;
  try { vm.runInContext(inline, ctx, 'confirmation inline'); } catch (error) { threw = error; }
  return { ctx, elements, threw };
}

function validHandoff(overrides = {}) {
  return {
    reference: 'ZV-20261013-abcdef0123456789',
    status: 'pending',
    currency: 'INR',
    totalMinor: 3780000,
    createdAt: '2026-10-13T10:30:00.000Z',
    ...overrides,
  };
}

test('confirmation inline script exists and exposes zcReadOrder', () => {
  const { ctx, threw } = boot();
  assert.equal(threw, null);
  assert.equal(typeof ctx.zcReadOrder, 'function');
});

test('no handoff shows neutral no-order message', () => {
  const { elements, threw } = boot({});
  assert.equal(threw, null);
  assert.match(elements.orderMessage.textContent, /No order found/);
  assert.equal(elements.orderDetails.style.display, 'none');
  assert.equal(elements.orderReference.style.display, 'none');
});

test('malformed handoff JSON shows neutral state and does not throw', () => {
  const { elements, threw } = boot({ zaeviOrder: '{nope' });
  assert.equal(threw, null);
  assert.match(elements.orderMessage.textContent, /No order found/);
});

test('non-object handoff is ignored', () => {
  for (const raw of ['42', '"str"', '[]', 'true', 'null']) {
    const { elements, threw } = boot({ zaeviOrder: raw });
    assert.equal(threw, null, `handoff ${raw}`);
    assert.match(elements.orderMessage.textContent, /No order found/, `handoff ${raw}`);
  }
});

test('handoff missing reference is rejected', () => {
  const { elements, threw } = boot({ zaeviOrder: JSON.stringify({ totalMinor: 123 }) });
  assert.equal(threw, null);
  assert.match(elements.orderMessage.textContent, /No order found/);
});

test('handoff with invalid reference format is rejected', () => {
  const bad = validHandoff({ reference: 'INVALID-REF' });
  const { elements, threw } = boot({ zaeviOrder: JSON.stringify(bad) });
  assert.equal(threw, null);
  assert.match(elements.orderMessage.textContent, /No order found/);
});

test('handoff with invalid status is rejected', () => {
  const bad = validHandoff({ status: 'paid' });
  const { elements, threw } = boot({ zaeviOrder: JSON.stringify(bad) });
  assert.equal(threw, null);
  assert.match(elements.orderMessage.textContent, /No order found/);
});

test('handoff with invalid currency is rejected', () => {
  const bad = validHandoff({ currency: 'USD' });
  const { elements, threw } = boot({ zaeviOrder: JSON.stringify(bad) });
  assert.equal(threw, null);
  assert.match(elements.orderMessage.textContent, /No order found/);
});

test('handoff with negative totalMinor is rejected', () => {
  const bad = validHandoff({ totalMinor: -100 });
  const { elements, threw } = boot({ zaeviOrder: JSON.stringify(bad) });
  assert.equal(threw, null);
  assert.match(elements.orderMessage.textContent, /No order found/);
});

test('handoff with non-integer totalMinor is rejected', () => {
  const bad = validHandoff({ totalMinor: 3780000.5 });
  const { elements, threw } = boot({ zaeviOrder: JSON.stringify(bad) });
  assert.equal(threw, null);
  assert.match(elements.orderMessage.textContent, /No order found/);
});

test('handoff with invalid createdAt is rejected', () => {
  const bad = validHandoff({ createdAt: 'not-a-date' });
  const { elements, threw } = boot({ zaeviOrder: JSON.stringify(bad) });
  assert.equal(threw, null);
  assert.match(elements.orderMessage.textContent, /No order found/);
});

test('handoff missing required field is rejected', () => {
  for (const field of ['reference', 'status', 'currency', 'totalMinor', 'createdAt']) {
    const bad = validHandoff();
    delete bad[field];
    const { elements, threw } = boot({ zaeviOrder: JSON.stringify(bad) });
    assert.equal(threw, null, `missing ${field}`);
    assert.match(elements.orderMessage.textContent, /No order found/, `missing ${field}`);
  }
});

test('valid pending order handoff renders order details correctly', () => {
  const session = { zaeviOrder: JSON.stringify(validHandoff()) };
  const { elements, threw } = boot(session);
  assert.equal(threw, null);
  assert.equal(elements.orderMessage.textContent, 'Your order has been received. Our atelier will confirm it shortly.');
  assert.match(elements.orderDetails.innerHTML, /Order reference:/);
  assert.match(elements.orderDetails.innerHTML, /ZV-20261013-abcdef0123456789/);
  assert.match(elements.orderDetails.innerHTML, /Status:/);
  assert.match(elements.orderDetails.innerHTML, /Order Received/);
  assert.match(elements.orderDetails.innerHTML, /Total:/);
  assert.match(elements.orderDetails.innerHTML, /₹37,800.00/);
  assert.match(elements.orderDetails.innerHTML, /Placed on:/);
  assert.equal(elements.orderReference.textContent, 'ORDER ZV-20261013-abcdef0123456789');
  assert.equal(elements.orderDetails.style.display, 'block');
  assert.equal(elements.orderReference.style.display, 'block');
});

test('confirmation page contains no "payment received" or "paid" language', () => {
  const session = { zaeviOrder: JSON.stringify(validHandoff()) };
  const { elements, threw } = boot(session);
  assert.equal(threw, null);
  const allText = elements.orderMessage.textContent + ' ' + elements.orderDetails.innerHTML + ' ' + elements.orderReference.textContent;
  assert.doesNotMatch(allText, /payment\s+received/i);
  assert.doesNotMatch(allText, /\bpaid\b/i);
});

test('confirmation page contains no email delivery claim', () => {
  const session = { zaeviOrder: JSON.stringify(validHandoff()) };
  const { elements, threw } = boot(session);
  assert.equal(threw, null);
  const allText = elements.orderMessage.textContent + ' ' + elements.orderDetails.innerHTML + ' ' + elements.orderReference.textContent;
  assert.doesNotMatch(allText, /confirmation.*email/i);
  assert.doesNotMatch(allText, /email.*sent/i);
});

test('handoff does not contain customer PII or internal database IDs', () => {
  const session = { zaeviOrder: JSON.stringify(validHandoff()) };
  const { ctx, threw } = boot(session);
  assert.equal(threw, null);
  const handoff = ctx.zcReadOrder();
  assert.ok(handoff);
  assert.ok(!('email' in handoff));
  assert.ok(!('name' in handoff));
  assert.ok(!('phone' in handoff));
  assert.ok(!('shippingName' in handoff));
  assert.ok(!('shippingAddress' in handoff));
  assert.ok(!('customerId' in handoff));
  assert.ok(!('id' in handoff));
});

test('zcReadOrder validates all expected fields and formats', () => {
  const { ctx } = boot({ zaeviOrder: JSON.stringify(validHandoff()) });
  const order = ctx.zcReadOrder();
  assert.ok(order);
  assert.equal(order.reference, 'ZV-20261013-abcdef0123456789');
  assert.equal(order.status, 'pending');
  assert.equal(order.currency, 'INR');
  assert.equal(order.totalMinor, 3780000);
  assert.equal(order.createdAt, '2026-10-13T10:30:00.000Z');
});

test('direct visit (no handoff) shows neutral state', () => {
  const { elements, threw } = boot({});
  assert.equal(threw, null);
  assert.match(elements.orderMessage.textContent, /No order found/);
  // Neutral message should not claim an order was placed/received/confirmed
  assert.doesNotMatch(elements.orderMessage.textContent, /order.*(confirmed|received)/i);
});

test('stale handoff from previous session: valid reference format is displayed', () => {
  // Use a valid reference format (ZV-YYYYMMDD-16hex)
  const oldHandoff = validHandoff({ reference: 'ZV-20261012-abcdef0123456789', totalMinor: 10000 });
  const { elements, threw } = boot({ zaeviOrder: JSON.stringify(oldHandoff) });
  assert.equal(threw, null);
  assert.match(elements.orderDetails.innerHTML, /ZV-20261012-abcdef0123456789/);
  // The page shows whatever valid handoff exists in sessionStorage.
  // This is expected behavior — sessionStorage persists per tab.
});

test('checkout success flow: valid handoff created and displayed', () => {
  const { elements, threw } = boot({ zaeviOrder: JSON.stringify(validHandoff()) });
  assert.equal(threw, null);
  assert.equal(elements.orderMessage.textContent, 'Your order has been received. Our atelier will confirm it shortly.');
  assert.match(elements.orderDetails.innerHTML, /Order Received/);
  assert.ok(!elements.orderMessage.textContent.includes('confirmed'));
  assert.ok(!elements.orderMessage.textContent.includes('email'));
});