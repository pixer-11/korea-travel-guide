// wa-social-alarm unit tests — the alarm's whole job is one HTTP POST, so what
// we pin down is the request shape GitHub actually requires (a missing
// User-Agent is a 403, an unpinned API version silently drifts), the failure
// paths (non-2xx must alert AND surface, a thrown fetch must count as failure),
// and — after the 2026-08-29 Codex review — the real default handlers: a cron
// dispatch failure must REJECT (so Cloudflare records it) and /fire must
// demand POST + Bearer auth and answer 502 when GitHub said no.
//
// These tests pass an explicit target list. Since 2026-08-31 the alarm wakes
// three workflows on four crons, and letting the default fan out here would
// turn every "one call" assertion into arithmetic about the roster — which is
// cron-targets.test.mjs's job, not this file's. What is under test here is the
// shape of a single dispatch and what happens when it fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { fireDispatches, alertFailures } from './worker.mjs';

const ONE = ['threads-daily.yml'];
// 같은 재시도 횟수, 기다림만 0 — 지연 '값'은 이 테스트의 주장이 아니다.
const FAST = [0, 0];

const env = {
  GH_DISPATCH_TOKEN: 'tok',
  TELEGRAM_BOT_TOKEN: 'tg',
  TELEGRAM_CHAT_ID: '42',
};

async function withGlobalFetch(stub, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test('dispatch request has the shape GitHub requires', async () => {
  const calls = [];
  const results = await fireDispatches(env, async (url, init) => {
    calls.push({ url, init });
    return { status: 204 };
  }, ONE);
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.match(url, /\/repos\/pixer-11\/korea-travel-guide\/actions\/workflows\/threads-daily\.yml\/dispatches$/);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer tok');
  assert.ok(init.headers['User-Agent'], 'GitHub rejects requests without a User-Agent');
  assert.equal(init.headers.Accept, 'application/vnd.github+json');
  assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28', 'unpinned requests follow a moving default');
  assert.equal(JSON.parse(init.body).ref, 'main');
  assert.deepEqual(results.map((r) => r.ok), [true]);
});

test('200 with run details also counts as success (newer API versions)', async () => {
  const results = await fireDispatches(env, async () => ({ status: 200, ok: true }), ONE);
  assert.equal(results[0].ok, true);
});

test('non-2xx is a failure and alerts Telegram in Korean', async () => {
  const results = await fireDispatches(env, async () => ({ status: 401, ok: false }), ONE);
  assert.equal(results[0].ok, false);
  const sent = [];
  const failed = await alertFailures(env, results, async (url, init) => {
    sent.push({ url, init });
    return { status: 200 };
  });
  assert.equal(failed.length, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /api\.telegram\.org\/bottg\/sendMessage$/);
  const body = JSON.parse(sent[0].init.body);
  assert.equal(body.chat_id, '42');
  assert.match(body.text, /알람시계/);
  assert.match(body.text, /HTTP 401/);
});

test('204 stays silent — no Telegram call', async () => {
  const results = await fireDispatches(env, async () => ({ status: 204 }), ONE);
  const failed = await alertFailures(env, results, async () => {
    throw new Error('must not be called on success');
  });
  assert.equal(failed.length, 0);
});

test('a thrown fetch becomes a failure result, not a crash', async () => {
  const results = await fireDispatches(env, async () => {
    throw new Error('network down');
  }, ONE, FAST);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, -1);
});

// The alert channel went live on 2026-09-01. Until then alertFailures returned
// before the send, so a Telegram outage could not reach scheduled(); with the
// secrets set it can, and an unguarded throw there would replace the one line
// Cloudflare's cron history keeps with a fetch error about Telegram.
test('a dead Telegram cannot overwrite the dispatch error in cron history', async () => {
  const stub = async (url) => {
    if (String(url).includes('api.telegram.org')) throw new Error('telegram down');
    return { status: 401, ok: false };
  };
  await withGlobalFetch(stub, async () => {
    await assert.rejects(
      worker.scheduled({ cron: '30 22 * * *' }, env, { waitUntil() {} }),
      /dispatch failed: threads-daily\.yml=401/,
    );
  });
});

test('a refused alert is logged, not thrown — the dispatch failure still stands', async () => {
  const results = await fireDispatches(env, async () => ({ status: 401, ok: false }), ONE);
  const failed = await alertFailures(env, results, async () => ({ status: 400, ok: false }));
  assert.equal(failed.length, 1);
});

test('alert survives missing Telegram secrets (bootstrap window)', async () => {
  const bare = { GH_DISPATCH_TOKEN: 'tok' };
  const results = await fireDispatches(bare, async () => ({ status: 500, ok: false }), ONE);
  const failed = await alertFailures(bare, results, async () => {
    throw new Error('must not attempt Telegram without secrets');
  });
  assert.equal(failed.length, 1);
});

