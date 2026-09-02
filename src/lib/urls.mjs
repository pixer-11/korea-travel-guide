// One rule for absolute site URLs. The host answers slash-less paths with a
// 307 to the slashed form and every canonical/sitemap entry is slashed, but
// JSON-LD and a handful of components built their own absolute URLs — nine
// places, each with its own habit (`${site}/about`, `new URL(card.href(id),
// Astro.site)`, `${site}/posts/${slug}`), ~234 URL pairs in the 09-02 audit.
// Relative `href="/…"` was already normalized post-build by the
// trailing-slash-links integration in astro.config.mjs; this is the same rule
// for absolute URLs, applied where they are built instead of patched after.

export const SITE_ORIGIN = 'https://wanderatlasguides.com';

// "/foo.xml", "/og/abc.webp", "/robots.txt" — a dot in the last segment means a
// real file, and files never take a trailing slash. Mirrors fixUrl() in
// astro.config.mjs so the two rules cannot drift apart on what counts as a file.
const isFile = (path) => path.slice(path.lastIndexOf('/') + 1).includes('.');

const slashPath = (path) => {
  if (path === '' || path.endsWith('/')) return path || '/';
  return isFile(path) ? path : `${path}/`;
};

const originOf = (site) => {
  try { return new URL(String(site)).origin; } catch { return null; }
};

/**
 * Append the trailing slash our canonicals use, when it is missing.
 * - root-relative paths ("/ko/destinations") always get it
 * - absolute URLs get it only when their origin is the site's own
 * - files (".xml", ".webp", …), "?query" and "#hash" are preserved — the slash
 *   goes before the query/hash, never after
 * - external hosts, protocol-relative ("//…") and page-relative ("foo") URLs
 *   come back untouched
 * @param {string} url
 * @param {string | URL | undefined} [site]
 * @returns {string}
 */
export function withTrailingSlash(url, site = SITE_ORIGIN) {
  if (typeof url !== 'string' || url === '') return url;
  if (url.startsWith('//')) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    let u;
    try { u = new URL(url); } catch { return url; }
    const origin = originOf(site ?? SITE_ORIGIN);
    if (!origin || u.origin !== origin) return url;
    u.pathname = slashPath(u.pathname);
    return u.toString();
  }
  if (!url.startsWith('/')) return url;
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const qAt = beforeHash.indexOf('?');
  const query = qAt === -1 ? '' : beforeHash.slice(qAt);
  const path = qAt === -1 ? beforeHash : beforeHash.slice(0, qAt);
  return `${slashPath(path)}${query}${hash}`;
}

/**
 * Absolute, canonical-form URL for a site path: `siteHref('/ko/events', Astro.site)`
 * → "https://wanderatlasguides.com/ko/events/". Drop-in for the
 * `new URL(path, Astro.site).toString()` idiom, plus the slash rule.
 * @param {string} path root-relative path (or an absolute URL, passed through the same rule)
 * @param {string | URL | undefined} [site] Astro.site; falls back to SITE_ORIGIN
 * @returns {string}
 */
export function siteHref(path, site) {
  const base = site ? String(site) : SITE_ORIGIN;
  let abs;
  try { abs = new URL(path, base).toString(); } catch { abs = path; }
  return withTrailingSlash(abs, base);
}
