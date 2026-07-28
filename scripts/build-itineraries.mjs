#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  BUILD ITINERARIES — assembles src/content/itineraries/<city-slug>-<n>-days.md
//  from qualifying venue posts. The SOLVER (src/lib/itinerary.mjs) computes every
//  fact a reader sees (stop order, dwell minutes, walk legs, rain swap) — this
//  script only asks Claude for CONNECTIVE PROSE (day labels/intros, per-stop
//  "why", FAQ), and that prose is closed-world: the model may reference only the
//  venues/facts this script hands it, never invent a venue, price, time, or hour.
//
//  Idempotent: an unchanged structure (same stopsHash) is skipped. A small
//  structural change (≤2 stop slugs added/removed) keeps the existing prose and
//  only updates the numbers; a bigger change re-runs Claude for that variant.
//
//  Usage:
//    node scripts/build-itineraries.mjs                        # sweep everything
//    node scripts/build-itineraries.mjs --city=Seoul            # one city, all variants
//    node scripts/build-itineraries.mjs --city=Seoul --days=3   # one city, one variant
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { slugify } from './lib/slugify.mjs';
import { buildItinerary, qualifyingPosts, gateFor, closedDaysOf } from '../src/lib/itinerary.mjs';

const POSTS_DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../src/content/itineraries/', import.meta.url));
const STATE_FILE = fileURLToPath(new URL('../data/itineraries-state.json', import.meta.url));
const MODEL = process.env.ITINERARY_MODEL || 'claude-sonnet-5';

const LAUNCH_CITIES = ['Seoul', 'Tokyo', 'Bangkok'];
const MAX_NEW_CITIES_PER_WEEK = 2;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_VARIANTS = [3, 5]; // only variants the solver + content gates support

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const ONLY_CITY = arg('city');
const ONLY_DAYS = arg('days') ? Number(arg('days')) : null;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── load posts (same frontmatter/body split as translate-posts.mjs) ─────────
async function loadPosts() {
  const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
  const posts = [];
  for (const f of files) {
    const raw = await readFile(join(POSTS_DIR, f), 'utf8');
    const end = raw.indexOf('\n---', 3);
    if (end === -1) continue;
    let fm;
    try { fm = yaml.load(raw.slice(4, end)); } catch { continue; }
    if (!fm) continue;
    const body = raw.slice(end + 4).trim();
    posts.push({ id: f.replace(/\.md$/, ''), data: fm, body });
  }
  return posts;
}

// ── closed-world facts we hand the model per stop (nothing else) ───────────
function quietWindowSummary(post) {
  const b = post.data.place?.busyness;
  if (!b) return null;
  const range = (hrs) => {
    if (!Array.isArray(hrs) || !hrs.length) return null;
    const sorted = [...hrs].sort((a, c) => a - c);
    return `${sorted[0]}:00-${sorted[sorted.length - 1] + 1}:00`;
  };
  const wd = range(b.weekdayQuiet);
  const we = range(b.weekendQuiet);
  if (!wd && !we) return null;
  return ['weekdays ' + wd, we ? 'weekends ' + we : null].filter((x) => x && !x.endsWith('undefined')).join(', ');
}

function fallbackWhy(post) {
  const cat = post?.data?.category || 'stop';
  const rating = post?.data?.place?.rating;
  return rating
    ? `A ${cat} rated ${rating} by visitors, included as a stop on this route.`
    : `A recommended ${cat} stop on this route.`;
}

