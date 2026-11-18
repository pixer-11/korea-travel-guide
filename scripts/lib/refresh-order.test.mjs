import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRefreshCandidates, lastLooked } from './refresh-order.mjs';

const order = (cands, checked = {}) => sortRefreshCandidates(cands, checked).map((c) => c.file);

test('a post checked long ago goes before a never-checked post published since', () => {
  // The 2026-11-18 case: checked 08-02, parked behind 522 never-checked posts,
  // most of them newer than its check. It would have crossed 120 days on 11-30.
  assert.deepEqual(
    order(
      [{ file: 'new-last-week.md', pubDate: '2026-11-10' }, { file: 'abu-dhabi-art-house-cafe.md', pubDate: '2026-07-22' }],
      { 'abu-dhabi-art-house-cafe.md': '2026-08-02' },
    ),
    ['abu-dhabi-art-house-cafe.md', 'new-last-week.md'],
  );
});

test('a never-checked post older than any check still goes first', () => {
  assert.deepEqual(
    order(
      [{ file: 'a.md', pubDate: '2026-07-01' }, { file: 'z.md', pubDate: '2026-07-20' }],
      { 'a.md': '2026-08-09' },
    ),
    ['z.md', 'a.md'],
  );
});

test('a re-check counts, not the publication date behind it', () => {
  // Published first, checked last: it is the freshest of the three.
  assert.deepEqual(
    order(
      [
        { file: 'old-but-checked.md', pubDate: '2026-07-01' },
        { file: 'mid.md', pubDate: '2026-09-01' },
        { file: 'newer.md', pubDate: '2026-10-01' },
      ],
      { 'old-but-checked.md': '2026-11-01' },
    ),
    ['mid.md', 'newer.md', 'old-but-checked.md'],
  );
});

test('among never-checked, the oldest publication goes first — not the earliest filename', () => {
  // The 2026-11-17 case: a July "seoul-…" post waited behind newer posts whose
  // names sorted earlier, and crossed the 120-day alarm while they were served.
  assert.deepEqual(
    order([
      { file: 'abu-dhabi-new.md', pubDate: '2026-11-10T00:00:00.000Z' },
      { file: 'seoul-euljiro.md', pubDate: '2026-07-20T00:00:00.000Z' },
      { file: 'hanoi-mid.md', pubDate: new Date('2026-09-01') },
    ]),
    ['seoul-euljiro.md', 'hanoi-mid.md', 'abu-dhabi-new.md'],
  );
});

test('checked posts go oldest check first, filename breaking the tie', () => {
  assert.deepEqual(
    order(
      [
        { file: 'c.md', pubDate: '2026-07-01' },
        { file: 'b.md', pubDate: '2026-10-01' },
        { file: 'a.md', pubDate: '2026-09-01' },
      ],
      { 'a.md': '2026-09-10', 'b.md': '2026-08-09', 'c.md': '2026-09-10' },
    ),
    ['b.md', 'a.md', 'c.md'],
  );
});

test('a check and a publication on the same day tie, and filename settles it', () => {
  // The cursor stores a day and pubDate carries a time; they must compare as days.
  // The checked post is the LATER filename on purpose: compared as raw strings
  // '2026-09-10' sorts before '2026-09-10T15:30…' and z.md would lead, so this
  // only passes when both are reduced to a day (Codex, 2026-11-18: with a.md
  // checked, a comparator that skipped the reduction passed all the same).
  assert.deepEqual(
    order(
      [{ file: 'a.md', pubDate: '2026-09-10T15:30:00.000Z' }, { file: 'z.md', pubDate: '2026-07-01' }],
      { 'z.md': '2026-09-10' },
    ),
    ['a.md', 'z.md'],
  );
});

test('a quoted timestamp with an offset is read by its written day, as the alarm reads it', () => {
  assert.equal(lastLooked({ file: 'z.md', pubDate: '2026-07-20T23:30:00-05:00' }, {}), '2026-07-20');
  assert.equal(lastLooked({ file: 'z.md', pubDate: new Date('2026-07-20T00:00:00Z') }, {}), '2026-07-20');
});

test('same pubDate falls back to filename, and a missing pubDate is treated as oldest', () => {
  assert.deepEqual(
    order([
      { file: 'b.md', pubDate: '2026-07-20' },
      { file: 'a.md', pubDate: '2026-07-20' },
      { file: 'nodate.md' },
      { file: 'garbage.md', pubDate: 'not a date' },
    ]),
    ['garbage.md', 'nodate.md', 'a.md', 'b.md'],
  );
});

test('lastLooked: the check when there is one, the publication day when there is not', () => {
  assert.equal(lastLooked({ file: 'a.md', pubDate: '2026-07-01' }, { 'a.md': '2026-08-09' }), '2026-08-09');
  assert.equal(lastLooked({ file: 'a.md', pubDate: '2026-07-01T09:00:00Z' }, {}), '2026-07-01');
  assert.equal(lastLooked({ file: 'a.md' }, {}), '');
});

test('a rotation on this order never lets a post reach the 120-day alarm', () => {
  // The site on 2026-11-18 in miniature: one post checked in early August, the
  // rest never checked and published across the months since, at a rate the
  // daily budget covers, starting while the oldest post is 100 days old. Under
  // two queues the checked post waits out the alarm (measured: 1 overdue).
  const ALARM_DAYS = 120, PER_DAY = 35;
  const d0 = Date.UTC(2026, 6, 20);
  const iso = (n) => new Date(d0 + n * 864e5).toISOString().slice(0, 10);
  const posts = [{ file: 'checked-early.md', pubDate: iso(2) }];
  for (let i = 0; i < 2600; i++) posts.push({ file: `p${String(i).padStart(4, '0')}.md`, pubDate: iso(i % 118) });
  const checked = { 'checked-early.md': iso(13) };
  let worst = 0;
  for (let n = 100; n < 100 + 200; n++) {
    const overdue = posts.filter((p) => n - (Date.parse(lastLooked(p, checked)) - d0) / 864e5 > ALARM_DAYS).length;
    worst = Math.max(worst, overdue);
    sortRefreshCandidates(posts, checked);
    for (const p of posts.slice(0, PER_DAY)) checked[p.file] = iso(n);
  }
  assert.equal(worst, 0);
});
