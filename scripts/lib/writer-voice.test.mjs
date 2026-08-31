// The prompt must not hand the model sentences to copy.
//
// On 2026-08-31 a Codex audit read twelve live guides side by side and found
// them closing the same way, opening the same way, and ending on the same
// heading. Each trace led back to the prompt itself: "The first thing you
// notice is…" was offered as a model sentence and 17 guides opened with it
// verbatim; "one H2 titled exactly 'How to visit like a local'" was mandated
// two lines after the same prompt warned that repeating section titles is a
// template smell, and 8 of 12 sampled guides ended there.
//
// These assertions are deliberately about the PROMPT, not about output: output
// drifts, but a stock sentence in the instructions reproduces itself in every
// post from then on. If a future edit reintroduces one, this fails here rather
// than 300 guides later.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('./writer.mjs', import.meta.url)), 'utf8');

// The instruction block, not the ban list that names these phrases in order to
// forbid them: everything after the banned-list sentence is allowed to quote them.
const BANNED_LIST_AT = SRC.indexOf('treat them as banned');
assert.ok(BANNED_LIST_AT > 0, 'the ban list itself went missing');

test('no stock opening sentence is offered as a model', () => {
  // Each of these appeared in the prompt as an example and came back verbatim
  // across the corpus. They may appear ONLY inside the ban list.
  for (const phrase of ['The first thing you notice', 'As you turn off the main road']) {
    let i = -1;
    while ((i = SRC.indexOf(phrase, i + 1)) !== -1) {
      assert.ok(
        i > BANNED_LIST_AT,
        `"${phrase}" is offered to the model as an example again (position ${i}); it belongs only in the ban list`,
      );
    }
  }
});

test('the fixed section heading is no longer mandated', () => {
  assert.equal(
    /titled exactly "How to visit like a local"/.test(SRC), false,
    'the prompt mandates the heading again — 8 of 12 sampled guides ended there last time',
  );
  assert.ok(
    /TITLE IT FOR THIS PLACE/.test(SRC),
    'the replacement instruction (name the section for this place) is missing',
  );
});

test('the tourist-mistake closer is a conditional device, not a requirement', () => {
  assert.ok(
    /use that device only when/.test(SRC),
    'the "most common tourist mistake" closer is unconditional again; it closed 20% of the corpus last time',
  );
});

test('sensory detail is anchored to what is reliably true', () => {
  assert.ok(
    /RELIABLY TRUE of the place rather than a moment nobody witnessed/.test(SRC),
    'the senses instruction no longer distinguishes a stable fact from an unwitnessed moment',
  );
  assert.ok(
    /We were not standing there/.test(SRC),
    'the prompt no longer tells the model it was not present',
  );
});

test('the visit-report voice itself is kept — this guard must not flatten the writing', () => {
  // The owner's stated first priority for writing quality. A future cleanup
  // that removes the fingerprint by removing the voice has gone too far.
  assert.ok(/first-hand VISIT REPORT/.test(SRC), 'the visit-report voice instruction is gone');
  assert.ok(/immersive second-person/.test(SRC), 'the immersive second-person instruction is gone');
});
