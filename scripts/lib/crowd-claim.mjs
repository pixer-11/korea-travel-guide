// Is a sentence about crowds backed by the venue's own measured crowd hours?
//
// The weekly content auditor reads every guide with a model and reports
// "invented-specifics" for a claim it thinks the writer made up. Crowd hours
// are the one fact this site has that others do not — "quietest 7am to 9am on
// weekdays" comes from BestTime measurements stored in the post's own
// frontmatter — and the auditor keeps calling those sentences invented even
// though the measurements are handed to it (that block was added 2026-09-05).
//
// Measured on the 2026-09-19 queue: 157 findings quoted a clock time and 141
// of them sat on a post whose stored busyness covers those hours. Left alone,
// repair-prose spends a model call on each one and waters down a true,
// differentiating sentence — we would be paying to delete our own data.
//
// So the model's opinion is checked against the numbers before anything is
// repaired. This is deliberately narrow: it vetoes a finding ONLY when the
// quoted hours agree with the stored measurement in the direction the sentence
// claims. A sentence that calls a measured-busy hour quiet is still a finding.

const HOUR_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;
const QUIET_WORDS = /\b(quiet(?:est)?|calm(?:est)?|empty|thin(?:ner|nest)?|fewest|lull|before the crowds?|beat the crowds?)\b/i;
const BUSY_WORDS = /\b(busy|busiest|peaks?|peak|crowds? (?:build|arrive|peak)|packed|queues?|lines?|thickest|heaviest|rush)\b/i;

/** Every hour mentioned, as 0-23. "10am to 3pm" → [10, 15]. */
export function hoursIn(text) {
  return [...String(text ?? '').matchAll(HOUR_RE)].map((m) => {
    const h = Number(m[1]) % 12;
    return /pm/i.test(m[3]) ? h + 12 : h;
  });
}

/** The hours a claim covers: a pair reads as a range, a single hour as itself. */
export function claimedHours(text) {
  const hs = hoursIn(text);
  if (hs.length < 2) return hs;
  const [a, b] = [hs[0], hs[hs.length - 1]];
  if (b <= a) return hs;
  // "10am to 3pm" means the hours 10,11,12,13,14 — the 3pm boundary is when it
  // ends, not an hour being described. That boundary is where the auditor and
  // the data disagreed on the Lady Bird Johnson guide (busy 10-14, prose
  // "peaks between 10am and 3pm", flagged as invented).
  return Array.from({ length: b - a }, (_, i) => a + i);
}

const set = (xs) => new Set(Array.isArray(xs) ? xs.filter((h) => Number.isInteger(h)) : []);

/**
 * True when the stored measurement SUPPORTS the sentence, so the finding is a
 * false positive and nothing should be spent repairing it.
 * Returns false when there is no data, no clock time, or no direction word —
 * those stay findings, because this function must never excuse a claim it
 * cannot check.
 */
export function crowdClaimSupported(quote, busyness) {
  if (!busyness) return false;
  const text = String(quote ?? '');
  const hours = claimedHours(text);
  if (!hours.length) return false;

  const saysQuiet = QUIET_WORDS.test(text);
  const saysBusy = BUSY_WORDS.test(text);
  if (saysQuiet === saysBusy) return false; // neither, or both — not ours to judge

  // A sentence that names one side of the week is checked against that side.
  const weekend = /\bweekend|saturday|sunday\b/i.test(text);
  const weekday = /\bweekday|weeknight|monday|tuesday|wednesday|thursday|friday\b/i.test(text);
  const pick = (wd, we) => (weekend && !weekday ? set(we) : weekday && !weekend ? set(wd) : new Set([...set(wd), ...set(we)]));
  const quiet = pick(busyness.weekdayQuiet, busyness.weekendQuiet);
  const busy = pick(busyness.weekdayBusy, busyness.weekendBusy);
  const want = saysQuiet ? quiet : busy;
  const opposite = saysQuiet ? busy : quiet;
  if (!want.size) return false;

  // Supported when every hour the sentence describes is in the measured set for
  // the direction it claims, and none of them is measured as the opposite.
  return hours.every((h) => want.has(h)) && !hours.some((h) => opposite.has(h));
}
