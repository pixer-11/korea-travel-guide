// Break published walls of text into readable paragraphs — all five languages.
//
//   node scripts/reflow-paragraphs.mjs --dry-run     # report only
//   node scripts/reflow-paragraphs.mjs               # write
//   node scripts/reflow-paragraphs.mjs --only=seoul  # one slug, for eyeballing
//
// Audited 2026-08-07: 792 English guides, 4,660 paragraphs, 88% over 70 words,
// worst 236 — a full phone screen of unbroken text. The writing itself measured
// fine; the shape is what loses readers.
//
// This changes NOT ONE WORD. It splits at sentence boundaries and adds blank
// lines, which is why it is safe to apply to the 3,172 translations too: the
// translated sentences stay exactly as translated.
//
// srcHash: the hash covers the body, so reflowing English alone would mark all
// 3,172 translations stale and re-queue the whole corpus through the model. We
// reflow the translations in the same pass and re-stamp their hash to the new
// English source — the same move resync-rating-badges.mjs makes. Re-queued: 0.
//
// FRONTMATTER IS NEVER RE-SERIALISED. Only the body below the closing --- is
// rewritten, plus the single srcHash line. Round-tripping YAML is what turned
// hashes into floats and dates into 2001 before.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { reflow, words } from '../src/lib/paragraphs.mjs';
import { srcHashOf } from './lib/src-hash.mjs';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const I18N = fileURLToPath(new URL('../src/content/i18n/', import.meta.url));
const LANGS = ['ko', 'ja', 'es', 'zh'];

const DRY = process.argv.includes('--dry-run');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? null;

// Split a file into [frontmatterText, body] without parsing the YAML.
function halves(raw) {
  const m = raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/);
  return m ? [m[1], m[2]] : null;
}

const stats = { en: 0, enSplits: 0, tr: 0, trSplits: 0, skipped: 0, worstBefore: 0, worstAfter: 0 };

// Normalise line endings FIRST. On a CRLF file a blank line is "\r\n\r\n",
// which /\n{2,}/ does not match — the whole body reads as one block and the
// report claims an 818-word paragraph that does not exist. Same trap that
// wrecked the first audit an hour earlier.
const longest = (body) =>
  body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b && !/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||!\[|```|:::|<)/.test(b))
    .reduce((mx, b) => Math.max(mx, words(b)), 0);

const files = readdirSync(POSTS)
  .filter((f) => f.endsWith('.md'))
  .filter((f) => !ONLY || f.includes(ONLY));

for (const file of files) {
  const slug = file.replace(/\.md$/, '');
  const raw = readFileSync(POSTS + file, 'utf8');
  const parts = halves(raw);
  if (!parts) { stats.skipped++; continue; }
  const [fm, body] = parts;

  stats.worstBefore = Math.max(stats.worstBefore, longest(body));
  const { body: newBody, split } = reflow(body);
  stats.worstAfter = Math.max(stats.worstAfter, longest(newBody));

  if (split) {
    stats.en++;
    stats.enSplits += split;
    if (!DRY) writeFileSync(POSTS + file, fm + newBody);
  }
  // NOTE: do NOT skip the translations when the English source needed no
  // splitting. A Japanese rendering of a tidy English paragraph routinely runs
  // half again as long and has no spaces to break it up — returning early here
  // left a 185-word Japanese wall standing under an English paragraph that was
  // already fine.

  let data;
  try {
    data = yaml.load(fm.replace(/^---\r?\n|\r?\n---\r?\n$/g, '')) ?? {};
  } catch {
    console.warn(`  ! ${slug}: frontmatter unreadable, translations left alone`);
    continue;
  }
  // Reproduce translate-posts.mjs EXACTLY: CRLF-normalised, trimmed body and
  // only the five translated fields. Hash it any other way and every file this
  // script touches looks stale on the next run — 3,172 re-translations bought
  // by a stray newline.
  const freshHash = srcHashOf({
    title: data.title,
    description: data.description,
    quickAnswer: data.quickAnswer,
    faq: data.faq,
    body: newBody.replace(/\r\n/g, '\n').trim(),
  });

  for (const lang of LANGS) {
    const p = `${I18N}${lang}/${file}`;
    let traw;
    try { traw = readFileSync(p, 'utf8'); } catch { continue; }
    const tparts = halves(traw);
    if (!tparts) continue;
    let [tfm, tbody] = tparts;

    const r = reflow(tbody);
    // Only the one line, and only if it is already there — never invent a field.
    // Match up to the line ending but not INTO it: a trailing \s* swallows the
    // \r of a CRLF file and leaves one lone LF behind, which is how a file ends
    // up with mixed line endings and a diff that touches every line later.
    // QUOTED, always. A sha1 slice is hex, so one in ~50 comes out all digits
    // ("459410162610") or in e-notation ("2437084843e1") and YAML hands Astro a
    // number where the schema wants a string — the build dies on that one file.
    // 20 of them appeared the first time this ran unquoted.
    const stamped = tfm.replace(/^(srcHash:)[ \t]*['"]?[0-9a-f]{6,}['"]?[ \t]*(?=\r?\n)/m, `$1 '${freshHash}'`);
    if (r.split === 0 && stamped === tfm) continue;

    stats.tr++;
    stats.trSplits += r.split;
    if (!DRY) writeFileSync(p, stamped + r.body);
  }
}

console.log(
  `${DRY ? '[dry-run] ' : ''}영어 ${stats.en}편에서 문단 ${stats.enSplits}개 분리 · ` +
    `번역 ${stats.tr}편에서 ${stats.trSplits}개 분리` +
    (stats.skipped ? ` · frontmatter 못 읽음 ${stats.skipped}` : '') +
    `\n최장 문단: ${stats.worstBefore}단어 → ${stats.worstAfter}단어`,
);
