import test from 'node:test';
import assert from 'node:assert/strict';
import { politeFetch } from './polite-fetch.mjs';

// Stub global fetch with a scripted sequence of responses.
function script(seq) {
  let i = 0;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const step = seq[Math.min(i++, seq.length - 1)];
    if (step instanceof Error) throw step;
    return new Response('x', { status: step.status, headers: step.headers || {} });
  };
  return calls;
}

test('429 then 200 → retried, returns the 200', async () => {
  const calls = script([{ status: 429 }, { status: 200 }]);
  const res = await politeFetch('https://x/', { tries: 3, baseMs: 1 });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});

test('Retry-After is honoured (bounded) and reported', async () => {
  script([{ status: 429, headers: { 'retry-after': '1' } }, { status: 200 }]);
  const seen = [];
  const res = await politeFetch('https://x/', { tries: 2, baseMs: 1, onRetry: (i) => seen.push(i) });
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 429);
  assert.equal(seen[0].waitMs, 1000);
});

test('non-transient statuses are NOT retried — the caller still decides', async () => {
  const calls = script([{ status: 404 }, { status: 200 }]);
  const res = await politeFetch('https://x/', { tries: 3, baseMs: 1 });
  assert.equal(res.status, 404);
  assert.equal(calls.length, 1);
});

test('exhausted tries return the last transient response rather than throwing', async () => {
  const calls = script([{ status: 429 }, { status: 503 }, { status: 429 }]);
  const res = await politeFetch('https://x/', { tries: 3, baseMs: 1 });
  assert.equal(res.status, 429);
  assert.equal(calls.length, 3);
});

test('network error then success → retried', async () => {
  const calls = script([new Error('ECONNRESET'), { status: 200 }]);
  const res = await politeFetch('https://x/', { tries: 2, baseMs: 1 });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});
