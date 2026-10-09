import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isPinnedHero, pinDrift } from './hero-pins.mjs';

const C = 'https://upload.wikimedia.org/wikipedia/commons/';
const pins = { a: { url: C + '2/2e/Jay_Park_performing.jpg' } };

test('고정 사진: 같은 사진의 다른 크기는 같은 결정, 다른 사진은 변경', () => {
  assert.ok(isPinnedHero(pins, 'a'));
  assert.ok(isPinnedHero(pins, 'a', C + 'thumb/2/2e/Jay_Park_performing.jpg/1280px-Jay_Park_performing.jpg'));
  assert.equal(isPinnedHero(pins, 'a', C + 'e/e9/JAY_%28ENHYPEN%29_220624.jpg'), false);
  assert.equal(isPinnedHero(pins, 'b'), false);
  assert.equal(pinDrift(pins, 'a', C + 'thumb/2/2e/Jay_Park_performing.jpg/1920px-Jay_Park_performing.jpg'), false, 'a width upgrade is not drift');
  assert.ok(pinDrift(pins, 'a', C + 'e/e9/JAY_%28ENHYPEN%29_220624.jpg'));
  assert.ok(pinDrift(pins, 'a', undefined), 'a stripped hero is drift');
  assert.equal(pinDrift(pins, 'b', undefined), false);
});

test('reassert-hero-pins: 바뀐 고정 사진을 되돌린다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pins-'));
  writeFileSync(join(dir, 'a.md'), '---\ntitle: A\ncategory: event\nheroImage:\n  url: ' + C + 'e/e9/JAY_%28ENHYPEN%29_220624.jpg\n---\nbody\n');
  writeFileSync(join(dir, 'c.md'), '---\ntitle: C\n---\nbody\n');
  const { driftedPins } = await import('../reassert-hero-pins.mjs');
  const d = driftedPins({ a: { url: C + '2/2e/Jay_Park_performing.jpg' }, gone: { url: C + 'x.jpg' } }, dir);
  assert.deepEqual(d.map((x) => x.slug), ['a'], 'only the drifted one; a retired guide is ignored');
});
