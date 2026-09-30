// Interest buckets for the itinerary hub's finder ("what do you like?").
// Worked out from each stop's own post — category, title, tags — so a course
// is tagged by what it actually visits. A heuristic, used only to FILTER and
// label courses, never to state a fact about a place (the same standard as the
// interest filter on the itinerary page itself).
export const HUB_CATS = ['history', 'food', 'nature', 'views', 'art'] as const;
export type HubCat = (typeof HUB_CATS)[number];

const RE: Record<HubCat, RegExp> = {
  history: /palace|temple|shrine|heritage|histor|cathedral|basilica|church|mosque|fort|castle|monaster|old (?:town|city)|gothic|ruin|angkor|pagoda|wat\b|tomb|sultan|plantation/i,
  food: /market|food|restaurant|caf[eé]|bakery|dessert|noodle|street food|bazaar|souk|hawker|dining|tapas|beignet/i,
  nature: /\bpark\b|garden|beach|nature|lake|river|mountain|forest|island|bay|coast|waterfall|arboretum|botanic|hike|trail/i,
  views: /view|observat|tower|skyline|rooftop|lookout|mirador|deck|night|harbou?r|bridge|sky/i,
  art: /museum|gallery|\bart\b|exhibit|teamlab|macba|mnac/i,
};

export function catsForPost(post: any): HubCat[] {
  const text = [post?.data?.title, post?.data?.category, post?.data?.place?.name, ...(post?.data?.tags ?? [])].join(' ');
  const cats = HUB_CATS.filter((c) => RE[c].test(text));
  if (post?.data?.category === 'restaurant' && !cats.includes('food')) cats.push('food');
  return cats;
}

/** A course's top buckets: the ones its stops hit most, at least once each. */
export function topCats(posts: any[], n = 3): HubCat[] {
  const count = new Map<HubCat, number>();
  for (const p of posts) for (const c of catsForPost(p)) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || HUB_CATS.indexOf(a[0]) - HUB_CATS.indexOf(b[0])).slice(0, n).map(([c]) => c);
}
