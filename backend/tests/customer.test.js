import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeEmail } from '../src/models/customer.js';

test('normalizeEmail trims and lower-cases for unique storage', () => {
  assert.equal(normalizeEmail('  Aya.El@ZAevi.in  '), 'aya.el@zaevi.in');
  assert.equal(normalizeEmail('GUEST@ZAevi.test'), 'guest@zaevi.test');
  assert.equal(normalizeEmail('already@normal.com'), 'already@normal.com');
});

test('normalizeEmail rejects non-string input', () => {
  assert.throws(() => normalizeEmail(null), TypeError);
  assert.throws(() => normalizeEmail(7), TypeError);
  assert.throws(() => normalizeEmail(undefined), TypeError);
});