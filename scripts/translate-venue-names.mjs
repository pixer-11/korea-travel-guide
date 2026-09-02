// Build (and top up) the venue-name dictionary for the crowd-demo pool — any UI
// that shows a venue name outside a translated article. The ko home was demoing
// "Nara Park" in Latin because localizePlace only knows regions/countries.
//
// Output: src/i18n/venue-names.json  { "<English name>": { ko, ja, es, zh } }
// Only names with an ESTABLISHED conventional exonym are translated; the model
// returns null for a language where the venue is normally written in its
// original form there, and that language key is simply omitted (the UI then
// keeps the English/original name). A venue that is null in every language is
// stored as {} so the next run knows it was already asked and skips it.
//
// RESUMABLE: existing entries are never re-translated or rewritten — only the
// venues that entered the pool since the last run are sent to the model, in
// chunks, and the file is written after every chunk. Rerun any time new
// attractions have been published:
//
//   node scripts/translate-venue-names.mjs           # tops up the file
//   node scripts/translate-venue-names.mjs --dry     # lists what's missing, no API call
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/i18n/venue-names.json', import.meta.url));
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const LANGS = ['ko', 'ja', 'es', 'zh'];
const CHUNK = 20;
const DRY = process.argv.includes('--dry');

// Same eligibility as the home's crowdDemoPool — this dictionary exists for
// exactly the venues that can appear there.
const venues = [];
for (const f of readdirSync(POSTS)) {
  if (!f.endsWith('.md')) continue;
  const s = readFileSync(POSTS + f, 'utf8');
  if (!s.includes('category: attraction')) continue;
  const ratings = s.match(/userRatingsTotal:\s*(\d+)/);
  if (!ratings || Number(ratings[1]) < 5000) continue;
  if (!/weekdayQuiet|weekendBusy/.test(s)) continue;
  // YAML-quoted names (single OR double) must key exactly as Astro parses them —
  // the old double-quote-only strip left keys like 'BAPS Hindu Mandir, Abu Dhabi'
  // that could never match p.data.place.name.
  const unquote = (t) => t.replace(/^(['"])(.*)\1$/, '$2').replace(/''/g, "'");
  const name = unquote(s.match(/^\s*name:\s*(.+)$/m)?.[1]?.trim() ?? '');
  const region = unquote(s.match(/^region:\s*(.+)$/m)?.[1]?.trim() ?? '');
  if (name) venues.push({ name, region });
}
const uniq = [...new Map(venues.map((v) => [v.name, v])).values()].sort((a, b) => a.name.localeCompare(b.name));
console.log(`${uniq.length} venue(s) in the demo pool`);

// Existing dictionary — preserved verbatim; we only add to it.
const dict = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const before = Object.keys(dict).length;
const missing = uniq.filter((v) => !Object.prototype.hasOwnProperty.call(dict, v.name));
console.log(`${before} already in the dictionary, ${missing.length} missing`);

if (DRY) {
  for (const v of missing) console.log(`  - ${v.name} — ${v.region}`);
  console.log(`--dry: no API call made`);
  process.exit(0);
}
if (!missing.length) {
  console.log('nothing to do');
  process.exit(0);
}

const TOOL = {
  name: 'submit_names',
  input_schema: {
    type: 'object',
    properties: {
      venues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            ko: { type: ['string', 'null'] },
            ja: { type: ['string', 'null'] },
            es: { type: ['string', 'null'] },
            zh: { type: ['string', 'null'] },
          },
          required: ['name', 'ko', 'ja', 'es', 'zh'],
        },
      },
    },
    required: ['venues'],
  },
};

const promptFor = (batch) => `For each famous tourist venue below, give the CONVENTIONAL name a travel guide in each language would print — Korean (ko), Japanese (ja), Spanish (es), Simplified Chinese (zh).

Rules:
- Use ONLY the established, widely-used exonym (the name Korean/Japanese/Spanish/Chinese guidebooks and Wikipedia actually use). Examples: "Nara Park" → ko "나라 공원", ja "奈良公園", zh "奈良公园". "Eiffel Tower" → ko "에펠탑", es "Torre Eiffel", zh "埃菲尔铁塔".
- If a language has NO established form and normally prints the original name (common in Spanish for Asian venues, e.g. es for "Kinkaku-ji" stays "Kinkaku-ji"), return null for that language. NEVER invent a transliteration.
- Do not add the city to the name unless the conventional name includes it.
- Return every venue, same order, with "name" copied EXACTLY as given.

VENUES (name — city for disambiguation):
${batch.map((v) => `${v.name} — ${v.region}`).join('\n')}`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function translateBatch(batch) {
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 16000,
    tools: [TOOL], tool_choice: { type: 'tool', name: 'submit_names' },
    messages: [{ role: 'user', content: promptFor(batch) }],
  });
  const venues = msg.content.find((b) => b.type === 'tool_use')?.input?.venues;
  if (!Array.isArray(venues)) {
    // Surface WHY (refusal, max_tokens, text instead of a tool call) instead of
    // silently counting it as "0 returned".
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').slice(0, 300);
    console.warn(`  no tool call — stop_reason=${msg.stop_reason}${text ? ` text="${text}"` : ''}`);
    return [];
  }
  return venues;
}

// Sorted by key so additions land in place and the diff stays additions-only.
function save() {
  const sorted = Object.fromEntries(Object.keys(dict).sort((a, b) => a.localeCompare(b)).map((k) => [k, dict[k]]));
  writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');
}

let added = 0;
for (let i = 0; i < missing.length; i += CHUNK) {
  const batch = missing.slice(i, i + CHUNK);
  const wanted = new Set(batch.map((v) => v.name));
  let got = await translateBatch(batch);
  let byName = new Map(got.filter((g) => wanted.has(g?.name)).map((g) => [g.name, g]));
  if (byName.size !== batch.length) {
    console.warn(`chunk ${i / CHUNK + 1}: expected ${batch.length}, matched ${byName.size} — retrying once`);
    const unmatched = got.map((g) => g?.name).filter((n) => !wanted.has(n));
    if (unmatched.length) console.warn(`  returned but not requested: ${JSON.stringify(unmatched.slice(0, 5))}`);
    got = await translateBatch(batch);
    byName = new Map(got.filter((g) => wanted.has(g?.name)).map((g) => [g.name, g]));
  }
  for (const v of batch) {
    const g = byName.get(v.name);
    if (!g) { console.warn(`  skipped (not returned): ${v.name}`); continue; }
    const entry = {};
    for (const l of LANGS) {
      const val = typeof g[l] === 'string' ? g[l].trim() : '';
      if (val) entry[l] = val;
    }
    dict[v.name] = entry; // {} = asked, keep the original name everywhere
    added++;
  }
  save(); // progress survives a crash in a later chunk
  console.log(`chunk ${i / CHUNK + 1}/${Math.ceil(missing.length / CHUNK)}: +${byName.size} (${Object.keys(dict).length} total)`);
}
console.log(`wrote ${Object.keys(dict).length} entries to src/i18n/venue-names.json (${before} → +${added})`);
