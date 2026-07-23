# Deploying Wander Atlas

The site is a static Astro build. Recommended host: **Cloudflare Pages** (free,
fast) connected to a **GitHub** repo, which also runs the daily auto-publish.

## 1. Put the code on GitHub

You'll need a free GitHub account. Then, in this project folder:

```bash
git init                 # already done if a .git folder exists
git add -A
git commit -m "Initial commit"
```

Create an empty repo on github.com (e.g. `korea-travel-guide`), then:

```bash
git branch -M main
git remote add origin https://github.com/<you>/korea-travel-guide.git
git push -u origin main
```

> `.env` is git-ignored, so your API keys are **not** pushed. Good.

## 2. Add your keys as GitHub Actions Secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**.
Add:

- `ANTHROPIC_API_KEY` — required (post generation)
- `UNSPLASH_ACCESS_KEY` — required for real images
- `GOOGLE_MAPS_API_KEY` — only once Places works (see NO_PLACES note below)

The daily workflow (`.github/workflows/publish.yml`) uses these to generate and
commit new posts automatically. `refresh.yml` re-checks venue data weekly.

## 3. Connect Cloudflare Pages

1. Free account at dash.cloudflare.com → **Workers & Pages → Create → Pages →
   Connect to Git** → pick your repo.
2. Build settings:
   - **Framework preset:** Astro
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. **Environment variables** (Settings → Environment variables) — add the same
   keys as above so the build can render.
4. Deploy. You'll get a `*.pages.dev` URL. Add a custom domain later if you buy
   one.

## 4. After deploying

- Set your real domain in `astro.config.mjs` (`SITE_URL`) and `public/robots.txt`
  (the `Sitemap:` line), then push.
- Replace the placeholder contact email (`hello@example.com`) in
  `src/pages/contact.astro` and `src/pages/privacy.astro`.
- Apply to **Google AdSense** once you have ~15–30 posts (you do) and some
  traffic. The privacy/terms/contact pages are already in place.

## Places API note (`NO_PLACES`)

Google Places is currently **off** (`NO_PLACES=1` in `.env`) because the Google
Maps Platform onboarding is stuck for this account. The site runs great without
it (Anthropic + Unsplash). To turn Places back on later:

1. Resolve the Maps Platform onboarding (fresh Google account, or Google
   support) so `GOOGLE_MAPS_API_KEY` stops returning 403.
2. Remove `NO_PLACES=1` (or set it to `0`) locally and in your host/CI env.
3. Regenerate: you'll get verified ratings/addresses + real venue photos.
