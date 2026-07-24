# Newsletter Automation — Design Spec

**Date:** 2026-07-25 (KST)
**Project:** Wander Atlas (`pixer-11/korea-travel-guide`, Astro + Cloudflare Pages, push-to-main auto-deploy)
**Owner:** non-technical; system must run fully unmanned once live.

## 1. Goal

Turn the existing single, English, manual-only newsletter signup into a fully automated, **magazine-quality, region-personalized** email program:

1. Capture each subscriber's interest (region + language) at signup, automatically.
2. Every week, auto-generate and send the right edition to each subscriber via MailerLite — no human step.
3. Let subscribers self-manage what they follow (one place, several places, or "best of everywhere") on a branded settings page that saves automatically.
4. Send the owner a **daily Telegram report** (Korean) of new signups.
5. Keep a **private backup** of subscriber email addresses, never in the public repo.

## 2. Locked decisions

| Topic | Decision |
|---|---|
| Frequency | **Weekly** (one email per subscriber per week) |
| Email service | **MailerLite** (existing account 2523042, double-opt-in form 193609989933237794), driven by **MailerLite API** with a token in GitHub Secrets |
| Editions | **Single-region**, **multi-region** (one combined email, sectioned by place), **global "Editor's Picks"** |
| Signup default | Specific region/post page → that region; generic pages (home, continent, roundup, essentials) → Global |
| Preferences | **Custom page on wanderatlasguides.com** (Cloudflare Pages Function → MailerLite API), auto-saves; plus one-click "follow more" links in emails |
| Email design | **Editorial / magazine** (brand palette: cream `#f7f3ec`, vermilion `#c8443a`, gold `#b8862f`, ink `#201c17`), mobile-first, per-subscriber language (en/ko/ja/es/zh) |
| Content top-up | If a followed region has fewer than **3** new posts this week, fill from the same **country**; if still empty, **skip** (no empty emails) |
| Language | Sent in **each subscriber's chosen language** automatically (audiences split by `lang`; all chrome + subject + preheader + card copy localized) |
| Hero image | Only **high-quality, context-matching** images ship: reuse the site's image-mismatch guard; a post whose best image fails the guard is dropped from the hero slot (or the whole card) |
| Events | If a followed region/country has **upcoming events**, include a "Upcoming events" section automatically |
| Freshness | **Never resend** a post or event to the same audience — a sent-log guarantees every week is new content only |
| Reporting | **Daily** Telegram signup report in Korean |
| Backup | **Weekly** private subscriber CSV sent as a Telegram **document** to the owner's chat only |
| Privacy | Subscriber emails live in MailerLite + the private Telegram backup **only** — never committed to the public repo |

## 3. Data model — source of truth is MailerLite custom fields

We do **not** rely on many hand-made MailerLite groups. Each subscriber carries fields; the sender buckets them in code. This keeps MailerLite simple and puts the personalization logic in our repo.

| Field | Values | Set by |
|---|---|---|
| `email` (built-in) | address | signup |
| `regions` | comma-separated region slugs (e.g. `dubai,paris`) **or** `__global__` | signup + preference page |
| `lang` | `en` \| `ko` \| `ja` \| `es` \| `zh` | signup + preference page |
| `signup_source` | page path (optional analytics) | signup |
| status (built-in) | unconfirmed / active / unsubscribed | MailerLite double opt-in |

## 4. Components (each independently buildable & testable)

### 4.1 Signup interest capture (site)
- `Newsletter.astro` gains hidden inputs `region`, `country`, `lang`, `source_page`, derived from the page it renders on. On generic pages `region` is empty → treated as `__global__`.
- Submission goes to a Cloudflare Pages Function **`POST /api/subscribe`** which calls the MailerLite API to upsert the subscriber, set `regions`/`lang`/`signup_source`, and **trigger MailerLite's double opt-in** (confirmation email preserved).
- Fallback if API opt-in proves unreliable: keep the current embed-form submit (which already triggers double opt-in) and pass `regions`/`lang` as MailerLite custom fields through the embed. Decide during implementation; the requirement is "double opt-in must still fire."

### 4.2 Weekly sender (GitHub Action, cron — Sundays, sensible KST hour)
1. Read candidate posts from repo content, indexed by region, country, and available languages. A candidate is any post **not yet sent to that audience** (§4.7), ordered newest-first — recent posts are preferred, but the sent-log is the hard "never repeat" rule (so a skipped or sparse week still surfaces genuinely new content).
2. Fetch all **active** (confirmed) subscribers from the MailerLite API (paginated) with their `regions` + `lang`.
3. **Bucket into audiences** (each subscriber lands in exactly one audience → exactly one email/week):
   - `__global__` → Global "Editor's Picks" audience.
   - Exactly one region → that region's audience.
   - Multiple regions → an audience keyed by the exact follow-set (`sorted(regions)` hash). Distinct sets are few at this stage; a safety cap (> ~50 distinct sets) collapses rare combos into Global.
   - Language splits each audience further (a `dubai/ko` audience vs `dubai/en`), because content strings differ by language.
4. For each audience **with content**, build the email (§4.3), then send via MailerLite:
   - Sync a managed MailerLite group `auto:<audience-hash>` to contain exactly that audience's subscribers.
   - Create a campaign targeting that group, with the rendered subject/preheader/HTML, and send.
   - Audiences with no meaningful new content are skipped.
5. **Idempotency:** campaigns are named with the ISO week + audience hash; before sending, skip any audience whose campaign for this week already exists (safe re-runs).

