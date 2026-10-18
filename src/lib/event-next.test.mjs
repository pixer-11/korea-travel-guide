// 끝난 행사 글의 "다음 대회" (2026-10-19 주간 제안 2번에서 나온 것).
//   node --test src/lib/event-next.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventKind, nextEventFor } from './event-next.mjs';

const ev = (id, title, start, end, extra = {}) => ({ id, data: { category: 'event', title, eventStartDate: start, eventEndDate: end, ...extra } });

test('the narrow kinds win over the broad ones', () => {
  assert.equal(eventKind(ev('a', 'ITTF World Youth Championships (Table Tennis)').data), 'table-tennis');
  assert.equal(eventKind(ev('a', "2026 Xi'an Grand Prix (Snooker)").data), 'snooker');
  assert.equal(eventKind(ev('a', 'MotoGP Japanese Grand Prix').data), 'motogp');
  assert.equal(eventKind(ev('a', 'Formula 1 Las Vegas Grand Prix').data), 'f1');
  assert.equal(eventKind(ev('a', '73rd Macau Grand Prix').data), null);   // F3 and bikes — not F1
  assert.equal(eventKind(ev('a', 'Rolex Shanghai Masters', null, null, { eventVenue: 'Qi Zhong Tennis Center' }).data), 'tennis');
  assert.equal(eventKind(ev('a', 'Bangkok Marathon').data), 'marathon');
  assert.equal(eventKind({ category: 'attraction', title: 'Tennis club' }), null);
});

test('a finished tennis event points at the next tennis event, wherever it is', () => {
  const shanghai = ev('shanghai', 'Rolex Shanghai Masters', '2026-10-07', '2026-10-18', { eventVenue: 'Qi Zhong Tennis Center' });
  const posts = [
    shanghai,
    ev('beijing', 'China Open (tennis)', '2026-09-30', '2026-10-06'),            // already over
    ev('turin', 'Nitto ATP Finals', '2026-11-15', '2026-11-22'),
    ev('wta', 'WTA Finals', '2026-11-01', '2026-11-08'),
    ev('snooker', 'International Championship (Snooker)', '2026-10-25', '2026-11-01'),
  ];
  const r = nextEventFor(shanghai, posts, '2026-10-19');
  assert.equal(r.post.id, 'wta');      // the earliest one still ahead
  assert.equal(r.why, 'kind');
});

test("the performer's next stop beats the same kind", () => {
  const a = ev('bigbang-hanoi', 'BIGBANG World Tour in Hanoi', '2026-10-10', '2026-10-10', { eventPerformer: { name: 'BIGBANG', kind: 'group' } });
  const posts = [a,
    ev('other-concert', 'Some Concert', '2026-10-20', '2026-10-20'),
    ev('bigbang-bkk', 'BIGBANG World Tour in Bangkok', '2026-11-02', '2026-11-02', { eventPerformer: { name: 'Bigbang', kind: 'group' } })];
  const r = nextEventFor(a, posts, '2026-10-19');
  assert.equal(r.post.id, 'bigbang-bkk');
  assert.equal(r.why, 'performer');
});

test('nothing ahead, drafts and unknown kinds give no link', () => {
  const a = ev('m1', 'Florence Marathon', '2026-03-01', '2026-03-01');
  assert.equal(nextEventFor(a, [a, ev('m2', 'Old Marathon', '2026-01-01', '2026-01-01')], '2026-10-19'), null);
  assert.equal(nextEventFor(a, [a, { ...ev('m3', 'Draft Marathon', '2026-12-01', '2026-12-01'), data: { ...ev('m3', 'Draft Marathon', '2026-12-01', '2026-12-01').data, draft: true } }], '2026-10-19'), null);
  const b = ev('x', 'Lantern Festival', '2026-02-01', '2026-02-01');
  assert.equal(nextEventFor(b, [b, ev('y', 'Lantern Festival 2027', '2027-02-01', '2027-02-01')], '2026-10-19'), null);
});

test('dates as Date objects (what the content schema hands the page)', () => {
  const D = (s) => new Date(s + 'T00:00:00Z');
  const a = ev('a', 'Rolex Shanghai Masters', D('2026-10-07'), D('2026-10-18'), { eventVenue: 'Qi Zhong Tennis Center' });
  const r = nextEventFor(a, [a, ev('t', 'Nitto ATP Finals', D('2026-11-15'), D('2026-11-22'))], '2026-10-19');
  assert.equal(r?.post.id, 't');
});
