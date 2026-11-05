/**
 * Import the existing `products.json` catalog into MySQL via Prisma.
 *
 * Design goals:
 * - Read and validate the *existing* `products.json` (never modified).
 * - Preserve business IDs (e.g. "ZV001") as the Product primary key.
 * - Preserve size ordering via `ProductSize.position`.
 * - Be safe and repeatable: re-running upserts in place and creates no
 *   duplicate products or duplicate sizes.
 * - Never delete rows or reset the database.
 * - Report created / updated / skipped / failed counts and always close the
 *   Prisma connection.
 *
 * Run with:  npm run import:products
 * (or)       node scripts/import-products.js
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getPrismaClient, disconnectDB } from '../src/db/connect.js';
import { normalizeProduct, ProductValidationError } from '../src/models/product.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PRODUCTS_FILE = path.join(PROJECT_ROOT, 'products.json');

/** Product columns that come straight from the catalog source. */
export const SCALAR_FIELDS = Object.freeze([
  'name',
  'category',
  'gender',
  'price',
  'color',
  'imageUrl',
  'hoverImageUrl',
  'description',
]);

/**
 * Build the Prisma `create` payload (scalars + nested ordered sizes).
 * `available` is intentionally omitted so the schema default (`true`) applies.
 */
export function buildProductCreateData(desired) {
  return {
    id: desired.id,
    name: desired.name,
    category: desired.category,
    gender: desired.gender,
    price: desired.price,
    color: desired.color,
    imageUrl: desired.imageUrl,
    hoverImageUrl: desired.hoverImageUrl,
    description: desired.description,
    sizes: {
      create: desired.sizes.map(({ size, position }) => ({ size, position })),
    },
  };
}

/** Build the Prisma `update` payload (scalars only; sizes are upserted). */
export function buildProductUpdateData(desired) {
  const data = {};
  for (const field of SCALAR_FIELDS) {
    data[field] = desired[field];
  }
  return data;
}

/** True when any catalog-sourced scalar differs from the stored row. */
export function productScalarChanged(existing, desired) {
  return SCALAR_FIELDS.some((field) => existing[field] !== desired[field]);
}

/**
 * True when the stored sizes match the desired `{ size, position }` list,
 * including order.
 */
export function sizesEqual(existingSizes, desiredSizes) {
  if (!Array.isArray(existingSizes) || existingSizes.length !== desiredSizes.length) {
    return false;
  }
  const sorted = [...existingSizes].sort((a, b) => a.position - b.position);
  return sorted.every(
    (row, index) =>
      row.size === desiredSizes[index].size && row.position === desiredSizes[index].position
  );
}

/**
 * Import a single validated product. Returns 'created' | 'updated' | 'skipped'.
 * Uses the business id as the upsert key; sizes are upserted on the
 * (productId, size) unique constraint so no duplicates are created.
 */
export async function importOneProduct(prisma, desired) {
  const existing = await prisma.product.findUnique({
    where: { id: desired.id },
    include: { sizes: { orderBy: { position: 'asc' } } },
  });

  if (!existing) {
    await prisma.product.create({ data: buildProductCreateData(desired) });
    return 'created';
  }

  const scalarChanged = productScalarChanged(existing, desired);
  const sizesChanged = !sizesEqual(existing.sizes, desired.sizes);

  if (!scalarChanged && !sizesChanged) {
    return 'skipped';
  }

  await prisma.$transaction(async (tx) => {
    if (scalarChanged) {
      await tx.product.update({
        where: { id: desired.id },
        data: buildProductUpdateData(desired),
      });
    }
    if (sizesChanged) {
      for (const size of desired.sizes) {
        await tx.productSize.upsert({
          where: { productId_size: { productId: desired.id, size: size.size } },
          create: { productId: desired.id, size: size.size, position: size.position },
          update: { position: size.position },
        });
      }
    }
  });

  return 'updated';
}

/**
 * Import a catalog array. Validates each entry, imports the valid ones and
 * records failures without aborting the whole run.
 *
 * @param {{ prisma: import('@prisma/client').PrismaClient, raw: unknown[], logger?: Console }} options
 * @returns {Promise<{ total:number, created:number, updated:number, skipped:number, failed:number, failures:Array<{id:unknown,error:string}> }>}
 */
export async function importProducts({ prisma, raw, logger = console }) {
  if (!Array.isArray(raw)) {
    throw new Error('products.json must contain a JSON array');
  }

  const summary = {
    total: raw.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };
  const seenIds = new Set();

  for (const entry of raw) {
    const sourceId =
      entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry.id : undefined;
    try {
      const desired = normalizeProduct(entry);
      if (seenIds.has(desired.id)) {
        throw new ProductValidationError(desired.id, ['duplicate product id in source data']);
      }
      seenIds.add(desired.id);

      const action = await importOneProduct(prisma, desired);
      summary[action] += 1;
      logger.log(`[import] ${action.padEnd(7)} ${desired.id} — ${desired.name}`);
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({ id: sourceId, error: error.message });
      logger.error(`[import] failed  ${sourceId ?? '(unknown)'}: ${error.message}`);
    }
  }

  return summary;
}

export function formatSummary(summary) {
  return (
    `[import] done: ${summary.created} created, ${summary.updated} updated, ` +
    `${summary.skipped} skipped, ${summary.failed} failed (of ${summary.total})`
  );
}

async function main() {
  // products.json holds placeholder stock photos, which must stay out of production
  // until real product photography has been approved.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_CATALOG_IMPORT !== 'true') {
    console.error('[import] Refused: set ALLOW_PRODUCTION_CATALOG_IMPORT=true after products.json has approved product photos.');
    process.exitCode = 1;
    return;
  }
  const raw = JSON.parse(readFileSync(PRODUCTS_FILE, 'utf8'));
  const prisma = getPrismaClient();
  let summary;
  try {
    summary = await importProducts({ prisma, raw });
  } finally {
    await disconnectDB();
  }

  console.log(formatSummary(summary));
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`[import] fatal: ${error.message}`);
    process.exitCode = 1;
  });
}
