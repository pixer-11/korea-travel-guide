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

/**
 * The PICTURE SET a file belongs to: the same name with its extension and a
 * trailing frame counter removed. Commons stores a shoot as siblings —
 * "…Fashion_Concert20221218.jpg" and "…Fashion_Concert20221218-2.jpg" — and a
 * rejection written against one of them said nothing about the other.
 *
 * That is not hypothetical either. A person rejected the -2 frame of a Hong
 * Kong fashion concert on the Ultra Japan guide on 2026-09-09; the patrol put
 * the frame WITHOUT the suffix on the same page overnight, and it was still
 * there on 09-11. Used for HAND rejections only: a person saying "this is a
 * different event" is saying it about the shoot, while an automated verdict
 * ("bad crop", "too dark") is about the one frame it looked at.
 * @param {string} url
 */
export function photoFamily(url) {
  const id = photoIdentity(url);
  if (!id) return null;
  return id
    .replace(/\.(jpe?g|png|webp|gif|tiff?)$/i, '')
    .replace(/(?:[ _-]?\(\d{1,3}\)|[ _-]\d{1,3})$/, '')
    .toLowerCase();
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

// A PERSON read the Commons filename and said "this is a different event".
// Vision cannot make this call and must not unmake it: it sees a jazz festival
// and says MATCH to a jazz festival in Michoacan on the Hanoi Jazztival guide.
// That is not hypothetical — on 2026-09-08 the wrong photo was removed by hand
// at 10:40 and the alt-photo patrol put the same file back at 22:15, because
// the only rejection it could see was a vision verdict it had just overturned.
// So a hand rejection sticks for ANY category, events included, while the
// automated place-judge above stays venue-only: that one is what condemned a
// touring act photographed in another city (2026-08-23).
const HAND_PREFIX = 'hand-reviewed';

/**
 * True when a person recorded "this photo is not this event/place". Sticky
 * everywhere; no vision re-roll may overturn it.
 * @param {{verdict?: string, reason?: string} | unknown} entry
 */
export function isHandRejection(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!/MISMATCH/.test(String(entry.verdict ?? ''))) return false;
  return String(entry.reason ?? '').trim().toLowerCase().startsWith(HAND_PREFIX);
}

export function identityRejection(store, slug, url, category) {
  if (!store || !slug || !url) return null;
  const id = photoIdentity(url);
  if (!id) return null;
  const sticky = IDENTITY_STICKY_CATEGORIES.has(String(category ?? ''));
  const fam = photoFamily(url);
  const prefix = `${slug}${SEP}`;
  for (const [key, entry] of Object.entries(store)) {
    if (!key.startsWith(prefix)) continue;
    const other = key.slice(prefix.length);
    // A hand rejection covers the whole picture set; an automated one covers
    // only the frame it judged.
    if (isHandRejection(entry)) {
      if (fam && photoFamily(other) === fam) return entry;
      continue;
    }
    if (photoIdentity(other) !== id) continue;
    if (sticky && isIdentityRejection(entry)) return entry;
  }
  return null;
}
