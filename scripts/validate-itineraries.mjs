// Itinerary accuracy gate. This is the site's #1 rule enforced in code: no wrong
// information reaches an itinerary page. The core checks live in ONE place —
// validateItineraryData() below — used both by this file's CLI (standalone run
// in publish.yml, or against a fixture dir) AND by scripts/build-itineraries.mjs
// (validateItineraryFile(), called on the TEMP file before the atomic rename, so
// a bad regeneration can never replace a good live itinerary). Report/exit-code
// style copied from scripts/validate-content.mjs — print every issue, exit 1 if
// any were found.
//
//   node scripts/validate-itineraries.mjs                       # real content dirs
//   node scripts/validate-itineraries.mjs --fixture=<dir>       # a fixture dir (tests) —
//       <dir> must contain posts/, itineraries/, itineraries-i18n/ subfolders,
//       same layout as src/content/.
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { qualifyingPosts, gateFor } from '../src/lib/itinerary.mjs';
import { findProseViolations } from '../src/lib/prose-guard.mjs';

// Mirrors the TRANSIT_FLAT_MIN / DAY_BUDGET_MIN constants in src/lib/itinerary.mjs
// (not exported from there, so kept in sync by hand). src/lib/itinerary.mjs is the
// source of truth — if those numbers change there, change them here too.
const TRANSIT_FLAT_MIN = 30;
const DAY_BUDGET_MIN = 600;

// Prose-leak patterns (clock times / prices / opening-hours language never
// belong in AI connective prose — the page renders those facts from data,
// never from written text) live in src/lib/prose-guard.mjs, shared with
// scripts/build-itineraries.mjs so the two can never drift apart.
function scanProseLeak(issues, file, field, text) {
  const t = String(text ?? '');
  if (!t) return;
  if (findProseViolations(t).length) {
    issues.push(`PROSE-LEAK: ${file} — ${field}`);
  }
}

export async function walkMd(dir, rel = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { out.push(...(await walkMd(p, `${rel}${e.name}/`))); continue; }
    if (e.name.endsWith('.md')) out.push({ path: p, rel: `${rel}${e.name}` });
  }
  return out;
}

