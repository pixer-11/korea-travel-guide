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
//  Safety: every generated file is written to a temp path, sanity-checked, and
//  only then atomically renamed over the target — a bad regeneration can never
//  destroy a previously-good (possibly live) itinerary. Generated prose is
//  scanned for (a) the rain-swap venue name leaking outside rainWhys and
//  (b) clock-time/opening-hours/price language; either triggers one retry, then
//  either a soft downgrade (rain-swap dropped to null) or a hard failure for
//  that city (existing file left untouched either way).
//
//  Before that rename, the temp file also runs through the FULL accuracy gate
//  (scripts/validate-itineraries.mjs — stop resolution, dup/budget/lunch/walk
//  rules, i18n-independent prose sanity+leak scan, packedAvailable recount).
//  Any issue there deletes the temp file, logs "VALIDATE-FAILED <id>", sets a
//  failing exit code, and leaves the existing target (if any) untouched — the
//  same guarantee sanityCheckTemp gives for a missing post, just the full rule
//  set instead of one check.
//
//  Prompt payload (per stop): title, category, VERIFIED ADDRESS (place.address,
//  plus place.name when it differs from the title), quickAnswer, closedDays,
//  quiet-window summary, dwell minutes, walk-to-next. The address exists so the
//  model can't generalize one stop's neighbourhood to a whole day it doesn't
//  share — a real defect found in a 2026-07-28 fact-check pass. The prompt also
//  states each day's exact stop count/slot shape so the model can't assert a
//  uniform structure ("each day has N stops") that isn't actually true.
//
//  Usage:
//    node scripts/build-itineraries.mjs                          # sweep everything
//    node scripts/build-itineraries.mjs --city=Seoul              # one city, all variants
//    node scripts/build-itineraries.mjs --city=Seoul --days=3     # one city, one variant
//    node scripts/build-itineraries.mjs --city=NewCity --force-new-city
//        # manual run for a brand-new (non-launch) city: bypasses the ≤2-new-
//        # cities/7-days anti-spam cap, which otherwise applies to --city= too.
//    node scripts/build-itineraries.mjs --force
//        # force full prose regeneration even when stopsHash is unchanged or
//        # the structural diff is ≤2 (which would normally just reuse existing
//        # prose) — use after a prompt-payload change like this one, so
//        # already-published files pick up the new facts/instructions.
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { slugify } from './lib/slugify.mjs';
import { buildItinerary, qualifyingPosts, gateFor, closedDaysOf } from '../src/lib/itinerary.mjs';
import { findProseViolations } from '../src/lib/prose-guard.mjs';
import { validateItineraryFile } from './validate-itineraries.mjs';

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
const FORCE_NEW_CITY = process.argv.includes('--force-new-city');
const FORCE = process.argv.includes('--force');

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

export function stopSlugSet(daysArr) {
  return new Set(daysArr.flatMap((d) => d.stops.map((s) => s.slug)));
}

export function symmetricDiffSize(a, b) {
  let n = 0;
  for (const x of a) if (!b.has(x)) n++;
  for (const x of b) if (!a.has(x)) n++;
  return n;
}

export function stopsHashOf(daysArr) {
  const raw = daysArr.map((d) => d.stops.map((s) => s.slug).join(',')).join('|');
  return createHash('sha1').update(raw).digest('hex');
}

// ── prompt assembly (closed-world: only what's built here reaches the model) ─
function walkDesc(leg) {
  if (!leg) return 'last stop of the day';
  if (leg.transit) return `${leg.km}km — beyond walking distance, take transit`;
  return `${leg.km}km, ~${leg.minutes} min walk`;
}

