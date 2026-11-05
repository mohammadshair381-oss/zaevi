/**
 * Site Studio API. Shoppers can only read what has been published. Drafts, publishing
 * and undo live on the admin router, behind its role check and CSRF protection.
 */
import { Router } from 'express';
import { getDbClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { STUDIO_DEFAULT_STATE, validateStudioState } from '../models/site-studio.js';

const ROW_ID = 1;

function serializeAdmin(row) {
  return {
    draft: row?.draft ?? STUDIO_DEFAULT_STATE,
    hasUnpublishedChanges: row ? JSON.stringify(row.draft) !== JSON.stringify(row.published) : false,
    isPublished: Boolean(row?.published),
    publishedAt: row?.publishedAt ?? null,
    canUndo: Boolean(row?.previous),
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Published content only. Returns null if nothing is published or the table is not there yet. */
export function createSiteStudioPublicRouter({ getDb } = {}) {
  const resolveDb = getDb ?? getDbClient;
  const router = Router();
  router.get('/site/studio', async (req, res) => {
    res.set('Cache-Control', 'no-cache');
    try {
      const db = resolveDb();
      if (typeof db.siteStudio?.findUnique !== 'function') return res.json({ data: null });
      const row = await db.siteStudio.findUnique({
        where: { id: ROW_ID },
        select: { published: true, publishedAt: true },
      });
      return res.json({ data: row?.published ? { state: row.published, publishedAt: row.publishedAt } : null });
    } catch {
      // The storefront keeps its built-in content whenever this cannot be read.
      return res.json({ data: null });
    }
  });
  return router;
}

/** Adds the draft and publish endpoints to an already protected admin router. */
export function addSiteStudioAdminRoutes(api, resolveDb) {
  api.get('/studio', async (req, res, next) => {
    try {
      const row = await resolveDb().siteStudio.findUnique({ where: { id: ROW_ID } });
      res.json({ data: serializeAdmin(row) });
    } catch (e) { next(e); }
  });

  api.put('/studio', async (req, res, next) => {
    try {
      const { value, errors } = validateStudioState(req.body?.draft);
      if (errors.length) throw new HttpError(400, errors[0]);
      const row = await resolveDb().siteStudio.upsert({
        where: { id: ROW_ID },
        update: { draft: value, updatedBy: req.customerId ?? null },
        create: { id: ROW_ID, draft: value, updatedBy: req.customerId ?? null },
      });
      res.json({ data: serializeAdmin(row) });
    } catch (e) { next(e); }
  });

  api.post('/studio/publish', async (req, res, next) => {
    try {
      const db = resolveDb();
      const row = await db.siteStudio.findUnique({ where: { id: ROW_ID } });
      if (!row) throw new HttpError(400, 'Nothing to publish yet');
      const { value, errors } = validateStudioState(row.draft);
      if (errors.length) throw new HttpError(400, errors[0]);
      const updated = await db.siteStudio.update({
        where: { id: ROW_ID },
        data: {
          published: value,
          draft: value,
          previous: row.published ?? undefined,
          publishedAt: new Date(),
          updatedBy: req.customerId ?? null,
        },
      });
      res.json({ data: serializeAdmin(updated) });
    } catch (e) { next(e); }
  });

  // Restores the version live before the last publish, into both the site and the draft.
  api.post('/studio/undo', async (req, res, next) => {
    try {
      const db = resolveDb();
      const row = await db.siteStudio.findUnique({ where: { id: ROW_ID } });
      if (!row?.previous) throw new HttpError(400, 'There is no earlier version to go back to');
      const updated = await db.siteStudio.update({
        where: { id: ROW_ID },
        data: {
          published: row.previous,
          draft: row.previous,
          previous: row.published ?? undefined,
          publishedAt: new Date(),
          updatedBy: req.customerId ?? null,
        },
      });
      res.json({ data: serializeAdmin(updated) });
    } catch (e) { next(e); }
  });

  // Throws away unpublished edits and returns to what is live.
  api.post('/studio/discard', async (req, res, next) => {
    try {
      const db = resolveDb();
      const row = await db.siteStudio.findUnique({ where: { id: ROW_ID } });
      if (!row) return res.json({ data: serializeAdmin(null) });
      const updated = await db.siteStudio.update({
        where: { id: ROW_ID },
        data: { draft: row.published ?? STUDIO_DEFAULT_STATE, updatedBy: req.customerId ?? null },
      });
      return res.json({ data: serializeAdmin(updated) });
    } catch (e) { return next(e); }
  });
}
