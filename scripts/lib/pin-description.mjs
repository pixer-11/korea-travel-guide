// What a pin says, written for Pinterest search instead of for Google.
//
// Until 2026-09-16 a pin reused the post's meta description — a sentence built
// to win a Google snippet, which opens with the venue's name and history. Four
// weeks of measurement (data/pinterest-analytics.json): 135 pins, 426
// impressions, ZERO saves, one outbound click. Saves are what Pinterest
// distributes on, so the pin was not earning its place.
//
// This is change (a) of the two pre-registered on 2026-09-10 for exactly this
// outcome: lead with what only this site can say — which hours are quiet —
// then the practical facts a planner searches for, then the place words
// themselves. Board consolidation, change (b), is deliberately NOT done at the
// same time: two changes at once make the four-week re-measure unreadable.
//
// 2026-09-21: measured what actually went out. Only 10 of the 40 newest pins
// opened with a quiet window — busyness exists on 44% of posts and resolves to
// a window on fewer — so three pins in four still opened with the venue name,
// the one sentence every other travel site also has. The hook is now a ladder,
// and every rung is a fact already verified in the post's own frontmatter:
//   quiet hours → closed days → opening hours → the guide's own quickAnswer.
// Nothing here may invent a fact; money amounts are refused outright (the
// 2026-09-20 fabricated-price class stays out of Pinterest too).
import { quietWindowSummaryWithinHours } from './quiet-window.mjs';
// NOTE: the itineraries' closedDaysOf() is deliberately NOT used here. It is
// forgiving by design (a line it cannot read is simply not closed), which is
// right for a page that can be rebuilt and wrong for a pin that cannot.

const MAX = 480; // Pinterest allows 500; leave room for the tail

// "weekdays 7:00-8:00, weekends 9:00-11:00" → "weekdays 7-8am, weekends 9-11am".
// Pinterest searchers type "best time to visit", not 24-hour clock ranges.
const ampm = (h) => {
  const n = Number(h);
  if (!Number.isFinite(n)) return String(h);
  const suffix = n < 12 || n === 24 ? 'am' : 'pm';
  const hour = n % 12 === 0 ? 12 : n % 12;
  return `${hour}${suffix}`;
};
export function friendlyHours(summary) {
  if (typeof summary !== 'string' || !summary) return null;
  return summary.replace(/(\d{1,2}):00-(\d{1,2}):00/g, (_, a, b) => {
    const from = ampm(a);
    const to = ampm(b);
    // "7am-8am" reads better as "7-8am" when both sides share a suffix.
    return from.slice(-2) === to.slice(-2) ? `${from.slice(0, -2)}-${to}` : `${from}-${to}`;
  });
}

// ── the hook ladder ──────────────────────────────────────────
// Every rung is a fact already in the post's frontmatter. Nothing is inferred,
// nothing is rounded into a promise, and no rung may carry a money amount.
const SYMBOL = String.raw`[$€£¥₩฿₫₹]`;
// ISO codes are matched CASE-SENSITIVELY, because several of them are ordinary
// English words: a lowercase "try", "won", "cad" or "rub" is a verb, not money.
// Blocking "Try 3 walking routes" is not a safe failure — it costs a good hook
// for nothing (Codex, second pass 2026-09-21).
const CODE = 'USD|EUR|GBP|JPY|KRW|THB|VND|IDR|PHP|MYR|SGD|HKD|TWD|CNY|RMB|INR|AED|SAR|AUD|NZD|CAD|CHF|TRY|RUB';
// Spelled-out currencies, minus the ones that are also ordinary words or place
// names: "23 Yuan Lin Lu" is Lion Grove Garden's street address, not a price,
// and "won" is a verb. Both currencies still get caught as ¥/₩/CNY/KRW.
const WORD = 'baht|rupees?|rupiah|dirhams?|ringgit|pesos?|euros?|dollars?|pounds?|riyals?';
// A price reads "$12", "12 USD", "USD 12", "20 €" or "USD  20" — all of them
// keep a pin out. The symbol side needs no word boundary (€ is not a word
// character, so \b next to it never matches what you expect).
const MONEY = new RegExp(
  [
    String.raw`${SYMBOL}\s*\d`,
    String.raw`\d\s*${SYMBOL}`,
    String.raw`\b\d+([.,]\d+)?\s*(${CODE})\b`,
    String.raw`\b(${CODE})\s*\d`,
  ].join('|'))
  ;
