#!/usr/bin/env node
// Translate itinerary connective PROSE into ko/ja/es/zh with Claude, writing one
// file per language per itinerary to src/content/itineraries-i18n/<lang>/<id>.md.
//
// Only prose is translated (title, description, quickAnswer, faq, days[].label/
// intro, and each stop's "why" keyed by slug into `whys`). Hard facts — ratings,
// hours, coordinates, place names, dwell/walk numbers — are never in these
// files; they render from the English source itinerary (and the underlying
// posts) at page render time, so a translation can never contradict verified
// data.
//
// STALENESS / regen path: `sourceHash` mirrors the source's `stopsHash` at
// translation time. A target file is SKIPPED only when it already exists AND
// its sourceHash still matches the source's current stopsHash. A structural
// rebuild (new stopsHash) makes the existing translation stale and it gets
// re-translated. `--force` re-translates regardless of hash.
//
// rainWhys is always written as {} — the source itinerary files carry no rain
// prose (only rainSwapSlug), so there is nothing honest to translate there.
//
//   node scripts/translate-itineraries.mjs --limit=1 --lang=ko   # try 1 itinerary, one language
//   node scripts/translate-itineraries.mjs --lang=ko              # one language, everything missing/stale
//   node scripts/translate-itineraries.mjs                        # everything missing/stale
//   node scripts/translate-itineraries.mjs --force                 # re-translate existing
//   node scripts/translate-itineraries.mjs --source-dir=<d> --out-dir=<d>  # point at a fixture dir (tests)
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const DEFAULT_SOURCE_DIR = fileURLToPath(new URL('../src/content/itineraries/', import.meta.url));
const DEFAULT_OUT_DIR = fileURLToPath(new URL('../src/content/itineraries-i18n/', import.meta.url));
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const CONCURRENCY = Number(process.env.TRANSLATE_CONCURRENCY || 4);

const LANGS = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const LIMIT = Number(arg('limit') || 0) || Infinity;
const ONLY_LANG = arg('lang');
const FORCE = process.argv.includes('--force');
const SOURCE_DIR = arg('source-dir') ? resolve(process.cwd(), arg('source-dir')) : DEFAULT_SOURCE_DIR;
const OUT_DIR = arg('out-dir') ? resolve(process.cwd(), arg('out-dir')) : DEFAULT_OUT_DIR;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function parseFrontmatter(raw) {
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return null;
  try {
    return yaml.load(raw.slice(4, end));
  } catch {
    return null;
  }
}

// ── pure helpers (exported for tests) ───────────────────────────────────────

// Skip/stale decision: no existing translation, or its sourceHash no longer
// matches the source's current stopsHash -> (re)translate. --force always
// (re)translates. This is the ONLY place that decision is made.
export function needsTranslation(existingSourceHash, currentStopsHash, force) {
  if (force) return true;
  if (!existingSourceHash) return true;
  return existingSourceHash !== currentStopsHash;
}

// Union of every stop slug across all days of a source itinerary array.
export function stopSlugSet(itineraryArr) {
  return new Set((itineraryArr || []).flatMap((d) => (d.stops || []).map((s) => s.slug)));
}

// Ordered [{slug, why}] pairs (first occurrence order) — feeds the prompt and
// the post-call validation. Itinerary slugs are already unique per the build
// gate (DUPLICATE-SLUG), so first-occurrence dedup is a defensive no-op.
export function stopWhyPairs(itineraryArr) {
  const seen = new Set();
  const out = [];
  for (const day of itineraryArr || []) {
    for (const s of day.stops || []) {
      if (seen.has(s.slug)) continue;
      seen.add(s.slug);
      out.push({ slug: s.slug, why: s.why });
    }
  }
  return out;
}

