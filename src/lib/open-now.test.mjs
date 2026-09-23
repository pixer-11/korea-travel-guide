import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDay, parseWeek, condenseWeek, statusAt, dayText, venueClock, hhmm } from './open-now.mjs';

const week = (text) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => `${d}: ${text}`);

test('parseDay reads the shapes Google actually sends', () => {
  assert.deepEqual(parseDay('7:00 AM – 11:00 PM'), [[420, 1380]]);
  assert.deepEqual(parseDay('Closed'), []);
  assert.deepEqual(parseDay('Open 24 hours'), [[0, 1440]]);
  // start meridiem inherited from the end
  assert.deepEqual(parseDay('10:00 – 11:30 AM, 5:00 – 10:00 PM'), [[600, 690], [1020, 1320]]);
  // overnight
  assert.deepEqual(parseDay('6:00 PM – 2:00 AM'), [[1080, 1560]]);
  assert.deepEqual(parseDay('7:00 AM – 12:00 AM'), [[420, 1440]]);
  // narrow no-break space before the meridiem
  assert.deepEqual(parseDay('9:00 AM – 5:00 PM'), [[540, 1020]]);
});

test('parseDay refuses what it cannot fully read', () => {
  assert.equal(parseDay('By appointment'), null);
  assert.equal(parseDay('9:00 AM – 5:00 PM (hours might differ)'), null);
  assert.equal(parseDay(''), null);
});

test('parseWeek needs all seven days', () => {
  assert.equal(parseWeek(week('9:00 AM – 5:00 PM').slice(0, 6)), null);
  assert.equal(parseWeek(undefined), null);
  assert.equal(parseWeek([...week('9:00 AM – 5:00 PM').slice(0, 6), 'Sunday: sometimes']), null);
  assert.equal(parseWeek(week('9:00 AM – 5:00 PM')).length, 7);
});

test('condenseWeek: one group when every day agrees, grouped otherwise', () => {
  assert.deepEqual(condenseWeek(parseWeek(week('5:00 AM – 11:00 PM'))), [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], kind: 'hours', text: '05:00–23:00' },
  ]);
  const lines = week('9:00 AM – 5:00 PM');
  lines[0] = 'Monday: Closed';
  const g = condenseWeek(parseWeek(lines));
  assert.equal(g.length, 2);
  assert.deepEqual(g[0], { days: ['Monday'], kind: 'closed', text: '' });
  assert.equal(g[1].days.length, 6);
});

test('dayText prints midnight close as 24:00, past-midnight as the clock time', () => {
  assert.equal(dayText([[420, 1440]]), '07:00–24:00');
  assert.equal(dayText([[1080, 1560]]), '18:00–02:00');
  assert.equal(hhmm(1500), '01:00');
});

test('statusAt: open, closing time, and the next opening', () => {
  const w = parseWeek(week('9:00 AM – 5:00 PM'));
  assert.deepEqual(statusAt(w, 0, 600), { open: true, closes: 1020, closesIn: 0 });
  assert.deepEqual(statusAt(w, 0, 480), { open: false, opens: 540, opensIn: 0 });
  assert.deepEqual(statusAt(w, 0, 1100), { open: false, opens: 540, opensIn: 1 });
  // closed Mondays: Sunday evening → opens Tuesday
  const lines = week('9:00 AM – 5:00 PM');
  lines[0] = 'Monday: Closed';
  assert.deepEqual(statusAt(parseWeek(lines), 6, 1100), { open: false, opens: 540, opensIn: 2 });
});

test('statusAt: a late shift from yesterday counts as open today', () => {
  const w = parseWeek(week('6:00 PM – 2:00 AM'));
  assert.deepEqual(statusAt(w, 2, 60), { open: true, closes: 120, closesIn: 0 });
  assert.deepEqual(statusAt(w, 2, 200), { open: false, opens: 1080, opensIn: 0 });
});

test('statusAt: round the clock all week has no closing time', () => {
  const w = parseWeek(week('Open 24 hours'));
  assert.deepEqual(statusAt(w, 3, 700), { open: true, closes: null, closesIn: 0 });
});

test('statusAt: midnight close followed by a 00:00 open is one shift', () => {
  const lines = week('9:00 AM – 5:00 PM');
  lines[4] = 'Friday: 9:00 AM – 12:00 AM';
  lines[5] = 'Saturday: 12:00 AM – 3:00 AM, 9:00 AM – 5:00 PM';
  assert.deepEqual(statusAt(parseWeek(lines), 4, 1400), { open: true, closes: 180, closesIn: 1 });
});

test('statusAt: never opens', () => {
  assert.deepEqual(statusAt(parseWeek(week('Closed')), 0, 0), { open: false, opens: null, opensIn: 0 });
});

test('venueClock reads the venue zone, not the machine zone', () => {
  // 2026-09-24T00:30Z is Thursday 09:30 in Seoul and Wednesday 20:30 in New York.
  const at = new Date('2026-09-24T00:30:00Z');
  assert.deepEqual(venueClock(at, 'Asia/Seoul'), { day: 3, min: 570 });
  assert.deepEqual(venueClock(at, 'America/New_York'), { day: 2, min: 1230 });
});
