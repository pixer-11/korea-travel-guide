import test from 'node:test';
import assert from 'node:assert/strict';
import { isRecurringEventTitle, isRecurringEvent } from './eventRecurrence.mjs';

test('genuinely annual events are recurring', () => {
  for (const t of [
    'Aomori Nebuta Matsuri: What to Know (Aomori)',
    'La Mercè Festival: What to Know (Barcelona)',
    'MotoGP Aragon Grand Prix: What to Know (Alcañiz)',
    'US Open Tennis Championships 2026: What to Know (New York)',
    'Sturgis Motorcycle Rally (86th Anniversary): What to Know (Sturgis)',
    'World Athletics Continental Tour Silver Meet (Indian Open): What to Know (Bhubaneswar)',
    'Comic Market 108 (Summer Comiket): What to Know in Tokyo',
  ]) {
    assert.equal(isRecurringEventTitle(t), true, t);
  }
});

test('one-off concerts and tour stops are not recurring', () => {
  for (const t of [
    'XG Concert (AsiaWorld-Expo): What to Know (Hong Kong)',
    'BTS World Tour – Arlington: What to Know (Arlington)',
    'HONNE 10th Anniversary Tour: What to Know (Pasay City)',
    'Christina Aguilera Live: What to Know (Abu Dhabi)',
  ]) {
    assert.equal(isRecurringEventTitle(t), false, t);
  }
});

test('empty and missing titles are not recurring', () => {
  assert.equal(isRecurringEventTitle(''), false);
  assert.equal(isRecurringEventTitle(undefined), false);
});

// ── the stored fact beats the guess ──────────────────────────
test('a stored eventRecurring wins over the title heuristic', () => {
  // The whole point: these two names carry no keyword, so the heuristic calls
  // them one-offs and the pages leave the index the day they end.
  assert.equal(isRecurringEvent({ category: 'event', title: 'Lollapalooza 2026: What to Know (Chicago)', eventRecurring: true }), true);
  assert.equal(isRecurringEvent({ category: 'event', title: 'ChinaJoy: What to Know (Shanghai)', eventRecurring: true }), true);
  // And the reverse: a name full of festival words that is genuinely one-off.
  assert.equal(isRecurringEvent({ category: 'event', title: 'One Universe Festival 2026: What to Know (Incheon)', eventRecurring: false }), false);
});

test('without the field it falls back to the title heuristic', () => {
  assert.equal(isRecurringEvent({ category: 'event', title: 'Aomori Nebuta Matsuri: What to Know (Aomori)' }), true);
  assert.equal(isRecurringEvent({ category: 'event', title: 'Christina Aguilera Live: What to Know (Abu Dhabi)' }), false);
  // Not a boolean is not an answer — fall back rather than coerce.
  assert.equal(isRecurringEvent({ category: 'event', title: 'Lollapalooza 2026', eventRecurring: 'yes' }), false);
});

test('non-event posts are never recurring', () => {
  assert.equal(isRecurringEvent({ category: 'attraction', title: 'Annual Festival Park', eventRecurring: true }), false);
  assert.equal(isRecurringEvent(null), false);
  assert.equal(isRecurringEvent(undefined), false);
});
