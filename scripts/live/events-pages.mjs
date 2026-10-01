// Live check, ported from the hand-run evsweep-live.mjs (scratchpad, week of 2026-09-28).
// Run: node scripts/live/events-pages.mjs [base]  — default base is the live site (lib.mjs).
import { launch, BASE, verdict, ROOT } from './lib.mjs';
import fs from 'node:fs';
const cs = JSON.parse(fs.readFileSync(`${ROOT}/data/countries.json`, 'utf8')).countries.filter((c) => c.active).map((c) => c.slug);
const langs = ['', 'ko/', 'ja/', 'es/', 'zh/'];
const jobs = langs.flatMap((l) => [`${l}events/`, ...cs.map((s) => `${l}events/${s}/`)]);
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
const rows = [], bad = [];
async function run(path) {
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  try {
    const r = await p.goto(`${BASE}/${path}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    if (r.status() === 404) { rows.push({ path, status: 404 }); await p.close(); return; }
    const info = await p.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      const txt = main.innerText;
      // Entities in any case; the words only as code prints them ("Nan Lian Garden" is a place).
      const leak = [...(txt.match(/&#x?[0-9a-f]+;|&amp;/gi) || []), ...(txt.match(/\bundefined\b|\bNaN\b|\[object |\{[a-z]+\}/g) || [])].slice(0, 3);
      const noAlt = [...document.querySelectorAll('main img')].filter((i) => !i.hasAttribute('alt')).length;
      return { h1: document.querySelectorAll('h1').length, rows: document.querySelectorAll('.ev-row').length, picks: document.querySelectorAll('.evp-card').length, ending: document.querySelectorAll('.ev-end-card').length,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1, leak, noAlt, title: document.title };
    });
    rows.push({ path, status: r.status(), ...info });
    if (r.status() !== 200 || info.overflow || info.leak.length || errs.length || info.h1 !== 1 || info.noAlt) bad.push({ path, status: r.status(), ...info, errs: errs.slice(0, 2) });
  } catch (e) { bad.push({ path, error: e.message.slice(0, 100) }); }
  await p.close();
}
const q = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) await run(q.shift()); }));
verdict(`pages ${rows.length} 200: ${rows.filter((r) => r.status === 200).length} 404: ${rows.filter((r) => r.status === 404).length} problems ${bad.length}`, bad.length > 0);
for (const x of bad.slice(0, 15)) console.log(JSON.stringify(x));
for (const l of langs) { const r = rows.find((x) => x.path === `${l}events/`); console.log(l || 'en/', r?.title, 'picks', r?.picks, 'ending', r?.ending, 'rows', r?.rows); }
await b.close();
