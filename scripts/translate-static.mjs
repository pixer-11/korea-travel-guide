// Translate static prose pages (about/methodology/newsletter/privacy/terms) into
// ko/ja/es/zh, one file per language per page to
// src/content/static-pages-i18n/<lang>/<slug>.md.
//
// RESUMABLE + idempotent, the way translate-posts.mjs is: a language file that
// already exists AND whose stored `srcHash` still matches the English source is
// skipped; a mismatch means the English was edited after translation and the
// file is re-queued. Until 2026-09-02 this script used "file exists = skip", so
// a clause edited in the English privacy policy never reached the other four
// languages unless someone remembered --force. `lastUpdated` is part of the
// hash because the translated page RENDERS the copied value (StaticPage.astro),
// so a date bump has to propagate too.
//
// A LEGACY file with no stored hash follows translate-posts' policy exactly:
// it is treated as current and stamped with today's hash in place (the
// in-place equivalent of scripts/backfill-src-hashes.mjs), no API call. Git
// dates back the declaration: every static translation was last touched in the
// same commit as, or later than, its English source (checked 2026-09-02).
//
//   node scripts/translate-static.mjs --dry                # queue + reasons, no API
//   node scripts/translate-static.mjs --limit=1
//   node scripts/translate-static.mjs --lang=ko
//   node scripts/translate-static.mjs --force              # re-translate everything
//   node scripts/translate-static.mjs
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { parseSourceFile, srcHashOfSourceFile, storedHashIn, stampSrcHash, quoteSrcHashLine } from './lib/src-hash.mjs';
import { isTransientApiError, transientBackoffMs } from './lib/api-transient.mjs';
import { findToolSpill } from './lib/tool-spill.mjs';

const SRC = fileURLToPath(new URL('../src/content/static-pages/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/content/static-pages-i18n/', import.meta.url));
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const CONCURRENCY = Number(process.env.TRANSLATE_CONCURRENCY || 4);
const LANGS = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const LIMIT = Number(arg('limit') || 0) || Infinity;
const ONLY_LANG = arg('lang');
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry');

// The srcHash contract: the fields this script translates or copies, in this
// order, plus the body (added by srcHashOfSourceFile). Change the TOOL schema
// and this list together.
const HASH_FIELDS = ['metaTitle', 'metaDescription', 'eyebrow', 'h1', 'lastUpdated'];

const client = DRY ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOL = {
  name: 'submit_translation',
  input_schema: {
    type: 'object',
    properties: {
      metaTitle: { type: 'string' },
      metaDescription: { type: 'string' },
      eyebrow: { type: 'string' },
      h1: { type: 'string' },
      body: { type: 'string', description: 'Translated markdown body, same headings/links/brand names.' },
    },
    required: ['metaTitle', 'metaDescription', 'eyebrow', 'h1', 'body'],
  },
};

function prompt(langName, fm, body) {
  return `Translate this English website page (editorial policy / legal) into ${langName}.

RULES
- Natural, fluent ${langName}. This is a legal/policy page — translate faithfully; do NOT add, remove, or change the meaning of any clause.
- KEEP AS-IS: the brand name "Wander Atlas", email addresses, URLs, "GDPR", "CCPA", "Google Analytics", "Google AdSense", "Google Places", numbers and dates.
- Preserve markdown exactly: same "##" headings (translated), lists, bold, and links with unchanged URLs.
- Do not add a translator's note.

FIELDS
metaTitle: ${fm.metaTitle}
metaDescription: ${fm.metaDescription}
eyebrow: ${fm.eyebrow}
h1: ${fm.h1}

Body (markdown):
${body}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One translation, up to three attempts. Everything stochastic is retried —
// a transient API error, a reply cut at max_tokens, an empty or stub reply —
// and a reply that is still wrong after three tries is NOT written (the error
// is logged, and the missing/mismatched srcHash re-queues the file on the next
// run). Same shape as translate-posts.mjs's translateOne.
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
  // The model can close one field and open the next in XML *inside* a value
  // (2026-09-05, essentials topics ko) — the text is then wrong and the
  // following key is lost. Never write such a reply.
  const spill = findToolSpill(out);
  if (spill.length) return retry(`tool-call spill in ${spill.join(', ')}`);
  // A body far shorter than its source is a stub with a title for camouflage
  // (posts: dubai-def-leppard ko/es at 2% of the English, 2026-09-02). Same
  // floor as translate-posts: Chinese runs at ~0.4 of English, 0.2 is under
  // any real translation.
  const outLen = String(out.body).trim().length;
  if (outLen < 0.2 * String(body || '').trim().length) return retry(`translation body is a stub (${outLen} chars against ${body.trim().length})`);

  const outFm = {
    lang: langCode,
    slug,
    srcHash: hash,
    metaTitle: out.metaTitle,
    metaDescription: out.metaDescription,
    eyebrow: out.eyebrow,
    h1: out.h1,
    ...(fm.lastUpdated ? { lastUpdated: String(fm.lastUpdated) } : {}),
  };
  const fmText = quoteSrcHashLine(yaml.dump(outFm, { lineWidth: -1 }));
  // Escape range tildes in the body — markdown strikethrough guard (see translate-posts.mjs).
  const file = `---\n${fmText}---\n\n${out.body.trim().replace(/(?<!\\)~/g, '\\~')}\n`;
  await mkdir(join(OUT, langCode), { recursive: true });
  await writeFile(join(OUT, langCode, `${slug}.md`), file, 'utf8');
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

console.log(`${jobs.length} translation(s) across ${count} page(s) · missing ${plan.missing} · stale ${plan.stale} · fresh ${plan.fresh} · legacy ${plan.legacy}${stamped ? ` (stamped ${stamped})` : ''}${plan.forced ? ` · forced ${plan.forced}` : ''} · model ${MODEL}`);
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
