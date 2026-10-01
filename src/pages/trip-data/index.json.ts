import { getCollection } from 'astro:content';
import { slugifyRegion } from '../../lib/slug';

// Every city that has a /trip-data/<lang>/<city>.json file. Saves made before
// 2026-10-01 carry no region slug; /my-trip finds theirs as the longest city
// slug their post slug starts with ("barcelona-casa-batllo" → barcelona) and
// confirms it against that city's file.
export async function GET() {
  const posts = await getCollection('posts', ({ data }) => !data.draft && data.category !== 'event' && !!data.place && data.place.lat != null);
  const regions = [...new Set(posts.map((p) => slugifyRegion(p.data.region ?? '')).filter(Boolean))].sort();
  return new Response(JSON.stringify({ regions }), { headers: { 'Content-Type': 'application/json' } });
}
