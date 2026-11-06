/**
 * Query-parameter validation for the public product listing.
 *
 * Pure and database-free so it can be unit-tested directly. Invalid or
 * malformed parameters throw an `HttpError(400)` so they surface as a 400
 * response instead of a 500.
 */
import { HttpError } from '../middleware/errors.js';
import { PRODUCT_GENDERS } from './product.js';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

const MAX_TEXT_LENGTH = 100;

function parsePositiveInteger(value, field, { max } = {}) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value.trim())) {
    throw new HttpError(400, `Query parameter "${field}" must be a positive integer`);
  }
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new HttpError(400, `Query parameter "${field}" must be a positive integer`);
  }
  if (max !== undefined && parsed > max) {
    throw new HttpError(400, `Query parameter "${field}" must be at most ${max}`);
  }
  return parsed;
}

function parseOptionalText(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, `Query parameter "${field}" must be a single string value`);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new HttpError(400, `Query parameter "${field}" must not be empty`);
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new HttpError(400, `Query parameter "${field}" must be at most ${MAX_TEXT_LENGTH} characters`);
  }
  return trimmed;
}

function parseGender(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'Query parameter "gender" must be a single string value');
  }
  const wanted = value.trim().toLowerCase();
  const canonical = PRODUCT_GENDERS.find((gender) => gender.toLowerCase() === wanted);
  if (!canonical) {
    throw new HttpError(400, `Query parameter "gender" must be one of: ${PRODUCT_GENDERS.join(', ')}`);
  }
  return canonical;
}

/**
 * Validate and normalize the supported listing query parameters.
 * Unknown parameters are ignored.
 *
 * @param {Record<string, unknown>} [query]
 * @returns {{ page: number, limit: number, category?: string, gender?: string, search?: string }}
 * @throws {HttpError} 400 when a parameter is malformed
 */
export function parseProductListQuery(query = {}) {
  return {
    page: parsePositiveInteger(query.page, 'page') ?? DEFAULT_PAGE,
    limit: parsePositiveInteger(query.limit, 'limit', { max: MAX_LIMIT }) ?? DEFAULT_LIMIT,
    category: parseOptionalText(query.category, 'category'),
    gender: parseGender(query.gender),
    search: parseOptionalText(query.search, 'search'),
  };
}

export default parseProductListQuery;
