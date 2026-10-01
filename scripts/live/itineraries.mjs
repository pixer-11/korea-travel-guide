// Live check, ported from the hand-run itsweep.mjs (scratchpad, week of 2026-09-28).
// Run: node scripts/live/itineraries.mjs [base]  — default base is the live site (lib.mjs).
import { launch, BASE, verdict, ROOT } from './lib.mjs';
import fs from 'node:fs';
const base = BASE;
const slugs = fs.readdirSync(`${ROOT}/src/content/itineraries`).filter((f) => f.endsWith('.md')).map((f) => f.replace('.md', ''));
const langs = ['', 'ko/', 'ja/', 'es/', 'zh/'];
const jobs = langs.flatMap((l) => [`${l}itinerary/`, ...slugs.map((s) => `${l}itinerary/${s}/`)]);
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
const rows = [], bad = [];
async function run(path) {
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  try {
    const r = await p.goto(`${base}/${path}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    const i = await p.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      // Case-sensitive: /gi flagged Hong Kong's "Nan Lian Garden" as NaN (10-01).
      const leak = (main.innerText.match(/\bundefined\b|\bNaN\b|\[object |\{[a-z]+\}/g) || []).slice(0, 3);
      return { h1: document.querySelectorAll('h1').length, noAlt: [...document.querySelectorAll('main img')].filter((x) => !x.hasAttribute('alt')).length,
        overflow: document.documentElement.scrollWidth > innerWidth + 1, leak, stats: document.querySelectorAll('.ith-stats > div').length, cards: document.querySelectorAll('[data-city-card]').length, book: document.querySelectorAll('.ith-book li').length };
    });
    rows.push({ path, status: r.status(), ...i });
    if (r.status() !== 200 || i.overflow || i.leak.length || errs.length || i.h1 !== 1 || i.noAlt) bad.push({ path, status: r.status(), ...i, errs: errs.slice(0, 2) });
  } catch (e) { bad.push({ path, error: e.message.slice(0, 100) }); }
  await p.close();
}
const q = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) await run(q.shift()); }));
verdict(`pages ${rows.length} problems ${bad.length}`, bad.length > 0 || rows.length < 10);
for (const x of bad.slice(0, 12)) console.log(JSON.stringify(x));
console.log('index cards', rows.filter((r) => /itinerary\/$/.test(r.path)).map((r) => r.path + ':' + r.cards).join(' '));
console.log('book-ahead per course (ko)', rows.filter((r) => r.path.startsWith('ko/itinerary/') && !r.path.endsWith('itinerary/')).map((r) => r.path.split('/')[2] + ':' + r.book).join(' '));
await b.close();
