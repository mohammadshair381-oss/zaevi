/**
 * Order request validation and server-side price building.
 *
 * Pure and database-free apart from the product rows passed in, so the
 * validation rules, integer-paise arithmetic and reference generation can be
 * unit-tested directly. Malformed client input throws `HttpError(400)`; the
 * route maps that onto the standardized JSON error body.
 *
 * Money: the catalog stores whole rupees (`Product.price`, unchanged); order
 * tables store integer paise. Conversion uses `src/models/money.js` with
 * integer arithmetic only — never floating point.
 *
 * Authoritative product data (price, name, availability, sizes) is always read
 * from the database. Any `price`/`total`/`name` sent by the client is ignored.
 */
import { randomBytes, createHash } from 'node:crypto';

import { HttpError } from '../middleware/errors.js';
import { normalizeEmail } from './customer.js';
import { lineTotalMinor, rupeesToPaise, sumMinor } from './money.js';

export const MAX_ITEMS = 50;
export const MAX_QUANTITY_PER_ITEM = 10;
export const MAX_EMAIL_LENGTH = 255;
export const MAX_NAME_LENGTH = 200;
export const MAX_PHONE_LENGTH = 32;
export const MAX_ADDRESS_LENGTH = 500;
export const MAX_CITY_LENGTH = 120;
export const MAX_POSTAL_CODE_LENGTH = 20;
export const MAX_PRODUCT_ID_LENGTH = 32;
export const MAX_SIZE_LENGTH = 20;
export const DEFAULT_COUNTRY = 'IN';

/** Public order references: `ZV-YYYYMMDD-<16 lowercase hex chars>`. */
export const ORDER_REFERENCE_PATTERN = /^ZV-\d{8}-[0-9a-f]{16}$/;

/** Idempotency key validation. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 64;
export const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Defaults defined by the database schema; kept here for the response shape. */
export const ORDER_STATUS = 'pending';
export const ORDER_CURRENCY = 'INR';

/** Inventory lifecycle state machine values. */
export const INVENTORY_STATE = {
  RESERVED: 'reserved',
  CONSUMED: 'consumed',
  RELEASED: 'released',
};

/** Reservation expiry configuration (minutes). */
export const RESERVATION_WINDOW_MIN = 30;

/** Cancel reason values. */
export const CANCEL_REASON = {
  CUSTOMER: 'customer',
  ADMIN: 'admin',
  EXPIRED: 'expired',
  PAYMENT_FAILED: 'payment_failed',
};

/** Order-level currency (default INR). */
export const ORDER_CURRENCY_DEFAULT = 'INR';

/** Practical email shape check applied after normalization. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, field, maxLength, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `"${field}" is required`);
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `"${field}" must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    if (required) throw new HttpError(400, `"${field}" is required`);
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `"${field}" must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function parseEmail(value) {
  if (typeof value !== 'string') {
    throw new HttpError(400, '"email" is required and must be a string');
  }
  let normalized;
  try {
    normalized = normalizeEmail(value);
  } catch {
    throw new HttpError(400, '"email" must be a string');
  }
  if (normalized === '') {
    throw new HttpError(400, '"email" is required');
  }
  if (normalized.length > MAX_EMAIL_LENGTH) {
    throw new HttpError(400, `"email" must be at most ${MAX_EMAIL_LENGTH} characters`);
  }
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new HttpError(400, '"email" must be a valid email address');
  }
  return normalized;
}

function parseCountry(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_COUNTRY;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, '"shippingCountry" must be a 2-letter country code');
  }
  const country = value.trim().toUpperCase();
  if (!COUNTRY_PATTERN.test(country)) {
    throw new HttpError(400, '"shippingCountry" must be a 2-letter country code');
  }
  return country;
}

function parseQuantity(value, field) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new HttpError(400, `"${field}" must be a positive safe integer`);
  }
  if (value > MAX_QUANTITY_PER_ITEM) {
    throw new HttpError(400, `"${field}" must be at most ${MAX_QUANTITY_PER_ITEM}`);
  }
  return value;
}

/**
 * Optional saved-address reference (owner verified server-side before use).
 * Deliberately kept out of the canonical idempotency payload: the resolved
 * shipping fields — rebuilt server-side from the owned address — already
 * capture it, so hashes of pre-existing orders remain stable.
 */
function parseAddressId(value) {
  if (value === undefined || value === null || value === '') return null;
  const id = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new HttpError(400, '"addressId" must be a positive integer');
  }
  return id;
}

