// Cloudflare refuses a whole deploy when _redirects names the same source path
// twice ("Duplicate rule for path …", code 100324) — and it only says so at the
// upload step, after a 30-minute build. On 2026-10-02 the region alias map and
// the merged-spelling list both wrote /regions/goyang-si/ and the site stayed
// on the previous version.
//
// Several generators append to one file, so the check belongs where they meet.
// A rule repeated word for word is harmless and is dropped; the same source
// sent to two DIFFERENT places is a real disagreement between generators, and
// the build stops with both lines named.

const ruleSource = (line) => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return null;
  return t.split(/\s+/)[0];
};

/**
 * @param {string} existing  the _redirects text already on disk (may be '')
 * @param {string[]} lines   new rules to append
 * @returns {{ lines: string[], dropped: number, conflicts: string[] }}
 */
export function mergeRedirectRules(existing, lines) {
  const seen = new Map();
  for (const l of String(existing).split(/\r?\n/)) {
    const src = ruleSource(l);
    if (src && !seen.has(src)) seen.set(src, l.trim().replace(/\s+/g, ' '));
  }
  const out = [];
  const conflicts = [];
  let dropped = 0;
  for (const l of lines) {
    const src = ruleSource(l);
    if (!src) { out.push(l); continue; }
    const norm = l.trim().replace(/\s+/g, ' ');
    const prev = seen.get(src);
    if (prev === undefined) { seen.set(src, norm); out.push(l); continue; }
    if (prev === norm) { dropped++; continue; }
    conflicts.push(`${prev}  ⟷  ${norm}`);
  }
  return { lines: out, dropped, conflicts };
}
