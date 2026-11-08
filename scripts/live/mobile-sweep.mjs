// Phone-width overflow across every PAGE TYPE in all five languages (2026-10-02).
//
// Born from a day of one-page-at-a-time fixes: /privacy overflowed only in
// English, /my-trip only in en/es/ja, the plan cards only in Spanish — each
// found by someone measuring a page nobody had measured. The shared cause was
// `grid-template-columns: 1fr` (a column that grows to its content's
// min-width) in 17 files. A sample of each page type, every language, at the
// narrowest common phone width, so the next one is found here instead.
//
// The 12px phone floor is read here too (2026-11-08). The rule from 08-22 listed
// selectors, nothing measured it, and every component born after it was outside
// it: post labels at 10.9-11.8px on every guide, 8 other templates below that.
// Words in a details are counted (the sweep opens them), hidden ones are not.
// Run: node scripts/live/mobile-sweep.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';

const PATHS = ['', 'destinations', 'destinations/japan', 'destinations/spain', 'regions', 'regions/seoul', 'regions/ho-chi-minh-city', 'regions/barcelona',
  'continents/europe', 'posts/seoul-gyeongbokgung-palace', 'itinerary', 'itinerary/tokyo-3-days', 'events', 'events/japan', 'essentials', 'essentials/visa',
  'essentials/japan', 'tools/best-time', 'tools/when-to-go', 'tools/when-to-go/japan', 'tools/holiday-overlap', 'tools/whats-closed', 'tools/esim', 'tools/esim/japan', 'my-trip',
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
const tiny = new Map();
const thin = new Map();
for (const l of LANGS) for (const p of PATHS) {
  const url = `${BASE}${l}/${p}${p ? '/' : ''}`;
  try {
    const res = await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await pg.waitForTimeout(500);
    if (!res || res.status() !== 200) { bad.push(`${res?.status()} ${l}/${p}`); continue; }
    const r = await pg.evaluate(() => {
      document.querySelectorAll('details').forEach((d) => { d.open = true; });
      const small = {};
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (tw.nextNode()) {
        const el = tw.currentNode.parentElement;
        if (!tw.currentNode.nodeValue.trim() || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
        // An SVG label's px are drawing units, scaled with the picture.
        if (el.closest('svg') || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < 11.99) small[`${el.tagName.toLowerCase()}.${String(el.className).trim().split(/ +/)[0]}<${String(el.parentElement.className || el.parentElement.tagName).split(' ')[0]}`] = px;
      }
      // Thin tap targets (11-08), by name: a link inside a sentence is exempt, and a scan can't tell.
      const short = {};
      for (const sel of ['.disclosure-details > summary', '.bz-embed > summary', '.itin-how > summary', '.pcrowd-more', '.post-byline > a', '.crumbs a',
        '.hv3-foot a', '.hv3-stats a', '.es-more', '.es-crumbs a', '.ep-toggle', '.evp-credit', '.itin-leg-directions']) {
        const low = [...document.querySelectorAll(sel)].find((e) => e.checkVisibility() && e.getBoundingClientRect().height < 24);
        if (low) short[sel] = low.getBoundingClientRect().height;
      }
      // A summary keeps its ▶: display:inline-flex looked like the fix and wiped it.
      for (const sel of ['.disclosure-details > summary', '.bz-embed > summary']) {
        if ([...document.querySelectorAll(sel)].some((e) => getComputedStyle(e).display !== 'list-item')) short[`${sel} (▶ gone)`] = 0;
      }
      const cw = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth;
      if (sw <= cw + 1) return { small, short };
      // Name the element that actually pushes the page — not one that merely
      // sits inside a strip meant to scroll sideways.
      const scrolls = (e) => { for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
      const over = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > cw + 1 && !scrolls(e));
      const leaf = over.filter((e) => ![...e.children].some((c) => over.includes(c)))[0];
      return { small, short, over: `${sw}px ${leaf ? `${leaf.tagName.toLowerCase()}.${String(leaf.className).split(' ')[0]}` : '?'}` };
    });
    if (r.over) bad.push(`${l || '/en'}/${p} ${r.over}`);
    for (const [k, px] of Object.entries(r.small)) if (!tiny.has(k)) tiny.set(k, `${l || '/en'}/${p} ${px.toFixed(1)}px`);
    for (const [k, h] of Object.entries(r.short)) if (!thin.has(k)) thin.set(k, `${l || '/en'}/${p} ${h.toFixed(1)}px`);
  } catch (e) { bad.push(`ERR ${l}/${p} ${String(e.message).slice(0, 60)}`); }
}
await b.close();
for (const [k, where] of tiny) console.log(`✗ 12px 미만 ${k} — ${where}`);
for (const [k, where] of thin) console.log(`✗ 터치 영역 24px 미만 ${k} — ${where}`);
verdict(`휴대폰 ${WIDTH}px 넘침: ${bad.length ? bad.join(' | ') : `없음 (${PATHS.length}종 × 5개 언어)`} · 12px 미만 글자: ${tiny.size}종 · 얇은 터치 영역: ${thin.size}종`, bad.length > 0 || tiny.size > 0 || thin.size > 0);