/**
 * Build the order shipping snapshot from a persisted Address row.
 * The address is always loaded server-side and ownership-checked, so no field
 * here comes from client input.
 * @param {{fullName:string, phone:string|null, addressLine1:string,
 *          addressLine2?:string|null, locality?:string|null, landmark?:string|null,
 *          city:string, postalCode:string, country?:string}} address
 * @returns {{name:string, address:string, city:string, postalCode:string, country:string}}
 */
export function shippingFromAddress(address) {
  const line2 = address.addressLine2 || '';
  const locality = address.locality || '';
  const landmark = address.landmark || '';
  const addressText = [address.addressLine1, line2, locality, landmark]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');

  return {
    name: String(address.fullName || '').trim(),
    address: addressText.slice(0, MAX_ADDRESS_LENGTH),
    city: String(address.city || '').trim(),
    postalCode: String(address.postalCode || '').trim(),
    country: String(address.country || DEFAULT_COUNTRY).trim().toUpperCase() || DEFAULT_COUNTRY,
  };
}

function parseItems(value) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, '"items" must be an array');
  }
  if (value.length === 0) {
    throw new HttpError(400, '"items" must contain at least one item');
  }
  if (value.length > MAX_ITEMS) {
    throw new HttpError(400, `"items" must contain at most ${MAX_ITEMS} items`);
  }

  // Duplicate (productId, size) lines are rejected rather than summed, so the
  // stored quantity always matches exactly one submitted line.
  const seen = new Set();
  return value.map((raw, index) => {
    if (!isPlainObject(raw)) {
      throw new HttpError(400, `"items[${index}]" must be an object`);
    }
    const productId = requireString(raw.productId, `items[${index}].productId`, MAX_PRODUCT_ID_LENGTH);
    const size = requireString(raw.size, `items[${index}].size`, MAX_SIZE_LENGTH);
    const quantity = parseQuantity(raw.quantity, `items[${index}].quantity`);

    const key = `${productId}\u0000${size}`;
    if (seen.has(key)) {
      throw new HttpError(400, `Duplicate cart line for product "${productId}" and size "${size}"`);
    }
    seen.add(key);

    return { productId, size, quantity };
  });
}

/**
 * Validate and normalize a checkout request body into an internal draft.
 * @param {unknown} body parsed JSON request body
 * @returns {{
 *   email: string, name: string|null, phone: string|null,
 *   shipping: { name:string, address:string, city:string, postalCode:string, country:string },
 *   items: Array<{ productId:string, size:string, quantity:number }>
 * }}
 * @throws {HttpError} 400 when the body is missing or malformed
 */
