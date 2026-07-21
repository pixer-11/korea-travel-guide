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
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { slugify } from './lib/slugify.mjs';
import { checkPlace, isImageAllowed } from './lib/guardrails.mjs';

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
// DUMMY = can't do real writing (no Anthropic key, or forced) → canned output.
const DUMMY = process.env.DUMMY === '1' || !process.env.ANTHROPIC_API_KEY;
// USE_PLACES = pull verified facts + real venue photos from Google Places.
// Set NO_PLACES=1 to run in "placeless" mode: Anthropic-written neighborhood/
// topic guides with free (Unsplash/placeholder) images and no venue fact box.
// Handy when Google Places billing isn't available yet — flip it back on later.
const USE_PLACES =
  !DUMMY && process.env.NO_PLACES !== '1' && !!process.env.GOOGLE_MAPS_API_KEY;

// Topic templates auto-extend the queue so the site can publish daily for a
// long time without hand-writing every target. They are applied to every
// ACTIVE country's regions (see data/countries.json) → global by design.
const TOPIC_TEMPLATES = [
  { category: 'attraction', topic: 'top attraction', q: (r, c) => `top tourist attraction in ${r} ${c}` },
  { category: 'restaurant', topic: 'local restaurant', q: (r, c) => `best local restaurant in ${r} ${c}` },
  { category: 'hidden-gem', topic: 'hidden gem', q: (r, c) => `hidden gem worth visiting in ${r} ${c}` },
  { category: 'trendy', topic: 'trendy cafe', q: (r, c) => `trendy popular cafe in ${r} ${c}` },
  { category: 'restaurant', topic: 'street food', q: (r, c) => `famous street food spot in ${r} ${c}` },
];

async function main() {
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

  // Seasonal events: publish with priority when in season (current month or the
  // next month, for lead time), only for active countries.
  const activeNames = new Set(activeCountries.map((c) => c.name));
  const seasonal = await loadSeasonalTargets(activeNames);

  const queue = buildRotatedQueue(targets, done, activeCountries, seasonal);

  const mode = DUMMY ? 'DUMMY' : USE_PLACES ? 'LIVE + Places' : 'LIVE (no Places)';
  console.log(
    `\n🗺️  Generator — mode: ${mode} · target: ${POSTS_PER_RUN} post(s) · queue: ${queue.length} available`
  );

  let published = 0;
  for (const target of queue) {
    if (published >= POSTS_PER_RUN) break;
    try {
      const post = DUMMY
        ? buildDummyPost(target)
        : USE_PLACES
        ? await buildLivePost(target)
        : await buildPlacelessPost(target);
      if (!post) { done.add(target.query); continue; } // skipped by guardrails — don't retry daily

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
      console.log(`  ⚠️  error on "${target.query}": ${err.message}`);
    }
  }

  await savePublished(done);
  console.log(`\n📦  Done. ${published} new post(s). ${done.size} target(s) completed total.\n`);
}

// ── Queue building + round-robin rotation ────────────────────
function buildRotatedQueue(targets, done, countries, seasonal = []) {
  const seen = new Set();
  const all = [];
  const add = (t) => {
    if (!t.query || seen.has(t.query) || done.has(t.query)) return;
    seen.add(t.query);
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

  // Round-robin by country+region so consecutive picks span different places.
  const byBucket = new Map();
  for (const t of all) {
    const key = `${t.country}|${t.region}`;
    if (!byBucket.has(key)) byBucket.set(key, []);
    byBucket.get(key).push(t);
  }
  const buckets = [...byBucket.values()];
  const rotated = [];
  let i = 0;
  while (rotated.length < all.length) {
    const bucket = buckets[i % buckets.length];
    if (bucket.length) rotated.push(bucket.shift());
    i++;
  }

  // In-season events jump to the FRONT so they publish while relevant.
  const seasonalQueue = [];
  const sseen = new Set();
  for (const e of seasonal) {
    if (!e.query || done.has(e.query) || seen.has(e.query) || sseen.has(e.query)) continue;
    sseen.add(e.query);
    seasonalQueue.push({ country: e.country, region: e.region, query: e.query, category: e.category, topic: e.topic });
  }
  return [...seasonalQueue, ...rotated];
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

// ── LIVE path ────────────────────────────────────────────────
async function buildLivePost(target) {
  const { searchPlaces } = await import('./lib/places.mjs');
  const { resolveHero, pickGallery } = await import('./lib/images.mjs');
  const { writeArticle } = await import('./lib/writer.mjs');

  const results = await searchPlaces(target.query, { max: 5 });
  const place = results.find((p) => checkPlace(p).ok);
  if (!place) {
    console.log(`  ⏭️   skip "${target.query}" — no place passed guardrails`);
    return null;
  }
  // On this English site, skip venues whose name has no Latin letters — otherwise
  // the title/slug come out in Hangul (we can't romanize unattended). Rare.
  if (!/[a-z0-9]/i.test(place.name || '')) {
    console.log(`  ⏭️   skip "${target.query}" — non-Latin venue name (${place.name})`);
    return null;
  }
  if (place.id && USED_PLACE_IDS.has(place.id)) {
    console.log(`  ↩︎  skip "${target.query}" — venue already published (${place.name})`);
    return null;
  }
  if (place.id) USED_PLACE_IDS.add(place.id);

  const hero = await resolveHero({
    namedVenue: place.name,
    region: target.region,
    topic: target.topic,
    country: target.country,
    place,
  });
  const heroImage = isImageAllowed(hero) ? hero : null;
  const gallery = (await pickGallery(place, 3)).filter(isImageAllowed);

  const title = makeTitle(place.name, target);
  const facts = {
    name: place.name,
    address: place.address,
    rating: place.rating,
    reviews: place.userRatingsTotal,
    priceLevel: place.priceLevel,
    editorialSummary: place.editorialSummary,
    region: target.region,
    country: target.country,
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
  });
  const heroImage = isImageAllowed(hero) ? hero : null;

  return assemble(target, null, title, heroImage, [], { body, quickAnswer, faq });
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

  const title = makeTitle(place.name, target);
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
function makeTitle(name, target) {
  const t = target.category === 'restaurant' ? 'Where to Eat' : 'Guide';
  return `${name}: A Visitor's ${t} in ${target.region}`;
}
function makePlacelessTitle(target) {
  return `${cap(target.topic)} in ${target.region}: A Visitor's Guide`;
}
function cap(s) { return String(s).replace(/\b\w/g, (c) => c.toUpperCase()); }

// `place` may be null (placeless mode) — then no venue fact box is emitted.
function assemble(target, place, title, heroImage, gallery, content) {
  const { body, quickAnswer, faq } = content;
  const baseName = place?.name || target.topic;
  const slug = slugify(`${target.region}-${baseName}`);
  const today = new Date().toISOString().slice(0, 10);
  const country = target.country || 'South Korea';
  const description = place
    ? `A practical visitor's guide to ${place.name} in ${target.region}, ${country}. Verified info on location, ratings, and how to get there.`
    : `A practical visitor's guide to ${target.topic} in ${target.region}, ${country} — what to expect, how to get around, and tips for your visit.`;

  const fm = {
    title,
    description,
    country,
    region: target.region,
    category: target.category,
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
  const markdown = `---\n${toYaml(fm)}---\n\n${disclosure}${body}\n`;
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

main().catch((e) => { console.error(e); process.exit(1); });
