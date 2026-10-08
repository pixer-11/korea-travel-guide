// Live check: a mouse click on the home photo wall opens the guide it was aimed at.
//
// 2026-10-09 (픽서님: "사진이 클릭해도 제대로 작동하지 않고 멈춘다"): a press
// focuses the link, and `.wall-rows:focus-within` stopped the animation AND
// reset the transform — so between mousedown and mouseup the row jumped back
// to rest, the release landed on another tile, and no click fired. It only
// shows once the rows have drifted, so the check waits like a reader does:
// measured 0/3 on the live site before the fix, 3/3 after. home-v3.mjs
// clicked the selector's buttons and never the wall.
//
// Run: node scripts/live/home-wall-click.mjs [base]
import { launch, BASE, verdict, ROOT } from './lib.mjs';
import { execSync } from 'node:child_process';

// The fix not deployed yet is not a failure (same rule as flights-page.mjs).
{
  const [, liveAt] = (await (await fetch(`${BASE}/build.txt?t=${Date.now()}`)).text()).trim().split(/\s+/);
  let pageAt = NaN;
  try { pageAt = Number(execSync('git log -1 --format=%ct -- src/components/HomePage.astro scripts/live/home-wall-click.mjs', { cwd: ROOT }).toString().trim()); } catch {}
  if (Number(liveAt) < pageAt && Date.now() / 1000 - pageAt < 6 * 3600) {
    console.log('⚠ the latest home page change is not live yet — skipped, not failed');
    process.exit(0);
  }
}

const b = await launch();
const fails = [];
for (const lang of ['ko', 'en']) {
  const page = await b.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${BASE}${lang === 'en' ? '' : '/' + lang}/`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(20000); // let the rows drift, as they do while a reader looks
  const pt = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.wall-row .wall-tile')].find((a) => {
      const r = a.getBoundingClientRect();
      return r.left > 900 && r.right < innerWidth - 20 && r.top > 0 && r.bottom < innerHeight;
    });
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, href: t.getAttribute('href') };
  });
  if (!pt) { fails.push(`${lang}: no wall tile in view`); console.log(`✗ ${lang}: no wall tile in view`); await page.close(); continue; }
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForURL((u) => u.pathname !== new URL(page.url()).pathname || u.pathname.includes('/posts/'), { timeout: 8000 }).catch(() => {});
  const ok = new URL(page.url()).pathname === pt.href;
  console.log(`${ok ? '✓' : '✗'} ${lang}: click on ${pt.href} → ${new URL(page.url()).pathname}`);
  if (!ok) fails.push(`${lang}: aimed ${pt.href}, landed ${new URL(page.url()).pathname}`);
  await page.close();
}
await b.close();
verdict(fails.length ? `\n${fails.length} failure(s)` : '\nall passed', fails.length > 0);
