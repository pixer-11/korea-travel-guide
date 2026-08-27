// ─────────────────────────────────────────────────────────────
//  BROKEN-SYLLABLE AUTO-REPAIR — the translator's recurring tic, machine-fixed.
//
//  Retranslation waves keep shattering common syllables into non-wansung
//  neighbours (16 files on 08-08, 20 more on 08-09 — every one hand-fixed).
//  Detection was already automatic (audit-translations); this closes the loop:
//   1. known shatter-pairs are substituted outright — non-wansung syllables
//      have NO legitimate use in Korean outside the allowlist, so a blanket
//      substitution cannot damage correct text;
//   2. any file still carrying an UNKNOWN non-wansung syllable is deleted so
//      the next translation pass regenerates it (srcHash queue), and listed
//      on stdout for the audit trail.
//  Wired into publish.yml right after the translation step, before commit —
//  posts are born clean instead of paged to a human.
//
//   node scripts/fix-broken-syllables.mjs          # repair in place
//   DRY=1 node scripts/fix-broken-syllables.mjs    # report only
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const KO = fileURLToPath(new URL('../src/content/i18n/ko/', import.meta.url));
const WANSUNG = new Set(readFileSync(new URL('../src/data/ko-wansung.txt', import.meta.url), 'utf8'));
// One home: the audit (scripts/lib/ko-syllables.mjs) owns the allowlist. When
// this file kept its own copy they drifted, and a syllable this repaired was
// still reported broken by audit-translations.
import { KO_EXTENDED_OK as ALLOW } from './lib/ko-syllables.mjs';
// Every shatter observed so far. 쯤 is the model's favourite victim.
const FIX = { '쯒': '쯤', '쯍': '쯤', '쯈': '쯤', '쯀': '쯤', '쯌': '쯤', '쯓': '쯤', '쯡': '쯤', '쯃': '쯤', '쯴': '쯤', '쯑': '쯤', '쯘': '쯤', '쯐': '쯤', '쯽': '쯤', '퍁': '퍼', '딖': '딪', '쪤': '쪽' };
const DRY = process.env.DRY === '1';

let fixedFiles = 0, deleted = 0, substitutions = 0;
for (const f of readdirSync(KO)) {
  if (!f.endsWith('.md')) continue;
  const p = KO + f;
  let s = readFileSync(p, 'utf8');
  let changed = false;
  for (const [bad, good] of Object.entries(FIX)) {
    if (s.includes(bad)) { substitutions += s.split(bad).length - 1; s = s.split(bad).join(good); changed = true; }
  }
  const unknown = [...s].some((ch) => ch >= '가' && ch <= '힣' && !WANSUNG.has(ch) && !ALLOW.has(ch));
  if (unknown) {
    // Not in the map — safest repair is a fresh translation, not a guess.
    console.log(`  ↻ ${f}: unknown non-wansung syllable — deleting for retranslation`);
    if (!DRY) rmSync(p);
    deleted++;
    continue;
  }
  if (changed) {
    if (!DRY) writeFileSync(p, s);
    fixedFiles++;
  }
}
console.log(`SYLLABLE_REPAIR fixed=${fixedFiles} substitutions=${substitutions} retranslate=${deleted}${DRY ? ' (DRY)' : ''}`);
