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
  // 10-17: the city's own category, when the city is also in the event's name.
  assert.equal(eventCategoryFits('Hong Kong', 'Hong Kong Sixes', 'Hong Kong'), false, 'Category:Hong Kong is the city, not the Sixes');
  assert.equal(eventCategoryFits('Bangkok', 'Bangkok Marathon', 'Bangkok'), false);
  // 10-17: a sibling edition — the stadium ISTAF went into the ISTAF Indoor guide.
  assert.equal(eventCategoryFits('ISTAF 2019', 'ISTAF Indoor Berlin', 'Berlin'), false, 'indoor is a different meet');
  assert.ok(eventCategoryFits('ISTAF Indoor 2024', 'ISTAF Indoor Berlin', 'Berlin'));
  assert.equal(eventCategoryFits('Bangkok Marathon', 'Bangkok Half Marathon', 'Bangkok'), false);
  assert.ok(eventCategoryFits('Maratona internazionale di Palermo', 'Palermo Marathon (Maratona Internazionale di Palermo)', 'Palermo'));
});

// 2026-10-26: BIGBANG's category is "Big Bang (musical group from South Korea)"
// — no fixed suffix spelled it — and Norway and the UK have bands of the same
// name. Tokyo's guide carried the Norwegian band's photo.
test('pickPerformerCategory: namesakes are told apart by the guide, or not at all', async () => {
  const { pickPerformerCategory } = await import('./commons.mjs');
  const titles = ['Bigbang', 'Bigbang (musical group from Norway)', 'Big Bang (musical group from South Korea)',
    'Øystein Greni', 'Big Bang', 'Daesung', 'G-Dragon', 'Big Bang (musical group from South Korea) in 2016'];
  assert.equal(pickPerformerCategory('BIGBANG', titles), null, 'two namesakes and no evidence: none');
  assert.equal(pickPerformerCategory('BIGBANG', titles, new Map([
    ['Big Bang (musical group from South Korea)', 2], ['Bigbang (musical group from Norway)', 0]])),
  'Big Bang (musical group from South Korea)');
  assert.equal(pickPerformerCategory('BIGBANG', titles, new Map([
    ['Big Bang (musical group from South Korea)', 2], ['Bigbang (musical group from Norway)', 2]])), null, 'a tie is not a winner');
  assert.equal(pickPerformerCategory('Babymonster', ['Babymonster (musical group from South Korea)', 'Baby Monster (film)']),
    'Babymonster (musical group from South Korea)', 'one musical match needs no evidence');
  assert.equal(pickPerformerCategory('Khalid', ['Khalid (politician)', 'Khalid Sheikh']), null, 'not a musical category');
});
