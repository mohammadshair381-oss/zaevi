import test from 'node:test';
import assert from 'node:assert/strict';

import { PAISE_PER_RUPEE, rupeesToPaise, lineTotalMinor, sumMinor } from '../src/models/money.js';

test('rupeesToPaise converts whole-rupee prices to paise by integer multiplication', () => {
  assert.equal(rupeesToPaise(0), 0);
  assert.equal(rupeesToPaise(1), PAISE_PER_RUPEE);
  assert.equal(rupeesToPaise(189), 18900);
  assert.equal(rupeesToPaise(28900), 2890000);
  assert.equal(rupeesToPaise(189), 189 * PAISE_PER_RUPEE);
});

test('rupeesToPaise rejects non-integer and negative prices', () => {
  assert.throws(() => rupeesToPaise(18.9), TypeError);
  assert.throws(() => rupeesToPaise(-1), RangeError);
  assert.throws(() => rupeesToPaise('189'), TypeError);
  assert.throws(() => rupeesToPaise(null), TypeError);
  assert.throws(() => rupeesToPaise(undefined), TypeError);
});

test('lineTotalMinor computes unit price x quantity without floats', () => {
  assert.equal(lineTotalMinor(18900, 2), 37800);
  assert.equal(lineTotalMinor(2890000, 1), 2890000);
  assert.equal(lineTotalMinor(18900, 100), 1890000);
});

test('lineTotalMinor rejects malformed inputs', () => {
  assert.throws(() => lineTotalMinor(189.5, 2), TypeError);
  assert.throws(() => lineTotalMinor(-1, 2), TypeError);
  assert.throws(() => lineTotalMinor(18900, 0), TypeError);
  assert.throws(() => lineTotalMinor(18900, 1.5), TypeError);
});

test('sumMinor totals an order subtotal', () => {
  assert.equal(sumMinor([18900, 2890000, 100]), 2909000);
  assert.equal(sumMinor([]), 0);
  assert.throws(() => sumMinor([-1]), TypeError);
  assert.throws(() => sumMinor(['x']), TypeError);
  assert.throws(() => sumMinor(5), TypeError);
});