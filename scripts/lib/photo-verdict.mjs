// ─────────────────────────────────────────────────────────────
//  A REJECTION FOLLOWS THE PHOTO, NOT THE URL.
//
//  data/visual-audit.json is keyed `slug \x01 exact URL`, and every gate reads
//  it by that exact key. That holds only while one photo has one URL — which
//  stopped being true twice:
//    · 2026-08-31 Wikimedia began answering on thumb.wikimedia.org. The same
//      file arrived under a host the store had never seen, so the patrol's
//      "was this judged wrong before?" lookup missed and vision — which cannot
//      see identity at all — waved four rejected photos back onto their posts.
//      One was a Hong Kong congee shop on a Gardena restaurant guide, rejected
//      by the identity audit on 08-14 for naming a different venue and country.
//    · The width ladder does the same thing more quietly: .../3840px-Foo.jpg
//      and .../1920px-Foo.jpg are two keys for one picture, and gardena's store
//      row carries a MATCH at one width and a MISMATCH at the other.
//
//  So identity-grade rejections are matched by the Commons FILE, host- and
//  width-independent, and they stick: only a check that can see identity may
//  overturn one, never a vision re-roll. (audit-verdict.mjs draws the other
//  line — judged wrong vs never fetched. Both must pass before a gate acts.)
//
//  Scope: venue-grade posts only. An event page is about the ACT, and the
//  place-based identity judge condemns a touring act's photo taken in another
//  city — BABYMONSTER in Seattle on the Yokohama show. That is a false
//  rejection for events (2026-08-23: five checker layers were discarding
//  legitimate event photos), so stickiness must not resurrect it.
// ─────────────────────────────────────────────────────────────

/** Posts whose hero must BE the named place. Events are about the act. */
export const IDENTITY_STICKY_CATEGORIES = new Set(['restaurant', 'trendy', 'hidden-gem', 'attraction']);

const SEP = String.fromCharCode(1);

/**
 * One picture, one string — the Commons file title, whatever host or thumbnail
 * width the URL happens to carry. Null for anything that is not a Commons file.
 * @param {string} url
 */
export function photoIdentity(url) {
  if (!url || !/(?:upload|thumb)\.wikimedia\.org/.test(url)) return null;
  const m = /\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(url);
  if (!m) return null;
  try { return `commons:${decodeURIComponent(m[1])}`; } catch { return `commons:${m[1]}`; }
}

// What the identity paths write: audit-photo-identity ("identity audit: …"),
// the patrol's own identity gate ("patrol reject: identity: …") and the
// hand-run deep audits ("… wrong venue (…)"). A vision verdict reads like a
// caption ("Ancient ruins park, not a restaurant venue") and is NOT sticky —
// marseille-port-antique and naples-pompeii were both correctly re-approved
// after one, and stickiness must leave those alone.
const IDENTITY_GRADE = /\bidentity\b|metadata (?:names|contradicts)|wrong venue|wrong place|different venue/i;

/**
 * True when the entry records "this is not that place", not "this looks wrong".
 * @param {{verdict?: string, reason?: string} | unknown} entry
 */
export function isIdentityRejection(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!/MISMATCH/.test(String(entry.verdict ?? ''))) return false;
  return IDENTITY_GRADE.test(String(entry.reason ?? ''));
}

/**
 * The identity rejection standing against this photo for this post, under any
 * host or thumbnail width — or null when there is none, when the URL is not a
 * Commons file, or when the post is not venue-grade.
 *
 * @param {Record<string, any>} store data/visual-audit.json
 * @param {string} slug
 * @param {string} url the URL being considered
 * @param {string} [category] the post's category; omitted = not sticky
 */
export function identityRejection(store, slug, url, category) {
  if (!store || !slug || !url) return null;
  if (!IDENTITY_STICKY_CATEGORIES.has(String(category ?? ''))) return null;
  const id = photoIdentity(url);
  if (!id) return null;
  const prefix = `${slug}${SEP}`;
  for (const [key, entry] of Object.entries(store)) {
    if (!key.startsWith(prefix)) continue;
    if (photoIdentity(key.slice(prefix.length)) !== id) continue;
    if (isIdentityRejection(entry)) return entry;
  }
  return null;
}
