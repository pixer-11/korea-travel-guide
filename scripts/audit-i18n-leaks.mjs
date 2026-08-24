// Scans the BUILT site for English leaking into localized pages.
//
// Why this exists: two sweeps in a row missed leaks because the sample was
// "the first N files found while walking dist". That walk never reached an
// itinerary page, so a whole page TYPE shipped with English stop names and
// English transit prose. This samples per page TYPE per language instead, so a
// type can never be skipped silently — if a type has zero pages it is reported.
//
//   node scripts/audit-i18n-leaks.mjs            # after `npm run build`
//   node scripts/audit-i18n-leaks.mjs --per 12   # more pages per type
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIST = 'dist';
const LANGS = ['ko', 'ja', 'es', 'zh'];
const PER = Number(process.argv.includes('--per') ? process.argv[process.argv.indexOf('--per') + 1] : 6);

// One entry per page TYPE the site publishes. Add a row when a new type ships.
const TYPES = [
  { name: 'home', dir: '' },
  { name: 'post', dir: 'posts' },
  { name: 'itinerary', dir: 'itinerary' },
  { name: 'region', dir: 'regions' },
  { name: 'country', dir: 'destinations' },
  { name: 'events', dir: 'events' },
  { name: 'essentials', dir: 'essentials' },
  { name: 'continent', dir: 'continents' },
  { name: 'day-trips', dir: 'day-trips' },
  { name: 'tools', dir: 'tools' },
  // when-to-go lives under tools/, but the sampler fills its quota walking that
  // directory alphabetically and never reaches it — so 1,025 pages sat unchecked
  // behind a type that reported clean. Same shape as the miss that let itinerary
  // pages ship with English stop names: a type is only audited if it is named.
  // Anything added under an existing directory needs its own entry here.
  { name: 'when-to-go', dir: 'tools/when-to-go' },
  // Same reasoning: eSIM guides live under tools/ and would hide behind the
  // 'tools' type's alphabetical sampling without their own entry.
  { name: 'esim', dir: 'tools/esim' },
  { name: 'roundup', dir: 'regions' },
];

// Leaks are checked against VISIBLE html only — schema.org JSON-LD and other
// <script> payloads are meant to stay English and must not trip the audit.
export const stripScripts = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, '');

