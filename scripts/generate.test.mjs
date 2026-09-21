// Unit test for the itinerary-gate boost in buildRotatedQueue() (see the
// "// Itinerary-gate boost:" comment in scripts/generate.mjs). Exercises the
// same pure queue-building function main() calls, with hand-built inputs
// instead of real content/API calls — buildRotatedQueue takes no IO itself,
// so it is a genuine testable seam (exported for exactly this purpose).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRotatedQueue, postTopicKey } from './generate.mjs';

test('itinerary-gate boost pulls a region near the 12-post gate ahead of a region far from it', () => {
  // Both targets use a category OUTSIDE the near-roundup boost's set
  // (attraction/restaurant/trendy/hidden-gem), and regionCatCounts is left
  // empty, so the near-roundup boost can't interfere — only the itinerary-gate
  // boost can move these two relative to each other.
  const targets = [
    { query: 'small city museum', region: 'SmallCity', category: 'museum', country: 'Testland' },
    { query: 'gate city museum', region: 'GateCity', category: 'museum', country: 'Testland' },
  ];
  const countries = [{ name: 'Testland', regions: [], priority: 1 }];
  const done = new Set();

  // Baseline (no regionQualifyingCounts passed, defaults to an empty Map): with
  // no boost active, insertion order is preserved (SmallCity was listed first
  // above) — this is the control that proves the boost below is what moves it.
  const baseline = buildRotatedQueue(targets, done, countries, []);
  const baseSmallIdx = baseline.findIndex((t) => t.region === 'SmallCity');
  const baseGateIdx = baseline.findIndex((t) => t.region === 'GateCity');
  assert.ok(baseSmallIdx < baseGateIdx, 'sanity check: without the boost, SmallCity (listed first) sorts ahead of GateCity');

  // GateCity sits at 10 qualifying posts — inside the 9-11 near-gate window
  // (gateFor's 3-day threshold is 12). SmallCity sits at 3 — nowhere close.
  const regionQualifyingCounts = new Map([
    ['GateCity', 10],
    ['SmallCity', 3],
  ]);
  const boostedQueue = buildRotatedQueue(targets, done, countries, [], { regionQualifyingCounts });
  const gateIdx = boostedQueue.findIndex((t) => t.region === 'GateCity');
  const smallIdx = boostedQueue.findIndex((t) => t.region === 'SmallCity');

  assert.ok(gateIdx !== -1 && smallIdx !== -1, 'both targets should still be present in the queue');
  assert.ok(gateIdx < smallIdx, `a 10-qualifying-post region should sort ahead of a 3-post region once the itinerary-gate boost is active (gateIdx=${gateIdx}, smallIdx=${smallIdx})`);
});

test('itinerary-gate boost does not affect a region outside the 9-11 / 21-23 windows', () => {
  const targets = [
    { query: 'small city museum', region: 'SmallCity', category: 'museum', country: 'Testland' },
    { query: 'big city museum', region: 'BigCity', category: 'museum', country: 'Testland' },
  ];
  const countries = [{ name: 'Testland', regions: [], priority: 1 }];
  const done = new Set();

  // Neither 2 nor 30 falls in [9,11] or [21,23], so this should behave exactly
  // like the no-boost baseline: original (insertion) order preserved.
  const regionQualifyingCounts = new Map([
    ['BigCity', 30],
    ['SmallCity', 2],
  ]);
  const queue = buildRotatedQueue(targets, done, countries, [], { regionQualifyingCounts });
  const smallIdx = queue.findIndex((t) => t.region === 'SmallCity');
  const bigIdx = queue.findIndex((t) => t.region === 'BigCity');
  assert.ok(smallIdx < bigIdx, 'neither region is near a gate, so insertion order (SmallCity first) should be unchanged');
});