test('scheduled rejects when a dispatch fails — Cloudflare must record it', async () => {
  await withGlobalFetch(async () => ({ status: 401, ok: false }), async () => {
    await assert.rejects(
      worker.scheduled({ cron: '30 22 * * *' }, { GH_DISPATCH_TOKEN: 'tok' }, { waitUntil() {} }),
      /dispatch failed: threads-daily\.yml=401/,
    );
  });
});

test('scheduled resolves quietly on success', async () => {
  await withGlobalFetch(async () => ({ status: 204 }), async () => {
    await worker.scheduled({ cron: '30 22 * * *' }, { GH_DISPATCH_TOKEN: 'tok' }, { waitUntil() {} });
  });
});

test('each cron wakes only what it is for — the publish slot does not post to Threads', async () => {
  const fired = [];
  await withGlobalFetch(async (url) => {
    fired.push(url.split('/workflows/')[1].split('/')[0]);
    return { status: 204 };
  }, async () => {
    await worker.scheduled({ cron: '35 10 * * *' }, { GH_DISPATCH_TOKEN: 'tok' }, { waitUntil() {} });
  });
  assert.deepEqual(fired, ['publish-watchdog.yml']);
});

test('/fire refuses GET, query-string keys, and wrong bearer tokens', async () => {
  const envF = { GH_DISPATCH_TOKEN: 'tok', FIRE_KEY: 'k' };
  await withGlobalFetch(async () => {
    throw new Error('must not dispatch when refused');
  }, async () => {
    const get = await worker.fetch(new Request('https://x/fire?key=k'), envF);
    assert.equal(get.status, 403);
    const wrong = await worker.fetch(
      new Request('https://x/fire', { method: 'POST', headers: { Authorization: 'Bearer nope' } }),
      envF,
    );
    assert.equal(wrong.status, 403);
    const noKey = await worker.fetch(
      new Request('https://x/fire', { method: 'POST', headers: { Authorization: 'Bearer k' } }),
      { GH_DISPATCH_TOKEN: 'tok' }, // FIRE_KEY unset — must fail closed
    );
    assert.equal(noKey.status, 403);
  });
});

test('/fire with the right bearer fires: 200 when GitHub accepts, 502 when it refuses', async () => {
  const envF = { GH_DISPATCH_TOKEN: 'tok', FIRE_KEY: 'k' };
  const authed = new Request('https://x/fire', {
    method: 'POST',
    headers: { Authorization: 'Bearer k' },
  });
  await withGlobalFetch(async () => ({ status: 204 }), async () => {
    const res = await worker.fetch(authed.clone(), envF);
    assert.equal(res.status, 200);
    assert.equal((await res.json())[0].ok, true);
  });
  await withGlobalFetch(async () => ({ status: 401, ok: false }), async () => {
    const res = await worker.fetch(authed.clone(), envF);
    assert.equal(res.status, 502);
  });
});

test('root stays a harmless status line', async () => {
  const res = await worker.fetch(new Request('https://x/'), { FIRE_KEY: 'k' });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /wa-social-alarm/);
});

// ── retry (2026-08-31) ────────────────────────────────────────────────
// The alarm became load-bearing the day it started waking the watchdogs, and
// that same day one wake-up left no run at all. These pin the retry to the
// distinction that matters: transient failures deserve another try, permanent
// ones do not, and a success must not cost a second dispatch.

test('a 5xx is retried and can still succeed', async () => {
  let n = 0;
  const results = await fireDispatches(env, async () => {
    n++;
    return n < 3 ? { status: 502, ok: false } : { status: 204 };
  }, ONE, FAST);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].attempts, 3);
});

test('a 4xx is NOT retried — a bad token answers the same way forever', async () => {
  let n = 0;
  const results = await fireDispatches(env, async () => { n++; return { status: 401, ok: false }; }, ONE, FAST);
  assert.equal(results[0].ok, false);
  assert.equal(n, 1, 'retrying a 401 only hides the cause');
});

test('a network throw is retried, then gives up honestly', async () => {
  let n = 0;
  const results = await fireDispatches(env, async () => { n++; throw new Error('down'); }, ONE, FAST);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, -1);
  assert.equal(n, 3, 'three attempts: the first plus two backoffs');
});

test('success costs exactly one dispatch — no duplicate wake-ups', async () => {
  let n = 0;
  const results = await fireDispatches(env, async () => { n++; return { status: 204 }; }, ONE, FAST);
  assert.equal(n, 1);
  assert.equal(results[0].attempts, 1);
});
