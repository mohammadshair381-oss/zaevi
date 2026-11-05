/**
 * Checks the SMTP settings in .env and sends one test email.
 * Usage: npm run check:email -- you@example.com
 * Prints the outcome only. The password is never printed.
 */
import '../src/config/load-env.js';

import { getEmailConfig, sendEmail, verifyEmailConnection } from '../src/services/email.js';

const to = process.argv[2];
const config = getEmailConfig();

if (!config.configured) {
  const missing = [['SMTP_HOST', config.host], ['SMTP_USER', config.user], ['SMTP_PASS', config.pass], ['EMAIL_FROM', config.from]]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  console.error(`Email is not set up. Add these to .env: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`Server: ${config.host}:${config.port} (${config.secure ? 'TLS' : 'STARTTLS'})`);
console.log(`Signing in as: ${config.user}`);
console.log(`Sending from: ${config.from}`);

const check = await verifyEmailConnection();
if (check.status !== 'ok') {
  console.error(`Could not sign in to the mail server: ${check.error}`);
  process.exit(1);
}
console.log('Signed in to the mail server successfully.');

if (!to) {
  console.log('No email was sent. Add an address to send a test: npm run check:email -- you@example.com');
  process.exit(0);
}

const result = await sendEmail({ to, subject: 'ZAEVI test email', text: 'Your ZAEVI email settings work.' });
if (result.status !== 'sent') {
  console.error(`The test email was not sent: ${result.error}`);
  process.exit(1);
}
console.log(`The mail server accepted the test email for ${to}. Check that inbox, including spam.`);
