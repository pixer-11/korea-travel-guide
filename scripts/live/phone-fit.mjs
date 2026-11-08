// Cut-off cards and cells at the widths most phones have (2026-11-09).
//
// mobile-sweep asks whether the PAGE scrolls sideways, at 320px. A card with
// overflow:hidden never makes it scroll; it cuts. When the 12px floor made phone
// labels wider, December fell off the country card at 360-389px, the methodology
// rows ran past their card and Spanish tile labels left their tiles, and the
// sweep, on the one width where the narrow rules apply, saw none of it.
// So: what sticks out of the card that clips it, out of its grid, or out of its
// own cell, and photo credits that lost their licence, at 360 and 390px; the
// country card's month strip at every width where its layout changes.
// Run: node scripts/live/phone-fit.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';
import { pastBy, wordsPastCell, creditCut, monthStripProblems } from '../lib/phone-fit.mjs';

const PATHS = ['', 'destinations', 'destinations/japan', 'destinations/spain', 'regions', 'regions/seoul', 'regions/ho-chi-minh-city', 'regions/barcelona',
  'continents/europe', 'posts/seoul-gyeongbokgung-palace', 'itinerary', 'itinerary/tokyo-3-days', 'events', 'events/japan', 'essentials', 'essentials/visa',
  'essentials/japan', 'tools/best-time', 'tools/when-to-go', 'tools/when-to-go/japan', 'tools/when-to-go/japan/march', 'tools/holiday-overlap', 'tools/whats-closed', 'tools/esim', 'tools/esim/japan',
  'my-trip', 'free/trip-checklist', 'flights', 'newsletter', 'about', 'privacy', 'contact', 'methodology', 'terms', 'day-trips/seoul'];
const LANGS = ['', '/ko', '/ja', '/es', '/zh'];
const WIDTHS = [360, 390];
// The strip's own width jumps where the card grid changes, so these are not evenly spaced.
const STRIP_WIDTHS = [320, 375, 384, 412, 430, 480, 520, 540, 680, 760];

