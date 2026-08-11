#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  UNATTENDED POST GENERATOR
//  For each selected target: search Places → guardrails → images
//  → draft → write .md. Anything failing a guardrail is SKIPPED.
//
//  Selection is a ROUND-ROBIN across regions & categories, so daily
//  output stays balanced instead of front-loading one region.
//
//  Queue = curated targets (data/targets.json) + auto-generated
//  region×topic combos, so it keeps producing without manual input.
//  Already-done targets are tracked in data/published.json.
//
//  DUMMY mode (DUMMY=1 or missing keys): builds from canned data so
//  you can see the whole flow without spending anything.
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs'; // MUST be first — loads .env before other modules read process.env
import { makeTitle, makePlacelessTitle } from './lib/titles.mjs';
import { clip, withRatingSignal } from './lib/serp.mjs';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import yaml from 'js-yaml';

import { slugify } from './lib/slugify.mjs';
import { checkPlace, isImageAllowed } from './lib/guardrails.mjs';
import { qualifyingPosts } from '../src/lib/itinerary.mjs';
import { openHourSet, clampBusynessHours } from '../src/lib/hours.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const TARGETS_FILE = join(ROOT, 'data', 'targets.json');
const COUNTRIES_FILE = join(ROOT, 'data', 'countries.json');
const EVENTS_FILE = join(ROOT, 'data', 'events.json');
const PUBLISHED_FILE = join(ROOT, 'data', 'published.json');

const POSTS_PER_RUN = Number(process.env.POSTS_PER_RUN ?? 2);
const AUTO_EXPAND = process.env.AUTO_EXPAND !== '0'; // auto-generate combos unless disabled
// Venue-level dedup across the whole site: never publish the same Google place
// twice, even if reached via a different query/slug over months of auto-runs.
let USED_PLACE_IDS = new Set();
// Image-level dedup: never let two posts share the exact same hero photo (this
// is what made the two Boryeong "mud" posts look identical). Passed into
// resolveHero(), which skips any URL already in this set.
let USED_IMAGE_URLS = new Set();
// Monotonic per-run counter so posts built in the same run get strictly
// increasing pubDate timestamps (see assemble()). Without this, everything
// generated on one day shared a date and "Latest stories" never reordered.
let PUB_SEQ = 0;
// Details calls that FAILED (quota/network) rather than returning "this venue
// has no phone on file". This lived inside main() while the only line that
// incremented it lived inside buildLivePost — a different function — so it threw
// ReferenceError into a bare `catch {}` on every single post, and the warning it
// feeds could never print (found 2026-08-05). Module scope is what the other
// cross-function counters here already use.
let DETAILS_FAILED = 0;
// Places Details calls this run, against the day's shared allowance.
//
// The budget table has always listed "publish 40" as the largest share, but
// generate.mjs never claimed it: on 2026-08-06 the ledger recorded backfill 25
// + quality 15 and nothing for publish, while publishing had in fact spent 16
// calls outside the accounting. On an ordinary 16-post day the untracked spend
// still fits under the 100/day cap, so nothing ever broke. The country fill is
// where it would: 75 posts + 40 tracked = 115 against a hard 100, and every
// call past the cap returns 429 — meaning the posts at the end of a bulk run
// would publish with no phone and no opening hours at all, silently.
let DETAILS_BUDGET = Infinity;
let DETAILS_USED = 0;
let DETAILS_SKIPPED = 0;
// Whether the last buildLivePost skip was TRANSIENT (an overloaded vision API, a
// missing key) rather than a real guardrail rejection. The distinction decides
// whether the target is burned from the queue forever — see the loop in main().
let LAST_SKIP_TRANSIENT = false;
// DUMMY = can't do real writing (no Anthropic key, or forced) → canned output.
const DUMMY = process.env.DUMMY === '1' || !process.env.ANTHROPIC_API_KEY;
// USE_PLACES = pull verified facts + real venue photos from Google Places.
// Set NO_PLACES=1 to run in "placeless" mode: Anthropic-written neighborhood/
// topic guides with free (Unsplash/placeholder) images and no venue fact box.
// Handy when Google Places billing isn't available yet — flip it back on later.
// NO_PLACES=1 is a DELIBERATE choice; a missing GOOGLE_MAPS_API_KEY is an
// ACCIDENT. They used to be the same branch, so a run whose secret had gone
// missing quietly demoted itself to placeless mode and published a full batch of
// venue-free guides with unverified free imagery — no error, no alert, and the
// Telegram report read like an ordinary night. Only the deliberate flag may take
// that path now (see the hard stop in main()).
const PLACELESS_ON_PURPOSE = process.env.NO_PLACES === '1';
const USE_PLACES = !DUMMY && !PLACELESS_ON_PURPOSE && !!process.env.GOOGLE_MAPS_API_KEY;

