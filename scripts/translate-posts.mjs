// Translate post PROSE into ko/ja/es/zh with Claude, writing one file per
// language per post to src/content/i18n/<lang>/<post-id>.md.
//
// Only prose is translated (title, description, quickAnswer, faq, body). Hard
// facts — place name/address/rating/hours, images, dates — stay in the English
// source post and are read from there at render time, so a translation can never
// contradict the verified Places data.
//
// RESUMABLE + idempotent: a language file that already exists is skipped, so this
// can run daily to pick up only newly published posts (and be re-run safely after
// a partial/failed batch).
//
//   node scripts/translate-posts.mjs --limit=2            # try 2 posts (all langs)
//   node scripts/translate-posts.mjs --limit=2 --lang=ko  # one language
//   node scripts/translate-posts.mjs                      # everything missing
//   node scripts/translate-posts.mjs --force              # re-translate existing
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/content/i18n/', import.meta.url));
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const CONCURRENCY = Number(process.env.TRANSLATE_CONCURRENCY || 4);

const LANGS = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const LIMIT = Number(arg('limit') || 0) || Infinity;
const ONLY_LANG = arg('lang');
const FORCE = process.argv.includes('--force');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

async function translateOne(langCode, srcId, data) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_translation' },
    messages: [{ role: 'user', content: prompt(LANGS[langCode], data) }],
  });
  const out = msg.content.find((c) => c.type === 'tool_use')?.input;
  if (!out?.body || !out?.title) throw new Error('model returned no translation');

  const fm = {
    lang: langCode,
    slug: srcId,
    title: out.title,
    description: out.description || out.title,
    ...(out.quickAnswer ? { quickAnswer: out.quickAnswer } : {}),
    faq: Array.isArray(out.faq) ? out.faq.filter((f) => f?.q && f?.a) : [],
  };
  const file = `---\n${yaml.dump(fm, { lineWidth: -1 })}---\n\n${out.body.trim()}\n`;
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
  const raw = await readFile(join(POSTS, f), 'utf8');
  const end = raw.indexOf('\n---', 3);
  let fm;
  try { fm = yaml.load(raw.slice(4, end)); } catch { continue; }
  if (!fm || fm.draft) continue;
  const body = raw.slice(end + 4).trim();
  if (!body) continue;

  const data = { title: fm.title, description: fm.description, quickAnswer: fm.quickAnswer, faq: fm.faq, body };
  let queuedForThisPost = false;
  for (const lang of langs) {
    if (!LANGS[lang]) continue;
    if (!FORCE && existsSync(join(OUT, lang, `${id}.md`))) continue;
    jobs.push({ lang, id, data });
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
      await translateOne(j.lang, j.id, j.data);
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
