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
import { quietWindowSummary } from './quiet-window.mjs';

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

/**
 * The description for one post's pin. Pure.
 * @param {object} post  frontmatter: title, description, region, country,
 *                       category, place: { rating, userRatingsTotal, busyness }
 */
export function pinDescription(post = {}) {
  const region = post.region || '';
  const country = post.country || '';
  const place = post.place || {};
  const bits = [];

  // 1. The quiet window — the one fact no other travel page has.
  const quiet = friendlyHours(quietWindowSummary(place.busyness));
  if (quiet) bits.push(`Quietest ${quiet}.`);

  // 2. What it is and where, in the words people search.
  const where = [region, country].filter(Boolean).join(', ');
  const name = place.name || post.title || '';
  if (name && where) bits.push(`${name} in ${where}.`);
  else if (where) bits.push(`${where}.`);

  // 3. The rating, when it is real and well-reviewed enough to mean anything.
  if (place.rating && place.userRatingsTotal >= 50) {
    bits.push(`${place.rating}★ from ${Number(place.userRatingsTotal).toLocaleString('en-US')} visitors.`);
  }

  // 4. What the guide answers — the planner's checklist.
  bits.push('Opening hours, how to get there, and when to go to beat the crowds.');

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
