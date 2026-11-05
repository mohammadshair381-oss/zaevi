/**
 * Order production workflow.
 *
 * ZAEVI is produced on demand: an order is received first, then moves through
 * confirmation, production, quality check, packing, shipping and delivery.
 * There is no warehouse inventory state here.
 *
 * Backward compatibility: the internal value for the first stage is still
 * `pending`, the value already stored on every historical order. It is shown to
 * customers and staff as "Order Received" and is never renamed in the database.
 * The remaining stages use new string values that fit the existing
 * `Order.status VARCHAR(20)` column, so no migration is required.
 */
import { HttpError } from '../middleware/errors.js';

/** Internal status values persisted in `Order.status`. */
export const ORDER_STATUS_VALUES = Object.freeze({
  PENDING: 'pending', // legacy value, displayed as "Order Received"
  CONFIRMED: 'confirmed',
  IN_PRODUCTION: 'in_production',
  QUALITY_CHECK: 'quality_check',
  PACKED: 'packed',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
});

/**
 * Ordered production stages (excluding cancellation). The array order is the
 * customer-facing timeline order.
 */
export const ORDER_WORKFLOW = Object.freeze([
  Object.freeze({ value: ORDER_STATUS_VALUES.PENDING, label: 'Order Received' }),
  Object.freeze({ value: ORDER_STATUS_VALUES.CONFIRMED, label: 'Confirmed' }),
  Object.freeze({ value: ORDER_STATUS_VALUES.IN_PRODUCTION, label: 'In Production' }),
  Object.freeze({ value: ORDER_STATUS_VALUES.QUALITY_CHECK, label: 'Quality Check' }),
  Object.freeze({ value: ORDER_STATUS_VALUES.PACKED, label: 'Packed' }),
  Object.freeze({ value: ORDER_STATUS_VALUES.SHIPPED, label: 'Shipped' }),
  Object.freeze({ value: ORDER_STATUS_VALUES.DELIVERED, label: 'Delivered' }),
]);

/** Cancellation is terminal and is not part of the forward timeline. */
export const CANCELLED_STATUS = Object.freeze({
  value: ORDER_STATUS_VALUES.CANCELLED,
  label: 'Cancelled',
});

/** Every accepted internal status value. */
export const ORDER_STATUSES = Object.freeze([
  ...ORDER_WORKFLOW.map((stage) => stage.value),
  CANCELLED_STATUS.value,
]);

const WORKFLOW_BY_VALUE = new Map(ORDER_WORKFLOW.map((stage) => [stage.value, stage]));
const ALL_BY_VALUE = new Map([
  ...ORDER_WORKFLOW.map((stage) => [stage.value, stage]),
  [CANCELLED_STATUS.value, CANCELLED_STATUS],
]);

/**
 * Allowed forward transitions. Cancellation is permitted until the order has
 * shipped; delivered and cancelled are terminal. Repeating the current status
 * is accepted as an idempotent no-op by `canTransitionOrderStatus`.
 */
const TRANSITIONS = Object.freeze({
  [ORDER_STATUS_VALUES.PENDING]: Object.freeze([
    ORDER_STATUS_VALUES.CONFIRMED,
    ORDER_STATUS_VALUES.CANCELLED,
  ]),
  [ORDER_STATUS_VALUES.CONFIRMED]: Object.freeze([
    ORDER_STATUS_VALUES.IN_PRODUCTION,
    ORDER_STATUS_VALUES.CANCELLED,
  ]),
  [ORDER_STATUS_VALUES.IN_PRODUCTION]: Object.freeze([
    ORDER_STATUS_VALUES.QUALITY_CHECK,
    ORDER_STATUS_VALUES.CANCELLED,
  ]),
  [ORDER_STATUS_VALUES.QUALITY_CHECK]: Object.freeze([
    ORDER_STATUS_VALUES.PACKED,
    ORDER_STATUS_VALUES.CANCELLED,
  ]),
  [ORDER_STATUS_VALUES.PACKED]: Object.freeze([
    ORDER_STATUS_VALUES.SHIPPED,
    ORDER_STATUS_VALUES.CANCELLED,
  ]),
  [ORDER_STATUS_VALUES.SHIPPED]: Object.freeze([ORDER_STATUS_VALUES.DELIVERED]),
  [ORDER_STATUS_VALUES.DELIVERED]: Object.freeze([]),
  [ORDER_STATUS_VALUES.CANCELLED]: Object.freeze([]),
});

