// topic-yield 회귀 테스트.
//
// 검색 1회는 글이 나오든 안 나오든 하루 100회 한도를 깎는다. 2026-08-23 실행은
// 처음 10회를 성공률 4%짜리 식당·카페 검색에 쓰고 55%짜리 박물관·유적에는
// 한도가 떨어진 뒤에야 닿았다(111회 → 14편, 대량발행 0편). 그래서 고정하는 것:
//   ① 등급 판정 경계(미측정은 mid, 10회 미만은 미측정)
//   ② 안정 분할 — 등급 안에서는 상류의 나라·지역 공평 순서가 그대로
//   ③ 저수율 탐침 2개가 앞쪽 고정 자리에 들어간다(완전 배제 금지 — 스스로 회복 경로)
//   ④ 기록: 성공/허탕만 세고, 200회 넘으면 반감(최근 데이터가 더 무겁게)
//
//   node --test scripts/lib/topic-yield.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyLedger, tierOf, recordOutcome, orderByYield, describeYield,
  loadYield, saveYield, MIN_ATTEMPTS, PROBE_SLOTS,
} from './topic-yield.mjs';

const ledgerFrom = (rows) => {
  const l = emptyLedger();
  for (const [topic, attempts, hits] of rows) l.topics[topic] = { attempts, hits };
  return l;
};

test('등급 경계: 미측정→mid, <10%→low, ≥30%→high, 사이→mid', () => {
  const l = ledgerFrom([
    ['museum', 87, 47],      // 54 %
    ['noodles', 14, 0],      // 0 %
    ['viewpoint', 39, 6],    // 15 %
    ['bakery', 2, 0],        // 미측정 (2 < MIN_ATTEMPTS)
    ['exactly-low', 10, 0],  // 10회 0% → low (경계 포함)
    ['exactly-high', 10, 3], // 30 % → high
  ]);
  assert.equal(tierOf(l, 'museum'), 'high');
  assert.equal(tierOf(l, 'noodles'), 'low');
  assert.equal(tierOf(l, 'viewpoint'), 'mid');
  assert.equal(tierOf(l, 'bakery'), 'mid');
  assert.equal(tierOf(l, 'exactly-low'), 'low');
  assert.equal(tierOf(l, 'exactly-high'), 'high');
  assert.equal(tierOf(l, 'never-seen'), 'mid');
  assert.equal(tierOf(l, undefined), 'mid');
  assert.ok(MIN_ATTEMPTS >= 10);
});

test('안정 분할: high → mid → low, 등급 안 순서는 그대로', () => {
  const l = ledgerFrom([['museum', 50, 30], ['noodles', 20, 0]]);
  const q = [
    { id: 'n1', topic: 'noodles' }, { id: 'm1', topic: 'museum' }, { id: 'u1', topic: 'unknown' },
    { id: 'n2', topic: 'noodles' }, { id: 'm2', topic: 'museum' }, { id: 'u2' },
  ];
  const out = orderByYield(q, l, { probes: 0 }).map((t) => t.id);
  assert.deepEqual(out, ['m1', 'm2', 'u1', 'u2', 'n1', 'n2']);
});

test('탐침: low 2개가 고정 자리(5, 10)에 들어가고 나머지 low는 맨 뒤', () => {
  const l = ledgerFrom([['museum', 50, 30], ['noodles', 20, 0]]);
  const q = [];
  for (let i = 0; i < 4; i++) q.push({ id: 'n' + i, topic: 'noodles' });
  for (let i = 0; i < 15; i++) q.push({ id: 'm' + i, topic: 'museum' });
  const out = orderByYield(q, l).map((t) => t.id);
  assert.equal(out[PROBE_SLOTS[0]], 'n0');
  assert.equal(out[PROBE_SLOTS[1]], 'n1');
  assert.deepEqual(out.slice(-2), ['n2', 'n3']);
  assert.equal(out.length, q.length);
  assert.equal(new Set(out).size, q.length, '빠지거나 겹친 항목 없음');
});

test('탐침: 큐가 짧아도 범위를 벗어나지 않는다', () => {
  const l = ledgerFrom([['noodles', 20, 0]]);
  const q = [{ id: 'n0', topic: 'noodles' }, { id: 'n1', topic: 'noodles' }, { id: 'n2', topic: 'noodles' }];
  const out = orderByYield(q, l).map((t) => t.id);
  assert.deepEqual(out, ['n0', 'n1', 'n2']);
});

test('기록: 성공/허탕 집계, 200회 넘으면 반감', () => {
  const l = emptyLedger();
  recordOutcome(l, 'park', true);
  recordOutcome(l, 'park', false);
  recordOutcome(l, undefined, true); // topic 없는 타깃은 무시
  assert.deepEqual(l.topics, { park: { attempts: 2, hits: 1 } });
  l.topics.park = { attempts: 200, hits: 100 };
  recordOutcome(l, 'park', true);
  assert.deepEqual(l.topics.park, { attempts: 101, hits: 51 });
  assert.equal(tierOf(l, 'park'), 'high');
});

test('저장·불러오기 왕복 + 깨진 파일은 빈 장부', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'topicyield-'));
  try {
    const p = join(dir, 'y.json');
    const l = ledgerFrom([['museum', 3, 1]]);
    await saveYield(l, p);
    const back = await loadYield(p);
    assert.deepEqual(back.topics, { museum: { attempts: 3, hits: 1 } });
    assert.ok(back.updated);
    const none = await loadYield(join(dir, 'missing.json'));
    assert.deepEqual(none.topics, {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('요약 한 줄에 low 종류와 분수가 보인다', () => {
  const l = ledgerFrom([['museum', 50, 30], ['noodles', 20, 0], ['bar', 3, 0]]);
  const s = describeYield(l);
  assert.match(s, /high 1 · mid 1 · low 1/);
  assert.match(s, /noodles 0\/20/);
});
