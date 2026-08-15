#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  TRANSLATION NATURALNESS AUDIT
//
//  Reads each translated post the way its reader does — target language only,
//  no source comparison — and asks a native-editor model one question: would
//  a native reader suspect this was translated from English?
//
//  Born 2026-08-15: the owner read English word order inside a Korean
//  paragraph ("작은 트럭들, ~준비를 마친" — a dangling modifier no Korean
//  writer would produce). An 80-post sample then measured the corpus:
//  13% clearly translation-flavored (score 2+), zh worst at 21%, and zero
//  posts scored 0 (indistinguishable from native). Structure/leak checks
//  already exist elsewhere; THIS audit owns sentence quality alone.
//
//  Scores (stored in data/translation-quality.json, resumable):
//    0 native · 1 minor awkwardness · 2 clearly translation-flavored · 3 severe
//  Score 2+ posts are re-translated through translate-posts.mjs's rewrite
//  prompt (--force), then re-scored on the next run — the store keys on the
//  i18n file's CONTENT HASH, so a re-translated post is re-judged, and an
//  unchanged one is never billed twice.
//
//    node scripts/audit-translation-quality.mjs                # judge everything unjudged
//    node scripts/audit-translation-quality.mjs --langs=zh     # one language
//    node scripts/audit-translation-quality.mjs --limit=100    # budget cap
//    node scripts/audit-translation-quality.mjs --report       # summary + worst list only, no API calls
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { judgeTranslation, LANGS } from './lib/translation-quality.mjs';

const STORE = 'data/translation-quality.json';
const CONCURRENCY = 5;
const LIMIT = (() => { const i = process.argv.findIndex((a) => a.startsWith('--limit=')); return i > -1 ? Number(process.argv[i].split('=')[1]) : Infinity; })();
const ONLY_LANGS = (() => { const a = process.argv.find((x) => x.startsWith('--langs=')); return a ? new Set(a.split('=')[1].split(',')) : null; })();
const REPORT_ONLY = process.argv.includes('--report');

const store = existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};
const hashOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

// Collect every translated post with its current content hash.
const jobs = [];
for (const lang of Object.keys(LANGS)) {
  if (ONLY_LANGS && !ONLY_LANGS.has(lang)) continue;
  const dir = `src/content/i18n/${lang}`;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const raw = readFileSync(`${dir}/${f}`, 'utf8');
    const key = `${lang}/${f.replace(/\.md$/, '')}`;
    const h = hashOf(raw);
    if (store[key]?.hash === h && store[key].score != null) continue; // judged this exact text
    jobs.push({ key, lang, raw, h });
  }
}

const summarize = () => {
  const rows = Object.entries(store).filter(([, v]) => v.score != null);
  for (const lang of Object.keys(LANGS)) {
    const rs = rows.filter(([k]) => k.startsWith(lang + '/'));
    if (!rs.length) continue;
    const dist = [0, 1, 2, 3].map((n) => rs.filter(([, v]) => v.score === n).length);
    const bad = dist[2] + dist[3];
    console.log(`${lang}: n=${rs.length} · 0/1/2/3 = ${dist.join('/')} · score2+ ${bad} (${Math.round((bad / rs.length) * 100)}%)`);
  }
  const flagged = rows.filter(([, v]) => v.score >= 2).map(([k]) => k);
  writeFileSync('data/translation-quality-flagged.txt', flagged.join('\n') + '\n');
  console.log(`\nscore2+ 총 ${flagged.length}건 → data/translation-quality-flagged.txt`);
  console.log(`TRANSLATION_QUALITY_SUMMARY judged=${rows.length} flagged=${flagged.length}`);
};

if (REPORT_ONLY) { summarize(); process.exit(0); }
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }

const todo = jobs.slice(0, LIMIT);
console.log(`${jobs.length} unjudged translation(s) · judging ${todo.length} (concurrency ${CONCURRENCY})`);

let done = 0, failed = 0;
async function judge(job) {
  const v = await judgeTranslation(job.lang, matter(job.raw).content);
  if (!v) { failed++; return; }
  store[job.key] = { hash: job.h, ...v, at: new Date().toISOString() };
  done++;
}

let cursor = 0;
async function worker() {
  while (cursor < todo.length) {
    const job = todo[cursor++];
    await judge(job);
    if ((done + failed) % 50 === 0) {
      writeFileSync(STORE, JSON.stringify(store, null, 1) + '\n'); // checkpoint
      console.log(`  … ${done + failed}/${todo.length} (실패 ${failed})`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync(STORE, JSON.stringify(store, null, 1) + '\n');
console.log(`\njudged ${done} · failed ${failed}`);
summarize();
