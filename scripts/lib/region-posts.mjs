// The posts in the shape lib/region-outlier.mjs judges — one reader shared by
// the gate (audit-region-outliers) and the generator's birth check
// (regionAtBirth), so the two cannot drift apart on what a "committed post" is.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

/**
 * `prose: true` adds the reader-facing text (description, quick answer, body,
 * FAQ) for the region gate's Path 0; the generator's birth check skips it.
 * @returns {{file,country,region,lat,lng,address,draft,inScope,prose?}[]}
 */
export function loadRegionPosts(dir, scope = new Set(), { prose = false } = {}) {
  const posts = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    let data, content;
    try { ({ data, content } = matter(readFileSync(join(dir, file), 'utf8'))); } catch { continue; } // validate-content reports unreadable files
    posts.push({
      file,
      country: data.country ? String(data.country).trim() : '',
      region: data.region ? String(data.region).trim() : '',
      lat: data.place?.lat,
      lng: data.place?.lng,
      address: data.place?.address ? String(data.place.address) : '',
      name: data.place?.name ? String(data.place.name) : '',
      draft: data.draft === true,
      inScope: scope.has(file),
      ...(prose ? {
        prose: [data.description, data.quickAnswer, content,
          ...(Array.isArray(data.faq) ? data.faq.map((f) => `${f?.q ?? ''} ${f?.a ?? ''}`) : [])].join('\n'),
      } : {}),
    });
  }
  return posts;
}
