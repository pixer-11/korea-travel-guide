// Design-uniformity audit over the BUILT site. Each check here is a class of
// inconsistency the owner had to catch by eye once (2026-08-09); this makes
// each a machine check so it cannot quietly return.
//
//   node scripts/audit-design-uniformity.mjs [distRoot]   # after a build
//   node scripts/audit-design-uniformity.mjs dist --allow-stale
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || 'dist';
const ALLOW_STALE = process.argv.includes('--allow-stale');
let fail = 0;
const bad = (code, msg) => { fail++; console.log(`  ✗ ${code}: ${msg}`); };
const ok = (msg) => console.log('  ✓ ' + msg);

// ---- CSS bundle checks -----------------------------------------------------
const cssDir = join(ROOT, '_astro');

// A STALE dist makes every check here a lie. On 2026-08-11 this reported three
// regressions — the crowd-chart palette, the newsletter container query, the
// icon plate — all of them fixes the owner had asked for by name, and all three
// were present in the source AND live on the site. The audit was reading a dist
// from three days earlier. An audit that reports yesterday's build as today's
// regressions costs more than it saves, so say so instead of guessing.
//
// Saying so was not enough. On 2026-08-12 the same stale dist (by then four days
// old) produced FOUR findings under the same printed warning, and the warning
// scrolled past while the findings got investigated one by one — all four false,
// again. A caveat a reader can walk past is not a guard. So the staleness check
// now REFUSES to answer: it exits 2 without running a single check, because
// "I cannot tell you" is the only honest output a stale dist supports.
// --allow-stale is the deliberate escape hatch for someone who wants the old
// behaviour and knows what they are reading.
try {
  const newestCss = Math.max(...readdirSync(cssDir).filter((f) => f.endsWith('.css'))
    .map((f) => statSync(join(cssDir, f)).mtimeMs));
  const newestSrc = Math.max(
    ...['src/styles/global.css', 'src/components', 'src/layouts']
      .flatMap((p) => {
        try {
          const s = statSync(p);
          if (!s.isDirectory()) return [s.mtimeMs];
          return readdirSync(p).map((f) => statSync(join(p, f)).mtimeMs);
        } catch { return []; }
      }),
  );
  if (newestSrc > newestCss) {
    const hours = Math.round((newestSrc - newestCss) / 36e5);
    // One line, not three: the Telegram digest reads every non-chrome line as
    // a separate finding, so a two-line "how to fix it" hint arrived as two
    // extra problems that did not exist.
    console.log(`\n  ✗ DESIGN-DIST-STALE: ${ROOT}/ is ${hours}h older than the source and cannot answer these checks — rebuild first (npx astro build), or pass a fresh dist; --allow-stale runs them anyway.\n`);
    if (!ALLOW_STALE) process.exit(2);
  }
} catch {}

const css = readdirSync(cssDir).filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n');

// 1) crowd chart semantics: busy must be the red tone, mid the beige.
if (css.includes('e08574') && !css.match(/crowd-demo-bar i\{[^}]*c67139/)) ok('crowd chart: busy=red, mid=beige');
else bad('DESIGN-CROWD-PALETTE', 'crowd chart palette regressed (busy must be #e08574, mid beige)');

// 2) newsletter must collapse by CONTAINER width, not only viewport.
if (css.includes('container-type:inline-size') || css.includes('container-type: inline-size')) ok('newsletter: container-based collapse present');
else bad('DESIGN-NEWSLETTER-CQ', 'newsletter container query missing — narrow columns will crush copy again');

// 3) card icon plates: every card icon class shares the pastel plate rule.
for (const cls of ['plan-ico', 'itin-hub-card-ico', 'itin-backlink-ico', 'hotels-ico']) {
  const re = new RegExp(`\\.${cls}[^{]*\\{[^}]*color-mix`);
  const shared = new RegExp(`\\.${cls}[,{]`);
  if (re.test(css) || (shared.test(css) && /color-mix\(in srgb, ?currentColor 13%/.test(css))) ok(`icon plate: .${cls}`);
  else bad('DESIGN-ICON-PLATE', `icon plate missing for ".${cls}"`);
}

// 4) dark color-scheme rides the system-dark path.
if (/prefers-color-scheme:\s?dark[^}]*\{[^{]*:root:not\(\[data-theme=light\]?\)?/.test(css) || css.includes('color-scheme:dark')) ok('color-scheme: dark declared');
else bad('DESIGN-COLOR-SCHEME', 'color-scheme: dark missing from system-dark path');

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
else bad('DESIGN-REGION-TILE', `region tiles without a photo: ${noPhoto} (${[...seen].join(', ')}) — add them to backfill-region-covers.mjs TARGETS and re-run it`);

// The tally glyphs are load-bearing: the Telegram digest treats "❌ <n>" as the
// run's own count and "✅" as a clean run, and reads every other line as a
// finding. A bare "FAIL 2 …" was counted as a third problem.
console.log(fail ? `\n❌ ${fail} uniformity check(s) failed` : '\n✅ All design-uniformity checks passed');
process.exit(fail ? 1 : 0);
