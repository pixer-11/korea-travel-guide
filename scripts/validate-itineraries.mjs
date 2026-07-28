// Itinerary accuracy gate. This is the site's #1 rule enforced in code: no wrong
// information reaches an itinerary page. Run standalone in CI (publish.yml) and
// invoked by scripts/build-itineraries.mjs right after writing a city, so a bad
// build never gets committed. Pattern/report/exit-code style copied from
// scripts/validate-content.mjs — print every issue, exit 1 if any were found.
//
//   node scripts/validate-itineraries.mjs                       # real content dirs
//   node scripts/validate-itineraries.mjs --fixture=<dir>       # a fixture dir (tests) —
//       <dir> must contain posts/, itineraries/, itineraries-i18n/ subfolders,
//       same layout as src/content/.
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { qualifyingPosts, gateFor } from '../src/lib/itinerary.mjs';

// Mirrors the TRANSIT_FLAT_MIN / DAY_BUDGET_MIN constants in src/lib/itinerary.mjs
// (not exported from there, so kept in sync by hand). src/lib/itinerary.mjs is the
// source of truth — if those numbers change there, change them here too.
const TRANSIT_FLAT_MIN = 30;
const DAY_BUDGET_MIN = 600;

const fixtureArg = process.argv.find((a) => a.startsWith('--fixture='));
const FIXTURE_DIR = fixtureArg ? fixtureArg.slice('--fixture='.length) : null;

const ROOT = FIXTURE_DIR
  ? resolve(process.cwd(), FIXTURE_DIR)
  : fileURLToPath(new URL('../src/content/', import.meta.url));

// ── prose-leak patterns (clock times / prices never belong in AI connective
// prose — the page renders those facts from data, never from written text) ──
const CLOCK_AMPM = /\b\d{1,2}\s*(:\d{2})?\s*(am|pm)\b/i;
const CLOCK_24H = /\b\d{1,2}:\d{2}\b/;
const HOURS_LANG = /\bopening hours\b|\bcloses at\b|\bopens at\b/i;
const CURRENCY = /[$€£¥₩]\s?\d/;

async function walkMd(dir, rel = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { out.push(...(await walkMd(p, `${rel}${e.name}/`))); continue; }
    if (e.name.endsWith('.md')) out.push({ path: p, rel: `${rel}${e.name}` });
  }
  return out;
}

async function readFrontmatter(path) {
  const raw = await readFile(path, 'utf8');
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return null;
  try {
    const fm = yaml.load(raw.slice(4, end));
    return fm || {};
  } catch {
    return null;
  }
}

const issues = [];

function scanProseLeak(file, field, text) {
  const t = String(text ?? '');
  if (!t) return;
  if (CLOCK_AMPM.test(t) || CLOCK_24H.test(t) || HOURS_LANG.test(t) || CURRENCY.test(t)) {
    issues.push(`PROSE-LEAK: ${file} — ${field}`);
  }
}

// ── load posts (needed to resolve stop slugs + recount qualifying posts) ───
const POSTS_DIR = join(ROOT, 'posts');
const postsById = new Map();
const postsList = []; // {id, data} shaped for qualifyingPosts()
for (const { path, rel } of await walkMd(POSTS_DIR)) {
  const fm = await readFrontmatter(path);
  if (!fm) { issues.push(`PARSE-ERROR: could not parse frontmatter in posts/${rel}`); continue; }
  const id = rel.replace(/\.md$/, '');
  postsById.set(id, fm);
  postsList.push({ id, data: fm });
}

// ── load itineraries ────────────────────────────────────────────────────
const IT_DIR = join(ROOT, 'itineraries');
const itineraries = [];
for (const { path, rel } of await walkMd(IT_DIR)) {
  const fm = await readFrontmatter(path);
  if (!fm) { issues.push(`PARSE-ERROR: could not parse frontmatter in itineraries/${rel}`); continue; }
  itineraries.push({ id: rel.replace(/\.md$/, ''), file: `itineraries/${rel}`, data: fm });
}

// ── load i18n translations ──────────────────────────────────────────────
const I18N_DIR = join(ROOT, 'itineraries-i18n');
const i18nEntries = [];
for (const { path, rel } of await walkMd(I18N_DIR)) {
  const fm = await readFrontmatter(path);
  if (!fm) { issues.push(`PARSE-ERROR: could not parse frontmatter in itineraries-i18n/${rel}`); continue; }
  i18nEntries.push({ file: `itineraries-i18n/${rel}`, data: fm });
}

