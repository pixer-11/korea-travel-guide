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
// Every language a hub renders in. getRegionInfo() falls back to English per
// language, so a gap here is an English paragraph on a localized page.
const LANGS = ['ko', 'ja', 'es', 'zh'];

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
// ONE language per call. Asking for all four in a single tool call put three
// intros' worth of CJK text in one response, which ran into max_tokens and
// truncated the tool arguments — always at the last property in the schema,
// which was `zh`. The partial object parsed fine, so the script reported
// "✅ added" while Chinese silently never arrived: 16 city hubs sat that way
// until someone read a page (found 2026-08-06). Per-language calls also mean a
// failure costs one language, not four.
const submitTranslationTool = {
  name: 'submit_translation',
  description: 'Submit the translated intro',
  input_schema: { type: 'object', properties: INTRO_PROPS, required: ['blurb', 'getting', 'days'] },
};
const LANG_NAMES = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const toolArgs = (msg, name) => {
  // A truncated response can still carry a parseable-but-incomplete tool call.
  // Treat that as a failure so the caller retries instead of storing half a
  // translation as if it were whole.
  if (msg.stop_reason === 'max_tokens') throw new Error('response hit max_tokens — output truncated');
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

async function translateOne(region, en, lang) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [submitTranslationTool],
    tool_choice: { type: 'tool', name: 'submit_translation' },
    messages: [{
      role: 'user',
      content:
        `Translate this travel-hub intro for ${region} into ${LANG_NAMES[lang]}. ` +
        `Native-quality (not literal); keep airport codes/proper nouns. Call submit_translation.\n\n` +
        JSON.stringify(en),
    }],
  });
  // Same guard as the English path: a missing or literal-"undefined" field must
  // not be stored, or it renders as that word on the localized page.
  const fields = toolArgs(msg, 'submit_translation') || {};
  const kept = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => {
      const t = typeof v === 'string' ? v.trim() : '';
      return t && t !== 'undefined' && t !== 'null';
    })
  );
  // A partial translation is worse than none: the page would mix languages
  // field by field. All three or nothing.
  if (!kept.blurb || !kept.getting || !kept.days) throw new Error(`${lang}: incomplete translation`);
  return kept;
}

/** Translations for the requested languages; a language that fails is absent. */
async function translate(region, en, langs) {
  const out = {};
  const results = await Promise.all(
    langs.map((lang) => translateOne(region, en, lang).then((v) => [lang, v], (e) => [lang, null, e])),
  );
  for (const [lang, value, err] of results) {
    if (value) out[lang] = value;
    else console.log(`     ⚠️  ${region}/${lang}: ${String(err?.message ?? 'failed').slice(0, 80)}`);
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

  // Resume per LANGUAGE, not per region. Skipping any region that had an `en`
  // entry meant a region whose translation call returned three of four
  // languages stayed three-of-four forever: 19 city hubs rendered an English
  // intro to their Chinese readers, and re-running this script reported
  // "0 regions to fill" every time (found 2026-08-06). The curated six are
  // still never regenerated — their English lives in regions.ts — but their
  // translations are stored here like everyone else's, so they are checked too.
  const missingLangs = (r) => LANGS.filter((l) => !store[r]?.[l]);
  const todo = [...regions.entries()]
    .map(([region, country]) => ({
      region,
      country,
      needsEnglish: !CURATED.has(region) && !store[region]?.en,
      langs: missingLangs(region),
    }))
    // A curated region has no `en` in the store by design, so "needs English"
    // is false for it; it only appears here when a translation is missing.
    .filter((x) => x.needsEnglish || (x.langs.length && (store[x.region]?.en || CURATED.has(x.region))))
    .slice(0, LIMIT);

  const fresh = todo.filter((x) => x.needsEnglish).length;
  console.log(`\n🏙️  Region intros — ${todo.length} region(s) to fill (${fresh} new, ${todo.length - fresh} missing translations only) of ${regions.size} total${DRY ? ' (DRY)' : ''}\n`);
  if (DRY) { todo.forEach((x) => console.log(`   ${x.region}: ${x.needsEnglish ? 'EN + all' : x.langs.join(', ')}`)); return; }
  if (!todo.length) return;

  let done = 0, failed = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const { region, country, needsEnglish } = item;
      try {
        // The curated six keep their English in regions.ts; everyone else uses
        // what is stored (or is generated now).
        const en = needsEnglish ? await genEnglish(region, country) : store[region]?.en;
        // A curated region's English lives in regions.ts, which this script
        // never reads — report it rather than inventing a second source.
        if (!en) throw new Error('English source is in regions.ts — translate it by hand');
        // A brand-new region needs all four; an existing one only its gaps.
        const wanted = needsEnglish ? LANGS : item.langs;
        const tr = await translate(region, en, wanted);
        // Merge, never replace: a language that already had a translation keeps
        // it, so a retry can't overwrite good text with a worse second pass.
        const before = store[region] ?? {};
        const merged = { ...before, ...(needsEnglish ? { en } : {}) };
        for (const lang of wanted) if (tr[lang]) merged[lang] = tr[lang];
        store[region] = merged;
        done++;
        // Report what actually landed, not what was attempted — the old line
        // said "✅ added" for languages that never arrived.
        const got = wanted.filter((l) => merged[l]);
        const short = wanted.filter((l) => !merged[l]);
        console.log(`  ${short.length ? '⚠️ ' : '✅'} ${region}, ${country} (${got.join(', ') || 'none'})${short.length ? ` — still missing ${short.join(', ')}` : ''}`);
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
