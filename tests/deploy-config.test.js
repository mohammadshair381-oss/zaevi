import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { clientAddress, createRateLimiter, PROXY_SECRET_HEADER } from '../src/middleware/rate-limit.js';
import { CONTENT_SECURITY_POLICY, isPublicStaticPath } from '../src/middleware/security.js';
import { resolveUploadDir } from '../src/routes/cms.js';
import { buildStatic, deploymentProblems } from '../scripts/build-static.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const SECRET = 'a-shared-secret-of-at-least-32-characters';

const visitor = (headers = {}) => ({ ip: '10.0.0.1', headers });

test('a forwarded address is believed only with the correct proxy secret', () => {
  const forwarded = { 'x-forwarded-for': '203.0.113.9, 198.51.100.1' };
  assert.equal(clientAddress(visitor(forwarded), SECRET), '10.0.0.1');
  assert.equal(clientAddress(visitor({ ...forwarded, [PROXY_SECRET_HEADER]: 'wrong' }), SECRET), '10.0.0.1');
  assert.equal(clientAddress(visitor({ ...forwarded, [PROXY_SECRET_HEADER]: SECRET }), SECRET), '203.0.113.9');
  assert.equal(clientAddress(visitor({ ...forwarded, [PROXY_SECRET_HEADER]: '' }), ''), '10.0.0.1');
  assert.equal(clientAddress(visitor({ 'x-forwarded-for': 'not-an-ip', [PROXY_SECRET_HEADER]: SECRET }), SECRET), '10.0.0.1');
});

test('visitors behind the proxy get separate limits and spoofed headers do not help', () => {
  const previous = process.env.PROXY_SECRET;
  process.env.PROXY_SECRET = SECRET;
  try {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    const res = { setHeader() {} };
    const run = (headers) => {
      let error = null;
      limiter(visitor(headers), res, (e) => { error = e ?? null; });
      return error?.status ?? 200;
    };
    const through = (ip) => ({ 'x-forwarded-for': ip, [PROXY_SECRET_HEADER]: SECRET });
    assert.equal(run(through('203.0.113.1')), 200);
    assert.equal(run(through('203.0.113.2')), 200);
    assert.equal(run(through('203.0.113.1')), 429);
    assert.equal(run({ 'x-forwarded-for': '198.51.100.1' }), 200);
    assert.equal(run({ 'x-forwarded-for': '198.51.100.2' }), 429);
  } finally {
    if (previous === undefined) delete process.env.PROXY_SECRET;
    else process.env.PROXY_SECRET = previous;
  }
});