function countryFor(cityPosts) {
  const counts = new Map();
  for (const p of cityPosts) {
    const c = p.data.country || 'South Korea';
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  let best = 'South Korea', bestN = -1;
  for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
  return best;
}

function stopSlugSet(daysArr) {
  return new Set(daysArr.flatMap((d) => d.stops.map((s) => s.slug)));
}

function symmetricDiffSize(a, b) {
  let n = 0;
  for (const x of a) if (!b.has(x)) n++;
  for (const x of b) if (!a.has(x)) n++;
  return n;
}

function stopsHashOf(daysArr) {
  const raw = daysArr.map((d) => d.stops.map((s) => s.slug).join(',')).join('|');
  return createHash('sha1').update(raw).digest('hex');
}

// ── prompt assembly (closed-world: only what's built here reaches the model) ─
function walkDesc(leg) {
  if (!leg) return 'last stop of the day';
  if (leg.transit) return `${leg.km}km — beyond walking distance, take transit`;
  return `${leg.km}km, ~${leg.minutes} min walk`;
}

function dayBlock(day, idx, bySlug) {
  const lines = day.stops.map((s) => {
    const post = bySlug.get(s.slug);
    const closed = closedDaysOf(post?.data?.place?.openingHours);
    const quiet = quietWindowSummary(post);
    return [
      `  - [${s.slot}] "${post?.data?.title || s.slug}" (slug: ${s.slug})`,
      `      category: ${post?.data?.category || 'unknown'}`,
      `      quick answer: ${post?.data?.quickAnswer || '(none provided)'}`,
      `      closed days: ${closed.length ? closed.join(', ') : 'none listed'}`,
      `      quiet window: ${quiet || '(no data)'}`,
      `      dwell: ${s.dwellMin} minutes`,
      `      walk to next stop: ${walkDesc(s.walkToNext)}`,
    ].join('\n');
  });
  const rainPost = day.rainSwapSlug ? bySlug.get(day.rainSwapSlug) : null;
  lines.push(
    rainPost
      ? `  Rain-day alternative: "${rainPost.data.title}" (slug: ${day.rainSwapSlug}, category: ${rainPost.data.category})`
      : '  Rain-day alternative: none available'
  );
  return `Day ${idx + 1}:\n${lines.join('\n')}`;
}

const SAFETY_INSTRUCTION =
  'Write label+intro per day and a 1-2 sentence \'why\' per stop plus 3-5 FAQ entries. ' +
  'You may ONLY reference the venues and facts listed. Never introduce a venue, price, ' +
  'time, or claim not present in the input. Never state opening hours in prose (the page ' +
  'shows them from data).';

function buildPrompt({ city, country, days, daysArr, bySlug }) {
  const blocks = daysArr.map((d, i) => dayBlock(d, i, bySlug)).join('\n\n');
  return `You are writing connective prose for a ${days}-day travel itinerary in ${city}, ${country}, for a travel website.

VENUES AVAILABLE (closed world — this is the ONLY source of truth; do not use outside knowledge):
${blocks}

INSTRUCTIONS
${SAFETY_INSTRUCTION}

Also write:
- title: an SEO page title for this ${days}-day ${city} itinerary
- description: a 1-2 sentence meta description
- quickAnswer: a short answer-first summary paragraph describing the shape of the trip (day count, general areas/labels) — no invented facts
- For each day: a short evocative label (e.g. "Palaces & hanok lanes") and a 2-3 sentence intro connecting that day's stops
- whys: an entry for EVERY stop slug listed above, a 1-2 sentence reason it's on the itinerary, grounded only in the info given for that stop
- rainWhys: for each day that lists a rain-day alternative, one sentence on why that swap works if it rains, grounded only in its category/title
- faq: 3-5 general FAQ entries about doing this ${days}-day ${city} itinerary (pacing, getting around, timing) — do not invent facts not given above`;
}

const TOOL = {
  name: 'submit_itinerary',
  description: 'Return the itinerary connective prose and metadata.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      quickAnswer: { type: 'string' },
      days: {
        type: 'array',
        description: 'One entry per day, same order as the input.',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, intro: { type: 'string' } },
          required: ['label', 'intro'],
        },
      },
      whys: {
        type: 'object',
        description: 'Map of stop slug -> 1-2 sentence why, one entry per stop slug listed in the input.',
      },
      rainWhys: {
        type: 'object',
        description: 'Map of stop slug (the rain-alternative slug) -> 1 sentence why it works as a rain swap.',
      },
      faq: {
        type: 'array',
        items: {
          type: 'object',
          properties: { q: { type: 'string' }, a: { type: 'string' } },
          required: ['q', 'a'],
        },
      },
    },
    required: ['title', 'description', 'quickAnswer', 'days', 'whys', 'faq'],
  },
};

async function callClaude({ city, country, days, daysArr, bySlug }) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_itinerary' },
    messages: [{ role: 'user', content: buildPrompt({ city, country, days, daysArr, bySlug }) }],
  });
  const out = msg.content.find((c) => c.type === 'tool_use')?.input;
  if (!out?.title || !Array.isArray(out.days) || out.days.length !== daysArr.length) {
    throw new Error('model returned an incomplete itinerary');
  }
  return out;
}

