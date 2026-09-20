import test from 'node:test';
import assert from 'node:assert/strict';
import { namedIds, translatable } from './translate-scope.mjs';

test('--only 는 "슬러그" 와 "언어/슬러그" 두 표기를 모두 받는다', () => {
  const ids = namedIds(['mumbai-fielia', 'ja/koh-samui-izzy-s', 'ko/koh-samui-izzy-s.md', '']);
  assert.deepEqual([...ids].sort(), ['koh-samui-izzy-s', 'mumbai-fielia']);
});

test('평소에는 초안을 번역하지 않는다 (사진 대기 초안 수백 편에 돈을 쓰지 않는다)', () => {
  const none = namedIds([]);
  assert.equal(translatable({ draft: true }, 'mumbai-fielia', none), false);
  assert.equal(translatable({ draft: false }, 'mumbai-fielia', none), true);
  assert.equal(translatable({}, 'mumbai-fielia', none), true);
});

test('이름을 직접 지목하면 초안이어도 다시 번역한다', () => {
  assert.equal(translatable({ draft: true }, 'mumbai-fielia', namedIds(['ja/mumbai-fielia'])), true);
  assert.equal(translatable({ draft: true }, 'mumbai-fielia', namedIds(['mumbai-fielia'])), true);
});

test('지목은 그 슬러그에만 적용된다 — 옆 초안까지 끌려오지 않는다', () => {
  const ids = namedIds(['ja/mumbai-fielia']);
  assert.equal(translatable({ draft: true }, 'mumbai-fielia-2', ids), false);
  assert.equal(translatable({ draft: true }, 'fielia', ids), false);
});

test('프론트매터를 못 읽은 파일은 통과시키지 않는다', () => {
  assert.equal(translatable(null, 'x', namedIds(['x'])), false);
  assert.equal(translatable(undefined, 'x', namedIds(['x'])), false);
});
