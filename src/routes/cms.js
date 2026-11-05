import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { getDbClient } from '../db/connect.js';
import { HttpError } from '../middleware/errors.js';
import { createRequireAdmin } from '../middleware/auth.js';
import { validateCsrf } from '../middleware/csrf.js';
import {
  CMS_DEFAULT_SETTINGS,
  CMS_DEFAULT_HOMEPAGE_STATE,
  normalizeSlug,
  validateWebsiteSettings,
  validatePageMetadata,
  validatePageSnapshot,
  validateHomepageState,
} from '../models/cms.js';
import { getCached, setCached, invalidateCmsCache } from '../models/cms-cache.js';

function parsePositiveInt(value, field, { min = 1, max = 100 } = {}) {
  const number = Number(value === undefined || value === '' ? undefined : value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, `"${field}" must be an integer between ${min} and ${max}`);
  }
  return number;
}

function handleDataError(error) {
  if (error?.code === 'DUPLICATE_KEY') {
    throw new HttpError(409, 'A CMS record with that unique value already exists');
  }
  if (error?.code === 'RECORD_NOT_FOUND') {
    throw new HttpError(404, 'CMS record not found');
  }
  throw error;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isSameHomepageState(snapshot, state) {
  return snapshot?.homepage && stableJson(snapshot.homepage) === stableJson(state);
}

const MAX_UPLOAD_BYTES = 700 * 1024;
export function resolveUploadDir(env = process.env, cwd = process.cwd()) {
  const configured = String(env.UPLOAD_DIR ?? '').trim();
  return configured ? path.resolve(configured) : path.resolve(cwd, '..', 'zaevi-cms-uploads');
}

const UPLOAD_DIR = resolveUploadDir();

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return { mimeType: 'image/gif', extension: 'gif' };
  }
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export async function getOrCreateHomepagePage(db) {
  const slug = 'home';
  const pageInclude = { draftRevision: true, publishedRevision: { select: { id: true, version: true, publishedAt: true } } };
  let page = await db.cmsPage.findUnique({ where: { slug }, include: pageInclude });
  if (page) return page;

  const homepageState = validateHomepageState(CMS_DEFAULT_HOMEPAGE_STATE);
  if (homepageState.errors.length) throw new HttpError(500, homepageState.errors.join('; '));
  const snapshot = {
    title: 'Home',
    seoTitle: null,
    seoDescription: null,
    components: [],
    homepage: homepageState.value,
  };

  try {
    const created = await db.$transaction(async (tx) => {
      const createdPage = await tx.cmsPage.create({
        data: { slug, title: 'Home', status: 'draft' },
      });
      const revision = await tx.cmsPageRevision.create({
        data: { pageId: createdPage.id, version: 1, snapshot, createdBy: null },
      });
      return tx.cmsPage.update({
        where: { id: createdPage.id },
        data: { draftRevisionId: revision.id },
        include: pageInclude,
      });
    });
    return created;
  } catch (error) {
    if (error?.code !== 'DUPLICATE_KEY') throw error;
    const existing = await db.cmsPage.findUnique({ where: { slug }, include: pageInclude });
    if (existing) return existing;
    throw error;
  }
}

