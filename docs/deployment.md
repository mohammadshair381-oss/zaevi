# Deploying ZAEVI

| Service | Job |
| --- | --- |
| GitHub | Holds the code. Vercel and Render deploy from it |
| Vercel | Serves the public pages and is the address customers visit |
| Render | Runs the Express API |
| MongoDB Atlas | Stores the data |
| Resend | Sends email over SMTP |

Vercel forwards `/api/*` and `/admin*` to Render, so the browser sees one website and sign-in cookies keep working.

## 1. Push to GitHub

Use a **private** repository. The README and tests include the demo logins, which work only on `zaevi_test`.

`.env`, backups, database dumps, data exports, uploads, certificates and `docs/pre-launch/` are ignored by Git.

## 2. Prepare MongoDB Atlas

The server decides the database from its environment. Production always uses `zaevi`, and development and tests use `zaevi_test`.

1. Pick a paid cluster for the real shop, in the same region as your Render service. Atlas's free tier is too limited for a live store: 0.5 GB, 100 operations a second, and no automatic scaling.
2. Under **Database Access**, create a user for the app with read and write access, not an Atlas admin.
3. Under **Network Access**, add Render's outbound addresses. You'll find them in the Render service under **Connect > Outbound**, so this step finishes after step 4. Avoid allowing every address (`0.0.0.0/0`).
4. Turn on backups, and test a restore before launch.
5. To prepare a new database, run these in PowerShell with the real link, then close the window so these settings don't affect anything you run later:

   ```powershell
   $env:NODE_ENV='production'
   $env:ZAEVI_PRODUCTION_DB_APPROVED='true'
   $env:MONGODB_URI='mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority'
   npm run db:setup
   ```

   This creates the collections and every index, including the unique rules, and adds the default settings and newsletter coupon. It never changes existing records.
6. If the database is empty, also run `node scripts/create-admin.cjs` in that window, using a mailbox you can read. Admins need an emailed code to sign in.

**If connecting fails with `querySrv ECONNREFUSED`,** that computer's DNS can't answer the lookup Atlas links use. Set `MONGODB_DNS_SERVERS`, for example to `8.8.8.8,1.1.1.1`.

## 3. Set up Resend

1. Add and verify your domain in Resend.
2. Create an API key. It is used as the SMTP password, so keep it out of Git and chat.
3. Choose a sender on that domain, for example `ZAEVI <clients@your-domain.com>`.

## 4. Deploy the API on Render

1. Generate a secret once. It goes on both Render and Vercel:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. In Render, choose **New > Blueprint** and select the repository. It reads `render.yaml`.
3. Enter the values it asks for:

   | Variable | Value |
   | --- | --- |
   | `MONGODB_URI` | Your Atlas link. It may name the `zaevi` database or none |
   | `ZAEVI_PRODUCTION_DB_APPROVED` | `true`, once launch is approved |
   | `PROXY_SECRET` | The secret from step 1 |
   | `SMTP_PASS` | Your Resend API key |
   | `EMAIL_FROM` | Your verified sender |
   | `CONTACT_NOTIFY_EMAIL` | Where contact-form messages go |
   | `CONTACT_EMAIL`, `BUSINESS_GSTIN`, `RAZORPAY_*` | Leave empty until you have real values |

4. Wait for the deploy, then open `https://YOUR-SERVICE.onrender.com/api/health`. It should report `"status":"ok"`.

### Plan and uploaded images

`render.yaml` uses a paid plan with a 1 GB disk at `/var/data`, and `UPLOAD_DIR` points inside it. **This costs money.** Render shows the price before you confirm.

| Behaviour | What to expect |
| --- | --- |
| Uploaded images | Kept across restarts and deploys, because only the disk survives. Render snapshots it every 24 hours and keeps snapshots for 7 days |
| Deploys | A few seconds of downtime, because a service with a disk cannot deploy without it |
| Scaling | One instance only. Sessions and rate limits are per process, so it must stay that way |
| Sessions | Held in memory, so every restart or deploy signs everyone out |

For a short trial you could use `plan: free` and remove `disk` and `UPLOAD_DIR`. Uploaded images would then vanish on restart, the service would sleep after 15 minutes without traffic, and the first visitor after that would wait about a minute.

## 5. Deploy the storefront on Vercel

1. Choose **Add New > Project** and import the repository. `vercel.json` sets the build.
2. Check that the Framework Preset says **Other**. If it says Express, set it to Other.
3. Add these environment variables, then deploy:

   | Variable | Value |
   | --- | --- |
   | `BACKEND_URL` | `https://YOUR-SERVICE.onrender.com`, with no trailing slash |
   | `PROXY_SECRET` | The same secret as on Render |

The build stops with a clear message if either is missing or malformed.

4. Add your domain in Vercel. `sitemap.xml` currently lists `https://www.zaevi.com`, so update it if your domain differs.
5. If you use Razorpay, register `https://YOUR-DOMAIN/api/payments/webhook` as the webhook.

## 6. Check the live site

These can only be proven on the real hosts:

- [ ] Home, Women, Men and a product page load, with no broken images.
- [ ] Product search returns results, which proves query strings reach the API.
- [ ] Sign up, and a code arrives by email from your domain.
- [ ] Sign in with a code, refresh, and you stay signed in. This proves cookies pass through Vercel.
- [ ] Place a test order, and the confirmation email arrives.
- [ ] Sign out. `/admin` shows Not Found until an admin signs in.
- [ ] Rate limits are per visitor: fail sign-in repeatedly on one network until you are blocked, then confirm another network, such as mobile data, can still sign in.
- [ ] `/admin.html`, `/README.md`, `/src/server.js` and `/.env` all return 404 on your domain.
- [ ] Upload an image in the admin panel, redeploy on Render, and confirm the image still loads.
- [ ] `/admin/recovery` returns 404 on your domain.

## Emergency admin sign-in

Admins need an emailed code to sign in, so an email outage would lock them out. This is the way back in. It is **off** unless configured.

| Protection | How it works |
| --- | --- |
| Password still required | It replaces only the emailed code. The account's password and admin role are still checked |
| One named admin | Only the address in `ADMIN_RECOVERY_EMAIL` can use it |
| Short window | Refused if the expiry is past or more than 24 hours away |
| Single use | Each use is stored, so a code cannot be reused, even after a restart |
| Nothing stored that opens the door | The server holds only a hash of the code |
| Recorded | Each use appears under Notifications and in the logs, and an alert email is attempted |

**To use it:**

1. On your own computer, run `npm run admin:recovery -- owner@your-domain.com`. It prints a code and four settings, and saves nothing.
2. Keep the code in your password manager. Add the four settings on Render, which restarts the service.
3. Open `https://YOUR-DOMAIN/admin/recovery` and enter your email, password and the code.
4. Fix email, then **remove the four settings**. `/admin/recovery` returns to 404.

It needs a working database. It cannot help with a forgotten password, because the password is still required.

## Later updates

Pushing to GitHub redeploys both services. Run `npm run db:setup` as in step 2 **before** pushing code that adds or changes an index. It's safe to repeat.

The data layer has no migration files. To change what's stored, edit `src/db/schema.js`.
