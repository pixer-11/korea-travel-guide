// Half-width punctuation between CJK characters, and the deterministic fix.
// Shared by the nightly repair of the Chinese posts (fix-cjk-punctuation.mjs,
// where the three boundaries below are argued) and by the country blurbs.
const FULL = { ',': '，', ';': '；', ':': '：', '!': '！', '?': '？' };
// Boundary 3: the title separator lives in frontmatter and other modules parse it.
export const FRONTMATTER_MARKS = [','];
export const BODY_MARKS = Object.keys(FULL);

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
