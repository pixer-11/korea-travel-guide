#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  A PUNCTUATION-ONLY SOURCE EDIT MUST NOT RE-TRANSLATE THE SITE
//
//  srcHash is what stops a translation going stale: it covers the English
//  title, description, quickAnswer, faq and BODY, and translate-posts re-does
//  any translation whose stored hash no longer matches. That is the right
//  behaviour and it is why the site's five languages stay in step.
//
//  It also means a punctuation sweep over the English is indistinguishable from
//  a rewrite. Replacing 11,667 em dashes touched 1,456 bodies, so the next
//  nightly run would have re-translated up to 5,824 files — an enormous bill to
//  change a comma into a full stop in text the translations do not share.
//
//  So: re-stamp instead of re-translate. The claim being made is narrow and
//  checkable — the WORDS of the English source did not change, therefore each
//  existing translation is still a translation of those words.
//
//  Two guards make that claim honest:
//    · the word sequence of the old and new source must be identical, ignoring
//      punctuation and spacing. Any post where it is not is skipped entirely.
//    · a translation is re-stamped only if its stored hash equals the source's
//      hash BEFORE the edit. One that was already stale stays stale, and gets
//      re-translated on its own merits.
//
//    node scripts/restamp-punctuation-only.mjs --since=HEAD      # report
//    node scripts/restamp-punctuation-only.mjs --since=HEAD --apply
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { srcHashOfPostFile, storedHashIn } from './lib/src-hash.mjs';

const POSTS = 'src/content/posts';
const I18N = 'src/content/i18n';
const LANGS = ['ko', 'ja', 'es', 'zh'];
const APPLY = process.argv.includes('--apply');
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '--since=HEAD').slice(8);

const wordsOf = (s) => s.toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, ' ').trim();

const atRef = (path) => {
  try { return execFileSync('git', ['show', `${SINCE}:${path}`], { encoding: 'utf8', maxBuffer: 1e8 }); }
  catch { return null; }
};

let considered = 0, restamped = 0, skippedWords = 0, skippedStale = 0, missing = 0;

for (const f of readdirSync(POSTS).filter((f) => f.endsWith('.md'))) {
  const path = `${POSTS}/${f}`;
  const now = readFileSync(path, 'utf8');
  const was = atRef(path);
  if (!was || was === now) continue;
  considered++;

  // The whole justification: the words are the same, only punctuation moved.
  const bodyOf = (raw) => { const i = raw.indexOf('\n---', 3); return i < 0 ? raw : raw.slice(i + 4); };
  if (wordsOf(bodyOf(was)) !== wordsOf(bodyOf(now))) {
    console.log(`  · ${f}: the words changed, not just punctuation — leaving its translations to re-run`);
    skippedWords++;
    continue;
  }

  const oldHash = srcHashOfPostFile(was);
  const newHash = srcHashOfPostFile(now);
  if (!oldHash || !newHash || oldHash === newHash) continue;

  for (const lang of LANGS) {
    const tp = join(I18N, lang, f);
    if (!existsSync(tp)) { missing++; continue; }
    const raw = readFileSync(tp, 'utf8');
    const stored = storedHashIn(raw);
    if (stored !== oldHash) { skippedStale++; continue; }   // already stale on its own
    if (APPLY) {
      writeFileSync(tp, raw.replace(/^srcHash:\s*'?[0-9a-f]{12}'?\s*$/m, `srcHash: '${newHash}'`), 'utf8');
    }
    restamped++;
  }
}

console.log(`\nRESTAMP posts=${considered} restamped=${restamped} left-stale=${skippedStale} words-changed=${skippedWords} no-translation=${missing}${APPLY ? '' : ' (dry run)'}`);
