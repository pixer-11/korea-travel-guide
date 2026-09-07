#!/usr/bin/env node
// THE WHAT'S-CLOSED PAGE MUST CARRY ITS ANSWER IN THE HTML.
//
// The whole reason that page renders its default view at build time is so the
// answer is text a reader — or an assistant quoting us — can see without running
// JavaScript. The first build of it (2026-09-06) defaulted to the alphabetically
// first country, Cambodia, which had neither a holiday nor a closing day in the
// coming fortnight, and shipped an empty page that still returned 200. Nothing
// would have caught that but reading the file.
//
// So this reads the built file and fails when the answer is missing. Run after a
// build, before a deploy:
//
//   node scripts/check-whats-closed-rendered.mjs [distDir]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = process.argv[2] || 'dist';
const LANGS = ['', 'ko', 'ja', 'es', 'zh'];

let failed = 0;
for (const lang of LANGS) {
  const file = join(DIST, lang, 'tools', 'whats-closed', 'index.html');
  const label = lang || 'en';
  if (!existsSync(file)) {
    console.log(`  ❌ ${label}: page not built (${file})`);
    failed++;
    continue;
  }
  const html = readFileSync(file, 'utf8');
  // Only what a reader sees: the client island is stripped first, so a page whose
  // dates exist solely inside <script> counts as empty, which is the point.
  const visible = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');

  // Counting <time> ANYWHERE on the page was too generous: a footer timestamp, a
  // date input, or a stray dated element elsewhere in the layout would have made
  // an empty answer look answered — the very failure this file exists to catch.
  // The answer lives in exactly two lists, so look only in them.
  const listOf = (id) => {
    const start = visible.search(new RegExp(`<ul[^>]*id="${id}"`));
    if (start < 0) return '';
    const end = visible.indexOf('</ul>', start);
    return end < 0 ? visible.slice(start) : visible.slice(start, end);
  };
  const answer = listOf('wc-holiday-list') + listOf('wc-closure-list');
  // datetime is not necessarily the first attribute, and the quotes are not
  // necessarily double — <time class="date" datetime='2026-09-07'> is valid and
  // visible, and the old pattern read it as nothing.
  const rows = answer.match(/<time[^>]*\sdatetime=["']\d{4}-\d{2}-\d{2}["']/gi) ?? [];
  if (rows.length === 0) {
    console.log(`  ❌ ${label}: no dated rows in the delivered HTML — the default view is empty`);
    failed++;
  } else {
    console.log(`  ✓ ${label}: ${rows.length} dated row(s) rendered`);
  }
}

if (failed) {
  console.log(`\nWHATS_CLOSED_RENDER fail=${failed}`);
  process.exit(1);
}
console.log('\nWHATS_CLOSED_RENDER ok — every language carries its answer as text.');
