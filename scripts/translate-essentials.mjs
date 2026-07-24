// Translate per-country ESSENTIALS prose into ko/ja/es/zh with Claude, writing
// one file per language per country to src/content/essentials-i18n/<lang>/<slug>.md.
//
// Only prose is translated (title, description, body). Hard facts — official URLs,
// numbers, dates, lastReviewed — stay in the English source and are read from
// there at render time. RESUMABLE + idempotent (existing files are skipped).
//
//   node scripts/translate-essentials.mjs --limit=1
//   node scripts/translate-essentials.mjs --lang=ko
//   node scripts/translate-essentials.mjs            # everything missing
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const SRC = fileURLToPath(new URL('../src/content/essentials/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/content/essentials-i18n/', import.meta.url));
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
  description: 'Return the translated travel essentials guide.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Translated title, natural in the target language.' },
      description: { type: 'string', description: 'Translated meta description (1-2 sentences).' },
      body: { type: 'string', description: 'Translated markdown body, same heading structure and links.' },
    },
    required: ['title', 'description', 'body'],
  },
};

function prompt(langName, data) {
  return `Translate this English "travel essentials" country guide into ${langName} for a travel website. It covers visa & entry, transport, money, best time to visit, and emergencies.

RULES
- Natural, fluent ${langName} a local reader would find idiomatic — not word-for-word.
- KEEP EXACTLY AS-IS: numbers, prices, dates, deadlines, phone/emergency numbers, visa day-counts, station/line names, and URLs.
- This is safety-relevant information (visas, entry rules, emergencies). Do NOT add, remove, soften, or embellish any fact. Translate faithfully.
- Proper nouns (agencies, portals, place names): use the established local rendering if one exists; otherwise keep the original, adding the original in parentheses on first mention where a reader would need it.
- Preserve markdown structure exactly: the same "##" headings (translated text), lists, bold, and links with unchanged URLs.
- Do not add a translator's note.

SOURCE
Title: ${data.title}
Description: ${data.description}

Body (markdown):
${data.body}`;
}

async function translateOne(langCode, slug, data) {
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
    slug,
    title: out.title,
    description: out.description || out.title,
  };
  const file = `---\n${yaml.dump(fm, { lineWidth: -1 })}---\n\n${out.body.trim()}\n`;
  const dir = join(OUT, langCode);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${slug}.md`), file, 'utf8');
}

// ── gather work ──────────────────────────────────────────────
const files = (await readdir(SRC)).filter((f) => f.endsWith('.md'));
const langs = ONLY_LANG ? [ONLY_LANG] : Object.keys(LANGS);
const jobs = [];
let count = 0;

for (const f of files) {
  if (count >= LIMIT) break;
  const slug = f.replace(/\.md$/, '');
  const raw = await readFile(join(SRC, f), 'utf8');
  const end = raw.indexOf('\n---', 3);
  let fm;
  try { fm = yaml.load(raw.slice(4, end)); } catch { continue; }
  if (!fm || fm.draft) continue;
  const body = raw.slice(end + 4).trim();
  if (!body) continue;

  const data = { title: fm.title, description: fm.description, body };
  let queued = false;
  for (const lang of langs) {
    if (!LANGS[lang]) continue;
    if (!FORCE && existsSync(join(OUT, lang, `${slug}.md`))) continue;
    jobs.push({ lang, slug, data });
    queued = true;
  }
  if (queued) count++;
}

console.log(`${jobs.length} translation(s) across ${count} country guide(s) · model ${MODEL} · concurrency ${CONCURRENCY}`);
if (!jobs.length) { console.log('Nothing to translate — all up to date.'); process.exit(0); }

let done = 0, failed = 0, next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    try {
      await translateOne(j.lang, j.slug, j.data);
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
