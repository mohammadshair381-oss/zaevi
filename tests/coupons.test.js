import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateCouponDiscount } from '../src/routes/coupons.js';

test('calculateCouponDiscount - percentage without cap', () => {
  const coupon = { discountType: 'percentage', discountValue: 10, maxDiscountMinor: null };
  const discount = calculateCouponDiscount({ coupon, subtotalMinor: 10000 });
  assert.equal(discount, 1000);
});

test('calculateCouponDiscount - percentage with cap exceeded', () => {
  const coupon = { discountType: 'percentage', discountValue: 20, maxDiscountMinor: 1500 };
  const discount = calculateCouponDiscount({ coupon, subtotalMinor: 10000 });
  assert.equal(discount, 1500);
});

test('calculateCouponDiscount - percentage with cap not exceeded', () => {
  const coupon = { discountType: 'percentage', discountValue: 10, maxDiscountMinor: 2000 };
  const discount = calculateCouponDiscount({ coupon, subtotalMinor: 10000 });
  assert.equal(discount, 1000);
});

test('calculateCouponDiscount - fixed discount smaller than subtotal', () => {
  const coupon = { discountType: 'fixed', discountValue: 2500 };
  const discount = calculateCouponDiscount({ coupon, subtotalMinor: 10000 });
  assert.equal(discount, 2500);
});

test('calculateCouponDiscount - fixed discount larger than subtotal is clamped', () => {
  const coupon = { discountType: 'fixed', discountValue: 15000 };
  const discount = calculateCouponDiscount({ coupon, subtotalMinor: 10000 });
  assert.equal(discount, 10000);
});

