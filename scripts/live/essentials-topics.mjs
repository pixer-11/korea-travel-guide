// Live check, ported from the hand-run tpfunc.mjs (scratchpad, week of 2026-09-28).
// Run: node scripts/live/essentials-topics.mjs [base]  — default base is the live site (lib.mjs).
// Functional checks for the six essentials topic pages, acting like a reader.
//   node tpfunc.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';
import fs from 'node:fs';
const base = BASE;
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', (e) => errs.push(`${pg.url()} ${e.message}`));
pg.on('console', (m) => { if (m.type() === 'error') errs.push(`${pg.url()} console: ${m.text()}`); });
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL', msg); } };
const go = async (p) => { const r = await pg.goto(base + p, { waitUntil: 'networkidle', timeout: 120000 }); return r.status(); };
const visiblePanels = () => pg.$$eval('[data-panel]', (els) => els.filter((e) => !e.hidden && getComputedStyle(e).display !== 'none').map((e) => e.dataset.panel));
const TOPICS = ['visa', 'transport', 'luggage-storage', 'money', 'best-time-to-visit', 'emergency'];

for (const lang of ['ko', 'en']) {
  const pre = lang === 'en' ? '' : `/${lang}`;
  // fresh storage per language run
  await pg.goto(base + '/'); await pg.evaluate(() => { try { localStorage.clear(); } catch {} });
  for (const tp of TOPICS) {
    const path = `${pre}/essentials/${tp}/`;
    ok((await go(path)) === 200, `${path} status`);
    const tabs = await pg.$$eval('.tph-tab', (els) => els.map((e) => [e.getAttribute('href'), e.getAttribute('aria-current')]));
    ok(tabs.length === 6 && tabs.filter((x) => x[1] === 'page').length === 1 && tabs.find((x) => x[1] === 'page')[0].includes(tp), `${path} tabs`);
    ok(await pg.$eval('.tph-faq details', (d) => d.open).catch(() => false), `${path} first FAQ open`);
    ok((await pg.$$('.tph-basic')).length >= 3, `${path} basics cards`);
    ok((await pg.$$('.tph-rel li')).length === 5, `${path} related 5`);
    const h1 = await pg.$eval('h1', (e) => e.textContent.trim());
    ok(h1.length > 3, `${path} h1`);

    if (['visa', 'transport', 'money', 'emergency'].includes(tp)) {
      const chips = await pg.$$('[data-pick]');
      ok(chips.length >= 20, `${path} ${chips.length} country chips`);
      ok((await visiblePanels()).length === 1, `${path} one panel at load`);
      const slug = await chips[2].getAttribute('data-pick');
      await chips[2].click();
      const vis = await visiblePanels();
      ok(vis.length === 1 && vis[0] === slug, `${path} click → panel ${slug} (got ${vis})`);
      ok(pg.url().includes(`#c=${slug}`), `${path} hash c=${slug}`);
      ok((await pg.$eval(`[data-pick="${slug}"]`, (e) => e.getAttribute('aria-pressed'))) === 'true', `${path} chip pressed`);
      const panelText = await pg.$eval(`[data-panel="${slug}"]`, (e) => e.innerText.trim());
      ok(panelText.length > 20, `${path} panel has text`);
      ok(!/undefined|null|NaN|\[object/.test(panelText), `${path} panel no junk text`);
      // reload without hash → last pick remembered
      await go(path);
      ok((await visiblePanels())[0] === slug, `${path} remembered ${slug} after reload`);
      if (tp === 'emergency') {
        const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 10000 }).catch(() => null), pg.click(`[data-panel="${slug}"] [data-vcf]`)]);
        ok(!!dl, `${path} vcf download`);
        if (dl) {
          const f = await dl.path(); const txt = fs.readFileSync(f, 'utf8');
          ok(/BEGIN:VCARD[\s\S]*TEL:[\s\S]*END:VCARD/.test(txt) && dl.suggestedFilename().endsWith('.vcf'), `${path} vcf content`);
        }
        const tels = await pg.$$eval(`[data-panel="${slug}"] a.tph-num`, (els) => els.map((e) => e.getAttribute('href')));
        ok(tels.length > 0 && tels.every((h) => h === null || /^tel:\+?\d+$/.test(h)), `${path} tel links ${tels}`);
      }
    }
    if (tp === 'best-time-to-visit') {
      const cur = String(new Date().getMonth() + 1);
      const shown = await pg.$$eval('[data-mblock]', (els) => els.filter((e) => !e.hidden).map((e) => e.dataset.mblock));
      ok(shown.length === 1 && shown[0] === cur, `${path} reader month ${cur} shown (got ${shown})`);
      await pg.click('[data-month="4"]');
      const s2 = await pg.$$eval('[data-mblock]', (els) => els.filter((e) => !e.hidden).map((e) => e.dataset.mblock));
      ok(s2.length === 1 && s2[0] === '4' && pg.url().includes('#m=4'), `${path} click April`);
      const cells = await pg.$$eval('.tph-table--season tbody tr', (rs) => rs.map((r) => r.querySelectorAll('td').length));
      ok(cells.length >= 15 && cells.every((n) => n === 12), `${path} 12-month grid ${cells.length} rows`);
    }
    if (tp === 'luggage-storage') {
      await pg.click('[data-sit="3"]');
      const s3 = await pg.$$eval('[data-sitblock]', (els) => els.filter((e) => !e.hidden).map((e) => e.dataset.sitblock));
      ok(s3.length === 1 && s3[0] === '3', `${path} situation 3`);
      const lug = await pg.$$eval('.tph-lug a', (els) => els.map((e) => e.getAttribute('href')));
      ok(lug.length >= 3 && lug.every((h) => /#ess-more-\d+$/.test(h)), `${path} luggage links ${lug.length}`);
    }
    if (tp !== 'luggage-storage') {
      const total = (await pg.$$('[data-table] tbody tr')).length;
      ok(total >= 15, `${path} table rows ${total}`);
      await pg.fill('[data-search]', lang === 'ko' ? '일본' : 'japan');
      const vis = await pg.$$eval('[data-table] tbody tr', (rs) => rs.filter((r) => !r.hidden).length);
      ok(vis === 1, `${path} search japan → ${vis}`);
      await pg.fill('[data-search]', 'zzzz');
      ok(await pg.$eval('[data-nomatch]', (e) => !e.hidden), `${path} no-match note`);
      await pg.fill('[data-search]', '');
      await pg.click('button[data-region="europe"]');
      const eu = await pg.$$eval('[data-table] tbody tr', (rs) => rs.filter((r) => !r.hidden).map((r) => r.dataset.region));
      ok(eu.length >= 3 && eu.every((x) => x === 'europe'), `${path} Europe chip ${eu.length}`);
    }
  }
  // cross-page memory: pick France on visa, open money → France preselected
  await go(`${pre}/essentials/visa/`);
  await pg.click('[data-pick="france"]');
  await go(`${pre}/essentials/money/`);
  ok((await visiblePanels())[0] === 'france', `${lang} pick carries visa → money`);
}

