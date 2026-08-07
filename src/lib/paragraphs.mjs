// Splitting walls of text at sentence boundaries.
//
// Audited 2026-08-07 across 792 live guides: 4,660 paragraphs, 88% of them over
// 70 words, the worst 236 — a full phone screen with no place for the eye to
// rest. The prose itself measured fine (0.1 AI clichés per post, 98% written in
// second person); it was the SHAPE that pushed readers away.
//
// Rewriting 792 posts through the model would cost a re-translation of all five
// languages and risk changing facts that are currently correct. Splitting at a
// sentence boundary changes not one word — it only adds a blank line — so the
// translations can take the identical treatment and nothing can drift.
//
// Deliberately conservative: a split point must be a real sentence end, and both
// halves must be substantial. A paragraph that cannot be split cleanly is left
// exactly as it was.

// The same paragraph must be measurable in five languages. English and Korean
// put spaces between units, so counting them works. Japanese and Chinese do
// not — a 300-character Japanese paragraph counts as ONE "word" and sails past
// every limit, which is how a wall of text would survive translation untouched.
// Roughly two CJK characters carry what one English word does.
const CJK = /[぀-ヿ㐀-䶿一-鿿]/g;

/**
 * Length of a chunk of prose in comparable units across all five languages.
 * Spaced scripts count words; unspaced CJK counts characters ÷ 2.
 */
export const words = (s) => {
  const str = String(s).trim();
  if (!str) return 0;
  const spaced = str.split(/\s+/).filter(Boolean).length;
  const cjk = (str.match(CJK) || []).length;
  // Japanese/Chinese: few spaces relative to characters. Korean has spaces and
  // is measured as a spaced script, same as English.
  return cjk > spaced * 2 ? Math.round(cjk / 2) : spaced;
};

// Abbreviations whose period does NOT end a sentence. "Sukhumvit Rd. The road…"
// is one sentence boundary; "St. Peter's" is not. Getting this wrong splits a
// name in half, which is far more visible than a long paragraph.
const ABBR = new RegExp(
  String.raw`(?:^|\s)(?:` +
    [
      'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'St', 'Mt', 'Ft', 'Rd', 'Ave', 'Blvd', 'Sq',
      'No', 'Nos', 'Est', 'approx', 'vs', 'etc', 'e\\.g', 'i\\.e', 'a\\.m', 'p\\.m',
      'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sept?', 'Oct', 'Nov', 'Dec',
    ].join('|') +
    `)\\.$`,
);

/**
 * Split prose into sentences. Returns the sentences WITH their trailing space,
 * so joining the array reproduces the input byte for byte.
 */
export function sentences(text) {
  const out = [];
  let last = 0;
  let m;

  // Two shapes of sentence end:
  //  · spaced scripts — . ! ? then whitespace then something that can open a
  //    sentence (a quote or bracket may come first). Korean is spaced like
  //    English but has no capitals: "…열립니다. 일찍 오세요." only counts as a
  //    boundary if Hangul is allowed to open a sentence, so it is listed here.
  //  · CJK — 。！？ end a sentence on their own, with no space after. Japanese
  //    and Chinese guides have no whitespace to key off at all.
  const re = /(?:([.!?]["')\]]?)(\s+)(?=["'(\[]?[A-Z0-9가-힣])|([。！？][」』）]?)(\s*))/g;

  while ((m = re.exec(text))) {
    const isCjk = Boolean(m[3]);
    const mark = isCjk ? m[3] : m[1];
    const gap = (isCjk ? m[4] : m[2]) || '';
    const candidate = text.slice(last, m.index + mark.length);
    // A digit before the period is usually a number or a date, not an end.
    if (!isCjk && (ABBR.test(candidate) || /\b\d\.$/.test(candidate))) continue;
    out.push(candidate + gap);
    last = m.index + mark.length + gap.length;
  }

  const tail = text.slice(last);
  if (tail.trim()) out.push(tail);
  return out.length ? out : [text];
}

/**
 * Break one paragraph into several, each aiming for `target` words and never
 * knowingly exceeding `max`. Splits only between sentences; a piece is never
 * left shorter than `min` words, because a one-line orphan reads worse than the
 * long paragraph it came from.
 *
 * Returns an array of paragraph strings — length 1 when no clean split exists.
 */
export function splitParagraph(text, { target = 60, max = 90, min = 20 } = {}) {
  const src = text.trim();
  if (words(src) <= max) return [src];

  const sents = sentences(src);
  if (sents.length < 2) return [src]; // one enormous sentence — not ours to fix

  const out = [];
  let cur = [];
  let curWords = 0;

  for (let i = 0; i < sents.length; i++) {
    cur.push(sents[i]);
    curWords += words(sents[i]);

    const remaining = sents.slice(i + 1).reduce((n, s) => n + words(s), 0);
    // Close this paragraph once it has enough weight — but never if doing so
    // would strand fewer than `min` words in the final piece.
    if (curWords >= target && remaining >= min) {
      out.push(cur.join('').trim());
      cur = [];
      curWords = 0;
    }
  }
  if (cur.length) {
    const tail = cur.join('').trim();
    // Too small to stand alone: give it back to the previous paragraph rather
    // than publish a stray line.
    if (out.length && words(tail) < min) out[out.length - 1] += ' ' + tail;
    else out.push(tail);
  }
  return out.length ? out : [src];
}

// Block-level markdown that must never be touched: headings, list items, quotes,
// tables, images, fenced code, and our own component shortcodes.
const STRUCTURAL = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||!\[|```|:::|<)/;

/**
 * Reflow a whole markdown body. Prose paragraphs over `max` words are split at
 * sentence boundaries; every other block is passed through untouched. Word for
 * word the text is identical — only blank lines are added.
 */
export function reflow(body, opts = {}) {
  const nl = body.includes('\r\n') ? '\r\n' : '\n';
  const flat = body.replace(/\r\n/g, '\n');
  const blocks = flat.split(/\n{2,}/);
  let split = 0;

  const out = blocks.map((block) => {
    if (!block.trim()) return block;

    // A block is often a lead-in sentence followed immediately by its bullet
    // list, with no blank line between them. Skipping the whole block left 19
    // paragraphs of up to 185 words untouched — nearly all Japanese, where the
    // model runs prose and list together. So work LINE BY LINE: structural
    // lines (bullets, headings, table rows) pass through joined by a single
    // newline, which keeps the list intact; prose lines may be split, and the
    // blank line that separates the pieces sits before the list where it does
    // no harm.
    const lines = block.split('\n');
    return lines
      .map((line) => {
        const t = line.trim();
        if (!t || STRUCTURAL.test(t)) return line;
        const pieces = splitParagraph(t, opts);
        if (pieces.length > 1) split += pieces.length - 1;
        return pieces.join('\n\n');
      })
      .join('\n');
  });

  return { body: out.join('\n\n').replace(/\n/g, nl), split };
}
