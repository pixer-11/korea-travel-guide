// 차단기는 "막히는가" 와 "정상까지 막진 않는가" 둘 다 재야 한다.
// 이 검사기는 9,494개 md 를 훑으므로 오탐 하나가 커밋을 통째로 막는다.
//   node --test scripts/lib/relative-link.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeLinks } from './relative-link.mjs';

test('스킴 없는 도메인 링크를 잡는다 — 09-23 ja letour.fr 건', () => {
  const t = 'ツール・ド・フランス公式サイトである[letour.fr](letour.fr)が、開催地となる各都市…';
  assert.deepEqual(relativeLinks(t), [{ label: 'letour.fr', href: 'letour.fr' }]);
});

test('상대 파일 경로도 잡는다 — 글 주소 뒤에 붙는 건 같다', () => {
  assert.equal(relativeLinks('[안내](guide.html) 와 [지도](./map)').length, 2);
});

test('http·https·mailto·tel 은 통과', () => {
  const t = '[a](https://letour.fr) [b](http://x.test) [c](mailto:hello@wanderatlasguides.com) [d](tel:+821012345678)';
  assert.deepEqual(relativeLinks(t), []);
});

test('사이트 절대경로와 앵커는 통과', () => {
  assert.deepEqual(relativeLinks('[도구](/tools/esim/) [위로](#top) [ko](/ko/posts/x/)'), []);
});

test('프로토콜 상대 주소는 통과 — 브라우저가 바깥으로 보낸다', () => {
  assert.deepEqual(relativeLinks('[cdn](//cdn.example.com/a.jpg)'), []);
});

test('링크가 아닌 글자 속 도메인은 건드리지 않는다 — ko·zh·es 가 쓴 방식', () => {
  assert.deepEqual(relativeLinks('letour.fr는 투르 드 프랑스 공식 웹사이트로, 스테이지 개최 도시를…'), []);
});

test('이미지 문법도 같은 규칙으로 잡힌다', () => {
  // ![alt](src) 는 앞의 `!` 만 다를 뿐 같은 괄호 쌍이다 — 깨진 src 는 똑같이 404 다.
  assert.deepEqual(relativeLinks('![간판](venue.jpg)'), [{ label: '간판', href: 'venue.jpg' }]);
});

test('빈 값·null 에도 터지지 않는다', () => {
  assert.deepEqual(relativeLinks(''), []);
  assert.deepEqual(relativeLinks(null), []);
  assert.deepEqual(relativeLinks(undefined), []);
});

test('주소에 공백이 있는 건 마크다운 링크가 아니다 — 건드리지 않는다', () => {
  assert.deepEqual(relativeLinks('[문장](여기 채우기)'), []);
});
