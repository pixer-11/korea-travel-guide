// Design-uniformity audit over the BUILT site. Each check here is a class of
// inconsistency the owner had to catch by eye once (2026-08-09); this makes
// each a machine check so it cannot quietly return.
//
//   node scripts/audit-design-uniformity.mjs [distRoot]   # after a build
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] || 'dist';
let fail = 0;
const bad = (msg) => { fail++; console.log('  ✗ ' + msg); };
const ok = (msg) => console.log('  ✓ ' + msg);

// ---- CSS bundle checks -----------------------------------------------------
const cssDir = join(ROOT, '_astro');
const css = readdirSync(cssDir).filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n');

// 1) crowd chart semantics: busy must be the red tone, mid the beige.
if (css.includes('e08574') && !css.match(/crowd-demo-bar i\{[^}]*c67139/)) ok('crowd chart: busy=red, mid=beige');
else bad('crowd chart palette regressed (busy must be #e08574, mid beige)');

// 2) newsletter must collapse by CONTAINER width, not only viewport.
if (css.includes('container-type:inline-size') || css.includes('container-type: inline-size')) ok('newsletter: container-based collapse present');
else bad('newsletter container query missing — narrow columns will crush copy again');

// 3) card icon plates: every card icon class shares the pastel plate rule.
for (const cls of ['plan-ico', 'itin-hub-card-ico', 'itin-backlink-ico', 'hotels-ico']) {
  const re = new RegExp(`\\.${cls}[^{]*\\{[^}]*color-mix`);
  const shared = new RegExp(`\\.${cls}[,{]`);
  if (re.test(css) || (shared.test(css) && /color-mix\(in srgb, ?currentColor 13%/.test(css))) ok(`icon plate: .${cls}`);
  else bad(`icon plate missing for .${cls}`);
}

// 4) dark color-scheme rides the system-dark path.
if (/prefers-color-scheme:\s?dark[^}]*\{[^{]*:root:not\(\[data-theme=light\]?\)?/.test(css) || css.includes('color-scheme:dark')) ok('color-scheme: dark declared');
else bad('color-scheme: dark missing from system-dark path');

// ---- HTML checks -----------------------------------------------------------
// 5) no-photo region tiles: the cover backfill exists precisely so these are
// zero. Scan English pages only (tiles are language-independent).
let noPhoto = 0;
const seen = new Set();
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (['ko', 'ja', 'es', 'zh', '_astro', 'wall', 'images'].includes(e)) continue;
      walk(p);
    } else if (e === 'index.html') {
      const h = readFileSync(p, 'utf8');
      for (const m of h.matchAll(/class="region-tile[^"]*no-photo[^"]*"[^>]*>\s*<span>([^<&]+)/g)) {
        noPhoto++; seen.add(m[1].trim());
      }
    }
  }
};
walk(ROOT);
if (noPhoto === 0) ok('region tiles: none without a photo');
else bad(`region tiles without a photo: ${noPhoto} (${[...seen].join(', ')}) — add them to backfill-region-covers.mjs TARGETS and re-run it`);

console.log(fail ? `\nFAIL ${fail} uniformity check(s)` : '\nAll design-uniformity checks passed');
process.exit(fail ? 1 : 0);
