#!/usr/bin/env node
// THE SPLIT MUST NOT LOSE A URL.
//
// dist/sitemap-index.xml stopped pointing at one file on 2026-08-25 and now
// lists ~35 per-language, per-type children (src/lib/sitemap-split.mjs). The
// split exists so Search Console coverage can say WHICH type and WHICH
// language is not getting indexed, instead of "some of 10,454 pages".
//
// The failure mode that would be invisible: a classifier change, or an
// exception swallowed in the integration, and a whole page type quietly stops
// being submitted. Nothing on the site breaks. Traffic for that type just
// stops growing, and we would look for the cause anywhere but here.
//
// So this asserts, against the built output:
//   1. every child the index names actually exists on disk
//   2. the children together hold EXACTLY the URLs of the source sitemap-N
//      files — no loss, no duplication
//   3. no child is empty (an empty sitemap is a submitted file that says
//      nothing, and Search Console reports it as an error)
//
//   node scripts/audit-sitemap-split.mjs [--dist dist]
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = process.argv.includes('--dist') ? process.argv[process.argv.indexOf('--dist') + 1] : 'dist';

const read = (f) => readFileSync(join(DIST, f), 'utf8');
const locs = (xml) => (xml.match(/<loc>([^<]+)<\/loc>/g) ?? []).map((m) => m.slice(5, -6));

const indexPath = join(DIST, 'sitemap-index.xml');
if (!existsSync(indexPath)) {
  console.error('✗ dist/sitemap-index.xml is missing — was the build run?');
  process.exit(1);
}

const children = locs(read('sitemap-index.xml')).map((u) => u.slice(u.lastIndexOf('/') + 1));
const sources = readdirSync(DIST).filter(
  (f) => f.startsWith('sitemap-') && f.endsWith('.xml') && Number.isInteger(Number(f.slice(8, -4))),
);

console.log(`\n🗺️  Sitemap split — index names ${children.length} child sitemap(s), ${sources.length} source file(s) on disk\n`);

let failed = false;

// 1. every child exists
const missing = children.filter((c) => !existsSync(join(DIST, c)));
if (missing.length) {
  failed = true;
  console.error(`✗ ${missing.length} child sitemap(s) named by the index do not exist: ${missing.join(', ')}`);
}

// 2 + 3. URL sets match, and nothing is empty
const before = new Set();
for (const f of sources) for (const u of locs(read(f))) before.add(u);

const after = new Set();
let dupes = 0;
for (const c of children) {
  if (missing.includes(c)) continue;
  const urls = locs(read(c));
  if (!urls.length) {
    failed = true;
    console.error(`✗ ${c} is empty — an empty sitemap is an error in Search Console`);
  }
  for (const u of urls) {
    if (after.has(u)) dupes++;
    after.add(u);
  }
}

const lost = [...before].filter((u) => !after.has(u));
const extra = [...after].filter((u) => !before.has(u));

if (lost.length) {
  failed = true;
  console.error(`✗ ${lost.length} URL(s) present in the source sitemap are in NO child. First 5:`);
  for (const u of lost.slice(0, 5)) console.error(`    ${u}`);
}
if (extra.length) {
  failed = true;
  console.error(`✗ ${extra.length} URL(s) appear in a child but not in the source sitemap. First 5:`);
  for (const u of extra.slice(0, 5)) console.error(`    ${u}`);
}
if (dupes) {
  failed = true;
  console.error(`✗ ${dupes} URL(s) are listed in more than one child — a page must belong to exactly one sitemap for coverage to mean anything`);
}

if (!failed) {
  const byType = new Map();
  for (const c of children) {
    const n = locs(read(c)).length;
    byType.set(c, n);
  }
  const rows = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  for (const [c, n] of rows.slice(0, 8)) console.log(`   ${c.padEnd(30)} ${n}`);
  if (rows.length > 8) console.log(`   … and ${rows.length - 8} more`);
  console.log(`\n✓ ${after.size} URL(s) split across ${children.length} sitemaps — none lost, none duplicated`);
}

process.exit(failed ? 1 : 0);
