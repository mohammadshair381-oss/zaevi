import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_ITEMS,
  MAX_QUANTITY_PER_ITEM,
  parseOrderRequest,
  parseIdempotencyKey,
  buildCanonicalPayload,
  hashCanonicalPayload,
  buildOrderLines,
  generateOrderReference,
  serializeOrder,
} from '../src/models/order.js';

// Pure tests: no database, no HTTP. Product rows are supplied directly so the
// validation rules and integer-paise arithmetic can be asserted exactly.

function catalog() {
  return [
    {
      id: 'ZV001',
      name: 'Aurelia Silk Dress',
      price: 18900,
      available: true,
      sizes: [{ size: 'XS' }, { size: 'S' }, { size: 'M' }, { size: 'L' }],
    },
    {
      id: 'ZV012',
      name: 'ZAEVI Signature Loafers',
      price: 13900,
      available: true,
      sizes: [{ size: '39' }, { size: '40' }],
    },
    {
      id: 'ZV099',
      name: 'Sold Out Coat',
      price: 5000,
      available: false,
      sizes: [{ size: 'M' }],
    },
  ];
}

function validBody(overrides = {}) {
  return {
    email: '  Aya.El@Example.COM ',
    shippingName: 'Aya El',
    shippingAddress: '12 Marine Drive',
    shippingCity: 'Mumbai',
    shippingPostalCode: '400020',
    items: [{ productId: 'ZV001', size: 'S', quantity: 2 }],
    ...overrides,
  };
}

test('parseOrderRequest normalizes email and country and trims text', () => {
  const draft = parseOrderRequest(validBody({ shippingCountry: 'in' }));

  assert.equal(draft.email, 'aya.el@example.com');
  assert.equal(draft.name, null);
  assert.equal(draft.phone, null);
  assert.deepEqual(draft.shipping, {
    name: 'Aya El',
    address: '12 Marine Drive',
    city: 'Mumbai',
    postalCode: '400020',
    country: 'IN',
  });
  assert.deepEqual(draft.items, [{ productId: 'ZV001', size: 'S', quantity: 2 }]);
});

test('parseOrderRequest keeps optional name and phone when provided', () => {
  const draft = parseOrderRequest(validBody({ name: ' Aya El ', phone: ' +91 98200 00000 ' }));
  assert.equal(draft.name, 'Aya El');
  assert.equal(draft.phone, '+91 98200 00000');
});

test('parseOrderRequest rejects non-object and empty bodies', () => {
  for (const body of [undefined, null, 42, 'x', [], true]) {
    assert.throws(() => parseOrderRequest(body), { status: 400 });
  }
});

test('parseOrderRequest rejects invalid or missing emails', () => {
  const bad = ['not-an-email', 'a@b', '', '   ', '@x.com', 'x@.com', 123, null, undefined];
  for (const email of bad) {
    assert.throws(() => parseOrderRequest(validBody({ email })), { status: 400 }, `email ${JSON.stringify(email)}`);
  }
  assert.throws(
    () => parseOrderRequest(validBody({ email: `${'a'.repeat(250)}@example.com` })),
    { status: 400 }
  );
});

test('parseOrderRequest requires every shipping field', () => {
  for (const field of ['shippingName', 'shippingAddress', 'shippingCity', 'shippingPostalCode']) {
    assert.throws(() => parseOrderRequest(validBody({ [field]: undefined })), { status: 400 }, field);
    assert.throws(() => parseOrderRequest(validBody({ [field]: '   ' })), { status: 400 }, field);
  }
});

test('parseOrderRequest validates the country code', () => {
  assert.equal(parseOrderRequest(validBody({ shippingCountry: undefined })).shipping.country, 'IN');
  assert.equal(parseOrderRequest(validBody({ shippingCountry: 'gb' })).shipping.country, 'GB');
  assert.throws(() => parseOrderRequest(validBody({ shippingCountry: 'IND' })), { status: 400 });
  assert.throws(() => parseOrderRequest(validBody({ shippingCountry: '1N' })), { status: 400 });
});

test('parseOrderRequest rejects empty, oversized and malformed carts', () => {
  assert.throws(() => parseOrderRequest(validBody({ items: [] })), { status: 400 });
  assert.throws(() => parseOrderRequest(validBody({ items: 'nope' })), { status: 400 });
  assert.throws(() => parseOrderRequest(validBody({ items: {} })), { status: 400 });

  const tooMany = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => ({
    productId: `Z${i}`,
    size: 'S',
    quantity: 1,
  }));
  assert.throws(() => parseOrderRequest(validBody({ items: tooMany })), { status: 400 });

  assert.throws(() => parseOrderRequest(validBody({ items: [null] })), { status: 400 });
  assert.throws(() => parseOrderRequest(validBody({ items: [{ size: 'S', quantity: 1 }] })), { status: 400 });
  assert.throws(() => parseOrderRequest(validBody({ items: [{ productId: 'ZV001', quantity: 1 }] })), { status: 400 });
  assert.throws(() => parseOrderRequest(validBody({ items: [{ productId: 'ZV001', size: '  ', quantity: 1 }] })), { status: 400 });
});

