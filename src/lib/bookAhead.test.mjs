// Sentences taken from the live guides the 2026-09-30 review checked by hand.
//   node --test src/lib/bookAhead.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendsBooking } from './bookAhead.mjs';

test('guides that recommend booking ahead are recognised', () => {
  for (const s of [
    'Book a timed-entry ticket online in advance — this is one of the most-visited landmarks in the city.',
    'Book your Monumental Zone ticket online in advance and select the earliest slot you can get.',
    'This section requires a paid, timed ticket.',
    'Book online in advance: time slots sell out days or even weeks ahead.',
    'Buy tickets online in advance to skip the queue at the door.',
    'Advance online booking is the easiest way in.',
    'Book a table in advance for dinner on weekends.',
  ]) assert.ok(recommendsBooking(s), s);
});

test('guides that say booking is NOT needed are not flagged', () => {
  for (const s of [
    'No advance booking is needed for the plaza or the market stalls.',
    "There's no need to book ahead; just turn up.",
    'There is rarely a need to book ahead outside festival weekends.',
    "The museum isn't busy enough to require timed entry, so walk-ins are normal.",
    'Most visitors pay at the door rather than pre-booked.',
    'There is no need to pre-book online for the palace grounds.',
    'There is little need to book ahead on weekdays.',
  ]) assert.ok(!recommendsBooking(s), s);
});

test('selling out and other places named in a list are not booking advice', () => {
  assert.ok(!recommendsBooking('The pastry case sells out of popular items by mid-morning on weekends.'));
  assert.ok(!recommendsBooking('- **Shibuya Sky**, a rooftop observation deck; tickets are timed-entry and best booked online in advance.'));
  assert.ok(recommendsBooking('- **Book ahead online.** Timed-entry tickets are standard here.'));
});

test('a body is flagged when any one sentence recommends booking', () => {
  assert.ok(recommendsBooking('Walk-ins are fine at the café.\n\nFor the rooftop, book a timed-entry ticket online ahead.'));
  assert.ok(!recommendsBooking('A calm park.\n\nNo need to book ahead.'));
});