// ── per-itinerary checks ────────────────────────────────────────────────
for (const it of itineraries) {
  const d = it.data || {};
  const file = it.file;

  scanProseLeak(file, 'title', d.title);
  scanProseLeak(file, 'description', d.description);
  scanProseLeak(file, 'quickAnswer', d.quickAnswer);
  (d.faq || []).forEach((f, i) => {
    scanProseLeak(file, `faq[${i}].q`, f?.q);
    scanProseLeak(file, `faq[${i}].a`, f?.a);
  });

  const days = Array.isArray(d.itinerary) ? d.itinerary : [];
  const seenSlugs = new Set();
  const dupSlugs = new Set();

  days.forEach((day, di) => {
    if (!String(day?.label ?? '').trim()) issues.push(`EMPTY-LABEL: ${file} — day ${di + 1}`);
    if (!String(day?.intro ?? '').trim()) issues.push(`EMPTY-INTRO: ${file} — day ${di + 1}`);
    scanProseLeak(file, `itinerary[${di}].label`, day?.label);
    scanProseLeak(file, `itinerary[${di}].intro`, day?.intro);

    const stops = Array.isArray(day?.stops) ? day.stops : [];
    if (stops.length < 3 || stops.length > 5) {
      issues.push(`DAY-STOP-COUNT: ${file} — day ${di + 1} has ${stops.length} stop(s) (need 3-5)`);
    }

    let dayTotalMin = 0;

    stops.forEach((s, si) => {
      const slug = s?.slug;
      if (!slug) { issues.push(`MISSING-SLUG: ${file} — day ${di + 1} stop ${si + 1}`); return; }

      if (seenSlugs.has(slug)) dupSlugs.add(slug);
      seenSlugs.add(slug);

      const post = postsById.get(slug);
      if (!post) {
        issues.push(`MISSING-POST: ${file} — stop slug "${slug}" has no matching post`);
      } else {
        if (post.draft) issues.push(`DRAFT-POST: ${file} — stop slug "${slug}" resolves to a draft post`);
        const pl = post.place || {};
        if (typeof pl.lat !== 'number' || typeof pl.lng !== 'number') {
          issues.push(`MISSING-COORDS: ${file} — stop slug "${slug}" has no numeric place.lat/lng`);
        }
        if (String(pl.businessStatus || '').startsWith('CLOSED')) {
          issues.push(`CLOSED-VENUE: ${file} — stop slug "${slug}" businessStatus is "${pl.businessStatus}"`);
        }
        if (s.slot === 'lunch' && post.category !== 'restaurant') {
          issues.push(`LUNCH-NOT-RESTAURANT: ${file} — stop slug "${slug}" (day ${di + 1}) is category "${post.category}", not restaurant`);
        }
      }

      if (!String(s?.why ?? '').trim()) issues.push(`EMPTY-WHY: ${file} — day ${di + 1} stop "${slug}"`);
      scanProseLeak(file, `itinerary[${di}].stops[${si}].why`, s?.why);

      dayTotalMin += Number(s?.dwellMin) || 0;
      const leg = s?.walkToNext;
      if (leg) {
        dayTotalMin += leg.transit ? TRANSIT_FLAT_MIN : (Number(leg.minutes) || 0);
        if (leg.transit === false && Number(leg.km) > 2) {
          issues.push(`WALK-TOO-FAR: ${file} — day ${di + 1} stop "${slug}" walkToNext.km=${leg.km} but transit=false (>2km)`);
        }
      }
    });

    if (dayTotalMin > DAY_BUDGET_MIN) {
      issues.push(`DAY-BUDGET-EXCEEDED: ${file} — day ${di + 1} totals ${dayTotalMin} min (budget ${DAY_BUDGET_MIN})`);
    }
  });

  for (const slug of dupSlugs) issues.push(`DUPLICATE-SLUG: ${file} — "${slug}" appears more than once across the itinerary`);

  // packedAvailable is only true if the city's LIVE qualifying count still
  // clears the gate — recounted from posts, never trusted from the frontmatter.
  if (d.packedAvailable) {
    const cityPosts = postsList.filter((p) => p.data.region === d.city);
    const q = qualifyingPosts(cityPosts);
    if (!gateFor(q.length).packed) {
      issues.push(`PACKED-GATE-FAIL: ${file} — packedAvailable=true but only ${q.length} live qualifying post(s) for "${d.city}" (gate needs 15)`);
    }
  }
}

// ── i18n staleness + prose-leak checks ──────────────────────────────────
const itById = new Map(itineraries.map((it) => [it.id, it.data]));
for (const entry of i18nEntries) {
  const d = entry.data || {};
  const file = entry.file;
  const source = d.slug ? itById.get(d.slug) : null;

  if (!source) {
    issues.push(`ORPHAN-TRANSLATION: ${file} — no source itinerary "${d.slug}"`);
  } else if (d.sourceHash !== source.stopsHash) {
    issues.push(`STALE-TRANSLATION: ${file}`);
  }

  scanProseLeak(file, 'title', d.title);
  scanProseLeak(file, 'description', d.description);
  scanProseLeak(file, 'quickAnswer', d.quickAnswer);
  (d.faq || []).forEach((f, i) => {
    scanProseLeak(file, `faq[${i}].q`, f?.q);
    scanProseLeak(file, `faq[${i}].a`, f?.a);
  });
  (d.days || []).forEach((day, i) => {
    scanProseLeak(file, `days[${i}].label`, day?.label);
    scanProseLeak(file, `days[${i}].intro`, day?.intro);
  });
  for (const [slug, why] of Object.entries(d.whys || {})) scanProseLeak(file, `whys[${slug}]`, why);
  for (const [slug, why] of Object.entries(d.rainWhys || {})) scanProseLeak(file, `rainWhys[${slug}]`, why);
}

// ── report ───────────────────────────────────────────────────────────────
if (issues.length) {
  console.log(`❌ ${issues.length} itinerary issue(s) across ${itineraries.length} itinerary file(s) + ${i18nEntries.length} translation file(s):\n`);
  for (const i of issues) console.log(`  • ${i}`);
  process.exit(1);
}
if (itineraries.length === 0) {
  console.log('✓ no itinerary files found — nothing to validate yet.');
} else {
  console.log(`✓ ${itineraries.length} itinerary file(s) + ${i18nEntries.length} translation file(s) clean.`);
}
