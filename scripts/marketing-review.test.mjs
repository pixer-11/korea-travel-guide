// 주간 마케팅 제안이 매주 같은 헛제안을 반복하지 않게 하는 장치를 고정한다(09-28).
// 스크립트는 import 하면 실행되므로(모델 호출·텔레그램) 소스만 읽는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('scripts/marketing-review.mjs', 'utf8');

test('이미 결론 난 목록이 자료 맨 앞에 있다 — 6,000자 자르기에 먼저 잘리지 않게', () => {
  const facts = src.indexOf('const facts = {');
  const settled = src.indexOf('already_settled:', facts);
  const firstOther = src.indexOf('posts_live:', facts);
  assert.ok(facts > -1 && settled > facts, '결론 목록이 없다');
  assert.ok(settled < firstOther, '결론 목록이 다른 자료 뒤에 있다');
  assert.match(src, /Retitling[^']*CLOSED 2026-09-21/, '제목 바꾸기 종료가 목록에 없다');
  assert.match(src, /Google Business Profiles belong to the venues/, '남의 가게 프로필 금지가 목록에 없다');
});

test('노출 몇 번짜리 검색어는 근거에서 뺀다', () => {
  assert.match(src, /const MIN_IMP = \d+/);
  assert.match(src, /filter\(\(r\) => r\.impressions >= MIN_IMP\)/);
});

test('묵은 주간 기록은 "이번 주"로 넘기지 않는다', () => {
  assert.match(src, /ageDays > 8/);
  assert.match(src, /stale: true/);
});