export function dayBlock(day, idx, bySlug) {
  const lines = day.stops.map((s) => {
    const post = bySlug.get(s.slug);
    const closed = closedDaysOf(post?.data?.place?.openingHours);
    const quiet = quietWindowSummary(post);
    const title = post?.data?.title || s.slug;
    const placeName = post?.data?.place?.name;
    const address = post?.data?.place?.address;
    const stopLines = [`  - [${s.slot}] "${title}" (slug: ${s.slug})`];
    // Only surface the raw Places `name` when it actually differs from the
    // post title — otherwise it's a redundant duplicate of the line above.
    if (placeName && placeName.trim().toLowerCase() !== title.trim().toLowerCase()) {
      stopLines.push(`      venue name: ${placeName}`);
    }
    stopLines.push(
      `      category: ${post?.data?.category || 'unknown'}`,
      // Verified location — without this the model has no way to know where a
      // stop actually is, and will generalize one stop's neighbourhood to the
      // whole day (2026-07-28 fact-check finding: Ise Sueyoshi, near
      // Roppongi/Omotesando, got described as "in the Yoyogi/Harajuku area";
      // Saladaeng, at Silom/Rama IV, got described as "Sukhumvit and Ekkamai").
      `      address: ${address || '(no address on file — do not guess or name a neighbourhood for this stop)'}`,
      `      quick answer: ${post?.data?.quickAnswer || '(none provided)'}`,
      `      closed days: ${closed.length ? closed.join(', ') : 'none listed'}`,
      `      quiet window: ${quiet || '(no data)'}`,
      `      dwell: ${s.dwellMin} minutes`,
      `      walk to next stop: ${walkDesc(s.walkToNext)}`,
    );
    return stopLines.join('\n');
  });
  const rainPost = day.rainSwapSlug ? bySlug.get(day.rainSwapSlug) : null;
  lines.push(
    rainPost
      ? `  Rain-day alternative: "${rainPost.data.title}" (slug: ${day.rainSwapSlug}, category: ${rainPost.data.category})`
      : '  Rain-day alternative: none available'
  );
  // Explicit stop count + slot list in the day header — without this the
  // model assumes every day is shaped like the others (2026-07-28 fact-check
  // finding, bangkok-3-days.md: FAQ claimed "each day is built around four
  // stops" when only day 1 actually had four; days 2-3 had three).
  const slots = day.stops.map((s) => s.slot).join(', ');
  return `Day ${idx + 1} — ${day.stops.length} stop${day.stops.length === 1 ? '' : 's'} (${slots}):\n${lines.join('\n')}`;
}

// One line per day + an explicit overall shape, so the model can't assume a
// uniform day count/structure it was never given.
function structureSummary(daysArr) {
  const perDay = daysArr
    .map((d, i) => `day ${i + 1} has ${d.stops.length} stop${d.stops.length === 1 ? '' : 's'} (${d.stops.map((s) => s.slot).join(', ')})`)
    .join('; ');
  return `OVERALL STRUCTURE: ${daysArr.length} day(s) — ${perDay}.`;
}

// Required verbatim (spec 2026-07-27, Task 3 brief).
const SAFETY_INSTRUCTION =
  'Write label+intro per day and a 1-2 sentence \'why\' per stop plus 3-5 FAQ entries. ' +
  'You may ONLY reference the venues and facts listed. Never introduce a venue, price, ' +
  'time, or claim not present in the input. Never state opening hours in prose (the page ' +
  'shows them from data).';

// Added in the review-fix round: rain-swap isolation + price + a nudge away
// from "open/close" phrasing that the mechanical prose guard below also checks.
const EXTRA_GUARDRAILS =
  'The rain-day alternative venue named for a day (if any) may be mentioned ONLY inside that ' +
  'day\'s rainWhys entry — it must never appear in any stop\'s "why", any day\'s "label" or ' +
  '"intro", the title, description, quickAnswer, or any FAQ answer. Never state a price or ' +
  'currency amount anywhere. Avoid the words "open", "opens", "close", "closes", or "opening ' +
  'hours" entirely, even in a non-schedule sense (say "wraps up" instead of "closes out", for example).';

