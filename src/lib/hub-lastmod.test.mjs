import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hubPathsFor } from './hub-lastmod.mjs';
import { MONTH_SLUGS } from './when-to-go.mjs';

test('a restaurant guide freshens its region and country, not the calendar', () => {
  const paths = hubPathsFor({ region: 'Seoul', country: 'South Korea', category: 'restaurant', date: '2026-08-30' });
  assert.ok(paths.includes('/regions/seoul'));
  assert.ok(paths.includes('/destinations/south-korea'));
  // The twelve month pages do not render this post. Claiming they changed is
  // a lie to the crawler — the whole point of this module.
  assert.equal(paths.some((p) => p.startsWith('/tools/when-to-go/south-korea/')), false);
  assert.equal(paths.includes('/events/south-korea'), false);
});

test('an event freshens the events hub and ONLY its own month', () => {
  const paths = hubPathsFor({
    region: 'Austin', country: 'United States', category: 'event',
    eventStartDate: '2026-10-25', date: '2026-08-30',
  });
  assert.ok(paths.includes('/events/united-states'));
  assert.ok(paths.includes('/tools/when-to-go/united-states/october'));
  assert.equal(paths.filter((p) => p.startsWith('/tools/when-to-go/united-states/')).length, 1);
});

test('an event with no start date touches no month page', () => {
  const paths = hubPathsFor({ region: 'Austin', country: 'United States', category: 'event', date: '2026-08-30' });
  assert.ok(paths.includes('/events/united-states'));
  assert.equal(paths.some((p) => p.startsWith('/tools/when-to-go/united-states/')), false);
});

test('a region with no country still defaults to South Korea, as the old code did', () => {
  const paths = hubPathsFor({ region: 'Busan', category: 'attraction', date: '2026-08-30' });
  assert.ok(paths.includes('/destinations/south-korea'));
});

test('every post freshens the site-wide indexes', () => {
  const paths = hubPathsFor({ region: 'Seoul', country: 'South Korea', category: 'cafe', date: '2026-08-30' });
  for (const p of ['/destinations', '/regions', '/']) assert.ok(paths.includes(p), p);
});

// 2026-09-07: hub-lastmod.mjs used to re-type its own twelve-element month-slug
// array as `MONTHS` — a second copy of src/lib/when-to-go.mjs's MONTH_SLUGS,
// under a name that collided with when-to-go.mjs's own `MONTHS` (the numbers
// 1-12). Same shape as the slugify copy in hub-lastmod.slug.test.mjs that
// drifted for accented region names: two lists agreeing today, with nothing
// stopping tomorrow's edit from touching one and not the other. This fails
// the moment hub-lastmod.mjs declares a month-name array of its own again.
test('hub-lastmod.mjs imports MONTH_SLUGS instead of re-declaring the month list', () => {
  const src = readFileSync(new URL('./hub-lastmod.mjs', import.meta.url), 'utf8');
  assert.ok(
    /import\s*\{\s*MONTH_SLUGS\s*\}\s*from\s*'\.\/when-to-go\.mjs'/.test(src),
    'hub-lastmod.mjs should import MONTH_SLUGS from ./when-to-go.mjs, not re-inline it',
  );
  assert.equal(
    /['"]january['"]/i.test(src),
    false,
    'hub-lastmod.mjs should not carry its own literal month-name array',
  );
  // Functional guard: the event → month-page path really does resolve through
  // the shared list, for every month, not just the ones the fixtures above hit.
  for (let m = 0; m < 12; m++) {
    const paths = hubPathsFor({
      region: 'Austin', country: 'United States', category: 'event',
      eventStartDate: `2026-${String(m + 1).padStart(2, '0')}-15`, date: '2026-08-30',
    });
    assert.ok(paths.includes(`/tools/when-to-go/united-states/${MONTH_SLUGS[m]}`), MONTH_SLUGS[m]);
  }
});
