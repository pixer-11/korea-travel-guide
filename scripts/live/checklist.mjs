// Live check, ported from the hand-run cksweep.mjs (scratchpad, week of 2026-09-28).
// Run: node scripts/live/checklist.mjs [base]  — default base is the live site (lib.mjs).
import { launch, BASE, verdict } from './lib.mjs';
const base = BASE;
const b = await launch();
for (const l of ['', 'ko/', 'ja/', 'es/', 'zh/']) {
  const p = await b.newPage({ viewport: { width: 390, height: 800 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const r = await p.goto(`${base}/${l}free/trip-checklist/`, { waitUntil: 'networkidle' });
  const i = await p.evaluate(() => ({ h1: document.querySelectorAll('h1').length, stages: document.querySelectorAll('[data-ck-stage]').length, items: document.querySelectorAll('input[data-ck-id]').length,
    overflow: document.documentElement.scrollWidth > innerWidth + 1, leak: (document.body.innerText.match(/undefined|NaN|\{[a-z]+\}/g) || []).length, title: document.title }));
  const bad = r.status() !== 200 || i.h1 !== 1 || i.stages < 3 || i.items < 10 || i.overflow || i.leak > 0 || errs.length > 0;
  verdict(`${bad ? '✗' : '✓'} ${l || 'en/'} ${r.status()} ${JSON.stringify(i)} errors ${errs.length}`, bad);
  await p.close();
}
await b.close();
