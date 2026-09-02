import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTrailingSlash, siteHref, SITE_ORIGIN } from './urls.mjs';

test('root-relative paths gain the slash; slashed ones are left as they are', () => {
  assert.equal(withTrailingSlash('/ko/destinations'), '/ko/destinations/');
  assert.equal(withTrailingSlash('/ko/destinations/'), '/ko/destinations/');
  assert.equal(withTrailingSlash('/'), '/');
  assert.equal(withTrailingSlash('/about'), '/about/');
});

test('files keep their extension form — a slash after .xml would 404', () => {
  for (const f of ['/sitemap-index.xml', '/api/crowd.json', '/og/abc.webp', '/robots.txt', '/favicon.svg', '/x/y.ics']) {
    assert.equal(withTrailingSlash(f), f);
  }
  // a dot in an EARLIER segment is not a file
  assert.equal(withTrailingSlash('/posts/v2.0-guide/'), '/posts/v2.0-guide/');
});

test('query and hash survive, with the slash inserted before them', () => {
  assert.equal(withTrailingSlash('/tools/esim?country=jp'), '/tools/esim/?country=jp');
  assert.equal(withTrailingSlash('/about#editor'), '/about/#editor');
  assert.equal(withTrailingSlash('/about?x=1#y'), '/about/?x=1#y');
  assert.equal(withTrailingSlash('/about/#editor'), '/about/#editor');
});

test('absolute URLs on our own origin are normalized; other hosts are untouched', () => {
  assert.equal(withTrailingSlash('https://wanderatlasguides.com/about'), 'https://wanderatlasguides.com/about/');
  assert.equal(withTrailingSlash('https://wanderatlasguides.com'), 'https://wanderatlasguides.com/');
  assert.equal(withTrailingSlash('https://wanderatlasguides.com/about#editor'), 'https://wanderatlasguides.com/about/#editor');
  assert.equal(withTrailingSlash('https://wanderatlasguides.com/og/abc.webp'), 'https://wanderatlasguides.com/og/abc.webp');
  assert.equal(withTrailingSlash('https://www.pinterest.com/pixervtm'), 'https://www.pinterest.com/pixervtm');
  assert.equal(withTrailingSlash('https://upload.wikimedia.org/x/y'), 'https://upload.wikimedia.org/x/y');
  // a preview host (SITE_URL override) is "ours" when passed as site
  assert.equal(withTrailingSlash('https://preview.example/ko/events', 'https://preview.example'), 'https://preview.example/ko/events/');
  assert.equal(withTrailingSlash('https://wanderatlasguides.com/ko/events', 'https://preview.example'), 'https://wanderatlasguides.com/ko/events');
});

test('protocol-relative, page-relative, empty and non-string inputs pass through', () => {
  assert.equal(withTrailingSlash('//cdn.example/x'), '//cdn.example/x');
  assert.equal(withTrailingSlash('foo/bar'), 'foo/bar');
  assert.equal(withTrailingSlash(''), '');
  assert.equal(withTrailingSlash(undefined), undefined);
  assert.equal(withTrailingSlash('mailto:hi@example.com'), 'mailto:hi@example.com');
});

test('siteHref builds the canonical absolute form from a path and Astro.site', () => {
  const site = new URL('https://wanderatlasguides.com/');
  assert.equal(siteHref('/ko/destinations', site), 'https://wanderatlasguides.com/ko/destinations/');
  assert.equal(siteHref('/', site), 'https://wanderatlasguides.com/');
  assert.equal(siteHref('/posts/seoul-gyeongbokgung', site), 'https://wanderatlasguides.com/posts/seoul-gyeongbokgung/');
  assert.equal(siteHref('/posts/seoul-gyeongbokgung/', site), 'https://wanderatlasguides.com/posts/seoul-gyeongbokgung/');
  assert.equal(siteHref('/favicon.svg', site), 'https://wanderatlasguides.com/favicon.svg');
  assert.equal(siteHref('/about#editor', site), 'https://wanderatlasguides.com/about/#editor');
  // no site → the production origin
  assert.equal(siteHref('/about'), `${SITE_ORIGIN}/about/`);
  // an already-absolute external URL is passed through the same rule (untouched)
  assert.equal(siteHref('https://www.instagram.com/wander_atlas_guides', site), 'https://www.instagram.com/wander_atlas_guides');
});

test('idempotent: applying the rule twice changes nothing', () => {
  for (const u of ['/ko/events', '/x.xml', 'https://wanderatlasguides.com/about?a=1#b', '/']) {
    const once = withTrailingSlash(u);
    assert.equal(withTrailingSlash(once), once);
  }
});
