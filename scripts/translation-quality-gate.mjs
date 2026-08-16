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
import { judgeTranslation, judgeStats } from './lib/translation-quality.mjs';

const STORE = 'data/translation-quality.json';
const hashOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

// A quarantined post is unreadable AND unrepairable here: translate-posts
// skips drafts, so the rewrite below printed "re-translating once", translated
// nothing ("Nothing to translate — all up to date"), and filed the post as
// stubborn. On 2026-08-16 that accounted for 141 of 217 flagged translations —
// money spent judging pages no reader can reach, and a repair line in the log
// that never happened. The corpus catch-up judges them when they go live.
const isDraft = (slug) => {
  const p = `src/content/posts/${slug}.md`;
  if (!existsSync(p)) return true;
  try { return !!matter(readFileSync(p, 'utf8')).data.draft; } catch { return true; }
};

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

// SAMPLE, not census. Judging every translation every night cost ~40 model
// calls a day — as much as producing the translations themselves — and the
// 2026-08-16 measurements said that spend was buying very little: the one
// rewrite this gate attempts does not fix the hard tail (a live flagged post
// re-translated came back at the same score, and the 08-15 rounds stalled on
// the same tail). What HAS moved the corpus is fixing the PROMPT — the
// wrong-language leak on 08-15, the half-width punctuation on 08-16 — and a
// prompt-level defect shows up in a sample just as clearly as in a census.
//
// So: a few per language, enough to notice a systematic fault within a night
// or two, at a fraction of the bill. Set TRANSLATION_GATE_SAMPLE=0 to go back
// to judging everything.
const SAMPLE = process.env.TRANSLATION_GATE_SAMPLE === undefined ? 3 : Number(process.env.TRANSLATION_GATE_SAMPLE);
let skippedSample = 0;
if (SAMPLE > 0 && !keys.length) {
  const perLang = {};
  const kept = [];
  for (const f of files) {
    const lang = f.match(/i18n\/(ko|ja|es|zh)\//)?.[1];
    if (!lang) { kept.push(f); continue; }
    perLang[lang] = (perLang[lang] || 0) + 1;
    if (perLang[lang] <= SAMPLE) kept.push(f);
    else skippedSample++;
  }
  if (skippedSample) console.log(`표본 심사: 언어당 ${SAMPLE}편만 — ${skippedSample}편은 이번 판정 생략(비용).`);
  files = kept;
}

const store = existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};
const flagged = [];
let judged = 0, skippedDraft = 0;

for (const f of files) {
  const m = f.match(/i18n\/(ko|ja|es|zh)\/(.+)\.md$/);
  if (!m) continue;
  const [, lang, slug] = m;
  if (isDraft(slug)) { skippedDraft++; continue; }
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
// judgeFailed belongs in the summary line, not only in a ⚠ that scrolls past:
// a judge answering "unavailable" looks identical to a clean run from here.
console.log(`\nTRANSLATION_GATE_SUMMARY judged=${judged} flagged=${flagged.length} fixed=${flagged.length - stubborn} stubborn=${stubborn} draftSkipped=${skippedDraft} sampleSkipped=${skippedSample} judgeFailed=${judgeStats.failed}`);
