// Build data/essentials-facts.json — the cards, table and grids on each
// country's essentials page (2026-09-30 redesign), extracted ONLY from that
// country's reviewed English guide and then translated to ko/ja/es/zh.
//
// Every card is vetted in lib/essentials-facts.mjs: a number, name or month the
// guide does not state drops the card, and the page falls back to the prose.
// A country is rebuilt only when its English guide changed (bodyHash), so the
// monthly refresh-essentials run and a new country's first guide both land
// here with no extra wiring beyond the step that calls this script.
//
//   node scripts/build-essentials-facts.mjs                 # missing + stale
//   node scripts/build-essentials-facts.mjs --only=australia
//   node scripts/build-essentials-facts.mjs --force --dry   # print, write nothing
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import './lib/claude-meter.mjs'; // counts this file's Claude spend into the cost ledger
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { findToolSpill } from './lib/tool-spill.mjs';
import { vetFacts, bodyHash, translationProblems, withStructureFrom, textView, normalizeToolOutput, pruneProblems } from './lib/essentials-facts.mjs';

const SRC = fileURLToPath(new URL('../src/content/essentials/', import.meta.url));
const OUT = fileURLToPath(new URL('../data/essentials-facts.json', import.meta.url));
const MODEL = process.env.ESSENTIALS_FACTS_MODEL || 'claude-sonnet-5';
const LANGS = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const ONLY = (arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry');
const RETRY_FAILED = process.argv.includes('--retry-failed');
const CONCURRENCY = Number(process.env.ESSENTIALS_FACTS_CONCURRENCY || 4);

// The payload travels as ONE JSON string. A deep tool schema came back in a
// different shape on each call (nested under "facts", fields missing, arrays
// as maps — Australia, three runs, 2026-09-30); a single string field with the
// shape spelled out in the prompt is read the same way every time.
const JSON_TOOL = (name, description) => ({
  name,
  description,
  input_schema: { type: 'object', properties: { json: { type: 'string', description: 'The JSON document, exactly as specified.' } }, required: ['json'] },
});
const EXTRACT = JSON_TOOL('submit_facts', 'Structured facts taken from the guide, as one JSON document.');
const EXTRACT_KEYS = ['summary', 'visa', 'transport', 'money', 'season', 'emergency'];

const SHAPE = `{
  "summary": [                       // exactly 4, in this order
    { "key": "entry",     "title": "…", "sub": "…" },
    { "key": "money",     "title": "…", "sub": "…" },
    { "key": "season",    "title": "…", "sub": "…" },
    { "key": "transport", "title": "…", "sub": "…" }
  ],                                  // title: the single most useful fact, 2–5 words, max 28 chars; sub: one detail, max 60 chars
  "visa": {
    "cards": [ { "name": "", "code": "", "who": "", "cost": "", "stay": "", "note": "" } ],   // distinct routes for short visits, max 4; code = subclass/form code only (e.g. "601") or ""; who ≤ 70 chars; cost ≤ 30 chars (e.g. "AUD 20 app fee", "Free"); stay ≤ 30 chars (e.g. "3 months per visit"); note ≤ 90 chars
    "warnings": [ { "title": "2–5 words", "text": "one sentence" } ]                            // explicit warnings (scams, overstay), max 3
  },
  "transport": {
    "rows": [ { "city": "", "card": "", "contactless": "yes|soon|no|" } ],   // ONLY if the guide names a transit card per city; else []
    "tips": [ { "title": "", "text": "" } ]                                  // max 3
  },
  "money": {
    "budget": { "amount": "AUD 220–380", "label": "", "note": "" },   // ONLY a whole-trip daily budget per person (lodging+food+getting around) the guide states; a single category (transport, meals, cash on hand) is NOT a budget → null
    "tips": [ { "title": "", "text": "" } ]                          // max 4
  },
  "season": {
    "best": [3, 4, 5],                                               // months the guide names as best overall; [] if none named
    "rows": [ { "label": "", "sub": "", "best": [5, 6], "busy": [12, 1], "avoid": [2, 3] } ]   // per region/activity the guide distinguishes, max 5. best = named as best; busy = named as good but peak/crowded/very hot; avoid = named as a poor time (wet season, cyclones, too cold). Months the guide does not characterise go in none of the three.
  },
  "emergency": {
    "numbers": [ { "number": "000", "label": "", "note": "" } ],   // max 4, most important first
    "chips": [ "very short safety reminder" ]                     // max 5, max 40 chars each
  }
}`;

function extractPrompt(country, body) {
  return `Below is our reviewed "travel essentials" guide for ${country}. Call submit_facts with ONE JSON document (no comments) in exactly this shape:

${SHAPE}

RULES
- Use ONLY facts stated in the guide. Nothing from your own knowledge — no extra cities, fees, months or numbers.
- Copy numbers, currency amounts, codes and names exactly as the guide writes them.
- If the guide does not state something: "" for a string, [] for a list, null for budget. An empty card is correct; a guessed one is a defect.
- Months are integers 1–12, only months the guide names ("May to October" → 5,6,7,8,9,10). Never infer months from "shoulder season" alone.
- Plain, short, factual English. No marketing words.

GUIDE
${body}`;
}

const TRANSLATE = JSON_TOOL('submit_translations', 'The same JSON translated into ko, ja, es and zh, as one JSON document { "ko": …, "ja": …, "es": …, "zh": … }.');

function translatePrompt(country, json) {
  return `Translate every string value of this JSON (cards for the ${country} travel essentials page) into Korean (ko), Japanese (ja), Spanish (es) and Simplified Chinese (zh). Call submit_translations with ONE JSON document { "ko": {…}, "ja": {…}, "es": {…}, "zh": {…} } — each with EXACTLY the same structure, keys, array lengths and order as the input.

RULES
- Keep every number as Arabic digits exactly as written (000, 112, AUD 20, 220–380). Never write numbers as words or CJK numerals.
- Keep codes, card and brand names as written (Opal, Myki, ETA, eVisitor); city and country names in the established local form.
- Short, natural card text. Do not add or drop information. null stays null.

JSON
${JSON.stringify(json, null, 2)}`;
}

const client = DRY && !process.env.ANTHROPIC_API_KEY ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 6 });

