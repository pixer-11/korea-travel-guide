// Translate post PROSE into ko/ja/es/zh with Claude, writing one file per
// language per post to src/content/i18n/<lang>/<post-id>.md.
//
// Only prose is translated (title, description, quickAnswer, faq, body). Hard
// facts — place name/address/rating/hours, images, dates — stay in the English
// source post and are read from there at render time, so a translation can never
// contradict the verified Places data.
//
// RESUMABLE + idempotent: a language file that already exists AND whose stored
// `srcHash` still matches the English source is skipped, so this can run daily to
// pick up newly published posts AND re-translate posts whose prose changed since
// they were translated. (Before srcHash, "exists" alone meant skip — a source
// edit never propagated, and 414 repaired descriptions stayed truncated in four
// languages until the 2026-08-01 sweep.)
//
//   node scripts/translate-posts.mjs --limit=2            # try 2 posts (all langs)
//   node scripts/translate-posts.mjs --limit=2 --lang=ko  # one language
//   node scripts/translate-posts.mjs                      # everything missing
//   node scripts/translate-posts.mjs --force              # re-translate existing
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { srcHashOf, storedHashIn } from './lib/src-hash.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { fixCjkBold } from './lib/cjk-bold.mjs';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/content/i18n/', import.meta.url));
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const CONCURRENCY = Number(process.env.TRANSLATE_CONCURRENCY || 4);

const LANGS = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const LIMIT = Number(arg('limit') || 0) || Infinity;
const ONLY_LANG = arg('lang');
const FORCE = process.argv.includes('--force');
// Repair a named set without re-translating the whole site. Existing files are
// skipped by default, so fixing a handful of bad translations otherwise meant
// --force across ~2,000 files. Accepts "ko/slug" (that language only) or "slug"
// (every language), comma-separated — the shape audit-translations reports in.
const ONLY = (arg('only') || '')
  .split(',')
  .map((s) => s.trim().replace(/\.md$/, ''))
  .filter(Boolean);
const onlyPairs = new Set(ONLY.filter((s) => s.includes('/')));
const onlySlugs = new Set(ONLY.filter((s) => !s.includes('/')));
const wanted = (lang, id) =>
  !ONLY.length || onlySlugs.has(id) || onlyPairs.has(`${lang}/${id}`);

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The stored srcHash of an existing translation file, or null (legacy file
// from before hash tracking, or unreadable). Legacy files are treated as
// up-to-date rather than re-queuing ~12,000 jobs in one run; the one-off
// backfill (scripts/backfill-src-hashes.mjs) stamped them all on 2026-08-01.
function storedHash(path) {
  try {
    return storedHashIn(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const TOOL = {
  name: 'submit_translation',
  description: 'Return the translated travel guide.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Translated title, same meaning, natural in the target language.' },
      description: { type: 'string', description: 'Translated meta description (1-2 sentences).' },
      quickAnswer: { type: 'string', description: 'Translated quick answer paragraph. Empty string if there was none.' },
      faq: {
        type: 'array',
        description: 'Translated FAQ, same order and count as the source.',
        items: {
          type: 'object',
          properties: { q: { type: 'string' }, a: { type: 'string' } },
          required: ['q', 'a'],
        },
      },
      body: { type: 'string', description: 'Translated markdown body, same heading structure and links.' },
    },
    required: ['title', 'description', 'body', 'faq'],
  },
};

function prompt(langName, data) {
  return `Translate this English travel guide into ${langName} for a travel website.

RULES
- Natural, fluent ${langName} a local reader would find idiomatic — not word-for-word.
- KEEP EXACTLY AS-IS: numbers, prices, ratings, dates, times, addresses, station/line/exit numbers, URLs.
- Proper nouns (venue, station, neighbourhood, city names): use the established local rendering if one exists; otherwise keep the original. Where a reader would need it to find the place, keep the original in parentheses on first mention.
- Preserve markdown structure exactly: the same "##" headings (translated text), lists, bold, and links with unchanged URLs.
- Keep the same number of FAQ items, in the same order.
- Do not add, remove, or embellish facts. Do not add a translator's note.

SOURCE
Title: ${data.title}
Description: ${data.description}
${data.quickAnswer ? `Quick answer: ${data.quickAnswer}` : ''}
${data.faq?.length ? `FAQ:\n${data.faq.map((f, i) => `${i + 1}. Q: ${f.q}\n   A: ${f.a}`).join('\n')}` : ''}

Body (markdown):
${data.body}`;
}

// The model occasionally spills the REST of the tool call into the first string
// field — a `description` that ends with "</description><parameter
// name="quickAnswer">…". The fields after the spill then arrive empty, so the
// page silently falls back to English while the file still looks translated.
// This shipped to 26 live posts before anyone saw it, because nothing checked.
// Cheap to detect, so check every field and retry rather than ever write it.
const SPILL = /<\/?(description|quickAnswer|title|body|faq|parameter|function_calls|invoke)\b|<parameter\s+name=/i;

function spilledField(out) {
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && SPILL.test(v)) return k;
  }
  for (const f of Array.isArray(out.faq) ? out.faq : []) {
    if (SPILL.test(String(f?.q ?? '')) || SPILL.test(String(f?.a ?? ''))) return 'faq';
  }
  return null;
}

