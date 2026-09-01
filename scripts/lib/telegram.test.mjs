// telegram.mjs — the guard that turns a refused send into a failed job.
//
// The bug this exists for (2026-09-01): marketing-review.mjs posted an empty
// body, Telegram answered 400, nobody read the answer, and the workflow went
// green while the owner got nothing. Both directions matter here — a refusal
// must throw with the status quoted, AND a healthy send must still resolve
// quietly, or the fix trades silent loss for daily false alarms.
//
//   node --test scripts/lib/telegram.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegram, sendTelegramForm, telegramCreds } from './telegram.mjs';

/** Runs `fn` with the given env and a stub fetch, then puts both back. */
async function withEnv({ token, chat }, responder, fn) {
  const realFetch = globalThis.fetch;
  const realToken = process.env.TELEGRAM_BOT_TOKEN;
  const realChat = process.env.TELEGRAM_CHAT_ID;
  const calls = [];
  if (token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = token;
  if (chat === undefined) delete process.env.TELEGRAM_CHAT_ID;
  else process.env.TELEGRAM_CHAT_ID = chat;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return responder();
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    if (realToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = realToken;
    if (realChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = realChat;
  }
}

const ok = () => new Response('{"ok":true}', { status: 200 });
const refused = (status, body) => () => new Response(body, { status });

test('a delivered send resolves true and posts what it was given', async () => {
  await withEnv({ token: 'T', chat: '42' }, ok, async (calls) => {
    assert.equal(await sendTelegram('안녕', { disable_web_page_preview: true }), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.telegram.org/botT/sendMessage');
    const sent = JSON.parse(calls[0].init.body);
    assert.deepEqual(sent, { chat_id: '42', text: '안녕', disable_web_page_preview: true });
  });
});

test('opts reach Telegram verbatim — parse_mode is not dropped on the way', async () => {
  await withEnv({ token: 'T', chat: '42' }, ok, async (calls) => {
    await sendTelegram('*hi*', { parse_mode: 'Markdown' });
    assert.equal(JSON.parse(calls[0].init.body).parse_mode, 'Markdown');
  });
});

test('a refused send throws with the status and the reason quoted', async () => {
  await withEnv({ token: 'BAD', chat: '42' }, refused(401, '{"ok":false,"description":"Unauthorized"}'), async () => {
    await assert.rejects(
      () => sendTelegram('hi'),
      (e) => {
        assert.match(e.message, /401/);
        assert.match(e.message, /Unauthorized/);
        return true;
      },
    );
  });
});

test('an empty body is a refusal, not a success — the 2026-09-01 case', async () => {
  await withEnv({ token: 'T', chat: '42' }, refused(400, '{"ok":false,"description":"Bad Request: message text is empty"}'), async () => {
    await assert.rejects(() => sendTelegram(''), /400.*message text is empty/);
  });
});

test('no secrets is not a failure: returns false and never calls out', async () => {
  await withEnv({ token: undefined, chat: undefined }, ok, async (calls) => {
    assert.equal(await sendTelegram('hi'), false);
    assert.equal(calls.length, 0);
  });
  // Half-configured is the same as unconfigured — there is no chat to land in.
  await withEnv({ token: 'T', chat: undefined }, ok, async (calls) => {
    assert.equal(telegramCreds(), null);
    assert.equal(await sendTelegram('hi'), false);
    assert.equal(calls.length, 0);
  });
});

test('multipart sends carry chat_id and follow the same refusal rule', async () => {
  await withEnv({ token: 'T', chat: '42' }, ok, async (calls) => {
    const done = await sendTelegramForm('sendPhoto', (f) => f.append('caption', 'x'));
    assert.equal(done, true);
    assert.equal(calls[0].url, 'https://api.telegram.org/botT/sendPhoto');
    assert.equal(calls[0].init.body.get('chat_id'), '42');
    assert.equal(calls[0].init.body.get('caption'), 'x');
  });
  await withEnv({ token: 'T', chat: '42' }, refused(413, 'Request Entity Too Large'), async () => {
    await assert.rejects(() => sendTelegramForm('sendMediaGroup', () => {}), /413/);
  });
  await withEnv({ token: undefined, chat: '42' }, ok, async (calls) => {
    assert.equal(await sendTelegramForm('sendDocument', () => {}), false);
    assert.equal(calls.length, 0);
  });
});
