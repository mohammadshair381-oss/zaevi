import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { CMS_DEFAULT_HOMEPAGE_STATE, CMS_DEFAULT_SETTINGS, validateHomepageState } from '../src/models/cms.js';

const SESSION_SECRET = 'cms-test-session-secret-32-characters';

function buildPrisma() {
  const customers = new Map();
  let customerSeq = 0;
  const settings = {
    id: 1,
    ...CMS_DEFAULT_SETTINGS,
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: null,
  };
  const pages = [];
  const revisions = [];
  const mediaAssets = [];
  let pageSeq = 0;
  let revisionSeq = 0;
  let mediaSeq = 0;

  function revisionById(id) {
    return revisions.find((revision) => revision.id === id) || null;
  }

  function shapePage(page, options = {}) {
    const select = options.select;
    const include = options.include;
    if (select && Object.keys(select).length > 0) {
      const result = {};
      for (const [key, enabled] of Object.entries(select)) {
        if (key === 'draftRevision' || key === 'publishedRevision') {
          const revision = revisionById(page[key === 'draftRevision' ? 'draftRevisionId' : 'publishedRevisionId']);
          result[key] = revision && enabled && enabled.select
            ? pickRevision(revision, enabled.select)
            : null;
        } else if (enabled) {
          result[key] = page[key];
        }
      }
      return result;
    }

    const result = { ...page };
    if (include?.draftRevision) {
      const revision = revisionById(page.draftRevisionId);
      result.draftRevision = revision
        ? pickRevision(revision, include.draftRevision.select)
        : null;
    }
    if (include?.publishedRevision) {
      const revision = revisionById(page.publishedRevisionId);
      result.publishedRevision = revision
        ? pickRevision(revision, include.publishedRevision.select)
        : null;
    }
    return result;
  }

  function pickRevision(revision, select) {
    if (!select) return { ...revision };
    const result = {};
    for (const key of Object.keys(select)) {
      if (select[key]) result[key] = revision[key];
    }
    return result;
  }

  const prisma = {
    __customers: customers,
    customer: {
      async create({ data }) {
        if (customers.has(data.email)) {
          const error = new Error('Unique constraint failed');
          error.code = 'P2002';
          error.meta = { target: 'Customer_email_key' };
          throw error;
        }
        const row = {
          id: ++customerSeq,
          role: 'customer',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        customers.set(data.email, row);
        return row;
      },
      async findUnique({ where, select }) {
        let row = null;
        if (where?.email) row = customers.get(where.email) || null;
        else if (where?.id !== undefined) {
          row = [...customers.values()].find((customer) => customer.id === where.id) || null;
        }
        if (!row) return null;
        if (select?.role) return { role: row.role };
        return { ...row };
      },
      async update({ where, data }) {
        const row = customers.get(where.email);
        if (!row) return null;
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
    },
    websiteSetting: {
      async findUnique({ where }) {
        return where?.id === 1 ? { ...settings } : null;
      },
      async create({ data }) {
        Object.assign(settings, data, { id: 1, createdAt: new Date(), updatedAt: new Date() });
        return { ...settings };
      },
      async update({ where, data }) {
        if (where?.id !== 1) return null;
        Object.assign(settings, data, { updatedAt: new Date() });
        return { ...settings };
      },
    },
    cmsPage: {
      async findMany({ include, select } = {}) {
        return pages.map((page) => shapePage(page, { include, select }));
      },
      async findUnique({ where, include, select } = {}) {
        const page = pages.find((item) => item.slug === where?.slug || item.id === where?.id);
        return page ? shapePage(page, { include, select }) : null;
      },
      async create({ data }) {
        const page = {
          id: ++pageSeq,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          revisions: [],
        };
        pages.push(page);
        return { ...page };
      },
      async update({ where, data, include } = {}) {
        const page = pages.find((item) => item.id === where?.id || item.slug === where?.slug);
        if (!page) return null;
        Object.assign(page, data, { updatedAt: new Date() });
        return shapePage(page, { include });
      },
      async updateMany({ where, data } = {}) {
        const page = pages.find((item) => item.id === where?.id);
        if (!page || page.draftRevisionId !== where?.draftRevisionId) return { count: 0 };
        Object.assign(page, data, { updatedAt: new Date() });
        return { count: 1 };
      },
    },
    cmsPageRevision: {
      async create({ data }) {
        const revision = {
          id: ++revisionSeq,
          ...data,
          createdAt: new Date(),
        };
        revisions.push(revision);
        const page = pages.find((item) => item.id === data.pageId);
        if (page) page.revisions.push(revision);
        return { ...revision };
      },
      async findMany({ where, orderBy, select } = {}) {
        let result = revisions.filter((revision) => !where?.pageId || revision.pageId === where.pageId);
        if (orderBy?.version === 'desc') result.sort((a, b) => b.version - a.version);
        return result.map((revision) => pickRevision(revision, select));
      },
      async findFirst({ where, orderBy, select } = {}) {
        let result = revisions.filter((revision) => !where?.pageId || revision.pageId === where.pageId);
        if (orderBy?.version === 'desc') result.sort((a, b) => b.version - a.version);
        return result.length ? pickRevision(result[0], select) : null;
      },
      async findUnique({ where }) {
        const revision = revisions.find((item) => item.id === where?.id);
        return revision ? { ...revision } : null;
      },
      async update({ where, data }) {
        const revision = revisions.find((item) => item.id === where?.id);
        if (!revision) return null;
        Object.assign(revision, data);
        return { ...revision };
      },
    },
    mediaAsset: {
      async findMany({ orderBy, select } = {}) {
        let result = mediaAssets.map((asset) => ({ ...asset }));
        if (orderBy?.createdAt === 'desc') result.sort((a, b) => b.createdAt - a.createdAt);
        if (select) result = result.map((asset) => {
          const picked = {};
          for (const key of Object.keys(select)) if (select[key]) picked[key] = asset[key];
          return picked;
        });
        return result;
      },
      async findUnique({ where }) {
        const asset = mediaAssets.find((item) => item.id === where?.id);
        return asset ? { ...asset } : null;
      },
      async findFirst({ where }) {
        const asset = mediaAssets.find((item) => item.storageKey === where?.storageKey);
        return asset ? { ...asset } : null;
      },
      async create({ data }) {
        const asset = { id: ++mediaSeq, ...data, createdAt: new Date() };
        mediaAssets.push(asset);
        return { ...asset };
      },
      async delete({ where }) {
        const index = mediaAssets.findIndex((item) => item.id === where?.id);
        if (index < 0) {
          const error = new Error('Not found');
          error.code = 'P2025';
          throw error;
        }
        const [deleted] = mediaAssets.splice(index, 1);
        return { ...deleted };
      },
    },
    $transaction: async (callback) => callback(prisma),
  };

  return prisma;
}

function readCsrfToken(cookies) {
  const cookie = cookies.find((value) => value.startsWith('zaevi.csrf='));
  return cookie ? decodeURIComponent(cookie.split(';')[0].slice('zaevi.csrf='.length)) : null;
}

test('CMS routes require admin authorization', async () => {
  const prisma = buildPrisma();
  const app = createApp({ prisma, logger: { log() {}, error() {} }, sessionSecret: SESSION_SECRET });
  const res = await request(app).get('/api/admin/cms/settings');
  assert.equal(res.status, 404);
});

test('CMS admin can read and update global settings', async () => {
  const prisma = buildPrisma();
  const app = createApp({ prisma, logger: { log() {}, error() {} }, sessionSecret: SESSION_SECRET });

  const agent = request.agent(app);
  const register = await agent.post('/api/auth/register').send({
    email: 'cms-admin@zaevi.test',
    password: 'CmsAdminPass123!',
  });
  assert.equal(register.status, 201);
  const customer = [...prisma.__customers.values()].find((row) => row.email === 'cms-admin@zaevi.test');
  customer.role = 'admin';

  const login = await agent.post('/api/auth/login').send({
    email: 'cms-admin@zaevi.test',
    password: 'CmsAdminPass123!',
  });
  assert.equal(login.status, 200);

  const initial = await agent.get('/api/admin/cms/settings');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.data.siteName, CMS_DEFAULT_SETTINGS.siteName);

  const csrf = readCsrfToken(initial.headers['set-cookie'] || []);
  const updated = await agent
    .put('/api/admin/cms/settings')
    .set('x-csrf-token', csrf)
    .send({ siteName: 'ZAEVI CMS', primaryColor: '#123456' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.siteName, 'ZAEVI CMS');
  assert.equal(updated.body.data.primaryColor, '#123456');
});

test('CMS settings update rejects invalid values and missing CSRF', async () => {
  const prisma = buildPrisma();
  const app = createApp({ prisma, logger: { log() {}, error() {} }, sessionSecret: SESSION_SECRET });

  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email: 'cms-admin2@zaevi.test', password: 'CmsAdminPass123!' });
  const customer = [...prisma.__customers.values()].find((row) => row.email === 'cms-admin2@zaevi.test');
  customer.role = 'admin';
  await agent.post('/api/auth/login').send({ email: 'cms-admin2@zaevi.test', password: 'CmsAdminPass123!' });

  const csrfResponse = await agent.get('/api/admin/cms/settings');
  const csrf = readCsrfToken(csrfResponse.headers['set-cookie'] || []);

  const missingCsrf = await agent.put('/api/admin/cms/settings').send({ siteName: 'No CSRF' });
  assert.equal(missingCsrf.status, 403);

  const invalid = await agent
    .put('/api/admin/cms/settings')
    .set('x-csrf-token', csrf)
    .send({ primaryColor: 'red', unknown: true });
  assert.equal(invalid.status, 400);
});

