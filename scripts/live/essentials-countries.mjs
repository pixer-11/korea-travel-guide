// Live check, ported from the hand-run sweep-live.mjs (scratchpad, week of 2026-09-28).
// Run: node scripts/live/essentials-countries.mjs [base]  — default base is the live site (lib.mjs).
import { launch, BASE, verdict, ROOT, notLiveYet } from './lib.mjs';
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';
const slugs = fs.readdirSync(`${ROOT}/src/content/essentials`).filter((f) => f.endsWith('.md')).map((f) => f.replace('.md', ''));
const langs = ['', 'ko/', 'ja/', 'es/', 'zh/'];
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
const rows = []; const bad = [];
const jobs = slugs.flatMap((s) => langs.map((l) => `${l}essentials/${s}/`));
async function run(path) {
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  try {
    const r = await p.goto(`${BASE}/${path}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    if (r.status() === 404 && await notLiveYet(path)) { console.log(`WARN 배포 대기: /${path} — 저장소엔 있고 실서버 허브엔 아직 없음`); await p.close(); return; }
    const info = await p.evaluate(() => {
      const txt = document.querySelector('.ess')?.innerText ?? '';
      // Entities in any case; the words only as code prints them ("Nan Lian Garden" is a place).
      const leak = [...(txt.match(/&#x?[0-9a-f]+;|&amp;/gi) || []), ...(txt.match(/\bundefined\b|\bNaN\b|\[object /g) || [])].slice(0, 3);
      const n = (s) => document.querySelectorAll(s).length;
      return { hero: n('.ess-hero'), photo: n('.ess-hero-img'), sum: n('.ess-sum'), visa: n('.ess-visa-card'), transit: n('.ess-table tbody tr'), budget: n('.ess-budget'), season: n('.ess-srow'), sos: n('.ess-num'), hol: n('.ess-hol li'), src: n('.ess-sources li'), more: n('.ess-more'), climate: n('.ess-mo'),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1, leak };
    });
    rows.push({ path, status: r.status(), ...info, errs: errs.length });
    if (r.status() !== 200 || info.overflow || info.leak.length || errs.length || !info.hero || info.sum < 2) bad.push({ path, status: r.status(), overflow: info.overflow, leak: info.leak, errs: errs.slice(0, 2), sum: info.sum });
  } catch (e) { bad.push({ path, error: e.message.slice(0, 100) }); }
  await p.close();
}
const queue = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()); }));
// Into the temp folder: written to the working directory it sat untracked in the repo.
fs.writeFileSync(path.join(os.tmpdir(), 'wa-essentials-sweep.json'), JSON.stringify(rows, null, 1));
verdict(`pages ${rows.length} problems ${bad.length}`, bad.length > 0 || rows.length < 20);
for (const x of bad.slice(0, 20)) console.log(JSON.stringify(x));
const agg = (k) => rows.filter((r) => r[k] > 0).length;
console.log('with photo', agg('photo'), '· summary≥3', rows.filter((r) => r.sum >= 3).length, '· visa cards', agg('visa'), '· transit table', agg('transit'), '· budget', agg('budget'), '· season grid', agg('season'), '· emergency', agg('sos'), '· holidays', agg('hol'), '· climate', agg('climate'));
await b.close();
