import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { STUDIO_DEFAULT_STATE, isSafeStudioUrl, validateStudioState } from '../src/models/site-studio.js';
import { parseProductInput } from '../src/routes/admin.js';
import { assertWithinReturnWindow } from '../src/routes/customer.js';
import { hashPassword } from '../src/models/auth.js';

const silentLogger = { error() {}, warn() {}, info() {}, log() {} };
const SESSION_SECRET = 'test-session-secret-at-least-32-characters';
const clone = (value) => JSON.parse(JSON.stringify(value));
const appWith = (db) => createApp({ db, logger: silentLogger, sessionSecret: SESSION_SECRET, authRateLimit: false, loginRateLimit: false });

test('studio default content is valid', () => {
  const { errors, value } = validateStudioState(clone(STUDIO_DEFAULT_STATE));
  assert.deepEqual(errors, []);
  assert.equal(value.blocks.length, 8);
});

test('links: only this site or https are allowed', () => {
  for (const url of ['', 'women.html', '/admin', '#top', 'https://example.com/a', '/api/cms/media/a.jpg']) {
    assert.equal(isSafeStudioUrl(url), true, url);
  }
  for (const url of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', '//evil.example', 'http://example.com', 'java script:x', 'a\\b']) {
    assert.equal(isSafeStudioUrl(url), false, url);
  }
});

const withBlock = (block) => ({ ...clone(STUDIO_DEFAULT_STATE), blocks: [block] });

test('sections: each type validates and keeps its settings', () => {
  const blocks = [
    { id: 'a', type: 'ribbon', text: 'Sale', speed: 'fast', direction: 'right', style: 'outline', animation: 'none' },
    { id: 'b', type: 'event', title: 'Show', date: '2027-01-01T10:00:00Z', showCountdown: false },
    { id: 'c', type: 'banner', title: 'Big', image: 'https://example.com/a.jpg', animation: 'curtain' },
    { id: 'd', type: 'text', heading: 'Hello' },
    { id: 'e', type: 'imageText', heading: 'Hi', side: 'right' },
    { id: 'f', type: 'products', heading: 'New', gender: 'Men', count: 8 },
    { id: 'g', type: 'gallery', images: [{ url: 'https://example.com/a.jpg', alt: 'A' }] },
    { id: 'h', type: 'builtin', key: 'shop', enabled: false },
  ];
  const { errors, value } = validateStudioState({ ...clone(STUDIO_DEFAULT_STATE), blocks });
  assert.deepEqual(errors, []);
  assert.equal(value.blocks[0].direction, 'right');
  assert.equal(value.blocks[1].showCountdown, false);
  assert.equal(value.blocks[1].date, '2027-01-01T10:00:00.000Z');
  assert.equal(value.blocks[2].animation, 'curtain');
  assert.equal(value.blocks[5].count, 8);
  assert.equal(value.blocks[6].images.length, 1);
  assert.equal(value.blocks[7].enabled, false);
});

test('sections: mistakes get a clear message and unsafe content is refused', () => {
  const cases = [
    [{ type: 'ribbon', text: '' }, /Ribbon text is required/],
    [{ type: 'ribbon', text: 'x'.repeat(121) }, /120 characters/],
    [{ type: 'ribbon', text: 'x', link: 'javascript:alert(1)' }, /https/],
    [{ type: 'event', title: 'x' }, /Event date is required/],
    [{ type: 'event', title: 'x', date: 'soon' }, /valid date/],
    [{ type: 'banner', title: 'x', image: 'data:image/png;base64,AA' }, /https/],
    [{ type: 'text', heading: 'x', showFrom: '2027-02-01', showUntil: '2027-01-01' }, /Show until/],
    [{ type: 'virus' }, /type/],
    [{ type: 'builtin', key: 'nope' }, /key|built-in/],
  ];
  for (const [block, message] of cases) {
    const { errors } = validateStudioState(withBlock(block));
    assert.ok(errors.some((e) => message.test(e)), `${JSON.stringify(block).slice(0, 50)} -> ${errors.join('; ')}`);
  }
});

test('sections: unknown fields are dropped and HTML stays plain text', () => {
  const { errors, value } = validateStudioState(withBlock({ type: 'text', heading: '<img src=x onerror=alert(1)>', extra: 'x', onclick: 'x' }));
  assert.deepEqual(errors, []);
  assert.equal(value.blocks[0].heading, '<img src=x onerror=alert(1)>');
  assert.equal('extra' in value.blocks[0], false);
  assert.equal('onclick' in value.blocks[0], false);
});

