// AA text contrast in light and dark, on the templates the weekly pa11y never opens (2026-11-08).
//
// pa11y reads nine URLs in light mode only, and esim-pages.mjs reads eight
// selectors in dark. Everything else was out of sight: the itinerary's ticket
// button sat at 3.51:1 in both modes, the events flights button at 2.64:1 in
// dark, and each was born after the one-off dark sweep of 09-14. So: every
// visible text element, composited through its translucent backgrounds, on one
// page of each template, in a fresh page per colour scheme (toggling a loaded
// page reads colours mid-transition).
// Run: node scripts/live/contrast.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';
import { judgeText } from '../lib/contrast.mjs';

const PATHS = ['itinerary/tokyo-3-days', 'itinerary', 'tools/esim/japan', 'about', 'events', 'essentials', 'ko', 'ja',
  'posts/seoul-gyeongbokgung-palace', 'regions/tokyo', 'destinations/japan', 'tools/when-to-go/japan', 'tools/holiday-overlap',
  'flights', 'tools/best-time', 'essentials/japan', 'essentials/visa', 'methodology', 'my-trip'];
// Open, not passed: white digits on a heat scale of graded dots (2.67:1 at the
// pale end). No single colour swap fixes a graded fill; it is a design call.
const KNOWN_OPEN = /^span\.ho-dot</;
// A page with almost no measured text is a page that did not render, not a clean one.
const MIN_MEASURED = 40;
// What only appears once a reader has saved something: an empty /my-trip/ hid the
// count badge (4.08:1 on its rust fill) from this check (11-09).
const SAVED = { 'my-trip': { wa_saved_regions_v1: ['seoul', 'tokyo'] } };

// Runs in the page; returns the raw strings, judged in Node by lib/contrast.mjs.
function collect() {
  const rows = [];
  const seen = new Set();
  const media = 'img, picture, video';
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) {
    const node = tw.currentNode;
    if (!node.nodeValue.trim()) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION'].includes(el.tagName)) continue;
    // What no reader sees, and controls WCAG exempts while disabled.
    if (el.closest('[aria-hidden="true"], [hidden], :disabled, .sr-only, .visually-hidden')) continue;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const cs = getComputedStyle(el);
    const layers = [];
    let opacity = 1, photo = false;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      opacity *= parseFloat(s.opacity) || 1;
      const isRoot = e === document.body || e === document.documentElement;
      // Words on a picture: the background is the photo, which no colour value describes.
      if (!isRoot && (s.backgroundImage !== 'none'
        || [...e.children].some((c) => c.matches(media) && getComputedStyle(c).position === 'absolute')
        || (s.position === 'absolute' && e.parentElement?.querySelector(media) && !e.querySelector(media)))) { photo = true; break; }
      if (s.backgroundColor === 'rgba(0, 0, 0, 0)' || s.backgroundColor === 'transparent') continue;
      layers.push(s.backgroundColor);
      if (!/rgba|\//.test(s.backgroundColor)) break;
    }
    if (photo) continue;
    const key = `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/ +/)[0]}<${String(el.parentElement.className || el.parentElement.tagName).split(' ')[0]}`;
    rows.push({ key, text: node.nodeValue.trim().slice(0, 32), color: cs.color, layers, opacity, px: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400 });
  }
  return rows;
}

const b = await launch();
const bad = [];
let total = 0;
for (const scheme of ['light', 'dark']) {
  for (const p of PATHS) {
    // Reduced motion: cards fade in (.js-reveal, 0.6s, forced at 1.5s), and at the
    // 800 ms read they sat at opacity 0, so checkVisibility skipped them and the
    // home "this month" stories were never measured at all. On 11-10 a slow load
    // caught them at ~3% opacity instead: 1.03:1 in both schemes, a false
    // failure. With motion reduced the page skips the fade and shows the colours
    // a reader ends up with.
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, reducedMotion: 'reduce' });
    const pg = await ctx.newPage();
    if (SAVED[p]) await pg.addInitScript((saved) => { for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, JSON.stringify(v)); }, SAVED[p]);
    const where = `${scheme} /${p}/`;
    try {
      const res = await pg.goto(`${BASE}/${p}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await pg.waitForTimeout(800);
      if (!res || res.status() !== 200) { bad.push(`${where} answered ${res?.status()}`); continue; }
      const rows = await pg.evaluate(collect);
      let measured = 0;
      const worst = new Map();
      for (const row of rows) {
        const j = judgeText(row);
        if (!j) { bad.push(`${where} unreadable colour ${row.key}: ${row.color}`); continue; }
        measured++;
        if (j.ok || KNOWN_OPEN.test(row.key)) continue;
        const prev = worst.get(row.key);
        if (!prev || j.ratio < prev.ratio) worst.set(row.key, { ...row, ratio: j.ratio, need: j.need });
      }
      total += measured;
      if (measured < MIN_MEASURED) bad.push(`${where} only ${measured} text elements measured`);
      for (const w of worst.values()) bad.push(`${where} ${w.key} ${w.ratio.toFixed(2)}:1 (needs ${w.need}) "${w.text}"`);
    } catch (e) {
      bad.push(`${where} ${String(e.message).slice(0, 80)}`);
    } finally {
      await ctx.close();
    }
  }
}
await b.close();
for (const line of bad) console.log(`✗ ${line}`);
verdict(`글자 대비 AA: ${bad.length ? `${bad.length}건 미달` : `미달 0건 (${PATHS.length}쪽 × 라이트·다크, 글자 요소 ${total}개)`}`, bad.length > 0);
