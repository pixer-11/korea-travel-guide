// node --test worker/subscribe.test.mjs
// /api/subscribe and /preferences hardening (2026-10-05 audit): a public,
// unauthenticated endpoint that writes to MailerLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';

// A fake MailerLite: records every call, answers by path.
function fakeMailerLite({ status = null, failUpsert = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/groups')) return Response.json({ data: [{ id: 'g1', name: 'Newsletter Subscribers' }] });
    if (/\/subscribers\/[^/]+$/.test(u)) return status ? Response.json({ data: { status } }) : Response.json({ message: 'nf' }, { status: 404 });
    if (u.endsWith('/subscribers')) return failUpsert ? Response.json({ message: 'secret upstream detail' }, { status: 422 }) : Response.json({ data: {} });
    return Response.json({});
  };
  return calls;
}
const env = { MAILERLITE_API_TOKEN: 't', ASSETS: { fetch: async () => new Response('nf', { status: 404 }) } };
const post = (fields, headers = {}, e = env) => {
  const body = new URLSearchParams(Object.entries(fields).map(([k, v]) => [`fields[${k}]`, v]));
  return worker.fetch(new Request('https://wanderatlasguides.com/api/subscribe', { method: 'POST', body, headers }), e);
};
const upsertOf = (calls) => calls.find((c) => c.method === 'POST' && c.url.endsWith('/subscribers'))?.body;

test('a form on another site cannot sign people up', async () => {
  const calls = fakeMailerLite();
  const r = await post({ email: 'a@b.co' }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await post({ email: 'a@b.co' }, { Origin: 'https://wanderatlasguides.com' })).status, 200);
});

test('fields outside the allow-list are dropped; the signup still goes through', async () => {
  const calls = fakeMailerLite();
  const r = await post({ email: 'new@b.co', region: '"><script>alert(1)</script>', lang: 'xx', signup_source: 'popup', itinerary_url: 'https://evil.example/x' });
  assert.equal(r.status, 200);
  const up = upsertOf(calls);
  assert.deepEqual(up.fields, { signup_source: 'popup' });
  assert.equal(up.status, 'unconfirmed');
});

// Codex, 10-05: the forms send a pathname, "popup:/path/" or "itinerary:slug".
test('the source tags the forms actually send are kept', async () => {
  for (const src of ['/ko/posts/seoul-n-tower/', 'popup:/ja/', 'itinerary:seoul-3-days']) {
    const calls = fakeMailerLite();
    await post({ email: 'n@b.co', signup_source: src });
    assert.equal(upsertOf(calls).fields?.signup_source, src, src);
  }
});

test("an active subscriber's preferences are not rewritten by a public POST", async () => {
  const calls = fakeMailerLite({ status: 'active' });
  await post({ email: 'old@b.co', region: 'seoul', lang: 'ko' });
  const up = upsertOf(calls);
  assert.equal(up.fields, undefined);
  assert.equal(up.status, undefined);
});

test("MailerLite's error body is not echoed to the caller", async () => {
  fakeMailerLite({ failUpsert: true });
  const r = await post({ email: 'x@b.co' });
  assert.equal(r.status, 502);
  assert.doesNotMatch(await r.text(), /secret upstream detail/);
});

test('the rate limit binding, when present, answers 429', async () => {
  const calls = fakeMailerLite();
  const r = await post({ email: 'x@b.co' }, {}, { ...env, SUBSCRIBE_RL: { limit: async () => ({ success: false }) } });
  assert.equal(r.status, 429);
  assert.equal(calls.length, 0);
});

test('an over-long or malformed address is refused before MailerLite', async () => {
  const calls = fakeMailerLite();
  assert.equal((await post({ email: `${'a'.repeat(250)}@b.co` })).status, 400);
  assert.equal((await post({ email: 'a b@c.d' })).status, 400);
  assert.equal(calls.length, 0);
});

test('a missing /_astro/ file is not cached as immutable', async () => {
  const e = { ASSETS: { fetch: async () => new Response('nf', { status: 404, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }) } };
  const r = await worker.fetch(new Request('https://wanderatlasguides.com/_astro/gone.abc123.css'), e);
  assert.equal(r.status, 404);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});
