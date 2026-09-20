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
import { quietWindowSummary } from './quiet-window.mjs';
import { closedDaysOf } from '../../src/lib/itinerary.mjs';

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
  if (!summary) return null;
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
const MONEY = /[$€£¥₩฿]\s?\d|\b\d+([.,]\d+)?\s?(usd|eur|gbp|jpy|krw|thb|vnd|idr|php|baht|won|yen|euros?|dollars?|pounds?)\b/i;

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
export function uniformHours(lines) {
  if (!Array.isArray(lines) || lines.length !== 7) return null;
  const times = lines.map((l) => (/^\w+:\s*(.+)$/.exec(String(l).trim()) || [])[1]).filter(Boolean);
  if (times.length !== 7) return null;
  const set = new Set(times.map((t) => t.trim()));
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
  const t = String(text);
  if (/\b(was|were)\s+(set|scheduled|held|due|planned)\b|took place|has (ended|closed|wrapped)|\bended\b|\bran from\b/i.test(t)) return true;
  const thisYear = now.getFullYear();
  // Only the RECENT past ages a pin. "Rebuilt in 1867" and "opened in 1998"
  // are history and stay true forever; "September 2025" is a stale listing.
  for (const m of t.matchAll(/\b(19|20)\d{2}\b/g)) {
    const y = Number(m[0]);
    if (y < thisYear && y >= thisYear - 5) return true;
  }
  return false;
}

/**
 * The opening sentence: the first rung that holds.
 * @returns {{text: string, kind: 'quiet'|'closed'|'hours'|'answer'} | null}
 */
export function openingHook(post = {}) {
  const place = post.place || {};

  const quiet = friendlyHours(quietWindowSummary(place.busyness));
  if (quiet) return { text: `Quietest ${quiet}.`, kind: 'quiet' };

  const closed = closedDaysOf(place.openingHours);
  if (closed.length && closed.length <= 2) {
    return { text: `Closed ${listOf(closed.map((d) => `${d}s`))}.`, kind: 'closed' };
  }
  if (closed.length >= 3 && closed.length <= 5) {
    const open = DAYS.filter((d) => !closed.includes(d));
    if (open.length) return { text: `Open ${listOf(open.map((d) => `${d}s`))} only.`, kind: 'closed' };
  }

  const daily = uniformHours(place.openingHours);
  if (daily && !MONEY.test(daily)) return { text: `Open daily ${daily}.`, kind: 'hours' };

  // The guide's own opening answer — already fact-checked at publish time.
  // A pin outlives the page it points at: Pinterest never re-reads a
  // description, so a sentence that is only true this month must not be the
  // hook. "MEFCC 2026 was set for September 11-13" reads as news for a week
  // and as a dead pin forever after — and the ended-event rewrites put that
  // past tense into the corpus on purpose.
  const first = String(post.quickAnswer || '').split(/(?<=[.!?])\s/)[0];
  if (first && first.length >= 40 && first.length <= 220 && !MONEY.test(first) && !isPerishable(first)) {
    return { text: first.trim(), kind: 'answer' };
  }
  return null;
}

// What the guide actually contains — claimed only when the body shows it, so a
// pin never advertises a section the reader will not find (40% of guides have
// no getting-there passage, and every pin used to promise one).
export function offersLine(body = '', { hoursShown = false, hasHours = false } = {}) {
  const text = String(body);
  const offers = [];
  if (hasHours && !hoursShown) offers.push('opening hours');
  if (/getting (there|around)|how to get|nearest (station|stop)|take the (subway|metro|bus|train)/i.test(text)) {
    offers.push('how to get there');
  }
  if (/when to (go|visit)|best time|quiet|crowd/i.test(text)) offers.push('when to go to beat the crowds');
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
export function pinDescription(post = {}, body = '') {
  const region = post.region || '';
  const country = post.country || '';
  const place = post.place || {};
  const bits = [];

  // 1. The hook: the best verified fact this post has, quiet hours first.
  const hook = openingHook(post);
  if (hook) bits.push(hook.text);

  // 2. What it is and where, in the words people search.
  const where = [region, country].filter(Boolean).join(', ');
  const name = place.name || post.title || '';
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
  if (bits.length <= 2 && post.description) bits.splice(1, 0, String(post.description).split(/(?<=[.!?])\s/)[0]);

  let out = bits.join(' ').replace(/\s+/g, ' ').trim();
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
  return (out + tail).slice(0, 500);
}