test('CMS page lifecycle creates drafts, publishes, reverts, and restores revisions', async () => {
  const prisma = buildPrisma();
  const app = createApp({ prisma, logger: { log() {}, error() {} }, sessionSecret: SESSION_SECRET });

  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email: 'cms-page@zaevi.test', password: 'CmsAdminPass123!' });
  const customer = [...prisma.__customers.values()].find((row) => row.email === 'cms-page@zaevi.test');
  customer.role = 'admin';
  await agent.post('/api/auth/login').send({ email: 'cms-page@zaevi.test', password: 'CmsAdminPass123!' });

  const initial = await agent.get('/api/admin/cms/settings');
  const csrf = readCsrfToken(initial.headers['set-cookie'] || []);

  const created = await agent
    .post('/api/admin/cms/pages')
    .set('x-csrf-token', csrf)
    .send({ slug: 'about', title: 'About ZAEVI' });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.slug, 'about');
  assert.equal(created.body.data.draftRevision.version, 1);

  const pageId = created.body.data.id;
  const firstRevisionId = created.body.data.draftRevision.id;

  const updated = await agent
    .put('/api/admin/cms/pages/about')
    .set('x-csrf-token', csrf)
    .send({
      title: 'About ZAEVI Updated',
      snapshot: {
        title: 'About ZAEVI Updated',
        components: [{ id: 'hero-1', type: 'hero', props: { heading: 'Hello' } }],
      },
    });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.draftRevision.version, 2);

  const published = await agent.post('/api/admin/cms/pages/about/publish').set('x-csrf-token', csrf).send({});
  assert.equal(published.status, 200);
  assert.equal(published.body.data.status, 'published');
  assert.equal(published.body.data.publishedRevision.id, updated.body.data.draftRevision.id);

  const reverted = await agent.post('/api/admin/cms/pages/about/revert').set('x-csrf-token', csrf).send({});
  assert.equal(reverted.status, 200);
  assert.equal(reverted.body.data.draftRevision.id, published.body.data.publishedRevision.id);

  const restored = await agent
    .post(`/api/admin/cms/pages/about/revisions/${firstRevisionId}/restore`)
    .set('x-csrf-token', csrf)
    .send({});
  assert.equal(restored.status, 200);
  assert.notEqual(restored.body.data.draftRevision.id, firstRevisionId);

  const revisions = await agent.get('/api/admin/cms/pages/about/revisions');
  assert.equal(revisions.status, 200);
  assert.ok(revisions.body.data.length >= 3);
});

