#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  RE-TRANSLATE THE TRANSLATIONS THE JUDGE MARKED POOR
//
//  audit-translation-quality scores every translated post 0-3 and writes the
//  score-2+ list to data/translation-quality-flagged.txt. Nothing read that file.
//  It had 105 names in it on 2026-09-07 — a list of known-bad pages, produced
//  every week, acted on never. A repair tool is not finished until something
//  runs it; an audit that only makes a list is half a tool.
//
//  The English source is fine in these cases, so srcHash cannot re-queue them:
//  the hash only changes when the source changes. The way to make translate-posts
//  redo a file is to remove it, so it counts as missing. That leaves a hole, so
//  this deletes in small batches, refills immediately, and puts back anything the
//  translator failed to produce — a page with no translation 404s in that
//  language, which is worse than a clumsy sentence.
//
//    node scripts/repair-flagged-translations.mjs             # 20 worst
//    LIMIT=60 node scripts/repair-flagged-translations.mjs
//    DRY=1 node scripts/repair-flagged-translations.mjs       # list, touch nothing
// ─────────────────────────────────────────────────────────────
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const STORE = 'data/translation-quality.json';
const LIMIT = Number(process.env.LIMIT || 20);
const BATCH = Number(process.env.BATCH || 10);
const DRY = process.env.DRY === '1';

const fileOf = (key) => {
  const [lang, ...rest] = key.split('/');
  return `src/content/i18n/${lang}/${rest.join('/')}.md`;
};

// The store is the source of truth; the .txt list is a report of one past run and
// was already 31 names out of date when this was written.
const store = JSON.parse(readFileSync(STORE, 'utf8'));
const flagged = Object.entries(store)
  .filter(([, v]) => v?.score >= 2)
  .sort((a, b) => b[1].score - a[1].score)
  .map(([key, v]) => ({ key, score: v.score, file: fileOf(key) }))
  .filter((j) => existsSync(j.file));

console.log(`${flagged.length} translation(s) judged poor (score 2+)`);
if (DRY) {
  for (const j of flagged.slice(0, LIMIT)) console.log(`  score ${j.score}  ${j.key}`);
  console.log('--dry: nothing deleted, nothing called.');
  process.exit(0);
}

const targets = flagged.slice(0, LIMIT);
let repaired = 0, restored = 0;

for (let i = 0; i < targets.length; i += BATCH) {
  const batch = targets.slice(i, i + BATCH);
  const kept = new Map(batch.map((j) => [j.file, readFileSync(j.file, 'utf8')]));

  for (const j of batch) await unlink(j.file);

  const run = spawnSync(process.execPath, ['scripts/translate-posts.mjs'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 5e7,
  });
  const summary = /TRANSLATE_SUMMARY .*/.exec(`${run.stdout}\n${run.stderr}`)?.[0] ?? '(no summary)';

  for (const j of batch) {
    if (existsSync(j.file)) {
      repaired++;
      // The judge must look at the new text, not remember the old verdict.
      delete store[j.key];
    } else {
      // Never leave a language without its page.
      writeFileSync(j.file, kept.get(j.file), 'utf8');
      restored++;
      console.log(`  ↩ ${j.key} — translator did not produce it; old text put back`);
    }
  }
  writeFileSync(STORE, JSON.stringify(store, null, 1), 'utf8');
  console.log(`batch ${i / BATCH + 1}: ${summary}`);
}

console.log(`\nFLAGGED_TRANSLATION_REPAIR repaired=${repaired} restored=${restored} remaining=${flagged.length - repaired}`);
