import { getCollection } from 'astro:content';
import countriesData from '../../data/countries.json';

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
    items.push({ t: r, s: country, u: `/regions/${r.toLowerCase()}`, k: 'City' });
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
