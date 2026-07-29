#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  REGION INTROS FOR EVERY CITY — the "가는 방법 / 얼마나 머물까" fact box
//  existed only for 6 hand-written Korean cities; this generates the same
//  quality intro (blurb / getting there / how long) for EVERY region that has
//  posts, web-search-grounded for transport facts, then native-quality
//  translations for ko/ja/es/zh. Resumable: regions already covered (the 6
//  curated ones in regions.ts or previous runs in regions.json) are skipped —
//  so it also auto-fills NEW cities when run after the daily publish.
//
//  ACCURACY RULES (site's #1 priority): airport/station names only when
//  certain (web-verified); approximate durations with "~"; NEVER invent
//  schedules/prices; generic-but-true beats specific-but-risky.
//
//  Env: ANTHROPIC_API_KEY. LIMIT (default all), CONCURRENCY (default 4), DRY=1.
//  Usage: node scripts/gen-region-intros.mjs
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import matter from 'gray-matter';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';
const JSON_PATH = 'src/i18n/regions.json';
const DRY = process.env.DRY === '1';
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);

// The 6 hand-curated cities live in regions.ts (REGION_INFO_EN) — never touch.
const CURATED = new Set(['Seoul', 'Busan', 'Jeju', 'Gyeongju', 'Incheon', 'Jeonju']);

// Forced-tool pattern → the API guarantees schema-valid JSON args (free-text
// JSON kept breaking on unescaped quotes inside values: 68/126 parse failures).
const INTRO_PROPS = {
  blurb: { type: 'string' }, getting: { type: 'string' }, days: { type: 'string' },
};
const submitIntroTool = {
  name: 'submit_intro',
  description: 'Submit the finished intro',
  input_schema: { type: 'object', properties: INTRO_PROPS, required: ['blurb', 'getting', 'days'] },
};
const submitTranslationsTool = {
  name: 'submit_translations',
  description: 'Submit all four translations',
  input_schema: {
    type: 'object',
    properties: Object.fromEntries(['ko', 'ja', 'es', 'zh'].map((l) => [l, {
      type: 'object', properties: INTRO_PROPS, required: ['blurb', 'getting', 'days'],
    }])),
    required: ['ko', 'ja', 'es', 'zh'],
  },
};
const toolArgs = (msg, name) => {
  const b = msg.content.find((b) => b.type === 'tool_use' && b.name === name);
  if (!b) throw new Error('no tool call in response');
  return b.input;
};

async function genEnglish(region, country) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, submitIntroTool],
    messages: [{
      role: 'user',
      content:
        `Write the intro fact-box for the travel hub page of ${region}, ${country}. ` +
        `Use web search to VERIFY transport facts (main airport code / rail line / typical access route). ` +
        `Accuracy rules — this site's #1 rule is factual accuracy: name airports/stations ONLY if verified; ` +
        `durations approximate with "~"; NEVER invent schedules, prices, or specific bus numbers; ` +
        `if access details are uncertain, describe the generic reliable route (e.g. "buses from the regional hub"). ` +
        `When done, call submit_intro with: blurb (2 sentences, what makes ${region} distinct, vivid but factual), ` +
        `getting (1-2 sentences, how travellers actually reach it), days (1 sentence, how many days and what that covers).`,
    }],
  });
  const j = toolArgs(msg, 'submit_intro');
  // String(undefined) is the string "undefined", and that is exactly how the word
  // reached 11 live region pages — in the visible intro, the meta description AND
  // the FAQPage structured data. A field the model omitted must come back absent
  // so the page falls back, never as text that renders.
  const clean = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s && s !== 'undefined' && s !== 'null' ? s : null;
  };
  const out = { blurb: clean(j.blurb), getting: clean(j.getting), days: clean(j.days) };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

async function translate(region, en) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2200,
    tools: [submitTranslationsTool],
    tool_choice: { type: 'tool', name: 'submit_translations' },
    messages: [{
      role: 'user',
      content:
        `Translate this travel-hub intro for ${region} into Korean, Japanese, Spanish and Simplified Chinese. ` +
        `Native-quality (not literal); keep airport codes/proper nouns. Call submit_translations with all four.\n\n` +
        JSON.stringify(en),
    }],
  });
  // Same guard as the English path: a missing or literal-"undefined" field must
  // not be stored, or it renders as that word on the localized page.
  const tr = toolArgs(msg, 'submit_translations') || {};
  const out = {};
  for (const [lang, fields] of Object.entries(tr)) {
    if (!fields || typeof fields !== 'object') continue;
    const kept = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => {
        const t = typeof v === 'string' ? v.trim() : '';
        return t && t !== 'undefined' && t !== 'null';
      })
    );
    if (Object.keys(kept).length) out[lang] = kept;
  }
  return out;
}

async function main() {
  // Regions (with country) that actually have live posts.
  const regions = new Map();
  for (const f of (await readdir('src/content/posts')).filter((f) => f.endsWith('.md'))) {
    try {
      const { data } = matter(await readFile(`src/content/posts/${f}`, 'utf8'));
      if (data.draft || !data.region) continue;
      regions.set(data.region, data.country ?? 'South Korea');
    } catch {}
  }

  const store = JSON.parse(await readFile(JSON_PATH, 'utf8'));
  const todo = [...regions.entries()]
    .filter(([r]) => !CURATED.has(r) && !store[r]?.en)
    .slice(0, LIMIT);
  console.log(`\n🏙️  Region intros — ${todo.length} region(s) to fill (of ${regions.size} total)${DRY ? ' (DRY)' : ''}\n`);
  if (DRY || !todo.length) return;

  let done = 0, failed = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const [region, country] = item;
      try {
        const en = await genEnglish(region, country);
        const tr = await translate(region, en);
        store[region] = { en, ...tr };
        done++;
        console.log(`  ✅ ${region}, ${country}`);
      } catch (e) {
        failed++;
        console.log(`  ⚠️  ${region}: ${e.message.slice(0, 90)}`);
      }
    }
  }));

  // Single atomic write at the end (workers share `store` in-process).
  await writeFile(JSON_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');
  console.log(`\n📦 ${done} added · ${failed} failed → ${JSON_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
