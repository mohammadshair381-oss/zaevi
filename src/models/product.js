/**
 * Product model validation and normalization.
 *
 * Pure, database-free helpers that turn a raw `products.json` entry into the
 * shape persisted by Prisma (Product + ProductSize). Keeping this logic free
 * of any Prisma import lets the catalog be validated by the automated test
 * suite without a generated client or a live MySQL server.
 *
 * Field mapping (products.json -> Prisma):
 *   id    -> Product.id            (existing business code, preserved verbatim)
 *   name  -> Product.name
 *   cat   -> Product.category
 *   gender-> Product.gender
 *   price -> Product.price         (integer, whole Indian Rupees)
 *   color -> Product.color
 *   img   -> Product.imageUrl
 *   hover -> Product.hoverImageUrl
 *   desc  -> Product.description
 *   sizes -> ProductSize[]         (order preserved via `position`)
 */

/** Genders present in the existing catalog. */
export const PRODUCT_GENDERS = Object.freeze(['Women', 'Men', 'Unisex']);

/** Column-length limits mirrored from prisma/schema.prisma. */
export const FIELD_LIMITS = Object.freeze({
  id: 32,
  name: 200,
  category: 100,
  gender: 20,
  color: 50,
  imageUrl: 1024,
  hoverImageUrl: 1024,
});

export class ProductValidationError extends Error {
  constructor(id, messages) {
    const label = typeof id === 'string' && id !== '' ? ` "${id}"` : '';
    super(`Invalid product${label}:\n - ${messages.join('\n - ')}`);
    this.name = 'ProductValidationError';
    this.details = messages;
  }
}

function requireString(value, field, errors, maxLength) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${field} must be a non-empty string`);
    return null;
  }
  const trimmed = value.trim();
  if (maxLength && trimmed.length > maxLength) {
    errors.push(`${field} must be at most ${maxLength} characters`);
    return null;
  }
  return trimmed;
}

function requirePrice(value, errors) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push('price must be a whole number of rupees (integer, no decimals)');
    return null;
  }
  if (value < 0) {
    errors.push('price must be zero or greater');
    return null;
  }
  return value;
}

function requireSizes(value, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('sizes must be a non-empty array');
    return [];
  }
  const seen = new Set();
  const sizes = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      errors.push(`sizes[${index}] must be a non-empty string`);
      return;
    }
    const size = entry.trim();
    if (seen.has(size)) {
      errors.push(`sizes contains a duplicate value "${size}"`);
      return;
    }
    seen.add(size);
    sizes.push({ size, position: index });
  });
  return sizes;
}

/**
 * Validate and normalize one raw catalog entry into the Prisma Product shape.
 * @param {unknown} raw
 * @returns {{
 *   id: string, name: string, category: string, gender: string, price: number,
 *   color: string, imageUrl: string, hoverImageUrl: string, description: string,
 *   available: boolean, sizes: Array<{ size: string, position: number }>
 * }}
 * @throws {ProductValidationError}
 */
export function normalizeProduct(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProductValidationError(null, ['product must be an object']);
  }

  const errors = [];

  const id = requireString(raw.id, 'id', errors, FIELD_LIMITS.id);
  const name = requireString(raw.name, 'name', errors, FIELD_LIMITS.name);
  const category = requireString(raw.cat, 'cat', errors, FIELD_LIMITS.category);
  const gender = requireString(raw.gender, 'gender', errors, FIELD_LIMITS.gender);
  const price = requirePrice(raw.price, errors);
  const color = requireString(raw.color, 'color', errors, FIELD_LIMITS.color);
  const imageUrl = requireString(raw.img, 'img', errors, FIELD_LIMITS.imageUrl);
  const hoverImageUrl = requireString(raw.hover, 'hover', errors, FIELD_LIMITS.hoverImageUrl);
  const description = requireString(raw.desc, 'desc', errors);
  const sizes = requireSizes(raw.sizes, errors);

  if (gender !== null && !PRODUCT_GENDERS.includes(gender)) {
    errors.push(`gender must be one of ${PRODUCT_GENDERS.join(', ')} (received "${gender}")`);
  }

  if (errors.length > 0) {
    throw new ProductValidationError(typeof raw.id === 'string' ? raw.id : null, errors);
  }

  return {
    id,
    name,
    category,
    gender,
    price,
    color,
    imageUrl,
    hoverImageUrl,
    description,
    available: true,
    sizes,
  };
}

/**
 * Normalize a full catalog array. Throws on the first invalid entry.
 * @param {unknown[]} products
 */
export function normalizeProducts(products) {
  if (!Array.isArray(products)) {
    throw new ProductValidationError(null, ['products must be an array']);
  }
  return products.map(normalizeProduct);
}

export default { normalizeProduct, normalizeProducts, ProductValidationError, PRODUCT_GENDERS };
