import path from 'node:path';

/**
 * Paths that must never be served as static content. These cover
 * environment files, package/dependency files, backend source, tests and
 * internal scripts.
 */
const BLOCKED_SEGMENTS = new Set([
  'node_modules',
  'src',
  'backend',
  'server',
  'tests',
  'test',
  'scripts',
  'coverage',
  'logs',
  '.git',
  '.github',
  '.vscode',
]);

const BLOCKED_FILES = new Set([
  'admin.html', // served only by the guarded GET /admin route (role-gated)
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'server.js',
  'app.js',
  '.gitignore',
  '.dockerignore',
  '.npmrc',
  '.editorconfig',
]);

/**
 * Public storefront allowlist.
 *
 * The storefront lives in the project root alongside internal reports, test
 * output, backups, helper scripts and backend source. The previous denylist
 * approach protected known-sensitive names but left newly added `.md`, `.txt`,
 * `.bak`, `.mjs` and similar files publicly readable. Serving only the files
 * the storefront actually needs makes the public surface explicit and keeps
 * new internal files private by default.
 *
 * `admin.html` is intentionally absent: it is served only by the guarded
 * `/admin` route after the database-backed role gate.
 */
const PUBLIC_HTML_PAGES = new Set([
  'index.html',
  'women.html',
  'men.html',
  'collections.html',
  'product.html',
  'about.html',
  'journal.html',
  'journal-language-of-black.html',
  'journal-behind-the-collection.html',
  'journal-new-silhouette.html',
  'account.html',
  'wishlist.html',
  'checkout.html',
  'order-confirmation.html',
  'track.html',
  'contact.html',
  'faq.html',
  'size-guide.html',
  'shipping.html',
  'returns.html',
  'privacy.html',
  'terms.html',
  'accessibility.html',
  'reset-password.html',
  'unsubscribe.html',
]);

/** Public files by their path under frontend/. Private pages in frontend/admin/ are never listed. */
const PUBLIC_ROOT_FILES = new Set([
  ...PUBLIC_HTML_PAGES,
  'robots.txt',
  'sitemap.xml',
  'css/admin.css',
  'css/homepage-editor.css',
  'css/luxury-enhancements.css',
  'css/site-studio.css',
  'css/style.css',
  'css/zaevi-animations.css',
  'data/products.json',
  'js/cms-public.js',
  'js/homepage-editor.js',
  'js/homepage-media.js',
  'js/homepage-preview.js',
  'js/homepage-sidebar.js',
  'js/homepage-theme.js',
  'js/luxury-enhancements.js',
  'js/main.js',
  'js/site-studio.js',
  'js/vendor/gsap.min.js',
  'js/vendor/three.min.js',
  'js/zaevi-3d.js',
  'js/zaevi-animations.js',
  'js/zaevi-studio.js',
]);

/** Only browser image formats are public beneath `/assets/`. */
const PUBLIC_ASSET_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.avif',
  '.ico',
]);

/**
 * Content Security Policy required by the current storefront.
 *
 * Sources are derived from an inspection of the served files:
 * - `script-src 'self' 'unsafe-inline'`  : `main.js` plus the inline <script>
 *   blocks in `admin.html`/`checkout.html` and inline event handlers
 *   (e.g. `onclick` in the cart drawer). 'unsafe-inline' is required because
 *   that content cannot be hashed/nonced without editing the HTML/JS.
 * - `style-src   'self' 'unsafe-inline' https://fonts.googleapis.com` :
 *   `style.css`/`admin.css`, pervasive inline `style="..."` attributes (and
 *   inline styles injected by `main.js`), and the Google Fonts `@import`.
 * - `img-src     'self' https://images.unsplash.com` : local assets and the
 *   Unsplash background/product images.
 * - `font-src    'self' https://fonts.gstatic.com`   : webfont binaries.
 * - `connect-src 'self'` : same-origin `fetch('/api/products')` and
 *   `fetch('products.json')`.
 * - `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`,
 *   `form-action 'self'` : lock down plugin content, <base> hijacking,
 *   framing and form targets.
 *
 * `'unsafe-inline'` does NOT provide strict script protection: any injected
 * inline script would still execute. A strict policy requires refactoring the
 * frontend to nonces/hashes (out of scope here), so this policy is delivered
 * as Report-Only first (see `securityHeaders`).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
  "img-src 'self' data: https://images.unsplash.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Apply baseline security headers to every response. Must be registered as
 * early as possible so API, static, 404 and error responses all carry them.
 *
 * - X-Content-Type-Options / X-Frame-Options / Referrer-Policy are enforced
 *   unconditionally (they cannot break the storefront).
 * - Content-Security-Policy is sent as `Content-Security-Policy-Report-Only`:
 *   the browser still loads the resources but reports violations of the
 *   policy instead of blocking them, so an unverified policy cannot silently
 *   break existing functionality.
 * - Strict-Transport-Security is intentionally omitted: it is only meaningful
 *   over HTTPS and this project has no HTTPS deployment configured yet.
 */
export function securityHeaders() {
  return function applySecurityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy-Report-Only', CONTENT_SECURITY_POLICY);
    next();
  };
}

function isBlockedPath(requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return true;
  }

  if (decoded.includes('\0')) {
    return true;
  }

  const segments = decoded.split(/[\\/]+/).filter(Boolean);

  return segments.some((rawSegment) => {
    const segment = rawSegment.toLowerCase();
    if (segment.startsWith('.')) return true;
    if (BLOCKED_SEGMENTS.has(segment)) return true;
    if (BLOCKED_FILES.has(segment)) return true;
    if (/^\.env(\..+)?$/.test(segment)) return true;
    return false;
  });
}

/**
 * Express middleware that rejects requests for sensitive files/directories
 * with a 404 so their existence is not disclosed. Must be registered before
 * the static-file handler.
 */
export function blockSensitivePaths() {
  return function sensitivePathGuard(req, res, next) {
    if (isBlockedPath(req.path)) {
      return res.status(404).type('text/plain').send('Not Found');
    }
    return next();
  };
}

/**
 * True only for paths the public storefront is allowed to retrieve.
 *
 * API routes are not static assets and are handled before this check. The
 * function rejects encoded/double-encoded traversal, dot segments and any
 * root file not explicitly listed above. Assets are limited to `/assets/` and
 * browser image extensions.
 */
export function isPublicStaticPath(requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return false;
  }

  // A second encoding pass could hide `..` or a path separator from the
  // allowlist. Public filenames never contain a literal percent sign.
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes('%')) {
    return false;
  }

  const segments = decoded.split('/').filter(Boolean);
  if (segments.length === 0) return true; // `/` -> index.html

  if (segments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))) {
    return false;
  }

  if (PUBLIC_ROOT_FILES.has(segments.join('/').toLowerCase())) return true;

  if (segments[0].toLowerCase() !== 'assets') return false;

  const extension = path.extname(segments[segments.length - 1]).toLowerCase();
  return PUBLIC_ASSET_EXTENSIONS.has(extension);
}

/**
 * Express middleware that serves only the explicit public static allowlist.
 * Unknown paths are rejected with the same plain 404 as other blocked paths;
 * API 404s are handled earlier and keep their JSON shape. Must be registered
 * before the static-file handler.
 */
export function publicStaticPaths() {
  return function publicStaticPathGuard(req, res, next) {
    if (!isPublicStaticPath(req.path)) {
      return res.status(404).type('text/plain').send('Not Found');
    }
    return next();
  };
}

export { isBlockedPath };
