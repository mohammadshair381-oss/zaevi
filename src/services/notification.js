/**
 * Transactional notifications for ZAEVI. Each one is stored first, then delivered
 * by email in the background, so a slow or failing mail server never delays or
 * breaks the order or admin action that triggered it. The stored status records
 * the real outcome: pending, sent, failed or not_configured.
 */
import { sendEmail } from './email.js';

async function deliverNotification(prisma, row) {
  const result = await sendEmail({ to: row.recipientEmail, subject: row.subject, text: row.content });
  if (!prisma?.notification?.update) return { ...row, status: result.status };
  return prisma.notification.update({
    where: { id: row.id },
    data: {
      status: result.status,
      errorMessage: result.error,
      sentAt: result.status === 'sent' ? new Date() : null,
    },
  });
}

export async function recordNotification(prisma, { customerId, recipientEmail, type, subject, content }) {
  if (!recipientEmail) return null;
  try {
    if (!prisma?.notification?.create) return null;
    const row = await prisma.notification.create({
      data: { customerId: customerId || null, recipientEmail, type, subject, content, status: 'pending' },
    });
    deliverNotification(prisma, row).catch((error) => {
      console.error(`[notification] Failed to update ${type} delivery status:`, error.message);
    });
    return row;
  } catch (error) {
    console.error(`[notification] Failed to record ${type} notification:`, error.message);
    return null;
  }
}

/** Attempt delivery again for a stored notification and wait for the outcome. */
export async function retryNotification(prisma, id) {
  const row = await prisma.notification.findUnique({ where: { id } });
  if (!row) return null;
  return deliverNotification(prisma, row);
}

export async function notifyOrderConfirmed(prisma, { order }) {
  const subject = `ZAEVI Order Confirmation — ${order.reference}`;
  const content = `Thank you for your order with ZAEVI. Your order reference is ${order.reference}. Total: ₹${(order.totalMinor / 100).toLocaleString('en-IN')}. Each piece is made to order. You can follow its progress on the Track Order page of our website.`;
  return recordNotification(prisma, {
    customerId: order.customerId,
    recipientEmail: order.contactEmail,
    type: 'order_confirmation',
    subject,
    content,
  });
}

export async function notifyStatusUpdate(prisma, { order, newStatus, label }) {
  const subject = `ZAEVI Order ${order.reference} Update: ${label || newStatus}`;
  const content = `Your order ${order.reference} has progressed to: ${label || newStatus}. You can follow its progress on the Track Order page of our website.`;
  return recordNotification(prisma, {
    customerId: order.customerId,
    recipientEmail: order.contactEmail,
    type: 'status_update',
    subject,
    content,
  });
}

export async function notifyShipmentDispatched(prisma, { order, shipment }) {
  const subject = `ZAEVI Order ${order.reference} has Dispatched`;
  const trackingInfo = shipment.trackingNumber ? ` Carrier: ${shipment.carrier || 'Express'} · Tracking: ${shipment.trackingNumber}` : '';
  const content = `Your order ${order.reference} is on its way.${trackingInfo}`;
  return recordNotification(prisma, {
    customerId: order.customerId,
    recipientEmail: order.contactEmail,
    type: 'shipment_dispatched',
    subject,
    content,
  });
}

export async function notifyRefundProcessed(prisma, { order, refund }) {
  const subject = `ZAEVI Refund Notification — Order ${order.reference}`;
  const content = `A refund of ₹${(refund.amountMinor / 100).toLocaleString('en-IN')} has been processed to your original payment method. Reference: ${refund.providerRefundId || 'N/A'}.`;
  return recordNotification(prisma, {
    customerId: order.customerId,
    recipientEmail: order.contactEmail,
    type: 'refund_processed',
    subject,
    content,
  });
}

export async function notifyNewsletterWelcome(prisma, { email, offerMessage }) {
  const content = `Thank you for subscribing to the ZAEVI letter.${offerMessage ? ` ${offerMessage}` : ''} You can unsubscribe at any time from the Unsubscribe page of our website.`;
  return recordNotification(prisma, {
    recipientEmail: email,
    type: 'newsletter_welcome',
    subject: 'Welcome to the ZAEVI letter',
    content,
  });
}
