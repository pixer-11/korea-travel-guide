// Which posts translate-posts is allowed to look at.
//
// Drafts are skipped: the English is still being worked on, the site never
// serves them, and translating ~200 held drafts into four languages is money
// spent on pages nobody can read.
//
// But a draft that was ALREADY translated keeps its old translation, and that
// translation can be broken. ja/mumbai-fielia dropped two English words into
// the Japanese ("が best と"); audit-latin-drops found it, repair-flagged-
// translations deleted the file to force a refill — and the refill never came,
// because the post is photo-held, so translate-posts walked past it. The repair
// put the broken copy back and reported "remaining=1" every time it ran. Worse,
// the moment a photo is found the post publishes and the broken Japanese goes
// live: srcHash only re-queues a translation when the ENGLISH changes, and the
// English is fine.
//
// So: a slug named explicitly on the command line is a caller pointing at one
// file it wants rebuilt. That overrides the draft skip. Nothing else does.
// (2026-09-20)

/**
 * The slugs named by --only, whether written as "slug" or "ja/slug".
 * @param {string[]} only  parsed --only entries
 * @returns {Set<string>}
 */
export function namedIds(only) {
  const ids = new Set();
  for (const entry of only || []) {
    const s = String(entry).trim().replace(/\.md$/, '');
    if (!s) continue;
    const i = s.indexOf('/');
    ids.add(i === -1 ? s : s.slice(i + 1));
  }
  return ids;
}

/**
 * @param {{draft?: boolean}|null|undefined} fm  the post's frontmatter
 * @param {string} id                            its slug
 * @param {Set<string>} named                    from namedIds()
 */
export function translatable(fm, id, named) {
  if (!fm) return false;
  if (!fm.draft) return true;
  return Boolean(named && named.has(id));
}
