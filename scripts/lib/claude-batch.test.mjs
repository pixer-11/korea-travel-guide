// runBatch must never cost a page: whatever it cannot return, the caller
// translates directly. These pin the three ways a batch ends.
//   node --test scripts/lib/claude-batch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBatch, CANCEL_WAIT_MIN, REPLACEMENT_CHAR } from './claude-batch.mjs';
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

// 2026-10-01: a cancelled batch kept "canceling" for more than 5 min, the old
// fixed wait gave up silently, and its finished translations were paid for and
// thrown away. The wait is now an option and giving up is said out loud.
test('a slow cancel is waited out and its succeeded results are still used', async () => {
  const c = fakeClient({ endAfter: 1e9, results: [
    { custom_id: 'r1', result: { type: 'succeeded', message: msg('ja') } },
  ] });
  let afterCancel = 0;
  c.beta.messages.batches.retrieve = async () => {
    if (c.calls.cancelled) afterCancel += 1;
    return { id: 'b1', processing_status: afterCancel >= 4 ? 'ended' : c.calls.cancelled ? 'canceling' : 'in_progress', request_counts: {} };
  };
  const got = await runBatch(c, items, { ...quiet, waitMin: 0, cancelWaitMin: 1 });
  assert.equal(afterCancel, 4);
  assert.deepEqual([...got.keys()], ['ja/a-very-long-slug']);
});

test('the default post-cancel wait is long enough to see a cancel through', () => {
  // 5 min was the old default and it was not enough (2026-10-01).
  assert.ok(CANCEL_WAIT_MIN >= 30, `CANCEL_WAIT_MIN=${CANCEL_WAIT_MIN}`);
});

test('a cancel that never ends gives up with a log line, not silently', async () => {
  const c = fakeClient({ endAfter: 1e9 });
  c.beta.messages.batches.retrieve = async () => ({ id: 'b1', processing_status: c.calls.cancelled ? 'canceling' : 'in_progress', request_counts: { processing: 7 } });
  const lines = [];
  const got = await runBatch(c, items, { pollSec: 0, log: (s) => lines.push(s), waitMin: 0, cancelWaitMin: 0.001 });
  assert.equal(got.size, 0);
  assert.ok(lines.some((l) => /after cancel — giving up.*"processing":7/.test(l)), lines.join('\n'));
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

// 2026-10-05: the SDK's results iterator decoded each network chunk on its own,
// so a letter cut by a chunk boundary became U+FFFD — 523 translations carried
// one. This server cuts 「돌아오나요」 inside 아 on purpose.
test('results are decoded whole: a letter split across network chunks survives', async () => {
  const { createServer } = await import('node:http');
  const line = JSON.stringify({ custom_id: 'r0', result: { type: 'succeeded', message: msg('돌아오나요?') } }) + '\n';
  const bytes = Buffer.from(line, 'utf8');
  const cut = bytes.indexOf(Buffer.from('아', 'utf8')) + 1; // inside the 3-byte letter
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-jsonl' });
    res.write(bytes.subarray(0, cut));
    setTimeout(() => res.end(bytes.subarray(cut)), 20);
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const c = fakeClient();
    c.apiKey = 'test-key';
    const url = `http://127.0.0.1:${server.address().port}/results`;
    c.beta.messages.batches.retrieve = async () => ({ id: 'b1', processing_status: 'ended', request_counts: {}, results_url: url });
    const got = await runBatch(c, items, quiet);
    assert.equal(got.get('ko/a-very-long-slug')?.content[0].text, '돌아오나요?');
  } finally {
    server.close();
  }
});

test('a reply carrying U+FFFD is not used — that job goes direct', async () => {
  const got = await runBatch(fakeClient({ results: [
    { custom_id: 'r0', result: { type: 'succeeded', message: msg(`돌${REPLACEMENT_CHAR}${REPLACEMENT_CHAR}오나요?`) } },
    { custom_id: 'r1', result: { type: 'succeeded', message: msg('戻りますか') } },
  ] }), items, quiet);
  assert.deepEqual([...got.keys()], ['ja/a-very-long-slug']);
});

test('batch results are booked at half price', async () => {
  const before = meterTally()['claude-sonnet-5']?.usd || 0;
  await runBatch(fakeClient({ results: [{ custom_id: 'r0', result: { type: 'succeeded', message: msg('x') } }] }), items, quiet);
  const added = (meterTally()['claude-sonnet-5']?.usd || 0) - before;
  // 1000 in @ $2/M + 1000 out @ $10/M = $0.012 direct → $0.006 in a batch
  assert.ok(Math.abs(added - 0.006) < 1e-9, `booked ${added}`);
});
