// Live check for the pages rebuilt from the owner's mock-ups on 2026-10-01/02:
// editorial policy, methodology, contact, privacy, terms, destinations,
// regions, best-time — five languages each.
//
// Born from two misses the same day: the contact form sent its message as
// "undefined" in every language, and /privacy/ was 459px wide on a phone in
// English only (a long URL widened a `1fr` column) — the Korean page had been
// checked and passed. So: every page, every language, phone width.
// Run: node scripts/live/redesigns-2026-10-02.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';

const PAGES = ['about', 'methodology', 'contact', 'privacy', 'terms', 'destinations', 'regions', 'tools/best-time'];
const LANGS = ['', '/ko', '/ja', '/es', '/zh'];
const b = await launch();
const pg = await b.newPage({ viewport: { width: 375, height: 812 } });
const bad = [];

for (const l of LANGS) for (const p of PAGES) {
  await pg.goto(`${BASE}${l}/${p}/`, { waitUntil: 'networkidle', timeout: 120000 });
  const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
  if (sw > 376) bad.push(`overflow ${l}/${p} ${sw}px`);
}

// The contact draft must carry what the reader typed.
for (const l of LANGS) {
  await pg.goto(`${BASE}${l}/contact/`, { waitUntil: 'networkidle', timeout: 120000 });
  const href = await pg.evaluate(() => {
    const t = document.querySelector('textarea[data-body]');
    if (!t) return 'NO-TEXTAREA';
    t.value = 'live-check body';
    t.dispatchEvent(new Event('input'));
    return decodeURIComponent(document.querySelector('[data-mailto]')?.getAttribute('href') || '');
  });
  if (!href.includes('body=live-check body')) bad.push(`contact body ${l || '/'}: ${href.slice(-60)}`);
}

// The regions finder must actually filter.
await pg.goto(`${BASE}/regions/`, { waitUntil: 'networkidle', timeout: 120000 });
const shown = await pg.evaluate(() => {
  const q = document.querySelector('[data-rg] [data-q]');
  if (!q) return 'NO-SEARCH';
  q.value = 'kyoto';
  q.dispatchEvent(new Event('input'));
  return document.querySelector('[data-rg] [data-showing]')?.textContent || '';
});
if (!/^1 places?\b/.test(shown.trim())) bad.push(`regions search "kyoto": ${shown}`);

verdict(`10-01/02 개편 페이지: ${bad.length ? bad.join(' | ') : `문제 없음 (${PAGES.length * LANGS.length}페이지 휴대폰 폭·문의 본문 5개 언어·지역 검색)`}`, bad.length > 0);
await b.close();
