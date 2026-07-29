// Build src/i18n/event-names.json — the localized name for every recurring event
// in data/events.json, in ko/ja/es/zh.
//
// Event names are DATA, like place names, so they cannot live in the UI
// dictionary. Without this the Korean when-to-go page for Japan in March lists
// its one seasonal highlight as "Cherry Blossom Season in Japan" — an English
// sentence on a Korean page, sitting under a Korean heading. The leak audit
// could not catch it either, because its rules look for known English UI strings
// and this is English arriving through the data.
//
// Idempotent: existing entries are kept and only missing ones are translated, so
// it is a no-op once every event is covered and costs something only when a new
// event is discovered.
//   node scripts/build-event-names.mjs           # fill in what's missing
//   node scripts/build-event-names.mjs --force   # redo everything
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../src/i18n/event-names.json', import.meta.url));
const EVENTS = fileURLToPath(new URL('../data/events.json', import.meta.url));
const LANGS = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const FORCE = process.argv.includes('--force');
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOL = {
  name: 'submit_names',
  description: 'Return the localized event names.',
  input_schema: {
    type: 'object',
    properties: {
      names: {
        type: 'array',
        description: 'Same order and count as the input list.',
        items: {
          type: 'object',
          properties: { en: { type: 'string' }, translated: { type: 'string' } },
          required: ['en', 'translated'],
        },
      },
    },
    required: ['names'],
  },
};

async function translateBatch(langName, names) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_names' },
    messages: [{
      role: 'user',
      content:
        `Give the name a ${langName} traveller would actually use for each of these recurring travel events.\n\n` +
        `RULES\n` +
        `- Use the established local rendering where one exists (a Japanese festival has a real Korean/Chinese name — use it, do not transliterate blindly).\n` +
        `- Keep it a NAME, not a description. No added explanation.\n` +
        `- Where the original name would still be needed to search for it, keep it in parentheses on the local name.\n` +
        `- Do not translate a proper noun that is normally left as-is in ${langName}.\n` +
        `- Same order, same count.\n\n` +
        names.map((n, i) => `${i + 1}. ${n}`).join('\n'),
    }],
  });
  const out = msg.content.find((c) => c.type === 'tool_use')?.input;
  const rows = Array.isArray(out?.names) ? out.names : [];
  const map = new Map(rows.map((r) => [String(r.en || '').trim(), String(r.translated || '').trim()]));
  // Match by position when the model rephrases the `en` echo — never silently
  // pair the wrong translation to a name.
  return names.map((n, i) => map.get(n) || String(rows[i]?.translated || '').trim() || null);
}

const raw = JSON.parse(await readFile(EVENTS, 'utf8'));
const events = raw.events ?? raw ?? [];
const wanted = [...new Set(events.map((e) => e.name).filter(Boolean))].sort();

const store = existsSync(OUT) && !FORCE ? JSON.parse(await readFile(OUT, 'utf8')) : {};

let added = 0;
for (const [code, langName] of Object.entries(LANGS)) {
  const missing = wanted.filter((n) => !store[n]?.[code]);
  if (!missing.length) continue;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`⚠️  ANTHROPIC_API_KEY not set — ${missing.length} ${code} name(s) left untranslated.`);
    break;
  }
  console.log(`  ${code}: translating ${missing.length} event name(s)…`);
  for (let i = 0; i < missing.length; i += 25) {
    const batch = missing.slice(i, i + 25);
    let result;
    try {
      result = await translateBatch(langName, batch);
    } catch (e) {
      console.log(`  ⚠️  ${code} batch failed (${e.message.slice(0, 80)}) — leaving these for the next run`);
      continue;
    }
    batch.forEach((n, j) => {
      if (!result[j]) return;
      (store[n] ??= {})[code] = result[j];
      added++;
    });
  }
}

await writeFile(OUT, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
const covered = wanted.filter((n) => Object.keys(LANGS).every((c) => store[n]?.[c])).length;
console.log(`📦 event-names.json — ${covered}/${wanted.length} event(s) fully localized (${added} name(s) added this run)`);