test('homepage draft GET and PUT preserve the validated state without publishing', async () => {
  const prisma = buildPrisma();
  const app = createApp({ prisma, logger: { log() {}, error() {} }, sessionSecret: SESSION_SECRET });
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email: 'cms-home-draft@zaevi.test', password: 'CmsAdminPass123!' });
  const customer = [...prisma.__customers.values()].find((row) => row.email === 'cms-home-draft@zaevi.test');
  customer.role = 'admin';
  await agent.post('/api/auth/login').send({ email: 'cms-home-draft@zaevi.test', password: 'CmsAdminPass123!' });

  const firstLoad = await agent.get('/api/admin/cms/homepage');
  assert.equal(firstLoad.status, 200);
  assert.deepEqual(firstLoad.body.data.state, CMS_DEFAULT_HOMEPAGE_STATE);
  const csrf = readCsrfToken(firstLoad.headers['set-cookie'] || []);

  const draft = structuredClone(CMS_DEFAULT_HOMEPAGE_STATE);
  draft.theme.tokens = { '--brand': '#123456', '--font-sans': '"Manrope", ui-sans-serif' };
  draft.announcement = { ...draft.announcement, enabled: true, text: 'Homepage draft' };
  draft.navigation.links = [{ label: 'Shop', href: '/shop.html', isPill: true, enabled: true, sortOrder: 0 }];
  draft.footer = {
    ...draft.footer,
    aboutText: 'Footer draft',
    columns: [{ title: 'Links', muted: '', links: [{ label: 'Shop', href: '/shop.html' }], social: [] }],
  };
  draft.sections[0].enabled = false;
  draft.sections[0].sortOrder = 2;
  draft.hero = {
    autoplayMs: 6000,
    slides: [{
      id: 51,
      enabled: true,
      sortOrder: 0,
      kicker: 'New',
      headline: 'Draft hero',
      headline2: '',
      sub: 'Hero copy',
      primaryLabel: 'Shop',
      primaryHref: '/shop.html',
      secondaryLabel: '',
      secondaryHref: '',
      overlayBg: '',
      buttonStyles: {},
      background: { id: null, url: '/assets/zaevi-icon.png' },
      cardA: null,
      cardB: null,
      cardC: null,
      ribbons: [{ label: 'Offer', value: '10%' }],
      meta: [],
    }],
  };
  draft.reels.items = [{ title: 'Reel', productImage: '/assets/zaevi-icon.png', href: '/shop.html' }];
  draft.features.cards = [{ title: 'Clean', desc: 'Draft feature' }];
  draft.story.buttonLabel = 'Our story';
  draft.sections.find((section) => section.sectionId === 'promoStrip').enabled = true;
  draft.promoStrip = { ...draft.promoStrip, title: 'Promo draft' };
  draft.sections.find((section) => section.sectionId === 'appBanner').enabled = true;
  draft.appBanner = { ...draft.appBanner, title: 'App draft' };
  draft.logos = [{ id: 12, enabled: true, sortOrder: 0, name: 'Logo', href: '/about.html', logo: { id: null, url: '/api/cms/media/logo.png' } }];
  draft.testimonials = [{ id: 13, enabled: true, sortOrder: 0, name: 'Buyer', meta: 'Verified', rating: 5, text: 'Great', avatar: null }];
  draft.productSections = [{ kind: 'bestsellers', enabled: true, sortOrder: 0, title: 'Best', subtitle: '', viewAllHref: '/shop.html', tabs: [{ id: 'all', label: 'All', filter: {} }] }];
  const validated = validateHomepageState(draft, CMS_DEFAULT_HOMEPAGE_STATE);
  assert.deepEqual(validated.errors, []);

  const noCsrf = await agent.put('/api/admin/cms/homepage').send({ state: draft });
  assert.equal(noCsrf.status, 403);

  const saved = await agent
    .put('/api/admin/cms/homepage')
    .set('x-csrf-token', csrf)
    .send({ state: draft });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.data.state, validated.value);
  assert.equal(saved.body.data.page.draftRevision.version, 2);
  assert.equal(saved.body.data.page.publishedRevision, null);

  const retried = await agent
    .put('/api/admin/cms/homepage')
    .set('x-csrf-token', csrf)
    .send({ state: draft });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.data.page.draftRevision.id, saved.body.data.page.draftRevision.id);
  assert.equal(retried.body.data.page.draftRevision.version, 2);
  assert.equal(retried.body.data.page.publishedRevision, null);

  const reloaded = await agent.get('/api/admin/cms/homepage');
  assert.equal(reloaded.status, 200);
  assert.deepEqual(reloaded.body.data.state, validated.value);
  assert.equal(reloaded.body.data.page.publishedRevision, null);
});

