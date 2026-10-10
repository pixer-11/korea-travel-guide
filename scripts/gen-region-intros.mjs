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
import { thinkingOff } from './lib/thinking.mjs'; // reasoning off for a mechanical call (2026-10-05)
import './lib/env.mjs';
import { HOUSE_STYLE } from './lib/prose-style.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import matter from 'gray-matter';
import Anthropic from '@anthropic-ai/sdk';
import './lib/claude-meter.mjs'; // counts this file's Claude spend into the cost ledger
import { findToolSpill, stripCitations } from './lib/tool-spill.mjs';
import { runBatch, batchWaitMin } from './lib/claude-batch.mjs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 6 });
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

// `pre`: the reply to englishParams(region, country) a batch already fetched.
async function genEnglish(region, country, pre = null) {
  const msg = pre || await client.messages.create(englishParams(region, country));
  return parseEnglish(msg);
}

function englishParams(region, country) {
  return {
    model: MODEL, ...thinkingOff(MODEL),
    // Same budget lesson as the organizer backfill (2026-08-25).
    max_tokens: 1600,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, submitIntroTool],
    messages: [{
      role: 'user',
      content:
        `${HOUSE_STYLE}\n\n` +
        `Write the intro fact-box for the travel hub page of ${region}, ${country}. ` +
        `Use web search to VERIFY transport facts (main airport code / rail line / typical access route). ` +
        `Accuracy rules — this site's #1 rule is factual accuracy: name airports/stations ONLY if verified; ` +
        `durations approximate with "~"; NEVER invent schedules, prices, or specific bus numbers; ` +
        `if access details are uncertain, describe the generic reliable route (e.g. "buses from the regional hub"). ` +
        `When done, call submit_intro with: blurb (2 sentences, what makes ${region} distinct, vivid but factual), ` +
        `getting (1-2 sentences, how travellers actually reach it), days (1 sentence, how many days and what that covers).`,
    }],
  };
}

function parseEnglish(msg) {
  const j = toolArgs(msg, 'submit_intro');
  // String(undefined) is the string "undefined", and that is exactly how the word
  // reached 11 live region pages — in the visible intro, the meta description AND
  // the FAQPage structured data. A field the model omitted must come back absent
  // so the page falls back, never as text that renders.
  const clean = (v) => {
    const s = typeof v === 'string' ? stripCitations(v).trim() : '';
    return s && s !== 'undefined' && s !== 'null' ? s : null;
  };
  const out = { blurb: clean(j.blurb), getting: clean(j.getting), days: clean(j.days) };
  // The whole reply written as JSON into one field printed `","getting":"`
  // mid-paragraph on 45 region pages (2026-10-01): refuse it, the caller retries.
  if (findToolSpill(out).length) throw new Error(`tool spill in ${findToolSpill(out).join(', ')}`);
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

// `pre`: the reply to translationParams(region, en, lang) a batch already fetched.
async function translateOne(region, en, lang, pre = null) {
  const msg = pre || await client.messages.create(translationParams(region, en, lang));
  return parseTranslation(msg, en, lang);
}

function translationParams(region, en, lang) {
  return {
    model: MODEL, ...thinkingOff(MODEL),
    max_tokens: 1500,
    tools: [submitTranslationTool],
    tool_choice: { type: 'tool', name: 'submit_translation' },
    messages: [{
      role: 'user',
      content:
        `Translate this travel-hub intro for ${region} into ${LANG_NAMES[lang]}. ` +
        `Native-quality (not literal); keep airport codes/proper nouns. ` +
        `Put each section in its own field of submit_translation (blurb, getting, days) as plain text.\n\n` +
        // Labelled sections, not JSON.stringify(en): shown JSON, the model wrote
        // JSON back INTO the blurb field — 6 of 9 Korean replies for Leipzig,
        // Puerto Vallarta and Zaragoza, which left those hubs without Korean for
        // days. Labelled, 0 of 9 (measured 2026-10-05).
        Object.entries(en).map(([k, v]) => `${k.toUpperCase()}:\n${v}`).join('\n\n'),
    }],
  };
}

function parseTranslation(msg, en, lang) {
  // Same guard as the English path: a missing or literal-"undefined" field must
  // not be stored, or it renders as that word on the localized page.
  const fields = toolArgs(msg, 'submit_translation') || {};
  const kept = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? stripCitations(v) : v]).filter(([, v]) => {
      const t = typeof v === 'string' ? v.trim() : '';
      return t && t !== 'undefined' && t !== 'null';
    })
  );
  // Only the fields the English HAS. The tool asks for all three, so where the
  // English had no "days" the model wrote one anyway: "미정", "<UNKNOWN>", a
  // heading ("고양 가는 방법"), or an invented "3~4일" for Bilbao — 59 values,
  // live on /ko/regions/johor-bahru (owner review pass, 2026-10-01).
  for (const k of Object.keys(kept)) if (!(typeof en[k] === 'string' && en[k].trim())) delete kept[k];
  // A partial translation is worse than none: the page would mix languages
  // field by field. Every field the English has, or nothing.
  const want = ['blurb', 'getting', 'days'].filter((k) => typeof en[k] === 'string' && en[k].trim());
  if (!want.length || want.some((k) => !kept[k])) throw new Error(`${lang}: incomplete translation`);
  // A stub is not a translation: Bacolod.zh said "describes here" in all three.
  const stub = /^(placeholder|describes here|<?unknown>?|tbd|n\/a|미정|未定|待定|por (determinar|confirmar))$/i;
  // No length floor: "建议住两晚。" is a whole answer in six characters (Codex review).
  if (want.some((k) => stub.test(String(kept[k]).trim()))) throw new Error(`${lang}: stub translation`);
  if (findToolSpill(kept).length) throw new Error(`${lang}: tool spill in ${findToolSpill(kept).join(', ')}`);
  return kept;
}