// Throws (never silently coerces) when the model's response doesn't match the
// source shape 1:1 — same closed-world validation style as
// build-itineraries.mjs's validateAiOutput.
export function validateTranslationOutput(out, srcDays, stopSlugs) {
  if (!out || typeof out !== 'object') throw new Error('model returned no tool_use input');
  if (typeof out.title !== 'string' || !out.title) throw new Error('model output missing title');
  if (typeof out.description !== 'string' || !out.description) throw new Error('model output missing description');
  if (!Array.isArray(out.days) || out.days.length !== srcDays.length) {
    throw new Error(`model returned ${Array.isArray(out?.days) ? out.days.length : 'no'} day(s), expected ${srcDays.length}`);
  }
  out.days.forEach((d, i) => {
    if (!d || typeof d.label !== 'string' || typeof d.intro !== 'string') {
      throw new Error(`model day[${i}] missing label/intro`);
    }
  });
  if (!Array.isArray(out.faq)) throw new Error('model output missing faq array');

  const whys = out.whys && typeof out.whys === 'object' ? out.whys : {};
  const gotSlugs = new Set(Object.keys(whys));
  for (const slug of stopSlugs) {
    if (!gotSlugs.has(slug) || !String(whys[slug] || '').trim()) {
      throw new Error(`model output missing why for stop slug "${slug}"`);
    }
  }
  for (const slug of gotSlugs) {
    if (!stopSlugs.has(slug)) throw new Error(`model returned a why for unknown stop slug "${slug}"`);
  }
}

// Pure frontmatter assembly — produces the itinerariesI18n schema shape
// exactly (src/content.config.ts). `whys` is always keyed to EXACTLY
// `stopSlugs` (the source's own union), never to whatever the model happened
// to return, so a stray/missing model key can never desync the file from its
// source's stop list.
export function assembleI18nFrontmatter({ lang, slug, sourceHash, out, stopSlugs }) {
  const whys = {};
  for (const s of stopSlugs) whys[s] = out.whys?.[s] ?? '';
  return {
    lang,
    slug,
    sourceHash,
    title: out.title,
    description: out.description || out.title,
    quickAnswer: out.quickAnswer || '',
    faq: Array.isArray(out.faq) ? out.faq.filter((f) => f?.q && f?.a) : [],
    days: (out.days || []).map((d) => ({ label: d.label, intro: d.intro })),
    whys,
    rainWhys: {}, // source itinerary files carry no rain prose to translate
  };
}

// ── prompt / tool-use call ──────────────────────────────────────────────────

const TOOL = {
  name: 'submit_itinerary_translation',
  description: 'Return the translated itinerary connective prose.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Translated page title, same meaning, natural in the target language.' },
      description: { type: 'string', description: 'Translated meta description (1-2 sentences).' },
      quickAnswer: { type: 'string', description: 'Translated quick-answer summary paragraph.' },
      faq: {
        type: 'array',
        description: 'Translated FAQ, same order and count as the source.',
        items: {
          type: 'object',
          properties: { q: { type: 'string' }, a: { type: 'string' } },
          required: ['q', 'a'],
        },
      },
      days: {
        type: 'array',
        description: 'One entry per day, same order and count as the source.',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, intro: { type: 'string' } },
          required: ['label', 'intro'],
        },
      },
      whys: {
        type: 'object',
        description:
          'Map of stop slug -> translated "why". MUST have exactly one entry for every stop slug listed in the source, using the exact same slug strings as keys (never translate or alter a slug).',
      },
    },
    required: ['title', 'description', 'quickAnswer', 'faq', 'days', 'whys'],
  },
};

function buildPrompt(langName, data) {
  const whysBlock = data.stops.map((s, i) => `${i + 1}. [slug: ${s.slug}] ${s.why}`).join('\n');
  const faqBlock = data.faq?.length
    ? `FAQ:\n${data.faq.map((f, i) => `${i + 1}. Q: ${f.q}\n   A: ${f.a}`).join('\n')}`
    : '';
  const daysBlock = data.days.map((d, i) => `Day ${i + 1} — label: ${d.label}\n  intro: ${d.intro}`).join('\n');

  return `Translate this English travel itinerary's connective prose into ${langName} for a travel website.

RULES
- Natural, fluent ${langName} a local reader would find idiomatic — not word-for-word.
- This text never contains hard facts to begin with (no clock times, opening hours, or prices) — do not introduce any.
- KEEP EXACTLY AS-IS: any numbers that do appear (day counts, etc).
- Proper nouns (venue names): use the established local rendering if one exists; otherwise keep the original. Never substitute a different venue for the one named.
- Do not add, remove, or embellish facts. Do not add a translator's note.
- Return EXACTLY ${data.days.length} day(s), in the same order.
- Return a "why" translation for EVERY stop slug listed below, keyed by the EXACT same slug string given (do not translate or alter the slug itself).
- Keep the same number of FAQ items, in the same order.

SOURCE
Title: ${data.title}
Description: ${data.description}
Quick answer: ${data.quickAnswer}
${faqBlock}

Days:
${daysBlock}

Stop "why" sentences (slug -> why):
${whysBlock}`;
}

