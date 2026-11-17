import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRefreshCandidates } from './refresh-order.mjs';

const order = (cands, checked = {}) => sortRefreshCandidates(cands, checked).map((c) => c.file);

test('never-checked posts go before any checked post', () => {
  assert.deepEqual(
    order(
      [{ file: 'a.md', pubDate: '2026-07-01' }, { file: 'z.md', pubDate: '2026-11-01' }],
      { 'a.md': '2026-08-09' },
    ),
    ['z.md', 'a.md'],
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