// Added after a fact-verification pass on real generated prose (2026-07-28)
// found two defect classes the guard above never checked: (1) generalizing
// one stop's neighbourhood to a whole day it doesn't share (Tokyo: Ise
// Sueyoshi is near Roppongi/Omotesando, but day one got called "the
// Yoyogi/Harajuku area"; Bangkok: Saladaeng is at Silom/Rama IV, but day
// three got called "Sukhumvit and Ekkamai" across its label, intro,
// description, quickAnswer, AND an FAQ answer), and (2) neighbourhood/"near
// X" claims and duration wording not actually grounded in the given facts.
const LOCATION_ACCURACY_RULES =
  'Each stop\'s location (address) is given above. Do NOT describe a day as being \'in\' or ' +
  '\'around\' a single neighbourhood unless EVERY stop in that day is in that neighbourhood per ' +
  'its given address. When stops span areas, say so plainly (e.g. \'starts in X, then crosses to ' +
  'Y\'). Neighbourhood, district, and "near X" claims count as facts just like prices or hours: ' +
  'they must come from a stop\'s given address or that stop\'s own quick answer text — never from ' +
  'outside knowledge or by generalizing one stop\'s area to the whole day.';

// Added after the same fact-verification pass found the model asserting
// structural facts (stop counts) it was never given and getting them wrong
// (Bangkok FAQ: "each day is built around four stops" when only day one
// actually had four), plus duration wording contradicting the given dwell
// time (Chatuchak's `why` said "the several hours budgeted" for a 90-minute
// dwell).
const STRUCTURE_AND_DURATION_RULES =
  'Any statement about how many stops, days, or meals the plan contains must match the given ' +
  'structure exactly — if day counts differ, do not claim a uniform number (e.g. do not say ' +
  '"each day has four stops" unless every day listed above truly has four). Each stop\'s dwell ' +
  'time (in minutes, given above) is the authoritative visit length — any duration wording in ' +
  'prose ("about an hour", "a couple of hours", "the whole afternoon") must be consistent with ' +
  'that number, never vaguer or larger than it suggests.';

