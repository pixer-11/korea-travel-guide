// Both directions: the post's own address and event days are backed; a wrong
// date, an extra number, or a different street still stands as a finding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordBacksQuote, recordFactLines } from './record-claim.mjs';

const temple = { place: { address: '182 Aberdeen Main Rd, Aberdeen, Hong Kong Island, Hong Kong' } };
const fest = { eventStartDate: '2026-12-12', eventEndDate: '2026-12-13' };

test('the venue address from the record is not invented', () => {
  assert.equal(recordBacksQuote('The building sits at 182 Aberdeen Main Road', temple), true);
  assert.equal(recordBacksQuote('The building sits at 182 Aberdeen Main Rd.', temple), true);
});

test('another street number is still a finding', () => {
  assert.equal(recordBacksQuote('The building sits at 18 Aberdeen Main Road', temple), false);
  assert.equal(recordBacksQuote('Entry is HK$20', temple), false);
});

test('the event days from the record are not invented', () => {
  assert.equal(recordBacksQuote('The 2026 festival is on Saturday, December 12.', fest), true);
  assert.equal(recordBacksQuote('It runs December 12-13, 2026.', fest), true);
});

test('a date off the event days, or a number riding along, still stands', () => {
  assert.equal(recordBacksQuote('The festival is on December 14.', fest), false);
  assert.equal(recordBacksQuote('Gates open at 6pm on December 12.', fest), false);
  assert.equal(recordBacksQuote('Tickets cost 40 euros', fest), false);
});

test('a true address or date does not carry an invented claim with it (Codex, 10-11)', () => {
  assert.equal(recordBacksQuote('At 182 Aberdeen Main Road, admission costs HK$80', temple), false);
  assert.equal(recordBacksQuote('The building sits at 9182 Aberdeen Main Road', temple), false);
  assert.equal(recordBacksQuote('Gates open at 12pm on December 12, 2026', fest), false);
  assert.equal(recordBacksQuote('On December 12, vendors serve lobster rolls', fest), false);
  assert.equal(recordBacksQuote('The festival is on December 12, 2027', fest), false);
  assert.equal(recordBacksQuote('At 182 Aberdeen Main Road, lunch includes lobster', temple), false);
  assert.equal(recordBacksQuote('On December 12, gates shut at noon', fest), false);
  assert.equal(recordBacksQuote('On December 12, dinner is twenty dollars', fest), false);
});

test('a Date object from YAML reads the same as a string', () => {
  assert.equal(recordBacksQuote('on December 12', { eventStartDate: new Date('2026-12-12T00:00:00Z') }), true);
});

test('the fact lines name what the auditor may treat as verified', () => {
  const lines = recordFactLines({ ...temple, ...fest, eventVenue: 'Central Park', eventOrganizer: { name: 'City Hall' } });
  assert.ok(lines.some((l) => l.startsWith('address: 182 Aberdeen')));
  assert.ok(lines.includes('event dates: 2026-12-12 to 2026-12-13'));
  assert.ok(lines.includes('event venue: Central Park'));
  assert.deepEqual(recordFactLines({}), []);
});