// ── postTopicKey: the retirement-proof duplicate layer ──
// The place.id and slug de-dupes read files on disk, so retiring a duplicate
// (delete + 301) made its landmark look uncovered — the bulk fill rebuilt
// "Lijiang Old Town" on 2026-08-14, two days after 8e62a0a1 retired it. These
// pin the collapse with the REAL twin frontmatters from that incident, and the
// reverse direction (two genuinely different places in one city must NOT
// collapse), since an over-matching key would silently skip real guides.
test('postTopicKey collapses the Lijiang word-order twins to one key', () => {
  const kept = 'title: "Old Town of Lijiang: Travel Guide (4.6★)"\nregion: "Lijiang"\n';
  const twin = 'title: "Lijiang Old Town: Travel Guide (4.6★)"\nregion: "Lijiang"\n';
  const a = postTopicKey(kept);
  assert.ok(a, 'key must parse from frontmatter');
  assert.equal(a, postTopicKey(twin), 'word-order twins of one landmark must collapse');
});

test('postTopicKey keeps two different places in the same city apart', () => {
  const oldTown = 'title: "Old Town of Lijiang: Travel Guide (4.6★)"\nregion: "Lijiang"\n';
  const pool = 'title: "Black Dragon Pool Park: Travel Guide (4.5★)"\nregion: "Lijiang"\n';
  assert.notEqual(postTopicKey(oldTown), postTopicKey(pool), 'different landmarks must keep distinct keys');
});

test('postTopicKey returns null when frontmatter has no title', () => {
  assert.equal(postTopicKey('region: "Lijiang"\n'), null);
});

test('barren-region penalty: a 0-post city that has already burned queries yields to a 1-post city that has not', () => {
  // Uzbekistan 2026-08-18: Nukus (0 posts, several retired queries) was asked
  // before Samarkand (1 post, nothing retired) on every run, and failed every
  // run. Ordering by ATTEMPTS instead of posts fixes that.
  const targets = [
    { query: 'nukus museum', region: 'Nukus', category: 'museum', country: 'Testland' },
    { query: 'samarkand museum', region: 'Samarkand', category: 'museum', country: 'Testland' },
  ];
  const countries = [{ name: 'Testland', regions: [], priority: 1 }];
  const regionCatCounts = new Map([['Samarkand|attraction', 1]]);

  // Control: nothing retired for Nukus → 0 posts still goes first.
  const control = buildRotatedQueue(targets, new Set(), countries, [], { regionCatCounts });
  assert.ok(control.findIndex((t) => t.region === 'Nukus') < control.findIndex((t) => t.region === 'Samarkand'));

  // Three Nukus queries already spent (curated ones, so `targets` carries them
  // as done): Nukus attempts = 3, Samarkand attempts = 1 → Samarkand first.
  const spent = ['nukus a', 'nukus b', 'nukus c'].map((q) => ({ query: q, region: 'Nukus', category: 'museum', country: 'Testland' }));
  const done = new Set(spent.map((t) => t.query));
  const q = buildRotatedQueue([...spent, ...targets], done, countries, [], { regionCatCounts });
  assert.ok(q.findIndex((t) => t.region === 'Samarkand') < q.findIndex((t) => t.region === 'Nukus'),
    'a city that has eaten three queries without a post must wait behind a city asked once that delivered');
});

import { hasBodyDisclosure } from './lib/body-disclosure.mjs';
import { readFileSync } from 'node:fs';

test('generate.mjs no longer prepends the in-body AI disclosure', () => {
  // The localized <details> in PostArticle.astro is the single source. Two
  // copies on one page is what the 08-31 audit found on 922 live guides.
  const src = readFileSync(new URL('./generate.mjs', import.meta.url), 'utf8');
  assert.equal(/How this guide was made/.test(src), false);
});

test('hasBodyDisclosure still recognises the legacy line', () => {
  // Guards the sweep: if the detector ever stops matching, the corpus check
  // below goes quietly green on a corpus that still has 922 of them.
  assert.equal(hasBodyDisclosure('> **How this guide was made:** x [editorial policy](/about).\n'), true);
});

