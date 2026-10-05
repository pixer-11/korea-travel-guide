// node --test worker/quarantine.test.mjs
// The worker's quarantine rescue (2026-10-05): a held post's URL, which has no
// page, 302s to its region hub from dist/quarantine-redirects.json — in every
// language, with or without the slash — and nothing else changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';

const TABLE = { 'seoul-held-cafe': 'seoul', 'nowhere-held': '' };
const env = {
  ASSETS: {
    fetch: async (req) => {
      const p = new URL(req.url).pathname;
      if (p === '/quarantine-redirects.json') return new Response(JSON.stringify(TABLE), { status: 200 });
      if (p === '/posts/live-post/') return new Response('page', { status: 200 });
      return new Response('not found', { status: 404 });
    },
  },
};
const get = (path) => worker.fetch(new Request(`https://wanderatlasguides.com${path}`), env);

test('a held post goes to its hub, in every language, slash or not', async () => {
  for (const [path, to] of [
    ['/posts/seoul-held-cafe/', '/regions/seoul/'],
    ['/ko/posts/seoul-held-cafe/', '/ko/regions/seoul/'],
    ['/zh/posts/seoul-held-cafe', '/zh/regions/seoul/'],
    ['/ja/posts/nowhere-held/', '/ja/'],
    ['/posts/nowhere-held/', '/'],
  ]) {
    const r = await get(path);
    assert.equal(r.status, 302, path);
    assert.equal(new URL(r.headers.get('location')).pathname, to, path);
  }
});

test('HEAD gets the same redirect, and the query string travels (Codex, 10-05)', async () => {
  const head = await worker.fetch(new Request('https://wanderatlasguides.com/posts/seoul-held-cafe/', { method: 'HEAD' }), env);
  assert.equal(head.status, 302);
  const q = await get('/ko/posts/seoul-held-cafe/?utm_source=ig&x=1');
  assert.equal(q.headers.get('location'), 'https://wanderatlasguides.com/ko/regions/seoul/?utm_source=ig&x=1');
});

test('the table is read per rescue, so a new deploy is seen without a fresh isolate', async () => {
  let table = { 'a-held': 'seoul' };
  const e2 = { ASSETS: { fetch: async (req) => (new URL(req.url).pathname === '/quarantine-redirects.json' ? new Response(JSON.stringify(table)) : new Response('', { status: 404 })) } };
  const go = (p) => worker.fetch(new Request(`https://wanderatlasguides.com${p}`), e2);
  assert.equal((await go('/posts/a-held/')).status, 302);
  table = { 'b-held': 'busan' };
  assert.equal(new URL((await go('/posts/b-held/')).headers.get('location')).pathname, '/regions/busan/');
  assert.equal((await go('/posts/a-held/')).status, 404, 'released post is no longer redirected');
});

test('live pages, unknown posts and other paths are untouched', async () => {
  assert.equal((await get('/posts/live-post/')).status, 200);
  assert.equal((await get('/posts/never-existed/')).status, 404);
  const slashless = await get('/posts/never-existed');
  assert.equal(slashless.status, 301, 'the old slash fix still runs');
  assert.equal((await get('/regions/nope/')).status, 404);
});
