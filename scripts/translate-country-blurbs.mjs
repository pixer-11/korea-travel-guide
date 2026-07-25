#!/usr/bin/env node
// Translate each country's one-line blurb into ko/ja/es/zh.
// Source of truth = data/countries.json `blurb` (English); output =
// src/i18n/country-blurbs.json keyed by country slug. Without this a newly added
// country showed its English blurb on every localized page — the one piece of
// per-country copy that had no translation script at all.
//
// Idempotent + cheap: only translates slugs/languages that are missing, and
// re-translates when the English source changed (tracked via an `_en` snapshot).
//
//   node scripts/translate-country-blurbs.mjs           # fill what's missing
//   node scripts/translate-country-blurbs.mjs --force   # re-translate everything
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COUNTRIES = fileURLToPath(new URL('../data/countries.json', import.meta.url));
const OUT = fileURLToPath(new URL('../src/i18n/country-blurbs.json', import.meta.url));
const LANGS = ['ko', 'ja', 'es', 'zh'];
const LANG_NAME = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const FORCE = process.argv.includes('--force');

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }
const client = new Anthropic();

const { countries } = JSON.parse(await readFile(COUNTRIES, 'utf8'));
const table = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : {};

const TOOL = {
  name: 'submit_blurbs',
  description: 'Return the translated one-line country blurbs.',
  input_schema: {
    type: 'object',
    properties: Object.fromEntries(LANGS.map((l) => [l, { type: 'string', description: `${LANG_NAME[l]} translation` }])),
    required: LANGS,
  },
};

let done = 0, skipped = 0, failed = 0;
for (const c of countries) {
  const en = (c.blurb || '').trim();
  if (!en) { skipped++; continue; }
  const entry = table[c.slug] || {};
  const staleSource = entry._en && entry._en !== en; // English blurb was edited
  const missing = LANGS.filter((l) => !entry[l]);
  if (!FORCE && !staleSource && missing.length === 0) { skipped++; continue; }

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'submit_blurbs' },
      messages: [{
        role: 'user',
        content: `Translate this one-line description of ${c.name} for a travel guide into ${LANGS.map((l) => LANG_NAME[l]).join(', ')}.

Keep it ONE line, the same length and punchy editorial tone as the English. Translate meaning, not word-for-word. Keep proper nouns readable for that audience (localize place names where a common local form exists). Do not add or drop facts.

English: ${en}`,
      }],
    });
    const use = msg.content.find((b) => b.type === 'tool_use');
    if (!use) throw new Error('no tool_use in response');
    table[c.slug] = { ...entry, ...Object.fromEntries(LANGS.map((l) => [l, use.input[l]])), _en: en };
    done++;
    console.log(`  ✓ ${c.slug}${staleSource ? ' (source changed)' : ''}`);
  } catch (e) {
    failed++;
    console.log(`  ⚠️  ${c.slug}: ${String(e.message).slice(0, 110)}`);
  }
}

if (done) await writeFile(OUT, JSON.stringify(table, null, 1) + '\n', 'utf8');
console.log(`\nCountry blurbs: ${done} translated, ${skipped} already current, ${failed} failed.`);
