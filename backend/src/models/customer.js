/**
 * Customer identity normalization.
 *
 * `Customer.email` is unique and stores an already-normalized address so the
 * same contact cannot be duplicated with different casing or padding. This is
 * identity normalization only — no authentication is implemented here.
 */

/**
 * Normalize an email address for storage: trim surrounding whitespace and
 * lower-case the whole address.
 * @param {string} email
 * @returns {string} normalized email
 * @throws {TypeError} when email is not a string
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') {
    throw new TypeError(`email must be a string (received ${JSON.stringify(email)})`);
  }
  return email.trim().toLowerCase();
}

export default { normalizeEmail };