test('public CMS settings return only safe published settings', async () => {
  const prisma = buildPrisma();
  const app = createApp({ prisma, logger: { log() {}, error() {} }, sessionSecret: SESSION_SECRET });

  const withSettings = await request(app).get('/api/cms/settings/public');
  assert.equal(withSettings.status, 200);
  assert.equal(withSettings.body.data.siteName, CMS_DEFAULT_SETTINGS.siteName);
  assert.ok(!Object.prototype.hasOwnProperty.call(withSettings.body.data, 'updatedBy'));

  const viaAlias = await request(app).get('/api/cms/settings');
  assert.equal(viaAlias.status, 200);
  assert.equal(viaAlias.body.data.siteName, CMS_DEFAULT_SETTINGS.siteName);

  prisma.websiteSetting.findUnique = async () => null;
  const defaults = await request(app).get('/api/cms/settings/public');
  assert.equal(defaults.status, 200);
  assert.equal(defaults.body.data.siteName, CMS_DEFAULT_SETTINGS.siteName);
});

test('public CMS page endpoint returns only published revisions', async () => {
  const prisma = buildPrisma();
  const app = createApp({ prisma, logger: { log() {}, error() {} }, sessionSecret: SESSION_SECRET });

  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email: 'cms-public@zaevi.test', password: 'CmsAdminPass123!' });
  const customer = [...prisma.__customers.values()].find((row) => row.email === 'cms-public@zaevi.test');
  customer.role = 'admin';
  await agent.post('/api/auth/login').send({ email: 'cms-public@zaevi.test', password: 'CmsAdminPass123!' });

  const initial = await agent.get('/api/admin/cms/settings');
  const csrf = readCsrfToken(initial.headers['set-cookie'] || []);

  await agent.post('/api/admin/cms/pages').set('x-csrf-token', csrf).send({ slug: 'about', title: 'About Draft' });

  const unpublished = await request(app).get('/api/cms/pages/about/published');
  assert.equal(unpublished.status, 404);

  await agent.put('/api/admin/cms/pages/about').set('x-csrf-token', csrf).send({
    snapshot: { title: 'Published About', components: [{ id: 'hero-1', type: 'hero', props: { heading: 'Hello' } }] },
  });
  await agent.post('/api/admin/cms/pages/about/publish').set('x-csrf-token', csrf).send({});

  const published = await request(app).get('/api/cms/pages/about/published');
  assert.equal(published.status, 200);
  assert.equal(published.body.data.slug, 'about');
  assert.equal(published.body.data.revision.snapshot.title, 'Published About');
  assert.ok(!Object.prototype.hasOwnProperty.call(published.body.data, 'draftRevisionId'));

  const unknown = await request(app).get('/api/cms/pages/not-a-page/published');
  assert.equal(unknown.status, 404);
});

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2XQAAAAASUVORK5CYII=';

