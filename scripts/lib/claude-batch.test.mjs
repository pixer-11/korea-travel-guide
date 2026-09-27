// runBatch must never cost a page: whatever it cannot return, the caller
// translates directly. These pin the three ways a batch ends.
//   node --test scripts/lib/claude-batch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBatch } from './claude-batch.mjs';
import { meterTally } from './claude-meter.mjs';

const msg = (text) => ({
  type: 'message', model: 'claude-sonnet-5', content: [{ type: 'text', text }],
  usage: { input_tokens: 1000, output_tokens: 1000 },
});

function fakeClient({ endAfter = 1, results = [], fail = false } = {}) {
  let polls = 0;
  const calls = { created: null, cancelled: false };
  const batch = (status) => ({ id: 'b1', processing_status: status, request_counts: {} });
  return {
    calls,
    beta: { messages: { batches: {
      async create(p) { if (fail) throw new Error('boom'); calls.created = p; return batch('in_progress'); },
      async retrieve() { polls += 1; return batch(calls.cancelled || polls >= endAfter ? 'ended' : 'in_progress'); },
      async cancel() { calls.cancelled = true; return batch('canceling'); },
      async results() { return (async function* () { yield* results; })(); },
    } } },
  };
}

const items = [
  { id: 'ko/a-very-long-slug', params: { model: 'claude-sonnet-5' } },
  { id: 'ja/a-very-long-slug', params: { model: 'claude-sonnet-5' } },
  { id: 'es/other', params: { model: 'claude-sonnet-5' } },
];
const quiet = { log: () => {}, pollSec: 0 };

test('returns succeeded results keyed by the caller ids, skips the rest', async () => {
  const c = fakeClient({ results: [
    { custom_id: 'r0', result: { type: 'succeeded', message: msg('ko') } },
    { custom_id: 'r1', result: { type: 'errored', error: {} } },
    { custom_id: 'r2', result: { type: 'expired' } },
  ] });
  const got = await runBatch(c, items, quiet);
  assert.deepEqual([...got.keys()], ['ko/a-very-long-slug']);
  assert.equal(got.get('ko/a-very-long-slug').content[0].text, 'ko');
  // custom_id stays inside the API's [A-Za-z0-9_-]{1,64} whatever the slug is
  assert.deepEqual(c.calls.created.requests.map((r) => r.custom_id), ['r0', 'r1', 'r2']);
  assert.equal(c.calls.cancelled, false);
});

test('a batch past its wait is cancelled, and what did succeed is still used', async () => {
  const c = fakeClient({ endAfter: 1e9, results: [
    { custom_id: 'r2', result: { type: 'succeeded', message: msg('es') } },
    { custom_id: 'r0', result: { type: 'canceled' } },
  ] });
  const got = await runBatch(c, items, { ...quiet, waitMin: 0 });
  assert.equal(c.calls.cancelled, true);
  assert.deepEqual([...got.keys()], ['es/other']);
});

test('a failure never throws — the caller just goes direct', async () => {
  const got = await runBatch(fakeClient({ fail: true }), items, quiet);
  assert.equal(got.size, 0);
  assert.equal((await runBatch(fakeClient(), [], quiet)).size, 0);
});

test('a batch that breaks while waiting is cancelled, not left to bill twice', async () => {
  const c = fakeClient();
  c.beta.messages.batches.retrieve = async () => { throw new Error('network'); };
  const got = await runBatch(c, items, quiet);
  assert.equal(got.size, 0);
  assert.equal(c.calls.cancelled, true);
});

test('batch results are booked at half price', async () => {
  const before = meterTally()['claude-sonnet-5']?.usd || 0;
  await runBatch(fakeClient({ results: [{ custom_id: 'r0', result: { type: 'succeeded', message: msg('x') } }] }), items, quiet);
  const added = (meterTally()['claude-sonnet-5']?.usd || 0) - before;
  // 1000 in @ $2/M + 1000 out @ $10/M = $0.012 direct → $0.006 in a batch
  assert.ok(Math.abs(added - 0.006) < 1e-9, `booked ${added}`);
});
