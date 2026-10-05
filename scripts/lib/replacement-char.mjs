// U+FFFD — the character a decoder writes where bytes did not form a letter.
//
// 2026-09-27..10-05 the batch translation reader cut multi-byte letters at
// network chunk boundaries (lib/claude-batch.mjs) and 523 translations shipped
// with 775 broken lines: 「돌��오나요?」, 「嘉義旧監��」, 「aci��n」. A lost
// letter cannot be computed back from the bytes that are left, but the sentence
// around it says what it was, so repair-replacement-chars.mjs asks a model for
// the line back — and this file decides whether to believe the answer.

export const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const RUN = new RegExp(`${REPLACEMENT_CHAR}+`, 'g');

export const hasReplacementChar = (s) => String(s ?? '').includes(REPLACEMENT_CHAR);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Accept `fixed` only if it is `orig` with each run of U+FFFD replaced by one
 * or two letters and NOTHING else changed — not a comma, not a space. A model
 * asked to restore one letter that also "improves" the sentence is refused.
 * @returns {boolean}
 */
// A letter cut at a chunk boundary always leaves TWO or more U+FFFD (the head
// bytes and the tail bytes each become one), and the gap must be filled. A LONE
// U+FFFD is an older stray from August translations ("쇼�핑" for 쇼핑) that
// may stand for nothing at all, so there an empty fill is also allowed.
export function isFaithfulRestore(orig, fixed) {
  if (typeof fixed !== 'string' || hasReplacementChar(fixed) || /[\r\n]/.test(fixed)) return false;
  if (!hasReplacementChar(orig)) return fixed === orig;
  const runs = String(orig).match(RUN);
  const segs = String(orig).split(RUN);
  let src = `^${escapeRe(segs[0])}`;
  runs.forEach((run, i) => {
    // Only non-ASCII: a letter that was cut had two bytes or more, so it was
    // never an ASCII character. That refuses a model's '"' or ':', which passed
    // as "one character" and broke the YAML around it (Codex, 10-05).
    src += run.length === 1 ? '(?:[^\\x00-\\x7F\\s]{0,2})' : '(?:[^\\x00-\\x7F\\s]{1,2})';
    src += escapeRe(segs[i + 1]);
  });
  return new RegExp(`${src}$`, 'u').test(fixed);
}
