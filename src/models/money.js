/**
 * Money representation for orders.
 *
 * The existing catalog stores whole Indian Rupees as integers
 * (`Product.price`, `src/models/product.js`). Order tables store all monetary
 * values as integers in the minor currency unit (paise; 1 rupee = 100 paise).
 * Conversions are done with integer arithmetic only — no floating point — so
 * there is never rounding error at the boundary.
 */

export const PAISE_PER_RUPEE = 100;

/**
 * Convert a whole-rupee integer price (as stored on `Product.price`) to paise.
 * Pure integer multiplication; both inputs and result are integers.
 * @param {number} rupees whole rupees, a non-negative integer
 * @returns {number} paise
 * @throws {TypeError} when rupees is not an integer
 * @throws {RangeError} when rupees is negative
 */
export function rupeesToPaise(rupees) {
  if (!Number.isInteger(rupees)) {
    throw new TypeError(`rupees must be an integer (received ${JSON.stringify(rupees)})`);
  }
  if (rupees < 0) {
    throw new RangeError(`rupees must be zero or greater (received ${rupees})`);
  }
  return rupees * PAISE_PER_RUPEE;
}

/**
 * Compute an order line total from a paise unit price and a quantity.
 * @param {number} unitPriceMinor paise per unit, a non-negative integer
 * @param {number} quantity positive integer
 * @returns {number} line total in paise
 */
export function lineTotalMinor(unitPriceMinor, quantity) {
  if (!Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw new TypeError(
      `unitPriceMinor must be a non-negative integer (received ${JSON.stringify(unitPriceMinor)})`
    );
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new TypeError(`quantity must be a positive integer (received ${JSON.stringify(quantity)})`);
  }
  return unitPriceMinor * quantity;
}

/**
 * Sum an array of paise amounts into an order subtotal.
 * @param {number[]} amounts paise values, all non-negative integers
 * @returns {number} sum in paise
 */
export function sumMinor(amounts) {
  if (!Array.isArray(amounts)) {
    throw new TypeError(`amounts must be an array (received ${JSON.stringify(amounts)})`);
  }
  let total = 0;
  for (const amount of amounts) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new TypeError(`amount must be a non-negative integer (received ${JSON.stringify(amount)})`);
    }
    total += amount;
  }
  return total;
}

export default { PAISE_PER_RUPEE, rupeesToPaise, lineTotalMinor, sumMinor };