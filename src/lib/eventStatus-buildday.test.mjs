import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// One "today" per build (2026-10-03): with WA_BUILD_DAY set, an event's state
// is decided by the build's day, not by the clock at the moment each page
// renders — a build crossing 00:00 UTC once listed two ended events in the
// sitemap while their pages said noindex. Run in a child process so the env
// is set before the module reads it.
const probe = (day) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
  const { isEventPast, isNoindexedPost } = await import(${JSON.stringify(new URL('./eventStatus.ts', import.meta.url).href)});
  const ev = { category: 'event', eventStartDate: '2026-10-02', eventEndDate: '2026-10-02', title: 'Najwa Karam Live in Dubai' };
  console.log(JSON.stringify({ past: isEventPast(ev), noindex: isNoindexedPost(ev) }));
`], { env: { ...process.env, WA_BUILD_DAY: day }, encoding: 'utf8' }).trim());

test('an event ending on the build day is still live for that whole build', () => {
  assert.deepEqual(probe('2026-10-02'), { past: false, noindex: false });
});

test('the next build day it is past (and a one-off goes noindex)', () => {
  assert.deepEqual(probe('2026-10-03'), { past: true, noindex: true });
});
