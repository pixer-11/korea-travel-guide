// Live check, ported from the hand-run codexfix.mjs (scratchpad, week of 2026-09-28).
// Run: node scripts/live/regressions-2026-10-01.mjs [base]  — default base is the live site (lib.mjs).
// Regression checks for the 10-01 Codex findings.   node codexfix.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';
const base = BASE;
const b = await launch();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const errs = [];
const b64 = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul' });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errs.push(e.message));
pg.on('dialog', (d) => d.accept());
const stored = () => pg.evaluate(() => JSON.parse(localStorage.getItem('wa_trip_v1') || '[]'));
const spain = await (await fetch(`${base}/trip-data/ko/spain.json`)).json();
const bcn = spain.places.filter((p) => p.rs === 'barcelona' && p.cat !== 'event');
const [p1, p2] = bcn;

// A1 + A3: bad day values and duplicates in a shared link
await pg.goto(`${base}/ko/my-trip/`, { waitUntil: 'networkidle' });
await pg.evaluate(() => localStorage.clear());
const evil = [[p1.slug, '1e309', 'barcelona'], [p1.slug, 2, 'barcelona'], [p2.slug, 1.5, 'barcelona'], ['../x', 1, ''], [p2.slug, -3, 'barcelona']];
await pg.goto(`${base}/ko/my-trip/#share=${b64(JSON.stringify(evil))}`, { waitUntil: 'networkidle' });
ok(/2곳/.test(await pg.$eval('[data-shared-text]', (e) => e.textContent)), 'shared banner counts 2 distinct valid slugs');
await pg.click('[data-shared-add]');
await pg.waitForTimeout(1500);
const s1 = await stored();
ok(s1.length === 2 && s1.every((i) => Number.isInteger(i.day) && i.day >= 0 && i.day <= 30), `imported 2, days sane ${JSON.stringify(s1.map((i) => i.day))}`);
ok((await pg.$$('.mt-item')).length === 2, 'two cards, no crash');

// A2: replace with an unknown slug keeps my list
await pg.goto(`${base}/ko/my-trip/#share=${b64(JSON.stringify([['barcelona-no-such-place', 1, 'barcelona']]))}`, { waitUntil: 'networkidle' });
await pg.click('[data-shared-replace]');
await pg.waitForTimeout(1500);
ok((await stored()).length === 2, 'failed replace did not wipe the list');

// A2 (events): an event with a venue restores from a link
const ev = spain.places.find((p) => p.cat === 'event');
if (ev) {
  await pg.evaluate(() => localStorage.clear());
  await pg.goto(`${base}/ko/my-trip/#share=${b64(JSON.stringify([[ev.slug, 1, ev.rs]]))}`, { waitUntil: 'networkidle' });
  await pg.click('[data-shared-add]');
  await pg.waitForTimeout(1500);
  ok((await stored()).some((i) => i.slug === ev.slug), `event restores from a share link (${ev.slug})`);
} else console.log('(no event with venue in Spain to test)');

// A4: a stored javascript: href never becomes a link
await pg.evaluate((p) => localStorage.setItem('wa_trip_v1', JSON.stringify([{ ...p, slug: 'zz-not-a-real-place', rs: 'zz', href: 'javascript:alert(1)' }])), p1);
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(800);
ok((await pg.$eval('.mt-name', (a) => a.getAttribute('href'))) === '#', 'javascript: href neutralised');

// A7: emptying the example ends it; a heart then saves for real
await pg.evaluate(() => localStorage.clear());
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1200);
await pg.click('[data-demo-start]');
await pg.waitForTimeout(800);
for (let i = 0; i < 6 && (await pg.locator('[data-remove]:visible').count()); i++) { await pg.locator('[data-remove]:visible').first().click(); await pg.waitForTimeout(150); }
ok(await pg.$eval('[data-demo]', (e) => e.hidden) && await pg.$eval('.mt-start', (e) => !e.hidden), 'emptied example → first visit, no demo bar');
await pg.click('[data-start-save]');
await pg.waitForTimeout(600);
ok((await stored()).length === 1, 'heart after the example saves for real');

// A9: address dialog has a name
const named = await pg.$eval('[data-addr-dialog]', (d) => d.getAttribute('aria-labelledby') && document.getElementById(d.getAttribute('aria-labelledby')));
ok(!!named, 'dialog labelled');

// A10: multi-city list never says "every place you saved"
const korea = await (await fetch(`${base}/trip-data/ko/south-korea.json`)).json();
const sk = korea.places.find((p) => p.rs === 'seoul' && p.cat !== 'event');
await pg.evaluate((v) => localStorage.setItem('wa_trip_v1', JSON.stringify(v)), [...bcn.slice(0, 2), sk].map((p) => ({ ...p, day: 0 })));
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1500);
const ct = await pg.$eval('[data-course-text]', (e) => e.textContent).catch(() => '');
ok(!/모두 들어/.test(ct), `multi-city course text: ${ct}`);

// A6: nearby picks follow the city
await pg.evaluate((v) => localStorage.setItem('wa_trip_v1', JSON.stringify(v)), bcn.slice(0, 2));
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1500);
await pg.evaluate((v) => { localStorage.setItem('wa_trip_v1', JSON.stringify(v)); window.dispatchEvent(new Event('wa-trip-change')); }, korea.places.filter((p) => p.rs === 'seoul' && p.cat !== 'event').slice(0, 2));
await pg.waitForTimeout(2000);
const nearRegions = await pg.$$eval('.mt-near-card small', (els) => els.map((e) => e.textContent));
ok(nearRegions.every((t) => !/바르셀로나/.test(t)), `nearby picks after switching to Seoul: ${nearRegions.join(' / ')}`);
await ctx.close();

// A8: phone menu keyboard focus
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(`${base}/ko/`, { waitUntil: 'networkidle' });
await m.click('.menu-toggle');
await m.focus('.nav-drill[data-to="tools"]');
await m.keyboard.press('Enter');
await m.waitForTimeout(200);
ok(await m.evaluate(() => !!document.activeElement?.closest('[data-dd="tools"] .nav-dd-menu')), 'focus moves into the tools list');
await m.click('.nav-back');
await m.waitForTimeout(200);
ok(await m.evaluate(() => document.activeElement?.matches('.nav-drill[data-to="tools"]')), 'back returns focus to the tools button');

verdict(`\n${pass} passed, ${fail} failed`, fail > 0 || errs.length > 0);
console.log('errors', errs.slice(0, 5));
await b.close();