const MONEY_WORD = new RegExp(String.raw`\b\d+([.,]\d+)?\s*(${WORD})\b`, 'i');
const hasMoney = (text) => MONEY.test(String(text)) || MONEY_WORD.test(String(text));

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// "9:00 AM – 7:00 PM" → "9am-7pm". Google's own string, only tidied.
export function tidyClock(text) {
  if (!text) return null;
  const t = String(text)
    .replace(/(\d{1,2}):00\s*([AP])M/gi, (_, h, ap) => `${h}${ap.toLowerCase()}m`)
    .replace(/(\d{1,2}):(\d{2})\s*([AP])M/gi, (_, h, m, ap) => `${h}:${m}${ap.toLowerCase()}m`)
    .replace(/\s*[–—-]\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return t || null;
}

/** Google weekdayDescriptions where all seven days read the same → that one range. */
/**
 * Google's weekdayDescriptions, parsed strictly: seven lines, one per weekday,
 * each "Day: value". Anything else returns null and the caller must stay quiet.
 * Codex found both halves of why this has to be strict (2026-09-21):
 * "Sunday : Closed" slipped past the day parser and the complement then
 * ANNOUNCED Sunday as open, and seven copies of Monday read as a full week.
 */
// A value is only understood if it is the word Closed or a clock range. Codex's
// second pass showed why the day NAMES were never the real risk: "Sunday:
// Closed (temporarily)" parsed fine, was not the exact word "Closed", and so
// the complement advertised Sunday as OPEN. Seven lines of "Hours unavailable"
// printed "Open daily Hours unavailable." Anything not on this whitelist means
// the venue's week is unknown, and an unknown week earns silence.
// The whitelist is not guesswork: all 8,953 hour lines in the corpus reduce to
// fifteen shapes, and they share one grammar — one or more spans of
// "H[:MM][ AM|PM] – H[:MM][ AM|PM]", or the words Closed / Open 24 hours. The
// first version of this whitelist demanded AM/PM on both sides of a single
// span, which silently threw away ~700 real lines: "12:00 – 9:00 PM" and
// "11:00 AM – 2:00 PM, 5:00 – 9:00 PM" are Google's own formats (Codex found
// Cure Bali losing its "Closed Mondays" hook this way).
const CLOSED_VALUE = /^closed$/i;
const OPEN_ALL_DAY = /^open\s*24\s*hours$/i;
const TIME = String.raw`\d{1,2}(?::\d{2})?(?:\s*[AP]M)?`;
const SPAN = String.raw`${TIME}\s*[–—-]\s*${TIME}`;
const CLOCK_VALUE = new RegExp(String.raw`^${SPAN}(?:\s*,\s*${SPAN})*$`, 'i');

export function parseDayLines(lines) {
  if (!Array.isArray(lines) || lines.length !== 7) return null;
  const byDay = new Map();
  for (const line of lines) {
    const m = /^\s*([A-Za-z]+)\s*:\s*(\S.*)$/.exec(String(line));
    if (!m) return null;
    const day = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    if (!DAYS.includes(day) || byDay.has(day)) return null;
    const value = m[2].trim();
    if (!CLOSED_VALUE.test(value) && !CLOCK_VALUE.test(value) && !OPEN_ALL_DAY.test(value)) return null;
    byDay.set(day, value);
  }
  return byDay.size === 7 ? byDay : null;
}

export function uniformHours(lines) {
  const byDay = parseDayLines(lines);
  if (!byDay) return null;
  const set = new Set([...byDay.values()]);
  if (set.size !== 1) return null;
  const only = [...set][0];
  if (/closed/i.test(only) || /24\s*hours/i.test(only)) return null;
  return tidyClock(only);
}

const listOf = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);

