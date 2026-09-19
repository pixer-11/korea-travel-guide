import test from 'node:test';
import assert from 'node:assert/strict';
import { firstTell, countTells } from './ai-tells.mjs';

test('깨끗한 원고는 통과시킨다', () => {
  const clean = 'The shrine sits on Museum Drive. Arrive before ten and the courtyard is quiet; by noon the tour buses are in.';
  assert.equal(firstTell(clean), null);
  assert.deepEqual(countTells(clean), {});
});

test('09-08 이후 실제로 새어 나온 문구 세 가지를 잡는다', () => {
  // 2026-09-19 기준 최근 유출 9건의 정체
  assert.equal(firstTell("Whether you're here for the carvings or the quiet, come early."), "Whether you're here for the carvings or");
  assert.ok(firstTell("This isn't just a temple, it's a working monastery."));
  assert.ok(firstTell('The iconic tower dominates the skyline.'));
});

test('문장 맨 앞의 문구를 돌려준다 — 재작성 요청이 무엇을 지울지 말해야 한다', () => {
  const body = 'A hidden gem in the heart of the old town.';
  assert.equal(firstTell(body), 'A hidden gem'.slice(2)); // 'hidden gem' 이 더 앞에 있다
});

test('평범한 영어는 건드리지 않는다', () => {
  assert.equal(firstTell('The heart of the fruit is bitter; locals scoop it out.'), null);
  assert.equal(firstTell('You must visit the office before 5pm to collect the permit.'), null);
});

test('countTells 는 갯수를 센다', () => {
  const body = 'An iconic view. Another iconic shot. A hidden gem too.';
  assert.deepEqual(countTells(body), { iconic: 2, 'hidden gem': 1 });
});

test('must-visit 은 과장 용법만 잡고 평범한 조동사는 놔둔다 (양방향)', () => {
  assert.ok(firstTell('Ayutthaya is a must-visit day trip from Bangkok.'));
  assert.ok(firstTell('The night market is a must see.'));
  assert.equal(firstTell('You must visit the ticket office before 5pm.'), null);
  assert.equal(firstTell('Visitors must see the permit desk first.'), null);
});
