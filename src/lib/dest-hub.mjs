// Pure helpers behind the country hub (DestinationHub.astro, 2026-09-24
// redesign). Every value the hub's summary row and city cards show is computed
// here from repo data — no month, count or photo is typed into the template.
// Pure functions over arguments, so node --test can exercise them without Astro.

import { monthComfort } from './when-to-go.mjs';

const dayStr = (d) => {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
};

/**
 * The country's easiest one or two months by monthComfort() — the SAME ranking
 * the when-to-go tool shows, so the hub can never disagree with the page it
 * links to. The runner-up is only included when it sits in the same comfort
 * band as the winner; "best months: May · August" where August is merely
 * "fair" would overstate it.
 *
 * Returned in calendar order, except that a December–January pair reads
 * Dec · Jan rather than Jan · Dec. Empty when there is no 12-month record.
 * @returns {number[]} month numbers 1–12
 */
export function bestMonths(climate) {
  const comfort = monthComfort(climate);
  if (!comfort) return [];
  const ranked = [...comfort].sort((a, b) => a.score - b.score);
  const picks = [ranked[0]];
  if (ranked[1] && ranked[1].band === ranked[0].band) picks.push(ranked[1]);
  const ms = picks.map((c) => c.m).sort((a, b) => a - b);
  if (ms.length === 2 && ms[0] === 1 && ms[1] === 12) return [12, 1];
  return ms;
}

/**
 * Event counts for the summary cell.
 *   upcoming  — not over yet (same rule as eventStatus.isEventPast: an event is
 *               over only once a KNOWN end date is before today)
 *   thisMonth — upcoming AND starting on or before the last day of today's
 *               month, so an event already running counts too
 * Dates compare as UTC day strings, like eventStatus does.
 */
export function eventCounts(posts, today = new Date()) {
  const todayStr = dayStr(today);
  const t = new Date(today);
  const monthEnd = dayStr(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)));
  let upcoming = 0;
  let thisMonth = 0;
  for (const p of posts ?? []) {
    const d = p?.data ?? {};
    if (d.category !== 'event') continue;
    const end = d.eventEndDate ? dayStr(d.eventEndDate) : '';
    if (end && end < todayStr) continue;
    upcoming++;
    const start = d.eventStartDate ? dayStr(d.eventStartDate) : '';
    if (start && start <= monthEnd) thisMonth++;
  }
  return { upcoming, thisMonth };
}

/**
 * Cities ranked by how many guides we have there (events included — they are
 * guides the reader can open). Ties break alphabetically so the order is stable
 * from one build to the next.
 * @returns {{ region: string, count: number }[]}
 */
export function citiesByGuideCount(posts) {
  const counts = new Map();
  for (const p of posts ?? []) {
    const r = p?.data?.region;
    if (!r) continue;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region));
}

/**
 * The best-known venue guides in a city, by review volume — what a city card
 * names as a sample. Events are left out: a concert is not what a city is.
 */
export function topVenues(posts, region, n = 3) {
  return (posts ?? [])
    .filter((p) => p?.data?.region === region && p.data.category !== 'event')
    .sort((a, b) => (b.data.place?.userRatingsTotal ?? 0) - (a.data.place?.userRatingsTotal ?? 0))
    .slice(0, n);
}

// Category order for a hero that has to say "this country": landmarks and
// scenery first, food close-ups last. Same ranking as repImage.ts uses for tiles.
const CAT_RANK = { attraction: 0, 'hidden-gem': 1, trendy: 2, restaurant: 3 };

// Stock photography is not a photo OF the place, whatever the caption says.
const NOT_A_PLACE_PHOTO = new Set(['placeholder', 'unsplash']);

/**
 * The post whose hero the hub opens with, or null.
 *
 * Only from our own post heroes — the ones that passed the photo gates as a
 * photo of THAT venue — and never:
 *   · an event hero (a performer on a stage says nothing about the country)
 *   · a placeholder or stock (Unsplash) image
 *   · a hero measured narrower than 800px (it would be stretched to the width
 *     of the screen)
 * Among the rest: proven ≥1200px first, then unmeasured, then 800–1199; within
 * each, landmarks before cafés before food; then the most-reviewed venue, which
 * is usually the one the country is known for.
 *
 * @param {any[]} posts
 * @param {(post: any) => number | null} [widthOf] measured width or null —
 *   ogPhoto.heroWidth in the component, injected so this stays pure.
 */
export function pickHubHero(posts, widthOf = () => null) {
  const tier = (w) => (w === null || w === undefined ? 1 : w >= 1200 ? 0 : 2);
  const eligible = (posts ?? []).filter((p) => {
    const h = p?.data?.heroImage;
    if (!h?.url || p.data.category === 'event') return false;
    if (NOT_A_PLACE_PHOTO.has(h.license) || h.url.includes('placeholder')) return false;
    const w = widthOf(p);
    return !(typeof w === 'number' && w < 800);
  });
  const key = (p) => [tier(widthOf(p)), CAT_RANK[p.data.category] ?? 5, -(p.data.place?.userRatingsTotal ?? 0)];
  eligible.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return String(a.id).localeCompare(String(b.id));
  });
  return eligible[0] ?? null;
}
