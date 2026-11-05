import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeProduct,
  normalizeProducts,
  ProductValidationError,
  PRODUCT_GENDERS,
} from '../src/models/product.js';

// Mock/unit tests: these validate catalog data in memory only. They never
// import database and never touch a database.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTS_PATH = path.join(__dirname, '..', 'products.json');
const rawProducts = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8'));

function findRaw(id) {
  return rawProducts.find((p) => p.id === id);
}

test('all catalog entries normalize without error', () => {
  const normalized = normalizeProducts(rawProducts);
  assert.equal(normalized.length, rawProducts.length);
  assert.equal(normalized.length, 12);
});

test('existing product IDs are preserved verbatim and are unique', () => {
  const normalized = normalizeProducts(rawProducts);
  const ids = normalized.map((p) => p.id);
  assert.deepEqual(ids, rawProducts.map((p) => p.id));
  assert.deepEqual(ids, ['ZV001', 'ZV002', 'ZV003', 'ZV004', 'ZV005', 'ZV006', 'ZV007', 'ZV008', 'ZV009', 'ZV010', 'ZV011', 'ZV012']);
  assert.equal(new Set(ids).size, ids.length);
});

test('names, categories, gender, color and description are preserved', () => {
  for (const raw of rawProducts) {
    const p = normalizeProduct(raw);
    assert.equal(p.name, raw.name, `name for ${raw.id}`);
    assert.equal(p.category, raw.cat, `category for ${raw.id}`);
    assert.equal(p.gender, raw.gender, `gender for ${raw.id}`);
    assert.equal(p.color, raw.color, `color for ${raw.id}`);
    assert.equal(p.description, raw.desc, `description for ${raw.id}`);
  }
  // Accented characters survive normalization (utf8mb4 safe).
  assert.equal(normalizeProduct(findRaw('ZV003')).name, 'Élan Sculpted Blazer');
});

test('prices remain integers (whole rupees) and match the source exactly', () => {
  for (const raw of rawProducts) {
    const p = normalizeProduct(raw);
    assert.equal(p.price, raw.price, `price for ${raw.id}`);
    assert.ok(Number.isInteger(p.price), `price for ${raw.id} must be an integer`);
    assert.ok(p.price >= 0);
  }
  assert.equal(normalizeProduct(findRaw('ZV001')).price, 18900);
});

test('main and hover image paths are preserved', () => {
  for (const raw of rawProducts) {
    const p = normalizeProduct(raw);
    assert.equal(p.imageUrl, raw.img, `img for ${raw.id}`);
    assert.equal(p.hoverImageUrl, raw.hover, `hover for ${raw.id}`);
  }
});

test('sizes are preserved in original order with sequential positions', () => {
  for (const raw of rawProducts) {
    const p = normalizeProduct(raw);
    assert.deepEqual(
      p.sizes.map((s) => s.size),
      raw.sizes,
      `size order for ${raw.id}`
    );
    assert.deepEqual(
      p.sizes.map((s) => s.position),
      raw.sizes.map((_, i) => i),
      `positions for ${raw.id}`
    );
  }
  assert.deepEqual(
    normalizeProduct(findRaw('ZV012')).sizes.map((s) => s.size),
    ['39', '40', '41', '42', '43', '44']
  );
});

test('every catalog gender is one of the supported values', () => {
  for (const raw of rawProducts) {
    assert.ok(PRODUCT_GENDERS.includes(raw.gender), `${raw.gender} must be supported`);
  }
});

test('new products default to available without inventing stock', () => {
  const p = normalizeProduct(findRaw('ZV001'));
  assert.equal(p.available, true);
  assert.equal(p.stock, undefined);
});

test('non-integer prices are rejected (no floating-point money)', () => {
  for (const bad of [189.5, '18900', null, NaN, Infinity]) {
    assert.throws(
      () => normalizeProduct({ ...findRaw('ZV001'), price: bad }),
      ProductValidationError,
      `price ${String(bad)} must be rejected`
    );
  }
});

test('negative prices are rejected', () => {
  assert.throws(() => normalizeProduct({ ...findRaw('ZV001'), price: -1 }), /price must be zero or greater/);
});

test('missing required fields are rejected', () => {
  for (const field of ['id', 'name', 'cat', 'gender', 'color', 'img', 'hover', 'desc']) {
    const raw = { ...findRaw('ZV001') };
    delete raw[field];
    assert.throws(() => normalizeProduct(raw), /must be a non-empty string/, `missing ${field}`);
  }
});

test('invalid sizes are rejected', () => {
  const base = findRaw('ZV001');
  assert.throws(() => normalizeProduct({ ...base, sizes: [] }), /sizes must be a non-empty array/);
  assert.throws(() => normalizeProduct({ ...base, sizes: 'M' }), /sizes must be a non-empty array/);
  assert.throws(() => normalizeProduct({ ...base, sizes: ['M', 'M'] }), /duplicate value "M"/);
  assert.throws(() => normalizeProduct({ ...base, sizes: ['M', ''] }), /sizes\[1\] must be a non-empty string/);
});

test('unsupported genders are rejected', () => {
  assert.throws(
    () => normalizeProduct({ ...findRaw('ZV001'), gender: 'Kids' }),
    /gender must be one of/
  );
});

test('non-object entries are rejected', () => {
  for (const bad of [null, 'x', 42, []]) {
    assert.throws(() => normalizeProduct(bad), /product must be an object/);
  }
  assert.throws(() => normalizeProducts('nope'), /products must be an array/);
});
