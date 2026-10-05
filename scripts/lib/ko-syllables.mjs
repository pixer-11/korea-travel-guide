// Broken-syllable detection for Korean output (ko).
//
// The translator occasionally emits a Hangul syllable a jamo or two off the one
// it meant: 쯤 has shipped as 쯽·쯴·쯈·쯍·쯑·쯘·쯐·쯃·쯌·쯀, 쪽 as 쪤, 딪 as 딖,
// 퍼 as 퍁 — the owner caught 장소쯽 on a live page (2026-08-08) and 14 more
// arrived with the next day's retranslation wave. Modern Korean prose lives
// inside the KS X 1001 wansung set (2,350 syllables, generated into
// src/data/ko-wansung.txt); a syllable outside it is a typo UNLESS it is a known
// loanword transliteration — Thai/Vietnamese names legitimately use extended
// syllables (똠얌, 프라웻, 왓 쩻 욧…). Add new legit syllables to the allowlist;
// never loosen the set.
//
// There is deliberately NO automatic repair. The corruptions are not a fixed
// offset — 쯤→쯽 changes both the vowel and the final, and 쯤 and 쪽 corrupt into
// the same ㅉ block — so only the surrounding words say which syllable was meant.
// The machine's job is therefore to never WRITE one (translate-posts retries),
// and the audit's job is to catch whatever still slips through.
import { readFileSync } from 'node:fs';

const KO_WANSUNG = new Set(readFileSync(new URL('../../src/data/ko-wansung.txt', import.meta.url), 'utf8'));
// Exported: scripts/fix-broken-syllables.mjs reads THIS set rather than keeping
// its own copy. Two copies drifted apart once already — the fixer repaired a
// syllable the audit still called broken, so the warning never cleared.
// 뱡: 뱡뱡면 (biangbiang noodles, Xi'an) — the gate held a correct Opus
// translation of xi-an-beiyuanmen on it (2026-09-28 A/B).
// 녤: 아녤리 (Agnelli — Turin's Pinacoteca Agnelli on the Lingotto roof), the
// standard spelling; the fixer deleted turin-club-to-club-c2c-festival for it
// on 2026-10-05 and every retranslation wrote it again.
export const KO_EXTENDED_OK = new Set([...'웻똠쩻뻄뻭녓얙뻉뜽냣셱췩뱡녤']);
// Whole words, for a syllable that is a typo everywhere else: 됭 is 된 mangled
// in 됭장 (Codex, 10-03), but 베르됭 (Verdun — Nicholas of Verdun, goldsmith of
// Cologne's Shrine of the Three Kings) is the standard spelling; the Cologne
// posts were retranslated three times over it.
export const KO_WORDS_OK = ['베르됭'];
const okWords = new RegExp(KO_WORDS_OK.join('|'), 'g');

// Every broken syllable in `text`, each with a little context so a human can see
// the word it belongs to.
export function koBrokenSyllables(text) {
  const bad = [];
  // Same length, so the context below still points at the right place.
  const scan = String(text ?? '').replace(okWords, (w) => '가'.repeat(w.length));
  for (const m of scan.matchAll(/[가-힣]/g)) {
    const ch = m[0];
    if (KO_WANSUNG.has(ch) || KO_EXTENDED_OK.has(ch)) continue;
    bad.push(`${ch} — ${text.slice(Math.max(0, m.index - 12), m.index + 13).replace(/\n/g, ' ')}`);
  }
  return bad;
}

// The distinct broken syllables in a whole translation payload (title,
// description, quickAnswer, body, faq). Used as a write gate, so it reads every
// field the model filled — a mangled syllable in a FAQ answer is just as visible
// as one in the body.
export function koMangledSyllables(out) {
  const seen = new Set();
  const fields = [out?.title, out?.description, out?.quickAnswer, out?.body];
  for (const f of Array.isArray(out?.faq) ? out.faq : []) fields.push(f?.q, f?.a);
  for (const f of fields) {
    for (const hit of koBrokenSyllables(f)) seen.add(hit.split(' — ')[0]);
  }
  return [...seen];
}
