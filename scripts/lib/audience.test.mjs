import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketSubscribers } from './audience.mjs';

test('buckets global, single, and multi by language', () => {
  const subs = [
    { id: '1', fields: { region: 'dubai', lang: 'ko' } },
    { id: '2', fields: { region: 'dubai', lang: 'ko' } },
    { id: '3', fields: { region: 'dubai', lang: 'en' } },
    { id: '4', fields: { region: '', lang: 'en' } },
    { id: '5', fields: { region: '__global__', lang: 'en' } },
    { id: '6', fields: { region: 'dubai,paris', lang: 'en' } },
    { id: '7', fields: {} },
  ];
  const buckets = bucketSubscribers(subs);
  const by = (k) => buckets.find((b) => b.key === k);

  assert.equal(by('dubai:ko').type, 'single');
  assert.deepEqual(by('dubai:ko').subscriberIds.sort(), ['1', '2']);
  assert.equal(by('dubai:en').type, 'single');
  assert.deepEqual(by('dubai:en').subscriberIds, ['3']);

  // ids 4,5,7 all land in the global/en audience
  assert.equal(by('__global__:en').type, 'global');
  assert.deepEqual(by('__global__:en').subscriberIds.sort(), ['4', '5', '7']);

  const multi = by('dubai+paris:en');
  assert.equal(multi.type, 'multi');
  assert.deepEqual(multi.regions, ['dubai', 'paris']);
  assert.deepEqual(multi.subscriberIds, ['6']);
});
