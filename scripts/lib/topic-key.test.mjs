import test from 'node:test';
import assert from 'node:assert/strict';
import { topicKey } from './topic-key.mjs';

test('same-city name variants (year / filler) collapse to one key', () => {
  assert.equal(
    topicKey('ChinaJoy 2026: What to Know (Shanghai)', 'Shanghai'),
    topicKey('ChinaJoy: What to Know (Shanghai)', 'Shanghai'),
  );
});

test('same event with different word order collapses', () => {
  assert.equal(
    topicKey('Formula 1 Italian Grand Prix: What to Know', 'Monza'),
    topicKey('Italian Grand Prix Formula 1: What to Know', 'Monza'),
  );
});

test('different venues in the same city do NOT collapse', () => {
  assert.notEqual(
    topicKey('Saladaeng: Where to Eat', 'Bangkok'),
    topicKey('Somsak: Where to Eat', 'Bangkok'),
  );
});

test('same name in different cities does NOT collapse', () => {
  assert.notEqual(
    topicKey('The Tower: Travel Guide', 'Tokyo'),
    topicKey('The Tower: Travel Guide', 'Paris'),
  );
});

// The event suffix changed on 2026-08-07. If the two forms produced different
// keys, a re-discovered event would dodge the duplicate guard across the
// rename and get published twice.
test('old "What to Know" and new "Dates, Tickets & Venue" collapse to one key', () => {
  assert.equal(
    topicKey('Lollapalooza 2026: What to Know (Chicago)', 'Chicago'),
    topicKey('Lollapalooza 2026: Dates, Tickets & Venue (Chicago)', 'Chicago'),
  );
});

// 2026-08-12: the daily publish shipped "Old Town of Lijiang" and the bulk fill
// shipped "Lijiang Old Town" the same evening. Google files that place under two
// ids, so the place.id de-dupe saw two different venues — this key is the only
// thing that can tell they are one, and validate-content now consults it for
// posts WITH an id too, not just placeless ones.
test('word-order twins of the same landmark collapse to one key', () => {
  assert.equal(
    topicKey('Old Town of Lijiang: Travel Guide (4.6★)', 'Lijiang'),
    topicKey('Lijiang Old Town: Travel Guide (4.6★)', 'Lijiang'),
  );
});

// …but two genuinely different places in one city must stay apart, or the
// widened check would start deleting real guides.
test('different landmarks in the same city keep different keys', () => {
  assert.notEqual(
    topicKey('Black Dragon Pool: Travel Guide', 'Lijiang'),
    topicKey('Lijiang Old Town: Travel Guide', 'Lijiang'),
  );
});
