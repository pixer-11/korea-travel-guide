import { getCollection } from 'astro:content';
import countriesData from '../../data/countries.json';
import { buildSearchIndex } from '../lib/searchIndex';

// Build-time search index for the English site: countries, cities/regions,
// and every guide. Fetched once by the homepage search box and filtered
// client-side. The localized indexes live at /<lang>/search.json and are
// built by the same function.
export async function GET() {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  const items = buildSearchIndex({ lang: 'en', posts, countries: countriesData.countries });
  return new Response(JSON.stringify(items), {
    headers: { 'Content-Type': 'application/json' },
  });
}
