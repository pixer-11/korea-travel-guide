#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  WHERE THE LINKS ACTUALLY GO
//
//  "Is it live?" has three layers, and only two of them were checked by machine:
//    1. does it answer          — status codes, checked
//    2. does it say anything    — check-whats-closed-rendered, checked
//    3. does the link go where it claims — checked by a person opening a browser
//
//  Layer 3 shipped a real defect on 2026-09-06: /tools/whats-closed/ existed in
//  five languages, answered 200 in all five, and its language switcher sent every
//  reader to the locale ROOT instead of the translated page, because the page
//  never declared itself localized. No status code would ever have shown that.
//
//  This reads the BUILT site and checks the destinations:
//    · every hreflang alternate resolves to a page that exists in dist
//    · a page carrying alternates has switcher links that keep the path
//    · a switcher link never points at a bare locale root unless the page IS one
//
//  Sampled by route shape, not exhaustively: one page per template answers the
//  question (a template is right or wrong for all of its pages), and reading
//  12,000 files would put this out of reach of every run that matters.
//
//    node scripts/audit-link-destinations.mjs [distDir]
// ─────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = process.argv[2] || 'dist';
const LOCALES = ['ko', 'ja', 'es', 'zh'];
// The switcher renders these labels; a link carrying one is a switcher link
// wherever it sits in the markup.
const SWITCHER_LABELS = { ko: '한국어', ja: '日本語', es: 'Español', zh: '中文' };
const PER_SHAPE = 2;

if (!existsSync(DIST)) {
  console.log(`dist not found at ${DIST} — build first`);
  process.exit(0);
}

// ── collect the built pages ──────────────────────────────────
const pages = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (entry === 'index.html') pages.push(p);
  }
})(DIST);

const urlOf = (file) => {
  const rel = relative(DIST, file).split(sep).slice(0, -1).join('/');
  return rel ? `/${rel}/` : '/';
};
const built = new Set(pages.map(urlOf));

// A route shape is the path with its variable segments blanked, so
// /ko/posts/abc/ and /ko/posts/xyz/ are one template.
const shapeOf = (url) => url
  .split('/')
  .map((seg, i) => (i > 1 && seg && !/^(posts|regions|essentials|tools|itinerary|ko|ja|es|zh)$/.test(seg) ? '*' : seg))
  .join('/');

const sampled = [];
const seenShapes = new Map();
for (const file of pages) {
  const shape = shapeOf(urlOf(file));
  const n = seenShapes.get(shape) ?? 0;
  if (n >= PER_SHAPE) continue;
  seenShapes.set(shape, n + 1);
  sampled.push(file);
}

// ── check one page ───────────────────────────────────────────
const problems = [];
const pathOf = (href) => {
  try { return new URL(href, 'https://wanderatlasguides.com').pathname; } catch { return null; }
};

for (const file of sampled) {
  const url = urlOf(file);
  const html = readFileSync(file, 'utf8');

  const alternates = new Map();
  for (const m of html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)) {
    const [, lang, href] = m;
    if (lang === 'x-default') continue;
    alternates.set(lang.split('-')[0], pathOf(href));
  }

  for (const [lang, target] of alternates) {
    if (target && !built.has(target)) {
      problems.push(`${url} — hreflang ${lang} points at ${target}, which was not built`);
    }
  }

  // The switcher: find each locale's labelled anchor and read where it goes.
  for (const [lang, label] of Object.entries(SWITCHER_LABELS)) {
    const m = new RegExp(`<a[^>]*href="([^"]+)"[^>]*>\\s*${label}\\s*</a>`).exec(html);
    if (!m) continue;
    const dest = pathOf(m[1]);
    const isLocaleRoot = dest === `/${lang}/`;
    const expected = alternates.get(lang);

    if (expected && dest !== expected) {
      problems.push(`${url} — the ${label} button goes to ${dest}, but hreflang says ${expected}`);
    } else if (!expected && isLocaleRoot && url !== '/' && !url.startsWith(`/${lang}/`)) {
      // No alternates declared AND the switcher falls back to the locale root:
      // the whats-closed shape exactly. Only flagged when the translated page
      // actually exists, so an English-only page is not nagged about.
      const wouldBe = `/${lang}${url}`;
      if (built.has(wouldBe)) {
        problems.push(`${url} — the ${label} button drops the reader at ${dest}, but ${wouldBe} exists (missing localized={true}?)`);
      }
    }
  }
}

console.log(`checked ${sampled.length} page(s) across ${seenShapes.size} route shape(s) of ${pages.length} built`);
for (const p of problems) console.log(`LINK-DESTINATION: ${p}`);

if (problems.length) {
  console.log(`\n${problems.length} link(s) that do not go where the page says they go.`);
  process.exit(1);
}
console.log('✓ link destinations: every alternate resolves and every switcher keeps its path.');