test('sections: limits are enforced and duplicate ids are repaired', () => {
  const many = Array.from({ length: 41 }, () => ({ type: 'text', heading: 'x' }));
  assert.ok(validateStudioState({ ...clone(STUDIO_DEFAULT_STATE), blocks: many }).errors.some((e) => /40 sections/.test(e)));
  const { value } = validateStudioState({ ...clone(STUDIO_DEFAULT_STATE), blocks: [{ id: 'same', type: 'text', heading: 'a' }, { id: 'same', type: 'text', heading: 'b' }] });
  assert.notEqual(value.blocks[0].id, value.blocks[1].id);
});

test('look and top strip: choices are limited to safe options', () => {
  assert.ok(validateStudioState({ ...clone(STUDIO_DEFAULT_STATE), look: { accent: 'url(evil)' } }).errors.length > 0);
  assert.ok(validateStudioState({ ...clone(STUDIO_DEFAULT_STATE), ticker: { enabled: true, items: [{ text: 'x', link: 'javascript:x' }] } }).errors.length > 0);
});

test('public studio endpoint: only published content, and safe when unavailable', async () => {
  const published = await request(appWith({ siteStudio: { findUnique: async () => ({ published: { version: 1 }, publishedAt: new Date(0) }) } })).get('/api/site/studio');
  assert.deepEqual(published.body.data.state, { version: 1 });
  const draftOnly = await request(appWith({ siteStudio: { findUnique: async () => ({ published: null }) } })).get('/api/site/studio');
  assert.equal(draftOnly.body.data, null);
  const noTable = await request(appWith({ siteStudio: { findUnique: async () => { throw new Error('table missing'); } } })).get('/api/site/studio');
  assert.equal(noTable.status, 200);
  assert.equal(noTable.body.data, null);
  const noModel = await request(appWith({})).get('/api/site/studio');
  assert.equal(noModel.body.data, null);
});

test('studio editing endpoints are closed to visitors', async () => {
  const app = appWith({ siteStudio: { findUnique: async () => null }, customer: { findUnique: async () => null } });
  for (const [method, path] of [['get', '/api/admin/studio'], ['put', '/api/admin/studio'], ['post', '/api/admin/studio/publish'], ['post', '/api/admin/studio/undo'], ['get', '/admin/studio'], ['post', '/api/admin/products'], ['patch', '/api/admin/products/ZV001'], ['get', '/api/admin/attention']]) {
    const res = await request(app)[method](path);
    assert.equal(res.status, 404, `${method} ${path}`);
  }
});

test('studio files: editor page is not publicly served, but its script is', async () => {
  const app = appWith({});
  assert.equal((await request(app).get('/site-studio.html')).status, 404);
  assert.equal((await request(app).get('/zaevi-studio.js')).status, 200);
  assert.equal((await request(app).get('/reset-password.html')).status, 200);
  assert.equal((await request(app).get('/unsubscribe.html')).status, 200);
});

const validProduct = { name: 'Coat', category: 'Outerwear', gender: 'Women', price: 12000, color: 'Black', description: 'Warm', imageUrl: 'https://example.com/a.jpg', sizes: ['S', ' M ', 'S', ''] };

test('products: a valid form is accepted, with tidied sizes', () => {
  const { data, sizes } = parseProductInput(validProduct);
  assert.deepEqual(sizes, ['S', 'M']);
  assert.equal(data.hoverImageUrl, data.imageUrl);
});

test('products: bad input gets a clear message', () => {
  for (const [patch, message] of [[{ name: '' }, /Name/], [{ price: 0 }, /Price/], [{ price: 10.5 }, /Price/], [{ gender: 'Kids' }, /Women, Men or Unisex/], [{ sizes: [] }, /at least one size/], [{ imageUrl: 'javascript:alert(1)' }, /Photos/]]) {
    assert.throws(() => parseProductInput({ ...validProduct, ...patch }), message);
  }
});

test('products: an edit can change one field and touch nothing else', () => {
  const { data, sizes } = parseProductInput({ available: false }, { partial: true });
  assert.deepEqual(data, { available: false });
  assert.equal(sizes, undefined);
});

