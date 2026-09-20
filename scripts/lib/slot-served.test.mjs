// slot-served tests — the guard exists because a watchdog rescue and GitHub's
// late-delivered original ran the same slot twice (2026-08-29: six pins, two
// identical reports). What we pin down: only SCHEDULE runs are second-guessed,
// only a SUCCESS by another run counts as served, and API trouble fails open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { slotAlreadyServed } from './slot-served.mjs';
import { lastFireBefore } from './cron-window.mjs';

// 2026-08-29 04:17 UTC = 13:17 KST — the moment pinterest's late original
// actually arrived. Its slot (23:35 UTC prev day = 08:35 KST) had been served
// by the watchdog's rescue at 03:22 UTC.
const NOW = Date.parse('2026-08-29T04:17:00Z');
const SLOT = lastFireBefore('35 23 * * *', NOW); // 2026-08-28T23:35Z

const baseEnv = {
  GITHUB_EVENT_NAME: 'schedule',
  GITHUB_TOKEN: 'tok',
  GITHUB_RUN_ID: '111',
  GITHUB_REPOSITORY: 'pixer-11/korea-travel-guide',
};

const api = (runs, workflow = 'pinterest\\.yml') => async (url, init) => {
  assert.match(url, new RegExp(`/actions/workflows/${workflow}/runs\\?created=`));
  assert.equal(init.headers.Authorization, 'Bearer tok');
  return { ok: true, json: async () => ({ workflow_runs: runs }) };
};

test('the 08-29 incident shape: rescue succeeded in-window → late original is served', async () => {
  const rescue = { id: 65, conclusion: 'success', created_at: '2026-08-29T03:22:46Z' };
  const v = await slotAlreadyServed('pinterest.yml', { now: NOW, env: baseEnv, fetchImpl: api([rescue]) });
  assert.equal(v.served, true);
  assert.equal(v.by, 65);
  assert.ok(v.slotStart <= SLOT, 'window opens at (or tolerance before) the slot time');
});

test('own run does not count as serving the slot', async () => {
  const self = { id: 111, conclusion: 'success', created_at: '2026-08-29T04:17:10Z' };
  const v = await slotAlreadyServed('pinterest.yml', { now: NOW, env: baseEnv, fetchImpl: api([self]) });
  assert.equal(v.served, false);
});

test('a failed or still-running attempt must not suppress the retry', async () => {
  const runs = [
    { id: 65, conclusion: 'failure', created_at: '2026-08-29T03:22:46Z' },
    { id: 66, conclusion: null, created_at: '2026-08-29T04:00:00Z' },
  ];
  const v = await slotAlreadyServed('pinterest.yml', { now: NOW, env: baseEnv, fetchImpl: api(runs) });
  assert.equal(v.served, false);
});

test('manual dispatches are never second-guessed', async () => {
  const env = { ...baseEnv, GITHUB_EVENT_NAME: 'workflow_dispatch' };
  const v = await slotAlreadyServed('pinterest.yml', {
    now: NOW,
    env,
    fetchImpl: async () => { throw new Error('must not even ask the API'); },
  });
  assert.deepEqual({ active: v.active, served: v.served }, { active: false, served: false });
});

test('API trouble fails open — a broken guard must not kill the pipeline', async () => {
  const http500 = async () => ({ ok: false, status: 500 });
  const v1 = await slotAlreadyServed('pinterest.yml', { now: NOW, env: baseEnv, fetchImpl: http500 });
  assert.equal(v1.served, false);
  assert.equal(v1.error, 'HTTP 500');
  const boom = async () => { throw new Error('network down'); };
  const v2 = await slotAlreadyServed('pinterest.yml', { now: NOW, env: baseEnv, fetchImpl: boom });
  assert.equal(v2.served, false);
  assert.match(v2.error, /network down/);
});

// ── publish uses guard:'kstDay' — one batch per KST day, whatever the slot.
// The 2026-08-30 incident: a midnight-confused publish-watchdog ran a second
// batch at 01:20 KST; the day's 16:19 cron must then bow out.

test('publish (kstDay): the accidental 01:20 batch serves the whole KST day', async () => {
  const at1619 = Date.parse('2026-08-30T07:20:00Z'); // 16:20 KST 08-30
  const batch0120 = { id: 500, conclusion: 'success', created_at: '2026-08-29T16:20:00Z' }; // 01:20 KST 08-30
  const v = await slotAlreadyServed('publish.yml', {
    now: at1619, env: baseEnv, fetchImpl: api([batch0120], 'publish\\.yml'),
  });
  assert.equal(v.served, true);
});

test('publish (kstDay): yesterday evening\'s late batch does not serve today', async () => {
  const at1619 = Date.parse('2026-08-30T07:20:00Z');
  const lastNight = { id: 501, conclusion: 'success', created_at: '2026-08-29T14:05:00Z' }; // 23:05 KST 08-29
  const v = await slotAlreadyServed('publish.yml', {
    now: at1619, env: baseEnv, fetchImpl: api([lastNight], 'publish\\.yml'),
  });
  assert.equal(v.served, false);
});

test('workflows outside the manifest are left alone', async () => {
  const v = await slotAlreadyServed('smoke.yml', {
    now: NOW,
    env: baseEnv,
    fetchImpl: async () => { throw new Error('must not query'); },
  });
  assert.deepEqual({ active: v.active, served: v.served }, { active: false, served: false });
});

// ── 배선까지 고정한다 (2026-09-20) ────────────────────────────
// 가드를 generate.mjs 안에만 두면 글만 지켜진다. 늦게 온 크론이 나머지 39개
// 단계를 85분 동안 다시 돌던 자리라, publish.yml 의 본 작업이 이 가드의 답에
// 매달려 있는지를 테스트가 지킨다 — 워크플로를 손보다 조건이 빠지면 여기서 깨진다.
test('publish.yml 의 본 작업은 슬롯 가드 결과에 걸려 있다', async () => {
  const { readFileSync } = await import('node:fs');
  const yaml = (await import('js-yaml')).default;
  const doc = yaml.load(readFileSync('.github/workflows/publish.yml', 'utf8'));
  const slot = doc.jobs?.slot;
  assert.ok(slot, 'slot 잡이 없다');
  assert.match(String(slot.outputs?.served ?? ''), /steps\.check\.outputs\.served/);
  assert.ok(
    JSON.stringify(slot.steps).includes('slot-served-output.mjs'),
    'slot 잡이 가드 스크립트를 부르지 않는다',
  );
  const gen = doc.jobs?.generate;
  assert.ok(gen, 'generate 잡이 없다');
  assert.equal(gen.needs, 'slot');
  assert.match(String(gen.if ?? ''), /needs\.slot\.outputs\.served\s*!=\s*'true'/);
});