test('media upload requires admin authorization', async () => {
  const prisma = buildPrisma();
  const app = createApp({ prisma, logger: { log() {}, error() {} }, sessionSecret: SESSION_SECRET });
  const res = await request(app).post('/api/admin/cms/media').send({ data: TINY_PNG_BASE64 });
  assert.equal(res.status, 404);
});

test('admin can upload and list a validated image', async () => {
  const prisma = buildPrisma();
  const app = createApp({ prisma, logger: { log() {}, error() {} }, sessionSecret: SESSION_SECRET });

  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email: 'cms-media@zaevi.test', password: 'CmsAdminPass123!' });
  const customer = [...prisma.__customers.values()].find((row) => row.email === 'cms-media@zaevi.test');
  customer.role = 'admin';
  await agent.post('/api/auth/login').send({ email: 'cms-media@zaevi.test', password: 'CmsAdminPass123!' });

  const initial = await agent.get('/api/admin/cms/settings');
  const csrf = readCsrfToken(initial.headers['set-cookie'] || []);

  const uploaded = await agent
    .post('/api/admin/cms/media')
    .set('x-csrf-token', csrf)
    .send({ data: TINY_PNG_BASE64, alt: 'Test pixel' });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.data.mimeType, 'image/png');
  assert.match(uploaded.body.data.url, /^\/api\/cms\/media\//);

  const listed = await agent.get('/api/admin/cms/media');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.length, 1);
});

