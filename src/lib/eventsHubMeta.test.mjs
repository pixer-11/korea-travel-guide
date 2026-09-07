import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsHubDescription } from './eventsHubMeta.mjs';

// Stand-in for useTranslations(lang): returns the raw en template.
const t = (k) => ({
  'ev.upcomingIn': 'Upcoming events in {country}',
  'ev.summaryCountry': '{n} upcoming events in {country} to plan a trip around.',
  'ev.noneCountry': 'No upcoming events listed in {country} right now — see past events below, or browse all destinations.',
}[k]);

test('describes the count when there are upcoming events', () => {
  assert.equal(
    eventsHubDescription({ t, countryLabel: 'Japan', upcomingCount: 7 }),
    '7 upcoming events in Japan to plan a trip around.',
  );
});

// 2026-09-07: ev.summaryCountry used to have no {country} token, so every
// hub with the same upcoming count rendered a byte-identical description —
// found across 18 English hubs (only 7 distinct strings). Pin the fix.
test('two countries with the same upcoming count get different descriptions', () => {
  const jp = eventsHubDescription({ t, countryLabel: 'Japan', upcomingCount: 5 });
  const vn = eventsHubDescription({ t, countryLabel: 'Vietnam', upcomingCount: 5 });
  assert.notEqual(jp, vn);
  assert.match(jp, /Japan/);
  assert.match(vn, /Vietnam/);
});

test('falls back to the empty-state copy when there are none', () => {
  assert.equal(
    eventsHubDescription({ t, countryLabel: 'Japan', upcomingCount: 0 }),
    'No upcoming events listed in Japan right now — see past events below, or browse all destinations.',
  );
});

test('never equals the page title', () => {
  const title = t('ev.upcomingIn').replace('{country}', 'Japan');
  for (const n of [0, 1, 12]) {
    assert.notEqual(eventsHubDescription({ t, countryLabel: 'Japan', upcomingCount: n }), title);
  }
});
