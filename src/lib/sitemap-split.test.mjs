import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, groupUrls, newestLastmod, renderSitemap, renderIndex, pageType } from './sitemap-split.mjs';

const S = 'https://wanderatlasguides.com';

test('language prefix is read, and only a real one', () => {
  assert.equal(classify(`${S}/ko/posts/x/`).lang, 'ko');
  assert.equal(classify(`${S}/posts/x/`).lang, 'en');
  // A slug that merely STARTS with a locale code is not a locale.
  assert.equal(classify(`${S}/posts/korea-guide/`).lang, 'en');
  assert.equal(classify(`${S}/essentials/japan/`).lang, 'en');
});

test('type is taken from the path with the locale stripped', () => {
  assert.equal(classify(`${S}/ja/tools/esim/japan/`).type, 'tools');
  assert.equal(classify(`${S}/zh/tools/when-to-go/japan/march/`).type, 'when-to-go');
  assert.equal(classify(`${S}/es/events/`).type, 'events');
  assert.equal(classify(`${S}/itinerary/tokyo-3-days/`).type, 'itineraries');
  assert.equal(classify(`${S}/regions/kansai/`).type, 'hubs');
  assert.equal(classify(`${S}/about/`).type, 'pages');
  assert.equal(classify(`${S}/`).type, 'pages');
});

// when-to-go must not be swallowed by the broader /tools/ rule.
test('when-to-go outranks tools', () => {
  assert.equal(pageType('/tools/when-to-go'), 'when-to-go');
  assert.equal(pageType('/tools/best-time'), 'tools');
});

const XML = `<?xml version="1.0" encoding="UTF-8"?><urlset>`
  + `<url><loc>${S}/posts/a/</loc><lastmod>2026-08-20T00:00:00.000Z</lastmod></url>`
  + `<url><loc>${S}/posts/b/</loc><lastmod>2026-08-24T00:00:00.000Z</lastmod></url>`
  + `<url><loc>${S}/ko/posts/a/</loc></url>`
  + `<url><loc>${S}/about/</loc></url>`
  + `</urlset>`;

test('every URL lands in exactly one group — nothing is dropped', () => {
  const g = groupUrls(XML);
  const total = [...g.values()].reduce((n, v) => n + v.length, 0);
  assert.equal(total, 4, 'all four URLs are placed');
  assert.deepEqual([...g.keys()].sort(), ['en-pages', 'en-posts', 'ko-posts']);
  assert.equal(g.get('en-posts').length, 2);
});

test('lastmod survives the move, and the index carries the newest', () => {
  const g = groupUrls(XML);
  const blocks = g.get('en-posts');
  assert.ok(renderSitemap(blocks).includes('<lastmod>2026-08-24T00:00:00.000Z</lastmod>'));
  assert.equal(newestLastmod(blocks), '2026-08-24T00:00:00.000Z');
  assert.equal(newestLastmod(g.get('en-pages')), null, 'no lastmod is not an invented one');
});

test('the index points at absolute child URLs', () => {
  const out = renderIndex([{ name: 'sitemap-en-posts.xml', lastmod: null }], `${S}/`);
  assert.ok(out.includes(`<loc>${S}/sitemap-en-posts.xml</loc>`));
  assert.ok(!out.includes('<lastmod>'), 'an absent lastmod is omitted, not empty');
});