test('parseOrderRequest rejects bad quantities', () => {
  const bad = [0, -1, 1.5, '2', null, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
  for (const quantity of bad) {
    assert.throws(
      () => parseOrderRequest(validBody({ items: [{ productId: 'ZV001', size: 'S', quantity }] })),
      { status: 400 },
      `quantity ${String(quantity)}`
    );
  }
  assert.throws(
    () => parseOrderRequest(validBody({ items: [{ productId: 'ZV001', size: 'S', quantity: MAX_QUANTITY_PER_ITEM + 1 }] })),
    { status: 400 }
  );
});

test('parseOrderRequest rejects duplicate product-and-size lines', () => {
  assert.throws(
    () =>
      parseOrderRequest(
        validBody({
          items: [
            { productId: 'ZV001', size: 'S', quantity: 1 },
            { productId: 'ZV001', size: 'S', quantity: 3 },
          ],
        })
      ),
    { status: 400 }
  );
  // Same product with different sizes is allowed.
  const draft = parseOrderRequest(
    validBody({
      items: [
        { productId: 'ZV001', size: 'S', quantity: 1 },
        { productId: 'ZV001', size: 'M', quantity: 1 },
      ],
    })
  );
  assert.equal(draft.items.length, 2);
});

test('buildOrderLines prices from the catalog in integer paise (not the client)', () => {
  const { lines, subtotalMinor, totalMinor } = buildOrderLines(catalog(), [
    { productId: 'ZV001', size: 'S', quantity: 2 },
    { productId: 'ZV012', size: '39', quantity: 1 },
  ]);

  assert.equal(lines[0].unitPriceMinor, 1890000); // 18900 rupees -> paise
  assert.equal(lines[0].lineTotalMinor, 3780000);
  assert.equal(lines[0].productName, 'Aurelia Silk Dress');
  assert.equal(lines[0].productSku, 'ZV001');

  assert.equal(lines[1].unitPriceMinor, 1390000);
  assert.equal(lines[1].lineTotalMinor, 1390000);

  assert.equal(subtotalMinor, 5170000);
  assert.equal(totalMinor, subtotalMinor);
});

test('buildOrderLines rejects unknown, unavailable products and invalid sizes', () => {
  assert.throws(() => buildOrderLines(catalog(), [{ productId: 'ZZ999', size: 'S', quantity: 1 }]), { status: 400 });
  assert.throws(() => buildOrderLines(catalog(), [{ productId: 'ZV099', size: 'M', quantity: 1 }]), { status: 400 });
  assert.throws(() => buildOrderLines(catalog(), [{ productId: 'ZV001', size: 'XXL', quantity: 1 }]), { status: 400 });
});

test('generateOrderReference is well-formed, bounded and effectively unique', () => {
  const now = new Date(Date.UTC(2026, 9, 13, 5, 6, 7));
  const deterministic = generateOrderReference(now, () => Buffer.from('0011223344556677', 'hex'));
  assert.equal(deterministic, 'ZV-20261013-0011223344556677');
  assert.ok(deterministic.length <= 32);

  const seen = new Set();
  for (let i = 0; i < 10000; i += 1) {
    const reference = generateOrderReference();
    assert.match(reference, /^ZV-\d{8}-[0-9a-f]{16}$/);
    assert.ok(!seen.has(reference), 'references must not repeat');
    seen.add(reference);
  }
});

test('serializeOrder exposes only public fields (no internal ids)', () => {
  const body = serializeOrder({
    id: 42,
    customerId: 7,
    reference: 'ZV-20261013-0011223344556677',
    status: 'pending',
    currency: 'INR',
    subtotalMinor: 3780000,
    totalMinor: 3780000,
    createdAt: new Date('2026-10-13T00:00:00.000Z'),
    items: [
      {
        id: 1,
        orderId: 42,
        productId: 'ZV001',
        productSku: 'ZV001',
        productName: 'Aurelia Silk Dress',
        size: 'S',
        unitPriceMinor: 1890000,
        quantity: 2,
        lineTotalMinor: 3780000,
      },
    ],
  });

  assert.deepEqual(Object.keys(body).sort(), [
    'createdAt',
    'currency',
    'items',
    'reference',
    'status',
    'subtotalMinor',
    'totalMinor',
  ]);
  assert.equal(body.id, undefined);
  assert.equal(body.customerId, undefined);
  assert.equal(body.items[0].id, undefined);
  assert.equal(body.items[0].orderId, undefined);
});

test('parseIdempotencyKey validates presence, length and format', () => {
  assert.throws(() => parseIdempotencyKey(undefined), { status: 400 });
  assert.throws(() => parseIdempotencyKey(null), { status: 400 });
  assert.throws(() => parseIdempotencyKey(''), { status: 400 });
  assert.throws(() => parseIdempotencyKey('a'.repeat(15)), { status: 400 });
  assert.throws(() => parseIdempotencyKey('a'.repeat(65)), { status: 400 });
  assert.throws(() => parseIdempotencyKey('invalid@key'), { status: 400 });
  assert.throws(() => parseIdempotencyKey('invalid key'), { status: 400 });

  const valid = 'a'.repeat(16);
  assert.equal(parseIdempotencyKey(valid), valid);
  assert.equal(parseIdempotencyKey(' ' + valid + ' '), valid);
  assert.equal(parseIdempotencyKey('a-b_c'.repeat(8)), 'a-b_c'.repeat(8));
});

function validDraft(overrides = {}) {
  return {
    email: 'aya.el@example.com',
    name: 'Aya El',
    phone: '+91 98200 00000',
    shipping: {
      name: 'Aya El',
      address: '12 Marine Drive',
      city: 'Mumbai',
      postalCode: '400020',
      country: 'IN',
    },
    items: [{ productId: 'ZV001', size: 'S', quantity: 2 }],
    ...overrides,
  };
}

test('buildCanonicalPayload produces deterministic output with sorted items', () => {
  const draft = validDraft({
    items: [
      { productId: 'ZV012', size: '40', quantity: 1 },
      { productId: 'ZV001', size: 'S', quantity: 2 },
    ],
  });
  const payload = buildCanonicalPayload(draft);
  assert.deepEqual(payload.items, [
    { productId: 'ZV001', size: 'S', quantity: 2 },
    { productId: 'ZV012', size: '40', quantity: 1 },
  ]);
  assert.equal(payload.email, 'aya.el@example.com');
  assert.equal(payload.shipping.country, 'IN');
});

test('buildCanonicalPayload includes all material fields and excludes prices', () => {
  const draft = validDraft({
    name: 'Aya El',
    phone: '+91 98200 00000',
    items: [{ productId: 'ZV001', size: 'S', quantity: 2 }],
  });
  const payload = buildCanonicalPayload(draft);
  assert.ok('email' in payload);
  assert.ok('name' in payload);
  assert.ok('phone' in payload);
  assert.ok('shipping' in payload);
  assert.ok('items' in payload);
  assert.equal(payload.items[0].productId, 'ZV001');
  assert.equal(payload.items[0].size, 'S');
  assert.equal(payload.items[0].quantity, 2);
  assert.ok(!('price' in payload.items[0]));
  assert.ok(!('unitPriceMinor' in payload.items[0]));
});

test('hashCanonicalPayload produces consistent SHA-256 hex output', () => {
  const payload = { test: 'value', num: 42 };
  const h1 = hashCanonicalPayload(payload);
  const h2 = hashCanonicalPayload(payload);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('hashCanonicalPayload differs for different payloads', () => {
  const base = buildCanonicalPayload(validDraft());
  const h1 = hashCanonicalPayload(base);
  const h2 = hashCanonicalPayload(buildCanonicalPayload(validDraft({ email: 'other@example.com' })));
  assert.notEqual(h1, h2);
});

test('equivalent item ordering produces same hash', () => {
  const draft1 = validDraft({
    items: [
      { productId: 'ZV012', size: '40', quantity: 1 },
      { productId: 'ZV001', size: 'S', quantity: 2 },
    ],
  });
  const draft2 = validDraft({
    items: [
      { productId: 'ZV001', size: 'S', quantity: 2 },
      { productId: 'ZV012', size: '40', quantity: 1 },
    ],
  });
  assert.equal(hashCanonicalPayload(buildCanonicalPayload(draft1)), hashCanonicalPayload(buildCanonicalPayload(draft2)));
});

test('different quantity or size produces different hash', () => {
  const base = hashCanonicalPayload(buildCanonicalPayload(validDraft()));
  assert.notEqual(base, hashCanonicalPayload(buildCanonicalPayload(validDraft({ items: [{ productId: 'ZV001', size: 'S', quantity: 3 }] }))));
  assert.notEqual(base, hashCanonicalPayload(buildCanonicalPayload(validDraft({ items: [{ productId: 'ZV001', size: 'M', quantity: 2 }] }))));
  assert.notEqual(base, hashCanonicalPayload(buildCanonicalPayload(validDraft({ items: [{ productId: 'ZV002', size: 'S', quantity: 2 }] }))));
});

test('parseIdempotencyKey and buildCanonicalPayload integration', () => {
  const key = 'valid-idempotency-key-1234567890123456';
  assert.equal(parseIdempotencyKey(key), key);
  const draft = validDraft();
  const payload = buildCanonicalPayload(draft);
  const hash = hashCanonicalPayload(payload);
  assert.match(hash, /^[0-9a-f]{64}$/);
});
