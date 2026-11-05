/**
 * MongoDB connection lifecycle and the shared data client.
 *
 * Nothing connects until it is first needed, so the Express app and the test suite can be
 * imported without a database. A failed attempt is not remembered, so the next request or
 * health check tries again.
 */
import dns from 'node:dns';
import mongoose from 'mongoose';

import { resolveDatabase } from '../config/database.js';
import { createClient } from './client.js';
import { registerModels } from './models.js';

let connection = null;
let models = null;
let connecting = null;
let client = null;
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

/** Some networks cannot answer the lookup mongodb+srv:// links need. See .env.example. */
function applyDnsServers(env = process.env) {
  const servers = String(env.MONGODB_DNS_SERVERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (servers.length > 0) dns.setServers(servers);
}

async function open() {
  if (connection?.readyState === 1) return connection;
  if (!connecting) {
    connecting = (async () => {
      const { uri, dbName } = resolveDatabase();
      applyDnsServers();
      const attempt = mongoose.createConnection(uri, {
        dbName,
        maxPoolSize: 20,
        serverSelectionTimeoutMS: DEFAULT_CONNECT_TIMEOUT_MS,
        bufferCommands: false,
        autoIndex: false,
        autoCreate: false,
      });
      try {
        await attempt.asPromise();
      } catch (error) {
        await attempt.close().catch(() => {});
        throw error;
      }
      connection = attempt;
      models = registerModels(attempt);
      return attempt;
    })().finally(() => {
      connecting = null;
    });
  }
  return connecting;
}

async function ping() {
  const active = await open();
  await active.db.admin().ping();
}

/** The shared data client, used by every route. */
export function getDbClient() {
  if (!client) {
    client = createClient({
      getConnection: open,
      getModels: async () => {
        await open();
        return models;
      },
      ping,
      disconnect: disconnectDB,
    });
  }
  return client;
}

/** The connected Mongoose connection and models, for setup scripts. */
export async function getDatabaseHandles() {
  const active = await open();
  return { connection: active, models };
}

/**
 * Verifies connectivity and updates the status reported by /api/health.
 * @param {{ timeoutMs?: number }} [options]
 */
export async function connectDB({ timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS + 1000 } = {}) {
  try {
    await withTimeout(ping(), timeoutMs, 'Database connection');
    lastConnected = true;
    lastCheckedAt = new Date().toISOString();
    return getDbClient();
  } catch (error) {
    lastConnected = false;
    lastCheckedAt = new Date().toISOString();
    throw error;
  }
}

/**
 * Lightweight probe used by /api/health. Never throws.
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ status: 'connected'|'disconnected', provider: string, checkedAt: string|null }>}
 */
export async function checkDatabaseHealth({ timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS } = {}) {
  try {
    await withTimeout(ping(), timeoutMs, 'Database health check');
    lastConnected = true;
  } catch {
    lastConnected = false;
  } finally {
    lastCheckedAt = new Date().toISOString();
  }
  return getDbStatus();
}

/** Cached connection status from the most recent connect or health probe. */
export function getDbStatus() {
  return {
    status: lastConnected ? 'connected' : 'disconnected',
    provider: 'mongoose:mongodb',
    checkedAt: lastCheckedAt,
  };
}

export async function disconnectDB() {
  const active = connection;
  connection = null;
  models = null;
  client = null;
  lastConnected = false;
  if (active) await active.close();
}

export default { connectDB, checkDatabaseHealth, getDbStatus, disconnectDB, getDbClient, getDatabaseHandles };
