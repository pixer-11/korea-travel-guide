// ─────────────────────────────────────────────────────────────
//  INVENTED OUTCOMES — a prediction may not become a result
//
//  On 2026-09-02 fix-ended-event-tense.mjs ran over 41 ended event guides to
//  remove stale promises ("check the official page closer to July"). It shifted
//  the tense — and while it was at it, it turned what the pre-event text had
//  PREDICTED or ADVISED into things that HAPPENED: "expect fans to fly in from
//  across the Gulf" became "Fans flew in from across the Gulf"; "the free
//  IMPACT shuttle is the easiest option" became "the shuttle ran … the
//  option most concertgoers used"; "NJ Transit runs special trains" became
//  "ran special event trains". Nobody here attended. Nobody checked. The
//  guard in that tool measured length, headings and the promise regexes — it
//  had no idea what a claimed outcome looks like, so 34 guides shipped with
//  invented pasts. Same class as the 08-22 "details were published on the
//  official site" defect in src/lib/ended-event-claims.mjs, one shape wider.
//
//  Two halves live here:
//   · inventedOutcomes(original, rewritten) — for a rewrite: which sentences
//     of the output claim an outcome the input never stated.
//   · ownEditionOutcomes(text, eventYear) — for an article as it stands: which
//     sentences claim an outcome of THIS edition. Every event guide is written
//     before the event, so such a claim is unverified wherever it came from;
//     the 09-03 second pass found "was scheduled" in one field and "took
//     place" in the next of the same article, because the first repair only
//     revisited what the two commits had touched.
// ─────────────────────────────────────────────────────────────
import { isSentenceEnd } from '../../src/lib/sentence-boundary.mjs';

// The verbs the 09-02 rewrites reached for when they turned a plan into a
// result. Deliberately literal — these are the shapes the corpus actually
// contained, plus the generic "success" family. Add a branch when a new one is
// measured; do not widen to every past tense, because "opened at 6pm" from
// "opens at 6pm" is a fact the source already carried.
export const OUTCOME_VERB = /\b(?:ran|took place|drew|flew in|rolled into|turned out|packed|sold out|was the option|applied|leaned into|built after dark|offered a mix|was a success|went ahead|went smoothly|attendees (?:found|used|reported))\b/gi;

// The wider net for an article read on its own (no "before" to compare with):
// the list above plus the plain past-tense shapes the 09-03 pass found sitting
// next to "was scheduled" — "took place", "was held", "played", "brought
// together", "wrapped up". A sentence carrying one of these is an outcome of
// THIS edition unless it is exempted below. "packed" and "applied" are left
// out here on purpose: as adjectives ("packed grounds", "the rule applied")
// they are not outcomes, and this list gates a rewrite, not a report.
export const OWN_EDITION_VERB = /\b(?:ran|took place|was held|were held|was staged|were staged|drew|attracted|flew in|rolled into|turned out|sold out|was the option|leaned into|built after dark|offered a mix|was a success|went ahead|went smoothly|kicked off|wrapped up|brought together|played to|played (?:the|a|an|at|in|two|three|\w+ (?:Stadium|Dome|Arena|Hall))\b|attendees (?:found|used|reported))\b/gi;

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

// Which edition is a sentence talking about? Years, and the relative words
// that stand in for one. "The 2025 edition sold out" and "the 2026 edition
// sold out" are different claims; only the first can license the second's verb
// if — and this was the 09-03 bypass — the check knows to look.
const YEAR = /\b(?:19|20)\d{2}\b/g;
const RELATIVE = /\b(?:last|previous|prior|earlier|past|next|this)\s+(?:year|years|edition|editions)\b/gi;
export function editionMarkers(sentence) {
  const s = String(sentence);
  const years = s.match(YEAR) || [];
  const rel = (s.match(RELATIVE) || []).map((m) => m.toLowerCase().replace(/\s+/g, ' ').replace(/s$/, ''));
  return new Set([...years, ...rel]);
}
const sameEdition = (a, b) => {
  const ma = editionMarkers(a), mb = editionMarkers(b);
  if (!ma.size && !mb.size) return true;
  for (const m of ma) if (mb.has(m)) return true;
  return false;
};

