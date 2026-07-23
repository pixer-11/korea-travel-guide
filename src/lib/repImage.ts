// Pick the most IDENTITY-REVEALING hero for a city/country tile.
// A place tile should show the place itself — a landmark, skyline or scenery —
// not a close-up of food and NEVER an event's artist/concert shot. So we rank
// candidate posts by category (attractions first, food last) and EXCLUDE events
// entirely: a concert hero is a photo of the performer (e.g. a K-pop group), which
// says nothing about the destination. A city with only event guides gets no tile
// image (empty), which is better than a musician standing in for the place.
const CAT_RANK: Record<string, number> = {
  attraction: 0, // palaces, temples, parks, viewpoints, nature — best for place identity
  'hidden-gem': 1,
  trendy: 2, // cafés — often interiors/coffee
  restaurant: 3, // food close-ups — last resort
};

type HeroPost = { data: { category: string; heroImage?: { url?: string } } };

export function pickRepHeroUrl(posts: HeroPost[]): string {
  const withHero = posts.filter(
    (p) =>
      p.data.category !== 'event' &&
      p.data.heroImage?.url &&
      !p.data.heroImage.url.includes('placeholder')
  );
  if (!withHero.length) return '';
  // Stable sort by category rank — ties keep the caller's order (usually newest first).
  withHero.sort((a, b) => (CAT_RANK[a.data.category] ?? 5) - (CAT_RANK[b.data.category] ?? 5));
  return withHero[0].data.heroImage!.url!;
}