### 4.3 Email renderer
- Pure function: `(posts[], locale, editionType, audienceLabel) → { subject, preheader, html }`.
- Editorial template (approved design A): brand header → hero image → editor one-liner → 3–5 story cards (category kicker + serif title + dek + "Read →") → optional "Also new across the <country>" top-up block → gold-outline CTA → footer (region-change link, language link, unsubscribe).
- Global edition: cards drawn from multiple destinations, each card labelled with its city/country; hero is a marquee shot; capped at ~5 picks (newest/most-notable).
- Multi-region edition: one section per followed region, each with that region's new posts.
- **Hero image quality guard:** each featured post's image is chosen best-first (real venue photo from `/venue-photos/` → curated Unsplash → verified Commons) and run through the site's existing off-topic mismatch guard (the `OFFTOPIC` blocklist in `validate-content.mjs`). A post whose best image fails the guard is not used in the hero slot; if no featured post has a clean high-quality hero, that card/section is dropped rather than shipping a bad image. The email never sends a mismatched or low-quality main image.
- **Upcoming events section:** if the audience's region/country has events scheduled ahead (from the site's events collection), append an "Upcoming events" block (event name, date, city) after the story cards. Events obey the same freshness rule (§4.7) so the same event is not repeated every week.
- All chrome + subject + preheader localized via the site's existing i18n strings (extend `ui.ts` with `email.*` keys). Inline CSS for email-client compatibility. Every email includes a preheader and an unsubscribe link (legal requirement).
- One-click "follow more" links point at signed preference URLs (§4.4).

### 4.4 Preference page + subscribe endpoint (Cloudflare Pages Functions)
- **`POST /api/subscribe`** — used by the signup form (§4.1).
- **`/preferences`** page — opened from a **signed link** in every email (HMAC token, no login needed, not guessable/tamperable). Shows: region checkboxes (their current follows pre-checked) + "just send me the best of everywhere" option + language + Save. Save calls the MailerLite API to rewrite `regions`/`lang`. Auto-applies; no re-confirmation (already an active subscriber).
- **One-click follow** links (e.g. "Follow Kyoto too →") hit a signed endpoint that adds a single region and shows a small confirmation — no full page needed.

### 4.5 Daily Telegram signup report (GitHub Action, daily)
- Query MailerLite API for subscribers created/confirmed in the last 24h. Count total + breakdown by `regions`. Send a **Korean** message via existing `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (e.g. "오늘 신규 구독 5명 (두바이 3, 파리 1, 전체추천 1) · 누적 812명").

### 4.6 Weekly private backup
- In (or beside) the weekly job: export subscribers (`email`, `regions`, `lang`, signup date) to a CSV in scratch space and send it as a Telegram **document** to the owner's chat. Never written to the repo, never committed.

### 4.7 Freshness / no-repeat (sent-log)
- A committed JSON log (e.g. `data/newsletter-sent-log.json`) records, per audience key (region-or-`__global__` + `lang`), the set of post slugs and event ids already sent. **It contains no personal data** (no emails), so it is safe to commit to the public repo — consistent with how the daily publish job already commits generated content.
- The sender excludes any already-sent slug/event for that audience, then appends what it sends this week. Result: every audience's weekly email is guaranteed new content it has never received.
- Edge case: if excluding sent posts leaves an audience with no content, it is skipped that week (no empty/rehashed email).

## 5. Secrets / config

| Name | Where | Status |
|---|---|---|
| `MAILERLITE_API_TOKEN` | GitHub Secrets + Cloudflare env | **NEW — owner must generate (free)**; blocks everything until provided |
| `NEWSLETTER_LINK_SECRET` | GitHub Secrets + Cloudflare env | NEW — HMAC secret for signed preference links |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | GitHub Secrets | existing |

## 6. Error handling & safety

- Any MailerLite/Telegram API failure in a scheduled job → **Korean Telegram alert** + non-zero exit.
- **Dry-run mode** for the weekly sender: render every edition to HTML files in scratch and print each audience's size + subject, **without creating or sending any campaign**. Used to review the design and audience math before the first real send.
- **Empty guard:** audiences without meaningful new content are skipped — never an empty email.
- **Idempotency** (§4.2 step 5) prevents double-sends on re-run.
- **Test recipient:** the owner's own address is a subscriber; a live proof send goes to it before broad enablement.

## 7. Rollout order (becomes the implementation plan's phases)

1. Signup capture (fields) + `/api/subscribe` endpoint + custom `/preferences` page (with signed links).
2. Email renderer + `email.*` i18n keys + **dry-run** previews.
3. Weekly sender (audience bucketing → group sync → campaign send), first behind manual dispatch.
4. Daily Telegram signup report.
5. Weekly private CSV backup.
6. Turn on the weekly cron.

## 8. Assumptions & risks (flag before/while building)

- **MailerLite API token required from the owner** (free to create). Nothing sends until it exists.
- **MailerLite free-plan limits** (≈1,000 subscribers / 12,000 emails per month; API campaign send). Confirm the plan allows API-created campaign sends at build time; upgrade if limits are hit.
- **Double opt-in must still fire** when a subscriber is created via API — verify; fall back to the embed form for the opt-in step if needed.
- **Public repo** → emails only ever live in MailerLite + the private Telegram backup.
- **Scheduling** cron is UTC; choose a send hour that maps to a non-spammy KST time and is consistent week to week.

## 9. To verify during implementation (non-blocking)

- Exact MailerLite API endpoints for: upsert subscriber + fields, group membership sync, campaign create → assign recipients → send.
- Template build approach: MJML vs hand-inlined HTML.
- Definition of "notable" for the Global edition's pick ranking (start simple: newest across the largest regions, capped).
- Events source: confirm the events collection's date field so "upcoming" filtering (next N weeks) and the optional week-before reminder work per region/country.
