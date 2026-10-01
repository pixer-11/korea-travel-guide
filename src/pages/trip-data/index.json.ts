import { getCollection } from 'astro:content';
import { slugifyRegion } from '../../lib/slug';
import countriesData from '../../../data/countries.json';

// City slug → country slug, for /my-trip: the data lives in one file per
// country (/trip-data/<lang>/<country>.json). Saves made before 2026-10-01
// carry no region slug; /my-trip finds theirs as the longest city slug their
// post slug starts with ("barcelona-casa-batllo" → barcelona) and confirms it
// against that country's file.
export async function GET() {
  const posts = await getCollection('posts', ({ data }) => !data.draft && !!data.place && data.place.lat != null);
  const regions: Record<string, string> = {};
  for (const p of posts) {
    const rs = slugifyRegion(p.data.region ?? '');
    const cs = countriesData.countries.find((c) => c.name === (p.data.country ?? 'South Korea'))?.slug;
    if (rs && cs && !regions[rs]) regions[rs] = cs;
  }
  return new Response(JSON.stringify({ regions }), { headers: { 'Content-Type': 'application/json' } });
}
