import test from 'node:test';
import assert from 'node:assert/strict';
import { mailerlite } from './mailerlite.mjs';

// Minimal stub fetch: routes by URL+method, returns queued responses.
function stub(routes) {
  const calls = [];
  const f = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    const key = `${method} ${url.replace('https://connect.mailerlite.com/api', '')}`;
    const match = routes.find((r) => key.startsWith(r.key));
    if (!match) throw new Error(`no stub for ${key}`);
    return { ok: match.status < 400, status: match.status, json: async () => match.body, text: async () => JSON.stringify(match.body) };
  };
  f.calls = calls;
  return f;
}

test('listActiveSubscribers paginates via meta.next_cursor', async () => {
  const f = stub([
    { key: 'GET /subscribers?', status: 200, body: { data: [{ id: '1', email: 'a@x.com', fields: { region: 'dubai', lang: 'ko' } }], meta: { next_cursor: 'CURSOR2' } } },
  ]);
  // second page: same route matches, but we swap by cursor — simplest: return no cursor on any call after first
  let n = 0;
  const f2 = async (url, opts) => {
    n++;
    return { ok: true, status: 200, json: async () => (n === 1
      ? { data: [{ id: '1', email: 'a@x.com', fields: { region: 'dubai', lang: 'ko' } }], meta: { next_cursor: 'C2' } }
      : { data: [{ id: '2', email: 'b@x.com', fields: { region: 'paris', lang: 'en' } }], meta: { next_cursor: null } }), text: async () => '' };
  };
  const ml = mailerlite('T', f2);
  const subs = await ml.listActiveSubscribers();
  assert.equal(subs.length, 2);
  assert.equal(subs[0].fields.region, 'dubai');
});

test('createField posts name + text type and returns the field', async () => {
  const f = stub([{ key: 'POST /fields', status: 201, body: { data: { id: '9', key: 'region', name: 'region' } } }]);
  const ml = mailerlite('T', f);
  const field = await ml.createField('region');
  assert.equal(field.key, 'region');
  assert.equal(f.calls[0].body.type, 'text');
  assert.equal(f.calls[0].body.name, 'region');
});

test('ensureGroup returns existing group when name matches', async () => {
  const f = stub([{ key: 'GET /groups?', status: 200, body: { data: [{ id: '5', name: 'auto:dubai:ko' }] } }]);
  const ml = mailerlite('T', f);
  const g = await ml.ensureGroup('auto:dubai:ko');
  assert.equal(g.id, '5');
});

test('throws with status on non-2xx', async () => {
  const f = stub([{ key: 'GET /fields', status: 401, body: { message: 'Unauthenticated.' } }]);
  const ml = mailerlite('T', f);
  await assert.rejects(() => ml.listFields(), /401/);
});
