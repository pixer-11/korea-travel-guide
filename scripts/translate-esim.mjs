#!/usr/bin/env node
// Translate each country's eSIM prose (intro / coverage / tips) into
// ko/ja/es/zh. Source of truth = data/esim-facts.json (English); output =
// src/i18n/esim-i18n.json keyed by country slug → lang.
//
// Freshness via srcHash: every country entry is stamped with a sha256 of its
// English prose. Editing any prose field in esim-facts.json changes the hash
// and re-queues all four languages on the next run — same contract as
// translate-posts.mjs srcHash. JSON storage on purpose: no YAML scalar traps
// (hex-that-looks-like-a-float, dates) to quote around.
//
//   node scripts/translate-esim.mjs           # fill missing / stale
//   node scripts/translate-esim.mjs --force   # re-translate everything
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { findToolSpill } from './lib/tool-spill.mjs';

const FACTS = fileURLToPath(new URL('../data/esim-facts.json', import.meta.url));
const OUT = fileURLToPath(new URL('../src/i18n/esim-i18n.json', import.meta.url));
const LANGS = ['ko', 'ja', 'es', 'zh'];
const LANG_NAME = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const FORCE = process.argv.includes('--force');

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }
const client = new Anthropic();

const facts = JSON.parse(await readFile(FACTS, 'utf8'));
const table = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : {};

// Hash NORMALIZED prose (the fields we translate, joined with \n) so a
// carriers edit or key reordering doesn't needlessly re-queue translations.
const srcHash = (f) => createHash('sha256')
  .update([f.intro, f.coverage, ...f.tips].join('\n'), 'utf8')
  .digest('hex').slice(0, 16);

const TOOL = {
  name: 'submit_translation',
  description: 'Return the translated eSIM guide prose.',
  input_schema: {
    type: 'object',
    properties: {
      intro: { type: 'string' },
      coverage: { type: 'string' },
      tips: { type: 'array', items: { type: 'string' } },
    },
    required: ['intro', 'coverage', 'tips'],
  },
};

const prompt = (langName, country, f) => `Translate this English travel-connectivity prose about ${country} into ${langName} for a travel guide website.

RULES
- Natural, fluent ${langName} that reads like it was written in ${langName} — translate meaning, not word-for-word.
- KEEP AS-IS: carrier/brand names (NTT Docomo, AIS, Viettel, Grab, WiFi, eSIM, QR, SIM…), place names in their common local-audience form.
- Do NOT add, drop or soften any fact. No prices — the source deliberately has none.
- tips: translate each item, same order, same count (${f.tips.length}).

intro: ${f.intro}

coverage: ${f.coverage}

tips:
${f.tips.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

let done = 0, skipped = 0, failed = 0;
for (const [slug, f] of Object.entries(facts)) {
  if (slug.startsWith('_')) continue;
  const hash = srcHash(f);
  const entry = table[slug] ?? {};
  const stale = entry._srcHash && entry._srcHash !== hash;
  const todo = FORCE || stale ? LANGS : LANGS.filter((l) => !entry[l]);
  if (!todo.length) { skipped++; continue; }
  if (stale) {
    console.log(`  ~ ${slug}: source changed, re-translating all languages`);
    // Drop the old translations first. The hash is stamped below whether or
    // not every language succeeded, so a language that failed here used to
    // keep its OUTDATED prose under the NEW hash — fresh forever (2026-09-02).
    // Absent, it is simply picked up by the next run.
    for (const l of LANGS) delete entry[l];
  }

  for (const lang of todo) {
    try {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 3000,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'submit_translation' },
        messages: [{ role: 'user', content: prompt(LANG_NAME[lang], f.name, f) }],
      });
      const out = msg.content.find((b) => b.type === 'tool_use')?.input;
      if (!out?.intro || !out?.coverage || out?.tips?.length !== f.tips.length) {
        throw new Error('incomplete translation');
      }
      // The model can close one field and open the next in XML *inside* a
      // value (2026-09-05, essentials topics ko) — the text is then wrong and
      // the following key is lost. Never keep such a reply.
      const spill = findToolSpill(out);
      if (spill.length) throw new Error(`tool-call spill in ${spill.join(', ')}`);
      entry[lang] = { intro: out.intro, coverage: out.coverage, tips: out.tips };
      done++;
      console.log(`  OK ${slug}/${lang}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${slug}/${lang} — ${String(e.message).slice(0, 120)}`);
    }
  }
  entry._srcHash = hash;
  table[slug] = entry;
  // Write after every country so a crash loses at most one country's work.
  await writeFile(OUT, JSON.stringify(table, null, 2) + '\n', 'utf8');
}
console.log(`\nDone. ${done} translated, ${skipped} country(ies) already fresh, ${failed} failed.`);
if (failed) process.exitCode = 1;