/**
 * Translations for the requested languages; a language that fails is absent.
 * Each language gets three tries in the same run: the failures (an incomplete
 * reply, a stub, a tool spill) are stochastic by this file's own account, but
 * one try a day left Leipzig without Korean from 10-02 to 10-05.
 */
async function translate(region, en, langs, pre = new Map()) {
  const out = {};
  const tryLang = async (lang) => {
    let last;
    for (let i = 0; i < 3; i++) {
      // The first try may already be back from the batch; retries ask directly.
      try { return [lang, await translateOne(region, en, lang, i === 0 ? pre.get(`${region}|${lang}`) ?? null : null)]; } catch (e) { last = e; }
    }
    return [lang, null, last];
  };
  const results = await Promise.all(langs.map(tryLang));
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
      // A placeholder region is not a place; writing an intro for it invents a
      // travel guide for somewhere that does not exist ("Multiple cities"
      // rendered as a Korean hub titled "여러 도시" with a fabricated Spain
      // itinerary blurb — owner-caught 2026-08-09). validate-content now
      // blocks these at the gate; this guard covers pre-existing posts.
      if (/^(multiple|various|several|nationwide|citywide|tba|tbd|unknown)\b/i.test(String(data.region).trim())) continue;
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

  // ── first requests through the Message Batches API (half price) ──
  // 2026-10-10: every intro went out at full price. Now the new regions'
  // English drafts go out as one batch, then every wanted translation as a
  // second; each request is byte-for-byte the direct one, and whatever a batch
  // does not return within its cap is asked directly in the loop below, as
  // before (a failed English reply is asked again there too). INTROS_BATCH=0
  // is the old path.
  // The wait is re-read before each batch and is 0 when the job has no time
  // for one (this runs after the translation step; lib/claude-batch batchWaitMin).
  const useBatch = process.env.INTROS_BATCH !== '0';
  const waitMin = () => (useBatch ? batchWaitMin(Number(process.env.INTROS_BATCH_WAIT_MIN || 20)) : 0);
  const enOf = new Map();
  let preTr = new Map();
  const w0 = waitMin();
  if (w0) {
    const asks = todo.filter((x) => x.needsEnglish).map((x) => ({ id: x.region, params: englishParams(x.region, x.country) }));
    for (const [region, msg] of await runBatch(client, asks, { waitMin: w0 })) {
      try { enOf.set(region, parseEnglish(msg)); } catch (e) { console.log(`  (batched English for ${region} unusable: ${String(e.message).slice(0, 60)}; asking directly)`); }
    }
    const trAsks = [];
    for (const x of todo) {
      const en = x.needsEnglish ? enOf.get(x.region) : store[x.region]?.en;
      if (!en) continue;
      for (const lang of x.needsEnglish ? LANGS : x.langs) {
        trAsks.push({ id: `${x.region}|${lang}`, params: translationParams(x.region, en, lang) });
      }
    }
    const w = waitMin();
    if (w) preTr = await runBatch(client, trAsks, { waitMin: w });
  }

  let done = 0, failed = 0, short = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const { region, country, needsEnglish } = item;
      try {
        // The curated six keep their English in regions.ts; everyone else uses
        // what is stored (or is generated now).
        const en = needsEnglish ? enOf.get(region) ?? await genEnglish(region, country) : store[region]?.en;
        // A curated region's English lives in regions.ts, which this script
        // never reads — report it rather than inventing a second source.
        if (!en) throw new Error('English source is in regions.ts — translate it by hand');
        // A brand-new region needs all four; an existing one only its gaps.
        const wanted = needsEnglish ? LANGS : item.langs;
        // A translation batched against English this loop then replaced (the
        // batched English failed and was asked again) would not match it.
        const tr = await translate(region, en, wanted, en === (needsEnglish ? enOf.get(region) : store[region]?.en) ? preTr : new Map());
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
        const missing = wanted.filter((l) => !merged[l]);
        if (missing.length) short++;
        console.log(`  ${missing.length ? '⚠️ ' : '✅'} ${region}, ${country} (${got.join(', ') || 'none'})${missing.length ? ` — still missing ${missing.join(', ')}` : ''}`);
      } catch (e) {
        failed++;
        console.log(`  ⚠️  ${region}: ${e.message.slice(0, 90)}`);
      }
    }
  }));

  // Single atomic write at the end (workers share `store` in-process).
  await writeFile(JSON_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');
  console.log(`\n📦 ${done} added · ${failed} failed · ${short} still short a language → ${JSON_PATH}`);
  // A region left without a language shows its English blurb and meta
  // description on that language's hub. This used to exit 0, so publish.yml's
  // soft-fail line ("지역 소개") never fired and nobody heard (2026-10-05).
  if (failed || short) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
