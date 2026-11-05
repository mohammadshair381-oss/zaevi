import test from 'node:test';
import assert from 'node:assert/strict';

// Production-on-demand catalog contract: the PUBLIC serializer exposes the
// business-controlled `available` flag and the offered sizes. It never exposes
// or consults per-size inventory. Legacy stock values (if present in a database)
// are ignored by the application.

import { serializeProduct } from '../src/routes/products.js';

function row(over = {}) {
  return {
    id: 'ZV001', name: 'Nocturne', category: 'Dresses', gender: 'women',
    price: 2509, color: 'Black', imageUrl: '', hoverImageUrl: '', description: '',
    available: true,
    sizes: [
      { id: 3, size: 'S', position: 1, stock: null },
      { id: 1, size: 'M', position: 2, stock: 4 },
      { id: 2, size: 'L', position: 3, stock: 0 },
    ],
    ...over,
  };
}

test('public serializer exposes sizes in catalog order and no stock fields', () => {
  const product = serializeProduct(row());
  assert.deepEqual(product.sizes, ['S', 'M', 'L']);
  const body = JSON.stringify(product);
  assert.ok(!body.includes('"stock"'), 'public payload must not carry stock values');
  assert.ok(!body.includes('"tracked"'), 'public payload must not carry tracking metadata');
});

test('every offered size stays selectable regardless of legacy stock values', () => {
  const product = serializeProduct(row());
  assert.deepEqual(product.sizes, ['S', 'M', 'L'], 'zero/untracked stock never hides a size');
});

test('product availability remains a separate business-controlled flag', () => {
  const available = serializeProduct(row({ available: true }));
  const unavailable = serializeProduct(row({ available: false }));
  assert.equal(available.available, true);
  assert.equal(unavailable.available, false);
  assert.deepEqual(unavailable.sizes, ['S', 'M', 'L'], 'sizes are catalog data, not availability');
});

test('sizes without stock metadata (legacy mocks / pre-migration rows) serialize unchanged', () => {
  const legacy = row({ sizes: [{ id: 1, size: 'S', position: 1 }, { id: 2, size: 'M', position: 2 }] });
  const product = serializeProduct(legacy);
  assert.deepEqual(product.sizes, ['S', 'M'], 'listing order unchanged');
});