// ── frontmatter assembly ─────────────────────────────────────────────────
function assembleFrontmatter({ city, country, days, result, aiOut, whysMap, stopsHash, packedAvailable, existingPubDate, bySlug }) {
  const now = new Date().toISOString();
  const fm = {
    city,
    country,
    days,
    title: aiOut.title,
    description: aiOut.description,
    quickAnswer: aiOut.quickAnswer,
    pubDate: existingPubDate || now,
    stopsHash,
    packedAvailable,
    faq: Array.isArray(aiOut.faq) ? aiOut.faq.filter((f) => f?.q && f?.a) : [],
    itinerary: result.days.map((d, i) => ({
      label: aiOut.days?.[i]?.label || `Day ${i + 1}`,
      intro: aiOut.days?.[i]?.intro || '',
      stops: d.stops.map((s) => ({
        slug: s.slug,
        slot: s.slot,
        why: whysMap[s.slug] || fallbackWhy(bySlug.get(s.slug)),
        dwellMin: s.dwellMin,
        walkToNext: s.walkToNext,
      })),
      rainSwapSlug: d.rainSwapSlug,
    })),
    aiGenerated: true,
    draft: false,
  };
  if (existingPubDate) fm.updatedDate = now;
  return fm;
}

async function writeItineraryFile(filePath, fm) {
  const fmOut = yaml.dump(fm, { lineWidth: -1, noRefs: true, sortKeys: false });
  const md = `---\n${fmOut}---\n\n`;
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(filePath, md, 'utf8');
}

// Post-write sanity check: reload the file, confirm every stop slug resolves
// to a real post. Never leave a bad file behind.
async function sanityCheck(filePath, citySlug, days) {
  const raw = await readFile(filePath, 'utf8');
  const end = raw.indexOf('\n---', 3);
  let parsed;
  try {
    parsed = yaml.load(raw.slice(4, end));
  } catch (e) {
    await rm(filePath, { force: true });
    console.error(`FATAL: ${citySlug}-${days}-days.md failed to parse after writing (${e.message}) — file removed.`);
    return false;
  }
  for (const d of parsed.itinerary || []) {
    for (const s of d.stops || []) {
      if (!existsSync(join(POSTS_DIR, `${s.slug}.md`))) {
        await rm(filePath, { force: true });
        console.error(`FATAL: ${citySlug}-${days}-days.md referenced nonexistent post "${s.slug}" — file removed.`);
        return false;
      }
    }
  }
  return true;
}

