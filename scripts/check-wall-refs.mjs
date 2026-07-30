// Every /wall/ thumbnail the BUILT SITE references must actually exist.
//
// The per-post data check cannot catch what this catches: the night the city
// tiles went dark, every post's own thumbnail existed — the defect was a
// template hashing an already-transformed URL, so the PAGES referenced file
// names no pipeline had ever produced. Only the build output knows what the
// pages actually ask for.
//
//   node scripts/check-wall-refs.mjs        (needs dist/ — run after a build)
import { readdirSync, readFileSync, existsSync } from 'fs';

if (!existsSync('dist')) { console.log('dist/ 없음 — 빌드 후 실행'); process.exit(0); }

const refs = new Map(); // name -> first page that references it
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = `${d}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'wall') walk(p); }
    else if (e.name.endsWith('.html')) {
      const s = readFileSync(p, 'utf8');
      for (const m of s.matchAll(/\/wall\/([a-f0-9]{16}\.webp)/g)) {
        if (!refs.has(m[1])) refs.set(m[1], p.replace(/^dist/, ''));
      }
    }
  }
})('dist');

const missing = [...refs].filter(([name]) => !existsSync(`dist/wall/${name}`));
for (const [name, page] of missing.slice(0, 10)) console.log(`WALL-REF-MISSING: ${name} — first used on ${page}`);
console.log(missing.length
  ? `❌ ${missing.length} of ${refs.size} referenced thumbnail(s) do not exist — tiles render as dark boxes.`
  : `✓ ${refs.size} referenced thumbnail(s) all exist.`);
process.exit(missing.length ? 1 : 0);
