import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hubPathsFor } from './hub-lastmod.mjs';

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
