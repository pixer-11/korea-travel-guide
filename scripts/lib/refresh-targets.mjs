// Which posts a freshness run should re-check.
//
// The cursor rotation is the right default — oldest-checked-first is what keeps
// the whole catalogue moving on a fixed Places budget. What it cannot do is
// answer a question about ONE post. 2026-09-22: tokyo-smith-wollensky was held
// under the 4.0 rating floor on a July reading of 3.9, while a duplicate of the
// same place.id carried an August reading of 4.1 — and the post had NEVER been
// checked, sitting behind ~980 other never-checked posts at 50 calls a day.
// Deciding whether the venue belongs on the site meant waiting weeks for the
// rotation to reach it, or spending one targeted call.
//
// Same precision-targeting switch backfill-details.mjs already takes, so the
// two Places jobs read alike: `--slugs=a,b` on the command line, or REFRESH_SLUGS
// in the environment for the workflow_dispatch input to pass through.

/**
 * Slugs a run was told to target, or an empty set meaning "the usual rotation".
 * Accepts filenames too, so a pasted `foo.md` works.
 * @param {string[]} argv process.argv
 * @param {Record<string, string | undefined>} env process.env
 * @returns {Set<string>}
 */
export function parseSlugTargets(argv = [], env = {}) {
  const flag = argv.find((a) => a.startsWith('--slugs='))?.slice('--slugs='.length);
  const raw = flag ?? env.REFRESH_SLUGS ?? '';
  return new Set(
    String(raw)
      .split(',')
      .map((s) => s.trim().replace(/\.md$/, ''))
      .filter(Boolean),
  );
}

/**
 * Is this post file one of the targets? An empty target set means every post,
 * which is the unattended rotation — a targeting bug must never silently turn
 * a daily run into a no-op.
 * @param {string} file post filename, e.g. "tokyo-smith-wollensky.md"
 * @param {Set<string>} targets
 */
export function isTargeted(file, targets) {
  if (!targets.size) return true;
  return targets.has(String(file).replace(/\.md$/, ''));
}
