// Did an LLM rewrite give back the article, or something less than it?
//
// A repair tool that only asks "is the defect gone" will happily write a
// shorter, emptier page — the easiest way to remove a forward-looking sentence
// is to delete the paragraph around it. Two things went wrong on 2026-08-10,
// both in fix-ended-event-tense.mjs:
//
//   1. a body rewrite came back with four `##` sections and 34 lines missing;
//   2. a body rewrite came back cut off mid-word ("…the decent walk from par"),
//      because the response hit max_tokens and the code read a truncated
//      response as a finished one.
//
// So a rewrite is only acceptable when it is roughly as long as what went in,
// keeps every heading, and ends like a finished piece of prose. The caller
// must ALSO reject a response whose stop_reason is "max_tokens" — that is the
// authoritative signal, and this is the backstop for everything else.

import { isSentenceEnd } from './sentence-boundary.mjs';

/** Text that stops mid-word or mid-clause — the tell of a truncated response. */
export function endsMidThought(text) {
  const t = text.trimEnd();
  if (!t) return true;
  // A markdown block that legitimately ends without punctuation: a heading, a
  // table row, a fenced block. Those are structure, not a cut-off sentence.
  const lastLine = t.slice(t.lastIndexOf('\n') + 1).trim();
  if (/^(#{1,6}\s|\||```|:::)/.test(lastLine)) return false;
  return !isSentenceEnd(t, t.length - 1);
}

/**
 * @param {string} before  the text handed to the model
 * @param {string} after   what came back
 * @param {{ headings?: boolean, minShare?: number }} opts
 *        headings — require every `##`+ heading to survive (body rewrites)
 */
export function preservesSubstance(before, after, { headings = false, minShare = 0.7 } = {}) {
  if (!after) return false;
  if (after.length < before.length * minShare) return false;
  if (endsMidThought(after)) return false;
  if (headings) {
    const count = (s) => (s.match(/^#{2,6}\s+.*/gm) || []).length;
    if (count(after) < count(before)) return false;
  }
  return true;
}
