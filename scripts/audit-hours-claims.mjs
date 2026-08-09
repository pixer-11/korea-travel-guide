// Find articles whose PROSE sends readers to a venue at a time the venue's own
// fact box says it is shut.
//
// This is the worst class of error the site can make. Not a typo, not a stale
// figure — a reader who follows the advice arrives at a locked door. Six posts
// were doing it in five languages each: Chatuchak market said "Saturday and
// Sunday, roughly 9am to 6pm" over hours that open at 5am and close Monday;
// the Museo Egizio article said "closed on Mondays" beside hours listing
// Monday 9:00 AM – 2:00 PM.
//
// The check is deliberately narrow. It only reports a clock time in the prose
// that falls OUTSIDE every range the frontmatter lists for that day, and a
// stated closing day that contradicts the frontmatter. Vague copy ("early
// morning", "at opening") is left alone — this must not cry wolf, or it joins
// the audits nobody reads.
//
//   node scripts/audit-hours-claims.mjs [--verbose]
//
// Also exported as hoursProblems(raw) so other patrols can re-check a single
// post before republishing it — the alt-photo patrol once un-drafted two posts
// the HOURS gate had quarantined, because draft:true carries no reason and the
// patrol assumed every draft it could fix was a photo quarantine.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { clampBusynessHours } from '../src/lib/hours.mjs';

const DIR = 'src/content/posts';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "8:00 AM" / "5 PM" / "10:30pm" → minutes since midnight, or null. */
const toMin = (h, m, mer) => {
  let hh = Number(h);
  if (mer) {
    const pm = /p/i.test(mer);
    if (hh === 12) hh = pm ? 12 : 0;
    else if (pm) hh += 12;
  }
  return hh * 60 + Number(m || 0);
};

/** Parse one frontmatter line: "Monday: 8:00 AM – 12:00 AM" → {day, ranges}. */
function parseLine(line) {
  const s = String(line);
  const day = DAYS.find((d) => s.startsWith(d));
  if (!day) return null;
  const rest = s.slice(day.length + 1);
  if (/closed/i.test(rest)) return { day, closed: true, ranges: [] };
  if (/open 24 hours/i.test(rest)) return { day, closed: false, ranges: [[0, 1440]] };

  const ranges = [];
  // "8:00 AM – 12:00 AM", "11:45 AM – 2:00 PM, 6:15 – 10:15 PM"
  const re = /(\d{1,2})(?::(\d{2}))?\s*([AP]\.?M\.?)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*([AP]\.?M\.?)/gi;
  for (const m of rest.matchAll(re)) {
    // A missing meridiem on the opening time takes the closing time's.
    const a = toMin(m[1], m[2], m[3] || m[6]);
    let b = toMin(m[4], m[5], m[6]);
    if (b <= a) b += 1440;                    // closes after midnight
    ranges.push([a, b]);
  }
  return { day, closed: false, ranges };
}

const inAnyRange = (min, ranges) =>
  ranges.some(([a, b]) => (min >= a && min <= b) || (min + 1440 >= a && min + 1440 <= b));

/**
 * All hours contradictions in one post file's full text (frontmatter + body).
 * Returns an array of human-readable problem strings; empty means clean.
 * Draft status is NOT considered here — callers decide what to scan.
 */
