// Live check: the eSIM country pages (redesign 2026-10-05, owner's "UAE eSIM
// 개선안" mock-up), in all five languages for a spread of countries.
//  - the recommender answers: family → pocket WiFi, 2 days + convenience →
//    roaming, otherwise eSIM; the comparison card it names is highlighted and
//    the eSIM button only shows when eSIM is the pick;
//  - the phone check reaches every verdict;
//  - the setup ticks survive a reload; the bottom bar appears after the hero;
//  - every Yesim button carries esim_<country>_<spot>; no page shows a price;
//  - the country's "know this first" card is there; 320px has no sideways scroll.
// Run: node scripts/live/esim-pages.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';

const b = await launch();
const errs = [];
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
const CASES = [
  ['ko', 'united-arab-emirates'], ['en', 'japan'], ['ja', 'south-korea'], ['es', 'mexico'], ['zh', 'thailand'], ['ko', 'germany'],
];

for (const [lang, slug] of CASES) {
  const url = `${BASE}${lang === 'en' ? '' : '/' + lang}/tools/esim/${slug}/`;
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => errs.push(`${lang}/${slug}: ${e.message}`));
  await pg.goto(url, { waitUntil: 'networkidle' });
  const r = await pg.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const click = (s) => q(s).click();
    const pick = () => q('[data-opt].is-pick')?.dataset.opt;
    // Seen, not the property: a display rule once kept a [hidden] button on screen (Codex, 10-05).
    const seen = (s) => { const e = q(s); return !!e && e.offsetParent !== null; };
    const out = { first: pick(), btnShown: seen('[data-rec-btn]') };
    click('[data-q="people"] [data-v="group"]');
    out.group = pick(); out.groupBtn = seen('[data-rec-btn]'); out.groupOther = seen('[data-rec-other]');
    click('[data-q="people"] [data-v="solo"]');
    const d = q('[data-days]'); d.value = '2'; d.dispatchEvent(new Event('input'));
    click('[data-q="prio"] [data-v="ease"]');
    out.short = pick();
    out.bar = q('[data-bar-title]').textContent;
    const verdicts = [];
    const ans = (qq, v) => click(`[data-check="${qq}"] [data-v="${v}"]`);
    ans('eid', 'yes'); ans('lock', 'yes'); verdicts.push(q('[data-verdict]').className);
    ans('lock', 'no'); verdicts.push(q('[data-verdict]').className);
    ans('eid', 'no'); verdicts.push(q('[data-verdict]').className);
    ans('eid', 'dunno'); ans('lock', 'yes'); verdicts.push(q('[data-verdict]').className);
    out.verdicts = verdicts.join(' ');
    const box = q('[data-step="1"]'); box.click();
    out.subs = [...document.querySelectorAll('a[href*="yesim"]')].map((a) => new URL(a.href).searchParams.get('sub_id'));
    out.alert = !!q('.es-alert .es-alert-t')?.textContent.trim();
    out.price = /(?:US\$|\$|€|¥|₩|円|원)\s?\d|\d\s?(?:USD|EUR|원|円|元)/.test(q('.es').innerText);
    out.h1 = q('h1').textContent;
    return out;
  });
  check(r.first === 'esim' && r.btnShown, `${lang}/${slug} default pick eSIM with its button`);
  check(r.group === 'wifi' && !r.groupBtn && r.groupOther, `${lang}/${slug} family → pocket WiFi, compare link instead`);
  check(r.short === 'roam', `${lang}/${slug} 2 days + convenience → roaming (bar: ${r.bar})`);
  check(r.verdicts === 'es-verdict v-ok es-verdict v-locked es-verdict v-noEid es-verdict v-unknown', `${lang}/${slug} phone verdicts ${r.verdicts}`);
  check(r.subs.length >= 4 && r.subs.every((s) => s && s.startsWith(`esim_${slug}_`)), `${lang}/${slug} ${r.subs.length} Yesim links carry esim_${slug}_<spot>`);
  check(r.alert, `${lang}/${slug} "know this first" card`);
  check(!r.price, `${lang}/${slug} no price on the page`);
  // Ticks survive a reload; the bar shows once the hero is gone.
  await pg.reload({ waitUntil: 'networkidle' });
  const kept = await pg.$eval('[data-step="1"]', (e) => e.checked);
  check(kept, `${lang}/${slug} setup tick kept after reload`);
  await pg.evaluate(() => document.querySelector('[data-phone]').scrollIntoView());
  await pg.waitForTimeout(400);
  const barVisible = await pg.$eval('[data-bar]', (e) => !e.hidden);
  check(barVisible, `${lang}/${slug} bottom bar shows past the hero`);
  await ctx.close();

  const ph = await b.newPage({ viewport: { width: 320, height: 700 } });
  ph.on('pageerror', (e) => errs.push(`${lang}/${slug} 320: ${e.message}`));
  await ph.goto(url, { waitUntil: 'networkidle' });
  const over = await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(over <= 0, `${lang}/${slug} 320px no sideways scroll (${over})`);
  await ph.close();
}

// Dark mode follows the system: every pale panel must keep readable text
// (Codex, 10-05 — the first draft drew light ink on pale cards, ~1.1:1).
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const pg = await ctx.newPage();
  await pg.goto(`${BASE}/tools/esim/united-arab-emirates/`, { waitUntil: 'networkidle' });
  await pg.click('[data-check="eid"] [data-v="yes"]');
  await pg.click('[data-check="lock"] [data-v="yes"]');
  const worst = await pg.evaluate(() => {
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return 'rgb(255,255,255)'; };
    const sel = '.es-opt.is-pick h3, .es-phone h2, .es-tips li, .es-verdict b, .es-alert-t, .es-step-t, .es-buy li, .es-os-box b';
    return [...document.querySelectorAll(sel)].map((e) => {
      const a = lum(rgb(getComputedStyle(e).color)), z = lum(rgb(bgOf(e)));
      return { s: e.className || e.tagName, r: (Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05) };
    }).sort((x, y) => x.r - y.r)[0];
  });
  check(worst && worst.r >= 4.5, `dark mode: lowest text contrast ${worst?.r.toFixed(2)} (${worst?.s})`);
  await ctx.close();
}

verdict(`\n${fails.length ? fails.length + ' failed' : 'all passed'} · errors ${errs.length} ${errs.slice(0, 3).join(' | ')}`, fails.length > 0 || errs.length > 0);
await b.close();
