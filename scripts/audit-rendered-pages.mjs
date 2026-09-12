// We inspect every ingredient and almost never the finished plate.
//
// Of the 37 audits in this folder, three read dist/. The rest read markdown
// frontmatter, translation JSON and data files — the INPUTS. So a defect that
// only exists after the templates run is invisible to all of them, and the
// only thing that ever finds one is a person opening the live site. That is
// the whole reason a fresh pair of eyes keeps coming back with "new" defects
// that have in fact been shipping for weeks.
//
// The 2026-09-10 site diagnosis is the proof. Of its eight P0 items, five were
// this shape and every one of them survived a green CI:
//
//   {city} / {years} printed literally      — the i18n string and its caller
//                                             disagreed; no source file is wrong
//   a section rendered as heading + nothing — a lazily-mounted widget's empty div
//   img with an empty src
//   an affiliate link whose date had passed
//   a page with no h1, or with two
//
// Every one is obvious in the built HTML and invisible in the source. So this
// reads the built HTML.
//
// Rules for what goes in here: a finding must be mechanical, must not need a
// judgement call, and must not fire on anything we do deliberately. Anything
// fuzzier belongs in a checker of its own where its false positives can be
// tuned without switching this one off.
//
//   node scripts/audit-rendered-pages.mjs            (needs dist/ — run after a build)
//   node scripts/audit-rendered-pages.mjs --limit 300  (spot check while iterating)
import { readdirSync, readFileSync, existsSync } from 'fs';
import { requireExamined } from './lib/examined.mjs';

const NL = String.fromCharCode(10);
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > 0 ? Number(process.argv[i + 1]) || 0 : 0;
})();

// A build that "succeeded" with no dist is a build we could not check, not a
// site with no defects (2026-09-07 class repair).
if (!existsSync('dist')) {
  console.log('RENDER-UNCHECKED: dist/ 없음 — 아무것도 검사하지 못했다. 빌드 먼저.');
  process.exit(1);
}

// ---- what we strip before looking at anything ----
// Script and style bodies are not page text: JSON-LD is full of braces, and
// inline CSS is full of everything. Strip them first or every page "fails".
const stripCode = (h) =>
  h
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

