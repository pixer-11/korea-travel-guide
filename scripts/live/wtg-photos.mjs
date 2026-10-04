// Live check: every country row on the when-to-go index carries a photo that
// loads (2026-10-04, rotating daily — lib/repImage repHeroPool), in 5 languages.
// Run: node scripts/live/wtg-photos.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';

const b = await launch();
const fails = [];
for (const l of ['', '/ko', '/ja', '/es', '/zh']) {
  const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
  await pg.goto(`${BASE}${l}/tools/when-to-go/`, { waitUntil: 'load', timeout: 120000 });
  const r = await pg.evaluate(async () => {
    const imgs = [...document.querySelectorAll('.wtgi-row img.wtgi-photo')];
    await Promise.all(imgs.map((i) => { i.loading = 'eager'; return i.decode().catch(() => {}); }));
    return { rows: document.querySelectorAll('.wtgi-row').length, imgs: imgs.length, broken: imgs.filter((i) => i.naturalWidth === 0).map((i) => i.getAttribute('src')) };
  });
  const ok = r.rows >= 15 && r.imgs >= r.rows - 1 && r.broken.length === 0;
  console.log(`${ok ? '✓' : '✗'} ${l || '/en'}/tools/when-to-go: ${r.rows} countries, ${r.imgs} photos, ${r.broken.length} broken ${r.broken.slice(0, 2).join(' ')}`);
  if (!ok) fails.push(l || '/en');
  await pg.close();
}
await b.close();
verdict(`\n${fails.length ? fails.length + ' failed' : 'all passed'}`, fails.length > 0);
