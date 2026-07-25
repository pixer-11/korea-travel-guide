// Content-integrity gate. Run AFTER a publish/discover step: it scans every post
// for the failure modes we've hit before and prints a report. Exit code 1 if any
// issue is found, so the workflow can fire a Telegram warning (the post is already
// committed — this makes a problem loud instead of silently living on the site).
//
//   node scripts/validate-content.mjs
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { unsplashNum } from './lib/images.mjs';
import { OFFTOPIC } from './lib/offtopic.mjs';
import { topicKey, FILLER } from './lib/topic-key.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));


const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
const posts = [];
for (const f of files) {
  const t = await readFile(join(DIR, f), 'utf8');
  // Parse the YAML frontmatter properly — a regex can't read a `credit: >-` folded
  // scalar or a quoted URL reliably, which produced empty urls → a phantom
  // "DUPLICATE image ×N" (all the empties collapsing to one key).
  let fm;
  try { fm = yaml.load(t.slice(4, t.indexOf('\n---', 3))); } catch { continue; }
  if (!fm) continue;
  if (fm.draft) continue; // unpublished (e.g. quarantined awaiting a real photo) — not on the site
  posts.push({
    f,
    region: fm.region || '',
    category: fm.category || '',
    title: fm.title || '',
    url: (fm.heroImage && fm.heroImage.url) || '',
    credit: (fm.heroImage && fm.heroImage.credit) || '',
    license: (fm.heroImage && fm.heroImage.license) || '',
    placeId: (fm.place && fm.place.id) || '',
    placeName: (fm.place && fm.place.name) || '',
    eventStart: fm.eventStartDate || '',
  });
}

const issues = [];
const dupBy = (keyFn, label) => {
  const m = new Map();
  for (const p of posts) { const k = keyFn(p); if (!k) continue; (m.get(k) || m.set(k, []).get(k)).push(p); }
  for (const [k, ps] of m) if (ps.length > 1) issues.push(`${label} ×${ps.length}: ${ps.map((p) => p.f).join(', ')}`);
};

