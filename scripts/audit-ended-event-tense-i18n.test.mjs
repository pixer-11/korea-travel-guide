// ─────────────────────────────────────────────────────────────
//  The question-skipper, tested on the thing it must NOT skip.
//
//  Written after the skipper, added on 2026-09-07 to stop a block-scalar FAQ
//  question raising a false alarm, ate the ANSWERS instead: `a: Se celebrará en
//  Madrid.` is indented deeper than its `- q:`, so it was dropped, and because
//  nothing reset the state every later answer went with it. An audit that reads
//  questions and ignores answers is worse than the false alarm it replaced —
//  the answer is the half that has to be in the past tense.
// ─────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** The exact reduction used by the audit. Kept in step by the tests below. */
function stripQuestions(text) {
  return text.split('\n').reduce((keep, line) => {
    const indent = /^(\s*)/.exec(line)[1].length;
    const isKey = /^\s*-?\s*[A-Za-z_][\w-]*:(\s|$)/.test(line);
    if (/^\s*-?\s*q:/i.test(line)) { keep.skipUnder = indent; return keep; }
    if (keep.skipUnder !== null) {
      if (line.trim() === '') return keep;
      if (indent > keep.skipUnder && !isKey) return keep;
      keep.skipUnder = null;
    }
    keep.out.push(line);
    return keep;
  }, { out: [], skipUnder: null }).out.join('\n');
}

test('a block-scalar question is dropped, but its answer is kept', () => {
  const kept = stripQuestions([
    'title: x',
    'faq:',
    '  - q: >-',
    '      ¿Cuándo fue?',
    '    a: Se celebrará en Madrid.',
    '  - q: otra',
    '    a: Ya terminó.',
  ].join('\n'));

  assert.ok(!/Cuándo fue/.test(kept), 'the question text must be gone');
  assert.match(kept, /Se celebrará en Madrid/, 'the answer must survive — it is what gets checked');
  assert.match(kept, /Ya terminó/, 'later answers must survive too');
});

test('a one-line question is dropped without taking the next line', () => {
  const kept = stripQuestions('  - q: どこで開催されますか\n    a: 開催されました。\n');
  assert.ok(!/開催されますか/.test(kept));
  assert.match(kept, /開催されました/);
});

test('CJK continuation text under a block scalar is not mistaken for a key', () => {
  // A translated line can contain a colon; it must still count as continuation.
  const kept = stripQuestions('  - q: >-\n      開催地: どこ\n    a: 終了しました。\n');
  assert.ok(!/開催地/.test(kept), 'continuation of the question stays dropped');
  assert.match(kept, /終了しました/);
});
