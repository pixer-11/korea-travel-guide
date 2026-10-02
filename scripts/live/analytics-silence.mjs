// Do these checks still stay out of the site's analytics?
//
// 2026-10-01's daily report read "2,688 visits — bot surge" against 45 readers.
// The surge was this folder: launch() silenced Plausible and GA4 but not
// Cloudflare Web Analytics, so every page the checks opened (475 a run, from
// the runner in the United States and from the owner's desk in Vietnam) was a
// "visit", and the report's top countries and popular pages were our own checks.
//
// The block is now in lib.mjs. This check keeps it honest, because the thing it
// blocks is not ours: Cloudflare injects the beacon and can change how it
// reports. It takes the beacon tag exactly as the site serves it today, serves
// it from a throwaway local page (so a report that gets out lands on localhost,
// never on Cloudflare), opens that page through launch(), and requires both:
//   · the beacon TRIED to report (else we are testing nothing), and
//   · nothing arrived.
// It opens no page of the real site — the tag is read with a plain fetch.
import http from 'node:http';
import { BASE, launch, verdict } from './lib.mjs';

const html = await (await fetch(`${BASE}/`, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (WanderAtlas live check; tag fetch, no JS)' } })).text();
const tag = (html.match(/<script[^>]*cloudflareinsights[^>]*><\/script>/) || [])[0];
if (!tag) {
  // A dev server, or Cloudflare Web Analytics switched off: nothing to silence.
  console.log(`WARN analytics-silence: ${BASE} 의 HTML 에 Cloudflare 계측 태그가 없습니다 — 차단을 검증하지 못했습니다`);
  verdict('analytics silence: no beacon tag served (not verified)', false);
} else {
  const arrived = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/cdn-cgi/rum')) { arrived.push(req.method); req.resume(); res.writeHead(204).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>t</title></head><body><h1>analytics silence</h1><p style="height:3000px">x</p>${tag}</body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const b = await launch();
  const page = await b.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
  let tried = 0;
  // Two documents: the beacon reports on load and again as each page is left.
  for (const path of ['', 'second']) {
    await page.goto(url + path, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await page.mouse.wheel(0, 1500);
    // Hiding the page is what makes the beacon flush; reading the count needs the page alive.
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(300);
    tried += await page.evaluate(() => window.__waMutedBeacons || 0);
  }
  await page.close();
  await b.close();
  await new Promise((r) => setTimeout(r, 800));
  server.close();

  if (arrived.length) console.log(`✗ ${arrived.length} Cloudflare report(s) got past launch() (${arrived.join(', ')}) — the checks are being counted as visitors again`);
  if (!tried) console.log('✗ the beacon never tried to report through sendBeacon/XHR — Cloudflare may have changed how it sends; the in-page lock in lib.mjs is no longer proven');
  if (errors.length) console.log(`✗ blocking printed console errors: ${errors.join(' | ')}`);
  verdict(`analytics silence: beacon tried ${tried}, arrived ${arrived.length}, console errors ${errors.length}`, arrived.length > 0 || tried === 0 || errors.length > 0);
}
