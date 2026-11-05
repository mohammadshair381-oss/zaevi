# ZAEVI

ZAEVI is a contemporary luxury fashion storefront built with static HTML, CSS
and vanilla JavaScript, served by an Express backend. The backend stores the
product catalog, customer accounts, addresses and orders in MongoDB Atlas (via Mongoose),
and exposes catalog, checkout, tracking and admin APIs.

The code is split into `frontend/` (the storefront) and `backend/` (the API). See "Project layout".

## Production model

ZAEVI pieces are **produced on demand**. There is no warehouse inventory:

- checkout never checks, reserves or deducts stock;
- an order is never rejected because a size has zero or unknown stock;
- product sizes are catalog options, validated to exist for the product;
- product availability is a separate, business-controlled flag
  (`Product.available`), not an inventory count;
- there is no inventory dashboard or stock-editing UI.

Orders move through this production workflow:

`Order Received` → `Confirmed` → `In Production` → `Quality Check` → `Packed`
→ `Shipped` → `Delivered`

Cancellation is allowed until the order has shipped. `Delivered` and
`Cancelled` are terminal. Historical orders keep the stored status value
`pending`, which is displayed as **Order Received**; existing rows are never
rewritten.

## Run it locally

Requirements: Node.js >= 20.11 (developed and tested on Node.js 24.15.0), npm,
and a MongoDB Atlas cluster (MongoDB transactions need a replica set, which Atlas always provides).

```bash
npm install

# 1. Set MONGODB_URI (see "Configuration" below), then:
npm run db:setup           # create collections, indexes and default records
npm run import:products    # import products.json into MongoDB

npm start                  # http://localhost:3000
npm run dev                # same, with file watching
```

Then open http://localhost:3000.

> Preview through the server, not the filesystem. Opening `index.html`
> directly (`file://`) shows the page shell with empty product grids, because
> browsers block `fetch` of `/api/...` and `products.json` for `file://` URLs.

## Pages

Home, Women, Men, Collections, Product detail, About, Journal, Account,
Wishlist, Checkout, Order Confirmation, Track Order, Contact, FAQ, Size Guide,
Shipping, Returns, Privacy, Terms, Accessibility, Reset Password, Unsubscribe, Admin.

## Implemented and tested

**Catalog / data**

- `Product` and `ProductSize` models, defined in `backend/src/db/schema.js`.
- Idempotent importer from `products.json`: preserves business ids (`ZV001`…)
  and size order, upserts in place, and never deletes rows.
- Product availability is a separate business flag. Sizes remain selectable
  regardless of any legacy stock value.

**Accounts and addresses**

- Register, sign in, sign out and session lookup (`/api/auth/*`).
- Customer order history (`/api/customer/orders`).
- Saved delivery addresses with ownership checks and one default per customer
  (`/api/customer/addresses/*`).

**Checkout and orders**

- Server-side validation, pricing from the catalog, integer-paise totals and
  historical item snapshots.
- Idempotent order creation with an `Idempotency-Key` header.
- Guest checkout compatibility remains available; the storefront policy can
  require a signed-in customer.
- CSRF protection for authenticated state-changing requests.
- No stock validation, reservation or deduction.

**Production workflow**

- Admin-only status updates with validated sequential transitions and
  cancellation rules.
- Concurrent updates cannot silently skip or overwrite a transition.
- Customer-facing status labels, timeline and public order tracking.
- Public tracking requires **both** the order reference and the checkout email
  via `POST /api/orders/track` (rate limited; the email stays out of the URL).

**Admin**

- Server-protected `/admin` page and `/api/admin/*` APIs.
- Database-derived dashboard statistics (no invented inventory metrics).
- Paginated orders and products, status filtering and workflow controls.
- No stock or inventory editing endpoints.

**Storefront**

- Homepage product grid; Women/Men catalog pages with category filter and sort.
- Product detail pages, including a clear not-found state for unknown ids.
- Search overlay (API-first, falling back to `products.json`).
- Wishlist rendering + persistence; cart via `localStorage`, hardened against
  malformed stored data.
