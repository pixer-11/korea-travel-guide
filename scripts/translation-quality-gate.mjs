#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  DAILY TRANSLATION QUALITY GATE (runs inside publish.yml, after
//  translate-posts and BEFORE the day's commit — a repair after the push
//  never happened, per the photo-identity strip lesson of 2026-08-14).
//
//  Scores every i18n file the run created or changed (same judge as the
//  full-corpus audit — scripts/lib/translation-quality.mjs). Any score 2+
//  is re-translated once through translate-posts' rewrite prompt and
//  re-scored; a stubborn 2+ is only reported (the corpus audit will keep
//  seeing it). This is the tap: the 08-15 corpus cleanup drained the tub,
//  this keeps new water clean. Owner's directive (2026-08-15): "앞으로
//  이런 문제가 안 생기도록 해라. 전체 다 매끄럽게."
//
//    node scripts/translation-quality-gate.mjs            # judge uncommitted i18n changes
//    node scripts/translation-quality-gate.mjs a b c      # judge specific lang/slug keys
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { judgeTranslation } from './lib/translation-quality.mjs';

const STORE = 'data/translation-quality.json';
const hashOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

// Which translations did this run touch? Uncommitted new/modified i18n files.
const keys = process.argv.slice(2).filter((a) => !a.startsWith('-'));
let files = [];
if (keys.length) {
  files = keys.map((k) => `src/content/i18n/${k}.md`);
} else {
  const out = execSync('git status --porcelain -- src/content/i18n', { encoding: 'utf8' });
  files = out.split('\n').map((l) => l.slice(3).trim()).filter((f) => f.endsWith('.md'));
}
if (!files.length) { console.log('translation gate: nothing new to judge'); process.exit(0); }

const store = existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};
const flagged = [];
let judged = 0;

for (const f of files) {
  const m = f.match(/i18n\/(ko|ja|es|zh)\/(.+)\.md$/);
  if (!m) continue;
  const [, lang, slug] = m;
  let raw;
  try { raw = readFileSync(f, 'utf8'); } catch { continue; }
  const v = await judgeTranslation(lang, matter(raw).content);
  if (!v) { console.log(`  ⚠ ${lang}/${slug}: judge unavailable`); continue; }
  judged++;
  store[`${lang}/${slug}`] = { hash: hashOf(raw), ...v, at: new Date().toISOString() };
  console.log(`  ${v.score >= 2 ? '✗' : '✓'} ${lang}/${slug} → ${v.score}${v.registerBreak ? ' R' : ''}`);
  if (v.score >= 2) flagged.push({ lang, slug });
}

// One rewrite attempt for the flagged, then re-judge. translate-posts carries
// the rewrite prompt; --force re-queues even though a translation exists.
if (flagged.length) {
  const only = flagged.map((x) => `${x.lang}/${x.slug}`).join(',');
  console.log(`\n${flagged.length} translation(s) scored 2+ — re-translating once: ${only}`);
  try {
    execSync(`node scripts/translate-posts.mjs --force --only=${only}`, { stdio: 'inherit' });
  } catch { /* partial failure: re-judge whatever changed */ }
  for (const { lang, slug } of flagged) {
    const f = `src/content/i18n/${lang}/${slug}.md`;
    let raw;
    try { raw = readFileSync(f, 'utf8'); } catch { continue; }
    const v = await judgeTranslation(lang, matter(raw).content);
    if (!v) continue;
    store[`${lang}/${slug}`] = { hash: hashOf(raw), ...v, at: new Date().toISOString() };
    console.log(`  retry ${lang}/${slug} → ${v.score}${v.score >= 2 ? ' (남음 — 전수 감사가 추적)' : ' ✓'}`);
  }
}

writeFileSync(STORE, JSON.stringify(store, null, 1) + '\n');
const stubborn = flagged.filter(({ lang, slug }) => (store[`${lang}/${slug}`]?.score ?? 0) >= 2).length;
console.log(`\nTRANSLATION_GATE_SUMMARY judged=${judged} flagged=${flagged.length} fixed=${flagged.length - stubborn} stubborn=${stubborn}`);
