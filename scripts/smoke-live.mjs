// ─────────────────────────────────────────────────────────────
//  POST-DEPLOY SMOKE TEST — actually poke the live site.
//
//  Every deploy so far was verified by hand-written one-off watch loops;
//  the weekly retro (08-09) flagged "no standing check that touches the
//  live site" as a silent-failure class. This is that check: a handful of
//  load-bearing pages, each with a marker that proves the page is not just
//  200 but RENDERED (Workers assets can 200 an empty shell).
//  Cache-busted (?v=) — CF serves HIT for days otherwise.
//
//   node scripts/smoke-live.mjs            # exits 1 on any failure
// ─────────────────────────────────────────────────────────────
const BASE = process.env.SMOKE_BASE || 'https://wanderatlasguides.com';
const cb = () => `v=${Math.random().toString(36).slice(2, 8)}`;

const CHECKS = [
  ['/', ['hero-wall', 'itin-row', 'crowd-demo-bar', '/#editor']],
  ['/ko/', ['topbar-langs', 'nl-form', 'essentials-strip']],
  ['/ja/', ['tool-card--crowd']],
  ['/destinations/', ['country-grid']],
  ['/tools/best-time/', ['tool']],
  ['/itinerary/', ['itin']],
  ['/about/', ['Pixer']],
  ['/sitemap-index.xml', ['<sitemap>']],
];

let fail = 0;
for (const [path, markers] of CHECKS) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}${cb()}`;
  let body = '', status = 0;
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'wa-smoke/1.0' } });
    status = r.status; body = await r.text();
  } catch (e) { console.log(`  ✗ ${path} — fetch failed: ${e.message}`); fail++; continue; }
  if (status !== 200) { console.log(`  ✗ ${path} — HTTP ${status}`); fail++; continue; }
  const missing = markers.filter((m) => !m.split(',').some((alt) => body.includes(alt)));
  if (missing.length) { console.log(`  ✗ ${path} — 200 but missing marker(s): ${missing.join(' | ')}`); fail++; }
  else console.log(`  ✓ ${path}`);
}
console.log(fail ? `SMOKE FAIL ${fail}` : 'SMOKE OK');
process.exit(fail ? 1 : 0);
