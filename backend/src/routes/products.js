/**
 * Public product API.
 *
 *   GET /api/products        - paginated listing with optional filters
 *   GET /api/products/:id    - a single product by its business id (e.g. ZV001)
 *
 * The router is built as a factory that receives a `getDb()` resolver so
 * tests can inject an in-memory client and the app can lazily resolve the real
 * data client at request time.
 */
import { Router } from 'express';

import { getDbClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { parseProductListQuery } from '../models/product-query.js';

/** Sizes are always returned in their original position order. */
const SIZES_INCLUDE = { sizes: { orderBy: { position: 'asc' } } };

/** Maximum business-id length, mirrored from the Product.id column. */
const MAX_ID_LENGTH = 32;

/** Map a database Product row (with sizes) to the public API shape. */
export function serializeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    gender: row.gender,
    price: row.price,
    color: row.color,
    imageUrl: row.imageUrl,
    hoverImageUrl: row.hoverImageUrl,
    description: row.description,
    available: row.available,
    // Sizes as display strings in catalog order. ZAEVI is produced on demand:
    // every offered size is purchasable while the product is available; no
    // per-size stock or availability data is exposed to public clients.
    sizes: [...(row.sizes ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((size) => size.size),
  };
}

/** Build the database `where` clause for the supported filters. */
export function buildProductWhere({ category, gender, search } = {}) {
  const where = {};
  if (category !== undefined) where.category = category;
  if (gender !== undefined) where.gender = gender;
  if (search !== undefined) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
      { color: { contains: search } },
    ];
  }
  return where;
}

export function createProductsRouter({ getDb } = {}) {
  const resolveDb = getDb ?? getDbClient;
  const router = Router();

  // GET /api/products
  router.get('/products', async (req, res, next) => {
    try {
      const { page, limit, category, gender, search } = parseProductListQuery(req.query);
      const where = buildProductWhere({ category, gender, search });
      const db = resolveDb();

      const total = await db.product.count({ where });
      const rows = await db.product.findMany({
        where,
        include: SIZES_INCLUDE,
        orderBy: { id: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      });

      res.status(200).json({
        data: rows.map(serializeProduct),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/products/:id
  router.get('/products/:id', async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '').trim();
      if (id === '' || id.length > MAX_ID_LENGTH) {
        throw new HttpError(404, `Product not found: ${id || '(empty id)'}`);
      }

      const db = resolveDb();
      const row = await db.product.findUnique({ where: { id }, include: SIZES_INCLUDE });
      if (!row) {
        throw new HttpError(404, `Product not found: ${id}`);
      }

      res.status(200).json({ data: serializeProduct(row) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createProductsRouter;
