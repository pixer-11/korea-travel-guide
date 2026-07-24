// Build src/i18n/places.json — the localized name for every COUNTRY and REGION
// used on the site, in ko/ja/es/zh. Place names are DATA (they come from posts /
// countries.json), so they can't live in the UI dictionary; without this the
// Korean homepage says "추천: Jeju" and breadcrumbs read "United Arab Emirates".
//
// Idempotent: existing entries are kept, only missing ones are translated, so
// this can run whenever a new country/city appears.
//   node scripts/build-place-names.mjs            # fill in what's missing
//   node scripts/build-place-names.mjs --force    # redo everything
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/i18n/places.json', import.meta.url));
const COUNTRIES = fileURLToPath(new URL('../data/countries.json', import.meta.url));
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const FORCE = process.argv.includes('--force');
const BATCH = 40;

const TOOL = {
  name: 'submit_place_names',
  description: 'Return the localized name of each place in every requested language.',
  input_schema: {
    type: 'object',
    properties: {
      places: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            en: { type: 'string', description: 'The original English name, unchanged.' },
            ko: { type: 'string' },
            ja: { type: 'string' },
            es: { type: 'string' },
            zh: { type: 'string' },
          },
          required: ['en', 'ko', 'ja', 'es', 'zh'],
        },
      },
    },
    required: ['places'],
  },
};

const prompt = (names) => `Give the standard, commonly-used name of each place below in Korean, Japanese, Spanish, and Simplified Chinese.

RULES
- Use the name a NATIVE SPEAKER would actually use (the established exonym), e.g. Jeju → 제주 / 済州 / Jeju / 济州; United Arab Emirates → 아랍에미리트 / アラブ首長国連邦 / Emiratos Árabes Unidos / 阿拉伯联合酋长国.
- If a language normally keeps the Latin name (common in Spanish for Asian cities), return it unchanged rather than inventing a translation.
- Cities keep their city name only — do not add the country.
- Return every place exactly once, with "en" copied verbatim so I can match it.

PLACES
${names.map((n) => `- ${n}`).join('\n')}`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── collect every place name in use ──────────────────────────
const names = new Set();
for (const c of JSON.parse(await readFile(COUNTRIES, 'utf8')).countries) {
  if (c?.name) names.add(c.name);
  for (const r of c.regions ?? []) if (r) names.add(r);
}
for (const f of (await readdir(POSTS)).filter((x) => x.endsWith('.md'))) {
  const fm = (await readFile(join(POSTS, f), 'utf8')).split('---')[1] || '';
  for (const key of ['country', 'region']) {
    const v = new RegExp(`(?:^|\\n)${key}:\\s*['"]?([^'"\\n]+)`).exec(fm)?.[1]?.trim();
    if (v && !v.includes('/')) names.add(v);
  }
}

const existing = !FORCE && existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : {};
const todo = [...names].filter((n) => !existing[n]).sort();
console.log(`${names.size} place name(s) in use · ${todo.length} to translate · model ${MODEL}`);
if (!todo.length) { console.log('Nothing to do — places.json is up to date.'); process.exit(0); }

for (let i = 0; i < todo.length; i += BATCH) {
  const chunk = todo.slice(i, i + BATCH);
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_place_names' },
    messages: [{ role: 'user', content: prompt(chunk) }],
  });
  const out = msg.content.find((c) => c.type === 'tool_use')?.input?.places ?? [];
  for (const p of out) {
    if (!p?.en || !names.has(p.en)) continue;
    existing[p.en] = { ko: p.ko, ja: p.ja, es: p.es, zh: p.zh };
  }
  console.log(`  batch ${i / BATCH + 1}: +${out.length} (total ${Object.keys(existing).length})`);
}

const sorted = Object.fromEntries(Object.keys(existing).sort().map((k) => [k, existing[k]]));
await writeFile(OUT, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
console.log(`\nWrote ${Object.keys(sorted).length} place names → src/i18n/places.json`);
