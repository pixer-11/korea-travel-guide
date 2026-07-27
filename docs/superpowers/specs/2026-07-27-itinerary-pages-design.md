# Itinerary Pages — Design Spec (2026-07-27)

**Validated 2026-07-27** by two independent research agents (SEO/AEO demand + conversion/monetization). Both returned BUILD-DIFFERENTLY: do **not** build a runtime AI generator (zero indexable output, proven retention failure — Roam Around 13s avg visit; cost/abuse exposure). Build **pre-generated static itinerary pages** assembled from our own verified venue posts, with a client-side no-LLM personalization filter. Owner approved this direction and the 3-cities-first rollout.

Owner's standing requirements (2026-07-27, verbatim intent):
1. **Accuracy above all** — no wrong information, ever. The photo-mismatch saga must not repeat here.
2. **Marketing-effective structure** — real conversion/revenue contribution, compounding over time.
3. **Automated growth** — the feature must expand itself without manual work.

## 1. What ships

Static pages at `/itinerary/<city>-<n>-days/` in all 5 locales (`/`, `/ko`, `/ja`, `/es`, `/zh`).

- **Launch set:** Seoul, Tokyo, Bangkok × 3 days × 5 languages = 15 pages.
- **Day-count gating by data density** (never pad with thin data):
  - ≥ 12 qualifying posts → 3-day page (3 days × 4 stops default pace)
  - ≥ 15 qualifying posts → the "packed" pace filter option becomes available (3 × 5 = 15; a filter option never appears unless the data fully backs it — measured 2026-07-27: Seoul 16 / Tokyo 13 / Bangkok 12 qualifying, so all three launch at default pace and Seoul alone starts with packed)
  - ≥ 24 qualifying posts → add 5-day page
  - A *qualifying* post: not draft, has `place.lat/lng`, `businessStatus: OPERATIONAL` (or placeless but city-verified attraction), not `category: event` with an ended date.
- Page anatomy (top → bottom):
  1. H1 + quick answer paragraph (AEO: direct answer to "how many days / what to do in X").
  2. **Fit-to-my-trip filter bar** (pace / party / interests) — client JS, progressive enhancement; page renders complete without JS.
  3. Day-by-day timeline. Each stop card shows: name, category icon, ★rating + review count, opening-hours note incl. closed day, quiet-time badge when `busyness` exists, 1–2 sentence why-go (AI-written once at build, from the post's own content), link to the full guide post, Google Maps link.
  4. Per-day Klook CTA (city-scoped, `klookLocale` per language — same pattern as `PlanTrip.astro`).
  5. "Email me this plan" block — result fully visible on screen; email is save-a-copy only (keeps MailerLite double-opt-in honest; agent-validated).
  6. FAQ (3–5 Q&A drawn from constituent posts' facts).
  7. Related guides / region hub links.
- Structured data: `TouristTrip` + `ItemList` + `BreadcrumbList` + `FAQPage`. AI-assisted disclosure identical to posts.
- Discovery surfaces: sitemap (with lastmod), region-hub + country-hub + homepage links, footer, `llms.txt`.

## 2. Accuracy guarantees (non-negotiable design rules)

- **Closed-world assembly.** Stops come ONLY from our posts collection. The model never names a venue, address, price, rating, or hour — it may only write connective prose *around* injected facts (same fabrication firewall as `writer.mjs`).
- **Constraint solver, not vibes.** Ordering is computed in code (owner requirement 2026-07-27: routes, travel legs, and dwell times must all be considered so the day is genuinely convenient):
  - geographic clustering by `lat/lng` (one area per day; no cross-town zigzag), nearest-neighbor ordering within a day,
  - **inter-stop travel legs**: haversine-derived walking time shown between consecutive stops ("~12 min walk"); legs beyond ~2 km flagged "take the subway/taxi" instead of a walking estimate; every leg gets a Google Maps *directions* deep link (origin→destination by coordinates — Google computes the live route; zero API cost, never our guess),
  - **dwell times**: per-stop duration extracted from the post's own vetted prose/FAQ ("plan on 2–3 hours") where present, else category defaults (attraction 2h, restaurant 1h, hidden-gem/trendy 1.5h); the validator rejects any day whose dwell + walking total exceeds ~10 h,
  - closed-day avoidance (pages are day-generic, so closed days are surfaced as explicit warnings on the stop card),
  - meal slots filled by `restaurant` category only; morning slots favor venues whose `busyness.weekdayQuiet` includes 9–11,
  - verified transit tips already in the post (e.g. "Line 3, Gyeongbokgung Station Exit 5") are carried onto the stop card verbatim — never model-generated.
- **Validator gate before commit** (`scripts/validate-itineraries.mjs`, runs in CI like validate-content): every stop must resolve to a live post; no duplicate stops; no CLOSED_* businessStatus; per-day stop counts within bounds; all 5 locales present; internal links resolve. Build fails → page not published.
- **Self-healing sync.** Pages are rebuilt from posts on every build. If a post is quarantined (draft) or deleted by the photo patrol, the next build silently drops/replaces the stop and the validator re-checks. Itinerary pages inherit every future accuracy fix automatically — no second copy of facts exists anywhere.
- **Post-deploy verification** (standing directive): after first deploy, spawn verification subagents to check the live pages (facts vs. source posts, links, schema, all 5 locales) before reporting done.

## 3. Conversion & marketing structure

- Search targets: `[city] itinerary [n] days`, `[n] days in [city]` — verified winnable (personal blogs rank; Wanderlog's 7.5M visits are 60% these pages).
- Affiliate: per-day Klook CTA + existing `StickyBook` on the page; dated-trip intent is the highest-intent surface we have.
- Email: plan-by-email block feeding the existing MailerLite group with `signup_source: itinerary`.
- Newsletter + Telegram: new itinerary city announcement auto-included in weekly newsletter content pool; Korean Telegram report when a city page ships.
- Internal-link flywheel: every stop card links a post; every linked post gets a "Featured in: Seoul 3-day itinerary" backlink block → strengthens both directions.

## 4. Automated growth

- `scripts/build-itineraries.mjs` runs inside the existing daily publish workflow **after** generate: scans all cities, generates/refreshes any city that crosses a gate, regenerates a city when its qualifying-post set changed materially (>2 stops differ), translates via existing `translate-*` pipeline.
- Daily generation focus: publish queue temporarily weighted toward candidate cities (Singapore 10, Busan 8, Kyoto 7, Gyeongju 7…) until they cross the gates; then weighting reverts.
- Anti-spam guard (agent-validated risk): hard cap of 2 new cities per week; only data-dense cities ever qualify. No mass page dumps.
- Prose generation cost: one Claude call per city per material change (~$0 steady-state). No runtime AI, no public AI endpoint, nothing for scrapers to abuse.

## 5. Out of scope (explicitly)

- Runtime AI itinerary generator (rejected by validation).
- Gender input (rejected: no quality signal, GDPR data-minimisation, UX creep factor). Party/pace/interests replace it.
- User accounts, saved-trip database, date-specific pages.

## 6. Success measures (8-week check)

- Search Console: impressions/clicks on `/itinerary/*` (target: indexed within 2 weeks, first clicks by week 4).
- Klook clicks from itinerary pages vs. posts (Travelpayouts sub-id).
- Email signups with `signup_source: itinerary`.
- Zero accuracy incidents (validator + patrol green).
