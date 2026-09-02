// ─────────────────────────────────────────────────────────────
//  WIKIMEDIA THUMBNAIL WIDTHS — ask for a size that exists.
//
//  upload.wikimedia.org used to render a thumbnail at ANY width you put in the
//  path. It does not any more: only a fixed ladder of widths is served, and a
//  direct request for anything else is REJECTED (HTTP 400/429, body: "Use
//  thumbnail sizes listed on https://w.wiki/GHai"). The API rounds up for you;
//  hand-built URLs — which is what every rung trick in this repo is — do not
//  get that courtesy.
//
//  What this cost: on 2026-08-10 a Lighthouse fix swapped the hero <img> from
//  the stored 1920px URL to a hand-built 1200px one to cut LCP bytes. 1200 is
//  not on the ladder, so EVERY article hero on the site 400'd — the lead photo
//  of every guide went blank, sitewide, within hours of the deploy. Body photos
//  kept their stored URLs and kept working, which is exactly the split the
//  owner reported ("상단에 있는 사진만 깨지는거야").
//
//  Three of the four rung tricks in the codebase were off-ladder at that point
//  (480, 1200, 2400, 2600); only repImage's 960 happened to be legal. So the
//  ladder lives here, once, and callers pick FROM it instead of inventing a
//  number.
// ─────────────────────────────────────────────────────────────

/** The widths upload.wikimedia.org will actually serve (mediawiki.org/wiki/Common_thumbnail_sizes). */
export const WIKIMEDIA_WIDTHS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840];

/** Smallest legal width >= want (so the image is never upscaled by the browser); largest if none. */
export const legalWidth = (want) =>
  WIKIMEDIA_WIDTHS.find((w) => w >= want) ?? WIKIMEDIA_WIDTHS[WIKIMEDIA_WIDTHS.length - 1];

/**
 * Rewrite a Wikimedia thumb URL to a width the servers will serve.
 *
 * Only touches upload.wikimedia.org URLs that already carry a /NNNpx- segment —
 * a Foursquare or R2 URL passes through untouched, and so does an original-file
 * URL with no thumb segment (there is no smaller rendition to ask for).
 *
 * NEVER upscales: asking for a rung above the stored width returns 400 on files
 * whose original is smaller, so a request that would go UP is left alone.
 */
export function wikimediaThumb(url, wantWidth) {
  const s = String(url ?? '');
  if (!/(?:upload|thumb)\.wikimedia\.org/.test(s)) return s;
  const m = s.match(/\/(\d{2,4})px-/);
  if (!m) return s;
  const have = Number(m[1]);
  const want = legalWidth(wantWidth);
  if (want >= have) return s;          // never ask for more than what is stored
  return s.replace(/\/(\d{2,4})px-/, `/${want}px-`);
}
