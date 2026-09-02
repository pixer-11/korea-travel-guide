// ─────────────────────────────────────────────────────────────
//  INVENTED OUTCOMES — a prediction may not become a result
//
//  On 2026-09-02 fix-ended-event-tense.mjs ran over 41 ended event guides to
//  remove stale promises ("check the official page closer to July"). It shifted
//  the tense — and while it was at it, it turned what the pre-event text had
//  PREDICTED or ADVISED into things that HAPPENED: "expect fans to fly in from
//  across the Gulf" became "Fans flew in from across the Gulf"; "the free
//  IMPACT shuttle is the easiest option" became "the shuttle ran … and was the
//  option most concertgoers used"; "NJ Transit runs special trains" became
//  "ran special event trains". Nobody here attended. Nobody checked. The
//  guard in that tool measured length, headings and the promise regexes — it
//  had no idea what a claimed outcome looks like, so 34 guides shipped with
//  invented pasts. Same class as the 08-22 "details were published on the
//  official site" defect in src/lib/ended-event-claims.mjs, one shape wider.
//
//  This file is the mechanical half of the fix: given the text the model was
//  handed and the text it returned, list every sentence of the output that
//  claims an outcome the input never stated. The repair tool and the tense
//  tool both refuse such a field, log it, and never write it.
// ─────────────────────────────────────────────────────────────
import { isSentenceEnd } from '../../src/lib/sentence-boundary.mjs';

// The verbs the 09-02 rewrites reached for when they turned a plan into a
// result. Deliberately literal — these are the shapes the corpus actually
// contained, plus the generic "success" family. Add a branch when a new one is
// measured; do not widen to every past tense, because "opened at 6pm" from
// "opens at 6pm" is a fact the source already carried.
export const OUTCOME_VERB = /\b(?:ran|took place|drew|flew in|rolled into|turned out|packed|sold out|was the option|applied|leaned into|built after dark|offered a mix|was a success|went ahead|went smoothly|attendees (?:found|used|reported))\b/gi;

export function splitSentences(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (isSentenceEnd(text, i)) { out.push(text.slice(start, i + 1)); start = i + 1; }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Sentences of `rewritten` that assert an outcome `original` never stated.
 * A verb phrase counts as "already stated" when the original contains the
 * same phrase as a whole word — "the 2025 edition sold out" in the source
 * licenses "sold out" in the output; nothing else does.
 *
 * @returns {{ sentence: string, verb: string }[]}  empty when clean
 */
export function inventedOutcomes(original, rewritten) {
  const source = norm(String(original || ''));
  const hits = [];
  for (const raw of splitSentences(String(rewritten || ''))) {
    const sentence = norm(raw);
    for (const m of sentence.matchAll(OUTCOME_VERB)) {
      const verb = m[0];
      if (new RegExp(`\\b${escapeRe(norm(verb))}\\b`, 'i').test(source)) continue;
      hits.push({ sentence, verb });
      break;
    }
  }
  return hits;
}
