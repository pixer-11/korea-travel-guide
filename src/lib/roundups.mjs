// Which city roundup hubs exist, and which posts go in them.
//
// This lived twice — once in the English route and once in the localized one —
// with the category lists, the threshold and the ranking formula copied between
// them. Two copies of a rule is how the English and translated versions of the
// same page end up disagreeing about which cities have a hub at all, and the
// site has already been bitten twice this week by fixing one copy of something.
// One definition, imported by both routes.

/**
 * `cats: null` means "every category except events" — a city's whole catalogue.
 *
 * things-to-do used to be attractions-only, which is narrower than the question
 * it answers: someone searching "things to do in Bangkok" wants the food and the
 * cafés too, not just the temples. Restricting it also meant most cities cleared
 * no threshold at all, because their guides were split four ways — 11 hubs
 * existed across 166 cities. Widening this one key takes it to 38 without
 * lowering the bar for any of them.
 *
 * Events are excluded: they expire, and a roundup is meant to stay true.
 */
export const ROUNDUPS = {
  'things-to-do': { cats: null },
  'best-restaurants': { cats: ['restaurant'] },
  'cafes': { cats: ['trendy'] },
  'hidden-gems': { cats: ['hidden-gem'] },
};

// A hub needs enough entries to be worth ranking. Four is the floor: below that
// "the 3 best restaurants in X" is a list pretending to be a selection, and thin
// template pages are what search engines drop first.
export const MIN_ITEMS = 4;

// Rating alone puts a 5.0-from-11-reviews above a 4.6-from-40,000. Weighting by
// log(reviews) keeps the rating in charge while requiring the crowd to agree.
export const score = (p) =>
  (p.data.place?.rating ?? 0) * Math.log10((p.data.place?.userRatingsTotal ?? 0) + 10);

const inRoundup = (post, cfg) =>
  cfg.cats === null ? post.data.category !== 'event' : cfg.cats.includes(post.data.category);

/**
 * Every (region, roundup) pair that qualifies, with its ranked items.
 * Both routes build their paths from this, so they can never disagree.
 */
export function buildRoundups(posts) {
  const regions = [...new Set(posts.map((p) => p.data.region))].filter((r) => r && !r.includes('/'));
  const out = [];
  for (const region of regions) {
    for (const [key, cfg] of Object.entries(ROUNDUPS)) {
      const items = posts
        .filter((p) => p.data.region === region && inRoundup(p, cfg))
        .sort((a, b) => score(b) - score(a));
      if (items.length >= MIN_ITEMS) out.push({ region, key, cfg, items });
    }
  }
  return out;
}
