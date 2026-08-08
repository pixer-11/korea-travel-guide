// Build the venue-name dictionary for the crowd-demo pool (and any UI that
// shows a venue name outside a translated article). The ko home was demoing
// "Nara Park" in Latin because localizePlace only knows regions/countries.
//
// Output: src/i18n/venue-names.json  { "<English name>": { ko, ja, es, zh } }
// Only names with an ESTABLISHED conventional exonym are translated; the model
// must return null for a language where the venue is normally written in its
// original form there (then we keep the English/original name).
//
//   node scripts/translate-venue-names.mjs           # regenerates the file
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/i18n/venue-names.json', import.meta.url));
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';

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
  const name = s.match(/^\s*name:\s*(.+)$/m)?.[1]?.trim().replace(/^"|"$/g, '');
  const region = s.match(/^region:\s*(.+)$/m)?.[1]?.trim().replace(/^"|"$/g, '');
  if (name) venues.push({ name, region });
}
const uniq = [...new Map(venues.map((v) => [v.name, v])).values()].sort((a, b) => a.name.localeCompare(b.name));
console.log(`${uniq.length} venue(s) in the demo pool`);

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

const prompt = `For each famous tourist venue below, give the CONVENTIONAL name a travel guide in each language would print — Korean (ko), Japanese (ja), Spanish (es), Simplified Chinese (zh).

Rules:
- Use ONLY the established, widely-used exonym (the name Korean/Japanese/Spanish/Chinese guidebooks and Wikipedia actually use). Examples: "Nara Park" → ko "나라 공원", ja "奈良公園", zh "奈良公园". "Eiffel Tower" → ko "에펠탑", es "Torre Eiffel", zh "埃菲尔铁塔".
- If a language has NO established form and normally prints the original name (common in Spanish for Asian venues, e.g. es for "Kinkaku-ji" stays "Kinkaku-ji"), return null for that language. NEVER invent a transliteration.
- Do not add the city to the name unless the conventional name includes it.
- Return every venue, same order.

VENUES (name — city for disambiguation):
${uniq.map((v) => `${v.name} — ${v.region}`).join('\n')}`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const msg = await client.messages.create({
  model: MODEL, max_tokens: 16000,
  tools: [TOOL], tool_choice: { type: 'tool', name: 'submit_names' },
  messages: [{ role: 'user', content: prompt }],
});
const got = msg.content.find((b) => b.type === 'tool_use')?.input?.venues ?? [];
if (got.length !== uniq.length) throw new Error(`expected ${uniq.length}, got ${got.length}`);

const dict = {};
for (const v of got) {
  const entry = {};
  for (const l of ['ko', 'ja', 'es', 'zh']) if (v[l]) entry[l] = v[l];
  if (Object.keys(entry).length) dict[v.name] = entry;
}
writeFileSync(OUT, JSON.stringify(dict, null, 2) + '\n');
console.log(`wrote ${Object.keys(dict).length} entries to src/i18n/venue-names.json`);
