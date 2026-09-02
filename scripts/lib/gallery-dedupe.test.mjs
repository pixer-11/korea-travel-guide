// 한 페이지에 같은 사진이 두 번 뜨면 안 된다 — 히어로와 본문 사진이 같은 URL이 된 경우.
//   node --test scripts/lib/gallery-dedupe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { dropGalleryCopiesOfHero } from './gallery-dedupe.mjs';

test('히어로와 같은 URL의 갤러리 항목은 지운다', () => {
  const d = { heroImage: { url: 'A' }, gallery: [{ url: 'A' }, { url: 'B' }] };
  assert.equal(dropGalleryCopiesOfHero(d), 1);
  assert.deepEqual(d.gallery, [{ url: 'B' }]);
});

test('갤러리가 히어로 하나뿐이면 갤러리 필드를 통째로 없앤다', () => {
  const d = { heroImage: { url: 'A' }, gallery: [{ url: 'A' }] };
  assert.equal(dropGalleryCopiesOfHero(d), 1);
  assert.equal('gallery' in d, false);
});

test('다른 사진은 건드리지 않는다 — 폭만 다른 URL도 다른 URL이다', () => {
  const d = { heroImage: { url: 'A/1920px-x.jpg' }, gallery: [{ url: 'A/960px-x.jpg' }] };
  assert.equal(dropGalleryCopiesOfHero(d), 0);
  assert.equal(d.gallery.length, 1);
});

test('히어로가 없거나 갤러리가 없으면 아무 일도 하지 않는다', () => {
  assert.equal(dropGalleryCopiesOfHero({ gallery: [{ url: 'A' }] }), 0);
  assert.equal(dropGalleryCopiesOfHero({ heroImage: { url: 'A' } }), 0);
  assert.equal(dropGalleryCopiesOfHero(null), 0);
});
