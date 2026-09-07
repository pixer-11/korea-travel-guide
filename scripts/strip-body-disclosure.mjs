// Remove the in-body AI disclosure from the published corpus — all five
// languages in ONE pass.
//
//   node scripts/strip-body-disclosure.mjs --dry-run
//   node scripts/strip-body-disclosure.mjs
//   node scripts/strip-body-disclosure.mjs --only=agra-taj-mahal
//
// 922 English guides carry it; PostArticle.astro renders the same disclosure
// as a localized <details> on every post, so those pages say it twice.
//
// srcHash: the hash covers the body, so stripping English alone would mark
// every translation stale and re-queue ~5,300 files through the model. We
// strip the translations in the same pass and re-stamp their hash to the new
// English source — exactly the move reflow-paragraphs.mjs makes. Re-queued: 0.
//
// FRONTMATTER IS NEVER RE-SERIALISED. Only the body below the closing --- is
// rewritten, plus the single srcHash line.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripBodyDisclosure } from './lib/body-disclosure.mjs';
import { srcHashOfPostFile } from './lib/src-hash.mjs';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const I18N = fileURLToPath(new URL('../src/content/i18n/', import.meta.url));
const LANGS = ['ko', 'ja', 'es', 'zh'];

const DRY = process.argv.includes('--dry-run');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? null;

/** Split into [frontmatterText, body] WITHOUT parsing the YAML. */
function halves(raw) {
  const m = raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/);
  return m ? [m[1], m[2]] : null;
}

const stats = { en: 0, tr: 0, skipped: 0, guarded: 0 };

for (const file of readdirSync(POSTS)) {
  if (!file.endsWith('.md')) continue;
  const slug = file.replace(/\.md$/, '');
  if (ONLY && slug !== ONLY) continue;

  const path = POSTS + file;
  const raw = readFileSync(path, 'utf8');
  const parts = halves(raw);
  if (!parts) { stats.skipped++; continue; }
  const [fm, body] = parts;

  const en = stripBodyDisclosure(body);
  if (!en.removed) continue;

  // Preservation guard: the ONLY thing that may disappear is the disclosure
  // line and the blank line after it. Anything else means the regex bit into
  // the prose — skip the file rather than shave an article.
  const shrank = body.length - en.body.length;
  if (shrank > en.removed.length + 4) {
    console.warn(`  ! ${slug}: would remove ${shrank} chars for a ${en.removed.length}-char line — skipped`);
    stats.guarded++;
    continue;
  }

  const newRaw = fm + en.body;
  if (!DRY) writeFileSync(path, newRaw);
  stats.en++;

  const freshHash = srcHashOfPostFile(newRaw);
  if (!freshHash) { console.warn(`  ! ${slug}: hash unreadable, translations left alone`); continue; }

  for (const lang of LANGS) {
    const tp = `${I18N}${lang}/${file}`;
    let traw;
    try { traw = readFileSync(tp, 'utf8'); } catch { continue; }
    const tparts = halves(traw);
    if (!tparts) continue;
    const [tfm, tbody] = tparts;

    const tr = stripBodyDisclosure(tbody);
    const tShrank = tbody.length - tr.body.length;
    if (tr.removed && tShrank > tr.removed.length + 4) {
      console.warn(`  ! ${lang}/${slug}: preservation guard tripped — skipped`);
      stats.guarded++;
      continue;
    }
    // Quoted, always: a 12-hex slice comes out all-digits about one time in
    // fifty, and YAML would hand Astro a number where the schema wants a string.
    const stamped = tfm.replace(
      /^(srcHash:)[ \t]*['"]?[0-9a-f]{6,}['"]?[ \t]*(?=\r?\n)/m,
      `$1 '${freshHash}'`,
    );
    if (!tr.removed && stamped === tfm) continue;
    if (!DRY) writeFileSync(tp, stamped + tr.body);
    stats.tr++;
  }
}

console.log(
  `${DRY ? '[dry-run] ' : ''}영어 ${stats.en}편 · 번역 ${stats.tr}편에서 중복 고지 제거` +
    (stats.guarded ? ` · 보존검사로 건너뜀 ${stats.guarded}` : '') +
    (stats.skipped ? ` · frontmatter 못 읽음 ${stats.skipped}` : ''),
);