function buildPrompt({ city, country, days, daysArr, bySlug, retryIssues }) {
  const blocks = daysArr.map((d, i) => dayBlock(d, i, bySlug)).join('\n\n');
  let prompt = `You are writing connective prose for a ${days}-day travel itinerary in ${city}, ${country}, for a travel website.

${structureSummary(daysArr)}

VENUES AVAILABLE (closed world — this is the ONLY source of truth; do not use outside knowledge):
${blocks}

INSTRUCTIONS
${SAFETY_INSTRUCTION}
${EXTRA_GUARDRAILS}
${LOCATION_ACCURACY_RULES}
${STRUCTURE_AND_DURATION_RULES}

Also write:
- title: an SEO page title for this ${days}-day ${city} itinerary
- description: a 1-2 sentence meta description
- quickAnswer: a short answer-first summary paragraph describing the shape of the trip (day count, general areas/labels) — no invented facts
- For each day: a short evocative label (e.g. "Palaces & hanok lanes") and a 2-3 sentence intro connecting that day's stops
- whys: an entry for EVERY stop slug listed above, a 1-2 sentence reason it's on the itinerary, grounded only in the info given for that stop
- rainWhys: for each day that lists a rain-day alternative, one sentence on why that swap works if it rains, grounded only in its category/title
- faq: 3-5 general FAQ entries about doing this ${days}-day ${city} itinerary (pacing, getting around, timing) — do not invent facts not given above`;

  if (retryIssues && retryIssues.length) {
    const quoted = retryIssues
      .map((v) =>
        v.pattern
          ? `- field "${v.field}" matched a forbidden pattern (${v.pattern}): "${String(v.text || '').slice(0, 160)}"`
          : `- field "${v.field}" (day ${v.dayIndex + 1}) named the rain-swap venue "${v.term}" outside of rainWhys`
      )
      .join('\n');
    prompt += `\n\nYOUR PREVIOUS ANSWER VIOLATED THE RULES ABOVE. Resubmit a complete, corrected answer (every ` +
      `field, not just the fixed ones) that fixes:\n${quoted}\n\nDo not restate any opening hours, clock times, ` +
      `or prices anywhere. Do not name the rain-swap venue anywhere except rainWhys.`;
  }
  return prompt;
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

// Validates the SHAPE of Claude's response against what the solver actually
// produced. Throws (never silently coerces) on any mismatch, so a malformed
// response fails this attempt loudly instead of writing a bad file.
export function validateAiOutput(out, daysArr) {
  if (!out || typeof out !== 'object') throw new Error('model returned no tool_use input');
  if (typeof out.title !== 'string' || !out.title) throw new Error('model output missing title');
  if (typeof out.description !== 'string' || !out.description) throw new Error('model output missing description');
  if (typeof out.quickAnswer !== 'string' || !out.quickAnswer) throw new Error('model output missing quickAnswer');
  if (!Array.isArray(out.days) || out.days.length !== daysArr.length) {
    throw new Error(`model returned ${Array.isArray(out?.days) ? out.days.length : 'no'} day(s), expected ${daysArr.length}`);
  }
  out.days.forEach((d, i) => {
    if (!d || typeof d.label !== 'string' || typeof d.intro !== 'string') {
      throw new Error(`model day[${i}] missing label/intro`);
    }
  });
  if (!Array.isArray(out.faq)) throw new Error('model output missing faq array');
  const validSlugs = new Set(daysArr.flatMap((d) => (d.stops || []).map((s) => s.slug)));
  const whys = out.whys && typeof out.whys === 'object' ? out.whys : {};
  for (const slug of Object.keys(whys)) {
    if (!validSlugs.has(slug)) throw new Error(`model returned a why for unknown stop slug "${slug}"`);
  }
}

async function callClaude({ city, country, days, daysArr, bySlug, retryIssues }) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_itinerary' },
    messages: [{ role: 'user', content: buildPrompt({ city, country, days, daysArr, bySlug, retryIssues }) }],
  });
  const out = msg.content.find((c) => c.type === 'tool_use')?.input;
  validateAiOutput(out, daysArr);
  return out;
}

// ── prose guards (pure, no IO — used both at generation time and by tests) ──
function collectProseFields(aiOut) {
  const out = [];
  out.push({ field: 'title', value: aiOut.title });
  out.push({ field: 'description', value: aiOut.description });
  out.push({ field: 'quickAnswer', value: aiOut.quickAnswer });
  (aiOut.faq || []).forEach((f, i) => {
    out.push({ field: `faq[${i}].q`, value: f?.q });
    out.push({ field: `faq[${i}].a`, value: f?.a });
  });
  (aiOut.days || []).forEach((d, i) => {
    out.push({ field: `days[${i}].label`, value: d?.label });
    out.push({ field: `days[${i}].intro`, value: d?.intro });
  });
  const whys = aiOut.whys || {};
  for (const [slug, why] of Object.entries(whys)) {
    out.push({ field: `whys[${slug}]`, value: why });
  }
  return out;
}

// PROSE_GUARD_PATTERNS + findProseViolations now live in src/lib/prose-guard.mjs
// (shared with scripts/validate-itineraries.mjs so the two can never drift).

function scanAiOutputProse(aiOut) {
  const violations = [];
  for (const { field, value } of collectProseFields(aiOut)) {
    for (const hit of findProseViolations(value)) {
      violations.push({ field, pattern: hit.pattern, text: value });
    }
  }
  return violations;
}

const STOPWORDS = new Set(['the', 'and', 'of', 'at', 'in', 'on', 'a', 'an', 'to', 'for', 'by', 'with']);

