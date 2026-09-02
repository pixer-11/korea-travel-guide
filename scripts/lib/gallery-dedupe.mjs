// The hero and an in-body photo can be the same picture at two URLs, and a
// rewrite that normalises both collapses them into one. On 2026-09-02 the
// Wikimedia ladder rewrite pointed two heroes at the thumbnail their own
// gallery already carried, and the pages then showed one photo twice — the
// same picture at the top and again halfway down the article.
//
// A gallery entry that IS the hero adds nothing, so it goes. Pure, so the
// rule can be tested without a repo.

/**
 * @param {{heroImage?: {url?: string}, gallery?: Array<{url?: string}>}} data frontmatter
 * @returns {number} how many duplicate gallery entries were removed (mutates `data`)
 */
export function dropGalleryCopiesOfHero(data) {
  const hero = data?.heroImage?.url;
  if (!hero || !Array.isArray(data.gallery)) return 0;
  const kept = data.gallery.filter((g) => g?.url !== hero);
  const removed = data.gallery.length - kept.length;
  if (!removed) return 0;
  if (kept.length) data.gallery = kept; else delete data.gallery;
  return removed;
}
