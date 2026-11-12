/**
 * Outbound email over authenticated SMTP. Configuration comes only from the environment:
 * SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM, and optionally SMTP_PORT and SMTP_SECURE.
 * The password is only ever sent over an encrypted connection.
 *
 * `sendEmail` never throws. It reports what actually happened, so callers can
 * store the real outcome instead of assuming delivery:
 * - sent           the SMTP server accepted the message
 * - not_configured no SMTP settings exist, so nothing was attempted
 * - failed         delivery was attempted and did not succeed
 */
import nodemailer from 'nodemailer';

const SMTP_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 500;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const NOT_CONFIGURED_MESSAGE = 'Email is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM are required)';

export function getEmailConfig(env = process.env) {
  const host = String(env.SMTP_HOST || '').trim();
  const from = String(env.EMAIL_FROM || '').trim();
  const port = Number(env.SMTP_PORT) || 587;
  const user = String(env.SMTP_USER || '').trim();
  const pass = String(env.SMTP_PASS || '');
  return {
    configured: Boolean(host && from && user && pass),
    host,
    from,
    port,
    secure: env.SMTP_SECURE === 'true' || port === 465,
    user,
    pass,
  };
}

export function transportOptions(config) {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    // Without implicit TLS, refuse to sign in until the connection is upgraded. A relay
    // on this same machine is the one exception, since nothing crosses the network.
    requireTLS: !config.secure && !LOOPBACK_HOSTS.has(config.host),
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  };
}

function createTransport(config) {
  return nodemailer.createTransport(transportOptions(config));
}

/** Connects and signs in without sending anything. */
export async function verifyEmailConnection({ env = process.env } = {}) {
  const config = getEmailConfig(env);
  if (!config.configured) return { status: 'not_configured', error: NOT_CONFIGURED_MESSAGE };
  try {
    await createTransport(config).verify();
    return { status: 'ok', error: null };
  } catch (error) {
    return { status: 'failed', error: String(error?.message || 'Unknown SMTP error').slice(0, MAX_ERROR_LENGTH) };
  }
}

export async function sendEmail({ to, subject, text, replyTo }, { env = process.env } = {}) {
  const config = getEmailConfig(env);
  if (!config.configured) {
    return { status: 'not_configured', error: NOT_CONFIGURED_MESSAGE };
  }
  try {
    const info = await createTransport(config).sendMail({ from: config.from, to, replyTo, subject, text });
    if (Array.isArray(info.rejected) && info.rejected.length > 0) {
      return { status: 'failed', error: `Recipient rejected: ${info.rejected.join(', ')}`.slice(0, MAX_ERROR_LENGTH) };
    }
    return { status: 'sent', error: null };
  } catch (error) {
    return { status: 'failed', error: String(error?.message || 'Unknown SMTP error').slice(0, MAX_ERROR_LENGTH) };
  }
}
