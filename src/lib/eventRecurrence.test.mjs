import test from 'node:test';
import assert from 'node:assert/strict';
import { isRecurringEventTitle } from './eventRecurrence.mjs';

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