/**
 * True when a sentence stops being true with time — a finished event, or any
 * year already behind us. Pins are permanent, so perishable lines stay out.
 */
export function isPerishable(text, now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) now = new Date();
  const t = String(text);
  if (/\b(was|were)\s+(set|scheduled|held|due|planned)\b|took place|has (ended|closed|wrapped)|\bended\b|\bran from\b/i.test(t)) return true;
  const thisYear = now.getFullYear();
  // Only the RECENT past ages a pin. "Rebuilt in 1867" and "opened in 1998"
  // are history and stay true forever; "September 2025" is a stale listing.
  for (const m of t.matchAll(/\b(19|20)\d{2}\b/g)) {
    const y = Number(m[0]);
    if (y < thisYear && y >= thisYear - 5) return true;
  }
  // A date in the CURRENT year can already be behind us — "runs September
  // 11-13, 2026" read on the 21st is a dead pin. Reading dates out of prose is
  // where the second Codex pass found four false positives, so the rule is
  // deliberately narrow now:
  //   • the day number must be a real 1-31 that is NOT part of a longer number
  //     ("May 1998" was being read as May the 19th)
  //   • a year attached to the date wins, comma or no comma; a future one means
  //     the sentence is not stale
  //   • only the LAST date in a range decides ("September 11-October 13" is
  //     still running on the 21st)
  //   • month abbreviations count: "Sept 11-13, 2026" is the same dead pin as
  //     the spelled-out version (Codex, third pass)
  //   • if the sentence names ANY future year, none of its dates are stale —
  //     "September 11-13 and October 11-13, 2027" only attaches the year to the
  //     second range, and judging the first one on its own killed a good hook
  const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
  const DAY = String.raw`(\d{1,2})(?!\d)`;
  const RANGE = String.raw`(?:\s*[-–—]\s*(?:${MONTH}\s+)?${DAY})?`;
  const YEAR = String.raw`(?:,?\s*(\d{4}))?`;
  const dated = new RegExp(`\\b${MONTH}\\s+${DAY}${RANGE}${YEAR}`, 'gi');
  const futureYear = [...t.matchAll(/\b(19|20)\d{2}\b/g)].some((m) => Number(m[0]) > thisYear);
  if (futureYear) return false;
  for (const m of t.matchAll(dated)) {
    const [, month1, day1, month2, day2, year] = m;
    const y = year ? Number(year) : thisYear;
    if (y !== thisYear) continue;            // other years are handled above
    // Abbreviations resolve by their first three letters — "sept" and
    // "september" are the same month, and MONTHS.indexOf() only knew the long
    // spelling, so every abbreviated date quietly counted as "not a date".
    const monthName = (month2 || month1).toLowerCase().slice(0, 3);
    const month = MONTHS.findIndex((name) => name.startsWith(monthName));
    const day = Number(day2 || day1);
    if (month < 0 || !(day >= 1 && day <= 31)) continue;
    // "May" is also a verb: "May 20 people join each tour?" is not a date. Only
    // treat a bare May as one when the sentence dates it — a range or a year.
    if (month1.toLowerCase() === 'may' && !year && !day2) continue;
    const end = new Date(Date.UTC(y, month, day, 23, 59, 59));
    if (end < now) return true;
  }
  return false;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

/** A calendar date of any kind — a month with a day number, or a bare year. */
export function hasSpecificDate(text) {
  const t = String(text);
  const month = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
  return new RegExp(String.raw`\b${month}\s+\d{1,2}\b|\b\d{1,2}\s+${month}\b|\b(19|20)\d{2}\b`, 'i').test(t);
}

/**
 * The opening sentence: the first rung that holds.
 * @returns {{text: string, kind: 'quiet'|'closed'|'hours'|'answer'} | null}
 */