// FAQ-only fallback for a post whose full translation keeps coming back
// malformed. Returns the translated entries, or null if this fails too.
const FAQ_TOOL = {
  name: 'submit_faq',
  description: 'Return the translated FAQ entries.',
  input_schema: {
    type: 'object',
    properties: {
      faq: {
        type: 'array',
        description: 'Translated FAQ, same order and count as the source.',
        items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] },
      },
    },
    required: ['faq'],
  },
};

async function translateFaqOnly(langCode, data) {
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      tools: [FAQ_TOOL],
      tool_choice: { type: 'tool', name: 'submit_faq' },
      messages: [{
        role: 'user',
        content:
          `Translate these ${data.faq.length} FAQ entries into ${LANGS[langCode]}. ` +
          `Return exactly ${data.faq.length}, in the same order. Keep place names and dates as written. ` +
          `Call submit_faq.\n\n${JSON.stringify(data.faq)}`,
      }],
    });
    if (msg.stop_reason === 'max_tokens') return null;
    const got = msg.content.find((c) => c.type === 'tool_use')?.input?.faq;
    if (!Array.isArray(got)) return null;
    const clean = got.filter((f) => f?.q && f?.a);
    return clean.length >= data.faq.length ? clean : null;
  } catch {
    return null;
  }
}