async function translateOne(langCode, id, data) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_itinerary_translation' },
    messages: [{ role: 'user', content: buildPrompt(LANGS[langCode], data) }],
  });
  const out = msg.content.find((c) => c.type === 'tool_use')?.input;
  validateTranslationOutput(out, data.days, data.stopSlugs);

  const fm = assembleI18nFrontmatter({ lang: langCode, slug: id, sourceHash: data.stopsHash, out, stopSlugs: data.stopSlugs });
  const dir = join(OUT_DIR, langCode);
  await mkdir(dir, { recursive: true });
  const file = `---\n${yaml.dump(fm, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n`;
  await writeFile(join(dir, `${id}.md`), file, 'utf8');
}

// ── gather work ──────────────────────────────────────────────────────────

async function loadSourceItineraries() {
  if (!existsSync(SOURCE_DIR)) return [];
  const files = (await readdir(SOURCE_DIR)).filter((f) => f.endsWith('.md'));
  const out = [];
  for (const f of files) {
    const raw = await readFile(join(SOURCE_DIR, f), 'utf8');
    const fm = parseFrontmatter(raw);
    if (!fm || fm.draft) continue;
    const id = f.replace(/\.md$/, '');
    const stops = stopWhyPairs(fm.itinerary);
    out.push({
      id,
      stopsHash: fm.stopsHash,
      data: {
        title: fm.title,
        description: fm.description,
        quickAnswer: fm.quickAnswer,
        faq: fm.faq || [],
        days: (fm.itinerary || []).map((d) => ({ label: d.label, intro: d.intro })),
        stops,
        stopSlugs: new Set(stops.map((s) => s.slug)),
        stopsHash: fm.stopsHash,
      },
    });
  }
  return out;
}

async function existingSourceHash(langCode, id) {
  const p = join(OUT_DIR, langCode, `${id}.md`);
  if (!existsSync(p)) return null;
  const raw = await readFile(p, 'utf8');
  const fm = parseFrontmatter(raw);
  return fm?.sourceHash ?? null;
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const itineraries = await loadSourceItineraries();

  if (!itineraries.length) {
    console.log(`No itinerary source files found in ${SOURCE_DIR} — nothing to translate.`);
    return;
  }

  const langs = ONLY_LANG ? [ONLY_LANG] : Object.keys(LANGS);
  const jobs = [];
  let items = 0;

  for (const it of itineraries) {
    if (items >= LIMIT) break;
    let queuedForThisItem = false;
    for (const lang of langs) {
      if (!LANGS[lang]) continue;
      const existingHash = await existingSourceHash(lang, it.id);
      if (!needsTranslation(existingHash, it.stopsHash, FORCE)) continue;
      jobs.push({ lang, id: it.id, data: it.data });
      queuedForThisItem = true;
    }
    if (queuedForThisItem) items++;
  }

  console.log(`${jobs.length} translation(s) to do across ${items} itinerary file(s) · model ${MODEL} · concurrency ${CONCURRENCY}`);
  if (!jobs.length) {
    console.log('Nothing to translate — all up to date.');
    return;
  }

  let done = 0, failed = 0, next = 0;
  async function worker() {
    while (next < jobs.length) {
      const j = jobs[next++];
      try {
        await translateOne(j.lang, j.id, j.data);
        done++;
        console.log(`  OK ${j.lang}/${j.id}  (${done}/${jobs.length})`);
      } catch (e) {
        failed++;
        console.log(`  FAIL ${j.lang}/${j.id} — ${String(e.message).slice(0, 160)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  console.log(`\nDone. ${done} translated, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
