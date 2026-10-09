import test from 'node:test';
import assert from 'node:assert/strict';

// 2026-10-08: an event's own Commons category is its past editions.
test('eventCategoryFits: 행사 이름·도시 단어로만 된 분류만 받는다', async () => {
  const { eventCategoryFits } = await import('./commons.mjs');
  assert.ok(eventCategoryFits('Lucca Comics & Games 2024', 'Lucca Comics and Games', 'Lucca'));
  assert.ok(eventCategoryFits('2022 United States Grand Prix', 'F1 United States Grand Prix', 'Austin'));
  assert.ok(eventCategoryFits('Dubai Sevens 2012', 'Emirates Dubai Sevens Rugby Sevens', 'Dubai'));
  assert.ok(eventCategoryFits('Deepavali in Singapore', 'Deepavali (Diwali) Little India Festival', 'Singapore'));
  assert.equal(eventCategoryFits('Cosplay at Lucca Comics & Games', 'Lucca Comics and Games', 'Lucca'), false);
  assert.equal(eventCategoryFits('Watkins Glen International', 'F1 United States Grand Prix', 'Austin'), false);
  assert.equal(eventCategoryFits('Singapore', 'Deepavali Little India Festival', 'Singapore'), false, 'a city alone is not the event');
});

test('eventCategoryFits 역방향 (코덱스 10-09 재현 3건)', async () => {
  const { eventCategoryFits } = await import('./commons.mjs');
  assert.equal(eventCategoryFits('Music festivals', 'Seoul Music Festival', 'Seoul'), false, 'a kind of event is not this event');
  assert.equal(eventCategoryFits('UK Grand Prix', 'US Grand Prix', 'Austin'), false, 'two-letter words decide');
  assert.equal(eventCategoryFits('Marathons in Bangkok', 'Bangkok Marathon', 'Bangkok'), false, 'a plural kind is a collection');
  assert.ok(eventCategoryFits('Bangkok Marathon', 'Bangkok Marathon', 'Bangkok'));
  assert.ok(eventCategoryFits('Maratona internazionale di Palermo', 'Palermo Marathon (Maratona Internazionale di Palermo)', 'Palermo'));
});
