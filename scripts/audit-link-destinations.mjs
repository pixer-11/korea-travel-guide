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
// English was missing from this list, so the one button every localized page
// carries back to the source language was the one button nobody checked: a
// Korean page whose English link went to `/` instead of the English article
// would have passed with all four of its other buttons correct.
const SWITCHER_LABELS = { en: 'English', ko: '한국어', ja: '日本語', es: 'Español', zh: '中文' };
const PER_SHAPE = 2;
// A path segment counts as a variable (an id, a slug) rather than a template
// name when its parent has this many siblings under it. See shapeOf.
// Set high on purpose. At 25 the /essentials/ branch — six fixed templates
// (best-time-to-visit, emergency, money, visa …) plus twenty country pages, 26
// children in all — tipped over into "these are all slugs", and the sampler took
// two of the twenty-six. A broken /ko/essentials/visa/ would never have been
// opened. The real slug collections are in the hundreds or thousands, so there
// is a wide gap to sit in: posts (1,408) and regions (317) still collapse.
const VARIABLE_FANOUT = 100;

// Exit 0 here meant "no dist, nothing wrong" — and the workflow, which reads a
// non-empty log as a completed audit, painted that green. A missing build is a
// missing audit. Prefixed LINK-DESTINATION: so the alerting layer counts it.
if (!existsSync(DIST)) {
  console.log(`LINK-DESTINATION: dist not found at ${DIST} — nothing was audited. Build first.`);
  process.exit(1);
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
//
// This used to blank every segment that was not in a hand-written allowlist, and
// that quietly merged unrelated TEMPLATES: /es/about/, /es/contact/, /es/events/,
// /es/flights/ and four more all became /es/*/, of which two were sampled and the
// rest never looked at. /tools/best-time/, /tools/esim/, /tools/whats-closed/,
// /tools/when-to-go/ and /tools/widget/ became /tools/*/ — so at least three tool
// pages went unchecked, including the very page whose broken switcher this file
// was written for. A whole template could be wrong and the run would end in a tick.
//
// So ask the built site instead of a list. Sections are few and named; ids and
// slugs are many and arbitrary. A segment is a variable when its siblings are
// numerous: /posts/ has over a thousand children and collapses, /tools/ has five
// and stays itself. Depth 0 is never blanked — the top level is all sections.
const trie = {};
for (const url of built) {
  let node = trie;
  for (const seg of url.split('/').filter(Boolean)) {
    node.kids ??= new Map();
    if (!node.kids.has(seg)) node.kids.set(seg, {});
    node = node.kids.get(seg);
  }
}

const shapeOf = (url) => {
  let node = trie;
  const out = [];
  url.split('/').filter(Boolean).forEach((seg, depth) => {
    const siblings = node.kids?.size ?? 0;
    out.push(depth > 0 && siblings >= VARIABLE_FANOUT ? '*' : seg);
    node = node.kids?.get(seg) ?? {};
  });
  return `/${out.join('/')}${out.length ? '/' : ''}`;
};

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
const SITE = 'https://wanderatlasguides.com';
// Reducing a link to its pathname threw away the two things that make a link
// wrong in the most expensive way: an href on somebody else's domain
// (https://evil.example/ko/about/ "resolved" because /ko/about/ exists here),
// and an href that does not parse at all (which became null and was then skipped
// by the `if (target && …)` guards — unreadable read as fine).
const pathOf = (href, url, what) => {
  let u;
  try { u = new URL(href, SITE); } catch {
    problems.push(`${url} — ${what} is not a usable URL: ${href}`);
    return null;
  }
  if (u.origin !== SITE) {
    problems.push(`${url} — ${what} points off-site, at ${u.origin}`);
    return null;
  }
  return u.pathname;
};

for (const file of sampled) {
  const url = urlOf(file);
  const html = readFileSync(file, 'utf8');

  const alternates = new Map();
  for (const m of html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)) {
    const [, lang, href] = m;
    if (lang === 'x-default') continue;
    alternates.set(lang.split('-')[0], pathOf(href, url, `the ${lang} alternate`));
  }

  for (const [lang, target] of alternates) {
    if (target && !built.has(target)) {
      problems.push(`${url} — hreflang ${lang} points at ${target}, which was not built`);
    }
  }

  // The switcher: find each locale's labelled anchor and read where it goes.
  // Which languages this page actually offers — needed below, because a page
  // that has a switcher and is missing one of its buttons is a different fault
  // from a page that has no switcher at all (a 404, a bare redirect stub).
  const anchorOf = (label) =>
    new RegExp(`<a[^>]*\\shref=["']([^"']+)["'][^>]*>(?:\\s|<[^>]+>)*${label}(?:\\s|<[^>]+>)*</a>`).exec(html);
  const hasSwitcher = Object.values(SWITCHER_LABELS).some((l) => anchorOf(l));

  for (const [lang, label] of Object.entries(SWITCHER_LABELS)) {
    // The label may be wrapped — <a …><span>한국어</span></a> is the same button —
    // and the attributes may be single-quoted. The old pattern demanded the label
    // as the anchor's bare text with double-quoted href, and simply skipped the
    // language when it did not match: every switcher check could vanish while the
    // run still printed a tick.
    const m = anchorOf(label);
    if (!m) {
      // A missing button used to be silently fine, so a switcher that lost one
      // language looked identical to a page that never had one. Only flagged
      // when the page HAS a switcher and claims this language exists.
      if (hasSwitcher && alternates.get(lang)) {
        problems.push(`${url} — declares a ${lang} alternate but has no ${label} button in its switcher`);
      }
      continue;
    }
    const dest = pathOf(m[1], url, `the ${label} button`);
    if (dest === null) continue;   // already reported as off-site or unparseable
    // English has no locale prefix: its root is `/`, not `/en/`.
    const root = lang === 'en' ? '/' : `/${lang}/`;
    const isLocaleRoot = dest === root;
    const expected = alternates.get(lang);

    if (expected && dest !== expected) {
      problems.push(`${url} — the ${label} button goes to ${dest}, but hreflang says ${expected}`);
    } else if (!expected && isLocaleRoot && url !== '/' && !url.startsWith(`/${lang}/`)) {
      // No alternates declared AND the switcher falls back to the locale root:
      // the whats-closed shape exactly. Only flagged when the translated page
      // actually exists, so an English-only page is not nagged about.
      // The page this button should have gone to. For English that means
      // dropping the current locale prefix, not adding an /en/ that never exists.
      const wouldBe = lang === 'en'
        ? url.replace(/^\/(ko|ja|es|zh)\//, '/')
        : `/${lang}${url}`;
      if (wouldBe === url) continue;
      if (built.has(wouldBe)) {
        problems.push(`${url} — the ${label} button drops the reader at ${dest}, but ${wouldBe} exists (missing localized={true}?)`);
      }
    } else if (!built.has(dest)) {
      // Last, so the two diagnoses above keep their more specific wording. With
      // no hreflang to compare against, a typo — <a href="/ko/tools/whats-clsoed/">
      // — was neither the locale root nor a mismatch, so nothing looked at it and
      // the reader got a 404 from a button the audit had just called correct.
      problems.push(`${url} — the ${label} button goes to ${dest}, which was not built`);
    }
  }
}

console.log(`checked ${sampled.length} page(s) across ${seenShapes.size} route shape(s) of ${pages.length} built`);

// Nothing to check is not the same as nothing wrong. An empty or wrong dist made
// this print a tick and exit 0 — the exact shape of failure this file exists to
// catch, sitting inside the file itself (found 2026-09-07 by running it against
// an empty directory). The floor is deliberately low: a real build is 12,000
// pages, so anything under 50 means the input is wrong, not that the site is.
const MIN_PAGES = 50;
if (pages.length < MIN_PAGES) {
  console.log(`LINK-DESTINATION: only ${pages.length} built page(s) found under ${DIST} — that is not a site, it is a bad input. Refusing to report a pass.`);
  process.exit(1);
}
for (const p of problems) console.log(`LINK-DESTINATION: ${p}`);

if (problems.length) {
  console.log(`\n${problems.length} link(s) that do not go where the page says they go.`);
  process.exit(1);
}
console.log('✓ link destinations: every alternate resolves and every switcher keeps its path.');
