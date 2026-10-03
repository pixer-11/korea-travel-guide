// Phone-width overflow across every PAGE TYPE in all five languages (2026-10-02).
//
// Born from a day of one-page-at-a-time fixes: /privacy overflowed only in
// English, /my-trip only in en/es/ja, the plan cards only in Spanish — each
// found by someone measuring a page nobody had measured. The shared cause was
// `grid-template-columns: 1fr` (a column that grows to its content's
// min-width) in 17 files. A sample of each page type, every language, at the
// narrowest common phone width, so the next one is found here instead.
// Run: node scripts/live/mobile-sweep.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';

const PATHS = ['', 'destinations', 'destinations/japan', 'destinations/spain', 'regions', 'regions/seoul', 'regions/ho-chi-minh-city', 'regions/barcelona',
  'continents/europe', 'posts/seoul-gyeongbokgung-palace', 'itinerary', 'itinerary/tokyo-3-days', 'events', 'events/japan', 'essentials', 'essentials/visa',
  'essentials/japan', 'tools/best-time', 'tools/when-to-go', 'tools/when-to-go/japan', 'tools/holiday-overlap', 'tools/whats-closed', 'tools/esim', 'my-trip',
  'free/trip-checklist', 'flights', 'newsletter', 'about', 'privacy', 'contact', 'methodology', 'terms', 'day-trips/seoul'];
const LANGS = ['', '/ko', '/ja', '/es', '/zh'];
const WIDTH = 320;

const b = await launch();
const pg = await b.newPage({ viewport: { width: WIDTH, height: 800 } });
// A wide font, on purpose. An input's own width is its character count in the
// page font, and fonts differ by device: /destinations overflowed only on the
// Linux runner (Korean fallback font) and passed on Windows (10-02). Larger
// input text stands in for the widest font a reader may have, so the next
// input that sets its box's minimum width fails here on any machine — it
// found /contact's subject line the same way (10-03).
await pg.addInitScript(() => addEventListener('DOMContentLoaded', () => {
  const s = document.createElement('style');
  s.textContent = 'input,select,textarea{font-size:21px!important}';
  document.head.append(s);
}));
const bad = [];
for (const l of LANGS) for (const p of PATHS) {
  const url = `${BASE}${l}/${p}${p ? '/' : ''}`;
  try {
    const res = await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await pg.waitForTimeout(500);
    if (!res || res.status() !== 200) { bad.push(`${res?.status()} ${l}/${p}`); continue; }
    const r = await pg.evaluate(() => {
      document.querySelectorAll('details').forEach((d) => { d.open = true; });
      const cw = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth;
      if (sw <= cw + 1) return null;
      // Name the element that actually pushes the page — not one that merely
      // sits inside a strip meant to scroll sideways.
      const scrolls = (e) => { for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
      const over = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > cw + 1 && !scrolls(e));
      const leaf = over.filter((e) => ![...e.children].some((c) => over.includes(c)))[0];
      return `${sw}px ${leaf ? `${leaf.tagName.toLowerCase()}.${String(leaf.className).split(' ')[0]}` : '?'}`;
    });
    if (r) bad.push(`${l || '/en'}/${p} ${r}`);
  } catch (e) { bad.push(`ERR ${l}/${p} ${String(e.message).slice(0, 60)}`); }
}
await b.close();
verdict(`휴대폰 ${WIDTH}px 넘침: ${bad.length ? bad.join(' | ') : `없음 (${PATHS.length}종 × 5개 언어)`}`, bad.length > 0);