// `cityName` is excluded from the per-word "main token" list — many venue
// titles are literally "<Venue> in <City>" / "<City> <Venue>", and the city
// name legitimately appears in nearly every field (title, description, every
// day's intro...), so treating it as a distinctive token turned "the rain
// venue name leaked" into "the city name appears anywhere", which dropped
// the rain-swap on almost every real itinerary. The full title is still kept
// as a term — an exact multi-word phrase match is still a real, specific leak.
export function rainVenueTerms(title, cityName) {
  const t = String(title || '').trim();
  if (!t) return [];
  const cityWords = new Set(String(cityName || '').toLowerCase().split(/\s+/).filter(Boolean));
  const words = t.toLowerCase().split(/\s+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !cityWords.has(w));
  return [...new Set([t.toLowerCase(), ...words])];
}

// Scans every written prose field for each day's rain-swap venue name/main
// token. Pure given (aiOut, daysArr, bySlug, cityName) — used both live and by tests.
export function findRainSwapLeaks(aiOut, daysArr, bySlug, cityName) {
  const violations = [];
  const fields = collectProseFields(aiOut);
  daysArr.forEach((day, dayIndex) => {
    if (!day.rainSwapSlug) return;
    const rainPost = bySlug.get(day.rainSwapSlug);
    const terms = rainVenueTerms(rainPost?.data?.title, cityName);
    if (!terms.length) return;
    for (const { field, value } of fields) {
      const text = String(value || '').toLowerCase();
      if (terms.some((t) => text.includes(t))) {
        violations.push({ field, term: rainPost.data.title, dayIndex });
      }
    }
  });
  return violations;
}

// One Claude call, then guard + at most one retry. Time/price violations that
// survive the retry FAIL the whole variant (caller leaves any existing file
// untouched). A rain-swap leak that survives the retry is downgraded — that
// day's rainSwapSlug is dropped to null (mutating daysArr in place) rather
// than shipping the leak.
async function generateProse({ city, country, days, daysArr, bySlug, variantId }) {
  let out = await callClaude({ city, country, days, daysArr, bySlug });
  let proseIssues = scanAiOutputProse(out);
  let rainIssues = findRainSwapLeaks(out, daysArr, bySlug, city);

  if (proseIssues.length || rainIssues.length) {
    console.log(`  ⚠ ${variantId} — guard found ${proseIssues.length} hours/price + ${rainIssues.length} rain-leak issue(s) on first pass; retrying once`);
    out = await callClaude({ city, country, days, daysArr, bySlug, retryIssues: [...proseIssues, ...rainIssues] });
    proseIssues = scanAiOutputProse(out);
    rainIssues = findRainSwapLeaks(out, daysArr, bySlug, city);
  }

  if (proseIssues.length) {
    for (const v of proseIssues) console.error(`PROSE-GUARD FAILED: ${variantId} — ${v.pattern} in ${v.field}: "${v.text}"`);
    throw new Error(`prose guard failed for ${variantId} after retry (${proseIssues.length} issue(s))`);
  }

  if (rainIssues.length) {
    const badDayIdx = new Set(rainIssues.map((r) => r.dayIndex));
    for (const idx of badDayIdx) {
      console.log(`  ⚠ ${variantId} — dropping rain-swap for day ${idx + 1} (venue name leaked into written prose after retry)`);
      daysArr[idx].rainSwapSlug = null;
    }
  }

  return out;
}

// ── frontmatter assembly ─────────────────────────────────────────────────
function assembleFrontmatter({ city, country, days, result, aiOut, whysMap, stopsHash, packedAvailable, existingPubDate, existingDraft, bySlug }) {
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
    // Preserve an editor's manual draft:true override across regenerations —
    // never force a quarantined itinerary back to published.
    draft: existingDraft === true,
  };
  if (existingPubDate) fm.updatedDate = now;
  return fm;
}

