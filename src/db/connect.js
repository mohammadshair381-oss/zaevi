/**
 * Prisma database client module (replaces the former Mongoose connection).
 *
 * Phase 0.5: connection lifecycle + health/status only. No business models.
 * The Prisma client is loaded lazily so the Express app (and the test suite)
 * can be imported without a generated client, a .env file, or a live MySQL
 * server.
 */
import { createRequire } from 'node:module';
import { resolveDatabaseUrl } from '../config/database.js';

const require = createRequire(import.meta.url);

let prismaInstance = null;
let lastConnected = false;
let lastCheckedAt = null;

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2000;

function withTimeout(promise, timeoutMs, operation) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Return a (cached) PrismaClient instance.
 * Throws if the client has not been generated yet (`npx prisma generate`).
 */
export function getPrismaClient() {
  if (!prismaInstance) {
    // The generated client lives in node_modules/@prisma/client. require()
    // is used instead of a static import so a missing generation step or a
    // missing DATABASE_URL cannot crash the process at module-load time.
    const { PrismaClient } = require('@prisma/client');
    const dbUrl = resolveDatabaseUrl();
    process.env.DATABASE_URL = dbUrl;
    prismaInstance = new PrismaClient({
      datasources: { db: { url: dbUrl } },
      log:
        process.env.NODE_ENV === 'test'
          ? []
          : process.env.NODE_ENV === 'development'
            ? ['warn', 'error']
            : ['error'],
    });
  }
  return prismaInstance;
}

async function ping(prisma) {
  await prisma.$queryRaw`SELECT 1`;
}

/**
 * Verify database connectivity. Updates the cached status used by
 * getDbStatus() and the /api/health endpoint.
 * @param {{ timeoutMs?: number }} [options]
 */
export async function connectDB({ timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS } = {}) {
  try {
    const prisma = getPrismaClient();
    await withTimeout(ping(prisma), timeoutMs, 'Database connection');
    lastConnected = true;
    lastCheckedAt = new Date().toISOString();
    return prisma;
  } catch (error) {
    lastConnected = false;
    lastCheckedAt = new Date().toISOString();
    throw error;
  }
}

/**
 * Lightweight async health probe used by /api/health. Never throws.
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ status: 'connected'|'disconnected', provider: string, checkedAt: string|null }>}
 */
export async function checkDatabaseHealth({ timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS } = {}) {
  try {
    const prisma = getPrismaClient();
    await withTimeout(ping(prisma), timeoutMs, 'Database health check');
    lastConnected = true;
  } catch {
    lastConnected = false;
  } finally {
    lastCheckedAt = new Date().toISOString();
  }
  return getDbStatus();
}

/**
 * Cached connection status from the most recent connect/health probe.
 */
export function getDbStatus() {
  return {
    status: lastConnected ? 'connected' : 'disconnected',
    provider: 'prisma:mysql',
    checkedAt: lastCheckedAt,
  };
}

export async function disconnectDB() {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
  lastConnected = false;
}

export default { connectDB, checkDatabaseHealth, getDbStatus, disconnectDB, getPrismaClient };
