import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOffer, normalizePerformer } from './eventOffers.mjs';

test('an official https ticket page is kept', () => {
  assert.deepEqual(normalizeOffer({ url: 'https://www.fujirockfestival.com/ticket/' }),
    { url: 'https://www.fujirockfestival.com/ticket/' });
});

test('resellers and aggregators are refused', () => {
  for (const url of [
    'https://www.viagogo.com/Concert-Tickets/x',
    'https://www.stubhub.com/x',
    'https://www.getyourguide.com/x',
    'https://www.klook.com/x',
    'https://en.wikipedia.org/wiki/x',
    'https://www.facebook.com/events/1234',
    'https://wanderatlasguides.com/posts/x/', // our own page is not the offer
  ]) assert.equal(normalizeOffer({ url }), null, url);
});

test('http and malformed URLs are refused', () => {
  assert.equal(normalizeOffer({ url: 'http://example.com/tickets' }), null);
  assert.equal(normalizeOffer({ url: 'tickets here' }), null);
  assert.equal(normalizeOffer({ url: '' }), null);
});

test('free is stored only with a usable currency', () => {
  assert.deepEqual(normalizeOffer({ free: true, currency: 'thb' }), { free: true, currency: 'THB' });
  assert.equal(normalizeOffer({ free: true, currency: 'baht' }), null, 'not an ISO code — say nothing');
  assert.equal(normalizeOffer({ free: true }), null, 'price 0 with no currency is invalid schema');
});

test('free and a ticket page can coexist', () => {
  assert.deepEqual(normalizeOffer({ url: 'https://example.org/register', free: true, currency: 'JPY' }),
    { url: 'https://example.org/register', free: true, currency: 'JPY' });
});

// The reverse direction: a rule that refuses everything would pass the tests
// above, so assert that ordinary good input still survives.
test('free:false is simply not an offer, not an error', () => {
  assert.equal(normalizeOffer({ free: false }), null);
  assert.deepEqual(normalizeOffer({ url: 'https://example.org/t', free: false }), { url: 'https://example.org/t' });
});

test('a named act is kept with its kind', () => {
  assert.deepEqual(normalizePerformer({ name: 'Coldplay', kind: 'group' }), { name: 'Coldplay', kind: 'group' });
  assert.deepEqual(normalizePerformer({ name: 'Hikaru Utada', kind: 'person' }), { name: 'Hikaru Utada', kind: 'person' });
});

test('a line-up is not a performer', () => {
  assert.equal(normalizePerformer({ name: 'Various artists', kind: 'group' }), null);
  assert.equal(normalizePerformer({ name: 'Multiple headliners', kind: 'group' }), null);
  assert.equal(normalizePerformer({ name: 'TBA', kind: 'group' }), null);
  assert.equal(normalizePerformer({ name: 'Fuji Rock line-up', kind: 'group' }), null);
});

test('a performer with no kind is not stored', () => {
  assert.equal(normalizePerformer({ name: 'Coldplay' }), null);
  assert.equal(normalizePerformer({ name: 'Coldplay', kind: 'band' }), null);
  assert.equal(normalizePerformer({ name: '', kind: 'group' }), null);
});