// Writes to a TEMP path only. The real target file is never touched here.
async function writeItineraryTemp(filePath, fm) {
  const fmOut = yaml.dump(fm, { lineWidth: -1, noRefs: true, sortKeys: false });
  const md = `---\n${fmOut}---\n\n`;
  await mkdir(OUT_DIR, { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, md, 'utf8');
  return tmpPath;
}

// Validates the TEMP file only — confirms every stop slug resolves to a real
// post. On failure the temp file is deleted and the function returns false;
// the caller must NOT rename over the real target, so a validation failure
// can never destroy a previously-good (possibly live) itinerary.
async function sanityCheckTemp(tmpPath, label) {
  let parsed;
  try {
    const raw = await readFile(tmpPath, 'utf8');
    const end = raw.indexOf('\n---', 3);
    parsed = yaml.load(raw.slice(4, end));
  } catch (e) {
    await rm(tmpPath, { force: true });
    console.error(`FATAL: ${label} failed to parse after writing (${e.message}) — write aborted, existing file (if any) left untouched.`);
    return false;
  }
  for (const d of parsed.itinerary || []) {
    for (const s of d.stops || []) {
      if (!existsSync(join(POSTS_DIR, `${s.slug}.md`))) {
        await rm(tmpPath, { force: true });
        console.error(`FATAL: ${label} referenced nonexistent post "${s.slug}" — write aborted, existing file (if any) left untouched.`);
        return false;
      }
    }
  }
  return true;
}

// Runs the full accuracy gate (validateItineraryFile, the SAME implementation
// the standalone CLI uses) against a just-written temp file. Clean → renamed
// atomically over the target. Any issue → temp file deleted, target left
// exactly as it was (untouched if it existed, never created if it didn't).
// Exported so tests can exercise this guarantee without going through the
// Claude-calling generation pipeline.
export async function commitOrRejectTemp(tmpPath, filePath, { posts, label }) {
  const issues = await validateItineraryFile(tmpPath, { posts, label });
  if (issues.length) {
    await rm(tmpPath, { force: true });
    console.error(`VALIDATE-FAILED ${label} — ${issues.length} issue(s):`);
    for (const issue of issues) console.error(`  • ${issue}`);
    return { ok: false, issues };
  }
  await rename(tmpPath, filePath); // atomic: only now does the real target change
  return { ok: true, issues: [] };
}

async function persistState(state) {
  await mkdir(fileURLToPath(new URL('../data/', import.meta.url)), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ── one city × days variant ──────────────────────────────────────────────
async function processVariant({ city, country, days, cityPosts, packedAvailable }) {
  const citySlug = slugify(city);
  const filePath = join(OUT_DIR, `${citySlug}-${days}-days.md`);
  const variantId = `${city} ${days}d`;
  const bySlug = new Map(cityPosts.map((p) => [p.id, p]));

  const result = buildItinerary(cityPosts, { days });
  if (!result.ok) {
    console.log(`  · ${variantId} — skipped: ${result.reason}`);
    return { created: false, isNewFile: false };
  }
  const stopsHash = stopsHashOf(result.days);

  let existing = null;
  if (existsSync(filePath)) {
    const raw = await readFile(filePath, 'utf8');
    const end = raw.indexOf('\n---', 3);
    try { existing = yaml.load(raw.slice(4, end)); } catch { existing = null; }
  }

  if (!FORCE && existing && existing.stopsHash === stopsHash) {
    console.log(`  = ${variantId} — unchanged, skipping`);
    return { created: false, isNewFile: false };
  }

  let aiOut = null;
  let whysMap = {};

  if (existing && !FORCE) {
    const oldSlugs = stopSlugSet(existing.itinerary || []);
    const newSlugs = stopSlugSet(result.days);
    const diff = symmetricDiffSize(oldSlugs, newSlugs);
    if (diff > 2) {
      console.log(`  ~ ${variantId} — structure changed by ${diff} slug(s), regenerating prose`);
      aiOut = await generateProse({ city, country, days, daysArr: result.days, bySlug, variantId });
      whysMap = aiOut.whys || {};
    } else {
      console.log(`  ~ ${variantId} — minor structure change (${diff} slug diff), keeping existing prose`);
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
    if (existing && FORCE) console.log(`  ~ ${variantId} — --force: regenerating prose against the current payload`);
    aiOut = await generateProse({ city, country, days, daysArr: result.days, bySlug, variantId });
    whysMap = aiOut.whys || {};
  }

  const fm = assembleFrontmatter({
    city, country, days, result, aiOut, whysMap, stopsHash, packedAvailable,
    existingPubDate: existing?.pubDate || null,
    existingDraft: existing?.draft,
    bySlug,
  });

  const isNewFile = !existing;
  const tmpPath = await writeItineraryTemp(filePath, fm);
  const label = `${citySlug}-${days}-days.md`;
  const ok = await sanityCheckTemp(tmpPath, label);
  if (!ok) {
    process.exitCode = 1;
    return { created: false, isNewFile: false };
  }

  const { ok: validated } = await commitOrRejectTemp(tmpPath, filePath, { posts: cityPosts, label });
  if (!validated) {
    process.exitCode = 1;
    return { created: false, isNewFile: false };
  }

  if (isNewFile) console.log(`NEW_ITINERARY: ${city} ${days}d`);
  else console.log(`  ✅ ${variantId} — updated`);

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
    // The weekly new-city cap applies to manual --city= runs too, unless
    // explicitly overridden — otherwise a manual run is a silent bypass.
    const isNewNonLaunch = !LAUNCH_CITIES.includes(ONLY_CITY) && !cityHasAnyFile(ONLY_CITY) && !(citySlugOf(ONLY_CITY) in state);
    if (isNewNonLaunch && newSlotsLeft <= 0 && !FORCE_NEW_CITY) {
      console.log(`SKIP new city "${ONLY_CITY}" — weekly new-city cap (${MAX_NEW_CITIES_PER_WEEK}/7d) reached (pass --force-new-city to override)`);
      cities = [];
    } else {
      cities = [ONLY_CITY];
    }
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

  for (const city of cities) {
    try {
      const cityPosts = allPosts.filter((p) => p.data.region === city);
      if (!cityPosts.length) { console.log(`  · ${city} — no posts found for this region, skipping`); continue; }
      const q = qualifyingPosts(cityPosts);
      const gates = gateFor(q.length);
      const country = countryFor(cityPosts);
      const citySlug = citySlugOf(city);

      const variants = (ONLY_DAYS ? [ONLY_DAYS] : DAY_VARIANTS).filter((d) => (d === 5 ? gates.fiveDay : d === 3 ? gates.threeDay : true));
      if (!variants.length) {
        console.log(`  · ${city} — ${q.length} qualifying post(s), no day-variant gate cleared yet`);
        continue;
      }

      console.log(`\n${city}, ${country} — ${q.length} qualifying post(s), variants: ${variants.join(', ')}`);
      // A city already established (has a file, or already has a state entry,
      // or is a launch city) never needs its new-city slot recorded again.
      let recordedNewCity = LAUNCH_CITIES.includes(city) || citySlug in state || cityHasAnyFile(city);
      for (const days of variants) {
        const { created, isNewFile } = await processVariant({ city, country, days, cityPosts, packedAvailable: gates.packed });
        if (created) anyCreated = true;
        // Persist the new-city timestamp IMMEDIATELY, not at end-of-run — a
        // later city's failure must not lose this one's cap accounting.
        if (created && isNewFile && !recordedNewCity) {
          state[citySlug] = new Date().toISOString();
          recordedNewCity = true;
          await persistState(state);
        }
      }
    } catch (e) {
      console.error(`ERROR processing ${city}: ${e.message}`);
      process.exitCode = 1;
      // one city's failure must not abort the sweep
      continue;
    }
  }

  // Guarantee the state file exists even on a run that never wrote it above
  // (e.g. launch-cities-only, or zero new-city slots consumed).
  if (!existsSync(STATE_FILE)) await persistState(state);

  console.log(`\nDone.${anyCreated ? '' : ' Nothing changed.'}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
