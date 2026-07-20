# Korea Travel Guide 🇰🇷

An automated, **legally-sourced** Korea travel guide for international visitors.
Built with [Astro](https://astro.build) (fast static site, great SEO) and an
unattended content pipeline.

## How it works

```
GitHub Actions (daily cron)
   └─ scripts/generate.mjs
        ├─ Google Places API  → verified facts + real venue photos
        ├─ guardrails.mjs      → auto-skip closed / low-rated / unlicensed
        ├─ Claude API          → drafts the article (facts injected, not invented)
        └─ writes src/content/posts/*.md
   └─ commits new posts → Cloudflare Pages / Vercel auto-deploys
```

**No fabricated visits, no scraped content.** Facts come from live data;
images are licensed or public domain; AI assistance is disclosed on every page.
This is what keeps Google's spam/E-E-A-T policies — and ad-network approval —
on our side.

## Quick start

```bash
npm install

# See the whole pipeline run with NO keys (writes a sample post):
npm run generate:dummy

# Preview the site:
npm run dev        # http://localhost:4321
```

## Going live

1. Copy `.env.example` → `.env` and fill in your keys (never commit this file).
2. Add the same keys as **GitHub Actions Secrets** (Settings → Secrets → Actions):
   `GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY`, optional `UNSPLASH_ACCESS_KEY`.
3. Set `SITE_URL` in `astro.config.mjs` / env to your real domain.
4. Push to GitHub, connect the repo to Cloudflare Pages or Vercel.
5. The daily workflow (`.github/workflows/publish.yml`) does the rest.

## Editing what gets written

- **Topics/queue:** `data/targets.json` — add regions, queries, categories.
- **Quality thresholds:** `MIN_RATING`, `MIN_REVIEWS` in `.env`.
- **Writing voice/rules:** `scripts/lib/writer.mjs` (system prompt).
- **Posts per run:** `POSTS_PER_RUN`.

## Monetization (ads)

Before applying to Google AdSense: complete `/privacy`, have 15–30 quality
posts, and some organic traffic. Thin or scraped content gets rejected — which
is exactly why this pipeline is built the way it is.
