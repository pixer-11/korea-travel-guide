import test from 'node:test';
import assert from 'node:assert/strict';

// The refresh token rotates on every use and only the workflow can commit the
// replacement, so a local call silently strands the cron with a spent token.
// This happened on 2026-09-21 (see [[wander-atlas-pinterest]]), and the guard
// below is the whole reason the module refuses to run outside CI.

const env = { ...process.env };
const restore = () => { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, env); };

test('CI 밖에서는 토큰을 쓰지 않는다 — 크론이 죽은 토큰을 들게 된다', async () => {
  process.env.PINTEREST_APP_SECRET ||= 'test-secret';
  delete process.env.GITHUB_ACTIONS;
  delete process.env.PINTEREST_TOKEN_ALLOW_LOCAL;
  const { getAccessToken } = await import('./pinterest-token.mjs');
  await assert.rejects(getAccessToken(), /refusing to spend the Pinterest refresh token outside CI/);
  restore();
});
