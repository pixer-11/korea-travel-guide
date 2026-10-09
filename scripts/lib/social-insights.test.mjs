import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordPublished, parseInsights, dueForMeasurement, collectSocialInsights, insightsLines, summarizeInsights,
  MAX_PER_RUN, HISTORY_CAP,
} from './social-insights.mjs';

test('recordPublished keeps one row per day+slug and fills in the second channel later', () => {
  const social = {};
  recordPublished(social, { day: '2026-10-09', slug: 'a', thId: 't1' });
  recordPublished(social, { day: '2026-10-09', slug: 'a', igId: 'i1' });
  assert.deepEqual(social.history, [{ day: '2026-10-09', slug: 'a', thId: 't1', igId: 'i1' }]);
});

test('history is capped so the state file does not grow forever', () => {
  const social = {};
  for (let i = 0; i < HISTORY_CAP + 20; i++) recordPublished(social, { day: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, slug: `s${i}`, thId: 'x' });
  assert.equal(social.history.length, HISTORY_CAP);
  assert.equal(social.history.at(-1).slug, `s${HISTORY_CAP + 19}`);
});

test('parseInsights reads both value shapes Meta uses and ignores junk', () => {
  const body = { data: [
    { name: 'views', values: [{ value: 120 }] },
    { name: 'likes', total_value: { value: 7 } },
    { name: 'weird', values: [{ value: 'n/a' }] },
    { values: [{ value: 1 }] },
  ] };
  assert.deepEqual(parseInsights(body), { views: 120, likes: 7 });
  assert.deepEqual(parseInsights({}), {});
});

test('only posts seven or more days old, unmeasured, oldest first, capped per run', () => {
  const history = [
    { day: '2026-10-01', slug: 'old', thId: 't' },
    { day: '2026-10-02', slug: 'old2', thId: 't' },
    { day: '2026-10-02', slug: 'done', thId: 't', insights: {} },
    { day: '2026-10-05', slug: 'young', thId: 't' },
    { day: '2026-10-01', slug: 'noids' },
  ];
  const due = dueForMeasurement(history, '2026-10-09');
  assert.deepEqual(due.map((h) => h.slug), ['old', 'old2']);
  const many = Array.from({ length: 20 }, (_, i) => ({ day: '2026-09-01', slug: `s${i}`, igId: 'i' }));
  assert.equal(dueForMeasurement(many, '2026-10-09').length, MAX_PER_RUN);
});

test('collect: falls back to a plainer metric list when Meta rejects the rich one, and never throws', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const metric = u.searchParams.get('metric');
    if (u.hostname === 'graph.threads.net') {
      if (metric.includes('quotes')) return { ok: false, json: async () => ({ error: { code: 100, message: 'unknown metric' } }) };
      return { ok: true, json: async () => ({ data: [{ name: 'views', values: [{ value: 55 }] }, { name: 'likes', values: [{ value: 3 }] }] }) };
    }
    // Instagram: token dead → stop asking after the first refusal.
    return { ok: false, json: async () => ({ error: { code: 190, message: 'token expired' } }) };
  };
  const social = { history: [{ day: '2026-10-01', slug: 'a', thId: 'T', igId: 'I' }] };
  const tokens = { th: { token: 'th' }, ig: { token: 'ig' } };
  const measured = await collectSocialInsights(social, tokens, { today: '2026-10-09', fetchImpl, log: () => {} });
  assert.equal(measured.length, 1);
  assert.deepEqual(social.history[0].insights.th, { views: 55, likes: 3 });
  assert.match(social.history[0].insights.ig.error, /190|token/);
  const igCalls = calls.filter((c) => c.includes('graph.instagram.com'));
  assert.equal(igCalls.length, 1, 'a dead token is asked once, not per metric list');
  assert.equal(insightsLines(measured)[0], '📊 2026-10-01 a 7일 성과 — 스레드 조회 55 · 좋아요 3');
});

test('collect: when nothing can be read the post stays unmeasured for tomorrow, with the error kept', async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({ error: { code: 2, message: 'transient' } }) });
  const social = { history: [{ day: '2026-10-01', slug: 'a', thId: 'T' }] };
  const measured = await collectSocialInsights(social, { th: { token: 'x' } }, { today: '2026-10-09', fetchImpl, log: () => {} });
  assert.equal(measured.length, 0);
  assert.equal(social.history[0].insights, undefined);
  assert.match(social.history[0].lastInsightsError, /transient/);
});

test('collect: a fetch that throws is absorbed', async () => {
  const fetchImpl = async () => { throw new Error('network down'); };
  const social = { history: [{ day: '2026-10-01', slug: 'a', thId: 'T' }] };
  const measured = await collectSocialInsights(social, { th: { token: 'x' } }, { today: '2026-10-09', fetchImpl, log: () => {} });
  assert.equal(measured.length, 0);
});

test('summarizeInsights totals the measured posts only', () => {
  const history = [
    { day: 'd', slug: 'a', insights: { th: { views: 10, likes: 1 }, ig: { reach: 100, saved: 2 } } },
    { day: 'd', slug: 'b', insights: { th: { views: 5 } } },
    { day: 'd', slug: 'c' },
  ];
  assert.deepEqual(summarizeInsights(history), { posts: 2, thViews: 15, thLikes: 1, igReach: 100, igSaved: 2 });
});