/**
 * Sentences of `rewritten` that assert an outcome `original` never stated.
 * A verb phrase counts as "already stated" only when a sentence of the
 * original contains the same phrase as a whole word AND refers to the same
 * edition (years / "last year" / "previous edition" agree, or neither side
 * names one). "The 2025 edition sold out" licenses "the 2025 edition sold
 * out"; it does not license "the 2026 edition sold out".
 *
 * @returns {{ sentence: string, verb: string }[]}  empty when clean
 */
export function inventedOutcomes(original, rewritten) {
  const sourceSentences = splitSentences(String(original || '')).map(norm);
  const hits = [];
  for (const raw of splitSentences(String(rewritten || ''))) {
    const sentence = norm(raw);
    for (const m of sentence.matchAll(OUTCOME_VERB)) {
      const verb = m[0];
      const re = new RegExp(`\\b${escapeRe(norm(verb))}\\b`, 'i');
      if (sourceSentences.some((s) => re.test(s) && sameEdition(s, sentence))) continue;
      hits.push({ sentence, verb });
      break;
    }
  }
  return hits;
}

// A sentence that is about the past in general, not about this edition:
// history ("has hosted", "had previously raced"), habit ("usually", "tend to",
// "typically"), or an edition other than this one.
const HISTORY = /\b(?:has|have|had)\s+(?:\w+\s+){0,2}(?:hosted|held|run|played|drawn|sold|been|staged|leaned|attracted|kicked|wrapped|taken)\b|\b(?:historically|in the past|in past editions|past editions|previous editions|earlier editions|traditionally)\b|\b(?:usually|typically|often|generally|tends? to|tended to|routinely|regularly|every year|each year|annually)\b/i;

/**
 * Sentences of `text` that claim an outcome of the event's OWN edition.
 * A sentence is left alone when it names a different year, uses a relative
 * marker ("last year", "previous edition"), or reads as history/habit.
 *
 * @param {string} text
 * @param {string|number} eventYear  the edition's year, e.g. "2026"
 * @returns {{ sentence: string, verb: string }[]}
 */
export function ownEditionOutcomes(text, eventYear) {
  const year = String(eventYear || '');
  const hits = [];
  for (const raw of splitSentences(String(text || ''))) {
    const sentence = norm(raw);
    // exec on a non-global copy: with the g flag, match() drops the index.
    const m = new RegExp(OWN_EDITION_VERB.source, 'i').exec(sentence);
    if (!m) continue;
    // The history exemption reads the WHOLE sentence, so one historical clause
    // used to carry an own-edition outcome out with it: "The venue has hosted
    // the festival since 2011, and the 2026 festival sold out in under an hour"
    // was exempt (Codex 3차, 2026-09-03). A sentence that names this edition is
    // making a claim about it whatever else it also says.
    const own = editionMarkers(sentence);
    const namesThisEdition = own.has(year) || [...own].some((k) => /^this (?:year|edition)$/.test(k));
    if (HISTORY.test(sentence) && !namesThisEdition) continue;
    // A conditional is advice, not a report ("flexibility if one date sold
    // out"); and a dancer's "feet turned out" is a posture, not a turnout.
    if (/\bif\b/i.test(sentence.slice(0, m.index)) || /\b(?:feet|toes)\s+turned out\b/i.test(sentence)) continue;
    const otherEdition = [...own].some((k) => (/^\d{4}$/.test(k) ? k !== year : !/^this (?:year|edition)$/.test(k)));
    if (otherEdition && !own.has(year)) continue;
    hits.push({ sentence, verb: m[0] });
  }
  return hits;
}
