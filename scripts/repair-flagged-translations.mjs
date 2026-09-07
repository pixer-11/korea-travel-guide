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

// KEYS lets another audit hand its own list to the same safe machinery — delete
// in small batches, refill at once, restore on failure. The first caller is
// audit-ended-event-tense-i18n, whose findings the quality judge cannot see:
// the English is fine, so nothing in the score store points at them.
//   KEYS="$(node scripts/audit-ended-event-tense-i18n.mjs --list | grep '^ENDED-EVENT-I18N-TENSE:' | awk '{print $2}')" node scripts/repair-flagged-translations.mjs
// Deduplicated on purpose. `KEYS="ko/foo ko/foo"` used to pass the existence
// filter twice: the first unlink succeeded, the second threw ENOENT, and because
// the restore loop is further down the same block, ko/foo.md was never put back.
// A repair tool that deletes a reader's page is worse than the clumsy sentence
// it was sent to fix.
const KEYS = [...new Set((process.env.KEYS || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];

// A named key whose file is already gone was silently dropped from the list, and
// the run then reported `repaired=0 restored=0 remaining=0` — a completed no-op
// over a page that has no translation at all. Say so instead.
const absent = KEYS.filter((key) => !existsSync(fileOf(key)));
for (const key of absent) console.log(`  ⚠ ${key} — no such translation on disk; it is missing, not poor. Not repaired here.`);

const flagged = KEYS.length
  ? KEYS.map((key) => ({ key, score: '-', file: fileOf(key) })).filter((j) => existsSync(j.file))
  : Object.entries(store)
      .filter(([, v]) => v?.score >= 2)
      .sort((a, b) => b[1].score - a[1].score)
      .map(([key, v]) => ({ key, score: v.score, file: fileOf(key) }))
      .filter((j) => existsSync(j.file));

console.log(KEYS.length
  ? `${flagged.length} translation(s) named on the command line`
  : `${flagged.length} translation(s) judged poor (score 2+)`);
if (DRY) {
  for (const j of flagged.slice(0, LIMIT)) console.log(`  score ${j.score}  ${j.key}`);
  console.log('--dry: nothing deleted, nothing called.');
  process.exit(0);
}

const targets = flagged.slice(0, LIMIT);
let repaired = 0, restored = 0, translatorFailures = 0;

for (let i = 0; i < targets.length; i += BATCH) {
  const batch = targets.slice(i, i + BATCH);
  const kept = new Map(batch.map((j) => [j.file, readFileSync(j.file, 'utf8')]));

  // Everything from here to the end of the batch runs inside try/finally. Between
  // the unlink and the restore loop there was an unprotected window: any throw —
  // a duplicate key, a disk error, an interrupt — left the batch's translations
  // deleted, and the publish workflow, which softens a repair failure, would then
  // stage and commit the deletion. The finally puts back anything still missing.
  try {
  for (const j of batch) await unlink(j.file);

  // translate-posts fills whatever is missing SITE-WIDE, so a batch of twelve can
  // be crowded out by other gaps and come back with three of its own files still
  // absent (seen 2026-09-07). Run it again while any of this batch is missing, and
  // only then fall back to restoring.
  let summary = '(no summary)';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const run = spawnSync(process.execPath, ['scripts/translate-posts.mjs'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 5e7,
    });
    summary = /TRANSLATE_SUMMARY .*/.exec([run.stdout, run.stderr].join('\n'))?.[0] ?? '(no summary)';
    // The translator's own verdict was never read. It could write the files and
    // still exit non-zero — a language that failed, an API limit part-way — and
    // this reported a clean repair. It does not change what we keep (the files
    // are judged on their own below), but it must not vanish from the result.
    if (run.status !== 0) {
      translatorFailures++;
      console.log(`  ⚠ translate-posts exited ${run.status}${run.signal ? ` (${run.signal})` : ''} — the files below are judged on their contents, but the translator reported a failure`);
    }
    if (batch.every((j) => existsSync(j.file))) break;
    if (attempt < 3) console.log(`  ↻ batch incomplete, running the translator again (${attempt + 1}/3)`);
  }

  for (const j of batch) {
    // A file existing is not a file translated. If the translator wrote a stub,
    // truncated the file, or died mid-write, existsSync is still true — and the
    // old code counted that as repaired, dropped the stored verdict, and threw
    // away the good copy. Require a real document: frontmatter and some body.
    const made = existsSync(j.file) ? readFileSync(j.file, 'utf8') : '';
    // Measuring the WHOLE file let frontmatter alone clear the bar: a 240-character
    // description with no article under it counted as a repaired translation, the
    // stored verdict was dropped, and the good copy was thrown away. Measure the
    // body, and only the body. A real translated guide runs to several thousand
    // characters; 400 is a floor no stub reaches and no genuine article approaches.
    const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(made);
    const body = fm ? made.slice(fm[0].length) : '';
    const looksTranslated = Boolean(fm) && body.trim().length > 400;
    if (looksTranslated) {
      repaired++;
      // The judge must look at the new text, not remember the old verdict.
      delete store[j.key];
    } else {
      // Never leave a language without its page.
      writeFileSync(j.file, kept.get(j.file), 'utf8');
      restored++;
      console.log(`  ↩ ${j.key} — translator produced ${made ? 'an incomplete file' : 'nothing'}; old text put back`);
    }
  }
  writeFileSync(STORE, JSON.stringify(store, null, 1), 'utf8');
  console.log(`batch ${i / BATCH + 1}: ${summary}`);
  } finally {
    // Whatever happened above, no reader loses a page to this tool.
    for (const [file, text] of kept) {
      // A restore that throws must not replace the error that caused the abort:
      // JavaScript propagates only the exception raised inside finally, so an
      // ENOSPC here would hide the EACCES that started it. Report and carry on.
      try {
        if (!existsSync(file)) {
          writeFileSync(file, text, 'utf8');
          console.log(`  ↩ ${file} — restored after an interrupted batch`);
        }
      } catch (err) {
        console.log(`  ❗ ${file} — COULD NOT BE RESTORED: ${err.message}`);
      }
    }
  }
}

// `absent` are keys that were asked for and have no file at all. Leaving them out
// of `remaining` reported a completed no-op — repaired=0 restored=0 remaining=0 —
// over pages that have no translation in that language whatsoever.
const remaining = flagged.length - repaired + absent.length;
console.log(`\nFLAGGED_TRANSLATION_REPAIR repaired=${repaired} restored=${restored} missing=${absent.length} translator-failures=${translatorFailures} remaining=${remaining}`);
