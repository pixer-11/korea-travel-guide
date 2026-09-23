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

// 빌드 결과가 없으면 "5건 실패" 가 아니라 "검사를 못 했다" 다 — 못 본 것을
// 결함으로 세면 그 숫자는 사이트가 아니라 실행 환경을 말한다(2026-09-13).
if (!existsSync(DIST)) {
  console.log(`WHATS-CLOSED-UNCHECKED: ${DIST}/ 없음 — 아무것도 검사하지 못했다. 빌드 먼저.`);
  process.exit(1);
}
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
  // Comments are not delivered text either — a commented-out row counted as a
  // rendered one, which is the same lie as the client island.
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Counting <time> ANYWHERE on the page was too generous: a footer timestamp, a
  // date input, or a stray dated element elsewhere in the layout would have made
  // an empty answer look answered — the very failure this file exists to catch.
  // The answer lives in one block (since the 2026-09-24 redesign: summary, grid,
  // holidays, plan — #wc-results up to its #wc-results-end marker), so look only there.
  const answer = regionOf(visible);
  // datetime is not necessarily the first attribute, and the quotes are not
  // necessarily double — <time class="date" datetime='2026-09-07'> is valid and
  // visible, and the old pattern read it as nothing.
  // A row must be one the reader can actually read: `hidden` is not rendered,
  // and <time datetime="…"></time> with nothing between the tags is an empty
  // answer wearing the markup of a full one. Both counted as rows before.
  const rows = [...answer.matchAll(/<time([^>]*)>([\s\S]*?)<\/time>/gi)]
    .filter(([, attrs, inner]) => /\sdatetime=["']\d{4}-\d{2}-\d{2}["']/i.test(attrs)
      && !/\shidden(\s|=|$)/i.test(attrs)
      && inner.replace(/<[^>]*>/g, '').trim() !== '');
  if (rows.length === 0) {
    console.log(`  ❌ ${label}: no dated rows in the delivered HTML — the default view is empty`);
    failed++;
  } else {
    console.log(`  ✓ ${label}: ${rows.length} dated row(s) rendered`);
  }

  // The two renderers must name a place the same way. On 2026-09-14 the live
  // Korean page opened on "Siem Reap Art Center Night Market" — the server list
  // skipped the translated-title step — while the island carried
  // "시엠립 아트센터 나이트마켓" for the same slug, so the name changed under
  // the reader the moment they pressed the button.
  const disagreements = namesThatDisagree(html);
  if (disagreements.length) {
    console.log(`  ❌ ${label}: server list and island name ${disagreements.length} place(s) differently — e.g. ${disagreements[0]}`);
    failed++;
  }
}

/**
 * Venue names in the server-rendered closure list that differ from the
 * island's name for the same slug. Exported shape kept tiny so the rule can
 * be read at a glance; the island is the reference because it is the list the
 * reader ends up with after any interaction.
 */
function regionOf(visible) {
  const start = visible.search(/id="wc-results"/);
  const end = visible.search(/id="wc-results-end"/);
  if (start < 0 || end < start) return '';
  return visible.slice(start, end);
}

function namesThatDisagree(html) {
  const island = new Map();
  for (const m of html.matchAll(/"slug":"([^"]+)","name":"((?:[^"\\]|\\.)*)"/g)) {
    try { island.set(m[1], JSON.parse(`"${m[2]}"`)); } catch { /* unreadable entry: not ours to judge */ }
  }
  const start = html.search(/id="wc-results"/);
  const end = html.search(/id="wc-results-end"/);
  if (start < 0 || end < start) return [];
  const out = [];
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  for (const m of html.slice(start, end).matchAll(/<a\b[^>]*href="[^"]*\/posts\/([^"/]+)\/?"[^>]*>([^<]*)<\/a>/g)) {
    const want = island.get(m[1]);
    const got = decode(m[2]).trim();
    if (want !== undefined && want !== got) out.push(`${m[1]}: "${got}" ≠ "${want}"`);
  }
  return out;
}

if (failed) {
  console.log(`\nWHATS_CLOSED_RENDER fail=${failed}`);
  process.exit(1);
}
console.log('\nWHATS_CLOSED_RENDER ok — every language carries its answer as text.');
