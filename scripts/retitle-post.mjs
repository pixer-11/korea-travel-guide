#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  RETITLE A POST FOR CLICK-THROUGH — title + description, in all five
//  languages, WITHOUT re-translating the article.
//
//  GSC (07-27→08-22): 270 pages in Google's top 10 drew 685 impressions and
//  8 clicks — 1.2% where 3–5% is normal for those positions. The queries are
//  the venue's name plus "menu", "reviews", "hours", the neighbourhood; the
//  titles said "Pak Gula in Bali". This tool sets a new English title and
//  description, asks the translator model for just those two fields in each
//  language that has a translation, and re-stamps the translations' srcHash
//  to the new English fingerprint — because a title change alone otherwise
//  re-queues the WHOLE post (title, description, quickAnswer, faq, body) in
//  four languages on the next translate-posts run (~$ per post, for two lines).
//
//    node scripts/retitle-post.mjs --file=retitles.json [--dry]
//      retitles.json: [{ "slug": "...", "title": "...", "description": "..." }]
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { setFrontmatterField } from './lib/frontmatter-field.mjs';
import { srcHashOfPostFile, storedHashIn } from './lib/src-hash.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const DRY = process.argv.includes('--dry');
const FILE = arg('file');
if (!FILE) { console.error('usage: node scripts/retitle-post.mjs --file=retitles.json [--dry]'); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }
const MODEL = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const LANGS = { ko: 'Korean', ja: 'Japanese', es: 'Spanish', zh: 'Simplified Chinese' };
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOL = {
  name: 'submit_fields',
  description: 'Return the translated title and description.',
  input_schema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } }, required: ['title', 'description'] },
};

async function translateFields(lang, title, description, placeName) {
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 400, tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content:
`Translate a travel guide's page TITLE and META DESCRIPTION into ${LANGS[lang]}.
Rules: natural written ${LANGS[lang]} as a local travel site would phrase it; keep the venue name "${placeName}" recognisable (established local rendering if one exists, otherwise keep it and add the original in parentheses on first mention if a reader would need it to find the place); keep numbers, ratings and the ★ exactly; the title stays one line and under 70 characters where the language allows; the description stays under 160 characters; no added facts, no translator's note.

TITLE: ${title}
DESCRIPTION: ${description}` }],
  });
  const use = msg.content.find((b) => b.type === 'tool_use');
  if (!use?.input?.title || !use?.input?.description) throw new Error(`no fields back for ${lang}`);
  return { title: String(use.input.title).trim(), description: String(use.input.description).trim() };
}

const items = JSON.parse(readFileSync(FILE, 'utf8'));
let done = 0, translated = 0, failed = 0;
for (const it of items) {
  const enPath = join(ROOT, 'src', 'content', 'posts', `${it.slug}.md`);
  if (!existsSync(enPath)) { console.log(`  ✗ ${it.slug}: no such post`); failed++; continue; }
  const before = readFileSync(enPath, 'utf8');
  const placeName = (before.match(/^\s+name:\s*'?(.+?)'?\s*$/m) || [])[1] || it.slug;
  let en = setFrontmatterField(before, 'title', it.title);
  en = setFrontmatterField(en, 'description', it.description);
  const hash = srcHashOfPostFile(en);
  console.log(`\n${it.slug}\n  EN  ${it.title}\n      ${it.description}\n  srcHash ${hash}`);
  const writes = [[enPath, en]];
  let ok = true;
  for (const lang of Object.keys(LANGS)) {
    const tp = join(ROOT, 'src', 'content', 'i18n', lang, `${it.slug}.md`);
    if (!existsSync(tp)) continue;
    try {
      const f = await translateFields(lang, it.title, it.description, placeName);
      let t = readFileSync(tp, 'utf8');
      t = setFrontmatterField(t, 'title', f.title);
      t = setFrontmatterField(t, 'description', f.description);
      t = setFrontmatterField(t, 'srcHash', hash);
      if (storedHashIn(t) !== hash) throw new Error('srcHash did not stamp');
      writes.push([tp, t]);
      translated++;
      console.log(`  ${lang}  ${f.title}\n      ${f.description}`);
    } catch (e) {
      ok = false; failed++;
      console.log(`  ✗ ${lang}: ${e.message.slice(0, 80)} — post left untouched`);
      break;
    }
  }
  // All five files or none: a half-retitled post would re-queue the rest.
  if (ok && !DRY) { for (const [p, body] of writes) writeFileSync(p, body, 'utf8'); done++; }
  else if (ok) done++;
}
console.log(`\nRETITLE_SUMMARY posts=${done} translations=${translated} failed=${failed}${DRY ? ' (dry)' : ''}`);
