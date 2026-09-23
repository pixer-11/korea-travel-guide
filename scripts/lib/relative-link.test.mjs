// 차단기는 "막히는가" 와 "정상까지 막진 않는가" 둘 다 재야 한다.
// 이 검사기는 9,494개 md 를 훑으므로 오탐 하나가 커밋을 통째로 막는다.
//   node --test scripts/lib/relative-link.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeLinks } from './relative-link.mjs';

const NL = '\n';
const lines = (...xs) => xs.join(NL);

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

// ── 09-23 코덱스 지적 — 정규식이 놓친 모양들. 렌더러는 이것들을 전부 링크로 만든다. ──

test('제목 붙은 링크도 잡는다 — 코덱스 재현 사례', () => {
  assert.deepEqual(relativeLinks('[Tour](letour.fr "Official site")'), [{ label: 'Tour', href: 'letour.fr' }]);
});

test('참조형 링크는 정의 쪽에서 잡는다', () => {
  const hits = relativeLinks(lines('See the [Tour][t] site.', '', '[t]: letour.fr', ''));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].href, 'letour.fr');
});

test('꺾쇠 주소는 벗겨서 판정한다 — 사이트 경로면 통과, 맨 도메인이면 잡는다', () => {
  assert.deepEqual(relativeLinks('[eSIM](</tools/esim/>)'), [], '정규식 판은 이걸 오탐했다');
  assert.equal(relativeLinks('[Tour](<letour.fr>)').length, 1);
});

test('코드 블록·인라인 코드 안의 링크 모양은 링크가 아니다 — 잡지 않는다', () => {
  const t = lines('마크다운 링크는 이렇게 씁니다:', '', '```md', '[site](example.com)', '```', '', '또는 `[a](b)` 처럼.');
  assert.deepEqual(relativeLinks(t), []);
});

// ── 프론트매터: 원래 버그는 FAQ 답변 안에 있었다 ──

test('FAQ 답변(목록 안, 4칸 들여쓰기) 속 링크를 잡는다 — 원래 버그 모양 그대로', () => {
  const t = lines(
    '---',
    'title: x',
    'faq:',
    '  - q: 공식 사이트는?',
    '    a: 공식 사이트인 [letour.fr](letour.fr)가 기준입니다.',
    '---',
    '',
    '본문.',
    '',
  );
  assert.deepEqual(relativeLinks(t), [{ label: 'letour.fr', href: 'letour.fr' }]);
});

test('목록 밖에서 4칸 들여쓴 YAML 값도 잡는다 — 파일째 파싱하면 코드 블록이 돼 놓치는 자리', () => {
  const t = lines('---', 'meta:', '    note: 참고 [공식](letour.fr)', '---', '', '본문.', '');
  assert.equal(relativeLinks(t).length, 1);
});

test('프론트매터와 본문 둘 다에 있으면 둘 다, 위에서부터 순서대로', () => {
  const t = lines('---', 'quickAnswer: 먼저 [A](a.fr)', '---', '', '나중 [B](b.fr)', '');
  assert.deepEqual(relativeLinks(t).map((h) => h.href), ['a.fr', 'b.fr']);
});

test('YAML 이 깨져 있어도 못 봤다고 통과시키지 않는다', () => {
  const t = lines('---', 'title: "닫히지 않은 따옴표', 'note: [x](bad.fr)', '---', '', '본문', '');
  assert.equal(relativeLinks(t).length, 1);
});

test('프론트매터의 정상 URL 값은 건드리지 않는다', () => {
  const t = lines(
    '---',
    'heroImage:',
    '  url: https://upload.wikimedia.org/a.jpg',
    'source: "[공식](https://letour.fr)"',
    '---',
    '',
    '본문',
    '',
  );
  assert.deepEqual(relativeLinks(t), []);
});