// Runs in the page; hands back numbers, judged in Node by lib/phone-fit.mjs.
function collect() {
  const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/ +/)[0]}<${String(el.parentElement?.className || el.parentElement?.tagName).split(' ')[0]}`;
  const shown = (el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  // Not the page: the off-canvas menu and footer, the home photo wall that runs off both sides,
  // screen-reader copies clipped to 1px on purpose, and an svg with its own coordinates.
  const offPage = (el) => el.closest('svg, [hidden], .site-header, .site-footer, footer, .hero-wall, .sr-only, .visually-hidden');
  const scrollBox = (o) => o === 'auto' || o === 'scroll';
  const placedOutside = (el, stop) => { for (let x = el; x && x !== stop; x = x.parentElement) if (['absolute', 'fixed'].includes(getComputedStyle(x).position)) return true; return false; };
  const scrollsBefore = (el, stop) => { for (let x = el.parentElement; x && x !== stop; x = x.parentElement) if (scrollBox(getComputedStyle(x).overflowX)) return true; return false; };
  const paper = { cards: [], grids: [], cells: [], credits: [], strips: [] };

  for (const el of document.querySelectorAll('body *')) {
    if (['IMG', 'PICTURE', 'VIDEO', 'SOURCE', 'SCRIPT', 'STYLE'].includes(el.tagName) || !shown(el) || offPage(el)) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const cs = getComputedStyle(el);
    // A box you can see the edge of, or words.
    const words = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (words || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs.borderRightWidth) > 0) {
      let clip = el.parentElement;
      while (clip && clip !== document.body && !['hidden', 'clip'].includes(getComputedStyle(clip).overflowX)) clip = clip.parentElement;
      // Words in an ellipsis box are the box's own business: credits are read below.
      if (clip && clip !== document.body && getComputedStyle(clip).textOverflow !== 'ellipsis' && !scrollsBefore(el, clip) && !placedOutside(el, clip)) {
        paper.cards.push({ what: name(el), right: box.right, edge: clip.getBoundingClientRect().right, card: name(clip) });
      }
    }
    // Decoration is judged by its own rule: a month label may overhang a neighbour whose label is hidden.
    if (/grid|flex/.test(cs.display) && !scrollBox(cs.overflowX) && !el.closest('[aria-hidden="true"]')) {
      for (const it of el.children) {
        if (!shown(it) || getComputedStyle(it).position === 'absolute') continue;
        // A negative margin is a bleed someone chose (the sticky filter bar on /destinations).
        const bleed = Math.min(0, parseFloat(getComputedStyle(it).marginRight) || 0);
        paper.grids.push({ what: name(el), item: name(it), right: it.getBoundingClientRect().right + bleed, edge: box.right });
      }
    }
  }

  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (tw.nextNode()) {
    const node = tw.currentNode, el = node.parentElement;
    if (!node.nodeValue.trim() || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION'].includes(el.tagName)) continue;
    // The strip is decoration read below; a screen-reader copy is 1px wide by design.
    if (!shown(el) || offPage(el) || el.closest('[aria-hidden="true"]') || el.getBoundingClientRect().width < 2) continue;
    let cell = el;
    while (cell && cell !== document.body && !/grid/.test(getComputedStyle(cell.parentElement).display)) cell = cell.parentElement;
    if (!cell || cell === document.body) continue;
    let handled = false;
    for (let x = el; x; x = x.parentElement) {
      const s = getComputedStyle(x);
      if (s.textOverflow === 'ellipsis' || scrollBox(s.overflowX)) { handled = true; break; }
      if (x === cell) break;
    }
    if (handled) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    paper.cells.push({ what: name(el), text: node.nodeValue.trim(), px: parseFloat(getComputedStyle(el).fontSize), right: Math.max(...[...range.getClientRects()].map((r) => r.right)), edge: cell.getBoundingClientRect().right });
  }

  for (const el of document.querySelectorAll('.dh-credit, .rh-credit')) {
    if (shown(el)) paper.credits.push({ what: name(el), tail: el.textContent.trim().slice(-24), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
  }

  for (const s of document.querySelectorAll('.dh-months')) {
    if (!shown(s)) continue;
    const months = [...s.querySelectorAll('.dh-mo')];
    paper.strips.push({
      stripRight: s.getBoundingClientRect().right,
      lastRight: months.at(-1).getBoundingClientRect().right,
      bars: months.map((m) => m.querySelector('i').getBoundingClientRect().width),
      labels: months.map((m) => m.querySelector('b')).filter((b) => getComputedStyle(b).visibility !== 'hidden').map((b) => {
        const r = document.createRange();
        r.selectNodeContents(b);
        const box = r.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
    });
  }
  return paper;
}

const b = await launch();
const found = new Map();
const note = (kind, where, detail) => { if (!found.has(kind)) found.set(kind, `${where} ${detail}`); };
let pages = 0;

async function read(pg, path, width, l) {
  const where = `${l || '/en'}/${path} ${width}px`;
  const res = await pg.goto(`${BASE}${l}/${path}${path ? '/' : ''}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await pg.waitForTimeout(500);
  if (!res || res.status() !== 200) { note(`응답 ${res?.status()} ${path}`, where, ''); return; }
  pages++;
  const p = await pg.evaluate(collect);
  for (const r of p.cards) { const o = pastBy(r.right, r.edge); if (o) note(`카드에 잘림 ${r.what}`, where, `${r.card} 밖으로 ${o.toFixed(1)}px`); }
  for (const r of p.grids) { const o = pastBy(r.right, r.edge); if (o) note(`격자 밖으로 나감 ${r.what}`, where, `${r.item} ${o.toFixed(1)}px`); }
  for (const r of p.cells) { const o = wordsPastCell(r); if (o) note(`글자가 칸 밖으로 ${r.what}`, where, `"${r.text.slice(0, 24)}" ${o.toFixed(1)}px`); }
  for (const r of p.credits) if (creditCut(r)) note(`사진 출처 잘림 ${r.what}`, where, `…${r.tail}`);
  for (const s of p.strips) for (const problem of monthStripProblems(s)) note(`월별 막대 ${problem.split('(')[0].replace(/[0-9.]+px/, '')}`, where, problem);
}

for (const width of [...WIDTHS, ...STRIP_WIDTHS]) {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  const everyPage = WIDTHS.includes(width);
  for (const l of everyPage ? LANGS : ['']) for (const p of everyPage ? PATHS : ['destinations/japan']) {
    try { await read(pg, p, width, l); } catch (e) { note(`오류 ${p}`, `${l || '/en'} ${width}px`, String(e.message).slice(0, 80)); }
  }
  await ctx.close();
}
await b.close();
// A page that never loaded is not a clean page.
if (pages < PATHS.length * LANGS.length * WIDTHS.length) note('읽은 쪽이 모자람', '', `${pages}쪽`);
for (const [k, where] of found) console.log(`✗ ${k} — ${where}`);
verdict(`휴대폰 잘림·칸 넘침·출처 잘림: ${found.size ? `${found.size}종` : `없음 (${pages}쪽 · 360/390px × 5개 언어)`}`, found.size > 0);