export function parseOrderRequest(body) {
  if (!isPlainObject(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }

  return {
    email: parseEmail(body.email),
    name: requireString(body.name, 'name', MAX_NAME_LENGTH, { required: false }),
    phone: requireString(body.phone, 'phone', MAX_PHONE_LENGTH, { required: false }),
    shipping: {
      name: requireString(body.shippingName, 'shippingName', MAX_NAME_LENGTH),
      address: requireString(body.shippingAddress, 'shippingAddress', MAX_ADDRESS_LENGTH),
      city: requireString(body.shippingCity, 'shippingCity', MAX_CITY_LENGTH),
      postalCode: requireString(body.shippingPostalCode, 'shippingPostalCode', MAX_POSTAL_CODE_LENGTH),
      country: parseCountry(body.shippingCountry),
    },
    addressId: parseAddressId(body.addressId),
    couponCode: requireString(body.couponCode, 'couponCode', 32, { required: false }),
    notes: requireString(body.notes, 'notes', 500, { required: false }),
    items: parseItems(body.items),
  };
}

/**
 * Validate and normalize a public order-tracking request.
 *
 * Tracking requires BOTH the order reference and the email used at checkout, so
 * a reference alone is not enough to read an order. POST is used so the email
 * is not placed in the URL / access logs.
 * @param {unknown} body
 * @returns {{reference:string, email:string}}
 * @throws {HttpError} 400 for malformed input
 */
export function parseOrderTrackingRequest(body) {
  if (!isPlainObject(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  const raw = requireString(body.reference, 'reference', 32);
  if (!/^ZV-\d{8}-[0-9a-f]{16}$/i.test(raw)) {
    throw new HttpError(400, '"reference" is not a valid order reference');
  }
  // Canonical reference form: uppercase ZV prefix, lowercase hex suffix.
  const reference = `ZV-${raw.slice(3).toLowerCase()}`;
  return { reference, email: parseEmail(body.email) };
}

/**
 * Validate and normalize an Idempotency-Key header value.
 * @param {string|undefined} headerValue
 * @returns {string} normalized key
 * @throws {HttpError} 400 when missing or malformed
 */
export function parseIdempotencyKey(headerValue) {
  if (headerValue === undefined || headerValue === null) {
    throw new HttpError(400, 'Idempotency-Key header is required');
  }
  if (typeof headerValue !== 'string') {
    throw new HttpError(400, 'Idempotency-Key must be a string');
  }
  const key = headerValue.trim();
  if (key === '') {
    throw new HttpError(400, 'Idempotency-Key is required');
  }
  if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new HttpError(400, `Idempotency-Key must be between ${IDEMPOTENCY_KEY_MIN_LENGTH} and ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`);
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new HttpError(400, 'Idempotency-Key contains invalid characters');
  }
  return key;
}

/**
 * Build a canonical payload for idempotency comparison.
 * Includes all materially relevant request fields, normalized and deterministically ordered.
 * Excludes client-supplied prices and totals.
 * @param {{
 *   email: string,
 *   name: string|null,
 *   phone: string|null,
 *   shipping: { name:string, address:string, city:string, postalCode:string, country:string },
 *   items: Array<{ productId:string, size:string, quantity:number }>
 * }} draft
 * @returns {object} canonical payload
 */
export function buildCanonicalPayload(draft) {
  return {
    email: draft.email,
    name: draft.name,
    phone: draft.phone,
    shipping: {
      name: draft.shipping.name,
      address: draft.shipping.address,
      city: draft.shipping.city,
      postalCode: draft.shipping.postalCode,
      country: draft.shipping.country,
    },
    items: [...draft.items]
      .sort((a, b) => a.productId.localeCompare(b.productId) || a.size.localeCompare(b.size))
      .map(({ productId, size, quantity }) => ({ productId, size, quantity })),
  };
}

/**
 * Compute SHA-256 hash of a canonical payload.
 * @param {object} payload
 * @returns {string} hex-encoded hash (64 chars)
 */
export function hashCanonicalPayload(payload) {
  const serialized = JSON.stringify(payload);
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Compute SHA-256 hash of an idempotency key for secure at-rest storage.
 * @param {string} key raw idempotency key (validated by parseIdempotencyKey)
 * @returns {string} hex-encoded hash (64 chars)
 */
export function hashIdempotencyKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Build authoritative order lines from validated items and database products.
 * Prices come only from the database rows; client-submitted monetary fields are
 * not read. Snapshots (`productSku`, `productName`, `unitPriceMinor`) are taken
 * here so a historical order stays meaningful if the product changes later.
 *
 * ZAEVI is produced on demand: orders are never rejected or priced against any
 * stock quantity. A size merely has to exist for its product; whether the
 * product itself is purchasable stays a business-controlled setting
 * (`Product.available`), checked above.
 *
 * @param {Array<{id:string,name:string,price:number,available:boolean,sizes?:Array<{size:string}>}>} products
 * @param {Array<{ productId:string, size:string, quantity:number }>} items
 * @returns {{ lines: Array<object>, subtotalMinor: number, totalMinor: number }}
 * @throws {HttpError} 400 for unknown/unavailable products or invalid sizes
 */
export function buildOrderLines(products, items) {
  const byId = new Map((products ?? []).map((product) => [product.id, product]));

  const lines = items.map((item) => {
    const product = byId.get(item.productId);
    if (!product) {
      throw new HttpError(400, `Unknown product: ${item.productId}`);
    }
    if (product.available !== true) {
      throw new HttpError(400, `Product is not available: ${item.productId}`);
    }
    const sizes = new Set((product.sizes ?? []).map((row) => row && row.size));
    if (!sizes.has(item.size)) {
      throw new HttpError(400, `Invalid size "${item.size}" for product ${item.productId}`);
    }
    if (!Number.isSafeInteger(product.price) || product.price < 0) {
      throw new HttpError(500, `Product price is invalid: ${item.productId}`);
    }

    const unitPriceMinor = rupeesToPaise(product.price);
    const lineMinor = lineTotalMinor(unitPriceMinor, item.quantity);

    return {
      productId: product.id,
      productSku: product.id,
      productName: product.name,
      size: item.size,
      unitPriceMinor,
      quantity: item.quantity,
      lineTotalMinor: lineMinor,
    };
  });

  const subtotalMinor = sumMinor(lines.map((line) => line.lineTotalMinor));
  if (!Number.isSafeInteger(subtotalMinor)) {
    throw new HttpError(500, 'Order subtotal exceeds the supported range');
  }

  // No shipping, tax or discount rules are defined, so the total equals the
  // item subtotal (mirroring the client-side checkout summary).
  return { lines, subtotalMinor, totalMinor: subtotalMinor };
}

/**
 * Generate a unique public order reference: `ZV-YYYYMMDD-<16 hex chars>`.
 * The random suffix (64 bits from `crypto.randomBytes`) is the uniqueness
 * source; the date is cosmetic. Uniqueness is additionally enforced by the DB
 * constraint and retried by the route on collision.
 * @param {Date} [now]
 * @param {(size:number)=>Buffer} [random]
 */
export function generateOrderReference(now = new Date(), random = randomBytes) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const suffix = random(8).toString('hex');
  return `ZV-${year}${month}${day}-${suffix}`;
}

/** Public response shape; internal database ids are never returned. */
export function serializeOrder(order) {
  const base = {
    reference: order.reference,
    status: order.status ?? ORDER_STATUS,
    currency: order.currency ?? ORDER_CURRENCY,
    subtotalMinor: order.subtotalMinor,
    totalMinor: order.totalMinor,
    createdAt: order.createdAt,
    items: [...(order.items ?? [])].map((item) => ({
      productId: item.productId,
      productSku: item.productSku,
      productName: item.productName,
      size: item.size,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor,
    })),
  };
  // Inventory-lifecycle fields - may be undefined if the order was created before
  // the lifecycle was introduced; callers should treat them as optional. Only
  // include them when actually present so the public shape stays stable.
  const lifecycle = {};
  if (order.inventoryState !== undefined) lifecycle.inventoryState = order.inventoryState;
  if (order.reservationExpiresAt !== undefined) lifecycle.reservationExpiresAt = order.reservationExpiresAt;
  if (order.paidAt !== undefined) lifecycle.paidAt = order.paidAt;
  if (order.cancelledAt !== undefined) lifecycle.cancelledAt = order.cancelledAt;
  if (order.refundedAt !== undefined) lifecycle.refundedAt = order.refundedAt;
  if (order.inventoryReleasedAt !== undefined) lifecycle.inventoryReleasedAt = order.inventoryReleasedAt;
  if (order.cancelReason !== undefined) lifecycle.cancelReason = order.cancelReason;
  return { ...base, ...lifecycle };
}

export default {
  parseOrderRequest,
  parseOrderTrackingRequest,
  parseIdempotencyKey,
  buildCanonicalPayload,
  hashCanonicalPayload,
  hashIdempotencyKey,
  buildOrderLines,
  generateOrderReference,
  serializeOrder,
  /** Validate that all cart items share the same currency; returns the currency string or throws. */
  checkMixedCurrency(cartItems) {
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      throw new Error(' cartItems must be a non‑empty array');
    }
    const firstCurrency = cartItems[0].currency;
    for (const item of cartItems) {
      if (item.currency !== firstCurrency) {
        throw new Error('Mixed‑currency cart: items have differing currency values');
      }
    }
    return firstCurrency;
  },

  /** Return the default currency for an order. */
  getDefaultCurrency() {
    return ORDER_CURRENCY_DEFAULT;
  },

  /** Lifecycle helpers – these are intentionally pure functions that inspect
   *  order state and return what the next state should be.  They do NOT
   *  persist anything; the calling code (e.g. an HTTP route or a test) must
   *  perform the actual DB write within a transaction.
   */
  cancelOrder(order) {
    // Return a transition plan; the caller must atomically write to DB.
    const plan = { from: order.inventoryState, to: INVENTORY_STATE.RELEASED };
    // If the order is already paid or refunded, cancel is not allowed.
    if (order.inventoryState === INVENTORY_STATE.CONSUMED || order.inventoryState === INVENTORY_STATE.RELEASED) {
      throw new Error('Order cannot be cancelled because it is already consumed or released');
    }
    return plan;
  },

  releaseExpiredOrders(orders) {
    // Return a list of orders that may be expired and need release.
    const now = new Date();
    return orders.filter((order) => {
      if (order.inventoryState !== INVENTORY_STATE.RESERVED) return false;
      if (!order.reservationExpiresAt) return false;
      return new Date(order.reservationExpiresAt) < now;
    });
  },

  payOrder(order) {
    this.cancelOrder(order); // reuse check for reserved state
    // Ensure reservation has not expired
    if (order.inventoryState === INVENTORY_STATE.RESERVED && order.reservationExpiresAt) {
      if (new Date(order.reservationExpiresAt) < new Date()) {
        throw new Error('Reservation has expired; order cannot be paid');
      }
    }
    // Transition pending+reserved -> paid+consumed
    return { from: order.inventoryState, to: INVENTORY_STATE.CONSUMED };
  },

  refundOrder(order) {
    if (order.inventoryState !== INVENTORY_STATE.PAID) {
      throw new Error('Order must be in paid state to be refunded');
    }
    return { from: order.inventoryState, to: 'refunded' };
  },
};
