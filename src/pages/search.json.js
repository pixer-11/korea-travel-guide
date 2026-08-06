import { getCollection } from 'astro:content';
import countriesData from '../../data/countries.json';
import { slugifyRegion } from '../lib/slug';

// Build-time search index: countries, cities/regions, and every guide.
// Fetched once by the homepage search box and filtered client-side.
export async function GET() {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  const items = [];

  // Countries (that have guides)
  for (const c of countriesData.countries) {
    if (posts.some((p) => (p.data.country ?? 'South Korea') === c.name)) {
      items.push({ t: c.name, s: c.continent, u: `/destinations/${c.slug}`, k: 'Country' });
    }
  }

  // Cities / regions (unique)
  const regions = new Map();
  for (const p of posts) {
    if (!regions.has(p.data.region)) regions.set(p.data.region, p.data.country ?? 'South Korea');
  }
  for (const [r, country] of regions) {
    // slugifyRegion, not toLowerCase — and a trailing slash. Raw lowercasing
    // left spaces and accents in the URL for half the 170 cities in this index
    // ("/regions/ho chi minh city", "/regions/alcañiz"), and the safety nets do
    // not cover it: the redirect map expects a trailing slash, and the build's
    // trailing-slash pass only rewrites hrefs in built HTML, while these are
    // injected client-side by the search box. Every multi-word city was a broken
    // search result — including many of the 102 added on 2026-08-05 (Mont
    // Saint-Michel, Cinque Terre, Hua Hin, San Diego…).
    items.push({ t: r, s: country, u: `/regions/${slugifyRegion(r)}/`, k: 'City' });
  }

  // Guides (places / hotspots)
  for (const p of posts) {
    items.push({
      t: p.data.place?.name ?? p.data.title,
      s: `${p.data.region}, ${p.data.country ?? 'South Korea'}`,
      u: `/posts/${p.id}`,
      k: p.data.category === 'event' ? 'Event' : 'Guide',
    });
  }

  return new Response(JSON.stringify(items), {
    headers: { 'Content-Type': 'application/json' },
  });
}