async function callTool(tool, content, maxTokens) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    // sonnet-5 thinks unless told not to, and the thinking eats the budget the
    // tool call needed (api-limit-and-model-traps).
    thinking: { type: 'disabled' },
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content }],
  });
  if (msg.stop_reason === 'max_tokens') throw new Error('hit the token ceiling');
  const input = msg.content.find((c) => c.type === 'tool_use')?.input;
  if (!input) throw new Error('no tool call');
  const spill = findToolSpill(input);
  if (spill.length) throw new Error(`tool-call spill in ${spill.join(', ')}`);
  const text = typeof input.json === 'string' ? input.json : JSON.stringify(input);
  try { return JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, '')); } catch (e) { throw new Error(`reply was not JSON: ${e.message}`); }
}

async function main() {
  const store = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : { countries: {} };
  store.countries ??= {};
  const files = (await readdir(SRC)).filter((f) => f.endsWith('.md'));
  let built = 0, skipped = 0, failed = 0;
  // Written after every country, not once at the end: a run that dies half
  // way keeps what it paid for. Chained so parallel workers never interleave.
  let writing = Promise.resolve();
  const save = () => {
    if (DRY) return Promise.resolve();
    writing = writing.then(() => {
      const sorted = { countries: Object.fromEntries(Object.entries(store.countries).sort(([a], [b]) => a.localeCompare(b))) };
      return writeFile(OUT, JSON.stringify(sorted, null, 2) + '\n');
    });
    return writing;
  };
  const one = async (f) => {
    const slug = f.replace(/\.md$/, '');
    if (ONLY.length && !ONLY.includes(slug)) return;
    const raw = (await readFile(SRC + f, 'utf8')).replace(/\r\n/g, '\n');
    const end = raw.indexOf('\n---', 3);
    const fm = yaml.load(raw.slice(4, end));
    if (fm.draft) return;
    const body = raw.slice(end + 4).trim();
    const hash = bodyHash(body);
    const have = store.countries[fm.country];
    const current = !FORCE && have?.srcHash === hash && have.en;
    // null = "tried, that language shows its prose". Retried only on request:
    // retrying every run would bill the same failure every day.
    const failedLangs = current ? Object.keys(LANGS).filter((l) => have[l] === undefined || (RETRY_FAILED && have[l] === null)) : [];
    if (current && !failedLangs.length) { skipped++; return; }
    try {
      let facts, dropped = [], extracted = null;
      if (current) {
        // The English facts are still true to the guide — translate only.
        facts = have.en;
        console.log(`  ${fm.country}: re-translating ${failedLangs.join(', ')}`);
      } else {
        extracted = normalizeToolOutput(await callTool(EXTRACT, extractPrompt(fm.country, body), 6000), EXTRACT_KEYS);
        ({ facts, dropped } = vetFacts(extracted, body));
      }
      // Nothing at all survived: that is a reply we could not read, not a guide
      // with nothing in it. Refuse it rather than store an empty page.
      if (!current && !facts.summary.length && !facts.emergency.numbers.length && !facts.visa.cards.length) {
        throw new Error(`unreadable extraction (top-level keys: ${Object.keys(extracted || {}).join(', ') || 'none'})`);
      }
      if (!current) {
      const kept = [facts.summary.length, facts.visa.cards.length, facts.transport.rows.length, facts.money.budget ? 1 : 0, facts.season.rows.length, facts.emergency.numbers.length];
      console.log(`  ${fm.country}: summary ${kept[0]} · visa ${kept[1]} · transit ${kept[2]} · budget ${kept[3]} · season ${kept[4]} · emergency ${kept[5]}${dropped.length ? ` · dropped ${dropped.length}` : ''}`);
      for (const d of dropped) console.log(`     ✗ ${fm.country} ${d}`);
      }
      const entry = current ? { ...have } : { srcHash: hash, en: facts };
      // Saved before translating: a translation that fails must not throw away
      // an extraction already paid for. The next run finds `en` current and
      // translates only (review, 2026-09-30 — both calls were re-billed).
      store.countries[fm.country] = entry;
      await save();
      const view = textView(facts);
      const tr = normalizeToolOutput(await callTool(TRANSLATE, translatePrompt(fm.country, view), 12000), Object.keys(LANGS));
      for (const lang of Object.keys(LANGS)) {
        if (current && !failedLangs.includes(lang)) continue;
        const problems = tr[lang] ? translationProblems(view, tr[lang]) : ['missing'];
        if (!problems.length) {
          entry[lang] = withStructureFrom(facts, tr[lang]);
          continue;
        }
        // Prune just the cards the translation got wrong; only a structural
        // failure costs the language its facts (lib/essentials-facts pruneProblems).
        const pruned = pruneProblems(facts, tr[lang], problems);
        if (pruned) {
          entry[lang] = withStructureFrom(pruned.en, pruned.tr);
          console.log(`     ~ ${fm.country} ${lang}: pruned ${problems.length} (${problems.slice(0, 2).join(' | ')})`);
        } else {
          // null, not absent: "we tried and this language shows its prose".
          entry[lang] = null;
          console.log(`     ✗ ${fm.country} ${lang}: ${problems.slice(0, 3).join(' | ')}`);
        }
      }
      store.countries[fm.country] = entry;
      await save();
      built++;
    } catch (e) {
      failed++;
      console.log(`  ⚠️  ${fm.country}: ${e.message}`);
      if (e.stack) console.log(e.stack.split('\n').slice(1, 3).join('\n'));
    }
  };
  // Four countries at a time: one by one, 21 guides took over 40 minutes.
  const queue = [...files];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await one(queue.shift()); }));
  await save();
  console.log(`ESSENTIALS_FACTS built=${built} skipped=${skipped} failed=${failed}${DRY ? ' (dry)' : ''}`);
  if (failed) process.exitCode = 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
