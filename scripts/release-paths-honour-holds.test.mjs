import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 2026-08-31 shipped three posts that were unpublished on purpose: two event
// twins and a guide withdrawn for describing the wrong city. Two different
// release paths did it, each missing a guard the other already had. These
// assertions are deliberately about WIRING — the logic is tested in
// lib/live-event-twins.test.mjs and lib/patrol-target.test.mjs; what keeps
// breaking is a path that never asks.
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('every path that can publish a draft honours a non-photo hold', () => {
  for (const f of ['release-photoless-events.mjs', 'backfill-photos-alt.mjs', 'release-verified-quarantine.mjs']) {
    assert.match(src(`./${f}`), /NON_PHOTO_HOLD|heldReason/, `${f} publishes drafts without reading heldReason`);
  }
});

test('every path that can publish an event asks whether its twin is already live', () => {
  for (const f of ['release-photoless-events.mjs', 'backfill-photos-alt.mjs']) {
    assert.match(src(`./${f}`), /alreadyLive\(/, `${f} can publish a second guide to one event`);
  }
});

test('the pairing rule is imported, never copied', () => {
  for (const f of ['release-photoless-events.mjs', 'backfill-photos-alt.mjs']) {
    assert.match(src(`./${f}`), /from '\.\/lib\/live-event-twins\.mjs'/, `${f} carries its own copy of the rule`);
  }
});
