import { HttpError } from '../middleware/errors.js';
import {
  isValidOrderStatus,
  assertOrderStatusTransition,
} from './order-status.js';

export const DEFAULT_ESTIMATE_CONFIG = Object.freeze({
  productionDays: 7,
  qualityCheckDays: 2,
  packingDays: 2,
  shippingDays: 5,
  bufferDays: 2,
});

export function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d;
}

export function calculateEstimates(config, createdAt) {
  const c = { ...DEFAULT_ESTIMATE_CONFIG, ...(config || {}) };
  const base = createdAt ? new Date(createdAt) : new Date();
  const productionComplete = addDays(base, c.productionDays);
  const dispatch = addDays(productionComplete, c.qualityCheckDays + c.packingDays);
  const delivery = addDays(dispatch, c.shippingDays + c.bufferDays);
  return {
    estimatedProductionCompleteAt: productionComplete,
    estimatedDispatchAt: dispatch,
    estimatedDeliveryAt: delivery,
  };
}

export async function getDeliveryConfig(db) {
  try {
    const cfg = await db.deliveryEstimateConfig.findUnique({ where: { id: 1 } });
    return cfg || DEFAULT_ESTIMATE_CONFIG;
  } catch (e) {
    return DEFAULT_ESTIMATE_CONFIG;
  }
}

export async function createInitialOrderHistory(tx, order, customerId) {
  return tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      previousStatus: null,
      newStatus: order.status || 'pending',
      note: 'Order created',
      visibility: 'customer',
      changedBy: customerId || null,
    },
  });
}

export async function transitionOrderStatus(db, { reference, nextStatus, actorId, note, visibility }) {
  if (!isValidOrderStatus(nextStatus)) throw new HttpError(400, 'Invalid status');
  return db.$transaction(async (tx) => {
    const current = await tx.order.findUnique({ where: { reference }, select: { status: true, id: true } });
    if (!current) throw new HttpError(404, 'Order not found');
    assertOrderStatusTransition(current.status, nextStatus);
    if (current.status === nextStatus) {
      return tx.order.findUnique({ where: { reference }, include: { items: true } });
    }
    const result = await tx.order.updateMany({
      where: { reference, status: current.status },
      data: { status: nextStatus },
    });
    if (result.count === 0) {
      const latest = await tx.order.findUnique({ where: { reference }, select: { status: true } });
      assertOrderStatusTransition(latest ? latest.status : current.status, nextStatus);
      throw new HttpError(409, 'Order status was changed concurrently; reload and try again');
    }
    await tx.orderStatusHistory.create({
      data: {
        orderId: current.id,
        previousStatus: current.status,
        newStatus: nextStatus,
        note: note || null,
        visibility: visibility || 'customer',
        changedBy: actorId || null,
      },
    });
    return tx.order.findUnique({ where: { reference }, include: { items: true } });
  });
}
