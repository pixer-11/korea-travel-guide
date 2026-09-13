// THE THIRD TIER, AS A TEST A CHECKER CAN RUN.
//
// Owner's rule, 2026-09-11: an event guide shows the act's own photo; failing
// that a past edition of the event; failing that the best photo of the city it
// is held in. fill-event-city-heroes.mjs places that third tier, and its claim
// is "a photo of this city" — which is why it deliberately does not ask the
// vision gate, whose question is "a photo of this event". A city skyline is a
// correct answer to one and a correct rejection by the other.
//
// audit-event-heroes.mjs asked only the second question and STRIPPED whatever
// failed. On 2026-09-13 that removed fifteen photographs that had been placed
// on purpose, and one of those strips reached the live site before it was
// reverted. This is the test it was missing: the same mechanical check the
// filler used to choose the photo in the first place.
//
// Venue counts too, and ranks above the city: a photograph of Qizhong Stadium
// on a Shanghai Masters guide is the place the reader is going, and it fails
// vision for the honest reason that no tennis is visible in it.
import { tokens } from './commons.mjs';

const fileOf = (u) => {
  const last = String(u ?? '').split('/').pop() ?? '';
  try { return decodeURIComponent(last); } catch { return last; }
};
// Wikimedia serves the same photograph at fixed widths, so the region cover and
// the hero placed from it differ only by a "1600px-" prefix (the thumbnail
// ladder). Compare the photograph, not the size we asked for.
const baseName = (u) => fileOf(u).toLowerCase().replace(/^[0-9]+px-/, '');
const sameImage = (a, b) => !!a && !!b && baseName(a) === baseName(b);

/**
 * Why this photo is allowed to stay even though it is not a photo OF the event,
 * or null when nothing justifies it.
 * @param {string} url       the hero's URL
 * @param {any} data         the post's frontmatter
 * @param {Record<string, {url?: string}>} [covers]  data/region-covers.json
 * @returns {string | null}  a human-readable reason, or null
 */
export function heroTierReason(url, data, covers = {}) {
  if (!url) return null;
  const name = fileOf(url).toLowerCase();
  const squashed = name.split(/[^a-z0-9]+/).join('');
  const names = (label) => {
    const list = tokens(label);
    return list.length ? list.some((tk) => name.includes(tk) || squashed.includes(tk)) : false;
  };

  const venue = String(data?.eventVenue ?? '').trim();
  if (venue && names(venue)) return `파일명이 행사장(${venue})을 가리킨다`;

  const region = String(data?.region ?? '').trim();
  if (!region) return null;
  if (sameImage(covers?.[region]?.url, url)) return `${region} 의 검증된 지역 커버`;
  return names(region) ? `파일명이 도시(${region})를 가리킨다` : null;
}
