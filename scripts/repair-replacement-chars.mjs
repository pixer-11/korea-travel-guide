#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  PUT BACK THE LETTERS THE BATCH READER CUT IN HALF.
//
//  2026-09-27..10-05 every batch translation passed through a decoder that cut
//  multi-byte letters at network chunk boundaries (lib/claude-batch.mjs), and
//  523 translations shipped with 775 broken lines — 「돌��오나요?」 in a Korean
//  FAQ, 「嘉義旧監��」 in a Japanese <title>. The reader is fixed and the
//  translator now refuses U+FFFD; this repairs what already shipped.
//
//  Re-translating 523 files would cost a full translation each and rewrite
//  thousands of correct sentences. Instead each broken LINE goes to the model
//  with its neighbours for context, and the answer is accepted only if it is the
//  same line with each gap filled by one or two letters and nothing else
//  changed (lib/replacement-char.mjs isFaithfulRestore). A line it cannot
//  restore faithfully is left as it is and listed.
//
//    node scripts/repair-replacement-chars.mjs            # all of src/content/i18n
//    LIMIT=5 node scripts/repair-replacement-chars.mjs     # first 5 files
//    DRY=1 node scripts/repair-replacement-chars.mjs       # show, do not write
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import './lib/claude-meter.mjs'; // counts this file's Claude spend into the cost ledger
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { hasReplacementChar, isFaithfulRestore } from './lib/replacement-char.mjs';

const ROOT = fileURLToPath(new URL('../src/content/i18n/', import.meta.url));
const MODEL = process.env.REPAIR_MODEL || 'claude-opus-5-5';
const DRY = process.env.DRY === '1';
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const LANG = { ko: 'Korean', ja: 'Japanese', zh: 'Simplified Chinese', es: 'Spanish' };

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 6 });

async function restoreLine(lang, before, line, after) {
  const prompt = [
    `This line from a ${LANG[lang] || lang} travel guide lost letters to an encoding error: each run of "�" (one or two in a row) stands for ONE letter that was there.`,
    'Put back the letter that belongs in each gap, judging from the words around it. Change nothing else at all: same punctuation, spacing, quotes and markup.',
    'Reply with the repaired line only, inside <line></line>.',
    '',
    `Line before (context, do not return): ${before || '(none)'}`,
    `Line after (context, do not return): ${after || '(none)'}`,
    '',
    `<line>${line}</line>`,
  ].join('\n');
  const msg = await client.messages.create({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
  const text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  return text.match(/<line>([\s\S]*?)<\/line>/)?.[1] ?? null;
}

const files = [];
for (const lang of await readdir(ROOT)) {
  for (const f of await readdir(join(ROOT, lang))) {
    if (!f.endsWith('.md')) continue;
    const path = join(ROOT, lang, f);
    if (hasReplacementChar(await readFile(path, 'utf8'))) files.push({ lang, path, key: `${lang}/${f.replace(/\.md$/, '')}` });
  }
}
const todo = LIMIT ? files.slice(0, LIMIT) : files;
console.log(`${files.length} file(s) carry U+FFFD; repairing ${todo.length}${DRY ? ' (DRY)' : ''} with ${MODEL}`);

let fixedLines = 0, keptLines = 0, writtenFiles = 0;
const refused = [];
let next = 0;
async function worker() {
  while (next < todo.length) {
    const { lang, path, key } = todo[next++];
    const raw = await readFile(path, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/);
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      if (!hasReplacementChar(lines[i])) continue;
      const orig = lines[i];
      const ctx = (j) => (lines[j] && !hasReplacementChar(lines[j]) ? lines[j].slice(0, 400) : '');
      let ok = null;
      for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
        try {
          const got = await restoreLine(lang, ctx(i - 1) || ctx(i - 2), orig, ctx(i + 1) || ctx(i + 2));
          if (isFaithfulRestore(orig, got)) ok = got;
        } catch (e) {
          console.log(`  ! ${key}:${i + 1} — ${String(e.message).slice(0, 100)}`);
        }
      }
      if (ok) {
        lines[i] = ok;
        changed = true;
        fixedLines++;
        console.log(`  ✓ ${key}:${i + 1}  ${orig.replace(/\s+/g, ' ').slice(0, 60)}  →  ${ok.replace(/\s+/g, ' ').slice(0, 60)}`);
      } else {
        keptLines++;
        refused.push(`${key}:${i + 1}`);
        console.log(`  ✗ ${key}:${i + 1} — no faithful restore, left as is`);
      }
    }
    // The front matter must still parse with every restored line in place: a
    // line-by-line check cannot see YAML it breaks (Codex, 10-05).
    if (changed) {
      const out = lines.join(eol);
      const end = out.indexOf(`${eol}---`, 4);
      try { yaml.load(out.slice(4, end)); } catch (e) {
        console.log(`  ✗ ${key} — front matter no longer parses (${String(e.message).split('\n')[0]}), file left as is`);
        refused.push(key);
        keptLines++;
        changed = false;
      }
    }
    if (changed && !DRY) {
      await writeFile(path, lines.join(eol));
      writtenFiles++;
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
console.log(`\nREPLACEMENT_REPAIR files=${todo.length} written=${writtenFiles} lines_fixed=${fixedLines} lines_left=${keptLines}${DRY ? ' (DRY)' : ''}`);
if (refused.length) console.log(`left as is: ${refused.slice(0, 40).join(' ')}${refused.length > 40 ? ' …' : ''}`);
if (keptLines) process.exitCode = 1;