// Non-Latin scripts (Arabic/CJK/Thai/Japanese/Hangul/…) in a title mean Google's
// bilingual place name leaked into the English H1 — generate.mjs strips it now, so
// this catches any that slip through (or old posts).
const NON_LATIN = /[؀-ۿ一-鿿฀-๿぀-ヿ가-힯ༀ-࿿]/;
for (const p of posts) {
  if (p.region.includes('/')) issues.push(`SLASH in region "${p.region}" — breaks /regions route: ${p.f}`);
  if (!p.url || p.url.includes('placeholder')) issues.push(`PLACEHOLDER/no image [${p.category}]: ${p.f}`);
  if (NON_LATIN.test(p.title)) issues.push(`NON-LATIN script in title "${p.title.slice(0, 40)}…": ${p.f}`);
  if ((p.title.match(/\//g) || []).length >= 2) issues.push(`QUERY-LIKE title (multiple "/"): ${p.f}`);
  // "A Visitor's Guide" filler was stripped site-wide (backfill-titles.mjs) and
  // generate.mjs builds titles via lib/titles.mjs which never adds it — so ANY
  // occurrence means the title rule regressed. Also flag a city echoed twice
  // ("… Abu Dhabi: … in Abu Dhabi"), which the de-echo in makeTitle prevents.
  if (/:\s*A Visitor'?s Guide/i.test(p.title)) issues.push(`FILLER "A Visitor's Guide" in title (title-rule regression): ${p.f}`);
  // Catch a city echo that WE introduced in the suffix — i.e. the city appears in
  // both the name half (before ": ") and again in the suffix half. A city that's
  // repeated only inside the raw place name (e.g. "Gyukatsu Kyoto Katsugyu Kyoto")
  // is Google's data, not ours, so it's excluded.
  if (p.region && p.category !== 'event' && p.title.includes(': ')) {
    const reg = new RegExp(`\\b${p.region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const [head, ...rest] = p.title.split(': ');
    const tail = rest.join(': ');
    if (reg.test(head) && reg.test(tail)) issues.push(`CITY echoed in name + suffix ("${p.region}"): ${p.f}`);
  }
}
// Obvious hero-image MISMATCHES: a keyword-collision Wikimedia file whose subject
// is clearly unrelated to a venue. These are exactly the failures the 2026-07-24
// image audit found (a restaurant showing a moth specimen / a dune-bashing car /
// US-Navy admirals / a British-Museum statue / an antique print / a foreign
// geograph shot). Flag every Wikimedia hero that hits the off-topic blocklist so
// a new post with one gets caught at publish time instead of living on the site.
for (const p of posts) {
  if (!p.url || p.license !== 'wikimedia') continue;
  const hay = decodeURIComponent(p.url) + ' ' + p.credit;
  if (OFFTOPIC.test(hay)) {
    const fileName = (decodeURIComponent(p.url).split('/').pop() || '').replace(/\.(jpg|jpeg|png|svg).*$/i, '').slice(0, 48);
    issues.push(`IMAGE MISMATCH suspect [${p.category}] "${p.region}" — off-topic hero (${fileName}): ${p.f}`);
  }
}
// A title left dangling on a connector — the de-echo rule stripped the city out of
// "Classical Gardens of Suzhou" and shipped "Classical Gardens of: Suzhou …".
for (const p of posts) {
  if (/\b(of|the|de|du|des|at|in|on|and|for|el|la|le|les)\s*:\s/i.test(p.title) || /[&@+\-–—/]\s*:\s/.test(p.title)) {
    issues.push(`BROKEN TITLE (dangling connector before ":"): ${p.f} — "${p.title}"`);
  }
}
// A place.name that is really a leftover search-tag dump ("x / y restaurant / z vegan /")
// renders in the fact box AND the schema.
for (const p of posts) {
  if (p.placeName && (p.placeName.split('/').length > 2 || p.placeName.length > 90)) {
    issues.push(`GARBLED place.name (looks like a search-query dump): ${p.f} — "${p.placeName.slice(0, 70)}…"`);
  }
}
// An event with no machine-readable start date can't sort, expire, or emit Event
// schema — the date is usually sitting in the prose.
for (const p of posts) {
  if (p.category === 'event' && !p.eventStart) issues.push(`EVENT missing eventStartDate: ${p.f}`);
}
// Two posts about the same event on the same date in the same city = duplicate
// coverage, and if their dates DISAGREE one of them is telling readers a lie.
{
  const evs = posts.filter((p) => p.category === 'event');
  const byName = new Map();
  const norm = (t) => String(t).replace(/:\s*What to Know.*$/i, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !FILLER.has(w)).sort().join(' ');
  for (const p of evs) {
    const k = `${norm(p.title)}|${p.region}`;
    (byName.get(k) || byName.set(k, []).get(k)).push(p);
  }
  for (const [, group] of byName) {
    if (group.length < 2) continue;
    const dates = new Set(group.map((g) => (g.eventStart ? String(g.eventStart).slice(0, 10) : '?')));
    issues.push(
      dates.size > 1
        ? `CONTRADICTORY event dates for the same event (${[...dates].join(' vs ')}): ${group.map((g) => g.f).join(', ')}`
        : `DUPLICATE event coverage ×${group.length}: ${group.map((g) => g.f).join(', ')}`
    );
  }
}
dupBy((p) => (p.url && !p.url.includes('placeholder') ? unsplashNum(p.url) || p.url : ''), 'DUPLICATE image');
dupBy((p) => p.placeId, 'DUPLICATE place.id');
// Only for posts WITHOUT a place.id (events/placeless) — venue posts are already
// de-duped by place.id above, and non-ASCII venue names (Vietnamese/Korean) would
// otherwise collapse to just the city and false-positive.
dupBy((p) => (!p.placeId ? topicKey(p.title, p.region) : ''), 'DUPLICATE topic (near-identical post)');

// Essentials completeness — each non-draft country guide must carry all 6 H2
// sections. A truncated guide (the max_tokens bug) is worse than none: the topic
// hubs advertise these countries and a half-written page erodes trust + E-E-A-T.
const ESS_DIR = fileURLToPath(new URL('../src/content/essentials/', import.meta.url));
const REQUIRED_ESS = [
  '## Visa & entry', '## Getting around', '## Money & costs',
  '## Best time to visit', '## Emergencies & safety', '## Official sources',
];
let essCount = 0;
for (const f of (await readdir(ESS_DIR)).filter((f) => f.endsWith('.md'))) {
  const t = await readFile(join(ESS_DIR, f), 'utf8');
  if (/^draft:\s*true/m.test(t)) continue;
  essCount++;
  const miss = REQUIRED_ESS.filter((h) => !t.includes(h));
  if (miss.length) issues.push(`ESSENTIALS ${f} incomplete — missing: ${miss.join(', ')}`);
}

// Unescaped tilde gate — ALL collections. CJK ranges ("4~5월") are GFM
// strikethrough markers; a pair struck out whole paragraphs on 308 posts once and
// then again on essentials translations because the first fix was posts-only.
// This walks EVERY content dir so no future collection can regress silently.
const CONTENT_ROOT = fileURLToPath(new URL('../src/content/', import.meta.url));
async function tildeWalk(dir, rel = '') {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { await tildeWalk(p, `${rel}${e.name}/`); continue; }
    if (!e.name.endsWith('.md')) continue;
    const raw = await readFile(p, 'utf8');
    const fmEnd = raw.indexOf('\n---', 3);
    const body = fmEnd === -1 ? raw : raw.slice(fmEnd + 4);
    if (/(^|[^\\])~/.test(body)) issues.push(`TILDE unescaped in ${rel}${e.name} body — renders as strikethrough (escape as \\~)`);
  }
}
await tildeWalk(CONTENT_ROOT);

if (issues.length) {
  console.log(`❌ ${issues.length} content issue(s) across ${posts.length} posts + ${essCount} essentials:\n`);
  for (const i of issues) console.log(`  • ${i}`);
  process.exit(1);
}
console.log(`✓ ${posts.length} posts clean — no slash regions, placeholders, dup images, dup places, or near-dup topics.`);