export function openingHook(post) {
  const place = (post && post.place) || {};
  post = post || {};

  // Checked against the venue's own week: a quiet hour it is shut for is not a
  // hook, it is a locked gate (2026-09-21, 77 pins).
  const quiet = friendlyHours(quietWindowSummaryWithinHours(place.busyness, place.openingHours));
  if (quiet) return { text: `Quietest ${quiet}.`, kind: 'quiet' };

  // Both the closed days and the open ones come out of the SAME parse. Reading
  // "closed" with one parser and announcing "open" from another is how "Sunday
  // : Closed" became "Open Sundays" — one space, and the pin says the opposite
  // of the truth (Codex, 2026-09-21).
  const byDay = parseDayLines(place.openingHours);
  const closed = byDay ? DAYS.filter((d) => /^closed$/i.test(byDay.get(d) || '')) : [];
  if (byDay && closed.length && closed.length <= 2) {
    return { text: `Closed ${listOf(closed.map((d) => `${d}s`))}.`, kind: 'closed' };
  }
  if (byDay && closed.length >= 3 && closed.length <= 5) {
    const open = DAYS.filter((d) => !closed.includes(d));
    if (open.length) return { text: `Open ${listOf(open.map((d) => `${d}s`))} only.`, kind: 'closed' };
  }

  const daily = uniformHours(place.openingHours);
  if (daily && !hasMoney(daily)) return { text: `Open daily ${daily}.`, kind: 'hours' };

  // The guide's own opening answer — already fact-checked at publish time.
  // A pin outlives the page it points at: Pinterest never re-reads a
  // description, so a sentence that is only true this month must not be the
  // hook. "MEFCC 2026 was set for September 11-13" reads as news for a week
  // and as a dead pin forever after — and the ended-event rewrites put that
  // past tense into the corpus on purpose.
  // A FUTURE date is no safer than a past one here, only slower: "GITEX Vietnam
  // runs October 1-2, 2026" is true for ten more days and then wrong forever,
  // and nothing ever rewrites that pin. Dated sentences are not hooks at all.
  const first = String(post.quickAnswer || '').split(/(?<=[.!?])\s/)[0];
  if (first && first.length >= 40 && first.length <= 220
    && !hasMoney(first) && !isPerishable(first) && !hasSpecificDate(first)) {
    return { text: first.trim(), kind: 'answer' };
  }
  return null;
}

// What the guide actually contains — claimed only when the body shows it, so a
// pin never advertises a section the reader will not find (40% of guides have
// no getting-there passage, and every pin used to promise one).
// Two rounds of keyword guessing produced "how to get TICKETS" → a way there,
// "paintings donated by taxi drivers" → a way there, and "less crowded than the
// main hall" → crowd timing. Guessing from prose was the wrong question. Our
// guides carry real headings — "Getting there" on 68% of them and "When to go"
// on 72% — so the pin now claims a section only when the guide HAS that
// section, which is what the sentence was always meant to say.
const HEADING = /^#{2,4}\s*(.+)$/gm;
const SECTIONS = [
  { label: 'how to get there', match: /^(getting (there|around)|how to (get there|reach))/i },
  { label: 'when to go to beat the crowds', match: /^(when to (go|visit)|best time)/i },
];

export function offersLine(body = '', opts = {}) {
  const { hoursShown = false, hasHours = false } = opts || {};
  const headings = [...String(body).matchAll(HEADING)].map((m) => m[1].trim());
  const offers = [];
  if (hasHours && !hoursShown) offers.push('opening hours');
  for (const { label, match } of SECTIONS) {
    if (headings.some((h) => match.test(h))) offers.push(label);
  }
  if (!offers.length) return null;
  const s = listOf(offers);
  return s[0].toUpperCase() + s.slice(1) + '.';
}

/**
 * The description for one post's pin. Pure.
 * @param {object} post  frontmatter: title, description, region, country,
 *                       category, quickAnswer, place: { rating, userRatingsTotal,
 *                       busyness, openingHours }
 * @param {string} body  the guide's markdown, so the pin only claims what is in it
 */
