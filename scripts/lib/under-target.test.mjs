import test from 'node:test';
import assert from 'node:assert/strict';
import { underTargetLine } from './under-target.mjs';

const active = [{ name: 'Japan' }, { name: 'Cambodia' }, { name: 'Uzbekistan' }];
const counts = new Map([['Japan', 120], ['Cambodia', 45], ['Uzbekistan', 46]]);

test('lists only countries under the cap, lowest first', () => {
  assert.equal(underTargetLine(counts, active, 58), 'UNDER_TARGET cap=58 Cambodia=45,Uzbekistan=46');
});

test('a country with no posts yet counts as 0', () => {
  assert.equal(underTargetLine(counts, [{ name: 'Laos' }], 58), 'UNDER_TARGET cap=58 Laos=0');
});

test('says none when every country is full', () => {
  assert.equal(underTargetLine(counts, [{ name: 'Japan' }], 58), 'UNDER_TARGET cap=58 none');
});

test('prints nothing for the normal (uncapped) daily run', () => {
  assert.equal(underTargetLine(counts, active, Infinity), '');
});