export function createCmsRouter({ getDb } = {}) {
  const resolveDb = getDb ?? getDbClient;
  const requireAdmin = createRequireAdmin({ getDb: resolveDb });
  const router = Router();

  router.use(requireAdmin);
  router.use(validateCsrf);

  async function getOrCreateSettings(db) {
    let settings = await db.websiteSetting.findUnique({ where: { id: 1 } });
    if (!settings) {
      settings = await db.websiteSetting.create({
        data: { id: 1, ...CMS_DEFAULT_SETTINGS },
      });
    }
    return settings;
  }

  router.get('/settings', async (req, res, next) => {
    try {
      const db = resolveDb();
      const settings = await getOrCreateSettings(db);
      return res.status(200).json({ data: settings });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/settings', async (req, res, next) => {
    try {
      const db = resolveDb();
      const current = await getOrCreateSettings(db);
      const result = validateWebsiteSettings(req.body, current);
      if (result.errors.length > 0) {
        throw new HttpError(400, result.errors.join('; '));
      }
      const updated = await db.websiteSetting.update({
        where: { id: 1 },
        data: {
          ...result.value,
          updatedBy: req.customerId ?? null,
        },
      });
      invalidateCmsCache();
      return res.status(200).json({ data: updated });
    } catch (error) {
      try {
        handleDataError(error);
      } catch (mapped) {
        return next(mapped);
      }
      return next(error);
    }
  });

  router.get('/homepage', async (req, res, next) => {
    try {
      const db = resolveDb();
      const page = await getOrCreateHomepagePage(db);
      const state = page.draftRevision?.snapshot?.homepage ?? CMS_DEFAULT_HOMEPAGE_STATE;
      return res.status(200).json({ data: { page, state } });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/homepage', async (req, res, next) => {
    try {
      const db = resolveDb();
      const page = await getOrCreateHomepagePage(db);
      const input = req.body?.state ?? req.body?.homepage ?? req.body;
      const current = page.draftRevision?.snapshot?.homepage ?? null;
      const result = validateHomepageState(input, current);
      if (result.errors.length > 0) throw new HttpError(400, result.errors.join('; '));

      if (isSameHomepageState(page.draftRevision?.snapshot, result.value)) {
        return res.status(200).json({ data: { page, state: result.value } });
      }

      const existingSnapshot = page.draftRevision?.snapshot ?? { title: page.title, seoTitle: page.seoTitle, seoDescription: page.seoDescription, components: [] };
      const snapshot = {
        ...existingSnapshot,
        title: existingSnapshot.title ?? 'Home',
        homepage: result.value,
      };
      const nextVersion = (page.draftRevision?.version ?? 0) + 1;
      let updated;
      try {
        updated = await db.$transaction(async (tx) => {
          const revision = await tx.cmsPageRevision.create({
            data: { pageId: page.id, version: nextVersion, snapshot, createdBy: req.customerId ?? null },
          });
          const claimed = await tx.cmsPage.updateMany({
            where: { id: page.id, draftRevisionId: page.draftRevisionId },
            data: { draftRevisionId: revision.id, status: 'draft' },
          });
          if (claimed.count !== 1) {
            const conflict = new Error('Homepage draft changed during save');
            conflict.code = 'CMS_DRAFT_CONFLICT';
            throw conflict;
          }
          return tx.cmsPage.findUnique({
            where: { id: page.id },
            include: { draftRevision: true, publishedRevision: { select: { id: true, version: true, publishedAt: true } } },
          });
        });
      } catch (error) {
        if (error?.code !== 'CMS_DRAFT_CONFLICT' && error?.code !== 'DUPLICATE_KEY') throw error;
        const latest = await db.cmsPage.findUnique({
          where: { id: page.id },
          include: { draftRevision: true, publishedRevision: { select: { id: true, version: true, publishedAt: true } } },
        });
        if (!isSameHomepageState(latest?.draftRevision?.snapshot, result.value)) {
          throw new HttpError(409, 'The homepage draft changed while saving. Reload the draft and try again.');
        }
        invalidateCmsCache();
        return res.status(200).json({ data: { page: latest, state: result.value } });
      }
      invalidateCmsCache();
      return res.status(200).json({ data: { page: updated, state: result.value } });
    } catch (error) {
      try { handleDataError(error); } catch (mapped) { return next(mapped); }
      return next(error);
    }
  });

  router.get('/pages', async (req, res, next) => {
    try {
      const db = resolveDb();
      const pages = await db.cmsPage.findMany({
        orderBy: { updatedAt: 'desc' },
        include: {
          draftRevision: { select: { id: true, version: true, createdAt: true } },
          publishedRevision: { select: { id: true, version: true, publishedAt: true } },
        },
      });
      return res.status(200).json({ data: pages });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/pages', async (req, res, next) => {
    try {
      const db = resolveDb();
      const metadata = validatePageMetadata(req.body);
      if (metadata.errors.length > 0) {
        throw new HttpError(400, metadata.errors.join('; '));
      }
      if (!metadata.value.slug || !metadata.value.title) {
        throw new HttpError(400, '"slug" and "title" are required');
      }

      const snapshot = {
        title: metadata.value.title,
        seoTitle: metadata.value.seoTitle ?? null,
        seoDescription: metadata.value.seoDescription ?? null,
        components: [],
      };
      const snapshotResult = validatePageSnapshot(snapshot);
      if (snapshotResult.errors.length > 0) {
        throw new HttpError(400, snapshotResult.errors.join('; '));
      }

      const page = await db.$transaction(async (tx) => {
        const createdPage = await tx.cmsPage.create({
          data: {
            slug: metadata.value.slug,
            title: metadata.value.title,
            seoTitle: metadata.value.seoTitle ?? null,
            seoDescription: metadata.value.seoDescription ?? null,
            status: 'draft',
          },
        });
        const revision = await tx.cmsPageRevision.create({
          data: {
            pageId: createdPage.id,
            version: 1,
            snapshot: snapshotResult.value,
            createdBy: req.customerId ?? null,
          },
        });
        return tx.cmsPage.update({
          where: { id: createdPage.id },
          data: { draftRevisionId: revision.id },
          include: {
            draftRevision: { select: { id: true, version: true, createdAt: true } },
            publishedRevision: { select: { id: true, version: true, publishedAt: true } },
          },
        });
      });

      return res.status(201).json({ data: page });
    } catch (error) {
      try {
        handleDataError(error);
      } catch (mapped) {
        return next(mapped);
      }
      return next(error);
    }
  });

  router.get('/pages/:slug', async (req, res, next) => {
    try {
      const slug = normalizeSlugFromParam(req.params.slug);
      const db = resolveDb();
      const page = await db.cmsPage.findUnique({
        where: { slug },
        include: {
          draftRevision: true,
          publishedRevision: { select: { id: true, version: true, publishedAt: true } },
        },
      });
      if (!page) throw new HttpError(404, 'Page not found');
      return res.status(200).json({ data: page });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/pages/:slug', async (req, res, next) => {
    try {
      const slug = normalizeSlugFromParam(req.params.slug);
      const db = resolveDb();
      const existing = await db.cmsPage.findUnique({
        where: { slug },
        include: { draftRevision: true },
      });
      if (!existing) throw new HttpError(404, 'Page not found');

      const metadataInput = {};
      for (const key of ['title', 'seoTitle', 'seoDescription']) {
        if (req.body?.[key] !== undefined) metadataInput[key] = req.body[key];
      }
      const metadata = validatePageMetadata(metadataInput);
      if (metadata.errors.length > 0) {
        throw new HttpError(400, metadata.errors.join('; '));
      }

      const snapshotInput = req.body?.snapshot;
      let snapshot = existing.draftRevision?.snapshot ?? {
        title: existing.title,
        seoTitle: existing.seoTitle,
        seoDescription: existing.seoDescription,
        components: [],
      };

      if (snapshotInput !== undefined) {
        const snapshotResult = validatePageSnapshot(snapshotInput);
        if (snapshotResult.errors.length > 0) {
          throw new HttpError(400, snapshotResult.errors.join('; '));
        }
        snapshot = snapshotResult.value;
      } else {
        if (metadata.value.title !== undefined) snapshot.title = metadata.value.title;
        if (metadata.value.seoTitle !== undefined) snapshot.seoTitle = metadata.value.seoTitle;
        if (metadata.value.seoDescription !== undefined) snapshot.seoDescription = metadata.value.seoDescription;
        const snapshotResult = validatePageSnapshot(snapshot);
        if (snapshotResult.errors.length > 0) {
          throw new HttpError(400, snapshotResult.errors.join('; '));
        }
        snapshot = snapshotResult.value;
      }

      const nextVersion = (existing.draftRevision?.version ?? 0) + 1;
      const updatedPage = await db.$transaction(async (tx) => {
        const revision = await tx.cmsPageRevision.create({
          data: {
            pageId: existing.id,
            version: nextVersion,
            snapshot,
            createdBy: req.customerId ?? null,
            note: typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : null,
          },
        });
        return tx.cmsPage.update({
          where: { id: existing.id },
          data: {
            title: metadata.value.title ?? existing.title,
            seoTitle: metadata.value.seoTitle === undefined ? existing.seoTitle : metadata.value.seoTitle,
            seoDescription: metadata.value.seoDescription === undefined ? existing.seoDescription : metadata.value.seoDescription,
            draftRevisionId: revision.id,
          },
          include: {
            draftRevision: { select: { id: true, version: true, createdAt: true } },
            publishedRevision: { select: { id: true, version: true, publishedAt: true } },
          },
        });
      });

      invalidateCmsCache();
      return res.status(200).json({ data: updatedPage });
    } catch (error) {
      try {
        handleDataError(error);
      } catch (mapped) {
        return next(mapped);
      }
      return next(error);
    }
  });

  router.get('/pages/:slug/revisions', async (req, res, next) => {
    try {
      const slug = normalizeSlugFromParam(req.params.slug);
      const db = resolveDb();
      const page = await db.cmsPage.findUnique({ where: { slug }, select: { id: true } });
      if (!page) throw new HttpError(404, 'Page not found');
      const revisions = await db.cmsPageRevision.findMany({
        where: { pageId: page.id },
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          createdAt: true,
          publishedAt: true,
          createdBy: true,
          note: true,
          snapshot: true,
        },
      });
      return res.status(200).json({ data: revisions });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/pages/:slug/publish', async (req, res, next) => {
    try {
      const slug = normalizeSlugFromParam(req.params.slug);
      const db = resolveDb();
      const page = await db.cmsPage.findUnique({
        where: { slug },
        include: { draftRevision: true },
      });
      if (!page) throw new HttpError(404, 'Page not found');
      if (!page.draftRevisionId) throw new HttpError(400, 'Page has no draft revision to publish');

      const publishedAt = new Date();
      const updated = await db.$transaction(async (tx) => {
        await tx.cmsPageRevision.update({
          where: { id: page.draftRevisionId },
          data: { publishedAt },
        });
        return tx.cmsPage.update({
          where: { id: page.id },
          data: {
            publishedRevisionId: page.draftRevisionId,
            status: 'published',
          },
          include: {
            draftRevision: { select: { id: true, version: true, createdAt: true } },
            publishedRevision: { select: { id: true, version: true, publishedAt: true } },
          },
        });
      });
      invalidateCmsCache();
      return res.status(200).json({ data: updated });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/pages/:slug/revert', async (req, res, next) => {
    try {
      const slug = normalizeSlugFromParam(req.params.slug);
      const db = resolveDb();
      const page = await db.cmsPage.findUnique({ where: { slug } });
      if (!page) throw new HttpError(404, 'Page not found');
      const targetRevisionId = page.publishedRevisionId ?? null;
      if (!targetRevisionId) throw new HttpError(400, 'Page has no published revision to revert to');

      const updated = await db.cmsPage.update({
        where: { id: page.id },
        data: { draftRevisionId: targetRevisionId, status: 'draft' },
        include: {
          draftRevision: { select: { id: true, version: true, createdAt: true } },
          publishedRevision: { select: { id: true, version: true, publishedAt: true } },
        },
      });
      invalidateCmsCache();
      return res.status(200).json({ data: updated });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/pages/:slug/revisions/:id/restore', async (req, res, next) => {
    try {
      const slug = normalizeSlugFromParam(req.params.slug);
      const revisionId = parsePositiveInt(req.params.id, 'id');
      const db = resolveDb();
      const page = await db.cmsPage.findUnique({ where: { slug } });
      if (!page) throw new HttpError(404, 'Page not found');
      const source = await db.cmsPageRevision.findUnique({ where: { id: revisionId } });
      if (!source || source.pageId !== page.id) throw new HttpError(404, 'Revision not found');

      const nextVersion = await getNextRevisionVersion(db, page.id);
      const updated = await db.$transaction(async (tx) => {
        const restored = await tx.cmsPageRevision.create({
          data: {
            pageId: page.id,
            version: nextVersion,
            snapshot: source.snapshot,
            createdBy: req.customerId ?? null,
            note: `Restored from revision ${source.version}`,
          },
        });
        return tx.cmsPage.update({
          where: { id: page.id },
          data: { draftRevisionId: restored.id, status: 'draft' },
          include: {
            draftRevision: { select: { id: true, version: true, createdAt: true } },
            publishedRevision: { select: { id: true, version: true, publishedAt: true } },
          },
        });
      });
      invalidateCmsCache();
      return res.status(200).json({ data: updated });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/media', async (req, res, next) => {
    try {
      const db = resolveDb();
      const assets = await db.mediaAsset.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          url: true,
          mimeType: true,
          width: true,
          height: true,
          alt: true,
          createdAt: true,
        },
      });
      return res.status(200).json({ data: assets });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/media', async (req, res, next) => {
    try {
      const db = resolveDb();
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        throw new HttpError(400, 'Request body must be a JSON object');
      }
      const raw = typeof req.body.data === 'string' ? req.body.data.trim() : '';
      if (raw === '') throw new HttpError(400, '"data" must be a base64-encoded image');
      const base64 = raw.includes(',') ? raw.split(',').pop() : raw;
      if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
        throw new HttpError(400, '"data" must be valid base64');
      }
      let buffer;
      try {
        buffer = Buffer.from(base64, 'base64');
      } catch {
        throw new HttpError(400, '"data" must be valid base64');
      }
      if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
        throw new HttpError(400, `Image must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes`);
      }

      const detected = detectImageType(buffer);
      if (!detected) throw new HttpError(400, 'Unsupported or invalid image format');
      if (req.body.mimeType && req.body.mimeType !== detected.mimeType) {
        throw new HttpError(400, 'Declared MIME type does not match image content');
      }

      const alt = typeof req.body.alt === 'string' ? req.body.alt.trim().slice(0, 200) : null;
      const width = Number.isInteger(req.body.width) && req.body.width > 0 ? req.body.width : null;
      const height = Number.isInteger(req.body.height) && req.body.height > 0 ? req.body.height : null;

      await ensureUploadDir();
      const storageKey = `${crypto.randomUUID()}.${detected.extension}`;
      const filePath = path.join(UPLOAD_DIR, storageKey);
      await fs.writeFile(filePath, buffer);

      let asset;
      try {
        asset = await db.mediaAsset.create({
          data: {
            storageKey,
            url: `/api/cms/media/${storageKey}`,
            mimeType: detected.mimeType,
            width,
            height,
            alt,
            sizeBytes: buffer.length,
            createdBy: req.customerId ?? null,
          },
        });
      } catch (error) {
        await fs.unlink(filePath).catch(() => {});
        throw error;
      }

      return res.status(201).json({ data: asset });
    } catch (error) {
      try {
        handleDataError(error);
      } catch (mapped) {
        return next(mapped);
      }
      return next(error);
    }
  });

  router.delete('/media/:id', async (req, res, next) => {
    try {
      const id = parsePositiveInt(req.params.id, 'id');
      const db = resolveDb();
      const asset = await db.mediaAsset.findUnique({ where: { id } });
      if (!asset) throw new HttpError(404, 'Media asset not found');

      const revisions = await db.cmsPageRevision.findMany({
        select: { snapshot: true },
      });
      let settings = null;
      try {
        settings = await db.websiteSetting.findUnique({ where: { id: 1 } });
      } catch {
        settings = null;
      }
      const serialized = JSON.stringify({ revisions, settings });
      if (serialized.includes(asset.url) || serialized.includes(asset.storageKey)) {
        throw new HttpError(409, 'Media asset is referenced by CMS content and cannot be deleted');
      }

      await db.mediaAsset.delete({ where: { id } });
      await fs.unlink(path.join(UPLOAD_DIR, asset.storageKey)).catch(() => {});

      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function normalizeSlugFromParam(value) {
  const slug = normalizeSlug(value);
  if (!slug) throw new HttpError(400, 'Invalid page slug');
  return slug;
}

async function getNextRevisionVersion(db, pageId) {
  const latest = await db.cmsPageRevision.findFirst({
    where: { pageId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

const PUBLIC_SETTINGS_FIELDS = [
  'siteName',
  'logoUrl',
  'faviconUrl',
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'backgroundColor',
  'textColor',
  'headingFont',
  'bodyFont',
  'headerLayout',
  'footerLayout',
  'announcementEnabled',
  'announcementText',
  'announcementLink',
  'socialLinks',
  'defaultSeoTitle',
  'defaultSeoDescription',
  'themeTokens',
  'updatedAt',
];

function toPublicSettings(settings) {
  const result = {};
  for (const field of PUBLIC_SETTINGS_FIELDS) {
    result[field] = settings?.[field] ?? CMS_DEFAULT_SETTINGS[field] ?? null;
  }
  return result;
}

export function createCmsPublicRouter({ getDb } = {}) {
  const resolveDb = getDb ?? getDbClient;
  const router = Router();

  router.get(['/settings', '/settings/public'], async (req, res, next) => {
    try {
      const cached = getCached('cms:settings:public');
      if (cached !== undefined) {
        return res.status(200).json({ data: cached });
      }

      const db = resolveDb();
      let settings = null;
      try {
        settings = await db.websiteSetting.findUnique({ where: { id: 1 } });
      } catch {
        settings = null;
      }
      const publicSettings = toPublicSettings(settings || CMS_DEFAULT_SETTINGS);
      setCached('cms:settings:public', publicSettings);
      return res.status(200).json({ data: publicSettings });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/pages/:slug/published', async (req, res, next) => {
    try {
      const slug = normalizeSlug(req.params.slug);
      if (!slug) throw new HttpError(400, 'Invalid page slug');

      const cacheKey = `cms:page:published:${slug}`;
      const cached = getCached(cacheKey);
      if (cached !== undefined) {
        return res.status(200).json({ data: cached });
      }

      const db = resolveDb();
      const page = await db.cmsPage.findUnique({
        where: { slug },
        select: {
          slug: true,
          title: true,
          seoTitle: true,
          seoDescription: true,
          publishedRevision: {
            select: {
              version: true,
              publishedAt: true,
              snapshot: true,
            },
          },
        },
      });

      if (!page || !page.publishedRevision) {
        throw new HttpError(404, 'Published page not found');
      }

      const publicPage = {
        slug: page.slug,
        title: page.title,
        seoTitle: page.seoTitle,
        seoDescription: page.seoDescription,
        revision: {
          version: page.publishedRevision.version,
          publishedAt: page.publishedRevision.publishedAt,
          snapshot: page.publishedRevision.snapshot,
        },
      };
      setCached(cacheKey, publicPage);
      return res.status(200).json({ data: publicPage });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/media/:key', async (req, res, next) => {
    try {
      const key = String(req.params.key || '').trim();
      if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new HttpError(400, 'Invalid media key');

      const db = resolveDb();
      const asset = await db.mediaAsset.findFirst({ where: { storageKey: key } });
      if (!asset) throw new HttpError(404, 'Media not found');

      const filePath = path.join(UPLOAD_DIR, asset.storageKey);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) throw new HttpError(404, 'Media not found');

      res.type(asset.mimeType);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(filePath);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createCmsRouter;