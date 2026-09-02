// Translate the 5 essentials TOPIC hubs into ko/ja/es/zh with Claude, one file
// per language per topic to src/content/essentials-topics-i18n/<lang>/<slug>.md.
// Translates every display field + the markdown body.
//
// RESUMABLE + idempotent, the way translate-posts.mjs is: a language file that
// already exists AND whose stored `srcHash` still matches the English source is
// skipped; a mismatch means the English was edited after translation and the
// file is re-queued. Until 2026-09-02 this script used "file exists = skip", so
// an English edit to a topic hub never reached its four translations — the
// lesson translate-posts learned on 2026-08-01, which its siblings never got.
//
// A LEGACY file with no stored hash follows translate-posts' policy exactly:
// it is treated as current and stamped with today's hash in place (the
// in-place equivalent of scripts/backfill-src-hashes.mjs), no API call. Git
// dates back the declaration: every topic translation was last touched in the
// same commit as, or later than, its English source (checked 2026-09-02).
//
//   node scripts/translate-topics.mjs --dry                # queue + reasons, no API
//   node scripts/translate-topics.mjs --limit=1
//   node scripts/translate-topics.mjs --lang=ko
//   node scripts/translate-topics.mjs --force              # re-translate everything
//   node scripts/translate-topics.mjs
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { parseSourceFile, srcHashOfSourceFile, storedHashIn, stampSrcHash, quoteSrcHashLine } from './lib/src-hash.mjs';
import { isTransientApiError, transientBackoffMs } from './lib/api-transient.mjs';

const SRC = fileURLToPath(new URL('../src/content/essentials-topics/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/content/essentials-topics-i18n/', import.meta.url));
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const CONCURRENCY = Number(process.env.TRANSLATE_CONCURRENCY || 4);

const LANGS = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const LIMIT = Number(arg('limit') || 0) || Infinity;
const ONLY_LANG = arg('lang');
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry');

// The srcHash contract: exactly the fields this script translates, in this
// order, plus the body (added by srcHashOfSourceFile). Change the TOOL schema
// and this list together.
const HASH_FIELDS = ['metaTitle', 'metaDescription', 'h1', 'dek', 'quickAnswer', 'countryHeading', 'breadcrumbName', 'disclosure', 'faq'];

const client = DRY ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOL = {
  name: 'submit_translation',
  description: 'Return the translated travel-essentials topic hub.',
  input_schema: {
    type: 'object',
    properties: {
      metaTitle: { type: 'string' },
      metaDescription: { type: 'string' },
      h1: { type: 'string' },
      dek: { type: 'string' },
      quickAnswer: { type: 'string' },
      countryHeading: { type: 'string' },
      breadcrumbName: { type: 'string' },
      disclosure: { type: 'string' },
      faq: {
        type: 'array',
        items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] },
      },
      body: { type: 'string', description: 'Translated markdown body, same headings/links.' },
    },
    required: ['metaTitle', 'metaDescription', 'h1', 'dek', 'quickAnswer', 'countryHeading', 'breadcrumbName', 'disclosure', 'faq', 'body'],
  },
};

function prompt(langName, fm, body) {
  return `Translate this English travel-essentials topic page into ${langName} for a travel website.

RULES
- Natural, fluent ${langName} a local reader would find idiomatic — not word-for-word.
- KEEP EXACTLY AS-IS: numbers, emergency/phone numbers (112, 911, 999, 1330…), day-counts, prices, card/app/agency names (T-money, Suica, Oyster, Google Maps, Naver, Grab, K-ETA, ESTA, ETIAS…), and URLs.
- This includes safety-relevant info (visas, emergencies). Do NOT add, remove, soften, or embellish any fact.
- Preserve markdown structure exactly: same "##" headings (translated), lists, bold, and links with unchanged URLs.
- Keep the same number of FAQ items in the same order.
- Do not add a translator's note.

FIELDS TO TRANSLATE
metaTitle: ${fm.metaTitle}
metaDescription: ${fm.metaDescription}
h1: ${fm.h1}
dek: ${fm.dek}
quickAnswer: ${fm.quickAnswer}
countryHeading: ${fm.countryHeading}
breadcrumbName: ${fm.breadcrumbName}
disclosure: ${fm.disclosure}
FAQ:
${(fm.faq || []).map((f, i) => `${i + 1}. Q: ${f.q}\n   A: ${f.a}`).join('\n')}

Body (markdown):
${body}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One translation, up to three attempts. Everything stochastic is retried —
// a transient API error, a reply cut at max_tokens, an empty or stub reply, a
// short FAQ — and a reply that is still wrong after three tries is NOT written
// (the error is logged, and the missing/mismatched srcHash re-queues the file
// on the next run). Same shape as translate-posts.mjs's translateOne.
async function translateOne(langCode, slug, fm, body, hash, attempt = 1) {
  const retry = (why) => {
    if (attempt < 3) {
      console.log(`     ↻ ${langCode}/${slug} — ${why}, retrying (attempt ${attempt + 1})`);
      return translateOne(langCode, slug, fm, body, hash, attempt + 1);
    }
    throw new Error(`${why} after ${attempt} attempts — not written`);
  };

  let msg;
  try {
    msg = await client.messages.create({
      model: MODEL,
      // 8000 silently cut the longest posts mid-JSON (translate-posts.mjs); the
      // same ceiling as there, and the stop_reason check below refuses a reply
      // that hits it regardless.
      max_tokens: 16000,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'submit_translation' },
      messages: [{ role: 'user', content: prompt(LANGS[langCode], fm, body) }],
    });
  } catch (e) {
    if (!isTransientApiError(e)) throw e;
    if (attempt >= 3) throw new Error(`API error after ${attempt} attempts: ${String(e.message).slice(0, 80)}`);
    const wait = transientBackoffMs(e, attempt);
    console.log(`     ↻ ${langCode}/${slug} — API ${e.status || ''} ${String(e.message).slice(0, 60)} — waiting ${wait / 1000}s (attempt ${attempt + 1})`);
    await sleep(wait);
    return translateOne(langCode, slug, fm, body, hash, attempt + 1);
  }
  // A reply cut at the ceiling is a truncated JSON whose LAST field — body —
  // is the one missing or half there. Never write it.
  if (msg.stop_reason === 'max_tokens') return retry('reply cut at max_tokens');
  const out = msg.content.find((c) => c.type === 'tool_use')?.input;
  if (!out?.body || !out?.h1) return retry('model returned no translation');
  // A body far shorter than its source is a stub with a title for camouflage
  // (posts: dubai-def-leppard ko/es at 2% of the English, 2026-09-02). Same
  // floor as translate-posts: Chinese runs at ~0.4 of English, 0.2 is under
  // any real translation.
  const outLen = String(out.body).trim().length;
  if (outLen < 0.2 * String(body || '').trim().length) return retry(`translation body is a stub (${outLen} chars against ${body.trim().length})`);
  const faq = Array.isArray(out.faq) ? out.faq.filter((f) => f?.q && f?.a) : [];
  if ((fm.faq?.length ?? 0) > 0 && faq.length < fm.faq.length) return retry(`faq(${faq.length}/${fm.faq.length})`);

  const outFm = {
    lang: langCode,
    slug,
    srcHash: hash,
    metaTitle: out.metaTitle,
    metaDescription: out.metaDescription,
    h1: out.h1,
    dek: out.dek,
    quickAnswer: out.quickAnswer,
    countryHeading: out.countryHeading,
    breadcrumbName: out.breadcrumbName,
    disclosure: out.disclosure,
    faq,
  };
  const fmText = quoteSrcHashLine(yaml.dump(outFm, { lineWidth: -1 }));
  // Escape range tildes in the body — markdown strikethrough guard (see translate-posts.mjs).
  const file = `---\n${fmText}---\n\n${out.body.trim().replace(/(?<!\\)~/g, '\\~')}\n`;
  const dir = join(OUT, langCode);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${slug}.md`), file, 'utf8');
}