// Topic templates auto-extend the queue so the site can publish daily for a
// long time without hand-writing every target. They are applied to every
// ACTIVE country's regions (see data/countries.json) → global by design.
// Five templates capped every city at five posts, and an itinerary needs TWELVE
// qualifying stops (gateFor in src/lib/itinerary.mjs). That is why only Seoul
// (14) and Tokyo (12) ever had a 3-day plan while Bangkok sat parked at 10, and
// why the 102 cities added on 2026-08-05 could never have earned one. Twelve
// templates put a 3-day itinerary within reach of every city that has the venues
// for it — and the guardrails (rating ≥4.0, ≥50 reviews, dedup, vision check)
// still drop any slot a town genuinely cannot fill, so a small city simply ends
// up with fewer posts rather than worse ones.
const TOPIC_TEMPLATES = [
  { category: 'attraction', topic: 'top attraction', q: (r, c) => `top tourist attraction in ${r} ${c}` },
  { category: 'restaurant', topic: 'local restaurant', q: (r, c) => `best local restaurant in ${r} ${c}` },
  { category: 'hidden-gem', topic: 'hidden gem', q: (r, c) => `hidden gem worth visiting in ${r} ${c}` },
  { category: 'trendy', topic: 'trendy cafe', q: (r, c) => `trendy popular cafe in ${r} ${c}` },
  { category: 'restaurant', topic: 'street food', q: (r, c) => `famous street food spot in ${r} ${c}` },
  { category: 'attraction', topic: 'museum', q: (r, c) => `best museum in ${r} ${c}` },
  { category: 'attraction', topic: 'historic site', q: (r, c) => `historic landmark or temple in ${r} ${c}` },
  { category: 'attraction', topic: 'park', q: (r, c) => `best park or garden in ${r} ${c}` },
  { category: 'attraction', topic: 'viewpoint', q: (r, c) => `scenic viewpoint or observation deck in ${r} ${c}` },
  { category: 'hidden-gem', topic: 'local market', q: (r, c) => `traditional market worth visiting in ${r} ${c}` },
  { category: 'trendy', topic: 'bakery', q: (r, c) => `popular bakery or dessert shop in ${r} ${c}` },
  { category: 'trendy', topic: 'bar', q: (r, c) => `well-reviewed bar or rooftop lounge in ${r} ${c}` },
  // Three more RESTAURANT templates, added 2026-08-05 for balance rather than
  // volume. Five of the first twelve mapped to 'attraction' and only two to
  // 'restaurant', so the 51-post batch that night came out 48 attractions / 0
  // restaurants. The itinerary solver fills its lunch slot from category
  // 'restaurant' ONLY (src/lib/itinerary.mjs), so an attraction-heavy city
  // produces day plans with no meal — and the restaurant roundup hub, which
  // needs 4, could never open. Now: 5 attraction, 5 restaurant, 3 trendy,
  // 2 hidden-gem.
  { category: 'restaurant', topic: 'seafood', q: (r, c) => `best seafood restaurant in ${r} ${c}` },
  { category: 'restaurant', topic: 'noodles', q: (r, c) => `popular noodle or rice shop in ${r} ${c}` },
  { category: 'restaurant', topic: 'breakfast', q: (r, c) => `best breakfast or brunch spot in ${r} ${c}` },
  // Nine more, 2026-08-07, to make a 5-day itinerary reachable at all.
  //
  // gateFor() in src/lib/itinerary.mjs wants 24 qualifying venues in one city
  // before it will build the 5-day variant. This list generates exactly one
  // candidate per template per city, so with 15 entries the automated pipeline
  // capped every city at 15 and the gate could never be met. Today the
  // best-covered city is Bangkok at 17, and it passed 15 only because Thailand
  // carries 12 hand-curated targets. The code was offering a product it could
  // not deliver.
  //
  // Chosen to be findable rather than to pad a number: each is a category
  // Google Places actually returns for an ordinary city, and none repeats a
  // template above — an art gallery is not the museum, a night-view spot is not
  // the daytime observation deck. Balance is now 8 attraction / 7 restaurant /
  // 5 trendy / 4 hidden-gem, keeping restaurants plentiful because the
  // itinerary solver fills its lunch slot from that category alone and an
  // attraction-heavy city produces day plans with no meal in them.
  { category: 'attraction', topic: 'art gallery', q: (r, c) => `well-known art gallery in ${r} ${c}` },
  { category: 'attraction', topic: 'night view', q: (r, c) => `best night view spot in ${r} ${c}` },
  { category: 'attraction', topic: 'waterfront', q: (r, c) => `riverside or waterfront walk in ${r} ${c}` },
  { category: 'restaurant', topic: 'vegetarian', q: (r, c) => `best vegetarian restaurant in ${r} ${c}` },
  { category: 'restaurant', topic: 'grill', q: (r, c) => `popular grill or barbecue restaurant in ${r} ${c}` },
  { category: 'trendy', topic: 'concept cafe', q: (r, c) => `unique concept cafe in ${r} ${c}` },
  { category: 'trendy', topic: 'design shop', q: (r, c) => `independent design or lifestyle shop in ${r} ${c}` },
  { category: 'hidden-gem', topic: 'old quarter', q: (r, c) => `old alley or historic quarter in ${r} ${c}` },
  { category: 'hidden-gem', topic: 'bookshop', q: (r, c) => `independent bookshop worth visiting in ${r} ${c}` },
];

