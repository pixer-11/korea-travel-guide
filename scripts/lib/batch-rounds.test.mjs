import test from 'node:test';
import assert from 'node:assert/strict';
import { Deferred, pool, settleInRounds } from './batch-rounds.mjs';

test('a retry waits for the next round and goes out in that round\'s batch', async () => {
  const batched = [], direct = [];
  // Attempt 1 is refused by a gate and retried; attempt 2 passes.
  const run = async (job, reply) => {
    assert.equal(reply, `reply:${job.id}:${job.attempt}`);
    if (job.attempt < 2) throw new Deferred({ ...job, attempt: job.attempt + 1 });
  };
  const r = await settleInRounds([{ id: 'a', attempt: 1 }, { id: 'b', attempt: 1 }], {
    batch: async (todo) => { batched.push(todo.map((j) => `${j.id}${j.attempt}`)); return new Map(todo.map((j, i) => [i, `reply:${j.id}:${j.attempt}`])); },
    direct: async (job) => { direct.push(job.id); return `reply:${job.id}:${job.attempt}`; },
    run,
  });
  assert.deepEqual(batched, [['a1', 'b1'], ['a2', 'b2']]);
  assert.deepEqual(direct, []);
  assert.deepEqual(r, { done: 2, failed: 0, rounds: 2 });
});

test('what the batch did not return goes direct, so a slow batch never loses a job', async () => {
  const direct = [];
  const r = await settleInRounds([{ id: 'a' }, { id: 'b' }, { id: 'c' }], {
    batch: async () => new Map([[1, 'from-batch']]),
    direct: async (job) => { direct.push(job.id); return 'from-direct'; },
    run: async () => {},
  });
  assert.deepEqual(direct.sort(), ['a', 'c']);
  assert.deepEqual(r, { done: 3, failed: 0, rounds: 1 });
});

test('a real failure is counted once and is not retried by the rounds', async () => {
  const failed = [];
  const r = await settleInRounds([{ id: 'a' }, { id: 'b' }], {
    batch: async () => new Map(),
    direct: async () => 'x',
    run: async (job) => { if (job.id === 'b') throw new Error('stub body after 3 attempts'); },
    onFail: (job, e) => failed.push(`${job.id}: ${e.message}`),
  });
  assert.deepEqual(failed, ['b: stub body after 3 attempts']);
  assert.deepEqual(r, { done: 1, failed: 1, rounds: 1 });
});

test('a direct call that throws is a failure, not a lost job', async () => {
  const r = await settleInRounds([{ id: 'a' }], {
    batch: async () => new Map(),
    direct: async () => { throw new Error('529 overloaded'); },
    run: async () => {},
  });
  assert.deepEqual(r, { done: 0, failed: 1, rounds: 1 });
});

test('nothing deferred: no round, no batch', async () => {
  let calls = 0;
  const r = await settleInRounds([], { batch: async () => { calls++; return new Map(); }, direct: async () => {}, run: async () => {} });
  assert.equal(calls, 0);
  assert.deepEqual(r, { done: 0, failed: 0, rounds: 0 });
});

test('pool visits every item once and never runs more than its concurrency', async () => {
  let live = 0, peak = 0;
  const seen = [];
  await pool([1, 2, 3, 4, 5], 2, async (x, i) => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    seen.push([x, i]);
    live--;
  });
  assert.equal(peak, 2);
  assert.deepEqual(seen.sort((a, b) => a[0] - b[0]), [[1, 0], [2, 1], [3, 2], [4, 3], [5, 4]]);
});
