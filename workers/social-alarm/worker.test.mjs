// wa-social-alarm unit tests — the alarm's whole job is one HTTP POST, so what
// we pin down is the request shape GitHub actually requires (a missing
// User-Agent is a 403, a wrong Accept is silent weirdness) and the failure
// paths: non-204 must alert, 204 must stay silent, and a thrown fetch must
// count as a failure instead of killing the cron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fireDispatches, alertFailures } from './worker.mjs';

const env = {
  GH_DISPATCH_TOKEN: 'tok',
  TELEGRAM_BOT_TOKEN: 'tg',
  TELEGRAM_CHAT_ID: '42',
};

test('dispatch request has the shape GitHub requires', async () => {
  const calls = [];
  const results = await fireDispatches(env, async (url, init) => {
    calls.push({ url, init });
    return { status: 204 };
  });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.match(url, /\/repos\/pixer-11\/korea-travel-guide\/actions\/workflows\/threads-daily\.yml\/dispatches$/);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer tok');
  assert.ok(init.headers['User-Agent'], 'GitHub rejects requests without a User-Agent');
  assert.equal(JSON.parse(init.body).ref, 'main');
  assert.deepEqual(results.map((r) => r.ok), [true]);
});

test('non-204 is a failure and alerts Telegram in Korean', async () => {
  const results = await fireDispatches(env, async () => ({ status: 401 }));
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
  const results = await fireDispatches(env, async () => ({ status: 204 }));
  const failed = await alertFailures(env, results, async () => {
    throw new Error('must not be called on success');
  });
  assert.equal(failed.length, 0);
});

test('a thrown fetch becomes a failure result, not a crash', async () => {
  const results = await fireDispatches(env, async () => {
    throw new Error('network down');
  });
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, -1);
});

test('alert survives missing Telegram secrets (bootstrap window)', async () => {
  const bare = { GH_DISPATCH_TOKEN: 'tok' };
  const results = await fireDispatches(bare, async () => ({ status: 500 }));
  const failed = await alertFailures(bare, results, async () => {
    throw new Error('must not attempt Telegram without secrets');
  });
  assert.equal(failed.length, 1);
});
