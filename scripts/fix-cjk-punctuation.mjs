#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  HALF-WIDTH PUNCTUATION INSIDE CHINESE PROSE
//
//  Chinese sets its own punctuation full-width: 中文，然后 — never 中文,然后.
//  A half-width comma wedged between two Han characters is one of the loudest
//  "this came out of an English sentence" tells there is, and a native reader
//  clocks it before reading a word.
//
//  Found 2026-08-16, while asking why the naturalness judge rated zh at 8%
//  translation-flavored against 1-2% for ko/ja/es: 506 of 1,007 live Chinese
//  pages carried it, and 50 of the 80 zh pages the judge had flagged were in
//  that set. The judge was right and the cause was mechanical — so this is a
//  deterministic repair, not an LLM rewrite. It costs nothing and cannot
//  invent prose.
//
//  ── the three boundaries, each one measured before it was drawn ──
//
//  1. The mark must sit BETWEEN two CJK characters. That is what makes it
//     safe: "2,109 条评论" (digits), "River Valley Road, Singapore" (Latin),
//     every URL and markdown link keep their half-width marks, because none
//     has a Han character on the left. Widening this is how you corrupt a price.
//
//  2. Chinese only. Japanese was in the first draft of this script and had to
//     come out: ja has ZERO half-width commas, and its only hits (459 in
//     frontmatter, 136 in body) are the site's own "名前:旅行ガイド" title
//     separator. Converting those would have rewritten every Japanese title
//     and moved a suffix that eventName.mjs and topic-key.mjs both parse.
//
//  3. Frontmatter takes the comma ONLY. The colon there is that same title
//     convention in Chinese ("3Fils 阿布扎比店:旅行指南"), load-bearing for the
//     same two modules. In the BODY a colon is ordinary prose ("双重身份:一半
//     是艺术画廊") and is converted.
//
//    node scripts/fix-cjk-punctuation.mjs            # report only
//    node scripts/fix-cjk-punctuation.mjs --apply    # rewrite the files
//    node scripts/fix-cjk-punctuation.mjs --apply --only=zh/slug
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';

const APPLY = process.argv.includes('--apply');

// Editing a file changes its content hash, which is how the naturalness store
// decides a translation needs re-judging. Left alone, this repair would have
// handed the judge a 475-file bill for re-scoring text it had already scored —
// paying a model to re-read 24,002 commas.
//
// It does not need to: this repair cannot make a translation read worse. On the
// 80 flagged zh pages, re-judging after the pass moved 25 DOWN a score and none
// up. So the stored score is carried forward and only the hash is restamped —
// which leaves the old score standing as a CONSERVATIVE one (the text is now at
// least as good as that number says). A repair that bills the next stage for
// its own edit is how a nightly job turns into a nightly invoice.
const QUALITY_STORE = 'data/translation-quality.json';
const quality = existsSync(QUALITY_STORE) ? JSON.parse(readFileSync(QUALITY_STORE, 'utf8')) : null;
let restamped = 0;
const restampQuality = (slug, raw) => {
  const entry = quality?.[`zh/${slug}`];
  if (!entry?.hash) return;
  entry.hash = createHash('sha1').update(raw).digest('hex').slice(0, 12);
  restamped++;
};
const ONLY = (() => {
  const a = process.argv.find((x) => x.startsWith('--only='));
  return a ? new Set(a.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)) : null;
})();

const FULL = { ',': '，', ';': '；', ':': '：', '!': '！', '?': '？' };
// Boundary 3: the title separator lives in frontmatter and other modules parse it.
const FRONTMATTER_MARKS = [','];
const BODY_MARKS = Object.keys(FULL);

// Han, hiragana, katakana — the characters that make a mark "inside CJK prose".
// Hangul is deliberately absent: Korean sets half-width commas correctly.
const CJK = String.raw`[一-鿿぀-ヿ]`;

// A fenced or inline code span may legitimately hold half-width punctuation
// next to CJK. Rare in travel prose, cheap to exclude.
const splitCode = (text) => text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);