test('media upload rejects invalid MIME and oversized files', async () => {
  const prisma = buildPrisma();
  const app = createApp({ prisma, logger: { log() {}, error() {} }, sessionSecret: SESSION_SECRET });

  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email: 'cms-media2@zaevi.test', password: 'CmsAdminPass123!' });
  const customer = [...prisma.__customers.values()].find((row) => row.email === 'cms-media2@zaevi.test');
  customer.role = 'admin';
  await agent.post('/api/auth/login').send({ email: 'cms-media2@zaevi.test', password: 'CmsAdminPass123!' });

  const initial = await agent.get('/api/admin/cms/settings');
  const csrf = readCsrfToken(initial.headers['set-cookie'] || []);

  const invalidMime = await agent
    .post('/api/admin/cms/media')
    .set('x-csrf-token', csrf)
    .send({ data: Buffer.from('<script>alert(1)</script>').toString('base64'), mimeType: 'image/png' });
  assert.equal(invalidMime.status, 400);

  const oversized = await agent
    .post('/api/admin/cms/media')
    .set('x-csrf-token', csrf)
    .send({ data: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') });
  assert.ok(oversized.status === 400 || oversized.status === 413);
});

test('media deletion is blocked when referenced by CMS content', async () => {
  const prisma = buildPrisma();
  const app = createApp({ prisma, logger: { log() {}, error() {} }, sessionSecret: SESSION_SECRET });

  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email: 'cms-media3@zaevi.test', password: 'CmsAdminPass123!' });
  const customer = [...prisma.__customers.values()].find((row) => row.email === 'cms-media3@zaevi.test');
  customer.role = 'admin';
  await agent.post('/api/auth/login').send({ email: 'cms-media3@zaevi.test', password: 'CmsAdminPass123!' });

  const initial = await agent.get('/api/admin/cms/settings');
  const csrf = readCsrfToken(initial.headers['set-cookie'] || []);

  const uploaded = await agent.post('/api/admin/cms/media').set('x-csrf-token', csrf).send({ data: TINY_PNG_BASE64 });
  const assetUrl = uploaded.body.data.url;

  await agent.post('/api/admin/cms/pages').set('x-csrf-token', csrf).send({ slug: 'media-page', title: 'Media Page' });
  await agent.put('/api/admin/cms/pages/media-page').set('x-csrf-token', csrf).send({
    snapshot: {
      title: 'Media Page',
      components: [{ id: 'hero-1', type: 'hero', props: { image: assetUrl } }],
    },
  });

  const blocked = await agent
    .delete(`/api/admin/cms/media/${uploaded.body.data.id}`)
    .set('x-csrf-token', csrf);
  assert.equal(blocked.status, 409);
});

test('CMS page creation rejects invalid slugs and snapshots', async () => {
  const prisma = buildPrisma();
  const app = createApp({ prisma, logger: { log() {}, error() {} }, sessionSecret: SESSION_SECRET });

  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email: 'cms-invalid@zaevi.test', password: 'CmsAdminPass123!' });
  const customer = [...prisma.__customers.values()].find((row) => row.email === 'cms-invalid@zaevi.test');
  customer.role = 'admin';
  await agent.post('/api/auth/login').send({ email: 'cms-invalid@zaevi.test', password: 'CmsAdminPass123!' });

  const initial = await agent.get('/api/admin/cms/settings');
  const csrf = readCsrfToken(initial.headers['set-cookie'] || []);

  const badSlug = await agent.post('/api/admin/cms/pages').set('x-csrf-token', csrf).send({ slug: 'Bad Slug', title: 'Bad' });
  assert.equal(badSlug.status, 400);

  const badSnapshot = await agent
    .post('/api/admin/cms/pages')
    .set('x-csrf-token', csrf)
    .send({ slug: 'valid-page', title: 'Valid', snapshot: { components: [{ id: 'x', type: 'rawHtml', props: { html: '<script>' } }] } });
  assert.equal(badSnapshot.status, 400);
});