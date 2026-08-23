import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkMentions } from './body-links.mjs';

const T = [
  { name: 'Aquarium of Genoa', href: '/posts/genoa-aquarium/' },
  { name: 'Royal Palace Museum', href: '/posts/genoa-royal-palace-museum/' },
  { name: 'Boccadasse', href: '/posts/genoa-boccadasse/' },
];

test('links the first plain-text mention only, once per target', () => {
  const html = '<p>Walk from the Aquarium of Genoa to Boccadasse. The Aquarium of Genoa again.</p>';
  assert.equal(linkMentions(html, T),
    '<p>Walk from the <a href="/posts/genoa-aquarium/">Aquarium of Genoa</a> to <a href="/posts/genoa-boccadasse/">Boccadasse</a>. The Aquarium of Genoa again.</p>');
});

test('never links inside an existing link, a heading, or code', () => {
  const html = '<h2 id="x">Boccadasse</h2><p>See <a href="/y">Boccadasse</a> and <code>Boccadasse</code>; then Boccadasse.</p>';
  assert.equal(linkMentions(html, T),
    '<h2 id="x">Boccadasse</h2><p>See <a href="/y">Boccadasse</a> and <code>Boccadasse</code>; then <a href="/posts/genoa-boccadasse/">Boccadasse</a>.</p>');
});

test('word boundaries: no link inside a longer word, case-insensitive match keeps the text', () => {
  const html = '<p>The Boccadasses? No. But boccadasse yes.</p>';
  assert.equal(linkMentions(html, T), '<p>The Boccadasses? No. But <a href="/posts/genoa-boccadasse/">boccadasse</a> yes.</p>');
});

test('respects the per-article budget and skips short names', () => {
  const html = '<p>Aquarium of Genoa, Royal Palace Museum, Boccadasse.</p>';
  const out = linkMentions(html, [...T, { name: 'Bar', href: '/posts/bar/' }], { max: 2 });
  assert.equal((out.match(/<a /g) || []).length, 2);
  assert.ok(!out.includes('/posts/bar/'));
});

test('a shorter name never lands inside an anchor just written for a longer one', () => {
  const html = '<p>Genoa Royal Palace Museum tour.</p>';
  const out = linkMentions(html, [
    { name: 'Royal Palace Museum', href: '/a/' },
    { name: 'Palace', href: '/b/' },
  ]);
  assert.equal(out, '<p>Genoa <a href="/a/">Royal Palace Museum</a> tour.</p>');
});

test('Korean/Japanese names match with a particle attached; Latin names still need a boundary', () => {
  const ko = linkMentions('<p>북촌에서 경복궁을 지나 걷는다.</p>', [{ name: '경복궁', href: '/ko/posts/seoul-gyeongbokgung-palace/' }], { minLen: 2 });
  assert.equal(ko, '<p>북촌에서 <a href="/ko/posts/seoul-gyeongbokgung-palace/">경복궁</a>을 지나 걷는다.</p>');
  const ja = linkMentions('<p>景福宮の門。</p>', [{ name: '景福宮', href: '/ja/x/' }], { minLen: 2 });
  assert.equal(ja, '<p><a href="/ja/x/">景福宮</a>の門。</p>');
});

test('leaves html alone without targets or text', () => {
  assert.equal(linkMentions('<p>x</p>', []), '<p>x</p>');
  assert.equal(linkMentions('', T), '');
});
