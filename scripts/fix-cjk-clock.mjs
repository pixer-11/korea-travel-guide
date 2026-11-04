#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  ENGLISH CLOCK TIMES INSIDE KOREAN, JAPANESE AND CHINESE PROSE
//
//  「宫殿每天11am至6pm开放」, 「7am～8amが最も空いている」, 「평일 9am부터」 —
//  found 2026-11-04 on 248 zh, 181 ja and 124 ko pages (6,816 times), each
//  beside a crowd box that already said 上午9点 / 午前9時 / 오전 9시 and beside
//  13,000+ times per language the translator had written natively. The rule
//  that rewrites them is lib/localize-clock.mjs; translate-posts applies it at
//  write time, so a new translation is born right. This pass catches every
//  other writer (repairs, FAQ re-asks, partial prose patches) and runs nightly
//  in publish.yml next to fix-cjk-punctuation, the script it is modelled on.
//
//  Deterministic: no model call, no new words — the number and the meridiem
//  the translator wrote are kept, only their shape changes. Spanish is left
//  alone (the box prints 9am there too).
//
//    node scripts/fix-cjk-clock.mjs            # report only
//    node scripts/fix-cjk-clock.mjs --apply    # rewrite the files
//    node scripts/fix-cjk-clock.mjs --apply --only=zh/slug,ja/slug
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import matter from 'gray-matter';
import { localizeClock, countEnglishClock } from './lib/localize-clock.mjs';

const APPLY = process.argv.includes('--apply');
const LANGS = ['ko', 'ja', 'zh'];
const ONLY = (() => {
  const a = process.argv.find((x) => x.startsWith('--only='));
  return a ? new Set(a.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)) : null;
})();

// Same reasoning as fix-cjk-punctuation: the naturalness store re-judges a
// translation whose text hash moved. Writing 上午9点 for 9am cannot make a page
// read worse, so the stored score is carried and only the hash is restamped.
const QUALITY_STORE = 'data/translation-quality.json';
const quality = existsSync(QUALITY_STORE) ? JSON.parse(readFileSync(QUALITY_STORE, 'utf8')) : null;
let restamped = 0;
// Only a score given to exactly the text being edited is carried; one given to
// an older text stays as it was, and the judge reads the page again.
const hashOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const restampQuality = (key, before, after) => {
  const entry = quality?.[key];
  if (!entry?.hash || entry.hash !== hashOf(before)) return;
  entry.hash = hashOf(after);
  restamped++;
};

// Edited as TEXT, never re-serialized (a gray-matter round-trip strips
// srcHash's quotes and re-wraps quickAnswer — see fix-cjk-punctuation). The
// identity lines are never touched; every other line is prose.
const KEEP = /^(srcHash|lang|slug):/;
// Only the value is prose: 「  - a: 」 is YAML, and its space is structure.
const KEY = /^(\s*(?:- )?[A-Za-z_][\w-]*:[ \t]?)(.*)$/s;
const fixFront = (front, lang) => front.split('\n').map((l) => {
  if (KEEP.test(l)) return l;
  const m = l.match(KEY);
  return m ? m[1] + localizeClock(m[2], lang) : localizeClock(l, lang);
}).join('\n');
// The band 2PM and code do not count as left over.
const countClock = countEnglishClock;

function splitFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
  return m ? { head: m[0], front: m[1], body: raw.slice(m[0].length) } : null;
}

// What the parsed file should become: every prose string through the same rule.
const expect = (v, lang, key) => {
  if (typeof v === 'string') return KEEP.test(`${key}:`) ? v : localizeClock(v, lang);
  if (Array.isArray(v)) return v.map((x) => expect(x, lang, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expect(x, lang, k)]));
  return v;
};

let skipped = 0;
function fixFile(path, lang, key) {
  const raw = readFileSync(path, 'utf8');
  const parts = splitFrontmatter(raw);
  if (!parts) return { n: 0, left: 0 };
  const front = fixFront(parts.front, lang);
  const body = localizeClock(parts.body, lang);
  const n = countClock(parts.front) + countClock(parts.body) - countClock(front) - countClock(body);
  const left = countClock(front) + countClock(body);
  if ((front === parts.front && body === parts.body) || !APPLY) return { n, left, changed: front !== parts.front || body !== parts.body };

  // A function, not a string: a string replacement reads "$$" as "$" and wrote
  // the price level 「(대략 $$)」 as 「(대략 $)」 (caught by the check below, 11-04).
  const next = parts.head.replace(parts.front, () => front) + body;
  // Read back before writing: the same keys, the same srcHash, and every value
  // exactly what the rule makes of the old one — a line edit that YAML reads
  // differently (a folded scalar, an escape) is skipped, not guessed at.
  let before, after;
  try { before = matter(raw); after = matter(next); } catch (e) {
    console.error(`  ⚠ ${key}: the edited frontmatter does not parse (${String(e.reason || e.message).slice(0, 60)}) — skipped`);
    skipped++;
    return { n: 0, left: countClock(raw) };
  }
  const okShape = isDeepStrictEqual(Object.keys(before.data).sort(), Object.keys(after.data).sort())
    && String(before.data.srcHash) === String(after.data.srcHash);
  const okValues = isDeepStrictEqual(expect(before.data, lang, ''), after.data) && localizeClock(before.content, lang) === after.content;
  if (!okShape || !okValues) {
    console.error(`  ⚠ ${key}: ${okShape ? 'a value did not come out as the rule says' : 'frontmatter changed shape'} — skipped`);
    skipped++;
    return { n: 0, left: countClock(raw) };
  }
  writeFileSync(path, next);
  restampQuality(key, raw, next);
  return { n, left, changed: true };
}

const live = (slug) => {
  const p = `src/content/posts/${slug}.md`;
  if (!existsSync(p)) return false;
  try { return !matter(readFileSync(p, 'utf8')).data.draft; } catch { return false; }
};

let files = 0, times = 0, leftover = 0;
const worst = [], stuck = [];
for (const lang of LANGS) {
  const dir = `src/content/i18n/${lang}`;
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const slug = f.replace(/\.md$/, '');
    const key = `${lang}/${slug}`;
    if (ONLY && !ONLY.has(key)) continue;
    if (!ONLY && !live(slug)) continue;
    const { n, left, changed } = fixFile(`${dir}/${f}`, lang, key);
    if (changed) { files++; times += n; worst.push([key, n]); }
    if (left) { leftover += left; stuck.push([key, left]); }
  }
}

if (APPLY && restamped) {
  writeFileSync(QUALITY_STORE, JSON.stringify(quality, null, 1) + '\n');
  console.log(`품질 판정 ${restamped}건은 해시만 갱신 — 재심사 비용 0(시각 표기 정리는 점수를 낮출 수 없음).`);
}
worst.sort((a, b) => b[1] - a[1]);
for (const [k, n] of worst.slice(0, 8)) console.log(`  ${String(n).padStart(4)}  ${k}`);
if (stuck.length) console.log(`  못 바꾼 영어식 시각 ${leftover}개: ${stuck.slice(0, 8).map(([k, n]) => `${k}(${n})`).join(' ')}`);
console.log(`\nCJK_CLOCK_SUMMARY files=${files} times=${times} left=${leftover} skipped=${skipped} restamped=${restamped} applied=${APPLY}`);
if (!APPLY && files) console.log('보고만 했습니다 — 실제로 고치려면 --apply 를 붙이세요.');