test('returns: the 14-day window is enforced from the delivery date', async () => {
  const deliveredDaysAgo = (days) => ({ orderStatusHistory: { findFirst: async () => ({ createdAt: new Date(Date.now() - days * 864e5) }) } });
  await assertWithinReturnWindow(deliveredDaysAgo(13), 1);
  await assert.rejects(assertWithinReturnWindow(deliveredDaysAgo(15), 1), /14-day return period/);
  await assertWithinReturnWindow({ orderStatusHistory: { findFirst: async () => null } }, 1);
  await assertWithinReturnWindow({}, 1);
});

test('products: "available" must be a real true or false', () => {
  assert.throws(() => parseProductInput({ available: 'false' }, { partial: true }), /true or false/);
  assert.equal(parseProductInput({ available: false }, { partial: true }).data.available, false);
});

test('products: an edit cannot change the ID, and sizes differing only by case count once', () => {
  const { data, sizes } = parseProductInput({ id: 'ZV999', sku: 'X', sizes: ['S', 's', 'M'] }, { partial: true });
  assert.equal('id' in data, false);
  assert.equal('sku' in data, false);
  assert.deepEqual(sizes, ['S', 'M']);
});

/* ---------- Publishing, through the real routes ---------- */
async function studioAdmin() {
  const admin = { id: 1, email: 'studio-admin@example.com', role: 'admin', passwordHash: await hashPassword('admin-password-123') };
  let row = null;
  const db = {
    customer: { findUnique: async ({ where }) => (where.email === admin.email || where.id === admin.id ? admin : null) },
    siteStudio: {
      findUnique: async () => row,
      upsert: async ({ update, create }) => { row = row ? { ...row, ...update } : { published: null, previous: null, publishedAt: null, ...create }; return row; },
      update: async ({ data }) => { row = { ...row, ...data }; return row; },
    },
  };
  const app = appWith(db);
  const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'admin-password-123' });
  assert.equal(login.status, 200);
  const pairs = login.headers['set-cookie'].map((c) => c.split(';')[0]);
  const csrf = decodeURIComponent(pairs.find((c) => c.startsWith('zaevi.csrf=')).slice('zaevi.csrf='.length));
  const send = (method, path, body) => request(app)[method](`/api/admin/studio${path}`).set('Cookie', pairs.join('; ')).set('x-csrf-token', csrf).send(body);
  return { app, send };
}

const withRibbon = (text) => {
  const draft = clone(STUDIO_DEFAULT_STATE);
  draft.blocks.push({ id: 'r', type: 'ribbon', text });
  return draft;
};
const live = async (app) => (await request(app).get('/api/site/studio')).body.data;
const ribbonText = (data) => data.state.blocks.find((b) => b.id === 'r')?.text;

test('studio: a draft stays private until published, then undo and discard work', async () => {
  const { app, send } = await studioAdmin();
  const first = await send('put', '', { draft: withRibbon('First') });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.hasUnpublishedChanges, true);
  assert.equal(await live(app), null, 'draft is private');

  assert.equal((await send('post', '/publish', {})).status, 200);
  assert.equal(ribbonText(await live(app)), 'First');

  await send('put', '', { draft: withRibbon('Second') });
  assert.equal(ribbonText(await live(app)), 'First', 'saving a draft does not change the live site');

  const discarded = await send('post', '/discard', {});
  assert.equal(discarded.status, 200);
  assert.equal(discarded.body.data.hasUnpublishedChanges, false);
  assert.equal(discarded.body.data.draft.blocks.find((b) => b.id === 'r').text, 'First');

  await send('put', '', { draft: withRibbon('Third') });
  await send('post', '/publish', {});
  assert.equal(ribbonText(await live(app)), 'Third');
  assert.equal((await send('post', '/undo', {})).status, 200);
  assert.equal(ribbonText(await live(app)), 'First');
});

test('studio: invalid drafts are refused and schedules are kept', async () => {
  const { send } = await studioAdmin();
  const bad = withRibbon('x');
  bad.blocks[bad.blocks.length - 1].link = 'javascript:alert(1)';
  assert.equal((await send('put', '', { draft: bad })).status, 400);
  const scheduled = withRibbon('x');
  scheduled.blocks[scheduled.blocks.length - 1].showFrom = '2099-01-01T10:00:00.000Z';
  const saved = await send('put', '', { draft: scheduled });
  assert.equal(saved.body.data.draft.blocks.find((b) => b.id === 'r').showFrom, '2099-01-01T10:00:00.000Z');
});