export function pinDescription(post, body = '') {
  post = post || {};
  const region = post.region || '';
  const country = post.country || '';
  const place = post.place || {};
  const bits = [];

  // 1. The hook: the best verified fact this post has, quiet hours first.
  const hook = openingHook(post);
  if (hook) bits.push(hook.text);

  // 2. What it is and where, in the words people search. When there is no
  // Places name, the post title stands in — but a title carries our SEO tail
  // ("MassKara Festival: Dates, Tickets & Venue (Bacolod)"), and printing that
  // whole thing is how a pin said "MassKara Festival … MassKara Festival in
  // Bacolod" in consecutive sentences.
  const where = [region, country].filter(Boolean).join(', ');
  const titleName = String(post.title || '').split(':')[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
  const name = place.name || titleName;
  if (hook?.kind !== 'answer') {
    if (name && where) bits.push(`${name} in ${where}.`);
    else if (where) bits.push(`${where}.`);
  } else if (where) {
    bits.push(`${where}.`);
  }

  // 3. The rating, when it is real and well-reviewed enough to mean anything.
  if (place.rating && place.userRatingsTotal >= 50) {
    bits.push(`${place.rating}★ from ${Number(place.userRatingsTotal).toLocaleString('en-US')} visitors.`);
  }

  // 4. What the guide answers — only the parts it really contains.
  const offers = offersLine(body, {
    hoursShown: hook?.kind === 'hours' || hook?.kind === 'closed',
    hasHours: Array.isArray(place.openingHours) && place.openingHours.length > 0,
  });
  if (offers) bits.push(offers);

  // 5. Fallback: a post with no place data still needs a sentence of substance.
  // Same bar as every rung: the Google meta description does not get to skip
  // the money and perishability checks just because it arrives last.
  // …and it is not needed at all when the hook is already a full sentence from
  // the guide: GITEX Vietnam read "…runs October 1-2, 2026. GITEX Vietnam in
  // Hanoi, Vietnam — October 1-2, 2026. Hanoi, Vietnam." — the same fact three
  // times, because the fallback fired on top of an answer hook.
  if (bits.length <= 2 && post.description && hook?.kind !== 'answer') {
    const firstSentence = String(post.description).split(/(?<=[.!?])\s/)[0];
    const usable = firstSentence
      && !hasMoney(firstSentence)
      && !isPerishable(firstSentence)
      // The fallback is the last way a date can reach a pin, and it took it:
      // 34 queued pins carried an event's dates in through here.
      && !hasSpecificDate(firstSentence)
      // …and it must not simply restate the sentence beside it.
      && !(name && firstSentence.startsWith(name));
    if (usable) bits.splice(1, 0, firstSentence);
  }

  // Pinterest turns any "#word" in a description into a hashtag, so a Singapore
  // unit number ("#01-84") or a "Scene #1" becomes a junk tag beside the real
  // keyword tags. The hash goes; the number stays and still reads correctly.
  let out = bits.join(' ').replace(/#(?=\S)/g, '').replace(/\s+/g, ' ').trim();
  if (out.length > MAX) out = out.slice(0, MAX).replace(/\s\S*$/, '');

  // 6. Search words as a tail. Pinterest reads hashtags as keywords, and these
  //    are the terms its searchers actually type.
  // Hashtags are CamelCased because Pinterest shows them verbatim and
  // "#ThingsToDoInKyoto" reads as words where "#thingstodoinkyoto" does not.
  const tag = (s) => '#' + String(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  const tags = [region, country, region && `Things to do in ${region}`].filter(Boolean).map(tag);
  const tail = ` Free guide on Wander Atlas. ${[...new Set(tags)].join(' ')}`.trimEnd();
  const full = out + tail;
  if (full.length <= 500) return full;
  // A hashtag cut in half is worse than a missing one: "#ThingsToDoInKyot" is a
  // different tag that nobody searches. Drop whole words instead.
  return full.slice(0, 500).replace(/\s\S*$/, '');
}