/** Convert half-width marks that sit between two CJK characters. Pure. */
export function fixPunctuation(text, marks = BODY_MARKS) {
  let count = 0;
  const out = splitCode(String(text)).map((chunk, i) => {
    if (i % 2 === 1) return chunk; // the code spans themselves
    let s = chunk;
    for (const half of marks) {
      // Lookahead for the right-hand CJK so runs like 甲,乙,丙 all convert —
      // consuming that character would skip every second mark.
      const re = new RegExp(`(${CJK})\\${half}[ \\t]*(?=${CJK})`, 'g');
      s = s.replace(re, (_m, left) => { count++; return left + FULL[half]; });
    }
    return s;
  }).join('');
  return { text: out, count };
}

// The file is edited as TEXT, never re-serialized. A gray-matter round-trip
// was the first draft and it rewrote frontmatter it had no business touching:
// srcHash lost its quotes (a hash of only digits would have become a NUMBER),
// quickAnswer was re-wrapped into a >- block, and the diff for one four-mark
// fix was 18 insertions. backfill-descriptions taught the same lesson in
// August — parse to VERIFY, never to write.
//
// Splitting on the delimiters is safe here because the substitution cannot
// create or destroy YAML structure: keys are ASCII, and the only flow
// sequences in the Chinese tree are empty (`faq: []`), so no structural comma
// has a Han character on its left.
function splitFrontmatter(raw) {
  if (!raw.startsWith('---')) return null;
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
  if (!m) return null;
  return { head: m[0], front: m[1], body: raw.slice(m[0].length) };
}

function fixFile(path) {
  const raw = readFileSync(path, 'utf8');
  const parts = splitFrontmatter(raw);
  if (!parts) return 0;

  const front = fixPunctuation(parts.front, FRONTMATTER_MARKS);
  const body = fixPunctuation(parts.body, BODY_MARKS);
  const total = front.count + body.count;
  if (!total || !APPLY) return total;

  const next = parts.head.replace(parts.front, front.text) + body.text;

  // Read back before committing to disk: the frontmatter must still parse and
  // still carry the same keys and the same srcHash. A translation whose
  // srcHash shifts would be re-queued for the whole corpus.
  const before = matter(raw), after = matter(next);
  const keysBefore = Object.keys(before.data).sort().join(',');
  const keysAfter = Object.keys(after.data).sort().join(',');
  if (keysBefore !== keysAfter || String(before.data.srcHash) !== String(after.data.srcHash)) {
    console.error(`  ⚠ ${path}: frontmatter changed shape — skipped`);
    return 0;
  }
  writeFileSync(path, next);
  restampQuality(path.replace(/^.*\/([^/]+)\.md$/, '$1'), next);
  return total;
}

const live = (slug) => {
  const p = `src/content/posts/${slug}.md`;
  if (!existsSync(p)) return false;
  try { return !matter(readFileSync(p, 'utf8')).data.draft; } catch { return false; }
};

const dir = 'src/content/i18n/zh';
let files = 0, marks = 0;
const worst = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
  const slug = f.replace(/\.md$/, '');
  if (ONLY && !ONLY.has(`zh/${slug}`)) continue;
  if (!ONLY && !live(slug)) continue;
  const n = fixFile(`${dir}/${f}`);
  if (n) { files++; marks += n; worst.push([`zh/${slug}`, n]); }
}

if (APPLY && restamped) {
  writeFileSync(QUALITY_STORE, JSON.stringify(quality, null, 1) + '\n');
  console.log(`품질 판정 ${restamped}건은 해시만 갱신 — 재심사 비용 0(문장부호 수리는 점수를 낮출 수 없음).`);
}

worst.sort((a, b) => b[1] - a[1]);
for (const [k, n] of worst.slice(0, 8)) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log(`\nCJK_PUNCT_SUMMARY files=${files} marks=${marks} restamped=${restamped} applied=${APPLY}`);
if (!APPLY && files) console.log('보고만 했습니다 — 실제로 고치려면 --apply 를 붙이세요.');