/** True when `value` is one of the workflow status values. */
export function isValidOrderStatus(value) {
  return typeof value === 'string' && ALL_BY_VALUE.has(value);
}

/**
 * Human-readable label for a stored status. Unknown/legacy values are
 * returned unchanged rather than being hidden or rewritten.
 */
export function getOrderStatusLabel(value) {
  return ALL_BY_VALUE.get(value)?.label ?? (value == null ? '' : String(value));
}

/** Forward statuses allowed after `current` (excludes cancellation). */
export function getAllowedNextStatuses(current) {
  return [...(TRANSITIONS[current] ?? [])];
}

/**
 * True when a transition is allowed. Repeating the current status is treated as
 * an idempotent no-op; unknown statuses can never transition.
 */
export function canTransitionOrderStatus(current, next) {
  if (!isValidOrderStatus(current) || !isValidOrderStatus(next)) return false;
  if (current === next) return true;
  return (TRANSITIONS[current] ?? []).includes(next);
}

/**
 * Validate and normalize an admin status-update body.
 * @param {unknown} body
 * @returns {{status:string}}
 * @throws {HttpError} 400 for a missing or unsupported status
 */
export function parseOrderStatusUpdateBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  const value = body.status;
  if (typeof value !== 'string') {
    throw new HttpError(400, '"status" is required and must be a string');
  }
  const status = value.trim().toLowerCase();
  if (!isValidOrderStatus(status)) {
    throw new HttpError(
      400,
      `"status" must be one of: ${ORDER_STATUSES.join(', ')}`
    );
  }
  return { status };
}

/**
 * Throw a 409 when an order cannot move from `current` to `next`.
 * @throws {HttpError} 409
 */
export function assertOrderStatusTransition(current, next) {
  if (canTransitionOrderStatus(current, next)) return;
  if (!isValidOrderStatus(current)) {
    throw new HttpError(409, `Order has an unrecognized status: ${current}`);
  }
  const allowed = getAllowedNextStatuses(current);
  const suffix = allowed.length
    ? `Allowed next status: ${allowed.join(', ')}`
    : 'No further status changes are allowed for this order';
  throw new HttpError(
    409,
    `Cannot change order status from "${current}" to "${next}". ${suffix}`
  );
}

/**
 * Build the customer-facing production timeline. Completed stages are marked
 * `complete`, the current stage is `current`, future stages are `upcoming`.
 * Cancelled orders show only the terminal cancellation state because stage
 * history is not stored.
 */
export function buildOrderStatusTimeline(status) {
  if (status === ORDER_STATUS_VALUES.CANCELLED) {
    return [{ ...CANCELLED_STATUS, state: 'current' }];
  }

  const stages = WORKFLOW_BY_VALUE.has(status)
    ? ORDER_WORKFLOW
    : [{ value: String(status ?? ''), label: getOrderStatusLabel(status), state: 'current' }];

  if (!WORKFLOW_BY_VALUE.has(status)) return stages;

  const currentIndex = stages.findIndex((stage) => stage.value === status);
  return stages.map((stage, index) => ({
    value: stage.value,
    label: stage.label,
    state: index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming',
  }));
}

export default {
  ORDER_STATUS_VALUES,
  ORDER_WORKFLOW,
  ORDER_STATUSES,
  CANCELLED_STATUS,
  isValidOrderStatus,
  getOrderStatusLabel,
  getAllowedNextStatuses,
  canTransitionOrderStatus,
  parseOrderStatusUpdateBody,
  assertOrderStatusTransition,
  buildOrderStatusTimeline,
};