export function hoursProblems(raw) {
  const cut = raw.indexOf('\n---', 3);
  if (cut < 0) return [];
  let fm;
  try { fm = yaml.load(raw.slice(4, cut)); } catch { return []; }
  if (!fm) return [];

  const lines = fm.place?.openingHours ?? [];
  if (!lines.length) return [];
  const parsed = lines.map(parseLine).filter(Boolean);
  if (!parsed.length) return [];

  // Everything the reader sees: body plus the frontmatter prose fields.
  const prose = [raw.slice(cut + 4), fm.description, fm.quickAnswer,
    ...(fm.faq ?? []).flatMap((q) => [q?.q, q?.a])].filter(Boolean).join('\n');

  const open = parsed.filter((p) => !p.closed);
  const closedDays = parsed.filter((p) => p.closed).map((p) => p.day);
  const widest = open.length
    ? [Math.min(...open.flatMap((p) => p.ranges.map((r) => r[0]))),
       Math.max(...open.flatMap((p) => p.ranges.map((r) => r[1])))]
    : null;

  const found = [];

  // (a) A clock time in the prose that is outside EVERY day's opening range.
  //     Compared against the widest window across the week, so a Saturday-only
  //     late night cannot be reported on a weekday sentence.
  if (widest && open.some((p) => p.ranges.length)) {
    const seen = new Set();
    for (const m of prose.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/gi)) {
      const min = toMin(m[1], m[2], m[3]);
      if (seen.has(min)) continue;
      // A warning about an out-of-hours time is CORRECT prose, not a
      // recommendation: "the most common visitor mistake is showing up at
      // 4:01pm expecting it's still open" got chicago-sawada-coffee
      // quarantined twice (2026-08-02) with nothing for the fixer to fix —
      // same negation lesson the closed-day rule already learned.
      const before = prose.slice(Math.max(0, m.index - 80), m.index);
      if (/(mistake|don'?t|do not|avoid|too late|miss(es|ed)?|closed|shut|no longer|instead of|rather than|expecting)\b[^.]*$/i.test(before)) continue;
      seen.add(min);
      const ok = open.some((p) => inAnyRange(min, p.ranges));
      if (!ok) found.push(`prose says ${m[0]}, outside every day's hours (${lines[0]} … )`);
    }
  }

  // (b) The prose names a closing day the fact box says is open, or vice versa.
  // The gap between the day and the word "closed" must not contain ANOTHER day.
  // Without that, "3–10pm on Saturday, and closed all day Sunday" — a perfectly
  // correct sentence — reads as a claim that Saturday is closed.
  const DAY_ALT = DAYS.join('|');
  // Adverbs the generator likes to slip between "closed" and the day. "closed
  // entirely on Tuesday" and "closed both Tuesday and Wednesday" escaped the
  // narrower "on|all day" list, so the strip below left "closed" standing in
  // the sentence and the day BEFORE it ("…Saturday, and Sunday, and closed
  // entirely on Tuesday…") was reported as a closed-claim — a false positive
  // that quarantined two correct posts on 2026-07-31.
  // 'every' joined 2026-08-04: the Forbidden City's FAQ says "it's closed every
  // Monday; it's open Tuesday through Sunday" — correct prose. Without 'every'
  // the strip below left a bare "closed" in the sentence and paired it with the
  // Sunday that follows, quarantining the post twice with nothing to repair.
  // Same failure the 08-01 fix addressed for 'entirely'/'both'; the lesson is
  // that this list must cover every adverb the writer can slip in, so it is
  // deliberately generous.
  const ADV = `(?:entirely\\s+|completely\\s+|both\\s+|every\\s+|all\\s+day\\s+|on\\s+|to\\s+the\\s+public\\s+)*`;
  // A day name directly followed by one of these nouns is not the subject of a
  // closure — it modifies a new noun phrase, which starts a new claim.
  // "closed on Mondays, and Sunday hours tend to be shorter" (MNAC, 2026-08-08)
  // read as the list "closed Monday and Sunday" and flagged a post whose prose
  // matched its fact box exactly, so the fixer had nothing to repair. Partial
  // closures ("closed Sunday mornings") land here too, deliberately: the fact
  // box only knows whole days, so a half-day claim cannot contradict it.
  const SCOPE_SHIFT = `(?!\\s+(?:hours?|times?|schedules?|openings?|closings?|mornings?|afternoons?|evenings?|nights?|crowds?|visitors?|queues?|lines?|tickets?|entry|admission|prices?|rates?|brunch|lunch|dinner|traffic|services?)\\b)`;
  const claimsClosedOn = (d, text) => {
    const gap = `(?:(?!\\b(?:${DAY_ALT})\\b)[^.]){0,40}`;
    // "closed Sundays" — the day AFTER the word owns the claim. Checked first,
    // because "3–10pm on Saturdays, and closed Sundays" otherwise reads as a
    // claim about Saturday: the gap between "Saturdays" and "closed" is just
    // ", and ", with no day in it to disqualify the match.
    // Day LISTS count: "closed both Sunday and Monday" is a closed-claim about
    // Monday too, but the general pattern below disqualifies any gap containing
    // another day name — correctly for most sentences, wrongly for a list. So
    // a run of day names joined by commas/and, directly after "closed", claims
    // every day in it.
    if (new RegExp(`closed\\s+${ADV}(?:(?:${DAY_ALT})s?\\b${SCOPE_SHIFT}(?:,\\s*(?:and\\s+)?|\\s+and\\s+))*${d}s?\\b${SCOPE_SHIFT}`, 'i').test(text)) return true;
    // Strip every fully-stated "closed <days…>" claim about OTHER days, list
    // and all, so the leftover text cannot pair its "closed" with a day that
    // merely sits nearby in the same sentence.
    const closedThenOtherDay = new RegExp(
      `closed\\s+${ADV}\\b(?:${DAY_ALT})s?\\b(?:(?:,\\s*(?:and\\s+)?|\\s+and\\s+)(?:${DAY_ALT})s?\\b${SCOPE_SHIFT})*`, 'gi');
    const stripped = text.replace(closedThenOtherDay, ' ');
    return new RegExp(`closed${gap}\\b${d}s?\\b${SCOPE_SHIFT}|\\b${d}s?\\b${SCOPE_SHIFT}${gap}closed`, 'i').test(stripped);
  };

  for (const d of DAYS) {
    const claimsClosed = claimsClosedOn(d, prose);
    const isClosed = closedDays.includes(d);
    if (claimsClosed && !isClosed) found.push(`prose says closed ${d}, fact box lists it as open`);
    if (!claimsClosed && isClosed && new RegExp(`\\b${d}\\b`, 'i').test(prose)) {
      // Negations must not read as recommendations: "closed Sunday and Monday,
      // so don't plan a visit around those days" is the CORRECT sentence, and
      // this rule quarantined the post for it — twice, because the fixer then
      // couldn't find anything to fix.
      const windowRe = new RegExp(`\\b${d}\\b([^.]{0,60})(visit|go|arrive|morning|afternoon|evening)`, 'i');
      const m2 = prose.match(windowRe);
      const negated = m2 && /(don'?t|do not|avoid|rather than|instead of|skip|except|closed)/i.test(m2[1]);
      // The negation can sit BEFORE the day too: "closed Sunday through
      // Wednesday, so plan your itinerary around that window" is the CORRECT
      // sentence, and checking only the after-text quarantined Hollyhock House
      // on publish day with nothing for the fixer to fix (2026-08-09) — the
      // exact loop shape this comment's first lesson already describes.
      const before = m2 ? prose.slice(Math.max(0, m2.index - 80), m2.index) : '';
      const negatedBefore = /(closed|shut|not open)[^.]{0,70}$|\bthrough\s*$/i.test(before);
      if (m2 && !negated && !negatedBefore) found.push(`prose suggests visiting on ${d}, fact box says closed`);
    }
  }

  return [...new Set(found)];
}

/**
 * Stored busyness hours that fall at-or-after closing (or before opening) for
 * their weekday/weekend group. Kept SEPARATE from hoursProblems on purpose:
 * hoursProblems feeds the prose-rewriting fixer and the photo patrol's re-hold
 * check, and this is a DATA defect — the remedy is repair-busyness-hours.mjs
 * (clamp the stored arrays), never an LLM rewrite of the article.
 */
export function busynessProblems(raw) {
  const cut = raw.indexOf('\n---', 3);
  if (cut < 0) return [];
  let fm;
  try { fm = yaml.load(raw.slice(4, cut)); } catch { return []; }
  const bz = fm?.place?.busyness;
  if (!bz) return [];
  const res = clampBusynessHours(bz, fm?.place?.openingHours);
  if (!res || !res.changed) return [];
  const found = [];
  for (const key of ['weekdayQuiet', 'weekdayBusy', 'weekendQuiet', 'weekendBusy']) {
    const before = (bz[key] ?? []).filter((h) => Number.isInteger(h));
    const dropped = before.filter((h) => !res[key].includes(h));
    if (dropped.length) found.push(`busyness ${key} lists ${dropped.join(',')}h — outside the venue's opening hours`);
  }
  return found;
}

// ── CLI (only when executed directly, not when imported) ─────
if (process.argv[1]?.endsWith('audit-hours-claims.mjs')) {
  const verbose = process.argv.includes('--verbose');
  // --drafts: include quarantined posts. The gate flips an offending post to
  // draft, and this audit normally skips drafts — so a held post could never be
  // found by the fixer again, and "자동 수리 순찰이 고친 뒤 재발행" was a promise
  // with no machinery behind it.
  const includeDrafts = process.argv.includes('--drafts');

  const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
  const issues = [];
  const bzIssues = [];
  for (const f of files) {
    const raw = readFileSync(join(DIR, f), 'utf8');
    if (!includeDrafts && /^draft:\s*true\s*$/m.test(raw)) continue;
    const found = hoursProblems(raw);
    if (found.length) issues.push({ f, found });
    const bz = busynessProblems(raw);
    if (bz.length) bzIssues.push({ f, found: bz });
  }

  for (const i of issues) {
    console.log(`HOURS-CONTRADICTION: ${i.f}`);
    if (verbose) i.found.forEach((x) => console.log(`    ${x}`));
  }
  // Distinct tag: the prose fixer and the publish gate pick HOURS-CONTRADICTION
  // lines by regex and must NOT send a data defect to the article rewriter.
  // These are fixed by `node scripts/repair-busyness-hours.mjs --apply`.
  for (const i of bzIssues) {
    console.log(`BUSYNESS-OUTSIDE-HOURS: ${i.f}`);
    if (verbose) i.found.forEach((x) => console.log(`    ${x}`));
  }
  const total = issues.length + bzIssues.length;
  console.log(total
    ? `\n❌ ${issues.length} post(s) whose prose contradicts their own opening hours, ` +
      `${bzIssues.length} whose stored quiet/busy hours fall outside them.`
    : `✓ ${files.length} post(s) — no prose or busyness data contradicts its own opening hours.`);
  process.exit(total ? 1 : 0);
}
