import 'dotenv/config';

import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { resolveDatabaseName } from './config/database.js';
import { connectDB, disconnectDB } from './db/connect.js';
import { adminRecoveryConfig } from './services/admin-recovery.js';
import { otpAvailability } from './services/email-otp.js';

async function start() {
  let config;
  let dbName;
  try {
    dbName = resolveDatabaseName();
    config = loadEnv();
  } catch (error) {
    console.error(`[config] ${error.message}`);
    process.exit(1);
  }

  const app = createApp({
    // ZAEVI storefront policy: a customer must be signed in to place an order.
    // The checkout page enforces the same rule on the client, then the server
    // re-checks it (and requires the CSRF token) before any order is created.
    requireAuthForOrders: true,
    // Signing up, signing in and resetting a password all need a code sent by email.
    emailOtp: true,
    orderRateLimit: {
      max: config.ORDER_RATE_LIMIT_MAX,
      windowMs: config.ORDER_RATE_LIMIT_WINDOW_MS,
    },
    sessionSecret: config.SESSION_SECRET,
    authRateLimit: {
      max: config.AUTH_RATE_LIMIT_MAX,
      windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
    },
    loginRateLimit: {
      max: config.AUTH_RATE_LIMIT_MAX,
      windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
    },
  });

  if (!otpAvailability().available) {
    console.error('[email] SMTP is not set up, so sign-in codes cannot be sent and nobody can sign in. Add SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM.');
  }

  if (config.NODE_ENV === 'production' && !process.env.PROXY_SECRET) {
    console.error('[proxy] PROXY_SECRET is not set, so visitors behind the hosting proxy share one rate limit. See docs/deployment.md.');
  }
  if (config.NODE_ENV === 'production' && !process.env.UPLOAD_DIR) {
    console.error('[uploads] UPLOAD_DIR is not set, so uploaded images may be lost on restart. See docs/deployment.md.');
  }
  const recovery = adminRecoveryConfig();
  if (recovery.enabled) {
    console.warn(`[security] Emergency admin sign-in is ON until ${recovery.expiresAt.toISOString()}. Remove its settings when it is no longer needed.`);
  } else if (recovery.problem) {
    console.error(`[security] Emergency admin sign-in is OFF: ${recovery.problem}`);
  }

  const server = app.listen(config.PORT, () => {
    console.log(`[server] ZAEVI backend listening on port ${config.PORT} (${config.NODE_ENV}, database: ${dbName})`);
  });

  try {
    await connectDB();
    console.log('[db] Database connection established (MongoDB)');
  } catch (error) {
    console.error(`[db] Database connection failed: ${error.message}`);
    console.error('[db] /api/health will report "degraded" until the database is reachable.');
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] received ${signal}, shutting down...`);
    server.close(async () => {
      try {
        await disconnectDB();
      } catch (error) {
        console.error(`[db] error during shutdown: ${error.message}`);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
