import { test } from 'node:test';
import assert from 'node:assert/strict';
import rehypeLocalizeLinks, { localizeHref } from './rehype-localize-links.mjs';

const seg = new Set(['about', 'contact', 'posts', 'essentials', 'tools', 'regions', 'destinations', 'events']);

test('an internal link with a localized twin is prefixed with the language', () => {
  assert.equal(localizeHref('/about', 'ko', seg), '/ko/about');
  assert.equal(localizeHref('/posts/seoul-bukchon/', 'ja', seg), '/ja/posts/seoul-bukchon/');
  assert.equal(localizeHref('/contact?src=x#top', 'es', seg), '/es/contact?src=x#top');
  assert.equal(localizeHref('/', 'zh', seg), '/zh/');
});

test('already-localized, external, file, affiliate and unknown links are untouched', () => {
  assert.equal(localizeHref('/ko/about', 'ko', seg), '/ko/about');
  assert.equal(localizeHref('https://example.com/about', 'ko', seg), 'https://example.com/about');
  assert.equal(localizeHref('/search.json', 'ko', seg), '/search.json');
  assert.equal(localizeHref('/go/klook?x=1', 'ko', seg), '/go/klook?x=1');
  assert.equal(localizeHref('/api/crowd.json', 'ko', seg), '/api/crowd.json');
  assert.equal(localizeHref('#faq', 'ko', seg), '#faq');
});

test('the plugin rewrites anchors only for files under a translation directory', () => {
  const tree = () => ({ type: 'root', children: [{ type: 'element', tagName: 'p', properties: {}, children: [
    { type: 'element', tagName: 'a', properties: { href: '/about' }, children: [] },
  ] }] });
  const run = rehypeLocalizeLinks();
  const ko = tree();
  run(ko, { path: 'C:\\repo\\src\\content\\static-pages-i18n\\ko\\methodology.md' });
  const en = tree();
  run(en, { path: 'C:/repo/src/content/static-pages/methodology.md' });
  const post = tree();
  run(post, { path: '/repo/src/content/i18n/ja/seoul-bukchon.md' });
  assert.equal(ko.children[0].children[0].properties.href, '/ko/about');
  assert.equal(en.children[0].children[0].properties.href, '/about');
  assert.equal(post.children[0].children[0].properties.href, '/ja/about');
});
