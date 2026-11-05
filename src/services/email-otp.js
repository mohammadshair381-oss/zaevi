/**
 * One-time codes sent by email, for sign-up, sign-in and password reset.
 *
 * A code is useless without its challenge: a long random token held only by the browser
 * that started the request. The database keeps a hash of the challenge and a hash of the
 * code keyed with the challenge, so neither can be recovered from a database copy.
 * Each code lasts 10 minutes, allows 5 guesses and works once.
 */
import crypto from 'node:crypto';

import { DEVELOPMENT_DATABASE, databaseNameOf, resolveDatabaseUrl } from '../config/database.js';
import { getEmailConfig, sendEmail } from './email.js';

export const OTP_PURPOSES = Object.freeze({ SIGNUP: 'signup', LOGIN: 'login', RESET: 'reset' });
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_SENDS = 5;

const SUBJECTS = {
  [OTP_PURPOSES.SIGNUP]: 'Confirm your ZAEVI email',
  [OTP_PURPOSES.LOGIN]: 'Your ZAEVI sign-in code',
  [OTP_PURPOSES.RESET]: 'Your ZAEVI password reset code',
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hashCode = (challenge, code) => crypto.createHmac('sha256', challenge).update(code).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
export const newChallenge = () => crypto.randomBytes(32).toString('hex');

function isDevelopmentDatabase(env) {
  if (env.NODE_ENV !== 'development') return false;
  try {
    return databaseNameOf(resolveDatabaseUrl(env)) === DEVELOPMENT_DATABASE;
  } catch {
    return false;
  }
}

/**
 * A code may reach the server log only in development on the development database, and
 * only when email cannot reach the person: no SMTP settings, or a .test demo address,
 * which no mail server can deliver to. No other environment ever logs a code.
 */
export function canLogOtp(email, env = process.env) {
  if (!isDevelopmentDatabase(env)) return false;
  return !getEmailConfig(env).configured || /\.test$/i.test(String(email));
}

/** Whether a code can reach the person who asks for one. */
export function otpAvailability(env = process.env) {
  const viaServerLog = isDevelopmentDatabase(env) && !getEmailConfig(env).configured;
  return { available: viaServerLog || getEmailConfig(env).configured, viaServerLog };
}

export async function sendOtpEmail({ email, code, purpose }, { env = process.env, send = sendEmail } = {}) {
  if (canLogOtp(email, env)) {
    console.log(`[auth] Development code for ${email}: ${code}`);
    return;
  }
  const result = await send({
    to: email,
    subject: SUBJECTS[purpose] || 'Your ZAEVI code',
    text: `Your ZAEVI code is ${code}.\n\nIt expires in 10 minutes and works once. ZAEVI will never ask you to share it.\n\nIf you did not ask for this, you can ignore this email.`,
  }, { env });
  if (result.status !== 'sent') {
    throw new Error(String(result.error || 'Email was not sent').split(code).join('[hidden]'));
  }
}

/** Creates a code, replacing any earlier one for the same person and purpose, and sends it. */
export async function issueOtp(prisma, { customerId, email, purpose, challenge = newChallenge() }, { deliver = sendOtpEmail } = {}) {
  const now = new Date();
  const code = newCode();
  await prisma.emailOtp.deleteMany({ where: { customerId, purpose } });
  const row = await prisma.emailOtp.create({
    data: {
      customerId,
      purpose,
      challengeHash: sha256(challenge),
      codeHash: hashCode(challenge, code),
      lastSentAt: now,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    },
  });
  try {
    await deliver({ email, code, purpose });
  } catch (error) {
    await prisma.emailOtp.deleteMany({ where: { id: row.id } });
    throw error;
  }
  return { challenge };
}

/**
 * Checks a code. Guesses are counted in the database update itself, so requests made at
 * the same moment cannot exceed the limit or use one code twice.
 * @returns {{status:'ok',record:object}|{status:'wrong',attemptsLeft:number}|{status:'invalid'}}
 */
export async function checkOtp(prisma, { challenge, code, purposes }) {
  const token = String(challenge ?? '');
  const guess = String(code ?? '').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return { status: 'invalid' };

  const record = await prisma.emailOtp.findUnique({ where: { challengeHash: sha256(token) } });
  const now = new Date();
  if (!record || !purposes.includes(record.purpose) || record.consumedAt || record.expiresAt <= now) return { status: 'invalid' };

  const attemptsLeft = OTP_MAX_ATTEMPTS - record.attempts - 1;
  const counted = await prisma.emailOtp.updateMany({
    where: { id: record.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count !== 1) return { status: 'invalid' };

  const expected = Buffer.from(record.codeHash);
  const actual = Buffer.from(hashCode(token, guess));
  if (!/^\d{6}$/.test(guess) || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return attemptsLeft > 0 ? { status: 'wrong', attemptsLeft } : { status: 'invalid' };
  }

  const consumed = await prisma.emailOtp.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: now } });
  return consumed.count === 1 ? { status: 'ok', record } : { status: 'invalid' };
}

/**
 * Sends a new code for an active request.
 * @returns {{status:'sent'}|{status:'missing'}|{status:'expired'}|{status:'wait',seconds:number}|{status:'limit'}}
 */
export async function resendOtp(prisma, { challenge, getEmail }, { deliver = sendOtpEmail } = {}) {
  const token = String(challenge ?? '');
  if (!/^[a-f0-9]{64}$/.test(token)) return { status: 'missing' };
  const record = await prisma.emailOtp.findUnique({ where: { challengeHash: sha256(token) } });
  if (!record) return { status: 'missing' };
  if (record.consumedAt) return { status: 'expired' };

  const now = new Date();
  const waitMs = new Date(record.lastSentAt).getTime() + OTP_RESEND_COOLDOWN_MS - now.getTime();
  if (waitMs > 0) return { status: 'wait', seconds: Math.ceil(waitMs / 1000) };
  if (record.sendCount >= OTP_MAX_SENDS) return { status: 'limit' };

  const code = newCode();
  await prisma.emailOtp.update({
    where: { id: record.id },
    data: {
      codeHash: hashCode(token, code),
      attempts: 0,
      sendCount: { increment: 1 },
      lastSentAt: now,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    },
  });
  await deliver({ email: await getEmail(record.customerId), code, purpose: record.purpose });
  return { status: 'sent' };
}
