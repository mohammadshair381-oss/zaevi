/**
 * Public contact form. The message is stored first, so it is never lost if email
 * fails. The Client Services notification is then sent in the background and its
 * real outcome is kept on the row, where admins can see it and retry.
 */
import { Router } from 'express';
import { getPrismaClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { sendEmail } from '../services/email.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBJECTS = new Set(['General enquiry', 'Order support', 'Sizing & fit', 'Returns & exchanges', 'Press']);
const DEFAULT_RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000, message: 'Too many messages. Please try again later.' };

function cleanLine(value, maxLength) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength);
}

/** The one official public contact address, or null until it has been configured. */
export function getOfficialContactEmail(env = process.env) {
  const email = String(env.CONTACT_EMAIL || '').trim();
  return EMAIL_REGEX.test(email) ? email : null;
}

export function parseContactMessage(body) {
  const name = cleanLine(body?.name, 120);
  const email = cleanLine(body?.email, 255).toLowerCase();
  const orderReference = cleanLine(body?.order, 40) || null;
  const subject = cleanLine(body?.subject, 40);
  const message = String(body?.message ?? '').trim();

  if (!name) throw new HttpError(400, 'Please enter your name');
  if (!EMAIL_REGEX.test(email)) throw new HttpError(400, 'Please enter a valid email address');
  if (!SUBJECTS.has(subject)) throw new HttpError(400, 'Please choose a subject');
  if (message.length < 5) throw new HttpError(400, 'Please enter your message');
  if (message.length > 5000) throw new HttpError(400, 'Please keep your message under 5,000 characters');

  return { name, email, orderReference, subject, message };
}

/** Send the Client Services email for a stored message and record the outcome. */
export async function deliverContactNotification(prisma, row, { env = process.env } = {}) {
  const to = String(env.CONTACT_NOTIFY_EMAIL || '').trim() || getOfficialContactEmail(env);
  const result = to
    ? await sendEmail({
      to,
      replyTo: row.email,
      subject: `[ZAEVI contact] ${row.subject} from ${row.name}`,
      text: [
        `From: ${row.name} <${row.email}>`,
        `Subject: ${row.subject}`,
        `Order: ${row.orderReference || 'Not provided'}`,
        '',
        row.message,
      ].join('\n'),
    }, { env })
    : { status: 'not_configured', error: 'Neither CONTACT_NOTIFY_EMAIL nor CONTACT_EMAIL is set' };
  return prisma.contactMessage.update({
    where: { id: row.id },
    data: { notifyStatus: result.status, notifyError: result.error },
  });
}

export function createContactRouter({ getPrisma, contactRateLimit } = {}) {
  const resolvePrisma = getPrisma ?? getPrismaClient;
  const router = Router();
  const limiter = contactRateLimit === false
    ? (req, res, next) => next()
    : createRateLimiter({ ...DEFAULT_RATE_LIMIT, ...(contactRateLimit || {}) });

  router.get('/contact/config', (req, res) => {
    res.json({ data: { email: getOfficialContactEmail() } });
  });

  router.post('/contact', limiter, async (req, res, next) => {
    try {
      // Hidden field that people never see. Bots that fill it are not stored or emailed.
      if (req.body?.website) return res.status(201).json({ data: { received: true } });

      const data = parseContactMessage(req.body);
      const prisma = resolvePrisma();
      const row = await prisma.contactMessage.create({ data });
      deliverContactNotification(prisma, row).catch((error) => {
        console.error('[contact] Failed to update notification status:', error.message);
      });
      return res.status(201).json({ data: { received: true } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createContactRouter;