async function translateOne(langCode, srcId, data, hash, attempt = 1) {
  const msg = await client.messages.create({
    model: MODEL,
    // 8000 silently truncated the longest posts: the tool-use input was cut off
    // mid-JSON, the parser salvaged what it could, and the FIELDS AT THE END of
    // the schema — faq above all — came back empty. bangkok-the-grand-palace
    // (9KB source) failed its faq three retries in a row for exactly this
    // reason; the retries could never succeed, because the ceiling was the cause.
    max_tokens: 16000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_translation' },
    messages: [{ role: 'user', content: prompt(LANGS[langCode], data) }],
  });
  const out = msg.content.find((c) => c.type === 'tool_use')?.input;
  if (!out?.body || !out?.title) throw new Error('model returned no translation');

  // Reject a malformed translation instead of writing it. A dropped quickAnswer
  // is the same class of defect: the source had one, so a translation without it
  // renders the English paragraph on a Korean page.
  const bad =
    spilledField(out) ??
    (data.quickAnswer && !String(out.quickAnswer || '').trim() ? 'quickAnswer(누락)' : null) ??
    // Same defect, different field: the source has FAQs and the translation came
    // back without them. This slipped for months because only quickAnswer was
    // guarded — 21 translations shipped with `faq: []`, and since the page falls
    // back to the English FAQ when the translated one is empty, every one of
    // them rendered five English questions inside a Chinese or Spanish article.
    ((data.faq?.length ?? 0) > 0 &&
     (Array.isArray(out.faq) ? out.faq.filter((f) => f?.q && f?.a).length : 0) < data.faq.length
      ? `faq(${Array.isArray(out.faq) ? out.faq.length : 0}/${data.faq.length})`
      : null);
  if (bad) {
    if (attempt < 3) return translateOne(langCode, srcId, data, hash, attempt + 1);
    // Three identical failures are not bad luck, they are a request the model
    // cannot satisfy in one shot. Observed on the George Town festival guide:
    // every attempt returned `faq` as a STRING instead of an array and a body
    // shortened from 4,437 to 1,598 characters — the whole payload degrades
    // together, and retrying the same prompt can only reproduce it. Ask for
    // the FAQ on its own, where the answer is small enough to hold its shape.
    // Same lesson as the region-intro generator: split the request, don't
    // repeat it (2026-08-06).
    if (String(bad).startsWith('faq(')) {
      const rescued = await translateFaqOnly(langCode, data);
      if (rescued) {
        console.log(`     ↻ ${langCode}/${srcId} — FAQ re-requested on its own (${rescued.length}/${data.faq.length})`);
        out.faq = rescued;
      } else {
        throw new Error(`translation malformed after ${attempt} attempts (${bad}), FAQ-only retry also failed — not written`);
      }
    } else {
      throw new Error(`translation malformed after ${attempt} attempts (${bad}) — not written`);
    }
  }

  const fm = {
    lang: langCode,
    slug: srcId,
    srcHash: hash,
    title: out.title,
    description: out.description || out.title,
    ...(out.quickAnswer ? { quickAnswer: out.quickAnswer } : {}),
    faq: Array.isArray(out.faq) ? out.faq.filter((f) => f?.q && f?.a) : [],
  };
  // Korean/Japanese write ranges with a tilde ("4~5월", "11시~12시"). In Markdown a
  // tilde is the strikethrough marker, so two of them in one paragraph struck out
  // everything between (hit 308 posts). Escape them in the BODY — frontmatter
  // (quickAnswer/faq) renders as plain text and must stay unescaped.
  // Same class of defect as the tilde, and the same right place to fix it:
  // CommonMark cannot close ** when punctuation precedes the closer and a word
  // character follows — which is exactly how CJK writes a glossed proper noun
  // ("**왓 랏차부라나(Wat Ratchaburana)**와"). 145 files were repaired by hand on
  // 2026-08-01 and eleven more arrived with the translations written since,
  // because nothing stopped the translator producing them.
  const body = fixCjkBold(out.body.trim().replace(/(?<!\\)~/g, '\\~'));
  // js-yaml leaves a hash like 818631094e44 unquoted (not a float under its
  // YAML 1.1 rules), but Astro's YAML 1.2 parser reads it as scientific
  // notation and the number then fails the schema's z.string() — twelve
  // translations broke the build that way on 2026-08-01. Quote the hash line
  // ourselves; the bare-hex pattern can't touch a line js-yaml already quoted.
  const fmText = yaml
    .dump(fm, { lineWidth: -1 })
    .replace(/^srcHash: ([0-9a-f]{12})$/m, "srcHash: '$1'");
  const file = `---\n${fmText}---\n\n${body}\n`;
  const dir = join(OUT, langCode);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${srcId}.md`), file, 'utf8');
}

// ── gather work ──────────────────────────────────────────────
const files = (await readdir(POSTS)).filter((f) => f.endsWith('.md'));
const langs = ONLY_LANG ? [ONLY_LANG] : Object.keys(LANGS);
const jobs = [];
let posts = 0;

for (const f of files) {
  if (posts >= LIMIT) break;
  const id = f.replace(/\.md$/, '');
  // CRLF-normalize BEFORE hashing: a Windows checkout (core.autocrlf) must
  // produce the same srcHash as the LF checkout on CI, or every local run
  // would see every translation as stale.
  const raw = (await readFile(join(POSTS, f), 'utf8')).replace(/\r\n/g, '\n');
  const end = raw.indexOf('\n---', 3);
  let fm;
  try { fm = yaml.load(raw.slice(4, end)); } catch { continue; }
  if (!fm || fm.draft) continue;
  const body = raw.slice(end + 4).trim();
  if (!body) continue;

  const data = { title: fm.title, description: fm.description, quickAnswer: fm.quickAnswer, faq: fm.faq, body };
  const hash = srcHashOf(data);
  let queuedForThisPost = false;
  for (const lang of langs) {
    if (!LANGS[lang]) continue;
    if (!wanted(lang, id)) continue;
    // --only names files that are already there and WRONG, so it overwrites like
    // --force does, but scoped to what was named.
    if (!FORCE && !ONLY.length) {
      const existing = join(OUT, lang, `${id}.md`);
      if (existsSync(existing)) {
        // A file whose stored srcHash matches the source is genuinely up to
        // date. A MISMATCH means the English prose was edited after this
        // translation was written — before hash tracking that file was skipped
        // forever and served the outdated prose. A legacy file with no hash is
        // treated as current (the 2026-08-01 backfill stamped the whole tree).
        const stored = storedHash(existing);
        if (stored === null || stored === hash) continue;
      }
    }
    jobs.push({ lang, id, data, hash });
    queuedForThisPost = true;
  }
  if (queuedForThisPost) posts++;
}

console.log(`${jobs.length} translation(s) to do across ${posts} post(s) · model ${MODEL} · concurrency ${CONCURRENCY}`);
if (!jobs.length) { console.log('Nothing to translate — all up to date.'); process.exit(0); }

// ── run with a small concurrency pool ────────────────────────
let done = 0, failed = 0, next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    try {
      await translateOne(j.lang, j.id, j.data, j.hash);
      done++;
      console.log(`  ✅ ${j.lang}/${j.id}  (${done}/${jobs.length})`);
    } catch (e) {
      failed++;
      console.log(`  ⚠️  ${j.lang}/${j.id} — ${String(e.message).slice(0, 120)}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
console.log(`\nDone. ${done} translated, ${failed} failed.`);
if (failed) process.exitCode = 1;