// internal links on all six pages × 5 languages
const links = new Set();
for (const lang of ['en', 'ko', 'ja', 'es', 'zh']) {
  for (const tp of TOPICS) {
    const path = `${lang === 'en' ? '' : `/${lang}`}/essentials/${tp}/`;
    ok((await go(path)) === 200, `${path} status`);
    for (const h of await pg.$$eval('main a[href^="/"], .tph a[href^="/"]', (els) => els.map((e) => e.getAttribute('href')))) links.add(h.split('#')[0]);
    const txt = await pg.$eval('.tph', (e) => e.innerText);
    ok(!/undefined|\bNaN\b|\[object Object\]/.test(txt) && !/&#x?[0-9a-f]+;|&amp;|<\/?cite/i.test(txt), `${path} no junk text`);
    if (tp === 'emergency') {
      const sms = await pg.$$eval('a[href^="sms:"]', (els) => els.map((e) => e.getAttribute('href')));
      const badTel = await pg.$$eval('a[href="tel:992"], a[href="tel:70999"], a[href="tel:16"]', (els) => els.length);
      ok(sms.includes('sms:992') && sms.includes('sms:70999') && badTel === 0, `${path} sms-only lines as sms: (${sms})`);
    }
  }
}
let bad = 0;
for (const h of links) {
  const r = await pg.request.get(base + h, { maxRedirects: 0 }).catch(() => null);
  const st = r ? r.status() : 0;
  if (st !== 200) { bad++; console.log('LINK', st, h); }
}
ok(bad === 0, `${links.size} internal links, ${bad} bad`);
verdict(`\n${pass} passed, ${fail} failed · ${links.size} links`, fail > 0 || errs.length > 0);
console.log('errors', errs.slice(0, 10));
await b.close();
