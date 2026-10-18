// node --test worker/klook-locale.test.mjs
// /go/klook sends Taiwan and Hong Kong readers of our Simplified /zh/ pages to
// Klook's Traditional store (10-05). Mainland and every other locale untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';

const realFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://x/?aid=api%7C13694%7Cabcdef12-754088%7Cpid%7C754088' } }); });
test.after(() => { globalThis.fetch = realFetch; });

const go = async (to, country) => {
  // A reader's click (browser UA + one of our pages as Referer) — since 10-18
  // anything else skips the affiliate redirect (isReaderClick, klook-relay.test).
  const reader = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', referer: 'https://wanderatlasguides.com/zh/posts/seoul-gyeongbokgung-palace/' };
  const req = new Request(`https://wanderatlasguides.com/go/klook/?to=${encodeURIComponent(to)}`, { headers: country ? { ...reader, 'cf-ipcountry': country } : reader });
  const r = await worker.fetch(req, { ASSETS: { fetch: async () => new Response('', { status: 404 }) } });
  return new URL(r.headers.get('location')).searchParams.get('k_site');
};

test('TW and HK readers get the Traditional store; others keep their locale', async () => {
  const cn = 'https://www.klook.com/zh-CN/destination/c13-seoul/';
  assert.equal(await go(cn, 'TW'), 'https://www.klook.com/zh-TW/destination/c13-seoul/');
  assert.equal(await go(cn, 'HK'), 'https://www.klook.com/zh-HK/destination/c13-seoul/');
  assert.equal(await go(cn, 'MO'), 'https://www.klook.com/zh-HK/destination/c13-seoul/');
  assert.equal(await go(cn, 'CN'), cn);
  assert.equal(await go(cn), cn);
  const ko = 'https://www.klook.com/ko/destination/c13-seoul/';
  assert.equal(await go(ko, 'TW'), ko);
});