- Scroll-reveal animations, image hover transitions, animated loader and
  custom cursor; customer-service pages.

**Static security**

- Sensitive paths (`src/`, `.env`, `package*.json`, `node_modules/`, `tests/`,
  dotfiles) return `404`.
- Admin HTML is not served statically; it is gated by the admin API page route.

## Not implemented (deferred — do not rely on these)

- Live payment capture. The Razorpay routes in `src/routes/payments.js` need
  `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`, and
  have not been run against real keys.
- Shipping-carrier integration and SMS notifications.
- Tax, discount and shipping-fee rules.
- Inventory quantities or stock management. This is intentional: ZAEVI is
  produced on demand.

## Database environments

`backend/src/config/database.js` decides which database is used, for the app and its scripts alike:

| Environment | Database | Requirement |
| --- | --- | --- |
| Development and test | `zaevi_test` | None. A `MONGODB_URI` naming `zaevi` is redirected. |
| Production | `zaevi` | `NODE_ENV=production` and `ZAEVI_PRODUCTION_DB_APPROVED=true`. A `MONGODB_URI` naming any other database refuses to start. |

The server logs the database it is using when it starts. Demo accounts exist only in
`zaevi_test`.

### How data is stored

`backend/src/db/schema.js` defines every collection, its fields, relationships and indexes. `models.js`
builds the Mongoose models from it, and `client.js` is the data client the routes call
(`db.order.findUnique({ where, include })`). MongoDB has no foreign keys, automatic numbering or
column limits, so the client supplies them:

- **Numeric ids:** records keep the numeric ids the API and pages use, numbered through a `counters` collection.
- **Relationships:** `include` and `select` load related records. Links to a missing record are refused.
- **Delete rules:** deleting a record cascades, clears links or is refused, as set in `schema.js`.
- **Matching:** collections ignore case and accents, so emails and coupon codes match as people expect, including in unique rules.
- **Empty values:** an optional unique field allows many empty values, but no repeated value.
- **Safety:** filters are built from a fixed list of operators, so a request can't pass in a MongoDB operator such as `{"$ne": null}`.

## Site Studio

`/admin/studio` is how the homepage is edited: add, reorder, hide and schedule sections,
moving ribbons and events, change the main banner, top strip, colours and movement, with
a live preview. Edits are saved as a draft automatically, and nothing reaches shoppers
until Publish is pressed. Undo restores the version live before the last publish.

- `src/models/site-studio.js` validates everything, and `zaevi-studio.js` draws it.
- If nothing is published, or the content cannot be read, the storefront shows its
  built-in content.
- Add new built-in homepage sections with a `data-block` attribute in `index.html`.

The older Homepage Editor (`/admin/homepage-editor`) and its saved draft do not affect
the storefront, so they are no longer linked from the admin menu.

## Password reset

Signing up, signing in and resetting a password all need a 6-digit code sent by email
(`src/services/email-otp.js`). No session begins until the code is entered. Each code
lasts 10 minutes, allows 5 guesses and works once, and only hashes are stored.
`src/server.js` turns this on with `emailOtp: true`; `createApp` leaves it off by default
for tests that are not about sign-in.

**Without SMTP, nobody can sign in on production.** The pages say so plainly and create no
code. The only exception is development on `zaevi_test`, where codes are written to the
server log, as they are for `.test` demo addresses, which cannot receive email. No other
environment ever logs a code. Check the settings with `npm run check:email -- you@example.com`.

A reset signs out every device. Changing a password while signed in signs out every other
device and gives the current one a new session ID. Sessions live in the server's memory,
so run a single server process.

Pre-launch records are kept in `docs/pre-launch` on the owner's machine, outside Git.

## Email, contact messages and payments

- **Email:** `src/services/email.js` sends over SMTP using `SMTP_*` and `EMAIL_FROM`.
  Notifications are stored first and delivered in the background, with the real
  outcome saved as `sent`, `failed` or `not_configured`. Admins can retry from the
  Notifications tab, so nothing is lost if SMTP is added later.
