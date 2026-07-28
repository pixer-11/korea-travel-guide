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
import { join } from 'node:path';

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
  { name: 'tools', dir: 'tools' },
];

// Leaks are checked against VISIBLE html only — schema.org JSON-LD and other
// <script> payloads are meant to stay English and must not trip the audit.
const stripScripts = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, '');

// Spanish legitimately abbreviates hora/minuto as h/min, so the unit rule skips it.
const RULES = [
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
      const html = stripScripts(readFileSync(f, 'utf8'));
      for (const rule of RULES) {
        if (!rule.langs.includes(lang)) continue;
        if (rule.re.test(html)) {
          console.log(`❌ ${lang}/${type.name} — ${rule.id} — ${f}`);
          failures++;
        }
      }
    }
  }
}

console.log(`\n📋 checked ${checked} page(s) across ${TYPES.length} type(s) × ${LANGS.length} language(s)`);
if (emptyTypes) console.log(`   ${emptyTypes} type(s) had no pages — verify that is expected.`);
if (failures) { console.log(`❌ ${failures} leak(s)/problem(s).`); process.exit(1); }
console.log('✅ no English leaks in localized pages.');
