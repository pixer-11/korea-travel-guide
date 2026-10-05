// Live check: what the 10-05 full audit fixed stays fixed. Plain fetches, no
// browser (so no analytics fire), rules rather than one page each where a rule
// exists:
//  - no U+FFFD (a letter the batch reader split) on 30 sampled ko/ja/zh posts;
//  - an unknown /_astro/ file is a 404 that is not cached for a year;
//  - every page sends nosniff and a Referrer-Policy;
//  - an alias hub (Frankfurt am Main) 301s to the canonical one;
//  - the Pinterest OAuth callback loads no analytics (its URL carries ?code=);
//  - /newsletter does not carry the site-wide signup popup;
//  - an ended event's "upcoming events" button stays in the reader's language;
//  - no post title dangles a connector before its ":" ("Quais de Saône à:");
//  - the newsletter signup refuses a cross-site Origin.
// Run: node scripts/live/audit-2026-10-05.mjs [base]
import { BASE, verdict } from './lib.mjs';

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
const UA = { 'User-Agent': 'Mozilla/5.0 (WanderAtlas live check)' };
const get = async (p, opts = {}) => {
  const r = await fetch(p.startsWith('http') ? p : BASE + p, { headers: UA, redirect: 'manual', ...opts });
  return { status: r.status, headers: r.headers, html: r.status === 200 ? await r.text() : '' };
};
const sample = (arr, n) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).slice(0, n).map((x) => x[1]);

// 1. U+FFFD on sampled translations
for (const l of ['ko', 'ja', 'zh']) {
  const { html: xml } = await get(`/sitemap-${l}-posts.xml`);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, ''));
  const bad = [];
  for (const p of sample(locs, 10)) {
    const { html } = await get(p);
    if (html.includes('�')) bad.push(p);
  }
  check(locs.length > 0 && bad.length === 0, `/${l}/ posts: no U+FFFD in 10 sampled of ${locs.length}${bad.length ? ` — ${bad.join(', ')}` : ''}`);
}

// 2–3. headers
{
  const r = await get('/_astro/live-check-missing.js');
  const cc = r.headers.get('cache-control') || '';
  check(r.status === 404 && !/immutable|max-age=[1-9]/.test(cc), `/_astro 404 not cached (${r.status}, "${cc}")`);
}
for (const p of ['/', '/ko/posts/', '/newsletter/']) {
  const r = await get(p);
  check(r.headers.get('x-content-type-options') === 'nosniff' && !!r.headers.get('referrer-policy'), `${p}: nosniff + Referrer-Policy`);
}

// 4. alias hub
{
  const r = await get('/regions/frankfurt-am-main/');
  check(r.status === 301 && /\/regions\/frankfurt\/?$/.test(r.headers.get('location') || ''), `Frankfurt am Main hub → ${r.status} ${r.headers.get('location')}`);
}

// 5. Pinterest callback
{
  const { status, html } = await get('/pinterest-callback/');
  check(status === 200 && !/plausible\.io|googletagmanager/.test(html), '/pinterest-callback/: no analytics script');
}

// 6. newsletter popup
for (const p of ['/newsletter/', '/ko/newsletter/']) {
  const { status, html } = await get(p);
  check(status === 200 && !html.includes('data-nl-popup'), `${p}: no signup popup over its own form`);
}

// 7. ended event button language — any ended event post, judged by its own markup
{
  const { html: xml } = await get('/sitemap-ko-events.xml');
  const hubs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, ''));
  let seen = 0; const bad = [];
  for (const hub of sample(hubs, 4)) {
    const { html } = await get(hub);
    const posts = [...new Set([...html.matchAll(/href="(\/ko\/posts\/[^"#?]+)"/g)].map((m) => m[1]))];
    for (const p of sample(posts, 6)) {
      const { html: page } = await get(p);
      for (const m of page.matchAll(/<a class="book-btn book-btn-primary" href="([^"]*\/events\/?)"/g)) {
        seen++;
        if (!m[1].startsWith('/ko/')) bad.push(`${p} → ${m[1]}`);
      }
    }
  }
  check(bad.length === 0, `ended-event buttons in Korean posts stay in /ko/ (${seen} seen)${bad.length ? ` — ${bad.slice(0, 3).join('; ')}` : ''}`);
}

// 8. dangling connector in titles (the same list as the publish gate)
{
  const { TITLE_CONNECTORS } = await import('../lib/titles.mjs');
  const gate = new RegExp(String.raw`(?<![\p{L}\p{N}])(${TITLE_CONNECTORS})\s*:\s`, 'iu');
  const { html: xml } = await get('/sitemap-en-posts.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, ''));
  const bad = [];
  for (const p of [...sample(locs, 15), '/posts/lyon-quais-de-saone-a-lyon/']) {
    const { html } = await get(p);
    const t = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    if (gate.test(t)) bad.push(`${p}: ${t}`);
  }
  check(bad.length === 0, `no dangling connector in 16 post titles${bad.length ? ` — ${bad.join('; ')}` : ''}`);
}

// 9. signup refuses another site's Origin
{
  const r = await fetch(`${BASE}/api/subscribe`, {
    method: 'POST', redirect: 'manual',
    headers: { ...UA, 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ email: 'live-check@example.invalid' }),
  });
  check(r.status === 403, `/api/subscribe from a foreign Origin → ${r.status}`);
}

verdict(`\n${fails.length ? `${fails.length} failed` : 'all passed'}`, fails.length > 0);
