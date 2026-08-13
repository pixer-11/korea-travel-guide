/**
 * Reading a wrecked working tree — the shared checkout lives in %TEMP%.
 *
 * C:\Users\user\wa-main is a linked worktree whose git dir
 * sits safely on the Desktop, but the *checkout itself* is inside the Windows
 * temp folder, which Disk Cleanup's SilentCleanup task empties of anything it
 * considers stale. On 2026-08-13 at 20:11 KST it ran and took 67 tracked files
 * with it — src/pages routes, components, workflows, half of scripts/ — plus
 * almost all of node_modules. Nothing was lost from history (only the checkout
 * is in %TEMP%), but every build and every cron in that tree was broken until
 * a session noticed by hand.
 *
 * The danger is not the breakage, it is the local cron runners: they stage a
 * whole directory (`git add src/content/posts`) and push. A purge that reaches
 * old posts would turn into a commit that deletes hundreds of live articles —
 * the 2026-07-26 accident (92 posts deleted, 40% of traffic gone) but bigger
 * and unattended. So the rules here are pure and tested: what may be restored,
 * and what must never be committed.
 */

/** Parse `git status --porcelain=v1 -z` into {x, y, path} records. */
export function parseStatusZ(text) {
  const out = [];
  const parts = String(text).split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const x = entry[0];
    const y = entry[1];
    const path = entry.slice(3);
    if (!path) continue;
    // Renames/copies carry their source path in the next NUL-separated field.
    if (x === 'R' || x === 'C') { out.push({ x, y, path, from: parts[++i] || '' }); continue; }
    out.push({ x, y, path });
  }
  return out;
}

/**
 * Files a purge took: tracked, gone from the working tree, and nobody asked
 * for that. A staged deletion (`D ` / `AD`) is somebody's deliberate removal
 * mid-work — healing that would undo a session's edit, so it is left alone.
 */
export function purgedPaths(entries) {
  return entries.filter((e) => e.x === ' ' && e.y === 'D').map((e) => e.path);
}

/**
 * The guard the runners lean on. Given what a commit is about to stage, say
 * whether it would remove files from the repo. Cron scripts have no business
 * deleting content — every deletion they have ever produced was damage.
 */
export function deletionsAmongStaged(entries) {
  return entries.filter((e) => e.x === 'D' || (e.x === 'R' && e.y === 'D')).map((e) => e.path);
}

/**
 * node_modules after a purge is the worst kind of broken: the directory and
 * most of its bytes are still there, so a `test -d node_modules` check passes
 * while `import 'js-yaml'` throws. Compare what the lockfile promises against
 * what is actually on disk instead.
 */
export function missingPackages(lockPackageNames, presentNames) {
  const present = new Set(presentNames);
  return lockPackageNames.filter((n) => !present.has(n));
}

/**
 * Top-level packages a lockfile expects under node_modules/ *on this machine*.
 *
 * A lockfile also lists every platform's prebuilt binary (@esbuild/android-arm,
 * @rollup/rollup-linux-x64-gnu…), and npm correctly skips the ones that do not
 * apply. Counting those as missing made the first version of this check report
 * 74 absent packages on a perfectly healthy install — a guard that cries wolf
 * every run is a guard that gets ignored.
 */
export function lockTopLevelPackages(lock, { platform = process.platform, arch = process.arch } = {}) {
  const names = new Set();
  for (const [key, meta] of Object.entries(lock?.packages || {})) {
    if (!key.startsWith('node_modules/')) continue;
    const rest = key.slice('node_modules/'.length);
    if (rest.includes('/node_modules/')) continue; // nested copy, not top level
    if (meta?.optional) continue;                  // npm installs it only if it fits
    if (Array.isArray(meta?.os) && !meta.os.includes(platform)) continue;
    if (Array.isArray(meta?.cpu) && !meta.cpu.includes(arch)) continue;
    names.add(rest.startsWith('@') ? rest.split('/').slice(0, 2).join('/') : rest.split('/')[0]);
  }
  return [...names];
}
