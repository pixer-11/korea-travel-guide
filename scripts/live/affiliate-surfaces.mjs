// Live check: where the affiliate links added on 2026-10-04 go, by rules that
// hold however many cities or venues the tables grow to.
//  - /essentials/luggage-storage (5 languages): a "book by city" list of
//    Radical Storage deep links (p=5867), every one rel=sponsored, 100+ of them;
//  - a country page shows its storage cities once (Japan: under its luggage
//    section; the UK: under "Getting around");
//  - a ticketed attraction's "tickets" link is its own Tiqets product page
//    (Colosseum), a free one keeps the city page (Trevi Fountain);
//  - Sydney goes to Tiqets, Brisbane stays on Klook (Tiqets stock too thin).
// No page errors. Run: node scripts/live/affiliate-surfaces.mjs [base]
import { BASE, verdict } from './lib.mjs';

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
const get = async (p) => { const r = await fetch(BASE + p, { headers: { 'User-Agent': 'Mozilla/5.0 (WanderAtlas live check)' } }); return { status: r.status, html: r.ok ? await r.text() : '' }; };
const hrefs = (html) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)].map((m) => ({ tag: m[0], href: m[1].replace(/&amp;/g, '&') }));

for (const l of ['', '/ko', '/ja', '/es', '/zh']) {
  const { status, html } = await get(`${l}/essentials/luggage-storage/`);
  const rs = hrefs(html).filter((a) => /[?&]p=5867\b/.test(a.href));
  const cityLinks = rs.filter((a) => decodeURIComponent(a.href).includes('radicalstorage.com/luggage-storage/'));
  check(status === 200 && cityLinks.length >= 100 && rs.every((a) => /rel="[^"]*sponsored/.test(a.tag)),
    `${l || '/en'}/essentials/luggage-storage: ${cityLinks.length} city links, all sponsored`);
}

for (const [p, min] of [['/essentials/japan/', 3], ['/essentials/united-kingdom/', 5], ['/ko/essentials/spain/', 5]]) {
  const { status, html } = await get(p);
  const boxes = (html.match(/class="ess-rs"/g) || []).length;
  const n = hrefs(html).filter((a) => /[?&]p=5867\b/.test(a.href)).length;
  check(status === 200 && boxes === 1 && n >= min, `${p}: ${boxes} storage box, ${n} cities`);
}

const venue = (html) => hrefs(html).filter((a) => /sub_id=post_place/.test(a.href)).map((a) => decodeURIComponent(a.href));
{
  const { html } = await get('/ko/posts/rome-colosseum/');
  const v = venue(html);
  check(v.length > 0 && v.every((u) => /tiqets\.com\/ko\/[a-z0-9-]+-tickets-l\d+\//.test(u)), `Colosseum tickets → its product page (${v[0]?.split('&u=')[1] ?? 'none'})`);
}
{
  const { html } = await get('/posts/rome-trevi-fountain/');
  check(venue(html).length === 0, 'Trevi Fountain (free) keeps the city page');
}
{
  const s = await get('/regions/sydney/');
  const b = await get('/regions/brisbane/');
  const tq = (h) => hrefs(h).filter((a) => /[?&]p=2074\b/.test(a.href)).length;
  check(tq(s.html) > 0, `Sydney → Tiqets (${tq(s.html)} links)`);
  check(tq(b.html) === 0 && /\/go\/klook/.test(b.html), 'Brisbane stays on Klook');
}

verdict(`\n${fails.length ? fails.length + ' failed' : 'all passed'}`, fails.length > 0);
