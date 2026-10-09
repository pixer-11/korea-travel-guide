# Deploying Wander Atlas

Current as of 2026-10-09. The older version of this file described Cloudflare Pages connected to
Git, `NO_PLACES=1` and placeholder emails; none of that is how the site ships any more.

## What actually deploys

- **Host:** Cloudflare Workers with static assets (`wrangler.jsonc`: `main: worker/index.mjs`,
  `assets.directory: ./dist`, `not_found_handling: "404-page"`), plus the R2 bucket
  `wa-og-images` for mirrored OG images and a rate limit on `/api/subscribe`.
- **Builder:** `.github/workflows/build-check.yml`, not Cloudflare's Git integration. Cloudflare's
  own builds were abandoned on 2026-08-10 after the 3,000 build-minute monthly cap was exhausted
  mid-month. The workflow is triggered by `workflow_run` of the content-writing workflows (pushes
  made with `GITHUB_TOKEN` do not fire `push` events) and by `push` to `main` with path filters that
  exclude the bookkeeping ledgers in `data/`.
- **Build:** `npm run build` takes 45–55 minutes. The workflow then runs the rendered-page audits
  (feed/noindex, sitemap split, OG width, static-file count against the Workers cap) and deploys
  with `npx wrangler@4 deploy` using `CF_API_TOKEN` and `CF_ACCOUNT_ID`. Failures go to Telegram
  with the deploy log tail.
- **Plan limits that bite:** the Workers Free plan's 20,000 static files were hit on 2026-10-01
  (the site is on Workers Paid, 100,000, and grows 300–400 files/day). `_redirects` is capped at
  2,000 rules by Cloudflare; the integration in `astro.config.mjs` throws above that and warns at
  1,600. `cf-token-check.yml` watches the API token's expiry.

## Secrets (GitHub → Settings → Secrets and variables → Actions)

Required for the daily pipeline: `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY` (Place Details and
Text Search; Google **photos** are billing-blocked since 2026-07-26, heroes come from Wikimedia
Commons, Foursquare and Flickr), `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`. The rest (Foursquare, Flickr, Unsplash, MailerLite, Pinterest, Threads,
Instagram, GSC, Bing, BestTime, Plausible) each unlock one job; the full list is
`grep -ho 'secrets\.[A-Z_]*' .github/workflows/*.yml | sort -u`. There is no documented rotation
schedule; a live Google key was found committed in the public repo and removed on 2026-10-05, and
`pii-guard.yml` now runs on every push.

## The second worker

`workers/social-alarm/` is a separate Cloudflare cron worker that wakes `publish-watchdog`,
`schedule-watchdog` and `threads-daily` on time, because GitHub delivers scheduled runs 4–6 hours
late (median 44 minutes across all crons, 3.2% never). It uses 4 of the account's 5 free cron
triggers and holds its own secrets (`GH_DISPATCH_TOKEN`, `FIRE_KEY`, Telegram). It is deployed
**by hand** with `scripts/deploy-social-alarm.sh` from a machine where wrangler is logged in; a
change on `main` is not live until someone runs that script.

## Local preview

```bash
npm install
npm run dev        # http://localhost:4321
```

`npm run build` locally is a full 45–55 minute site build; use `npm run ci` (lint, astro check,
tests) to validate a change instead.
