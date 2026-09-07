import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventLocation } from './eventLocation.mjs';

test('names the stored venue and keeps the city as the locality', () => {
  assert.deepEqual(
    eventLocation({ venue: 'Circuit of the Americas', region: 'Austin', countryISO: 'US' }),
    {
      '@type': 'Place',
      name: 'Circuit of the Americas',
      address: { '@type': 'PostalAddress', addressLocality: 'Austin', addressCountry: 'US' },
    },
  );
});

test('falls back to the city when no venue is stored', () => {
  assert.deepEqual(
    eventLocation({ venue: undefined, region: 'Austin', countryISO: 'US' }),
    {
      '@type': 'Place',
      name: 'Austin',
      address: { '@type': 'PostalAddress', addressLocality: 'Austin', addressCountry: 'US' },
    },
  );
});

test('omits addressCountry entirely when the ISO code is unknown', () => {
  // An empty addressCountry is worse than none — never emit a blank field.
  const out = eventLocation({ venue: 'Tokyo Dome', region: 'Tokyo', countryISO: undefined });
  assert.equal('addressCountry' in out.address, false);
});

test('treats a blank or whitespace venue as absent', () => {
  assert.equal(eventLocation({ venue: '   ', region: 'Austin' }).name, 'Austin');
});