// ── gather work ──────────────────────────────────────────────
const files = (await readdir(SRC)).filter((f) => f.endsWith('.md'));
const langs = ONLY_LANG ? [ONLY_LANG] : Object.keys(LANGS);
const jobs = [];
const plan = { missing: 0, stale: 0, fresh: 0, legacy: 0, forced: 0 };
let count = 0, stamped = 0;
for (const f of files) {
  if (count >= LIMIT) break;
  const slug = f.replace(/\.md$/, '');
  const raw = await readFile(join(SRC, f), 'utf8');
  const parsed = parseSourceFile(raw);
  if (!parsed) { console.log(`  ⚠ ${f}: no parseable frontmatter — skipped`); continue; }
  const { fm, body } = parsed;
  const hash = srcHashOfSourceFile(raw, HASH_FIELDS);
  let queued = false;
  for (const lang of langs) {
    if (!LANGS[lang]) continue;
    const target = join(OUT, lang, `${slug}.md`);
    let reason;
    if (FORCE) reason = 'forced';
    else if (!existsSync(target)) reason = 'missing';
    else {
      const existing = readFileSync(target, 'utf8');
      const stored = storedHashIn(existing);
      if (stored === hash) reason = 'fresh';
      else if (stored === null) {
        reason = 'legacy';
        if (!DRY) {
          const out = stampSrcHash(existing, hash);
          if (out) { await writeFile(target, out, 'utf8'); stamped++; }
          else console.log(`  ⚠ ${lang}/${slug}: legacy file could not be stamped (no slug: line?)`);
        }
      } else reason = 'stale';
    }
    plan[reason]++;
    const todo = reason === 'missing' || reason === 'stale' || reason === 'forced';
    if (DRY) console.log(`  ${todo ? 'TRANSLATE' : 'skip     '} ${lang}/${slug}  ${reason}${reason === 'legacy' ? ' (no srcHash → would stamp as current, no API)' : ''}`);
    if (!todo) continue;
    jobs.push({ lang, slug, fm, body, hash });
    queued = true;
  }
  if (queued) count++;
}

console.log(`${jobs.length} translation(s) across ${count} topic(s) · missing ${plan.missing} · stale ${plan.stale} · fresh ${plan.fresh} · legacy ${plan.legacy}${stamped ? ` (stamped ${stamped})` : ''}${plan.forced ? ` · forced ${plan.forced}` : ''} · model ${MODEL}`);
if (DRY) { console.log('--dry: nothing called, nothing written.'); process.exit(0); }
if (!jobs.length) { console.log('Nothing to translate — all up to date.'); process.exit(0); }

let done = 0, failed = 0, next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    try {
      await translateOne(j.lang, j.slug, j.fm, j.body, j.hash);
      done++;
      console.log(`  OK ${j.lang}/${j.slug}  (${done}/${jobs.length})`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${j.lang}/${j.slug} — ${String(e.message).slice(0, 140)}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
console.log(`\nDone. ${done} translated, ${failed} failed.`);
console.log(`TRANSLATE_SUMMARY done=${done} failed=${failed} jobs=${jobs.length}`);
if (failed) process.exitCode = 1;
