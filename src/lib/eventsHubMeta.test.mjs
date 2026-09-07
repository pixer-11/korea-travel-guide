import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsHubDescription } from './eventsHubMeta.mjs';

// Stand-in for useTranslations(lang): returns the raw en template.
const t = (k) => ({
  'ev.upcomingIn': 'Upcoming events in {country}',
  'ev.summaryCountry': '{n} upcoming events to plan a trip around.',
  'ev.noneCountry': 'No upcoming events listed in {country} right now — see past events below, or browse all destinations.',
}[k]);

test('describes the count when there are upcoming events', () => {
  assert.equal(
    eventsHubDescription({ t, countryLabel: 'Japan', upcomingCount: 7 }),
    '7 upcoming events to plan a trip around.',
  );
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