async function main() {
  // Stop rather than downgrade. Publishing nothing tonight is recoverable;
  // twenty placeless guides with unchecked photos are twenty pages to hunt down
  // tomorrow. Exiting non-zero also makes job-failure-alert.yml say so in Korean
  // instead of the run passing green with a quietly wrong mode.
  if (!DUMMY && !PLACELESS_ON_PURPOSE && !process.env.GOOGLE_MAPS_API_KEY) {
    console.error(
      '⛔ GOOGLE_MAPS_API_KEY is missing — refusing to publish.\n' +
      '   Without it there is no verified venue data and no real venue photo, so every\n' +
      '   post this run would be a placeless guide with an unvetted image.\n' +
      '   Fix the secret, or set NO_PLACES=1 if placeless output is genuinely intended.'
    );
    process.exit(1);
  }
  if (!existsSync(POSTS_DIR)) await mkdir(POSTS_DIR, { recursive: true });

  const { targets } = JSON.parse(await readFile(TARGETS_FILE, 'utf8'));
  const { countries } = JSON.parse(await readFile(COUNTRIES_FILE, 'utf8'));
  const onlyCountry = (process.env.COUNTRY || '').trim(); // optional: fill one country
  let activeCountries = (countries ?? []).filter((c) => c.active);
  if (onlyCountry) {
    const aliases = { usa: 'united states', us: 'united states', america: 'united states', uk: 'united kingdom', korea: 'south korea', kr: 'south korea', jp: 'japan', nippon: 'japan' };
    const q = onlyCountry.toLowerCase();
    const target = aliases[q] || q;
    const matched = activeCountries.filter(
      (c) => c.name.toLowerCase() === target || c.slug === target || c.slug.replace(/-/g, ' ') === target
    );
    if (matched.length) activeCountries = matched;
    else console.log(`⚠️  COUNTRY "${onlyCountry}" matched no active country — generating for ALL active instead.`);
  }
  const done = await loadPublished();
  const existing = new Set(
    (await readdir(POSTS_DIR)).map((f) => f.replace(/\.md$/, ''))
  );
  USED_PLACE_IDS = await loadUsedPlaceIds();
  USED_IMAGE_URLS = await loadUsedImageUrls();

  // Per-country fill cap. When TARGET_PER_COUNTRY is set (e.g. the backfill
  // workflow uses 58), a country that already has that many published guides is
  // dropped from the queue — so backfill self-terminates and can run forever
  // harmlessly once every country is full. Unset = no cap (normal daily runs).
  const capPerCountry = Number(process.env.TARGET_PER_COUNTRY || 0) || Infinity;
  const countryCounts = await countPostsByCountry();
  const regionCatCounts = await countPostsByRegionCategory();
  const regionQualifyingCounts = await countQualifyingPostsByRegion();

  // Seasonal events: publish with priority when in season (current month or the
  // next month, for lead time), only for active countries.
  const activeNames = new Set(activeCountries.map((c) => c.name));
  const seasonal = await loadSeasonalTargets(activeNames);

  const queue = buildRotatedQueue(targets, done, activeCountries, seasonal, { capPerCountry, countryCounts, regionCatCounts, regionQualifyingCounts });

  const mode = DUMMY ? 'DUMMY' : USE_PLACES ? 'LIVE + Places' : 'LIVE (no Places)';
  console.log(
    `\n🗺️  Generator — mode: ${mode} · target: ${POSTS_PER_RUN} post(s) · queue: ${queue.length} available`
  );

  let published = 0;
  // (The counter itself is module-scoped — see DETAILS_FAILED at the top. It
  // used to be declared here, which is why the line that increments it, over in
  // buildLivePost, threw ReferenceError on every post.)
  DETAILS_FAILED = 0;

  // Claim this run's share of the day's Places Details calls. Publishing gets
  // the largest share because new content is the reason the site exists; what
  // it does not spend is left for the backfill that follows it. Running out is
  // not an error — the post still publishes, just without phone/hours, and the
  // backfill picks it up tomorrow.
  try {
    const { claim, describe } = await import('./lib/places-budget.mjs');
    const b = await claim('publish');
    DETAILS_BUDGET = b.allowance;
    DETAILS_USED = 0;
    console.log(describe('publish', b));
  } catch (e) {
    // A broken ledger must never stop a publish run; fall back to unmetered,
    // which is exactly the behaviour that shipped for months.
    console.log(`  ⚠️  Places 예산 확인 실패 (${String(e.message).slice(0, 50)}) — 제한 없이 진행`);
    DETAILS_BUDGET = Infinity;
  }

  // Consecutive skips caused by an unreachable vision API, not by the venue.
  // The queue is a finite set that only ever shrinks — `done` has no delete path
  // anywhere in the repo — so an Anthropic outage during one nightly run could
  // walk the ENTIRE queue and mark every target done while publishing nothing.
  // Stopping after a handful of transient failures costs one quiet night; not
  // stopping costs months of queue that cannot be rebuilt (found 2026-08-05).
  const TRANSIENT_STOP = 5;
  let transientRun = 0, transientTotal = 0;
  for (const target of queue) {
    if (published >= POSTS_PER_RUN) break;
    try {
      LAST_SKIP_TRANSIENT = false;
      const post = DUMMY
        ? buildDummyPost(target)
        : USE_PLACES
        ? await buildLivePost(target)
        : await buildPlacelessPost(target);
      if (!post) {
        if (LAST_SKIP_TRANSIENT) {
          // Leave it in the queue: nothing was learned about this venue.
          transientTotal++;
          if (++transientRun >= TRANSIENT_STOP) {
            console.log(`  ⛔ ${TRANSIENT_STOP} consecutive vision-unavailable skips — stopping so the queue is not burned. Targets stay queued.`);
            break;
          }
          console.log(`  ⏳  "${target.query}" — vision unavailable, left in the queue for a retry`);
          continue;
        }
        transientRun = 0;
        done.add(target.query);
        continue; // a real guardrail rejection — don't retry this daily
      }
      transientRun = 0;

      if (existing.has(post.slug)) {
        done.add(target.query);
        console.log(`  ↩︎  exists: ${post.slug}`);
        continue;
      }

      await writeFile(join(POSTS_DIR, `${post.slug}.md`), post.markdown, 'utf8');
      existing.add(post.slug);
      done.add(target.query);
      published++;
      console.log(`  ✅  published: ${post.slug}`);
    } catch (err) {
      console.log(`  ⚠️  error on "${target.query}": ${err.message.slice(0, 120)}`);
      if (/\b429\b|RESOURCE_EXHAUSTED|Quota exceeded/i.test(err.message)) {
        console.log('  ⛔ Google Places daily quota exhausted — stopping this run (targets not marked done; will retry after reset).');
        break;
      }
    }
  }

  await savePublished(done);
  // A failed Details call and a venue with no phone on file look identical in
  // the output, so they are counted apart: only the first kind is worth a retry.
  const failNote = DETAILS_FAILED
    ? `\n⚠️  ${DETAILS_FAILED} post(s) published WITHOUT phone/hours — the Details call FAILED (quota/network), so these are retry targets.`
    : '';
  const transientNote = transientTotal
    ? `\n⏳ ${transientTotal} target(s) left queued — the vision API was unreachable, so nothing was learned about them.`
    : '';
  // Tell the shared ledger what publishing actually spent, so the backfill and
  // the closure check that run after it see a true remaining balance.
  if (DETAILS_USED > 0) {
    try {
      const { record } = await import('./lib/places-budget.mjs');
      await record('publish', DETAILS_USED);
    } catch { /* a broken ledger must not fail a successful publish run */ }
  }
  const budgetNote = DETAILS_SKIPPED
    ? `\n📇 ${DETAILS_SKIPPED} post(s) published without phone/hours — the day's Places share was spent. The backfill fills these in; nothing is lost.`
    : '';
  console.log(`\n📦  Done. ${published} new post(s). ${done.size} target(s) completed total.${failNote}${budgetNote}\n`);
  // Machine-readable tail so the workflow can explain a zero HONESTLY. On
  // 2026-08-05 the run published nothing and the Telegram report blamed the
  // Places quota — the stock wording for any zero — when the real cause was
  // that the queue had run dry: every region×topic combination had been used,
  // and no amount of quota would have produced a post. The reader was told to
  // wait for a reset that would change nothing. `queue` is the count BEFORE
  // this run consumed any of it.
  console.log(`PUBLISH_SUMMARY queue=${queue.length} published=${published} targets_done=${done.size}`);

  // Busy-times reporting. A missing key, an exhausted account and a venue that
  // simply has no forecast all produced the same silence before, which is how
  // the key going unset went unnoticed for days. Lockouts now announce
  // themselves loudly enough that the publish log and the Telegram summary
  // carry them; 'no data' stays quiet because it is normal and expected.
  try {
    const { busynessDiagnostics } = await import('./lib/besttime.mjs');
    const bd = busynessDiagnostics();
    const attempted = Object.values(bd).reduce((a, b) => a + b, 0);
    if (attempted) {
      console.log(`📊 busy-times: ${bd.ok} with data, ${bd.noData} none listed` +
        (bd.noKey ? `, ${bd.noKey} SKIPPED — BESTTIME_API_KEY not set` : '') +
        (bd.quota ? `, ${bd.quota} BLOCKED — BestTime credits exhausted or rate-limited` : '') +
        (bd.authFailed ? `, ${bd.authFailed} BLOCKED — BestTime key rejected` : '') +
        (bd.apiError || bd.network ? `, ${bd.apiError + bd.network} API/network errors` : ''));
      if (bd.noKey || bd.quota || bd.authFailed) {
        console.log('⚠️  BUSYTIMES-BLOCKED: new posts shipped WITHOUT quiet-hours data — the one dataset Google Maps does not expose.');
      }
    }
  } catch { /* reporting must never fail a publish */ }
}

