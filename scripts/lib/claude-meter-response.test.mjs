// The meter must not change what the SDK hands back. Its own process, with the
// real SDK against a local server, because the unit test replaces create().
//
// 2026-09-25: the first meter read every response eagerly, and
// `messages.create(...).asResponse()` then got a body that was already read
// ("body used already"). Reproduced before the fix; this keeps it fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { meterTally } from './claude-meter.mjs';

const BODY = JSON.stringify({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 20 },
});

async function withServer(fn) {
  const srv = http.createServer((_, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(BODY); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(new Anthropic({ apiKey: 'x', baseURL: `http://127.0.0.1:${srv.address().port}`, maxRetries: 0 })); }
  finally { srv.close(); }
}

const req = { model: 'claude-opus-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'x' }] };

test('await, withResponse and asResponse all behave exactly as without the meter', async () => {
  await withServer(async (c) => {
    const before = meterTally()['claude-opus-5-5']?.calls || 0;

    const a = await c.messages.create(req);
    assert.equal(a.content[0].text, 'hi');

    const { data, response } = await c.messages.create(req).withResponse();
    assert.equal(data.usage.output_tokens, 20);
    assert.equal(response.status, 200);

    const raw = await c.messages.create(req).asResponse();
    const j = await raw.json(); // threw "body used already" with the eager meter
    assert.equal(j.type, 'message');

    // The SDK's own catch/finally skip then(); the meter routes them through it.
    const viaCatch = await c.messages.create(req).catch(() => null);
    assert.equal(viaCatch.type, 'message');
    let ranFinally = false;
    const viaFinally = await c.messages.create(req).finally(() => { ranFinally = true; });
    assert.equal(viaFinally.type, 'message');
    assert.ok(ranFinally);

    const after = meterTally()['claude-opus-5-5'].calls;
    // await, withResponse, catch and finally are counted once each; asResponse
    // hands over the raw response unread, so it cannot be counted without
    // breaking it - by design.
    assert.equal(after - before, 4);
  });
});
