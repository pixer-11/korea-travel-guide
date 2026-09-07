import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { hubPathsFor } from './hub-lastmod.mjs';
import { slugifyRegion } from './slug.ts';

// Does hubPathsFor() key on the URL the routes actually build?
//
// It carried its own `slugify` — lowercase, spaces to dashes — while every route
// builds its URL with slugifyRegion() from src/lib/slug.ts. The two agree on
// ASCII and disagree on a non-ASCII letter or an apostrophe, so Alcañiz, Buñol
// and Xi'an got keys like /regions/alcañiz that matched no URL in the sitemap:
// those hubs advertised no freshness date at all. An ASCII-only fixture passes
// either way, which is why the bug sat here unnoticed.

const ROUNDUPS = ['things-to-do', 'best-restaurants', 'cafes', 'hidden-gems'];

test('a region hub keys on the URL the route builds, accents and apostrophes included', () => {
  for (const region of ['Alcañiz', 'Buñol', "Xi'an", 'Abu Dhabi', 'Seoul', 'São Paulo']) {
    const hub = `/regions/${slugifyRegion(region)}`;
    const paths = hubPathsFor({ region, country: 'Spain' });
    const got = paths.filter((p) => p.startsWith('/regions/')).join(' ');
    assert.ok(paths.includes(hub), `${region} should key on ${hub}, got ${got}`);
    for (const k of ROUNDUPS) assert.ok(paths.includes(`${hub}/${k}`), `${region} should key on ${hub}/${k}`);
  }
});

// The fixture above only covers the three names we already know about. This one
// walks the real corpus, so the next region with a ñ in it fails here instead of
// quietly losing its freshness signal for a year.
test('every hub path the real corpus produces names a slug some route can build', () => {
  const postsDir = new URL('../content/posts/', import.meta.url);
  const countries = JSON.parse(readFileSync(new URL('../../data/countries.json', import.meta.url), 'utf8')).countries;
  const countrySlugs = new Set(countries.map((c) => c.slug));
  // What the continent route builds: one page per continent named in countries.json.
  const continentSlugs = new Set(
    countries.map((c) => c.continent || 'Other').map((n) => slugifyRegion(n)),
  );
  // /essentials/<x> is served by TWO collections: a country guide, or one of the
  // six cross-country topic hubs. Both are real URLs and both need a date.
  const essentialsIds = new Set([
    ...readdirSync(new URL('../content/essentials/', import.meta.url)),
    ...readdirSync(new URL('../content/essentials-topics/', import.meta.url)),
  ].filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
  const MONTH_SLUGS = new Set([
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ]);
  const STATIC = new Set(['/destinations', '/regions', '/tools/when-to-go', '/']);

  // The same crude frontmatter read astro.config.mjs uses to build HUB_LASTMOD,
  // so this test sees exactly the strings production sees.
  const NL = String.fromCharCode(10);
  const posts = [];
  for (const f of readdirSync(postsDir)) {
    if (!f.endsWith('.md')) continue;
    const raw = readFileSync(new URL(f, postsDir), 'utf8');
    const fm = raw.slice(4, raw.indexOf(NL + '---', 3));
    if (/^draft:\s*true/m.test(fm)) continue;
    /** @param {string} k */
    const val = (k) => {
      const line = fm.split(NL).find((l) => l.trimStart().startsWith(k + ':'));
      if (!line) return '';
      return line.trimStart().slice(k.length + 1).trim().replace(/^["']|["']$/g, '');
    };
    posts.push({
      region: val('region'),
      country: val('country'),
      category: val('category'),
      eventStartDate: val('eventStartDate'),
    });
  }
  assert.ok(posts.length > 1000, `expected the real corpus, found ${posts.length} posts`);

  // What the region route builds: one hub per distinct region string, slugified.
  const regionSlugs = new Set(
    posts.map((p) => p.region).filter((r) => r && !r.includes('/')).map((r) => slugifyRegion(r)),
  );

  // hubPathsFor is deliberately looser than the routes about WHETHER a hub
  // exists — it emits all four roundups, and an events hub for a country that
  // may only have one event. A key for a page that does not exist costs nothing.
  // A key with the wrong SLUG is the bug: the page exists and gets no date.
  const bad = new Set();
  for (const post of posts) {
    for (const path of hubPathsFor(post)) {
      if (STATIC.has(path)) continue;
      const seg = path.split('/').slice(1);
      let ok = false;
      if (seg[0] === 'regions') {
        ok = regionSlugs.has(seg[1]) && (seg.length === 2 || (seg.length === 3 && ROUNDUPS.includes(seg[2])));
      } else if (seg[0] === 'destinations' || seg[0] === 'events') {
        ok = seg.length === 2 && countrySlugs.has(seg[1]);
      } else if (seg[0] === 'essentials') {
        ok = seg.length === 2 && essentialsIds.has(seg[1]);
      } else if (seg[0] === 'continents') {
        ok = seg.length === 2 && continentSlugs.has(seg[1]);
      } else if (seg[0] === 'tools' && seg[1] === 'when-to-go') {
        ok = seg.length === 4 && countrySlugs.has(seg[2]) && MONTH_SLUGS.has(seg[3]);
      }
      if (!ok) bad.add(`${path}  (region=${post.region} country=${post.country})`);
    }
  }
  assert.deepEqual([...bad], [], 'hub lastmod keys that no route can produce');
});

// All four copies of this slug now delegate to scripts/lib/slugify.mjs. If one
// is ever re-inlined, this catches the drift before a build does.
test('every slug helper that builds a region URL agrees with slugifyRegion', async () => {
  const { slugify } = await import('../../scripts/lib/slugify.mjs');
  const config = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
  // assert.ok, not assert.match: a failing match prints the whole 26 KB config.
  assert.ok(
    /import \{ slugify as regionSlug \} from '\.\/scripts\/lib\/slugify\.mjs'/.test(config),
    'astro.config.mjs should import the shared slugify, not re-inline it',
  );
  for (const s of ['Alcañiz', 'Buñol', "Xi'an", 'New York City', 'Abu Dhabi']) {
    assert.equal(slugifyRegion(s), slugify(s), s);
  }
});
