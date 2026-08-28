// whenToGo()의 이벤트 글 연결 회귀 테스트.
//
// 2026-08-28 감사(D·코덱스 교차검증 공통 지적): 월별 여행시기 페이지의 축제
// 이름이 일반 텍스트였고, 그 축제를 다룬 이벤트 글 130편(최고 성적 카테고리)
// 과 서로 연결이 없었다 — 1,020페이지 링크 섬의 절반. whenToGo()가 이미 posts
// 컬렉션을 받으므로, 나라+월이 맞는 이벤트 글을 골라 돌려주면 페이지가 링크를
// 렌더링할 수 있다. 끝난 단발성 이벤트는 noindex라 링크하지 않는다.
//
//   node --test src/lib/when-to-go-events.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whenToGo } from './when-to-go.mjs';

const NOW = Date.parse('2026-08-28T00:00:00Z');
const climate = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, hi: 20 + i, lo: 10, rain: 50 }));
const FACTS = { Japan: { climate, holidays: [] } };

const post = (id, data) => ({ id, data: { title: id, region: 'Tokyo', ...data } });
const run = (posts) => whenToGo('Japan', 10, { countryFacts: FACTS, posts, now: NOW });

test('나라와 달이 맞는 미래 이벤트 글이 eventPosts로 나온다', () => {
  const d = run([
    post('tokyo-jazz-festival-oct', { category: 'event', country: 'Japan', eventStartDate: '2026-10-10' }),
    post('tokyo-cafe', { category: 'trendy', country: 'Japan' }),
  ]);
  assert.equal(d.eventPosts.length, 1);
  assert.equal(d.eventPosts[0].id, 'tokyo-jazz-festival-oct');
});

test('다른 나라·다른 달·초안은 나오지 않는다', () => {
  const d = run([
    post('seoul-fest', { category: 'event', country: 'South Korea', eventStartDate: '2026-10-01' }),
    post('tokyo-sep', { category: 'event', country: 'Japan', eventStartDate: '2026-09-01' }),
    post('tokyo-draft', { category: 'event', country: 'Japan', eventStartDate: '2026-10-05', draft: true }),
  ]);
  assert.equal(d.eventPosts.length, 0);
});

test('끝난 단발성 이벤트는 링크하지 않는다 (noindex 페이지) — 반복 이벤트는 남는다', () => {
  const d = run([
    post('ended-oneoff', { category: 'event', country: 'Japan', eventStartDate: '2025-10-03' }),
    post('annual-matsuri', { category: 'event', country: 'Japan', eventStartDate: '2025-10-20', eventRecurring: true }),
  ]);
  assert.deepEqual(d.eventPosts.map((p) => p.id), ['annual-matsuri']);
});

test('시작일 순으로 정렬된다', () => {
  const d = run([
    post('late', { category: 'event', country: 'Japan', eventStartDate: '2026-10-25' }),
    post('early', { category: 'event', country: 'Japan', eventStartDate: '2026-10-02' }),
  ]);
  assert.deepEqual(d.eventPosts.map((p) => p.id), ['early', 'late']);
});