// ── Queue building + round-robin rotation ────────────────────
export function buildRotatedQueue(targets, done, countries, seasonal = [], opts = {}) {
  const {
    capPerCountry = Infinity,
    countryCounts = new Map(),
    regionCatCounts = new Map(),
    regionQualifyingCounts = new Map(),
  } = opts;
  const seen = new Set();
  const all = [];
  const addedPerCountry = new Map();
  const add = (t) => {
    if (!t.query || seen.has(t.query) || done.has(t.query)) return;
    const ctry = t.country ?? 'South Korea';
    // Stop queueing a country once it reaches the fill cap (published + already
    // queued this run). Keeps backfill from over-filling any one country.
    const projected = (countryCounts.get(ctry) || 0) + (addedPerCountry.get(ctry) || 0);
    if (projected >= capPerCountry) return;
    seen.add(t.query);
    addedPerCountry.set(ctry, (addedPerCountry.get(ctry) || 0) + 1);
    all.push(t);
  };

  // Curated targets (data/targets.json) are Korea unless they say otherwise —
  // only queue those for the countries we're generating this run.
  const activeNames = new Set(countries.map((c) => c.name));
  targets.forEach((t) => {
    const ctry = t.country ?? 'South Korea';
    if (activeNames.has(ctry)) add({ country: ctry, ...t });
  });
  if (AUTO_EXPAND) {
    for (const c of countries) {
      for (const tpl of TOPIC_TEMPLATES) {
        for (const region of c.regions ?? []) {
          add({ country: c.name, region, query: tpl.q(region, c.name), category: tpl.category, topic: tpl.topic });
        }
      }
    }
  }

  // Fill order = fewest existing posts first (see the sort below), so under-covered
  // countries catch up; country `priority` (data/countries.json) is now only a
  // tie-breaker. Within a country we round-robin across its regions.
  const prio = new Map(countries.map((c) => [c.name, c.priority ?? 999]));
  const byCountry = new Map();
  for (const t of all) {
    const c = t.country ?? 'South Korea';
    if (!byCountry.has(c)) byCountry.set(c, []);
    byCountry.get(c).push(t);
  }
  // Fewest existing posts FIRST so under-covered countries catch up instead of the
  // biggest (Korea) always going first; country priority breaks ties. countryCounts
  // updates every run, so the order self-balances over time.
  const orderedCountries = [...byCountry.keys()].sort(
    (a, b) =>
      ((countryCounts.get(a) || 0) - (countryCounts.get(b) || 0)) ||
      ((prio.get(a) ?? 999) - (prio.get(b) ?? 999)) ||
      a.localeCompare(b)
  );
  // Cross-country round-robin: one post per country per pass (regions rotated
  // within each country). A single run therefore spreads across the under-covered
  // countries — e.g. 16 posts = one each to the 16 smallest — rather than piling
  // onto one. Countries run out of queued targets independently; the loop ends
  // when every country is drained.
  // Region totals (summed across categories) → zero/low-coverage cities FIRST
  // within each country. Jiufen/Cebu/Penang-class regions sat at 0 posts while
  // each country's capital kept growing, because plain rotation treats them
  // equally; ordering buckets fewest-first makes a country's emptiest city its
  // first pick every run, without changing cross-country fairness.
  const regionTotals = new Map();
  for (const [k, v] of regionCatCounts) {
    const r = k.slice(0, k.lastIndexOf('|'));
    regionTotals.set(r, (regionTotals.get(r) || 0) + v);
  }
  // Within one region, take the categories in turn — and start with whichever the
  // region has LEAST of. Rotation was previously region-only, so a region's
  // targets came out in template order; with 4 of the 12 templates mapping to
  // 'attraction', the 2026-08-05 batch of 51 posts was 48 attractions, 2
  // hidden-gems and 1 trendy. That starves the itinerary lunch slot (only
  // category 'restaurant' can fill it) and leaves the restaurant/cafe/hidden-gem
  // roundup hubs, which need 4 posts each, permanently below the line.
  const interleaveByCategory = (targets, region) => {
    const byCat = new Map();
    for (const t of targets) {
      const c = t.category || 'attraction';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(t);
    }
    const cats = [...byCat.keys()].sort(
      (a, b) => ((regionCatCounts.get(region + '|' + a) || 0) - (regionCatCounts.get(region + '|' + b) || 0))
        || a.localeCompare(b)
    );
    const out = [];
    let left = targets.length, i = 0;
    while (left > 0) {
      const b = byCat.get(cats[i++ % cats.length]);
      if (b.length) { out.push(b.shift()); left--; }
    }
    return out;
  };
  const perCountry = orderedCountries.map((cname) => {
    const rb = new Map();
    for (const t of byCountry.get(cname)) {
      if (!rb.has(t.region)) rb.set(t.region, []);
      rb.get(t.region).push(t);
    }
    const buckets = [...rb.entries()]
      .sort((a, b) => (regionTotals.get(a[0]) || 0) - (regionTotals.get(b[0]) || 0))
      .map(([region, v]) => interleaveByCategory(v, region));
    return { buckets, i: 0 };
  });
  const rotated = [];
  let remaining = all.length;
  while (remaining > 0) {
    for (const q of perCountry) {
      for (let k = 0; k < q.buckets.length; k++) {
        const b = q.buckets[q.i % q.buckets.length];
        q.i++;
        if (b.length) { rotated.push(b.shift()); remaining--; break; }
      }
    }
  }

  // In-season events jump to the FRONT so they publish while relevant.
  const seasonalQueue = [];
  const sseen = new Set();
  for (const e of seasonal) {
    if (!e.query || done.has(e.query) || seen.has(e.query) || sseen.has(e.query)) continue;
    sseen.add(e.query);
    seasonalQueue.push({ country: e.country, region: e.region, query: e.query, category: e.category, topic: e.topic });
  }
  // Near-roundup boost: pull forward targets whose region×category sits at 2-3
  // published posts — one more post flips a whole new city-hub page live (the
  // roundup template requires 4). Stable partition, so the fewest-first country
  // fairness above is preserved within each half.
  const ROUNDUP_CATS = new Set(['attraction', 'restaurant', 'trendy', 'hidden-gem']);
  const nearRoundup = (t) => {
    if (!t.region || !ROUNDUP_CATS.has(t.category)) return false;
    const n = regionCatCounts.get(t.region + '|' + t.category) || 0;
    return n === 2 || n === 3;
  };
  const boosted = [...rotated.filter(nearRoundup), ...rotated.filter((t) => !nearRoundup(t))];

  // Itinerary-gate boost: a region at 9-11 (or 21-23) qualifying posts is close to
  // unlocking an itinerary page — filling those first compounds (spec 2026-07-27).
  const ITINERARY_GATE_RANGES = [[9, 11], [21, 23]]; // 3 posts below gateFor()'s 12/24 thresholds
  const nearItineraryGate = (t) => {
    if (!t.region) return false;
    const n = regionQualifyingCounts.get(t.region) || 0;
    return ITINERARY_GATE_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
  };
  const gateBoosted = [...boosted.filter(nearItineraryGate), ...boosted.filter((t) => !nearItineraryGate(t))];

  const queueOut = [...seasonalQueue, ...gateBoosted];
  if (process.env.QUEUE_DEBUG === '1') {
    console.log('[QUEUE_DEBUG] first 20:');
    for (const t of queueOut.slice(0, Number(process.env.QUEUE_DEBUG_N ?? 20))) console.log(`  ${t.country ?? 'South Korea'} / ${t.region} / ${t.category}`);
  }
  return queueOut;
}