test('API responses are not cacheable by the CDN', async () => {
  const app = createApp({ logger: { log() {}, error() {} }, sessionSecret: SECRET, prisma: {} });
  const response = await request(app).get('/api/no-such-route');
  assert.equal(response.status, 404);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('the upload folder can move to a disk and keeps its default', () => {
  assert.equal(resolveUploadDir({}, path.resolve('/srv/app')), path.resolve('/srv/zaevi-cms-uploads'));
  assert.equal(resolveUploadDir({ UPLOAD_DIR: '/var/data/uploads' }), path.resolve('/var/data/uploads'));
});

test('the Vercel build publishes only the public allowlist', async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'zaevi-dist-'));
  try {
    const files = await buildStatic({ outDir });
    assert.ok(files.includes('index.html'));
    assert.ok(files.includes('main.js'));
    assert.ok(files.includes('assets/zaevi-icon.png'));
    assert.ok(files.every((file) => isPublicStaticPath(`/${file}`)));
    for (const file of ['admin.html', 'site-studio.html', 'homepage-editor.html', 'README.md', '.env', '.env.example', 'package.json', 'vercel.json', 'prisma.config.ts']) {
      assert.equal(existsSync(path.join(outDir, file)), false, `${file} must not be published`);
    }
    const topLevel = readdirSync(outDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    assert.deepEqual(topLevel, ['assets']);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('a Vercel build stops when its settings are missing', () => {
  const good = { VERCEL: '1', BACKEND_URL: 'https://zaevi-api.onrender.com', PROXY_SECRET: SECRET };
  assert.deepEqual(deploymentProblems({}), []);
  assert.deepEqual(deploymentProblems(good), []);
  assert.equal(deploymentProblems({ ...good, BACKEND_URL: undefined }).length, 1);
  assert.equal(deploymentProblems({ ...good, BACKEND_URL: 'https://zaevi-api.onrender.com/' }).length, 1);
  assert.equal(deploymentProblems({ ...good, BACKEND_URL: 'http://zaevi-api.onrender.com' }).length, 1);
  assert.equal(deploymentProblems({ ...good, PROXY_SECRET: 'short' }).length, 1);
});

test('vercel.json proxies server routes with the secret and matches the server headers', () => {
  const config = JSON.parse(read('vercel.json'));
  assert.equal(config.framework, null, 'Vercel must not turn src/server.js into a function');
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.routes.length, 3);
  for (const route of config.routes) {
    assert.deepEqual(route.env, ['BACKEND_URL']);
    assert.match(route.dest, /^\$\{BACKEND_URL\}\//);
    const [transform] = route.transforms;
    assert.equal(transform.target.key, PROXY_SECRET_HEADER);
    assert.equal(transform.op, 'set');
    assert.deepEqual(transform.env, ['PROXY_SECRET']);
  }
  const matches = (url) => config.routes.some((route) => new RegExp(route.src).test(url));
  for (const url of ['/api/products', '/admin', '/admin/', '/admin/studio', '/admin/recovery']) assert.equal(matches(url), true, url);
  for (const url of ['/admin.css', '/admin-recovery.html', '/index.html', '/apidocs']) assert.equal(matches(url), false, url);
  const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
  assert.equal(headers['Content-Security-Policy-Report-Only'], CONTENT_SECURITY_POLICY);
});

test('render.yaml keeps uploads on a persistent disk', () => {
  const blueprint = read('render.yaml');
  const mount = blueprint.match(/disk:\n\s+name: \w+\n\s+mountPath: (\S+)/)?.[1];
  const uploads = blueprint.match(/- key: UPLOAD_DIR\n\s+value: (\S+)/)?.[1];
  assert.ok(mount, 'no disk');
  assert.ok(uploads?.startsWith(`${mount}/`), 'uploads must be inside the disk');
  assert.doesNotMatch(blueprint, /^\s+plan: free$/m, 'the free plan cannot have a disk');
});

test('render.yaml holds no secrets and uses a port the free plan allows', () => {
  const blueprint = read('render.yaml');
  for (const key of ['DATABASE_URL', 'ZAEVI_PRODUCTION_DB_APPROVED', 'PROXY_SECRET', 'SMTP_PASS', 'EMAIL_FROM', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
    assert.match(blueprint, new RegExp(`- key: ${key}\\n\\s+sync: false`), key);
  }
  assert.match(blueprint, /- key: SESSION_SECRET\n\s+generateValue: true/);
  assert.match(blueprint, /- key: SMTP_PORT\n\s+value: "2587"/);
  assert.match(blueprint, /buildCommand: npm ci --include=dev && npx prisma generate/);
});

test('migrations name tables exactly as the schema does, as Linux MySQL requires', () => {
  const models = new Set([...read('prisma/schema.prisma').matchAll(/^model (\w+) \{/gm)].map((match) => match[1]));
  const folders = readdirSync(path.join(root, 'prisma/migrations'), { withFileTypes: true }).filter((entry) => entry.isDirectory());
  assert.ok(folders.length > 0);
  for (const { name } of folders) {
    const sql = read(`prisma/migrations/${name}/migration.sql`);
    for (const match of sql.matchAll(/\b(?:TABLE(?: IF (?:NOT )?EXISTS)?|REFERENCES|UPDATE|INTO|FROM|JOIN)\s+`(\w+)`/gi)) {
      assert.ok(models.has(match[1]), `${name} refers to \`${match[1]}\`, which is not a model name`);
    }
  }
});

test('Git keeps secrets out and migration bytes intact', () => {
  const ignored = read('.gitignore').split(/\r?\n/);
  for (const rule of ['.env', '.env.*', '!.env.example', 'node_modules/', 'dist/', '*.sql', '!prisma/migrations/**/migration.sql', 'docs/pre-launch/', 'backups/', 'zaevi-cms-uploads/', '*.csv', '*.pem']) {
    assert.ok(ignored.includes(rule), rule);
  }
  assert.match(read('.gitattributes'), /^prisma\/migrations\/\*\* -text$/m);
});
