// Translate static prose pages (about/privacy/terms) into ko/ja/es/zh, one file
// per language per page to src/content/static-pages-i18n/<lang>/<slug>.md.
// RESUMABLE (skips existing).  node scripts/translate-static.mjs
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const SRC = fileURLToPath(new URL('../src/content/static-pages/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/content/static-pages-i18n/', import.meta.url));
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const LANGS = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const ONLY_LANG = arg('lang');
const FORCE = process.argv.includes('--force');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

async function translateOne(langCode, slug, fm, body) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_translation' },
    messages: [{ role: 'user', content: prompt(LANGS[langCode], fm, body) }],
  });
  const out = msg.content.find((c) => c.type === 'tool_use')?.input;
  if (!out?.body || !out?.h1) throw new Error('no translation');
  const outFm = {
    lang: langCode, slug,
    metaTitle: out.metaTitle, metaDescription: out.metaDescription,
    eyebrow: out.eyebrow, h1: out.h1,
    ...(fm.lastUpdated ? { lastUpdated: fm.lastUpdated } : {}),
  };
  const file = `---\n${yaml.dump(outFm, { lineWidth: -1 })}---\n\n${out.body.trim()}\n`;
  await mkdir(join(OUT, langCode), { recursive: true });
  await writeFile(join(OUT, langCode, `${slug}.md`), file, 'utf8');
}

const files = (await readdir(SRC)).filter((f) => f.endsWith('.md'));
const langs = ONLY_LANG ? [ONLY_LANG] : Object.keys(LANGS);
const jobs = [];
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  const raw = await readFile(join(SRC, f), 'utf8');
  const end = raw.indexOf('\n---', 3);
  const fm = yaml.load(raw.slice(4, end));
  const body = raw.slice(end + 4).trim();
  for (const lang of langs) {
    if (!LANGS[lang]) continue;
    if (!FORCE && existsSync(join(OUT, lang, `${slug}.md`))) continue;
    jobs.push({ lang, slug, fm, body });
  }
}
console.log(`${jobs.length} translation(s) · model ${MODEL}`);
if (!jobs.length) { console.log('Nothing to translate.'); process.exit(0); }
let done = 0, failed = 0, next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    try { await translateOne(j.lang, j.slug, j.fm, j.body); done++; console.log(`  OK ${j.lang}/${j.slug} (${done}/${jobs.length})`); }
    catch (e) { failed++; console.log(`  FAIL ${j.lang}/${j.slug} — ${String(e.message).slice(0, 120)}`); }
  }
}
await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
console.log(`\nDone. ${done} translated, ${failed} failed.`);
if (failed) process.exitCode = 1;
