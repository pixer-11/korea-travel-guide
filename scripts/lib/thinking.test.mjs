// node --test scripts/lib/thinking.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { thinkingOff } from './thinking.mjs';
import { isAlwaysVisitable } from './always-visitable.mjs';

test('reasoning is switched off only where the model accepts it', () => {
  assert.deepEqual(thinkingOff('claude-sonnet-5'), { thinking: { type: 'disabled' } });
  assert.deepEqual(thinkingOff('claude-haiku-4-5-20251001'), { thinking: { type: 'disabled' } });
  // Opus 5.5 answers `disabled` with a 400 — add nothing
  assert.deepEqual(thinkingOff('claude-opus-5-5'), {});
});

test('the always-visitable list is read by place id, quoted or not', () => {
  assert.equal(isAlwaysVisitable('ChIJX0z5sbgZ2jERbP7t9-0hs_E'), true);
  assert.equal(isAlwaysVisitable("'ChIJX0z5sbgZ2jERbP7t9-0hs_E'"), true);
  assert.equal(isAlwaysVisitable('ChIJsomethingelse'), false);
  assert.equal(isAlwaysVisitable(undefined), false);
});
