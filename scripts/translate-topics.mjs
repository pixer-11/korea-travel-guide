// Translate the 5 essentials TOPIC hubs into ko/ja/es/zh with Claude, one file
// per language per topic to src/content/essentials-topics-i18n/<lang>/<slug>.md.
// Translates every display field + the markdown body. RESUMABLE (skips existing).
//
//   node scripts/translate-topics.mjs --limit=1
//   node scripts/translate-topics.mjs
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const SRC = fileURLToPath(new URL('../src/content/essentials-topics/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/content/essentials-topics-i18n/', import.meta.url));
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
${fm.faq.map((f, i) => `${i + 1}. Q: ${f.q}\n   A: ${f.a}`).join('\n')}

Body (markdown):
${body}`;
}

async function translateOne(langCode, slug, fm, body) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_translation' },
    messages: [{ role: 'user', content: prompt(LANGS[langCode], fm, body) }],
  });
  const out = msg.content.find((c) => c.type === 'tool_use')?.input;
  if (!out?.body || !out?.h1) throw new Error('model returned no translation');

  const outFm = {
    lang: langCode,
    slug,
    metaTitle: out.metaTitle,
    metaDescription: out.metaDescription,
    h1: out.h1,
    dek: out.dek,
    quickAnswer: out.quickAnswer,
    countryHeading: out.countryHeading,
    breadcrumbName: out.breadcrumbName,
    disclosure: out.disclosure,
    faq: Array.isArray(out.faq) ? out.faq.filter((f) => f?.q && f?.a) : [],
  };
  const file = `---\n${yaml.dump(outFm, { lineWidth: -1 })}---\n\n${out.body.trim()}\n`;
  const dir = join(OUT, langCode);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${slug}.md`), file, 'utf8');
}

const files = (await readdir(SRC)).filter((f) => f.endsWith('.md'));
const langs = ONLY_LANG ? [ONLY_LANG] : Object.keys(LANGS);
const jobs = [];
let count = 0;
for (const f of files) {
  if (count >= LIMIT) break;
  const slug = f.replace(/\.md$/, '');
  const raw = await readFile(join(SRC, f), 'utf8');
  const end = raw.indexOf('\n---', 3);
  const fm = yaml.load(raw.slice(4, end));
  const body = raw.slice(end + 4).trim();
  let queued = false;
  for (const lang of langs) {
    if (!LANGS[lang]) continue;
    if (!FORCE && existsSync(join(OUT, lang, `${slug}.md`))) continue;
    jobs.push({ lang, slug, fm, body });
    queued = true;
  }
  if (queued) count++;
}

console.log(`${jobs.length} translation(s) across ${count} topic(s) · model ${MODEL}`);
if (!jobs.length) { console.log('Nothing to translate.'); process.exit(0); }

let done = 0, failed = 0, next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    try {
      await translateOne(j.lang, j.slug, j.fm, j.body);
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
if (failed) process.exitCode = 1;
