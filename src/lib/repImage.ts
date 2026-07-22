// Pick the most IDENTITY-REVEALING hero for a city/country tile.
// A place tile should show the place itself — a landmark, skyline or scenery —
// not a close-up of food. So we rank candidate posts by category: attractions
// (landmarks/scenery) first, restaurants (food) last, everything else between.
// A food-famous city with no attraction guide yet still falls back to its food
// photo, which is fine — but the moment an attraction guide exists, it wins.
const CAT_RANK: Record<string, number> = {
  attraction: 0, // palaces, temples, parks, viewpoints, nature — best for place identity
  'hidden-gem': 1,
  event: 2, // festivals — usually a scene/crowd shot
  trendy: 3, // cafés — often interiors/coffee
  restaurant: 4, // food close-ups — last resort
};

type HeroPost = { data: { category: string; heroImage?: { url?: string } } };

export function pickRepHeroUrl(posts: HeroPost[]): string {
  const withHero = posts.filter(
    (p) => p.data.heroImage?.url && !p.data.heroImage.url.includes('placeholder')
  );
  if (!withHero.length) return '';
  // Stable sort by category rank — ties keep the caller's order (usually newest first).
  withHero.sort((a, b) => (CAT_RANK[a.data.category] ?? 5) - (CAT_RANK[b.data.category] ?? 5));
  return withHero[0].data.heroImage!.url!;
}
