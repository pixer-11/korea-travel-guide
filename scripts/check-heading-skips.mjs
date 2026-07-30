// No page may skip a heading level on the way down.
//
// h1→h3 reads fine to a sighted visitor and as a broken outline to everyone
// else: screen readers navigate by heading level, crawlers reconstruct the
// page's structure from it, and page-quality tools score the skip as a
// machine-generated tell. Two independent audits (2026-07-29 design session,
// 2026-07-30 WCAG session) each found the same offenders, and both lists are
// fixed — this keeps the NEXT component honest, because every one of today's
// skips came from a section label that was styled text instead of a heading.
//
// Going DOWN more than one level (h1→h3) fails. Going UP any distance (h4→h2,
// a new section after subsections) is normal outline behaviour and passes.
//
//   node scripts/check-heading-skips.mjs   (needs dist/ — run after a build)
import { readdirSync, readFileSync, existsSync } from 'fs';

if (!existsSync('dist')) { console.log('dist/ 없음 — 빌드 후 실행'); process.exit(0); }

const bad = new Map(); // "h1→h3" + first page → count
let pages = 0;
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = `${d}/${e.name}`;
    if (e.isDirectory()) {
      // Embed widgets are headless iframe fragments, not documents with outlines.
      if (e.name !== 'embed' && e.name !== 'wall') walk(p);
    } else if (e.name.endsWith('.html')) {
      const html = readFileSync(p, 'utf8');
      const seq = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
      if (!seq.length) continue;
      pages++;
      let prev = seq[0];
      for (const h of seq.slice(1)) {
        if (h > prev + 1) {
          const key = `h${prev}→h${h}`;
          if (!bad.has(key)) bad.set(key, { page: p.replace(/^dist/, ''), n: 0 });
          bad.get(key).n++;
        }
        prev = h;
      }
    }
  }
})('dist');

for (const [jump, info] of bad) console.log(`HEADING-SKIP ${jump} ×${info.n} — first: ${info.page}`);
console.log(bad.size
  ? `❌ ${[...bad.values()].reduce((a, b) => a + b.n, 0)} heading skip(s) across ${pages} page(s).`
  : `✓ ${pages} page(s) — no heading level is skipped anywhere.`);
process.exit(bad.size ? 1 : 0);
