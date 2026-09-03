// The one reader of a post's hero image URL.
//
// 2026-08-19: `loadUsedImageUrls` — the set that stops two posts from sharing a
// photo — read the hero with a regex for the FIRST `  url:` line in the file.
// That regex was wrong twice over:
//
//   1. A folded scalar (`url: >-` with the URL on the next line) captured the
//      literal string ">-". 106 live posts registered ">-" instead of their hero,
//      so their photos looked unclaimed to every picker.
//   2. When a post puts `officialLink.url` ABOVE heroImage — field order varies,
//      gray-matter round-trips reorder — the first match was the ticket site.
//      7 more posts, wuhan-2026-wuhan-open-snooker among them.
//
// Net effect: ~113 heroes were invisible to duplicate avoidance, and the daily
// patrol handed the same snooker-table photo to Taiyuan and Wuhan.
//
// validate-content already learned this lesson (see its parsePost comment: "a
// regex can't read a `credit: >-` folded scalar or a quoted URL reliably") and
// switched to gray-matter. The audit and the prevention now read the hero the
// same way — one juror, not two.
import matter from 'gray-matter';
import { photoIdentity } from './photo-verdict.mjs';

/** Hero image URL of a post's raw file text, or null. */
export function heroUrlOf(src) {
  let data;
  try {
    data = matter(String(src ?? '')).data;
  } catch {
    return null; // unparseable frontmatter — validate-content reports it separately
  }
  const u = data?.heroImage?.url;
  return typeof u === 'string' && u.trim() ? u.trim() : null;
}

// ── One photo, every spelling ───────────────────────────────────────────────
//
// 2026-09-03: two cities of one tour wore one portrait — twice over. Bangkok
// held Post_Malone_July_2021.jpg as a 1920px thumbnail and the photo patrol
// handed Kuala Lumpur the ORIGINAL of the same file (08-09); Singapore held the
// Weeknd portrait at 1280px and the width upgrade handed Saitama its original
// (08-20). The `used` set that exists to prevent exactly this compared exact
// strings, so neither photo looked taken. The 09-02 normaliser then folded
// every original into a ladder thumbnail, the strings finally met, and the
// validator alarmed the owner on every run for a duplicate that had been there
// for weeks. The photo was shared all along; only the spelling differed.
//
// So a used-set entry is the PHOTO: the exact URL (anything non-Commons keeps
// working as before), the Unsplash photo number (images.mjs has keyed on it
// since the query-param dupes), and the Commons file under any host or
// thumbnail width (photo-verdict.mjs already answers that question for
// rejections; this is the same answer for reservations). Every picker that
// asks "is this taken?" goes through isUsedImage, every path that claims a
// photo through markUsedImage — one rule, one file, rather than the three
// spellings of `used.has(url)` that let this through.

/** Every key one image answers to in a used-set — exact URL first, strongest identity last. */
export function imageKeys(url) {
  const u = typeof url === 'string' ? url.trim() : '';
  if (!u) return [];
  const keys = [u];
  const n = /photo-(\d+)/.exec(u);
  if (n) keys.push(`unum:${n[1]}`);
  const id = photoIdentity(u);
  if (id) keys.push(id);
  return keys;
}

/** One string per photo: the Commons file, the Unsplash number, else the URL itself. Null for no URL. */
export function imageIdentity(url) {
  const keys = imageKeys(url);
  return keys.length ? keys[keys.length - 1] : null;
}

/** Is this photo — under ANY of its spellings — already claimed in `used`? */
export function isUsedImage(used, url) {
  if (!used || !url) return false;
  return imageKeys(url).some((k) => used.has(k));
}

/** Claim a photo in `used` under every spelling a later picker might try. */
export function markUsedImage(used, url) {
  if (!used || !url) return;
  for (const k of imageKeys(url)) used.add(k);
}

/** Release a reservation made by markUsedImage (a caller un-marking its own pick). */
export function unmarkUsedImage(used, url) {
  if (!used || !url) return;
  for (const k of imageKeys(url)) used.delete(k);
}

/**
 * Among posts wearing one photo, the one that keeps it: the earliest
 * published, then the first slug — the rule reresolve-dupe-heroes has applied
 * since 08-19, now shared with the patrol so the two never disagree about
 * which twin changes.
 * @param {{slug: string, pubDate?: unknown}[]} owners
 */
export function heroKeeper(owners) {
  const day = (p) => (p?.pubDate instanceof Date ? p.pubDate.toISOString().slice(0, 10) : String(p?.pubDate || ''));
  return [...(owners || [])].sort((a, b) =>
    day(a).localeCompare(day(b)) || String(a?.slug || '').localeCompare(String(b?.slug || '')))[0] || null;
}
