// Region NAME normalizations: an old or satellite spelling whose hub 301s to a
// canonical city, so an indexed URL keeps its equity. One table for the build
// (redirects + sitemap, astro.config.mjs) and for the publish gate, which
// retags a new post at birth (scripts/gate-new-posts.mjs).
//
// Why the gate needs it: the alias 301s a hub unconditionally. A live post
// still tagged with the alias source therefore sits on a hub nobody can reach
// and is missing from the target hub — Quezon City's two concert guides were
// invisible on the Manila hub that way until 2026-10-02.
import { slugify } from '../../scripts/lib/slugify.mjs';

/** @type {Record<string, string>} source slug → canonical slug */
export const REGION_ALIAS = {
  'new-york-city': 'new-york',
  'metro-manila': 'manila',
  'pasay-city': 'manila',
  'quezon-city': 'manila',
  'makati-city': 'makati',
  xian: 'xi-an',
  // Greater-Bangkok satellite: Nonthaburi (Impact Arena's province) has no
  // hub of its own, which sent its quarantined concert post's 301 to the
  // homepage. Bangkok is where those visitors were going anyway — same
  // metro-area convention as pasay/quezon → manila above.
  nonthaburi: 'bangkok',
  // Same city under two spellings (2026-10-02, the owner's regions mock-up
  // review): each had its own thin hub beside the real one. The posts were
  // retagged to the canonical name; these keep the old hub URLs landing.
  'goyang-si': 'goyang',
  'ha-long': 'ha-long-bay',
  washington: 'washington-dc',
  // Event discovery wrote the official name for two posts (2026-10-05 audit):
  // a two-post "Frankfurt am Main" hub stood beside the real Frankfurt one.
  'frankfurt-am-main': 'frankfurt',
};

/** The region name a post should carry for each canonical slug above. */
export const REGION_CANONICAL_NAME = {
  'new-york': 'New York',
  manila: 'Manila',
  makati: 'Makati',
  'xi-an': "Xi'an",
  bangkok: 'Bangkok',
  goyang: 'Goyang',
  'ha-long-bay': 'Ha Long Bay',
  'washington-dc': 'Washington DC',
  frankfurt: 'Frankfurt',
};

/** The canonical region name for `region`, or null when it is not an alias source. */
export function canonicalRegion(region) {
  const to = REGION_ALIAS[slugify(String(region ?? ''))];
  return to ? REGION_CANONICAL_NAME[to] ?? null : null;
}