// How many published guides each country already has (from post frontmatter).
// Drives the per-country fill cap used by the backfill workflow.
// How many posts each region×category pair already has. Drives the near-roundup
// boost: a city hub page ('Best Restaurants in X') auto-builds at 4 posts, so a
// pair sitting at 2-3 is one or two posts away from a brand-new indexable page —
// the cheapest possible content win.
async function countPostsByRegionCategory() {
  const counts = new Map();
  for (const f of await readdir(POSTS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const src = await readFile(join(POSTS_DIR, f), 'utf8');
    const region = (src.match(/^region:\s*"?([^"\n]+?)"?\s*$/m) || [])[1]?.trim();
    const category = (src.match(/^category:\s*"?([^"\n]+?)"?\s*$/m) || [])[1]?.trim();
    if (!region || !category) continue;
    const k = region + '|' + category;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

// Full-frontmatter parse per post, so "qualifying" here means EXACTLY what
// src/lib/itinerary.mjs's qualifyingPosts()/gateFor() mean (not draft, not a
// category:event post, numeric place.lat/lng, businessStatus not CLOSED_*) —
// imported and reused rather than re-implemented, so the generator's boost and
// the itinerary builder's gate can never drift apart. Unlike
// countPostsByRegionCategory above (a cheap region+category regex scan used
// for the near-roundup boost), this needs the full parsed place block, so it
// reads+parses every post's frontmatter with js-yaml. Powers the
// itinerary-gate boost below.
async function countQualifyingPostsByRegion() {
  const counts = new Map();
  for (const f of await readdir(POSTS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const raw = await readFile(join(POSTS_DIR, f), 'utf8');
    const end = raw.indexOf('\n---', 3);
    if (end === -1) continue;
    let fm;
    try { fm = yaml.load(raw.slice(4, end)); } catch { continue; }
    if (!fm || !fm.region) continue;
    if (!qualifyingPosts([{ data: fm }]).length) continue;
    counts.set(fm.region, (counts.get(fm.region) || 0) + 1);
  }
  return counts;
}

async function countPostsByCountry() {
  const counts = new Map();
  for (const f of await readdir(POSTS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const m = (await readFile(join(POSTS_DIR, f), 'utf8')).match(/\ncountry:\s*"?([^"\n]+?)"?\s*$/m);
    const ctry = m ? m[1].trim() : 'South Korea';
    counts.set(ctry, (counts.get(ctry) || 0) + 1);
  }
  return counts;
}

// Every Google place id already published, so we never duplicate a venue.
async function loadUsedPlaceIds() {
  const ids = new Set();
  for (const f of await readdir(POSTS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const m = (await readFile(join(POSTS_DIR, f), 'utf8')).match(/\n {2}id:\s*"?([^"\n]+?)"?\s*$/m);
    if (m) ids.add(m[1].trim());
  }
  return ids;
}

// Every hero image URL already published, so no two posts share the same photo.
// (The first `  url:` in a post's frontmatter is always the heroImage url —
// gallery items are indented under `  - url:` and don't match this pattern.)
async function loadUsedImageUrls() {
  const { unsplashNum } = await import('./lib/images.mjs');
  const urls = new Set();
  for (const f of await readdir(POSTS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const m = (await readFile(join(POSTS_DIR, f), 'utf8')).match(/\n {2}url:\s*"?([^"\n]+?)"?\s*$/m);
    if (m) {
      const u = m[1].trim();
      urls.add(u);
      const n = unsplashNum(u); // also key on photo-id so ?param variants can't dupe
      if (n) urls.add(n);
    }
  }
  return urls;
}

// In-season events (this month or next, for lead time) for active countries.
async function loadSeasonalTargets(activeNames) {
  try {
    const { events } = JSON.parse(await readFile(EVENTS_FILE, 'utf8'));
    const m = new Date().getUTCMonth() + 1; // 1-12
    const next = (m % 12) + 1;
    return (events ?? []).filter(
      (e) => activeNames.has(e.country) && (e.months?.includes(m) || e.months?.includes(next))
    );
  } catch { return []; }
}

async function loadPublished() {
  try {
    const { done } = JSON.parse(await readFile(PUBLISHED_FILE, 'utf8'));
    return new Set(done ?? []);
  } catch { return new Set(); }
}
async function savePublished(done) {
  await writeFile(PUBLISHED_FILE, JSON.stringify({ done: [...done] }, null, 2) + '\n', 'utf8');
}

// Primary local language per country, for the "do locals actually go here?"
// signal derived from review LANGUAGES (not text). English-official or highly
// multilingual countries → null, so an English review there is NOT read as a
// tourist and we never over-claim "locals' favourite".
const COUNTRY_LANG = {
  'South Korea': 'ko', Japan: 'ja', Thailand: 'th', France: 'fr', Italy: 'it',
  China: 'zh', Spain: 'es', Vietnam: 'vi', Taiwan: 'zh', Indonesia: 'id',
  Malaysia: 'ms', Turkey: 'tr',
  'United States': null, 'United Arab Emirates': null, India: null,
  Philippines: null, Singapore: null,
};

// Turn raw Places metadata (review LANGUAGES + star counts, text discarded) into
// honest booleans the writer must obey. Every "hidden gem / locals' favourite"
// claim is gated here on real data, never on the search query wording.
function computeLocalSignals(raw, country) {
  if (!raw) return null;
  const n = raw.userRatingsTotal || 0;
  const rating = raw.rating || 0;
  const popularity = n >= 5000 ? 'very-popular' : n >= 1200 ? 'well-known' : 'under-the-radar';
  const lang = COUNTRY_LANG[country];
  let localReviewRatio = null;
  let localsFavorite = false;
  if (lang && raw.reviewLangs?.length) {
    const local = raw.reviewLangs.filter((l) => l === lang).length;
    localReviewRatio = Math.round((local / raw.reviewLangs.length) * 100) / 100;
    localsFavorite = localReviewRatio >= 0.6 && n >= 80;
  }
  // "Hidden gem / under the radar / less touristy" is only HONEST when it's well
  // rated AND not already mobbed — otherwise the claim is gated off.
  const localSecretOk = rating >= 4.2 && n > 0 && n < 1500;
  return { popularity, venueType: raw.venueType || null, localReviewRatio, localsFavorite, localSecretOk };
}

// ── LIVE path ────────────────────────────────────────────────
async function buildLivePost(target) {
  const { searchPlaces, fetchPlaceReviewSignals } = await import('./lib/places.mjs');
  const { resolveHero, pickGallery } = await import('./lib/images.mjs');
  const { writeArticle } = await import('./lib/writer.mjs');
  const { verifyHeroImage } = await import('./lib/vision-check.mjs');

  const results = await searchPlaces(target.query, { max: 5 });
  // ACCURACY-FIRST venue choice (user directive 2026-07-25): we only write about
  // a venue whose photo we can VERIFY — the venue's own self-hosted Places photo
  // or a Commons photo whose title matches name+region on ≥2 tokens. A wrong
  // photo and a photoless post are BOTH banned, so when a candidate's photo
  // can't be verified we move to the NEXT candidate venue in the same city
  // rather than publish anyway. No candidate verifies → this slot is skipped.
  let place = null;
  let hero = null;
  for (const cand of results) {
    if (!checkPlace(cand).ok) continue;
    // English-site guard: a name with no Latin letters would make a Hangul slug.
    if (!/[a-z0-9]/i.test(cand.name || '')) continue;
    if (cand.id && USED_PLACE_IDS.has(cand.id)) continue;
    let h = await resolveHero({
      namedVenue: cand.name,
      region: target.region,
      topic: target.topic,
      country: target.country,
      place: cand,
      used: USED_IMAGE_URLS,
      selfHost: true, // the venue's real Google photo, self-hosted, is priority 1
      strict: true,
    });
    // Google photos blocked at billing level → Foursquare/Flickr supply REAL
    // venue-photo candidates (same vision gate decides). Raises the strict-mode
    // pass rate so venue-post output stays high despite the Google block.
    if (!isImageAllowed(h)) {
      const { venuePhotoCandidates } = await import('./lib/photo-sources.mjs');
      // `near` was missing here, so placeStop was EMPTY on the publishing path —
      // every city/country stopword guard in photo-sources was inert exactly where
      // new posts are created ("Bangkok Bold Kitchen" could take "Bangkok Art Cafe").
      for (const alt of await venuePhotoCandidates({
        name: cand.name, lat: cand.lat, lng: cand.lng,
        near: `${target.region}, ${target.country}`,
      })) {
        if (USED_IMAGE_URLS.has(alt.url)) continue;
        h = alt;
        break;
      }
    }
    if (!isImageAllowed(h)) {
      console.log(`  ⏭️   "${cand.name}" — no verified photo; trying next candidate`);
      continue;
    }
    // Second gate: an AI actually LOOKS at the image. Filename/token matching
    // alone shipped a fairy-tale painting on a restaurant post; "name matches
    // but doesn't fit" is a user-directed hard reject (2026-07-26).
    const vis = await verifyHeroImage({
      url: h.url, name: cand.name, category: target.category,
      region: target.region, country: target.country,
    });
    if (!vis.ok) {
      // "The model said no" and "the model never answered" are different facts.
      // vision-check returns ok:false for BOTH, deliberately (an overloaded API
      // is not evidence a photo is right), so the caller has to tell them apart —
      // otherwise a rate-limit window burns the target out of the queue forever.
      if (/vision unavailable|no-api-key/i.test(vis.reason)) LAST_SKIP_TRANSIENT = true;
      console.log(`  👁️   "${cand.name}" — vision check rejected hero (${vis.reason}); trying next candidate`);
      continue;
    }
    place = cand; hero = h; break;
  }
  if (!place) {
    console.log(`  ⏭️   skip "${target.query}" — no candidate venue with a verified photo`);
    return null;
  }
  if (place.id) USED_PLACE_IDS.add(place.id);

  const heroImage = hero;
  // ONE in-body photo, sourced the same way the backfill does. pickGallery()
  // reads Google Places photos, which are blocked for this account, so it
  // returned nothing and every new post shipped with a single hero. Commons
  // covers landmarks; the venue's own Foursquare photos cover the cafes and
  // restaurants an encyclopedia never has. Certainty is the bar: a candidate is
  // dropped unless the gate is sure it shows THIS place, and a hedged verdict
  // ("probably", "plausibly") counts as a rejection — one correct hero is a
  // perfectly good outcome, and a doubtful second photo is worse than none.
  const gallery = [];
  try {
    const { commonsBest, tokens } = await import('./lib/commons.mjs');
    const { venuePhotoCandidates } = await import('./lib/photo-sources.mjs');
    const { verifyGalleryImage } = await import('./lib/vision-check.mjs');
    const heroUrl = hero?.url;
    const near = `${target.region}, ${target.country}`;
    const cands = [];
    try {
      const wiki = await commonsBest(`${place.name} ${target.region}`, {
        used: new Set([heroUrl]),
        minWidth: 1200,
        crossCheck: tokens(`${place.name} ${target.region}`),
        minCross: 2,
      });
      if (wiki?.url) cands.push({ ...wiki, license: 'wikimedia' });
    } catch {}
    try {
      for (const c of await venuePhotoCandidates({
        name: place.name, lat: place.lat, lng: place.lng, near,
      })) {
        if (c.url && c.url !== heroUrl) cands.push(c);
        if (cands.length >= 4) break;
      }
    } catch {}
    for (const c of cands) {
      if (USED_IMAGE_URLS.has(c.url)) continue;
      let v;
      try {
        v = await verifyGalleryImage({
          url: c.url, heroUrl, name: place.name,
          category: target.category, region: target.region, country: target.country,
        });
      } catch { continue; }
      const hedged = /probabl|plausib|likely|appears to|could be|maybe|possibly/i.test(v?.reason || '');
      if (!v?.ok || hedged) continue;
      const entry = { url: c.url, credit: c.credit, license: c.license, source: c.source };
      if (isImageAllowed(entry)) {
        gallery.push(entry);
        USED_IMAGE_URLS.add(c.url);
        console.log(`  \u{1F5BC}  in-body photo: ${v.reason}`);
      }
      break;
    }
  } catch (e) {
    console.log(`  in-body photo skipped: ${e.message.slice(0, 60)}`);
  }

  const title = makeTitle(place.name, target, place);

  // ONE extra Details call per published venue → honest "like a local" signals
  // (review languages + counts; text discarded). Never blocks publishing.
  //
  // Skipped once the day's share is spent. Stopping deliberately is much better
  // than spending past the cap: past it Google answers 429 for EVERYONE, which
  // takes down the closure detection that unpublishes shut venues, not just
  // this nicety. The backfill fills these in tomorrow.
  let localSignals = null;
  try {
    if (DETAILS_USED >= DETAILS_BUDGET) {
      throw Object.assign(new Error('places-budget spent'), { budget: true });
    }
    DETAILS_USED++;
    const raw = await fetchPlaceReviewSignals(place.id);
    localSignals = computeLocalSignals(raw, target.country);
    // Verified contact/hours from the same Details call → practical fact box.
    if (raw?.phone) place.phone = raw.phone;
    if (raw?.openingHours?.length) place.openingHours = raw.openingHours;
    // raw === null means the CALL failed (quota/network), not that the venue
    // has no phone listed. Counting the two separately is what tells a thin
    // run apart from a run full of ancient gates and public squares, which
    // legitimately have neither a phone nor posted hours.
    if (raw === null) DETAILS_FAILED++;
    if (localSignals) {
      const lf = localSignals.localsFavorite ? ' · locals-favourite' : '';
      console.log(`  📍 signals: ${localSignals.popularity}${lf}${localSignals.localSecretOk ? ' · secret-ok' : ''}`);
    }
  } catch (e) {
    // Distinguish "we chose not to call" from "the call failed" — the second
    // is a retry target, the first is normal budget behaviour and must not be
    // reported as a fault.
    if (e?.budget) DETAILS_SKIPPED++;
    /* signals are a bonus; publishing proceeds without them */
  }

  // Real foot-traffic quiet/busy hours (BestTime.app). No-op without an API key;
  // null when BestTime can't forecast the venue → we simply store nothing.
  // Events are skipped, and the reason is measured rather than assumed: across
  // the 66 published event posts the forecast hit rate is 0%. BestTime forecasts
  // PLACES from foot-traffic history, and a concert or festival is an occasion,
  // not a place with a weekly rhythm. Every one of those calls spends a credit to
  // be told "no data", so the category is excluded rather than retried daily.
  // Venue categories are worth it — restaurants 52%, cafés 48%, hidden gems 34%,
  // attractions 27%.
  if (target.category !== 'event') {
    try {
      const { fetchBusyness } = await import('./lib/besttime.mjs');
      const bz = await fetchBusyness(place.name, place.address);
      if (bz) {
        // Clamp to the venue's real opening hours BEFORE storing — this stored
        // object is what the fact box and BestTimeTool render, and unclamped it
        // advertised "weekend quiet: 6–7 PM" for a venue that closes at 6.
        // (The writer's crowdFacts below re-clamp independently; that copy never
        // reaches the frontmatter.) No parseable hours → store as fetched.
        const clamped = clampBusynessHours(bz, place.openingHours) ?? bz;
        place.busyness = { updated: new Date().toISOString().slice(0, 10) };
        for (const k of ['weekdayQuiet', 'weekdayBusy', 'weekendQuiet', 'weekendBusy']) {
          if (clamped[k]?.length) place.busyness[k] = clamped[k];
        }
        if (bz.venueId) place.busyness.venueId = bz.venueId;
        console.log(`  📊 foot-traffic: quiet(wd) ${(clamped.weekdayQuiet ?? []).join(',') || '—'}`);
      }
    } catch { /* foot-traffic is a bonus; never blocks publishing */ }
  }

  // Real foot-traffic hours are our ONE data moat (nobody else publishes this per
  // venue) — hand them to the writer in plain language so they land in the prose,
  // quickAnswer and FAQ, not just the sidebar box. Big AI-citation signal.
  // %24 so an end hour of 24 reads as 12am (midnight), not 12pm.
  const hr12 = (h) => { const x = ((h % 24) + 24) % 24; return `${x % 12 || 12}${x < 12 ? 'am' : 'pm'}`; };
  const span = (a) => (a && a.length ? `${hr12(Math.min(...a))}–${hr12(Math.max(...a) + 1)}` : null);
  const bz = place.busyness;
  // BestTime reports foot traffic around the venue, which does not stop when the
  // doors do — a café that opens at 11 still has a quiet 7–9am on the pavement
  // outside. The writer is told to quote these hours verbatim, so an unfiltered
  // quiet window becomes "come at 7am" for a place that is shut until 11.
  const openHours = openHourSet(place.openingHours);
  const inOpen = (a) => (!openHours ? a : (a ?? []).filter((h) => openHours.has(((h % 24) + 24) % 24)));
  const crowdFacts = bz && {
    quietestWeekday: span(inOpen(bz.weekdayQuiet)),
    quietestWeekend: span(inOpen(bz.weekendQuiet)),
    busiestWeekend: span(inOpen(bz.weekendBusy)),
  };

  const facts = {
    name: place.name,
    address: place.address,
    rating: place.rating,
    reviews: place.userRatingsTotal,
    priceLevel: place.priceLevel,
    editorialSummary: place.editorialSummary,
    region: target.region,
    country: target.country,
    // The writer was never shown the opening hours, though they were fetched
    // fifty lines above and printed in the fact box beside its prose. So it
    // guessed, and 17 published guides told readers to turn up at a time the
    // venue is shut — a Chiang Mai noodle shop recommended "for lunch, 11am-2pm"
    // when it opens at 4pm, a museum described as "closed Mondays" that opens at
    // 9 on Mondays. Nothing in the pipeline could have caught that, because the
    // model had no way to know.
    ...(place.openingHours?.length && { openingHours: place.openingHours }),
    ...(localSignals && { localSignals }),
    ...(crowdFacts && Object.values(crowdFacts).some(Boolean) && { crowdData: crowdFacts }),
  };

  const { body, quickAnswer, faq } = await writeArticle({
    title, region: target.region, country: target.country, category: target.category, facts,
  });

  return assemble(target, place, title, heroImage, gallery, { body, quickAnswer, faq });
}

// ── LIVE (no Places) path ────────────────────────────────────
// Anthropic-written neighborhood/topic guide with a free image and no venue
// fact box. Facts are intentionally general — the writer is told NOT to invent
// venue-specific details it can't verify.
async function buildPlacelessPost(target) {
  const { resolveHero } = await import('./lib/images.mjs');
  const { writeArticle } = await import('./lib/writer.mjs');

  const title = makePlacelessTitle(target);
  const facts = {
    topic: target.topic,
    area: target.query,
    region: target.region,
    country: target.country,
    category: target.category,
    guidance:
      'No verified venue data is available for this post. Write a genuinely useful GENERAL guide to this area/topic for international visitors — what to expect, how to get around, tips, what the area is known for. Do NOT invent specific business names, exact hours, prices, or addresses.',
  };

  const { body, quickAnswer, faq } = await writeArticle({
    title, region: target.region, country: target.country, category: target.category, facts,
  });

  // Accurate-first: Wikimedia by topic+region, else country-scoped Unsplash.
  const hero = await resolveHero({
    namedVenue: null,
    region: target.region,
    topic: target.topic,
    country: target.country,
    used: USED_IMAGE_URLS,
  });
  if (!isImageAllowed(hero)) {
    console.log(`  ⏭️   skip "${target.query}" — no allowed image for a placeless guide`);
    return null;
  }
  // The SAME vision gate the venue path uses. This path had none: it matched on
  // filename tokens alone and shipped whatever came back, which is exactly how a
  // radio-software screenshot became a festival hero. There is no venue name to
  // check against here, so the gate is asked the question that does apply — is
  // this an honest photo of this kind of place in this locale — and a rejection
  // skips the slot rather than publishing an unchecked picture.
  const { verifyHeroImage } = await import('./lib/vision-check.mjs');
  const vis = await verifyHeroImage({
    url: hero.url,
    // A curated target may carry no topic; "undefined in Seoul" would be a
    // nonsense subject to ask a vision model about.
    name: `${target.topic || target.category} in ${target.region}`,
    category: target.category,
    region: target.region,
    country: target.country,
  });
  if (!vis.ok) {
    console.log(`  👁️   skip "${target.query}" — vision check rejected the hero (${vis.reason})`);
    return null;
  }

  return assemble(target, null, title, hero, [], { body, quickAnswer, faq });
}

// ── DUMMY path ───────────────────────────────────────────────
function buildDummyPost(target) {
  const place = {
    id: `dummy_${slugify(target.query)}`,
    name: `${target.region} ${cap(target.topic)} Pick`,
    address: `Sample-ro 1, ${target.region}, Korea`,
    rating: 4.4,
    userRatingsTotal: 1200,
    priceLevel: 1,
    businessStatus: 'OPERATIONAL',
    googleMapsUrl: 'https://maps.google.com/?q=example',
    lat: 37.5665,
    lng: 126.978,
  };
  if (!checkPlace(place).ok) return null;

  const title = makeTitle(place.name, target, place);
  const img = (t) => ({ url: '/images/placeholder-market.svg', credit: 'Placeholder image', license: 'placeholder', source: 'local' });
  const heroImage = img();
  const gallery = [img(), img()];
  const body = `This is a **sample post generated in DUMMY mode** (no API credits used). In live mode this is written by Claude from verified Google Places data.

## What to know
When live, real details (address, rating, price) are injected here from Google Places — the writer is never allowed to invent them.

## How to get there
Use a T-money card on the Seoul Metro or local buses.

## Tips
Go on a weekday morning to avoid crowds.

*Details can change — always verify before visiting.*`;
  const quickAnswer = `Sample answer-first summary for ${place.name}. Live mode generates a concise, actionable 2-3 sentence answer from verified data.`;
  const faq = [
    { q: `Where is ${place.name}?`, a: `Sample address: ${place.address}. Live mode uses the verified Google Places address.` },
    { q: 'When is the best time to visit?', a: 'Weekday mornings are usually quieter. Live mode tailors this per venue.' },
  ];

  return assemble(target, place, title, heroImage, gallery, { body, quickAnswer, faq });
}

// ── shared assembly ──────────────────────────────────────────
// Tidy a raw Google place name for use in a title (drop marketing suffixes).
function cleanVenueName(name) {
  let s = String(name)
    .replace(/\s*[-–—]\s*michelin[^,]*$/i, '')       // "- Michelin Selected 2025-2026"
    .replace(/\s*\((?:michelin|selected)[^)]*\)\s*$/i, '')
    .trim();
  // Google returns BILINGUAL names in non-Latin locales, e.g.
  // "مطعم الركن اليمني للمندي Yemeni Corner Restaurant" or "翔記 Xiang Restaurant".
  // On an English site the local-script half doesn't belong in the H1/title, so
  // keep only the Latin portion (Basic/Extended Latin + Latin-Extended-Additional,
  // which preserves Vietnamese diacritics). If stripping leaves too little real
  // text, keep the original (a purely local-script name — rare, can't romanize).
  const latin = s.replace(/[^\0-ɏḀ-ỿ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[A-Za-z].*[A-Za-z]/.test(latin)) s = latin;
  // Tidy separators left dangling after stripping a bilingual half
  // ("Al Khayma … | مطعم …" → "Al Khayma … |" → "Al Khayma …").
  s = s.replace(/\s*[|/·–—-]+\s*$/g, '').replace(/^\s*[|/·–—-]+\s*/g, '').trim();
  return s;
}
function cap(s) { return String(s).replace(/\b\w/g, (c) => c.toUpperCase()); }

// `place` may be null (placeless mode) — then no venue fact box is emitted.
function assemble(target, place, title, heroImage, gallery, content) {
  const { body, quickAnswer, faq } = content;
  const baseName = place?.name || target.topic;
  const slug = slugify(`${target.region}-${baseName}`);
  // Full ISO TIMESTAMP (not date-only): posts built in the same run get strictly
  // increasing times via PUB_SEQ, and each run is later than the last, so the
  // homepage "Latest stories" always surfaces genuinely-new posts first.
  const today = new Date(Date.now() + PUB_SEQ++ * 1000).toISOString();
  const country = target.country || 'South Korea';
  // Prefer a real, unique meta description from the answer-first summary (better
  // SEO than the old templated one). Fall back to the template only if empty.
  const qa = (quickAnswer || '').trim().replace(/\s+/g, ' ');
  // Sentence-boundary clip + honest review-intent signal both live in
  // lib/serp.mjs (shared with backfill-descriptions.mjs so the rules never
  // drift between new posts and the back catalogue).
  const description = withRatingSignal(
    qa
      ? clip(qa)
      : place
      ? `A practical visitor's guide to ${place.name} in ${target.region}, ${country}. Verified info on location, ratings, and how to get there.`
      : `A practical visitor's guide to ${target.topic} in ${target.region}, ${country} — what to expect, how to get around, and tips for your visit.`,
    place
  );

  // An EVENT target that resolved to a PLACE is not an event post. Searching
  // "Seoul fireworks festival" in Places returns Yeouido Park — the venue, not
  // the festival — and the generator wrote a perfectly good park guide wearing
  // category:event with no eventStartDate, which the publish gate then held
  // back as invalid (2026-08-04). The article is fine; only the label is wrong.
  // A dated event never reaches this path (seasonal targets carry their dates),
  // so demoting a dateless one to `attraction` loses nothing and ships a guide
  // that would otherwise sit quarantined forever.
  let category = target.category;
  if (category === 'event' && !target.startDate && !target.eventStartDate) {
    category = 'attraction';
    console.log(`  ↪︎ event target with no date resolved to a place — filing as attraction`);
  }

  const fm = {
    title,
    description,
    country,
    region: target.region,
    category,
    pubDate: today,
    heroImage,
    gallery,
    ...(place && {
      place: {
        id: place.id,
        name: place.name,
        address: place.address,
        rating: place.rating,
        userRatingsTotal: place.userRatingsTotal,
        priceLevel: place.priceLevel,
        googleMapsUrl: place.googleMapsUrl,
        businessStatus: place.businessStatus,
        lat: place.lat,
        lng: place.lng,
        phone: place.phone,
        openingHours: place.openingHours,
        busyness: place.busyness,
      },
    }),
    tags: [target.region.toLowerCase(), target.topic],
    quickAnswer,
    faq,
    aiGenerated: true,
    draft: false,
  };

  const src = place
    ? 'Facts are pulled from live Google Places data; images are licensed or public domain.'
    : 'Images are licensed or public domain. This is a general area/topic overview — verify specific venue details before visiting.';
  const disclosure = `> **How this guide was made:** Editor-reviewed, AI-assisted. ${src} See our [editorial policy](/about).\n\n`;
  // A bare ~ is markdown syntax, and the writer reaches for it as "about":
  // "~2 hours by direct bus" renders with a strikethrough through the number,
  // so the one fact in the line is the one thing the reader cannot read
  // (kenting-kenting-national-park, caught by validate-content on the first
  // bulk-fill batch, 2026-08-11). The translator already escapes it — the ko
  // and es files for that same post shipped a correct \~ — so only the English
  // source was ever wrong. Escape it here, where every post is written, rather
  // than asking the model to remember.
  const escapeTildes = (s) => String(s).replace(/(^|[^\\])~/g, '$1\\~');
  const markdown = `---\n${toYaml(fm)}---\n\n${disclosure}${escapeTildes(body)}\n`;
  return { slug, markdown };
}

// Minimal YAML emitter (avoids adding a dependency).
function toYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  let out = '';
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) { out += `${pad}${k}: []\n`; continue; }
      out += `${pad}${k}:\n`;
      for (const item of v) {
        if (item && typeof item === 'object') {
          const entries = Object.entries(item).filter(([, iv]) => iv !== null && iv !== undefined);
          entries.forEach(([ik, iv], i) => {
            const prefix = i === 0 ? `${pad}  - ` : `${pad}    `;
            out += `${prefix}${ik}: ${quote(iv)}\n`;
          });
        } else {
          out += `${pad}  - ${quote(item)}\n`;
        }
      }
    } else if (typeof v === 'object') {
      out += `${pad}${k}:\n${toYaml(v, indent + 1)}`;
    } else {
      out += `${pad}${k}: ${quote(v)}\n`;
    }
  }
  return out;
}

function quote(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // dates stay unquoted for Astro
  return JSON.stringify(s);
}

// Guarded like scripts/build-itineraries.mjs / scripts/translate-itineraries.mjs
// — without this, merely `import`-ing this module (e.g. from a unit test, or
// any future tool that wants to reuse buildRotatedQueue) would kick off a full
// live generator run as a side effect. Confirmed the hard way: adding
// scripts/generate.test.mjs without this guard triggered a real run that spent
// Google Places quota and rewrote data/published.json just from being imported.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
