#!/usr/bin/env node
// Add a country to data/countries.json safely. Everything downstream (pages, nav,
// publishing, essentials, events, name + blurb translation, llms.txt, schema) keys
// off this file, so the only real risk is a malformed entry — this validates the
// shape, catches duplicates, and tells you exactly what runs next.
//
//   node scripts/add-country.mjs --name "Portugal" --iso2 pt --continent Europe \
//     --regions "Lisbon,Porto,Sintra" --blurb "Atlantic light, tiled streets…"
//   node scripts/add-country.mjs ... --dry-run
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../data/countries.json', import.meta.url));
const KNOWN_CONTINENTS = ['Asia', 'Europe', 'North America', 'South America', 'Africa', 'Oceania', 'Other'];

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
};
const DRY = process.argv.includes('--dry-run');

const name = arg('name');
const iso2 = (arg('iso2') || '').toLowerCase();
const continent = arg('continent');
const regions = (arg('regions') || '').split(',').map((s) => s.trim()).filter(Boolean);
const blurb = arg('blurb') || '';
const flag = arg('flag') || '';
const slug = (arg('slug') || name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

if (!name) fail('--name is required');
if (!/^[a-z]{2}$/.test(iso2)) fail('--iso2 must be a 2-letter ISO-3166-1 alpha-2 code (e.g. pt)');
if (!continent) fail('--continent is required');
if (!regions.length) fail('--regions is required (comma-separated cities to publish guides for)');
if (!blurb) fail('--blurb is required (one English line; ko/ja/es/zh are translated automatically)');

const data = JSON.parse(await readFile(FILE, 'utf8'));
const clash = data.countries.find(
  (c) => c.name.toLowerCase() === name.toLowerCase() || c.slug === slug || c.iso2.toLowerCase() === iso2
);
if (clash) fail(`already present: ${clash.name} (slug ${clash.slug}, iso2 ${clash.iso2})`);

if (!KNOWN_CONTINENTS.includes(continent)) {
  console.warn(`⚠ "${continent}" is not one of ${KNOWN_CONTINENTS.join(', ')}.`);
  console.warn('  It will still appear (unknown continents are appended, not dropped), but add a');
  console.warn(`  \`continent.${continent}\` key to all 5 languages in src/i18n/ui.ts or the label`);
  console.warn('  falls back to the raw English name.');
}

// priority is only a tie-breaker now (the publish queue is fewest-posts-first), so
// just put the newcomer after the current max.
const priority = Math.max(...data.countries.map((c) => c.priority ?? 0)) + 1;
const entry = { name, iso2, priority, slug, flag, active: true, blurb, regions, continent };

console.log('\nEntry to add:\n' + JSON.stringify(entry, null, 2));

if (DRY) { console.log('\n(dry run — nothing written)'); process.exit(0); }

data.countries.push(entry);
await writeFile(FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`\n✓ Added ${name} to data/countries.json (${data.countries.length} countries total)`);
console.log(`
Next:
  1. npm run build                    # confirm it builds
  2. commit + push                    # auto-deploys
  3. dispatch publish.yml (optionally country="${name}") for the first guides —
     the queue is fewest-posts-first, so ${name} goes to the front automatically.
     backfill.yml (bulk fill) has its cron paused but workflow_dispatch still works.

Automatic from here: nav · destination/continent/region pages (5 langs) · daily
publishing · essentials (monthly) · events + .ics · place-name and blurb
translation (in publish.yml) · crowd tool · newsletter · photos · llms.txt ·
sitemap/hreflang/schema. ${name} shows up in nav/counts once it has its first post.`);
