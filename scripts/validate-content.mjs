// Content-integrity gate. Run AFTER a publish/discover step: it scans every post
// for the failure modes we've hit before and prints a report. Exit code 1 if any
// issue is found, so the workflow can fire a Telegram warning (the post is already
// committed — this makes a problem loud instead of silently living on the site).
//
//   node scripts/validate-content.mjs
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unsplashNum } from './lib/images.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));

// Normalized topic key: strip the "…: What to Know (City)" suffix, tokenize, drop
// short/filler words, sort — so "Formula 1 Italian Grand Prix" and "Italian Grand
// Prix Formula 1" collapse to the same key (that's how a dup slipped through).
const FILLER = new Set(['the', 'and', 'with', 'what', 'know', 'guide', 'visitor', 'visitors', 'where', 'eat', 'know', '2026', '2027']);
// Include the region so only SAME-CITY name variants collapse (Monza F1 ×2), not
// different cities that share a generic noun ("Tower"/"Local Restaurant").
const topicKey = (title, region) => {
  const name = String(title).split(/:\s*(?:What to Know|Where to Eat|A Visitor)/i)[0];
  return `${name} ${region}`
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !FILLER.has(w))
    .sort().join(' ');
};

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
const posts = [];
for (const f of files) {
  const t = await readFile(join(DIR, f), 'utf8');
  const fm = t.slice(0, t.indexOf('\n---', 3));
  const g = (k) => (fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
  const url = ((fm.split(/^heroImage:/m)[1] || '').match(/^\s+url:\s*"?([^"\n]+?)"?\s*$/m)?.[1] || '').trim();
  const placeId = (fm.match(/\n {2}id:\s*"?([^"\n]+?)"?\s*$/m)?.[1] || '').trim();
  posts.push({ f, region: g('region'), category: g('category'), title: g('title'), url, placeId });
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

if (issues.length) {
  console.log(`❌ ${issues.length} content issue(s) across ${posts.length} posts + ${essCount} essentials:\n`);
  for (const i of issues) console.log(`  • ${i}`);
  process.exit(1);
}
console.log(`✓ ${posts.length} posts clean — no slash regions, placeholders, dup images, dup places, or near-dup topics.`);
