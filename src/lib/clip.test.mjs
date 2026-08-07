import test from 'node:test';
import assert from 'node:assert/strict';
import { clip } from './clip.mjs';

test('short text is returned untouched', () => {
  assert.equal(clip('Short enough.'), 'Short enough.');
  assert.equal(clip(''), '');
  assert.equal(clip(undefined), '');
});

test('ends on a sentence rather than mid-word', () => {
  const s = 'Paris is a city of grand boulevards and quiet courtyards. Beyond the landmarks lie hidden passages, covered arcades, and neighbourhood markets that most visitors never find.';
  const out = clip(s);
  assert.ok(out.endsWith('.'), out);
  assert.ok(!out.endsWith('neighborhood '), out);
  assert.equal(out, 'Paris is a city of grand boulevards and quiet courtyards.');
});

test('never emits the mid-word cut that this replaces', () => {
  // The real live defect: /regions/paris/ ended "…hidden passages, and neighborhood "
  const s = 'A single very long opening clause that simply keeps going with commas, and hidden passages, and neighborhood markets, and more besides, running past the limit without any full stop at all until here.';
  const out = clip(s);
  assert.ok(/[.!?]$/.test(out), out);
  assert.ok(!/\s$/.test(out), `trailing space: ${JSON.stringify(out)}`);
  assert.ok(!/\b(and|or|the|with|for|of)\.$/i.test(out), `dangling function word: ${out}`);
});

test('CJK gets a shorter budget and cuts on 。', () => {
  const ko = '서울은 오래된 골목과 새 건물이 나란히 선 도시다. 경복궁에서 북촌으로 걸어 올라가면 조선의 궁궐과 한옥, 그리고 그 사이를 채운 작은 카페들이 한 번에 이어진다. 이 글은 그 길을 따라간다.';
  const out = clip(ko);
  assert.ok(out.length <= 78, `too long: ${out.length}`);
  assert.ok(out.endsWith('.') || out.endsWith('。'), out);
  assert.equal(out, '서울은 오래된 골목과 새 건물이 나란히 선 도시다.');
});

test('Japanese cuts on the full-width stop', () => {
  const ja = '東京は古い路地と新しい建物が並ぶ街です。浅草から上野へ歩けば、江戸の面影と現代の喧騒が一度に見えてきます。この記事はその道をたどります。';
  const out = clip(ja);
  assert.ok(out.length <= 78, `too long: ${out.length}`);
  assert.ok(out.endsWith('。'), out);
});

test('CJK with no stop near the limit still ends cleanly, never mid-punctuation', () => {
  const zh = '这是一段没有任何句号的很长的中文描述' + '内容'.repeat(60);
  const out = clip(zh);
  assert.ok(out.length <= 80, `too long: ${out.length}`);
  assert.ok(!/[、,;:·—–-]$/.test(out.replace(/…$/, '')), out);
});

test('a CJK stop too early is skipped for the next one', () => {
  // "네." at index 2 is a real terminator but a useless snippet.
  const ko = '네. ' + '서울의 골목을 따라 걷는 이야기다. '.repeat(4);
  const out = clip(ko);
  assert.ok(out.length > 10, `took the stub: ${out}`);
});

test('respects an explicit budget', () => {
  const s = 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.';
  assert.ok(clip(s, 20).length <= 21, clip(s, 20));
});