// A tag ends at the first `>` that is NOT inside an attribute's quotes. Naive
// `<[^>]*>` gets this wrong the moment a title contains an angle bracket, and
// ours do: an ITZY tour is called `<TUNNEL VISION>`, so its alt text reads
//   alt="Gira mundial de ITZY <TUNNEL VISION>"
// which is perfectly valid HTML — inside quotes, `<` and `>` are ordinary
// characters — and which the naive pattern chops in half. That cost this audit
// three false findings on its first real run, which is exactly the shape that
// gets an audit ignored.
const TAG = (name) => new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi');
const ANY_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:[^>"']|"[^"]*"|'[^']*')*>|<\/[a-zA-Z][^>]*>/g;

const textOf = (h) => stripCode(h).replace(ANY_TAG, ' ');

// ---- rule 1: an i18n placeholder printed instead of filled ----
// `{city}`, `{years}`, `{n}`, `{country}` … The shape is deliberately tight —
// a lowercase identifier alone inside braces — because prose legitimately
// contains braces in other shapes and we must not fire on those.
const PLACEHOLDER = /\{[a-z][a-zA-Z0-9_]{0,20}\}/g;

// ---- rule 2: images ----
const IMG = TAG('img');
const attr = (tag, name) => {
  const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'));
  return m ? m[1] : null;
};

// ---- rule 3: affiliate date parameters that have gone stale ----
// The site is rebuilt daily, so a date parameter is only ever wrong if someone
// hardcoded it. Compared against the BUILD's own date, not a fixed string.
const DATE_PARAM = /(?:checkIn|checkOut|check_in|check_out|depart_date|return_date)=(\d{4}-\d{2}-\d{2})/g;
const today = new Date().toISOString().slice(0, 10);

// ---- rule 4: exactly one h1 ----
const H1 = /<h1\b[^>]*>/gi;

// ---- rule 5: a hub meant to share a photograph, sharing the brand card ----
// On 2026-09-12 the six tool hubs were wired to real photos, the dev server
// showed all six, every unit test passed — and the deploy shipped six brand
// cards. The helper read the markdown through import.meta.url, and that path
// only resolves when the module runs from source; bundled, it returned
// undefined, and a missing photo falls back to the default BY DESIGN. So it
// failed silently everywhere except in the built HTML. Nothing but this file
// could have caught it, which is the same lesson as the other four rules.
const OG_MUST_BE_REAL =
  /^\/(?:[a-z]{2}\/)?(?:tools\/(?:when-to-go|best-time|whats-closed|esim|widget)|itinerary)\/index\.html$/;
const OG_TAG = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*property="og:image"(?:[^>"']|"[^"]*"|'[^']*')*>/i;

// Pages that are fragments by design, not documents.
const SKIP_DIRS = new Set(['embed', 'wall', '_astro', 'og', 'api']);

const findings = [];
const seen = new Map(); // rule → count, so one broken template is one line
let pages = 0;

function record(rule, page, detail) {
  const list = seen.get(rule) ?? [];
  list.push({ page, detail });
  seen.set(rule, list);
}

function check(page, html) {
  pages++;
  const text = textOf(html);
  const body = stripCode(html);

  for (const m of text.matchAll(PLACEHOLDER)) record('PLACEHOLDER', page, m[0]);

  for (const tag of body.match(TAG('img')) ?? []) {
    const src = attr(tag, 'src');
    if (src === null || src.trim() === '') record('IMG-NO-SRC', page, tag.slice(0, 80));
    else if (attr(tag, 'alt') === null) record('IMG-NO-ALT', page, src.slice(0, 70));
  }

  for (const m of body.matchAll(DATE_PARAM)) {
    if (m[1] < today) record('STALE-DATE', page, m[0]);
  }

  const h1s = (html.match(H1) ?? []).length;
  if (h1s !== 1) record('H1-COUNT', page, `h1 ${h1s}개`);

  if (OG_MUST_BE_REAL.test(page)) {
    const tag = html.match(OG_TAG)?.[0] ?? '';
    const url = attr(tag, 'content') ?? '';
    if (!url || /og-default/.test(url)) record('OG-DEFAULT', page, url || '(og:image 없음)');
  }
}

(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (LIMIT && pages >= LIMIT) return;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p);
    } else if (e.name.endsWith('.html')) {
      check(p.replace(/^dist/, ''), readFileSync(p, 'utf8'));
    }
  }
})('dist');

const LABEL = {
  PLACEHOLDER: '치환되지 않은 템플릿 변수가 화면에 그대로 나온다',
  'IMG-NO-SRC': 'src 가 비어 있는 img 태그',
  'IMG-NO-ALT': 'alt 가 없는 img 태그',
  'STALE-DATE': '제휴 링크의 날짜 파라미터가 과거다',
  'H1-COUNT': 'h1 이 정확히 하나가 아니다',
  'OG-DEFAULT': '사진을 공유하기로 한 허브가 브랜드 기본 카드를 공유하고 있다',
};

let total = 0;
for (const [rule, list] of seen) {
  total += list.length;
  // One broken template shows up on hundreds of pages; naming three of them
  // and the count is what a person can act on. A wall of 1,200 identical
  // lines is the shape that gets an audit switched off.
  const sample = list.slice(0, 3).map((x) => `${x.page} (${x.detail})`);
  findings.push(`RENDERED-PAGE-${rule}: ${LABEL[rule]} — ${list.length}건${NL}    ${sample.join(NL + '    ')}`);
}

for (const f of findings) console.log(f);
requireExamined(pages, '렌더된 페이지', 'dist 가 비었나? 빌드가 정말 끝났는지 확인할 것');
console.log(total
  ? `${NL}❌ ${pages}개 페이지에서 ${total}건. 원인은 대개 템플릿 한 곳이다.`
  : `${NL}✓ ${pages}개 페이지 — 미치환 변수·빈 이미지·지난 날짜·h1 이상 없음.`);
process.exit(total ? 1 : 0);
