/**
 * Address API (customer saved delivery addresses).
 *
 * Endpoints (all require authentication + CSRF for writes):
 *   GET /api/customer/addresses           - list addresses for current customer
 *   POST /api/customer/addresses          - create new address
 *   PATCH /api/customer/addresses/:id     - update own address
 *   DELETE /api/customer/addresses/:id    - delete own address
 *   POST /api/customer/addresses/:id/default - set as default
 */
import { Router } from 'express';

import { getPrismaClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';

function normalizeAddress(body = {}) {
  const a = {};
  if (body.fullName) a.fullName = String(body.fullName).trim();
  if (body.phone) a.phone = String(body.phone).trim();
  if (body.addressLine1) a.addressLine1 = String(body.addressLine1).trim();
  if (body.addressLine2) a.addressLine2 = String(body.addressLine2).trim();
  if (body.landmark) a.landmark = String(body.landmark).trim();
  if (body.locality) a.locality = String(body.locality).trim();
  if (body.city) a.city = String(body.city).trim();
  if (body.state) a.state = String(body.state).trim();
  if (body.postalCode) a.postalCode = String(body.postalCode).trim();
  if (body.country) a.country = String(body.country).trim().toUpperCase();
  if (body.label) a.label = String(body.label).trim();
  if (typeof body.isDefault === 'boolean') a.isDefault = body.isDefault;
  return a;
}

function validateAddress(a = {}) {
  if (!a.fullName) return 'Full name is required';
  if (!a.phone) return 'Phone number is required';
  if (!a.addressLine1) return 'Address is required';
  if (!a.city) return 'City is required';
  if (!a.state) return 'State is required';
  if (!a.postalCode) return 'Postal code is required';
  const phone = a.phone.replace(/\s+/g, '');
  if (!/^\+?\d{8,15}$/.test(phone)) return 'Enter a valid phone number';
  if (!/^\d{5,10}$/.test(a.postalCode)) return 'Enter a valid postal code';
  if (!/^[A-Z]{2}$/.test(a.country || 'IN')) return 'Invalid country';
  return null;
}

export function createAddressRouter({ getPrisma } = {}) {
  const resolvePrisma = getPrisma ?? getPrismaClient;
  const router = Router();

  router.use(requireAuth);

  router.get('/addresses', async (req, res, next) => {
    try {
      const prisma = resolvePrisma();
      const addresses = await prisma.address.findMany({
        where: { customerId: req.customerId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
      res.json({ data: addresses });
    } catch (error) {
      next(error);
    }
  });

  router.post('/addresses', validateCsrf, async (req, res, next) => {
    try {
      const data = normalizeAddress(req.body);
      const v = validateAddress(data);
      if (v) throw new HttpError(400, v);
      const prisma = resolvePrisma();
      if (data.isDefault) {
        await prisma.address.updateMany({
          where: { customerId: req.customerId, isDefault: true },
          data: { isDefault: false },
        });
      }
      const addr = await prisma.address.create({
        data: {
          customerId: req.customerId,
          fullName: data.fullName,
          phone: data.phone,
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2 || null,
          landmark: data.landmark || null,
          locality: data.locality || null,
          city: data.city,
          state: data.state,
          postalCode: data.postalCode,
          country: data.country || 'IN',
          label: data.label || null,
          isDefault: Boolean(data.isDefault),
        },
      });
      res.status(201).json({ data: addr });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/addresses/:id', validateCsrf, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid address');
      const data = normalizeAddress(req.body);
      const prisma = resolvePrisma();
      const existing = await prisma.address.findFirst({
        where: { id, customerId: req.customerId },
      });
      if (!existing) throw new HttpError(404, 'Address not found');
      // Validate the merged record so a partial update can never leave the
      // stored address with a malformed phone or PIN code.
      const merged = {
        fullName: data.fullName ?? existing.fullName,
        phone: data.phone ?? existing.phone,
        addressLine1: data.addressLine1 ?? existing.addressLine1,
        city: data.city ?? existing.city,
        state: data.state ?? existing.state,
        postalCode: data.postalCode ?? existing.postalCode,
        country: data.country ?? existing.country,
      };
      const v = validateAddress(merged);
      if (v) throw new HttpError(400, v);
      if (data.isDefault) {
        await prisma.address.updateMany({
          where: { customerId: req.customerId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      const addr = await prisma.address.update({
        where: { id },
        data: {
          fullName: data.fullName ?? existing.fullName,
          phone: data.phone ?? existing.phone,
          addressLine1: data.addressLine1 ?? existing.addressLine1,
          addressLine2: data.addressLine2 === undefined ? existing.addressLine2 : data.addressLine2 || null,
          landmark: data.landmark === undefined ? existing.landmark : data.landmark || null,
          locality: data.locality === undefined ? existing.locality : data.locality || null,
          city: data.city ?? existing.city,
          state: data.state ?? existing.state,
          postalCode: data.postalCode ?? existing.postalCode,
          country: data.country ?? existing.country,
          label: data.label === undefined ? existing.label : data.label || null,
          isDefault: data.isDefault === undefined ? existing.isDefault : Boolean(data.isDefault),
        },
      });
      res.json({ data: addr });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/addresses/:id', validateCsrf, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid address');
      const prisma = resolvePrisma();
      const existing = await prisma.address.findFirst({
        where: { id, customerId: req.customerId },
      });
      if (!existing) throw new HttpError(404, 'Address not found');
      await prisma.address.delete({ where: { id } });
      res.json({ data: { id } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/addresses/:id/default', validateCsrf, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid address');
      const prisma = resolvePrisma();
      const existing = await prisma.address.findFirst({
        where: { id, customerId: req.customerId },
      });
      if (!existing) throw new HttpError(404, 'Address not found');
      await prisma.$transaction([
        prisma.address.updateMany({
          where: { customerId: req.customerId, isDefault: true },
          data: { isDefault: false },
        }),
        prisma.address.update({ where: { id }, data: { isDefault: true } }),
      ]);
      res.json({ data: { ok: true } });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createAddressRouter;