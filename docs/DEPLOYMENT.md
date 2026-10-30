# Deployment and operations (technical owner)

This is the one-time setup for the **technical owner** (whoever holds the Cloudflare account, the domain and the GitHub repository). Community administrators don't need any of this.

## What runs where
| Piece | Cloudflare product | Notes |
| --- | --- | --- |
| Website and API | **Workers** (one Worker serves the React app and `/api`) | `wrangler.jsonc` |
| Database | **D1** | All forum data, including the permanent chat archive |
| Live chat | **Durable Objects** (SQLite-backed, hibernating WebSockets) | Idle rooms cost nothing |
| Schedule sync and housekeeping | **Cron Triggers** | Every 30 minutes, plus daily at 09:17 UTC |
| Photos | **D1** by default; **R2** optional | R2 needs a payment method on file, so it's off by default |
| Email (invites, resets, digest) | **Resend** (optional) | Without it, admins copy and send links themselves |

## One-time setup
Run these from a computer with Node 22, inside a clone of the repository.

1. **Check the existing site and DNS first.** In the Cloudflare dashboard, open **nmsusportsforum.com → DNS → Records**. Write down what's there. If the domain already serves a website you want to keep, stop and decide what to do with it before step 6. Nothing below touches DNS until step 6.
2. **Sign in and create the database:**
   ```sh
   npm ci
   npx wrangler login
   npx wrangler d1 create nmsu-sports-forum
   ```
   Copy the `database_id` it prints.
3. **Set the secrets** (never commit these):
   ```sh
   npx wrangler secret put BOOTSTRAP_TOKEN    # any long random string; used once to create the first admin
   # Optional email:
   npx wrangler secret put RESEND_API_KEY
   ```
   For email, also set `MAIL_FROM` in `wrangler.jsonc` `vars` (for example `"NMSU Sports Forum <noreply@nmsusportsforum.com>"`) after verifying the domain in Resend.
4. **Turn on automatic deploys from GitHub.** In GitHub → Settings → Secrets and variables → Actions:
   - Secret `CLOUDFLARE_API_TOKEN`: create it in Cloudflare → My Profile → API Tokens with the **Edit Cloudflare Workers** template plus **D1 Edit** permission.
   - Secret `CLOUDFLARE_ACCOUNT_ID`: shown on the Cloudflare dashboard home page.
   - Variable `D1_DATABASE_ID`: the id from step 2.

   From then on, every merge to `main` runs the checks, applies database migrations and deploys. Until these are set, the deploy job skips itself and the checks still run.
5. **First deploy.** Merge to `main` (or run the workflow manually from the Actions tab). The site goes live at `https://nmsu-sports-forum.<your-subdomain>.workers.dev`.
6. **Connect the domain** once you're happy with step 1. Uncomment the `routes` line in `wrangler.jsonc`:
   ```jsonc
   "routes": [{ "pattern": "nmsusportsforum.com", "custom_domain": true }]
   ```
   Cloudflare creates the DNS record for you. If a record for the bare domain already exists, Cloudflare refuses rather than overwriting it, so remove the old one deliberately first. Add `www.nmsusportsforum.com` the same way if you want it.
7. **Create the first administrator.** Visit `https://nmsusportsforum.com/setup`, enter the `BOOTSTRAP_TOKEN` and choose the admin's username, email and password. Setup works only while the database has no users. After that, you can delete the secret with `npx wrangler secret delete BOOTSTRAP_TOKEN`.
8. **Connect the official schedule feeds.** Sign in as an admin, open **Admin → Sports data** and add the official NMSU Athletics calendar feed (the "Sync to calendar / iCal" link on nmstatesports.com). Press **Sync now**. From then on it updates every 30 minutes by itself. See `SPORTS_DATA.md`.

## Optional: R2 for photos
Only worth doing if photo volume grows. Enable R2 in the dashboard, run `npx wrangler r2 bucket create nmsu-sports-forum-uploads`, then uncomment `r2_buckets` in `wrangler.jsonc`. New photos go to R2; existing ones stay readable only from D1, so do this early or not at all.

## Costs (check Cloudflare's current pricing pages; these are the published free-tier limits as I understand them)
- **Workers Free plan:** 100,000 requests a day, cron triggers included. A forum of 20–30 members uses a small fraction of that.
- **D1 free tier:** 5 GB storage, 5 million rows read and 100,000 rows written per day.
- **Durable Objects (SQLite) on the Free plan:** available with daily limits. Hibernating WebSockets mean idle rooms don't run.
- **Domain:** your existing registration renewal (Cloudflare Registrar charges at cost, roughly $10–12 a year for .com).
- **Email (optional):** Resend's free tier covers thousands of emails a month.
- **If the forum outgrows the free tier** (several hundred very active members), the **Workers Paid plan is $5/month** and raises every limit far above what this forum needs.

Expected cost at launch: **$0 beyond the domain.**

## Backups and data
- **D1 Time Travel** keeps point-in-time restore history automatically (`npx wrangler d1 time-travel restore`).
- **Full export** whenever you like: `npx wrangler d1 export nmsu-sports-forum --remote --output backup.sql`. Store it privately; it contains member emails. **Never commit it to this public repository.**
- Private messages are in the database (privacy is enforced by the app, not by encryption), so treat exports as confidential.

## Local development
```sh
npm ci
cp .dev.vars.example .dev.vars              # local-only bootstrap token
npx wrangler d1 migrations apply DB --local
npm run build && npx wrangler dev --port 8787
npm test                                     # unit tests
node tests/e2e.mjs                           # end-to-end (fresh local DB, server running)
```

## Handing off ownership
To transfer technical ownership: add the new owner as a Cloudflare account member (or move the Worker, D1 database and domain to their account), transfer the GitHub repository, rotate `CLOUDFLARE_API_TOKEN` and `RESEND_API_KEY`, and update the GitHub secrets. Community administrator roles live in the forum database and are unaffected.