// ── 도시 지정 (2026-09-21) ──────────────────────────────────
// 5일 일정표 문턱은 도시당 적격 글 24개인데, 오늘 그걸 넘은 도시가 0곳이다
// (방콕 20 · 서울 20). 글은 매달 400편 가까이 느는데 최근 30일 신규 397편이
// 192개 도시로 흩어졌고 서울·방콕에 간 건 5편뿐이었다 — 넓이는 늘고 깊이는
// 제자리다. 국가 단위로만 겨냥할 수 있었던 게 원인이라, 도시 필터를 넣었다.
test('CITY 를 주면 그 도시의 타깃만 남는다', () => {
  const targets = [
    { region: 'Seoul', query: 'a', category: 'attraction', country: 'South Korea' },
    { region: 'Busan', query: 'b', category: 'attraction', country: 'South Korea' },
    { region: 'Seoul', query: 'c', category: 'restaurant', country: 'South Korea' },
  ];
  const countries = [{ name: 'South Korea', slug: 'south-korea', active: true, regions: ['Seoul', 'Busan'] }];
  const q = buildRotatedQueue(targets, new Set(), countries, [], { onlyRegion: 'Seoul' });
  assert.equal(q.length > 0, true, '서울 타깃이 하나도 안 남았다');
  assert.equal(q.every((t) => t.region === 'Seoul'), true, '다른 도시가 섞였다');
});

test('대소문자와 앞뒤 공백은 무시한다', () => {
  const targets = [{ region: 'Seoul', query: 'a', category: 'attraction', country: 'South Korea' }];
  const countries = [{ name: 'South Korea', slug: 'south-korea', active: true, regions: ['Seoul'] }];
  assert.equal(buildRotatedQueue(targets, new Set(), countries, [], { onlyRegion: '  seoul ' }).length > 0, true);
});

test('CITY 가 없으면 종전과 똑같이 전부 돈다 — 기본 동작을 바꾸지 않는다', () => {
  const targets = [
    { region: 'Seoul', query: 'a', category: 'attraction', country: 'South Korea' },
    { region: 'Busan', query: 'b', category: 'attraction', country: 'South Korea' },
  ];
  const countries = [{ name: 'South Korea', slug: 'south-korea', active: true, regions: ['Seoul', 'Busan'] }];
  const all = buildRotatedQueue(targets, new Set(), countries, []);
  assert.equal(new Set(all.map((t) => t.region)).size, 2, '도시 지정이 없는데 한 도시로 좁혀졌다');
});

test('없는 도시를 주면 빈 큐 — 조용히 전부 돌지 않는다', () => {
  const targets = [{ region: 'Seoul', query: 'a', category: 'attraction', country: 'South Korea' }];
  const countries = [{ name: 'South Korea', slug: 'south-korea', active: true, regions: ['Seoul'] }];
  assert.equal(buildRotatedQueue(targets, new Set(), countries, [], { onlyRegion: 'Atlantis' }).length, 0);
});

// 배선까지 고정한다. 기능만 있고 워크플로가 안 넘기면 손으로 못 쓴다 —
// 08주간 "선행 과제"로만 적혀 있던 게 정확히 이 모양이었다.
test('publish 워크플로가 city 입력을 받아 CITY 로 넘긴다', async () => {
  const { readFileSync } = await import('node:fs');
  const yaml = (await import('js-yaml')).default;
  const raw = readFileSync('.github/workflows/publish.yml', 'utf8');
  const doc = yaml.load(raw);
  assert.ok(doc.on.workflow_dispatch.inputs.city, 'dispatch 에 city 입력이 없다');
  assert.ok(doc.on.workflow_call.inputs.city, 'call 에 city 입력이 없다');
  const passes = raw.match(/CITY: \$\{\{ inputs\.city \}\}/g) || [];
  assert.equal(passes.length, 2, `CITY 를 넘기는 자리가 ${passes.length}곳 — COUNTRY 와 같은 2곳이어야 한다`);
});
