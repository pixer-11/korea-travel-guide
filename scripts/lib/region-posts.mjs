// The posts in the shape lib/region-outlier.mjs judges — one reader shared by
// the gate (audit-region-outliers) and the generator's birth check
// (regionAtBirth), so the two cannot drift apart on what a "committed post" is.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { regionExcuse } from './region-outlier.mjs';

/** The reader-facing text the region gate's Path 0 reads: description, quick answer, body, FAQ. */
export const postProse = (data, content) => [data.description, data.quickAnswer, content,
  ...(Array.isArray(data.faq) ? data.faq.map((f) => `${f?.q ?? ''} ${f?.a ?? ''}`) : [])].join('\n');

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
      ...(prose ? { prose: postProse(data, content) } : {}),
    });
  }
  return posts;
}

/**
 * A finished guide that says, in its own words, it is not in its region — the
 * gate's Path 0 asked of the markdown before the file exists. The writer,
 * handed a venue 100-400 km from the searched town, does not refuse; it writes
 * "The Omaka Aviation Heritage Centre is not in Franz Josef", and the gate held
 * that guide only after it had been translated four times (2026-11-06).
 * @returns {{region:string, excerpt:string, placeId:string|null, name:string, country:string}|null}
 */
export function regionDisowned(markdown) {
  let data, content;
  try { ({ data, content } = matter(String(markdown ?? ''))); } catch { return null; }
  const region = data.region ? String(data.region).trim() : '';
  const name = data.place?.name ? String(data.place.name) : '';
  const excerpt = region ? regionExcuse(postProse(data, content), region, name) : null;
  return excerpt ? { region, excerpt, name, placeId: data.place?.id ? String(data.place.id) : null, country: data.country ? String(data.country).trim() : '' } : null;
}
