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
