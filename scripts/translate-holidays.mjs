#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  HOLIDAY NAME GLOSSES — fills src/i18n/holidays.json so a Korean,
//  Japanese, Spanish or Chinese reader never meets an English holiday name.
//
//  src/i18n/holidays.ts states the contract in its own comment: "Never English
//  on a localized page." It was violated on 350 of 585 holidays, because that
//  table was hand-typed, had no generator, and appeared in no workflow — so
//  every country added since it was written arrived uncovered. Measured live
//  2026-08-07: /ko/tools/when-to-go/singapore/august/ printed "National Day",
//  Taiwan's February printed "Farmer's Day · Lunar New Year Holiday · Peace
//  Memorial Day Holiday". India was the worst at 90 rows.
//
//  The reason nothing caught it is worth keeping: audit-i18n-leaks.mjs builds
//  its detection regex FROM this same file and only matches text following the
//  "·" separator — the exact character that is absent when a gloss is missing.
//  A checker derived from the incomplete table cannot see what the table lacks.
//
//  Deleting the English instead of translating it was the other option and is
//  worse: an empty holidays section reads as "no public holidays this month",
//  which is a wrong answer rather than an untranslated one.
//
//  Usage:
//    node scripts/translate-holidays.mjs              # fill what's missing
//    node scripts/translate-holidays.mjs --force      # redo everything
//    node scripts/translate-holidays.mjs --dry-run    # report, write nothing
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findToolSpill } from './lib/tool-spill.mjs';

const OUT = fileURLToPath(new URL('../src/i18n/holidays.json', import.meta.url));
const FACTS = fileURLToPath(new URL('../data/country-facts.json', import.meta.url));
const LANGS = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry-run');
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
// 12, not 25. At 25 the model returned fewer rows than it was given and the
// tail came back null — 50 rows reported "translated" while only some were
// written, and the run said nothing about it. Smaller batches finish inside the
// token budget, and shortReturn below now makes any shortfall visible.
const BATCH = 12;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOL = {
  name: 'submit_holidays',
  description: 'Return the localized holiday names.',
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

async function translateBatch(langName, rows) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_holidays' },
    messages: [{
      role: 'user',
      content:
        `Give the name a ${langName} reader would recognise for each of these PUBLIC HOLIDAYS. ` +
        `The country is given because the same English words mean different days in different places.\n\n` +
        `RULES\n` +
        `- Use the established ${langName} name where one exists. Chinese New Year in Singapore is the ` +
        `same festival Chinese readers already have a word for; do not invent a new one.\n` +
        `- A religious or cultural holiday that ${langName} readers know by a borrowed name keeps that ` +
        `borrowed name (Diwali, Eid, Vesak, Songkran) — transliterate into the target script rather than ` +
        `translating the words literally.\n` +
        `- Keep it a NAME. No explanation, no dates, no "the festival of".\n` +
        `- Drop administrative padding that means nothing to a traveller: "(regional holiday)", ` +
        `"Holiday", "Observed", "Day off for". Translate the holiday itself.\n` +
        `- Do not append the English original in parentheses. The page already prints the local-language ` +
        `name next to this one.\n` +
        `- Same order, same count, one line each.\n\n` +
        rows.map((r, i) => `${i + 1}. [${r.country}] ${r.name}`).join('\n'),
    }],
  });
  const out = msg.content.find((c) => c.type === 'tool_use')?.input;
  // The model can close one field and open the next in XML *inside* a value
  // (2026-09-05, essentials topics ko). Drop those rows — the short tail
  // retries next run, exactly like a name the model never returned.
  const list = (Array.isArray(out?.names) ? out.names : []).filter((r) => {
    if (!findToolSpill(r).length) return true;
    console.warn(`    ⚠ tool-call spill in "${String(r?.en || '').slice(0, 40)}" — dropped, retries next run`);
    return false;
  });
  if (list.length < rows.length) {
    console.warn(`    ⚠ asked for ${rows.length}, got ${list.length} (stop_reason: ${msg.stop_reason}) — the short tail retries next run`);
  }
  const byEn = new Map(list.map((r) => [String(r.en || '').trim(), String(r.translated || '').trim()]));
  // Position is the fallback, never a silent mispairing: the model sometimes
  // echoes `en` with the country prefix attached.
  return rows.map((r, i) => byEn.get(r.name) || String(list[i]?.translated || '').trim() || null);
}

const gloss = JSON.parse(await readFile(OUT, 'utf8'));
const facts = JSON.parse(await readFile(FACTS, 'utf8')).countries ?? {};

// One row per (country, holiday) that any localized page can print.
const seen = new Set();
const wanted = [];
for (const [country, data] of Object.entries(facts)) {
  for (const h of data.holidays ?? []) {
    const name = String(h.name ?? '').trim();
    if (!name) continue;
    const key = `${country}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A row counts as done only when EVERY language has it. Testing for the row
    // itself let a partially-filled entry look finished: one Korean batch failed
    // on the first run, and because the other three languages had written the
    // key, the re-run skipped all 25 rows and reported nothing left to do.
    if (!FORCE && gloss[key] && Object.keys(LANGS).every((l) => String(gloss[key][l] ?? '').trim())) continue;
    // A local name in a non-Latin script already reads correctly to a CJK
    // audience next to its gloss; the urgent rows are the ones where the
    // "local" name IS English and a missing gloss means English on the page.
    const local = String(h.localName ?? name);
    wanted.push({ country, name, key, urgent: !/[^\x00-\x7F]/.test(local) });
  }
}

console.log(`${seen.size} holiday rows live · ${Object.keys(gloss).length} already glossed · ${wanted.length} to translate (${wanted.filter((w) => w.urgent).length} currently showing English)`);
if (!wanted.length) { console.log('nothing to do'); process.exit(0); }

if (DRY) {
  for (const w of wanted.slice(0, 20)) console.log(`  ${w.urgent ? '⚠️ ' : '   '}${w.key}`);
  if (wanted.length > 20) console.log(`  … and ${wanted.length - 20} more`);
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(1); }

let filled = 0;
for (const [code, langName] of Object.entries(LANGS)) {
  const todo = wanted.filter((w) => FORCE || !gloss[w.key]?.[code]);
  if (!todo.length) continue;
  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    let got;
    try {
      got = await translateBatch(langName, slice);
    } catch (err) {
      // A failed batch must not lose the batches already translated — the file
      // is written after every batch below, so the next run resumes here.
      console.error(`  ${code} batch ${i / BATCH + 1} failed: ${err.message}`);
      continue;
    }
    slice.forEach((w, j) => {
      const v = got[j];
      if (!v) return;
      (gloss[w.key] ??= {})[code] = v;
      filled++;
    });
    await writeFile(OUT, `${JSON.stringify(Object.fromEntries(Object.keys(gloss).sort().map((k) => [k, gloss[k]])), null, 2)}\n`, 'utf8');
    console.log(`  ${code}: ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
}

console.log(`\n🗓️  ${filled} gloss(es) written across ${Object.keys(LANGS).length} languages · ${Object.keys(gloss).length} rows total`);
