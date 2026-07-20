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
const PUBLISHED_FILE = join(ROOT, 'data', 'published.json');

const POSTS_PER_RUN = Number(process.env.POSTS_PER_RUN ?? 2);
const AUTO_EXPAND = process.env.AUTO_EXPAND !== '0'; // auto-generate combos unless disabled
// DUMMY = can't do real writing (no Anthropic key, or forced) → canned output.
const DUMMY = process.env.DUMMY === '1' || !process.env.ANTHROPIC_API_KEY;
// USE_PLACES = pull verified facts + real venue photos from Google Places.
// Set NO_PLACES=1 to run in "placeless" mode: Anthropic-written neighborhood/
// topic guides with free (Unsplash/placeholder) images and no venue fact box.
// Handy when Google Places billing isn't available yet — flip it back on later.
const USE_PLACES =
  !DUMMY && process.env.NO_PLACES !== '1' && !!process.env.GOOGLE_MAPS_API_KEY;

// Regions and topic templates used to auto-extend the queue so the site can
// publish daily for a long time without hand-writing every target.
const REGIONS = [
  'Seoul', 'Busan', 'Jeju', 'Gyeongju', 'Incheon', 'Jeonju',
  'Gangneung', 'Daegu', 'Suwon', 'Sokcho', 'Andong', 'Yeosu',
];
const TOPIC_TEMPLATES = [
  { category: 'attraction', topic: 'top attraction', q: (r) => `top tourist attraction in ${r} South Korea` },
  { category: 'restaurant', topic: 'local restaurant', q: (r) => `best local restaurant in ${r} South Korea` },
  { category: 'hidden-gem', topic: 'hidden gem', q: (r) => `hidden gem worth visiting in ${r} South Korea` },
  { category: 'trendy', topic: 'trendy cafe', q: (r) => `trendy popular cafe in ${r} South Korea` },
  { category: 'restaurant', topic: 'street food', q: (r) => `famous street food spot in ${r} South Korea` },
];

async function main() {
  if (!existsSync(POSTS_DIR)) await mkdir(POSTS_DIR, { recursive: true });

  const { targets } = JSON.parse(await readFile(TARGETS_FILE, 'utf8'));
  const done = await loadPublished();
  const existing = new Set(
    (await readdir(POSTS_DIR)).map((f) => f.replace(/\.md$/, ''))
  );

  const queue = buildRotatedQueue(targets, done);

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
function buildRotatedQueue(targets, done) {
  const seen = new Set();
  const all = [];
  const add = (t) => {
    if (!t.query || seen.has(t.query) || done.has(t.query)) return;
    seen.add(t.query);
    all.push(t);
  };

  targets.forEach(add); // curated first (higher quality)
  if (AUTO_EXPAND) {
    for (const tpl of TOPIC_TEMPLATES) {
      for (const region of REGIONS) {
        add({ region, query: tpl.q(region), category: tpl.category, topic: tpl.topic });
      }
    }
  }

  // Round-robin by region so consecutive picks span different places.
  const byRegion = new Map();
  for (const t of all) {
    if (!byRegion.has(t.region)) byRegion.set(t.region, []);
    byRegion.get(t.region).push(t);
  }
  const buckets = [...byRegion.values()];
  const rotated = [];
  let i = 0;
  while (rotated.length < all.length) {
    const bucket = buckets[i % buckets.length];
    if (bucket.length) rotated.push(bucket.shift());
    i++;
  }
  return rotated;
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
  const { pickImage, pickGallery } = await import('./lib/images.mjs');
  const { writeArticle } = await import('./lib/writer.mjs');

  const results = await searchPlaces(target.query, { max: 5 });
  const place = results.find((p) => checkPlace(p).ok);
  if (!place) {
    console.log(`  ⏭️   skip "${target.query}" — no place passed guardrails`);
    return null;
  }

  const hero = await pickImage(place, target.topic);
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
  };

  const { body, quickAnswer, faq } = await writeArticle({
    title, region: target.region, category: target.category, facts,
  });

  return assemble(target, place, title, heroImage, gallery, { body, quickAnswer, faq });
}

// ── LIVE (no Places) path ────────────────────────────────────
// Anthropic-written neighborhood/topic guide with a free image and no venue
// fact box. Facts are intentionally general — the writer is told NOT to invent
// venue-specific details it can't verify.
async function buildPlacelessPost(target) {
  const { pickImage } = await import('./lib/images.mjs');
  const { writeArticle } = await import('./lib/writer.mjs');

  const title = makePlacelessTitle(target);
  const facts = {
    topic: target.topic,
    area: target.query,
    region: target.region,
    category: target.category,
    guidance:
      'No verified venue data is available for this post. Write a genuinely useful GENERAL guide to this area/topic for international visitors — what to expect, how to get around, tips, what the area is known for. Do NOT invent specific business names, exact hours, prices, or addresses.',
  };

  const { body, quickAnswer, faq } = await writeArticle({
    title, region: target.region, category: target.category, facts,
  });

  const hero = await pickImage(null, target.topic);
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
  const description = place
    ? `A practical visitor's guide to ${place.name} in ${target.region}, Korea. Verified info on location, ratings, and how to get there.`
    : `A practical visitor's guide to ${target.topic} in ${target.region}, Korea — what to expect, how to get around, and tips for your visit.`;

  const fm = {
    title,
    description,
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
