// Live check, ported from the hand-run hubsweep.mjs (scratchpad, week of 2026-09-28).
// Run: node scripts/live/essentials-hub.mjs [base]  — default base is the live site (lib.mjs).
import { launch, BASE, verdict } from './lib.mjs';
const base = BASE;
const b = await launch();
for (const l of ['', 'ko/', 'ja/', 'es/', 'zh/']) {
  const p = await b.newPage({ viewport: { width: 390, height: 800 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const r = await p.goto(`${base}/${l}essentials/`, { waitUntil: 'networkidle' });
  const i = await p.evaluate(() => {
    const panels = [...document.querySelectorAll('[data-exh-panel]')].map((x) => x.dataset.exhPanel + ':' + x.querySelectorAll('.exh-cell').length);
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join('');
    return { h1: document.querySelectorAll('h1').length, panels: panels.join(' '), topics: document.querySelectorAll('.exh-topic').length,
      regions: [...document.querySelectorAll('.exh-region h3')].map((h) => h.textContent).join('/'), faq: /FAQPage/.test(ld),
      overflow: document.documentElement.scrollWidth > innerWidth + 1, leak: (document.querySelector('main')?.innerText.match(/undefined|NaN|\{[a-z]+\}|\[object/g) || []), title: document.title,
      time: document.querySelector('[data-exh-panel]:not([hidden]) [data-exh-diff]')?.textContent };
  });
  const bad = r.status() !== 200 || i.h1 !== 1 || i.topics < 6 || !i.faq || !i.panels || i.overflow || i.leak.length > 0 || errs.length > 0;
  verdict(`${bad ? '✗' : '✓'} ${l || 'en/'} ${r.status()} ${JSON.stringify(i)} errors ${errs.length} ${errs.slice(0, 1)}`, bad);
  await p.close();
}
await b.close();
