# 유입·체류 실행 계획 (2026-08-23) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, this checkout is shared — no parallel edits to the same files). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three measured leaks (mobile search bounce 70%/12s, second-page rate 1.8%, top-10 CTR 1.2%) and the visible gaps vs. winning pages (photos, map, item cards, practical numbers), without a redesign and without regressions across 5 languages × 23 page types.

**Architecture:** Template-level changes in `src/components/PostArticle.astro`, `Header.astro`, `global.css` (one task = one commit = one build-check); pipeline-level rules in `scripts/generate.mjs`/`discover-events.mjs`; content edits only where a sweep proves the class. Verify every UI task on the local dev server (astro-dev, port 4321) at 1280 and 375, light and dark, on /posts/genoa-porto-antico/ and one event post, then on live after deploy with a cache-busting query.

**Tech Stack:** Astro static, CSS tokens (`--ink/--surface/--accent`), node --test, GitHub Actions build-check (~35 min), Cloudflare Workers.

**Spec:** `C:\Users\user\Desktop\클로드\보고서-2026-08-23-유입체류-디자인.md` (sections 2, 3, 5, 6).

## Status (2026-08-23 16:00 KST)
Done and pushed: Task 1 (3b03f397) · 2 (afafc8e3) · 3 (fcafd26a) · 4 map facade (f3b28291; "updated" date already shown, nothing to build) · 5 (377fa969) · 6 (f25cd402) · 7+8 (605d7983) · 9 retitle tool + 4 posts (31e05560) · 10 (5d5d420b) · 11 (1e9e8f5d) · 12 except eSIM tone (cfb404d8) · itinerary email ask (follow-up commit). Found on the way: 19 retired-but-ranking posts restored (4cd10bb7), Foursquare query fix (4813984c).
Not built: Task 13 (multi-photo gallery needs an identity-gate budget design; lineup/fees have no data source), eSIM tone, Task 0 (owner's Bing Webmaster account).

## Global Constraints
- Owner directive 2026-08-23: "반드시 다른 오류 없이" — every task: tests green (`node --test`), `node scripts/validate-content.mjs` no NEW issue, dev-server visual check, live check with `?v=` after deploy.
- Consistency rule (design.md): a change to a shared component must be verified on every page type that uses it (grep `<Component`).
- Topbar fact line stays on mobile (owner, 2026-08-08). Only the height changes.
- No new iframe on page load (CWV); maps are a facade (static image/link → loads on click).
- No invented data: prices, lineups, hours only from sources we have.
- Translations: any frontmatter title/description change re-queues 4 languages — batch it, count the cost before running.
- After any token/typography change run `node scripts/audit-typography.mjs`.

---

### Task 1: Dark-mode newsletter card text (bug)
**Files:** Modify `src/styles/global.css:1150-1160, 1555-1561`
**Why:** `.nl-card` background is hard-coded `#fbf6ee` but its text uses `var(--ink)` / `var(--ink-soft)` which flip to cream in dark mode → `.nl-bonus` and `.nl-note` invisible (242,236,225 on 251,246,238).
- [ ] Pin every text colour inside `.nl-card` to light-theme values: `.nl-card { color:#201c17 }`, `.nl-card .nl-bonus { color:#201c17 }`, `.nl-card .nl-note { color:#6f6659 }`, heading/dek inside card likewise.
- [ ] Sweep: `grep -n "\.nl-card" src/styles/global.css` — every rule that uses `var(--ink*)`/`var(--muted)` inside `.nl-card` gets a fixed value.
- [ ] Verify on dev server: home (`<Newsletter>` full) and a post (`compact`) in dark mode — text visible; light mode unchanged.
- [ ] Commit `fix: newsletter card text is readable in dark mode — the card is cream in both themes, its text was not`.

### Task 2: Mobile top strip — same content, one row of pills
**Files:** Modify `src/styles/global.css:219-228`
- [ ] Replace the ≤720px block: fact line stays (0.7rem); `.topbar-langs { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; justify-content: flex-start; gap: 0.1rem; max-width: 100%; }` `.topbar-langs::-webkit-scrollbar{display:none}` `.topbar-lang { min-height: 40px; padding: 0.4rem 0.5rem; font-size: 0.8rem; white-space: nowrap; flex: none; }`.
- [ ] Verify at 375: topbar ≤ 75px (was 117), all 5 languages reachable, fact line visible, 1280 unchanged. Check /ja/ and /zh/ pages (CJK labels).
- [ ] Commit.

### Task 3: Money blocks 3 → 1, FAQ above them
**Files:** Modify `src/components/PostArticle.astro:760-800`; maybe `src/components/PlanTrip.astro`
- [ ] Order after prose: visit-cta (keep) → FAQ → ONE "Plan your trip to {city}" card (PlanTrip, which already has tours/hotels/eSIM cards) → ShareRow → Newsletter → related. Remove `<Tours>` and `<Hotels>` from the post page (they stay on region hubs). Keep `data-affiliate-placement` attributes so analytics props still fire.
- [ ] grep other users of Tours/Hotels (region hubs) — untouched.
- [ ] Verify post page mobile height of the commercial section < 500px; FAQ visible before it.
- [ ] Commit.

### Task 4: Map facade + visible "updated" date
**Files:** Modify `src/components/PostArticle.astro` (At a glance `fact-actions`, byline), `src/styles/global.css`, `src/i18n/ui.ts`
- [ ] Byline: append `· {t('post.updated')} {formatted updated}` using existing `updated` (line 121) — 5 language keys.
- [ ] Map facade: when `p.lat/p.lng` exist render `<a class="map-facade" href={googleMapsUrl} target="_blank" rel="noopener">` containing a static OSM tile (`https://tile.openstreetmap.org/{z}/{x}/{y}.png` computed at build for z=15) with a pin overlay and label "Open in Google Maps" — no iframe, no JS. Tile math in `src/lib/osmTile.ts` with a unit test (`scripts/lib/osm-tile.test.mjs` — port the function to .mjs for test, or test via a small mjs twin).
- [ ] Verify: facade renders on a place post, not on events without coords; lazy-loaded; alt text.
- [ ] Commit.

### Task 5: Related posts → thumbnail cards + same-city prev/next, above the newsletter
**Files:** Modify `src/components/PostArticle.astro:805-826`, `src/styles/global.css:1198-1204`
- [ ] Move `<section class="related">` ABOVE `<Newsletter>`; render as `PostCard`-like tiles (reuse `wall` thumb via `wikimediaThumb`/`/wall/` mapping — check how `PostCard.astro` gets its image and reuse the same helper) with title + region; cap 3.
- [ ] Add same-city prev/next: two links to the alphabetically previous/next non-draft post in the same `region` (computed in frontmatter script).
- [ ] Verify dev server: 3 cards with images, prev/next present; mobile width; dark mode.
- [ ] Commit.

### Task 6: Generator rule — query noun in the first sentence
**Files:** Modify `scripts/generate.mjs` (writeArticle prompt), `scripts/discover-events.mjs` (same prompt path if separate)
- [ ] Add one instruction: "The quick answer's first sentence must contain the exact place/event name AND the one word a searcher would type for the intent (e.g. 'parking', 'lineup', 'best time', '来日公演' for ja) — never paraphrase the name."
- [ ] `node --test scripts/generate.test.mjs` green. Commit.

### Task 7: Event ticket button (data we already have)
**Files:** Modify `src/components/PostArticle.astro` event header; `src/content.config.ts` (optional `ticketUrl`), `scripts/discover-events.mjs` (capture official ticket/organizer url when present)
- [ ] Render "Tickets / official page →" button when `eventOrganizer.url` or new `ticketUrl` exists; `rel="noopener"` (not sponsored).
- [ ] Count coverage: `node -e` over posts — how many events have a url today; report.
- [ ] Commit.

### Task 8: Sweeps — beach "Open 24 hours" and plus-code addresses
**Files:** new `scripts/audit-hours-24h.mjs`? — first MEASURE with a one-off node count; only build a tool if the class is ≥ 10.
- [ ] Count posts with all-day hours whose category/tags are beach/park/nature; count posts whose address matches `/^[23456789CFGHJMPQRVWX]{4,}\+[23456789CFGHJMPQRVWX]{2,}/`.
- [ ] Decide: drop the hours block for beaches (render "open area — no fixed hours") vs. keep; for plus codes hide the address line and show the region instead. Implement in PostArticle (display-level) — no content rewrite.
- [ ] Commit.

### Task 9: CTR — titles/descriptions of top-10 pages with 0 clicks
**Files:** 16 posts from report A (lombok-vandal, ajman-yemeni-corner, hue-22-restaurant, bali-bingin-pak-gula, istanbul-eurovolley, incheon-haesong-ssambap, kuala-lumpur-muljil, ras-al-khaimah-rukn-al-falafel, barcelona-parada-torres, kyoto-yoichiba, suncheon-nagan-eupseong, gyeongju-cafe-arae-heon, sokcho-huindajeong, …)
- [ ] For each: GSC query it ranks for → rewrite `title` to lead with the query noun + a concrete hook (hours/price/what to order), `description` ≤ 155 chars with the answer. No clickbait.
- [ ] Check translation re-queue cost: `scripts/lib/src-hash.mjs` — which fields hash; estimate N×4 translations; run with the existing translate path.
- [ ] Commit; record the 16 slugs + date in memory for the 08-30 CTR re-measure.

### Task 10: Nearby 3 places + in-body auto links
**Files:** `src/components/PostArticle.astro` (nearby already exists at line 259 — upgrade to cards with distance), new `scripts/lib/body-links.mjs` + test (link first mention of another post's place name in the body, cap 4, skip headings/links)
- [ ] Test: given body markdown and a name→href map, links first plain-text occurrence only, never inside existing `[..](..)` or headings.
- [ ] Wire at render time (PostArticle prose pre-processing) — not a content rewrite.
- [ ] Commit.

### Task 11: Hero self-hosting + mobile 4:3
**Files:** `scripts/build-wall.mjs` pattern → new `scripts/mirror-heroes.mjs` (1200px webp to `public/hero/<hash>.webp`, width-ladder rule), `PostArticle.astro` `<img>` src fallback chain, `global.css` mobile aspect.
- [ ] Sample first: top-100 posts by GSC impressions; measure LCP on dev before/after.
- [ ] Commit in two steps (pipeline, then template).

### Task 12: Consistency — eSIM page width/tone, events hub date badge, mobile home tidy
**Files:** `src/components/EsimPage.astro`, `EventsIndex.astro`/`EventsCountryHub.astro`, `HomePage.astro`
- [ ] Each as its own commit with dev-server check at 375.

### Task 13: Body photos 4–8 for top posts (sample), lineup/fees — data-gated
- [ ] Photos: run the existing gallery pipeline (`gallery-photos.yml` / `scripts/…gallery`) on the 20 posts with most impressions; identity gates apply; count accepted.
- [ ] Lineup/fees: NOT buildable without a source — report as such.

### Task 0 (owner, guided in chat): Bing Webmaster Tools
- IndexNow already live (`indexnow.yml`, key 282e944b… served 200, 955 URLs submitted 08-22). Remaining: owner creates Bing Webmaster account → "Import from Google Search Console" → confirm sitemap → enable AI Performance report. One step per message with screenshot confirmation.