export async function readFrontmatter(path) {
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

// Loads every post under `dir` into {id, data} pairs — same shape loadPosts()
// in scripts/build-itineraries.mjs produces (plus `body`, which nothing here needs).
export async function loadPostsFrom(dir) {
  const out = [];
  for (const { path, rel } of await walkMd(dir)) {
    const fm = await readFrontmatter(path);
    if (!fm) continue;
    out.push({ id: rel.replace(/\.md$/, ''), data: fm });
  }
  return out;
}

// ── THE core check — pure, no IO. Validates one itinerary's already-parsed
// frontmatter object against a posts index. This is the single implementation
// every caller (CLI sweep below, and build-itineraries.mjs pre-rename gate)
// goes through — there is no second copy of these rules anywhere else. ──────
export function validateItineraryData(file, data, postsById, postsList) {
  const issues = [];
  const d = data || {};

  scanProseLeak(issues, file, 'title', d.title);
  scanProseLeak(issues, file, 'description', d.description);
  scanProseLeak(issues, file, 'quickAnswer', d.quickAnswer);
  (d.faq || []).forEach((f, i) => {
    scanProseLeak(issues, file, `faq[${i}].q`, f?.q);
    scanProseLeak(issues, file, `faq[${i}].a`, f?.a);
  });

  const days = Array.isArray(d.itinerary) ? d.itinerary : [];
  const seenSlugs = new Set();
  const dupSlugs = new Set();

  days.forEach((day, di) => {
    if (!String(day?.label ?? '').trim()) issues.push(`EMPTY-LABEL: ${file} — day ${di + 1}`);
    if (!String(day?.intro ?? '').trim()) issues.push(`EMPTY-INTRO: ${file} — day ${di + 1}`);
    scanProseLeak(issues, file, `itinerary[${di}].label`, day?.label);
    scanProseLeak(issues, file, `itinerary[${di}].intro`, day?.intro);

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
      scanProseLeak(issues, file, `itinerary[${di}].stops[${si}].why`, s?.why);

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
  if (d.packedAvailable && postsList) {
    const cityPosts = postsList.filter((p) => p.data.region === d.city);
    const q = qualifyingPosts(cityPosts);
    if (!gateFor(q.length).packed) {
      issues.push(`PACKED-GATE-FAIL: ${file} — packedAvailable=true but only ${q.length} live qualifying post(s) for "${d.city}" (gate needs 15)`);
    }
  }

  return issues;
}

// Same single-implementation treatment for a translation file — validated
// against its source itinerary's stopsHash plus its own prose-sanity/leak rules.
export function validateI18nEntry(file, data, itById) {
  const issues = [];
  const d = data || {};
  const source = d.slug ? itById.get(d.slug) : null;

  if (!source) {
    issues.push(`ORPHAN-TRANSLATION: ${file} — no source itinerary "${d.slug}"`);
  } else if (d.sourceHash !== source.stopsHash) {
    issues.push(`STALE-TRANSLATION: ${file}`);
  }

  scanProseLeak(issues, file, 'title', d.title);
  scanProseLeak(issues, file, 'description', d.description);
  scanProseLeak(issues, file, 'quickAnswer', d.quickAnswer);
  (d.faq || []).forEach((f, i) => {
    scanProseLeak(issues, file, `faq[${i}].q`, f?.q);
    scanProseLeak(issues, file, `faq[${i}].a`, f?.a);
  });
  (d.days || []).forEach((day, i) => {
    if (!String(day?.label ?? '').trim()) issues.push(`EMPTY-LABEL: ${file} — days[${i}]`);
    if (!String(day?.intro ?? '').trim()) issues.push(`EMPTY-INTRO: ${file} — days[${i}]`);
    scanProseLeak(issues, file, `days[${i}].label`, day?.label);
    scanProseLeak(issues, file, `days[${i}].intro`, day?.intro);
  });
  for (const [slug, why] of Object.entries(d.whys || {})) {
    if (!String(why ?? '').trim()) issues.push(`EMPTY-WHY: ${file} — whys[${slug}]`);
    scanProseLeak(issues, file, `whys[${slug}]`, why);
  }
  for (const [slug, why] of Object.entries(d.rainWhys || {})) scanProseLeak(issues, file, `rainWhys[${slug}]`, why);

  return issues;
}

// ── file-based entry point for scripts/build-itineraries.mjs ───────────────
// Validates a SINGLE itinerary file (typically a not-yet-renamed temp file) and
// returns its issues array (empty = clean). Pass `posts` (an already-loaded
// {id, data}[] array, e.g. the city's posts the caller has in memory) to avoid
// re-reading every post off disk; otherwise posts are loaded from `postsDir`
// (defaults to the real src/content/posts/). `label` overrides the file label
// used in issue strings — useful because a temp path looks like
// "seoul-3-days.md.tmp-1234-5678" and the caller usually wants the clean name.
export async function validateItineraryFile(filePath, { posts, postsDir, label } = {}) {
  const postsList = posts || await loadPostsFrom(postsDir || fileURLToPath(new URL('../src/content/posts/', import.meta.url)));
  const postsById = new Map(postsList.map((p) => [p.id, p.data]));
  const fm = await readFrontmatter(filePath);
  const fileLabel = label || basename(filePath);
  if (!fm) return [`PARSE-ERROR: could not parse frontmatter in ${fileLabel}`];
  return validateItineraryData(fileLabel, fm, postsById, postsList);
}

// ── CLI ──────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

async function main() {
  const fixtureArg = process.argv.find((a) => a.startsWith('--fixture='));
  const FIXTURE_DIR = fixtureArg ? fixtureArg.slice('--fixture='.length) : null;
  const ROOT = FIXTURE_DIR
    ? resolve(process.cwd(), FIXTURE_DIR)
    : fileURLToPath(new URL('../src/content/', import.meta.url));

  const postsList = await loadPostsFrom(join(ROOT, 'posts'));
  const postsById = new Map(postsList.map((p) => [p.id, p.data]));

  const issues = [];

  const itineraries = [];
  for (const { path, rel } of await walkMd(join(ROOT, 'itineraries'))) {
    const fm = await readFrontmatter(path);
    if (!fm) { issues.push(`PARSE-ERROR: could not parse frontmatter in itineraries/${rel}`); continue; }
    itineraries.push({ id: rel.replace(/\.md$/, ''), file: `itineraries/${rel}`, data: fm });
  }
  for (const it of itineraries) issues.push(...validateItineraryData(it.file, it.data, postsById, postsList));

  const i18nEntries = [];
  for (const { path, rel } of await walkMd(join(ROOT, 'itineraries-i18n'))) {
    const fm = await readFrontmatter(path);
    if (!fm) { issues.push(`PARSE-ERROR: could not parse frontmatter in itineraries-i18n/${rel}`); continue; }
    i18nEntries.push({ file: `itineraries-i18n/${rel}`, data: fm });
  }
  const itById = new Map(itineraries.map((it) => [it.id, it.data]));
  for (const entry of i18nEntries) issues.push(...validateI18nEntry(entry.file, entry.data, itById));

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
}

if (isMain) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
