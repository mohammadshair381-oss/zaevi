/**
 * Clean page addresses for the storefront: /about serves about.html, /product?id=ZV001
 * serves product.html with its query string, and so on. The browser keeps the clean
 * address. This mirrors the clean-address route in vercel.json, so the server and the
 * Vercel site answer the same way.
 *
 * Only pages in the public storefront allowlist are mapped, never a catch-all: admin
 * pages, unknown names, trailing slashes and anything with a dot in its name fall
 * through unchanged. Old .html addresses are still served as before; main.js then shows
 * the clean address in the address bar without reloading the page.
 */
import { isPublicStaticPath } from './security.js';

const CLEAN_PAGE = /^\/([a-z0-9-]+)$/;

/** The page file a clean address serves, or null when the address is not a storefront page. */
export function pageFileFor(requestPath) {
  const match = CLEAN_PAGE.exec(requestPath);
  if (!match || match[1] === 'index') return null;
  const file = `/${match[1]}.html`;
  return isPublicStaticPath(file) ? file : null;
}

/** Express middleware: register before the static allowlist and file handler. */
export function cleanPageUrls() {
  return function cleanPageUrlHandler(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const file = pageFileFor(req.path);
    if (!file) return next();
    const queryAt = req.url.indexOf('?');
    req.url = file + (queryAt === -1 ? '' : req.url.slice(queryAt));
    return next();
  };
}
