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
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

const DIR = 'src/content/posts';
const verbose = process.argv.includes('--verbose');
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

const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
const issues = [];

for (const f of files) {
  const raw = readFileSync(join(DIR, f), 'utf8');
  const cut = raw.indexOf('\n---', 3);
  let fm;
  try { fm = yaml.load(raw.slice(4, cut)); } catch { continue; }
  if (!fm || fm.draft) continue;

  const lines = fm.place?.openingHours ?? [];
  if (!lines.length) continue;
  const parsed = lines.map(parseLine).filter(Boolean);
  if (!parsed.length) continue;

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
  const claimsClosedOn = (d, text) => {
    const gap = `(?:(?!\\b(?:${DAY_ALT})\\b)[^.]){0,40}`;
    // "closed Sundays" — the day AFTER the word owns the claim. Checked first,
    // because "3–10pm on Saturdays, and closed Sundays" otherwise reads as a
    // claim about Saturday: the gap between "Saturdays" and "closed" is just
    // ", and ", with no day in it to disqualify the match.
    if (new RegExp(`closed\\s+(?:on\\s+)?\\b${d}s?\\b`, 'i').test(text)) return true;
    const closedThenOtherDay = new RegExp(`closed\\s+(?:on\\s+|all day\\s+)?\\b(?:${DAY_ALT})s?\\b`, 'gi');
    const stripped = text.replace(closedThenOtherDay, ' ');
    return new RegExp(`closed${gap}\\b${d}s?\\b|\\b${d}s?\\b${gap}closed`, 'i').test(stripped);
  };

  for (const d of DAYS) {
    const claimsClosed = claimsClosedOn(d, prose);
    const isClosed = closedDays.includes(d);
    if (claimsClosed && !isClosed) found.push(`prose says closed ${d}, fact box lists it as open`);
    if (!claimsClosed && isClosed && new RegExp(`\\b${d}\\b`, 'i').test(prose)) {
      const suggests = new RegExp(`\\b${d}\\b[^.]{0,60}(visit|go|arrive|morning|afternoon|evening)`, 'i').test(prose);
      if (suggests) found.push(`prose suggests visiting on ${d}, fact box says closed`);
    }
  }

  if (found.length) issues.push({ f, found: [...new Set(found)] });
}

for (const i of issues) {
  console.log(`HOURS-CONTRADICTION: ${i.f}`);
  if (verbose) i.found.forEach((x) => console.log(`    ${x}`));
}
console.log(issues.length
  ? `\n❌ ${issues.length} post(s) whose prose contradicts their own opening hours.`
  : `✓ ${files.length} post(s) — no prose contradicts its own opening hours.`);
process.exit(issues.length ? 1 : 0);
