import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { bingSubmitPool, pickBingSubmissions, getSubmissionQuota, submitUrlBatch, loadPostsForBing, MAX_PER_RUN, SITE } from './bing-submit.mjs';

const posts = [
  { slug: 'ev-soon', category: 'event', pubDate: '2026-09-20', eventStartDate: '2026-10-15', langs: ['en', 'ja', 'ko'] },
  { slug: 'ev-over', category: 'event', pubDate: '2026-09-01', eventStartDate: '2026-09-15', langs: ['en', 'ja'] },
  { slug: 'new-a', category: 'attraction', pubDate: '2026-10-08', eventStartDate: '', langs: ['en', 'ja', 'zh', 'es', 'ko'] },
  { slug: 'old-b', category: 'restaurant', pubDate: '2026-07-01', eventStartDate: '', langs: ['en'] },
];

test('pool: soon events (en then ja), then every ja post, then en, then zh/es/ko; ended events dropped', () => {
  const pool = bingSubmitPool(posts, '2026-10-10');
  assert.deepEqual(pool, [
    `${SITE}posts/ev-soon/`, `${SITE}ja/posts/ev-soon/`,
    `${SITE}ja/posts/new-a/`,
    `${SITE}posts/new-a/`, `${SITE}posts/old-b/`,
    `${SITE}zh/posts/new-a/`, `${SITE}es/posts/new-a/`,
    `${SITE}ko/posts/new-a/`, `${SITE}ko/posts/ev-soon/`,
  ]);
});

test('pick: bounded by quota and MAX_PER_RUN, zero quota means nothing, rotates by day', () => {
  assert.deepEqual(pickBingSubmissions(posts, '2026-10-10', 0), []);
  assert.equal(pickBingSubmissions(posts, '2026-10-10', 3).length, 3);
  const many = Array.from({ length: 350 }, (_, i) => ({ slug: `p${String(i).padStart(3, '0')}`, category: 'attraction', pubDate: '2026-09-01', eventStartDate: '', langs: ['en'] }));
  const d1 = pickBingSubmissions(many, '2026-10-10', 1000);
  const d2 = pickBingSubmissions(many, '2026-10-11', 1000);
  assert.equal(d1.length, MAX_PER_RUN);
  assert.equal(new Set([...d1, ...d2]).size, 2 * MAX_PER_RUN);
});

test('quota and batch calls use Bing\'s shapes', async () => {
  const q = await getSubmissionQuota('k', async (url) => {
    assert.match(url, /GetUrlSubmissionQuota\?siteUrl=.*apikey=k$/);
    return { ok: true, json: async () => ({ d: { DailyQuota: 100, MonthlyQuota: 2200 } }) };
  });
  assert.deepEqual(q, { daily: 100, monthly: 2200 });
  let sent;
  const n = await submitUrlBatch('k', ['https://wanderatlasguides.com/posts/a/'], async (url, init) => {
    assert.match(url, /SubmitUrlBatch\?apikey=k$/);
    sent = JSON.parse(init.body);
    return { ok: true, text: async () => '{"d":null}' };
  });
  assert.equal(n, 1);
  assert.deepEqual(sent, { siteUrl: SITE, urlList: ['https://wanderatlasguides.com/posts/a/'] });
  await assert.rejects(submitUrlBatch('k', ['x'], async () => ({ ok: false, status: 400, text: async () => 'bad' })), /HTTP 400 bad/);
});

test('loader reads the real content tree and finds Japanese translations', () => {
  const all = loadPostsForBing(fileURLToPath(new URL('../../src/content/', import.meta.url)));
  assert.ok(all.length > 2000);
  const p = all.find((x) => x.slug === 'incheon-wolmi-theme-park');
  assert.ok(p && p.langs.includes('ja') && p.langs.includes('en'));
  const pool = bingSubmitPool(all, '2026-10-10');
  assert.ok(pool.length > 10000, 'five languages of live posts');
});