- **Contact form:** `POST /api/contact` stores the message, then emails
  `CONTACT_NOTIFY_EMAIL`, or `CONTACT_EMAIL` if that is empty. Read and resolve
  messages in the admin Messages tab.
- **Official contact address:** `CONTACT_EMAIL` is shown on the website and invoices.
  Until it is set, the website offers only the contact form.
- **GSTIN:** invoices print `BUSINESS_GSTIN`, or a marked placeholder until it is set.
- **ATELIER10:** the newsletter coupon is created by `npm run db:setup`: 10% off, one use
  per customer, current newsletter subscribers only, 1,000 uses in total, until
  3 November 2027. The offer shown after subscribing is read from the coupon, so
  it stays accurate if the coupon changes or runs out.
- **Razorpay:** set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and
  `RAZORPAY_WEBHOOK_SECRET`, then register `/api/payments/webhook` in the Razorpay
  dashboard. Pay Now stays hidden until keys are set, and orders can still be placed.

## Demo accounts (development and testing only)

`node backend/scripts/seed-demo-account.cjs` creates the demo accounts in `zaevi_test`. It
refuses any other database and refuses to run when `NODE_ENV=production`. The
credentials are in that script. Never add these accounts to production.

## Design system and live effects

The theme is "Nocturne Rouge": warm black, bone text and the logo's crimson, set
in Bodoni Moda and Jost.

- `style.css`, `luxury-enhancements.css` and `zaevi-animations.css` hold the
  storefront styles; `admin.css` and `homepage-editor.css` hold the admin ones.
- Some token names are historical. `--paper*` are dark surfaces, `--ink*` and
  `--zaevi-obsidian` are light text, and `--gold*` and `--zaevi-gold*` hold the
  crimson accent. Text on a bone fill uses `--on-ink`.
- `zaevi-3d.js` draws the fixed WebGL silk behind each storefront page, the
  homepage monogram and the 3D Studio. It lowers quality on slow devices and falls
  back to a CSS backdrop and the hero photograph without WebGL.
- `zaevi-animations.js` runs the cursor, page transition and live effects.
- Motion is off under `prefers-reduced-motion`.
- New static files must be added to the allowlist in `src/middleware/security.js`,
  or they return 404.

## Configuration

Copy `backend/.env.example` to `backend/.env` and set the values:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development`, `test`, or `production` |
| `PORT` | no | `3000` | HTTP port for the Express server |
| `MONGODB_URI` | **yes** | — | MongoDB Atlas link (must start with `mongodb://` or `mongodb+srv://`) |
| `MONGODB_DNS_SERVERS` | no | — | DNS servers to use if connecting fails with `querySrv ECONNREFUSED` |
| `SESSION_SECRET` | in production | — | Session signing secret, at least 32 characters |
| `ORDER_RATE_LIMIT_MAX` | no | `30` | Order/tracking requests allowed per IP per window |
| `ORDER_RATE_LIMIT_WINDOW_MS` | no | `60000` | Order/tracking rate-limit window |
| `AUTH_RATE_LIMIT_MAX` | no | `10` | Sign-in/registration attempts allowed per IP per window |
| `AUTH_RATE_LIMIT_WINDOW_MS` | no | `900000` | Authentication rate-limit window |
| `PROXY_SECRET` | on hosting | — | Lets the server trust the visitor address from the Vercel proxy; same value on Render and Vercel |
| `UPLOAD_DIR` | no | `../zaevi-cms-uploads` | Where uploaded images are stored; use a persistent disk on hosting |
| `ADMIN_RECOVERY_*` | no | off | Emergency admin sign-in during an email outage; see docs/deployment.md |

The link is validated at startup, and other database schemes are rejected.
`backend/.env` is git-ignored and blocked from static serving — never commit real
credentials.

### Local setup

Put your Atlas link in `backend/.env` as `MONGODB_URI`, then, from the main folder:

```bash
npm run db:setup             # collections, indexes, default settings and coupon
npm run import:products      # loads products.json (12 products, 49 size rows)
node backend/scripts/seed-demo-account.cjs   # demo accounts, zaevi_test only
```

## Tests

```bash
npm test
```

Uses Node's built-in test runner with `supertest`, one file at a time. Mock tests need no database.
The live-database tests (`backend/tests/*.db.test.js`) run when `MONGODB_URI` reaches a database, and are
skipped, never failed, otherwise. They refuse any database whose name doesn't end in `zaevi_test`.

They create temporary records, so use a separate database. To do that, name it in the link, set up
that database once, then run the suite:

```powershell
$env:NODE_ENV='test'
$env:MONGODB_URI='mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/ci_zaevi_test'
npm run db:setup
npm run import:products
node backend/scripts/seed-demo-account.cjs
npm test
```

`backend/tests/data-client.db.test.js` proves the data client's rules and races on a real database, and
`backend/tests/api-journey.db.test.js` walks every part of the shop over HTTP.

### Retired stock field

`ProductSize.stock` is left over from a brief warehouse experiment. It stays hidden, and the
application never reads or writes it.

## Deployment

GitHub holds the code, Vercel serves the storefront, Render runs the Express API, and
Resend sends email over SMTP. Follow [docs/deployment.md](docs/deployment.md).

## Project layout

```text
zaevi/
├── frontend/             Everything the browser loads
│   ├── *.html            Public pages, with the same addresses as ever (/women.html)
│   ├── admin/            Private pages, served only by the backend after its login check
│   ├── css/              Stylesheets
│   ├── js/               Scripts, with third-party libraries in js/vendor/
│   ├── assets/           Images
│   ├── data/             products.json, the catalog source and offline fallback
│   └── robots.txt, sitemap.xml
├── backend/              The Express API
│   ├── src/
│   │   ├── server.js     Starts the app
│   │   ├── app.js        Builds the app and its routes
│   │   ├── config/       Environment and database rules
│   │   ├── db/           Collection definitions, Mongoose models, data client, connection
│   │   ├── middleware/   Sessions, CSRF, rate limits, security
│   │   ├── models/       Validation and business rules
│   │   ├── routes/       API endpoints
│   │   └── services/     Email, sign-in codes, notifications, emergency sign-in
│   ├── scripts/          Setup and operator tools
│   ├── tests/            Automated tests
│   ├── package.json
│   └── .env              Your settings, never committed (copy from .env.example)
├── docs/deployment.md    How to go live
├── render.yaml           Render settings for the API
├── vercel.json           Vercel settings for the storefront
└── package.json          Shortcuts, so npm commands work from the main folder
```

**Where to change things**

| To change | Go to |
| --- | --- |
| A page's content | `frontend/*.html` |
| The look of the site | `frontend/css/style.css` |
| Storefront behaviour | `frontend/js/main.js` |
| An API endpoint | `backend/src/routes/` |
| What is stored | `backend/src/db/schema.js` |
| Which files are public | `PUBLIC_ROOT_FILES` in `backend/src/middleware/security.js`, a new public file must be listed here |

**Scripts in `backend/scripts/`**

- `db-setup.mjs`: creates collections, indexes and default records (`npm run db:setup`)
- `import-products.js`: catalog importer (`npm run import:products`)
- `build-static.mjs`: builds `dist/` for Vercel from the public file list
- `create-admin.cjs`: creates an administrator
- `seed-demo-account.cjs`: creates the demo accounts in `zaevi_test` only
- `check-email.mjs`: sends a test email (`npm run check:email`)
- `create-admin-recovery.mjs`: creates emergency admin sign-in settings (`npm run admin:recovery`)
- `verify-customer-journey.mjs`: end-to-end customer check on `zaevi_test`

---

For a production launch, connect payments, shipping-carrier tracking, email/SMS
and any required tax rules, then replace the demo Unsplash photography with
licensed ZAEVI imagery.