// ── one city × days variant ──────────────────────────────────────────────
async function processVariant({ city, country, days, cityPosts, packedAvailable, isNewCity }) {
  const citySlug = slugify(city);
  const filePath = join(OUT_DIR, `${citySlug}-${days}-days.md`);
  const bySlug = new Map(cityPosts.map((p) => [p.id, p]));

  const result = buildItinerary(cityPosts, { days });
  if (!result.ok) {
    console.log(`  · ${city} ${days}d — skipped: ${result.reason}`);
    return { created: false, isNewFile: false };
  }
  const stopsHash = stopsHashOf(result.days);

  let existing = null;
  if (existsSync(filePath)) {
    const raw = await readFile(filePath, 'utf8');
    const end = raw.indexOf('\n---', 3);
    try { existing = yaml.load(raw.slice(4, end)); } catch { existing = null; }
  }

  if (existing && existing.stopsHash === stopsHash) {
    console.log(`  = ${city} ${days}d — unchanged, skipping`);
    return { created: false, isNewFile: false };
  }

  let aiOut = null;
  let whysMap = {};

  if (existing) {
    const oldSlugs = stopSlugSet(existing.itinerary || []);
    const newSlugs = stopSlugSet(result.days);
    const diff = symmetricDiffSize(oldSlugs, newSlugs);
    if (diff > 2) {
      console.log(`  ~ ${city} ${days}d — structure changed by ${diff} slug(s), regenerating prose`);
      aiOut = await callClaude({ city, country, days, daysArr: result.days, bySlug });
      whysMap = aiOut.whys || {};
    } else {
      console.log(`  ~ ${city} ${days}d — minor structure change (${diff} slug diff), keeping existing prose`);
      for (const d of existing.itinerary || []) for (const s of d.stops || []) whysMap[s.slug] = s.why;
      aiOut = {
        title: existing.title,
        description: existing.description,
        quickAnswer: existing.quickAnswer,
        faq: existing.faq,
        days: (existing.itinerary || []).map((d) => ({ label: d.label, intro: d.intro })),
      };
    }
  } else {
    aiOut = await callClaude({ city, country, days, daysArr: result.days, bySlug });
    whysMap = aiOut.whys || {};
  }

  const fm = assembleFrontmatter({
    city, country, days, result, aiOut, whysMap, stopsHash, packedAvailable,
    existingPubDate: existing?.pubDate || null, bySlug,
  });

  const isNewFile = !existing;
  await writeItineraryFile(filePath, fm);
  const ok = await sanityCheck(filePath, citySlug, days);
  if (!ok) { process.exitCode = 1; return { created: false, isNewFile: false }; }

  if (isNewFile) console.log(`NEW_ITINERARY: ${city} ${days}d`);
  else console.log(`  ✅ ${city} ${days}d — updated`);

  return { created: true, isNewFile };
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  const allPosts = await loadPosts();
  const regions = [...new Set(allPosts.map((p) => p.data.region).filter(Boolean))];

  let state = {};
  try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')); } catch { /* first run */ }

  const nowMs = Date.now();
  const recentNew = Object.values(state).filter((d) => nowMs - new Date(d).getTime() < WEEK_MS).length;
  let newSlotsLeft = Math.max(0, MAX_NEW_CITIES_PER_WEEK - recentNew);

  const citySlugOf = (r) => slugify(r);
  const cityHasAnyFile = (r) => {
    const cs = citySlugOf(r);
    return DAY_VARIANTS.some((d) => existsSync(join(OUT_DIR, `${cs}-${d}-days.md`)));
  };

  let cities;
  if (ONLY_CITY) {
    cities = [ONLY_CITY];
  } else {
    const extraCandidates = regions.filter((r) => !LAUNCH_CITIES.includes(r)).sort();
    const selectedExtra = [];
    for (const r of extraCandidates) {
      const q = qualifyingPosts(allPosts.filter((p) => p.data.region === r));
      if (!gateFor(q.length).threeDay) continue; // must clear the 3-day gate to even be a candidate
      if (cityHasAnyFile(r)) { selectedExtra.push(r); continue; } // already established — no cap
      if (newSlotsLeft > 0) { selectedExtra.push(r); newSlotsLeft--; }
      else console.log(`SKIP new city "${r}" — weekly new-city cap (${MAX_NEW_CITIES_PER_WEEK}/7d) reached`);
    }
    cities = [...LAUNCH_CITIES, ...selectedExtra];
  }

  let anyCreated = false;
  let stateChanged = false;

  for (const city of cities) {
    const cityPosts = allPosts.filter((p) => p.data.region === city);
    if (!cityPosts.length) { console.log(`  · ${city} — no posts found for this region, skipping`); continue; }
    const q = qualifyingPosts(cityPosts);
    const gates = gateFor(q.length);
    const country = countryFor(cityPosts);
    const citySlug = citySlugOf(city);
    const hadFileBefore = cityHasAnyFile(city);

    const variants = (ONLY_DAYS ? [ONLY_DAYS] : DAY_VARIANTS).filter((d) => (d === 5 ? gates.fiveDay : d === 3 ? gates.threeDay : true));
    if (!variants.length) {
      console.log(`  · ${city} — ${q.length} qualifying post(s), no day-variant gate cleared yet`);
      continue;
    }

    console.log(`\n${city}, ${country} — ${q.length} qualifying post(s), variants: ${variants.join(', ')}`);
    for (const days of variants) {
      const { created } = await processVariant({ city, country, days, cityPosts, packedAvailable: gates.packed });
      if (created) anyCreated = true;
    }

    if (!LAUNCH_CITIES.includes(city) && !hadFileBefore && cityHasAnyFile(city) && !(citySlug in state)) {
      state[citySlug] = new Date().toISOString();
      stateChanged = true;
    }
  }

  // Always persist the state file so it exists for the commit step, even on a
  // launch-cities-only run where no new-city slot was ever consumed.
  if (stateChanged || !existsSync(STATE_FILE)) {
    await mkdir(fileURLToPath(new URL('../data/', import.meta.url)), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
  }

  console.log(`\nDone.${anyCreated ? '' : ' Nothing changed.'}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
