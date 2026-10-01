// Live check, ported from the hand-run ovfall-live.mjs (scratchpad, week of 2026-09-28).
// Run: node scripts/live/topics-mobile.mjs [base]  — default base is the live site (lib.mjs).
import { launch, BASE, verdict } from './lib.mjs';
const b = await launch();
const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
let bad = [];
for (const l of ['', '/ko', '/ja', '/es', '/zh']) for (const t of ['visa', 'transport', 'luggage-storage', 'money', 'best-time-to-visit', 'emergency']) {
  await pg.goto(`${BASE}${l}/essentials/${t}/`, { waitUntil: 'networkidle', timeout: 120000 });
  const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
  if (sw > 391) bad.push(`${l}/${t} ${sw}`);
}
verdict(`mobile overflow: ${bad.length ? bad.join(', ') : 'none (30 pages)'}`, bad.length > 0);
await b.close();