// Public-holiday names, built FROM the translation table rather than hand-listed,
// so a holiday added to the table is policed the day it ships. Localized pages
// printed "元旦 · New Year's Day" on 356 pages while every hand-written rule here
// reported clean (found 2026-08-06) — a leak nobody had thought to name.
// The English name is only a leak after the "·" separator: an event or venue
// legitimately called "Republic Day" elsewhere on the page must not trip it.
function holidayNameRule() {
  const table = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/i18n/holidays.json'), 'utf8'),
  );
  // A festival the table deliberately keeps under its own name in some
  // language ("Holi", "Diwali", "Onam" — Spanish press uses them unglossed;
  // 34 Indian entries on 2026-08-23) is not a leak when that name shows on
  // that page. CONTAINS, not equals: the 2026-08-23 fix glossed Cambodia's
  // Pchum Ben as "Pchum Ben (Día de los Antepasados)" — no longer equal to
  // the English name, so the name fell back INTO the pattern and the very
  // page the gloss had fixed was flagged again the next evening. A label
  // that carries the proper noun plus a translation is the deliberate,
  // correct form; only Chuseok joins the exempt set besides Pchum Ben
  // (measured: 34 → 36 of 280 names). A real leak of an exempt name in a
  // language that DOES translate it is the trade-off, and the table is the
  // place to fix that.
  const keptAsIs = new Set(
    Object.entries(table)
      .filter(([k, v]) => ['ko', 'ja', 'es', 'zh'].some((l) => typeof v[l] === 'string' && v[l].includes(k.split('|')[1].trim())))
      .map(([k]) => k.split('|')[1]),
  );
  const names = [...new Set(Object.keys(table).map((k) => k.split('|')[1]))]
    .filter((n) => !keptAsIs.has(n))
    .sort((a, b) => b.length - a.length) // longest first: "Eid al-Adha First Day" before "Eid al-Adha"
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
    // Astro escapes apostrophes, so the built page reads "New Year&#39;s Day".
    // A literal ' in the pattern would silently never match — 14 of these names
    // carry one, including the most common holiday on the site.
    .map((n) => n.replace(/'/g, String.raw`(?:'|&#39;|&#x27;|&apos;|’)`));
  return new RegExp(String.raw`·\s*(?:${names.join('|')})\b`);
}

// Spanish legitimately abbreviates hora/minuto as h/min, so the unit rule skips it.
export const RULES = [
  { id: 'holiday-english-name', re: holidayNameRule(), langs: LANGS },
  // The holiday feed marks provisional Islamic-calendar dates with an English
  // "(Tentative Date)" — on the LOCAL name as well as the English one. The
  // first fix translated only the gloss and left the suffix on 12 Turkish
  // pages; the rule above could not see it because it only looks after the "·".
  { id: 'holiday-tentative-english', re: /\(Tentative Date\)/i, langs: LANGS },
  // The rule above could not see the largest leak of all, and why is worth
  // keeping: it builds its pattern FROM holidays.json and only matches after
  // the "·" separator — the exact character that is absent when a gloss is
  // MISSING. It reported clean while 216 of 329 holidays printed English on
  // ko/ja/zh pages ("National Day" on Singapore's August, three English names
  // in a row on Taiwan's February). A checker derived from the table it is
  // meant to check cannot see what that table lacks.
  //
  // This one reads no table. It matches the holiday row's own markup — the span
  // that follows .wtg-date — and fires when a CJK page renders that name in
  // nothing but ASCII. Spanish is excluded: Latin script there is correct.
  {
    id: 'holiday-untranslated',
    re: new RegExp(String.raw`class="wtg-date"[^>]*>[^<]*</span>\s*<span[^>]*>[\x20-\x7E]+</span>`),
    langs: ['ko', 'ja', 'zh'],
  },
  { id: 'klook-en-US', re: /klook\.com(%2F|\/)en-US/, langs: LANGS },
  { id: 'tickets-tours', re: /Tickets &(amp;)? tours for/, langs: LANGS },
  { id: 'price-Free', re: />Free</, langs: LANGS },
  { id: 'time-unit', re: /~[\d.]+ (h|min)</, langs: ['ko', 'ja', 'zh'] },
  // Spanish uses AM/PM and h/min natively, so those two rules skip it.
  { id: 'am-pm', re: /\b\d{1,2}[–-]\d{1,2} (AM|PM)\b/, langs: ['ko', 'ja', 'zh'] },
  { id: 'ui-where-to-stay', re: /Where to stay in/, langs: LANGS },
  { id: 'ui-plan-your-trip', re: /Plan your trip/, langs: LANGS },
  { id: 'ui-getting-there', re: />Getting there</, langs: LANGS },
  { id: 'ui-all-destinations', re: />All destinations</, langs: LANGS },
  { id: 'ui-when-to-go', re: />When to go</, langs: LANGS },
];

/**
 * Every rule one page's HTML trips, for one language. Pure — exported so
 * scripts/audit-i18n-leaks.test.mjs can check the patterns against fixture HTML
 * without a built site. These are regexes carried in source, and a regex that
 * loses a backslash in transit stays syntactically valid while matching nothing:
 * the audit would keep reporting "no leaks" forever. The tests are what tell the
 * difference between a clean site and a dead pattern.
 */
export function leaksIn(html, lang) {
  const visible = stripScripts(html);
  return RULES.filter((r) => r.langs.includes(lang) && r.re.test(visible)).map((r) => r.id);
}

function pagesUnder(dir, limit) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d, depth) => {
    if (out.length >= limit || depth > 3) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === 'index.html') out.push(p);
    }
  };
  walk(dir, 0);
  return out;
}

function main() {
  let failures = 0, emptyTypes = 0, checked = 0;
  for (const lang of LANGS) {
    const base = join(DIST, lang);
    if (!existsSync(base) || !statSync(base).isDirectory()) {
      console.log(`⚠️  ${lang}: built pages missing`); failures++; continue;
    }
    for (const type of TYPES) {
      const dir = type.dir ? join(base, type.dir) : base;
      // Home: only the locale root's own index.html, not everything beneath it.
      const files = type.dir ? pagesUnder(dir, PER) : [join(base, 'index.html')].filter(existsSync);
      if (!files.length) {
        console.log(`⚠️  ${lang}/${type.name}: no pages found — type skipped (add or remove it in TYPES)`);
        emptyTypes++; continue;
      }
      for (const f of files) {
        checked++;
        for (const id of leaksIn(readFileSync(f, 'utf8'), lang)) {
          console.log(`❌ ${lang}/${type.name} — ${id} — ${f}`);
          failures++;
        }
      }
    }
  }

  console.log(`\n📋 checked ${checked} page(s) across ${TYPES.length} type(s) × ${LANGS.length} language(s)`);
  if (emptyTypes) console.log(`   ${emptyTypes} type(s) had no pages — verify that is expected.`);
  if (failures) { console.log(`❌ ${failures} leak(s)/problem(s).`); process.exit(1); }
  console.log('✅ no English leaks in localized pages.');
}

// ── CLI (only when executed directly, not when imported) ─────
if (process.argv[1]?.endsWith('audit-i18n-leaks.mjs')) main();
